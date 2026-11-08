const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {FORMAT}=require('./action-state.cjs');
let directory,app,alice,bob,state,revision,target;
async function save(){const old=(await alice.get('/api/action-state')).body;const r=await alice.put('/api/action-state').set('If-Match',old.revision).send({format:FORMAT,data:state});expect(r.status).toBe(200);revision=r.body.revision}
async function saveTarget(){let r=alice.post('/api/review-private-targets').set('If-Match',revision);const old=(await alice.get('/api/review-private-targets')).body.current.find(r=>r.originId==='personal');if(old)r=r.set('If-Target-Match',old.revision);const saved=await r.send({nodeId:'personal',sourceVersion:state.nodes[0].version});expect(saved.status).toBe(201);target=saved.body.binding}
async function publish(extra={},previous){let r=alice.post('/api/review-method-publications').set('If-Match',revision);if(previous)r=r.set('If-Method-Match',previous);return r.send({nodeId:'personal',methodId:'method',sourceVersion:state.nodes[0].methods[0].versions.at(-1).number,visibility:'private',...extra})}
function event(id){const n=state.nodes[0],m=n.methods[0],v=m.versions.at(-1),start=state.events.length*2000;return {id,name:n.title,startedAt:start,endedAt:start+1000,segments:[{start,end:start+1000}],steps:[],stepDone:{},draft:'本人的草稿',notes:[],knowledge:{nodeId:n.id,nodeTitle:n.title,nodeGoal:n.goal,nodeVersion:n.version,nodeDomain:n.domain,nodeBranch:n.branch,nodeOwnership:n.ownership,nodeVisibility:n.visibility,methodId:m.id,methodTitle:m.title,version:v.number,content:v.content,five:v.five,resource:v.resource}}}
async function practice(id,tutorial,extra={}){return alice.post('/api/review-practices').set('If-Match',revision).send({eventId:id,tutorialId:tutorial.id,tutorialVersion:tutorial.version,visibility:'private',...extra})}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-private-methods-'));app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;
 alice=request.agent(app);bob=request.agent(app);await alice.post('/api/register').send({name:'private-method-alice',password:'test-only-2026'});await bob.post('/api/register').send({name:'private-method-bob',password:'test-only-2026'});
 state={schema:1,mode:'local-simulation',events:[],activeId:null,habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{},nodes:[{id:'personal',title:'私人原型目标',goal:'做自己的原型并写下修改理由。',five:'先画三条线。',domain:'个人创造',branch:'草图',ownership:'personal',visibility:'private',version:1,methods:[{id:'method',title:'逐步试作',author:'private-method-alice',visibility:'private',versions:[{number:1,created:0,content:'画草图，再写下解释。',five:'先画三条线。',resource:'https://example.com/material'}]}]}]};await save();await saveTarget();
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected directory');fs.rmSync(directory,{recursive:true,force:true})});
it('stores an actual private tutorial and target binding, hidden from other accounts including direct version URLs',async()=>{
 const r=await publish();expect(r.status).toBe(201);expect(r.body.binding.source.ref.nodeId).toBe(target.ref.nodeId);expect(r.body.tutorial.visibility).toBe('private');expect(r.body.binding.source.ref.ownerId).toBe(target.ownerId);
 expect((await bob.get('/api/tutorials')).body.tutorials).toHaveLength(0);expect((await bob.get('/api/tutorials/'+r.body.tutorial.id+'/versions/'+r.body.tutorial.version)).status).toBe(404);expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(1);
});
it('keeps old method snapshots usable after an explicit private tutorial revision',async()=>{
 const first=(await publish()).body;state.events.push(event('old'));await save();const original=JSON.stringify(state.events[0].knowledge);
 state.nodes[0].methods[0].versions.push({number:2,created:2000,content:'先解释用途，再画草图。',five:'写下一句用途。',resource:''});await save();const second=await publish({},first.tutorial.version);expect(second.status).toBe(200);
 const old=await practice('old',first.tutorial);expect(old.status).toBe(201);expect(old.body.record.tutorialVersion).toBe(first.tutorial.version);expect(JSON.stringify(state.events[0].knowledge)).toBe(original);expect(old.body.record.sourceSnapshot.content).toBe('画草图，再写下解释。');
});
it('separates identical method versions across target revisions and selects the correct context for both practices',async()=>{
 const first=(await publish()).body;state.events.push(event('target-one'));await save();const targetOne=target.ref.targetVersion;
 state.nodes[0].version=2;state.nodes[0].branch='试作';await save();await saveTarget();const second=await publish({},first.tutorial.version);expect(second.status).toBe(200);expect(second.body.tutorial.version).toBe(first.tutorial.version);expect(second.body.binding.source.ref.targetVersion).not.toBe(targetOne);
 state.events.push(event('target-two'));await save();const old=await practice('target-one',first.tutorial),current=await practice('target-two',second.body.tutorial);expect(old.status).toBe(201);expect(current.status).toBe(201);expect(old.body.record.targetVersion).toBe(targetOne);expect(current.body.record.targetVersion).toBe(target.ref.targetVersion);expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(2);
});
it('rejects a public tutorial or practice while its target is private',async()=>{
 expect((await publish({visibility:'public',publicConsent:true,lightId:'anything'})).status).toBe(400);const first=(await publish()).body;state.events.push(event('private'));state.lights=[{id:'light',eventId:'private',nodeId:'personal',confirmed:true,public:true,result:'本人的结果',evidence:'本人的证据'}];await save();expect((await practice('private',first.tutorial,{visibility:'public',lightId:'light'})).status).toBe(403);expect((await bob.get('/api/records')).body.records).toHaveLength(0);
});
it('does not reinterpret an altered source number or borrow a private method in another account',async()=>{
 const first=(await publish()).body;state.nodes[0].methods[0].versions[0].content='同一版本内被改写';await save();expect((await publish({},first.tutorial.version)).body.code).toBe('METHOD_SOURCE_VERSION_REUSED');
 const old=(await bob.get('/api/action-state')).body;const saved=await bob.put('/api/action-state').set('If-Match',old.revision).send({format:FORMAT,data:state});expect(saved.status).toBe(200);expect((await bob.post('/api/review-method-bindings').set('If-Match',saved.body.revision).send({nodeId:'personal',methodId:'method',sourceVersion:1,tutorialId:first.tutorial.id,tutorialVersion:first.tutorial.version})).status).toBe(404);
});
