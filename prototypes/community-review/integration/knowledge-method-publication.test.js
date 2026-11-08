const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {loadCatalog,TREE}=require('./knowledge-catalog.cjs');
const {FORMAT}=require('./action-state.cjs');
const {commitTransaction,atomicJson}=require('../../../storage-transaction');
let directory,app,alice,bob,state,revision,ownerId,failBinding;
async function save(){const old=(await alice.get('/api/action-state')).body.revision;const r=await alice.put('/api/action-state').set('If-Match',old).send({format:FORMAT,data:state});expect(r.status).toBe(200);revision=r.body.revision}
const input=(visibility='private',extra={})=>({nodeId:'eq',methodId:'own-method',sourceVersion:state.nodes[0].methods[0].versions.at(-1).number,visibility,...extra});
async function publish(body=input(),expectedMethod){let r=alice.post('/api/review-method-publications').set('If-Match',revision);if(expectedMethod)r=r.set('If-Method-Match',expectedMethod);return r.send(body)}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-publish-method-'));failBinding=false;
 const methodPublicationCommit=(dir,entries)=>commitTransaction(dir,entries,(file,value)=>{if(failBinding&&file.includes('method-bindings')){failBinding=false;throw Error('Injected binding disk failure')}atomicJson(file,value)});
 app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false,methodPublicationCommit}).app;
 alice=request.agent(app);bob=request.agent(app);ownerId=(await alice.post('/api/register').send({name:'publisher-alice',password:'test-only-2026'})).body.user.id;
 await bob.post('/api/register').send({name:'publisher-bob',password:'test-only-2026'});
 const n={...loadCatalog().nodes.find(n=>n.originId==='eq'),id:'eq',version:1};n.methods=[{id:'own-method',title:'从代回开始',author:'publisher-alice',visibility:'private',versions:[{number:1,created:0,content:'求解后代回，检查两侧相等。',five:'从2x+3=11开始。',resource:''}]}];
 state={schema:1,mode:'local-simulation',habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{},activeId:null,nodes:[n],events:[{id:'practice',name:'独立验证',startedAt:0,endedAt:1000,segments:[{start:0,end:1000}],steps:[],stepDone:{},draft:'私人草稿',notes:[{id:'private-note',text:'不随方法公开的笔记',at:0}],knowledge:{nodeId:'eq',nodeTitle:n.title,nodeGoal:n.goal,nodeVersion:1,methodId:null,methodTitle:'独立尝试',version:null,content:'',five:n.five,resource:''}}],lights:[{id:'light',nodeId:'eq',eventId:'practice',confirmed:false,result:'解得x=4。',evidence:'代回验证两侧均为11。',public:false}]};await save();
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected directory');fs.rmSync(directory,{recursive:true,force:true})});
it('records a new publication occurrence when the same source is withdrawn and explicitly republished',async()=>{
 state.lights[0].confirmed=true;await save();const body=input('public',{publicConsent:true,lightId:'light'}),first=(await publish(body)).body,file=path.join(directory,'tutorials.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data[0].versions[0].createdAt='2024-01-01T00:00:00.000Z';fs.writeFileSync(file,JSON.stringify(data));const oldVersion=structuredClone(data[0].versions[0]),oldBinding=structuredClone(first.binding);
 const withdrawn=await publish(input('private'),first.tutorial.version);expect(withdrawn.status).toBe(200);expect((await bob.get('/api/review-public-tutorials')).body.total).toBe(0);const restored=await publish(body,withdrawn.body.tutorial.version);expect(restored.status).toBe(200);expect(restored.body.tutorial.version).toBe(first.tutorial.version);expect(restored.body.tutorial.versions).toHaveLength(3);expect(restored.body.tutorial.versions[0]).toEqual(oldVersion);
 const current=(await bob.get('/api/review-public-tutorials/one').query({id:first.tutorial.id})).body.tutorial;expect(current.createdAt).toBe(restored.body.tutorial.versions.at(-1).createdAt);expect(current.createdAt).not.toBe(oldVersion.createdAt);expect((await alice.get('/api/review-method-bindings')).body.bindings[0]).toEqual(oldBinding);const before=fs.readFileSync(file,'utf8'),retry=await publish(body);expect(retry.body.repeated).toBe(true);expect(fs.readFileSync(file,'utf8')).toBe(before);expect(retry.body.tutorial.versions).toHaveLength(3);
});
it('saves private methods and their source bindings without requiring light-up',async()=>{
 const r=await publish();expect(r.status).toBe(201);expect(r.body.tutorial.visibility).toBe('private');expect(r.body.binding.source.source.created).toBe(0);
 expect((await bob.get('/api/tutorials')).body.tutorials).toHaveLength(0);
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(1);
});
it('requires explicit public consent and a matching confirmed completed target',async()=>{
 expect((await publish(input('public',{publicConsent:true,lightId:'light'}))).status).toBe(403);
 state.lights[0].confirmed=true;await save();expect((await publish(input('public',{lightId:'light'}))).status).toBe(403);
 state.events[0].knowledge.nodeGoal='另一个目标';await save();expect((await publish(input('public',{publicConsent:true,lightId:'light'}))).status).toBe(403);
});
it('publishes using private self-confirmation without sharing evidence or action notes',async()=>{
 state.lights[0].confirmed=true;await save();const r=await publish(input('public',{publicConsent:true,lightId:'light'}));
 expect(r.status).toBe(201);expect(r.body.binding.confirmationSource.eventId).toBe('practice');
 const visible=(await bob.get('/api/tutorials')).body.tutorials;expect(visible).toHaveLength(1);expect(JSON.stringify(visible)).not.toContain(state.lights[0].evidence);expect(JSON.stringify(visible)).not.toContain('不随方法公开的笔记');
 expect((await bob.get('/api/records')).body.records).toHaveLength(0);
 const edited=await alice.patch('/api/tutorials/'+r.body.tutorial.id).set('If-Match',r.body.tutorial.version).send({title:'通过同一真实点亮门槛修改'});expect(edited.status).toBe(200);
});
it('keeps private historical versions hidden when the same source is explicitly published',async()=>{
 const first=(await publish()).body;state.lights[0].confirmed=true;await save();
 const publicBody=input('public',{publicConsent:true,lightId:'light'});
 expect((await publish(publicBody)).status).toBe(409);
 const published=await publish(publicBody,first.tutorial.version);expect(published.status).toBe(200);expect(published.body.tutorial.id).toBe(first.tutorial.id);
 expect((await bob.get('/api/tutorials/'+first.tutorial.id+'/versions/'+first.tutorial.version)).status).toBe(404);
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(2);
});
it('makes retry receipts stable and does not generate duplicate service methods',async()=>{
 const first=(await publish()).body,file=path.join(directory,'tutorials.json'),bytes=fs.readFileSync(file,'utf8');
 const repeat=await publish();expect(repeat.body.repeated).toBe(true);expect(repeat.body.tutorial.id).toBe(first.tutorial.id);expect(fs.readFileSync(file,'utf8')).toBe(bytes);
 expect((await alice.get('/api/review-method-publications')).body.tutorials).toHaveLength(1);
});
it('requires both source and method revisions while preserving old source mappings',async()=>{
 const first=(await publish()).body,oldRevision=revision,m=state.nodes[0].methods[0];m.title='新标题';m.versions.push({number:2,created:1000,content:'补充等式平衡的依据。',five:'写出运算理由。',resource:''});await save();
 expect((await alice.post('/api/review-method-publications').set('If-Match',oldRevision).send(input())).status).toBe(409);
 expect((await publish(input(),'stale-method')).status).toBe(409);
 const second=await publish(input(),first.tutorial.version);expect(second.status).toBe(200);expect(second.body.tutorial.id).toBe(first.tutorial.id);
 const bindings=(await alice.get('/api/review-method-bindings')).body.bindings;expect(bindings).toHaveLength(2);expect(bindings[0]).toEqual(first.binding);
});
it('rejects another author and credentials or replacement text supplied in the request',async()=>{
 state.nodes[0].methods[0].author='publisher-bob';await save();expect((await publish()).status).toBe(403);
 expect((await publish(input('private',{content:'越过已核对来源'}))).status).toBe(400);
 expect((await bob.post('/api/review-method-publications').set('X-Action-Account',ownerId).set('If-Match',revision).send(input())).status).toBe(409);
});
it('recovers interrupted method-and-binding writes before a reader observes the shared method',async()=>{
 state.lights[0].confirmed=true;await save();failBinding=true;const body=input('public',{publicConsent:true,lightId:'light'});
 expect((await publish(body)).body.code).toBe('METHOD_PUBLICATION_COMMIT_UNCONFIRMED');expect(fs.existsSync(path.join(directory,'restore-journal.json'))).toBe(true);
 expect((await bob.get('/api/tutorials')).body.tutorials).toHaveLength(1);expect(fs.existsSync(path.join(directory,'restore-journal.json'))).toBe(false);
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(1);
 expect((await publish(body)).body.repeated).toBe(true);
});
