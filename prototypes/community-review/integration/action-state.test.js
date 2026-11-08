const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { FORMAT, validateActionState, installActionStateRoutes } = require('./action-state.cjs');
function fixture() {
  const event = (id, start, end) => ({ id, name: id, startedAt: start, endedAt: end,
    segments: [{ start, end }], steps: [{ id: 'water', text: '喝水' }], stepDone: { water: false }, draft: '草稿',
    notes: [{ id: 'note1', text: '第一条', at: 0 }, { id: 'note2', text: '第二条', at: 1000 }],
    repeatText: '复用内容', knowledge: { nodeId: 'eq', version: 1, content: '当时方法', nodeGoal: '完整目标' } });
  return { schema: 1, mode: 'local-simulation', activeId: 'game', habitId: 'h', habits: [{ id: 'h', name: '阅读', formedAt: 0 }],
    templates: { '吃东西': { text: '保留定义', steps: [] } }, events: [event('finished', -1000, 0),
      { ...event('eat', 0, 1000), endedAt: null }, event('game', 1000, null)],
    nodes: [], edges: [], lights: [], paths: [], proposals: [], issues: [], bio: '完整保留', settings: { reminders: false }, share: { aggregate: false } };
}
let directory, api;
it('retains explicit path bookmarks and rejects nonboolean bookmark state',()=>{
 const data=fixture();data.paths=[{id:'path',title:'我的路径',nodes:['eq'],bookmarked:true}];expect(validateActionState(data).paths[0].bookmarked).toBe(true);data.paths[0].bookmarked=false;expect(validateActionState(data).paths[0].bookmarked).toBe(false);data.paths[0].bookmarked='yes';expect(()=>validateActionState(data)).toThrow('Invalid path bookmark');
});
it('retains a deep 8000-event chain without recursion and still rejects a distant parent cycle',()=>{
 const data=fixture();data.activeId=null;
 data.events=Array.from({length:8000},(_,i)=>({id:'deep-'+i,name:'事件'+i,startedAt:0,endedAt:null,segments:[],steps:[],stepDone:{},draft:'',notes:[],...(i<7999?{parentId:'deep-'+(i+1)}:{})}));
 expect(validateActionState(data)).toBe(data);expect(data.events).toHaveLength(8000);
 expect(data.events[0].parentId).toBe('deep-1');expect(data.events[7998].parentId).toBe('deep-7999');
 data.events[7999].parentId='deep-3000';expect(()=>validateActionState(data)).toThrow('Parent cycle');
 delete data.events[7999].parentId;data.events.reverse();expect(validateActionState(data)).toBe(data);
 data.events[2000].parentId='missing-deep-parent';expect(()=>validateActionState(data)).toThrow('Unknown parent event');
});
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-action-store-'));
  const app = express(); app.use(express.json());
  // Test-only identity resolver. Production session wiring is not implemented.
  installActionStateRoutes(app, { directory, authenticate: req => ['alice', 'bob'].includes(req.get('X-Test-Identity')) ? { id: req.get('X-Test-Identity') } : null });
  api = request(app);
});
afterEach(() => { const absolute = path.resolve(directory); if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected directory'); fs.rmSync(absolute, { recursive: true, force: true }); });
async function firstPut(data = fixture()) {
  const before = await api.get('/api/action-state').set('X-Test-Identity', 'alice');
  return api.put('/api/action-state').set('X-Test-Identity', 'alice').set('If-Match', before.body.revision).send({ format: FORMAT, data });
}
it('round trips full action data without converting paused events or dropping snapshots', async () => {
  expect((await firstPut()).status).toBe(200);
  const result = await api.get('/api/action-state').set('X-Test-Identity', 'alice');
  expect(result.body.state.data).toEqual(fixture());
  expect(result.body.state.data.events[0].endedAt).toBe(0);
});
it.each(['event','method'])('rejects invalid %s materials without replacing a saved account archive',async location=>{
 const data=fixture(),materials=[{label:'练习材料',url:'https://example.com/practice',optional:false,affiliate:true}];data.events[0].knowledge.resourceLinks=structuredClone(materials);data.nodes=[{id:'eq',methods:[{id:'m',versions:[{number:1,resourceLinks:structuredClone(materials)}]}]}];expect((await firstPut(data)).status).toBe(200);
 const before=(await api.get('/api/action-state').set('X-Test-Identity','alice')).body;
 expect(before.state.data).toEqual(data);const bad=structuredClone(data);(location==='event'?bad.events[0].knowledge.resourceLinks:bad.nodes[0].methods[0].versions[0].resourceLinks)[0].privateMemo='未知字段';
 const rejected=await api.put('/api/action-state').set('X-Test-Identity','alice').set('If-Match',before.revision).send({format:FORMAT,data:bad});expect(rejected.status).toBe(400);expect(rejected.body.code).toBe('ACTION_VALIDATION');
 const after=(await api.get('/api/action-state').set('X-Test-Identity','alice')).body;expect(after).toEqual(before);
});
it('round trips a detached child origin without requiring a deleted parent record', async () => {
  const data = fixture();
  data.events[2].parentOrigin = { id: 'deleted-parent', name: '已删除的父事件', stepId: 'old-step', deletedAt: 1000 };
  expect((await firstPut(data)).status).toBe(200);
  expect((await api.get('/api/action-state').set('X-Test-Identity', 'alice')).body.state.data).toEqual(data);
});
it('rejects deleted-parent origin that carries private parent notes', async () => {
  const data = fixture();
  data.events[2].parentOrigin = { id: 'deleted-parent', name: '父事件', stepId: null, deletedAt: 1000, notes: ['不应复制'] };
  expect((await firstPut(data)).status).toBe(400);
});
it('round trips an explicitly unavailable legacy source while rejecting an unresolved live reference', async () => {
  const data = fixture();data.events[2].parentId='missing-old-parent';
  expect((await firstPut(data)).status).toBe(400);
  delete data.events[2].parentId;data.events[2].parentMissing={id:'missing-old-parent',stepId:'original-step'};
  expect((await firstPut(data)).status).toBe(200);
  expect((await api.get('/api/action-state').set('X-Test-Identity','alice')).body.state.data).toEqual(data);
});
it('rejects invented parent names in the unavailable-source marker', async () => {
  const data=fixture();data.events[2].parentMissing={id:'missing-old-parent',stepId:null,name:'猜测的名称'};
  expect((await firstPut(data)).status).toBe(400);
});
it('requires an authenticated account and isolates accounts', async () => {
  expect((await api.get('/api/action-state')).status).toBe(401);
  await firstPut();
  expect((await api.get('/api/action-state').set('X-Test-Identity', 'bob')).body.state).toBeNull();
});
it('requires a revision and rejects a stale write', async () => {
  const empty = (await api.get('/api/action-state').set('X-Test-Identity', 'alice')).body.revision;
  expect((await api.put('/api/action-state').set('X-Test-Identity', 'alice').send({ format: FORMAT, data: fixture() })).status).toBe(428);
  await firstPut();
  expect((await api.put('/api/action-state').set('X-Test-Identity', 'alice').set('If-Match', empty).send({ format: FORMAT, data: fixture() })).status).toBe(409);
});
it('rejects two accumulating activities and overlapping historical intervals', () => {
  let data = fixture(); data.events[1].segments[0].end = null;
  expect(() => validateActionState(data)).toThrow();
  data = fixture(); data.events[0].segments[0].end = 100; data.events[0].endedAt = 100;
  expect(() => validateActionState(data)).toThrow('overlap');
});
it('rejects credential roots without changing stored data', async () => {
  await firstPut(); const old = fs.readFileSync(path.join(directory, 'alice.json'), 'utf8');
  expect((await firstPut({ ...fixture(), accounts: [{ hash: 'must-not-be-stored' }] })).status).toBe(400);
  expect(fs.readFileSync(path.join(directory, 'alice.json'), 'utf8')).toBe(old);
});
it('preserves corrupt storage and refuses overwriting it as an empty account', async () => {
  const name = path.join(directory, 'alice.json'); fs.writeFileSync(name, '{broken');
  expect((await api.get('/api/action-state').set('X-Test-Identity', 'alice')).status).toBe(500);
  expect((await api.put('/api/action-state').set('X-Test-Identity', 'alice').set('If-Match', 'anything').send({ format: FORMAT, data: fixture() })).status).toBe(500);
  expect(fs.readFileSync(name, 'utf8')).toBe('{broken');
});
