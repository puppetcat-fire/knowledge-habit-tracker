const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {FORMAT}=require('./action-state.cjs');
const {loadCatalog,TREE}=require('./knowledge-catalog.cjs');
const {sharedMethod}=require('./knowledge-version-mapping.cjs');
let directory,app,alice,bob,node,state,revision,tutorial;
const resources=[{label:'练习材料',url:'https://example.com/practice',affiliate:false,optional:false},{label:'补充材料',url:'https://example.com/extra',affiliate:true,optional:true}];
async function save(){const current=(await bob.get('/api/action-state')).body;const r=await bob.put('/api/action-state').set('If-Match',current.revision).send({format:FORMAT,data:state});expect(r.status).toBe(200);revision=r.body.revision;return revision}
function load(agent=bob,rev=revision,id='eq'){return agent.get('/api/review-shared-methods').query({nodeId:id}).set('If-Match',rev)}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-shared-methods-'));
 app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;
 alice=request.agent(app);bob=request.agent(app);
 await alice.post('/api/register').send({name:'shared-alice',password:'test-only-2026'});
 await bob.post('/api/register').send({name:'shared-bob',password:'test-only-2026'});
 node={...loadCatalog().nodes.find(n=>n.originId==='eq'),id:'eq',version:1,methods:[]};
 state={schema:1,mode:'local-simulation',nodes:[node],events:[],activeId:null,habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{}};
 await save();await alice.post('/api/records').send({treeId:TREE,nodeId:'od-eq',text:'已完成求解和检验。',lightUp:true,visibility:'private'});
 const r=await alice.post('/api/tutorials').send({treeId:TREE,nodeId:'od-eq',title:'代回检验',method:'求解再代回。',startAction:'从2x+3=11开始。',resources,visibility:'public'});
 expect(r.status).toBe(201);tutorial=r.body.tutorial;
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected test directory');fs.rmSync(directory,{recursive:true,force:true})});
it('reads the latest repeated public content while retaining the earlier selected practice snapshot',async()=>{
 const file=path.join(directory,'tutorials.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data[0].versions[0].createdAt='2024-01-01T00:00:00.000Z';fs.writeFileSync(file,JSON.stringify(data));const first=(await load()).body.tutorials[0],selected=sharedMethod(node,first),snapshot=JSON.stringify(selected);
 const changed=await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send({method:'另一种检验方法。'});expect(changed.status).toBe(200);const restored=await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',changed.body.tutorial.version).send({method:tutorial.method});expect(restored.status).toBe(200);expect(restored.body.tutorial.version).toBe(tutorial.version);
 const read=(await load()).body.tutorials[0];expect(read.createdAt).toBe(restored.body.tutorial.versions.at(-1).createdAt);expect(read.createdAt).not.toBe(first.createdAt);expect(read.resources).toEqual(resources);expect(JSON.stringify(selected)).toBe(snapshot);expect(restored.body.tutorial.versions[0].createdAt).toBe(first.createdAt);
 const searched=(await bob.get('/api/review-public-tutorials/one').query({id:tutorial.id})).body.tutorial;expect(searched.createdAt).toBe(read.createdAt);expect(searched.version).toBe(read.version);
});
it('reads another author’s exact public version, preserves every resource flag and excludes private material',async()=>{
 await alice.post('/api/tutorials').send({treeId:TREE,nodeId:'od-eq',title:'私人备注',method:'仅自己可读。',startAction:'仅自己使用。',resources:[],visibility:'private'});
 const r=await load();expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(r.body.tutorials).toHaveLength(1);
 expect(r.body.tutorials[0].resources).toEqual(resources);expect(r.body.tutorials[0].authorName).toBe('shared-alice');expect(r.body.tutorials[0].version).toBe(tutorial.version);
 expect(JSON.stringify(r.body)).not.toContain('私人备注');expect(r.body.target.goal).toBe(node.goal);
});
it('requires the authenticated actor and reviewed current action revision',async()=>{
 expect((await load(request(app))).status).toBe(401);
 expect((await bob.get('/api/review-shared-methods').query({nodeId:'eq'})).status).toBe(428);
 expect((await load().set('X-Action-Account','another')).status).toBe(409);
 const old=revision;state.nodes[0].methods=[];state.templates.reading={text:'本人的新备注',steps:[]};await save();expect((await load(bob,old)).body.code).toBe('ACTION_CONFLICT');
});
it('rejects a changed full goal or a different source version rather than matching a name',async()=>{
 node.goal='相同标题下的另一目标';await save();expect((await load()).body.code).toBe('SHARED_TARGET_MISMATCH');
 node.goal=loadCatalog().nodes.find(n=>n.originId==='eq').goal;node.version=2;await save();expect((await load()).status).toBe(409);
});
it('creates a distinct immutable reference for each service version, keeping the first selected snapshot',async()=>{
 const first=sharedMethod(node,(await load()).body.tutorials[0]),original=JSON.stringify(first);
 const updated=await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send({method:'修订后的求解和检验步骤。'});expect(updated.status).toBe(200);
 const second=sharedMethod(node,(await load()).body.tutorials[0]);
 expect(first.id).not.toBe(second.id);expect(JSON.stringify(first)).toBe(original);expect(second.serviceReference.version).toBe(updated.body.tutorial.version);
 expect(first.versions[0].resourceLinks).toEqual(resources);expect(first.serviceReference.authorId).toBe(tutorial.authorId);
});
it('stops listing a withdrawn tutorial without rewriting already selected private snapshots',async()=>{
 const first=sharedMethod(node,(await load()).body.tutorials[0]);
 expect((await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send({visibility:'private'})).status).toBe(200);
 expect((await load()).body.tutorials).toHaveLength(0);expect(first.versions[0].content).toBe('求解再代回。');
});
it('persists a peer-method practice with all original links and author identity while keeping private notes out',async()=>{
 const method=sharedMethod(node,(await load()).body.tutorials[0]),v=method.versions[0];node.methods.push(method);
 const knowledge={nodeId:node.id,nodeTitle:node.title,nodeGoal:node.goal,nodeVersion:1,methodId:method.id,methodTitle:method.title,version:1,content:v.content,five:v.five,resource:v.resource,resourceLinks:v.resourceLinks,privateMemo:'不应共享的内部附注'};
 state.events.push({id:'peer-practice',name:'求解并检验',startedAt:0,endedAt:1000,segments:[{start:0,end:1000}],steps:[],stepDone:{},draft:'本次私人草稿',notes:[],knowledge});await save();
 const binding=await bob.post('/api/review-method-bindings').set('If-Match',revision).send({nodeId:'eq',methodId:method.id,sourceVersion:1,tutorialId:tutorial.id,tutorialVersion:tutorial.version});expect(binding.status).toBe(201);
 const practice=await bob.post('/api/review-practices').set('If-Match',revision).send({eventId:'peer-practice',tutorialId:tutorial.id,tutorialVersion:tutorial.version,visibility:'private'});expect(practice.status).toBe(201);
 const snapshot=practice.body.record.sourceSnapshot;expect(snapshot.resourceLinks).toEqual(resources);expect(snapshot.methodAuthor).toBe('shared-alice');expect(snapshot.serviceReference.version).toBe(tutorial.version);
 expect(JSON.stringify(practice.body.record)).not.toContain('内部附注');expect(JSON.stringify(practice.body.record)).not.toContain('私人草稿');
 expect((await bob.get('/api/review-practices')).body.receipts[0].sourceSnapshot.privateMemo).toBe('不应共享的内部附注');
});
it('preserves damaged tutorial bytes and returns no fabricated methods',async()=>{
 const file=path.join(directory,'tutorials.json');fs.writeFileSync(file,'{damaged');expect((await load()).status).toBe(500);expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
});
