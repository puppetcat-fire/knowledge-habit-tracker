const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createAuthenticatedActionApp } = require('./authenticated-app.cjs');
const { FORMAT } = require('./action-state.cjs');
let directory, app, cookie;
const data = () => ({ schema: 1, activeId: 'active', habitId: 'h', habits: [{ id: 'h', name: '阅读', formedAt: null }], templates: {},
  events: [{ id: 'paused', name: '吃东西', startedAt: 0, endedAt: null, segments: [{ start: 0, end: 1000 }],
    draft: '父草稿', notes: [{ id: 'note', text: '单次笔记', at: 500 }], steps: [], stepDone: {} },
  { id: 'active', name: '喝水', startedAt: 1000, endedAt: null, segments: [{ start: 1000, end: null }], draft: '', notes: [], steps: [], stepDone: {} }] });
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-auth-integration-'));
  app = createAuthenticatedActionApp({ dataDir: directory, reviewDirectory: path.join(directory, 'assets'), rateLimitEnabled: false }).app;
  const signup = await request(app).post('/api/register').send({ name: 'integration-alice', password: 'test-only-2026' });
  expect(signup.status).toBe(201);
  cookie = signup.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
});
afterEach(() => { const absolute = path.resolve(directory); if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected directory'); fs.rmSync(absolute, { recursive: true, force: true }); });
async function save() {
  const initial = await request(app).get('/api/action-state').set('Cookie', cookie);
  expect(initial.status).toBe(200);
  return request(app).put('/api/action-state').set('Cookie', cookie).set('If-Match', initial.body.revision).send({ format: FORMAT, data: data() });
}
it('round trips 8000 unfinished nested events with one active clock and preserves the oldest notes after reopening',async()=>{
 const archive=data();archive.activeId='many-7999';
 archive.events=Array.from({length:8000},(_,i)=>({id:'many-'+i,name:'长期记录事件'+i,startedAt:0,endedAt:null,segments:[{start:0,end:i===7999?null:0}],steps:[],stepDone:{},draft:i===0?'最早事件的未保存想法':'',notes:i===0?[{id:'old-note',text:'最早事件的单次笔记',at:0}]:[],...(i<7999?{parentId:'many-'+(i+1)}:{})}));
 const initial=await request(app).get('/api/action-state').set('Cookie',cookie);
 const saved=await request(app).put('/api/action-state').set('Cookie',cookie).set('If-Match',initial.body.revision).send({format:FORMAT,data:archive});
 expect(saved.status).toBe(200);
 const reopened=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'reopen-many-assets'),rateLimitEnabled:false}).app;
 const read=await request(reopened).get('/api/action-state').set('Cookie',cookie);
 expect(read.status).toBe(200);expect(read.body.revision).toBe(saved.body.revision);expect(read.body.state.data).toEqual(archive);
 expect(read.body.state.data.events.flatMap(e=>e.segments).filter(s=>s.end===null)).toHaveLength(1);
 const bad=structuredClone(archive);bad.events[7999].parentId='many-3000';
 const refused=await request(reopened).put('/api/action-state').set('Cookie',cookie).set('If-Match',read.body.revision).send({format:FORMAT,data:bad});
 expect(refused.status).toBe(400);expect(refused.body.code).toBe('ACTION_VALIDATION');
 expect((await request(reopened).get('/api/action-state').set('Cookie',cookie)).body.state.data).toEqual(archive);
});
it('checks the current account password without creating a session or changing cookies',async()=>{
 const user=(await request(app).get('/api/me').set('Cookie',cookie)).body.user,before=fs.readFileSync(path.join(directory,'sessions.json'),'utf8');
 const valid=await request(app).post('/api/review-password-check').set('Cookie',cookie).set('X-Action-Account',user.id).send({password:'test-only-2026'});expect(valid.status).toBe(200);expect(valid.body).toEqual({ok:true,verified:true,userId:user.id});expect(valid.headers['set-cookie']).toBeUndefined();
 const wrong=await request(app).post('/api/review-password-check').set('Cookie',cookie).set('X-Action-Account',user.id).send({password:'wrong-pass-2026'});expect(wrong.status).toBe(401);expect(wrong.headers['set-cookie']).toBeUndefined();expect(fs.readFileSync(path.join(directory,'sessions.json'),'utf8')).toBe(before);expect((await request(app).get('/api/me').set('Cookie',cookie)).body.user.id).toBe(user.id);
 expect((await request(app).post('/api/review-password-check').set('Cookie',cookie).set('X-Action-Account','another-account').send({password:'test-only-2026'})).status).toBe(409);expect((await request(app).post('/api/review-password-check').send({password:'test-only-2026'})).status).toBe(401);expect((await request(app).post('/api/review-password-check').set('Cookie',cookie).set('Origin','https://untrusted.example').set('X-Action-Account',user.id).send({password:'test-only-2026'})).status).toBe(403);
});
it('limits repeated password checks on an authenticated account',async()=>{
 const user=(await request(app).get('/api/me').set('Cookie',cookie)).body.user;for(let i=0;i<30;i++)expect((await request(app).post('/api/review-password-check').set('Cookie',cookie).set('X-Action-Account',user.id).send({password:'short'})).status).toBe(401);expect((await request(app).post('/api/review-password-check').set('Cookie',cookie).set('X-Action-Account',user.id).send({password:'test-only-2026'})).status).toBe(429);
});
it('does not log out a different authenticated account when an old window supplies its expected actor',async()=>{
 const alice=(await request(app).get('/api/me').set('Cookie',cookie)).body.user;
 const signed=await request(app).post('/api/register').send({name:'logout-bob',password:'test-only-2026'}),bobCookie=signed.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ');
 expect((await request(app).post('/api/logout').set('Cookie',bobCookie).set('X-Action-Account',alice.id).send({})).status).toBe(409);
 expect((await request(app).get('/api/me').set('Cookie',bobCookie)).body.user.name).toBe('logout-bob');
 expect((await request(app).post('/api/logout').set('Cookie',cookie).set('X-Action-Account',alice.id).send({})).status).toBe(200);
 expect((await request(app).get('/api/me').set('Cookie',cookie)).status).toBe(401);expect((await request(app).get('/api/me').set('Cookie',bobCookie)).status).toBe(200);
});
it('uses the real registration cookie and retains full action data after creating a fresh app', async () => {
  expect((await save()).status).toBe(200);
  const restarted = createAuthenticatedActionApp({ dataDir: directory, reviewDirectory: path.join(directory, 'restart-assets'), rateLimitEnabled: false }).app;
  expect((await request(restarted).get('/api/action-state').set('Cookie', cookie)).body.state.data).toEqual(data());
  expect((await request(restarted).get('/api/state').set('Cookie', cookie)).body.state).toBeNull();
});
it('rejects missing or forged credentials including the old test identity header', async () => {
  expect((await request(app).get('/api/action-state').set('X-Test-Identity', 'alice')).status).toBe(401);
  expect((await request(app).get('/api/action-state').set('Cookie', 'kht_session=forged')).status).toBe(401);
});
it('isolates a second registered account', async () => {
  await save();
  const signup = await request(app).post('/api/register').send({ name: 'integration-bob', password: 'test-only-2026' });
  const bobCookie = signup.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
  expect((await request(app).get('/api/action-state').set('Cookie', bobCookie)).body.state).toBeNull();
});
it('only exposes aggregate action data for the signed-in account', async () => {
  expect((await save()).status).toBe(200);
  const route = '/api/action-state/summary';
  const alice = (await request(app).get('/api/me').set('Cookie', cookie)).body.user;
  const own = await request(app).get(route).set('Cookie', cookie);
  expect(own.status).toBe(200);
  expect(own.headers['cache-control']).toBe('no-store');
  expect(own.body).toEqual({ ok: true, ownerId: alice.id, summary: { events: 2, recordedMs: 1000 } });

  const bob = request.agent(app);
  expect((await bob.post('/api/register').send({ name: 'summary-bob', password: 'test-only-2026' })).status).toBe(201);
  const bobId = (await bob.get('/api/me')).body.user.id;
  const other = await bob.get(route).query({ ownerId: alice.id });
  expect(other.status).toBe(200);
  expect(other.body).toEqual({ ok: true, ownerId: bobId, summary: { events: 0, recordedMs: 0 } });
  expect((await bob.get(route).set('X-Action-Account', alice.id)).status).toBe(409);
  expect((await request(app).get(route)).status).toBe(401);
});
it('revokes new-state access when the existing logout invalidates its session', async () => {
  await save();
  expect((await request(app).post('/api/logout').set('Cookie', cookie)).status).toBe(200);
  expect((await request(app).get('/api/action-state').set('Cookie', cookie)).status).toBe(401);
});
it('rejects foreign-origin writes without changing existing state', async () => {
  await save();
  const before = await request(app).get('/api/action-state').set('Cookie', cookie);
  expect((await request(app).put('/api/action-state').set('Cookie', cookie).set('Origin', 'https://untrusted.example').set('If-Match', before.body.revision).send({ format: FORMAT, data: data() })).status).toBe(403);
  expect((await request(app).get('/api/action-state').set('Cookie', cookie)).body.revision).toBe(before.body.revision);
});
