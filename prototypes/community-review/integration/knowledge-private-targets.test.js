const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {FORMAT}=require('./action-state.cjs');
const {commitTransaction,atomicJson}=require('../../../storage-transaction');
let directory,app,alice,bob,state,revision,ownerId,fail;
function options(){return {dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false,privateTargetCommit:(dir,entries)=>commitTransaction(dir,entries,(file,value)=>{if(fail&&file.includes('private-target-bindings')){fail=false;throw Error('Test interrupted private target receipt')}atomicJson(file,value)})}}
async function save(agent=alice){const old=(await agent.get('/api/action-state')).body;const r=await agent.put('/api/action-state').set('If-Match',old.revision).send({format:FORMAT,data:state});expect(r.status).toBe(200);revision=r.body.revision;return revision}
async function submit(extra={},agent=alice,rev=revision){let q=agent.post('/api/review-private-targets').set('If-Match',rev);const current=(await agent.get('/api/review-private-targets')).body.current?.find(r=>r.originId==='private-origin');if(current)q=q.set('If-Target-Match',current.revision);return q.send({nodeId:'private-origin',sourceVersion:state.nodes[0].version,...extra})}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-private-target-'));fail=false;app=createAuthenticatedActionApp(options()).app;alice=request.agent(app);bob=request.agent(app);ownerId=(await alice.post('/api/register').send({name:'private-target-alice',password:'test-only-2026'})).body.user.id;await bob.post('/api/register').send({name:'private-target-bob',password:'test-only-2026'});
 state={schema:1,mode:'local-simulation',nodes:[{id:'private-origin',title:'本人私人目标',goal:'完成属于本人的完整私人作品。',five:'先画一张草图。',domain:'个人创造',branch:'原型',ownership:'personal',visibility:'private',version:1,methods:[],versions:[]}],events:[],activeId:null,habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{}};await save();
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected test directory');fs.rmSync(directory,{recursive:true,force:true})});
it('creates an actual privately owned service node and keeps it out of other account node and tree listings',async()=>{
 const r=await submit();expect(r.status).toBe(201);expect(r.body.binding.ref.ownerId).toBe(ownerId);expect(r.body.binding.target.goal).toBe(state.nodes[0].goal);
 const own=(await alice.get('/api/nodes')).body;expect(own.nodes.find(n=>n.id===r.body.binding.ref.nodeId).goal).toBe(state.nodes[0].goal);expect(own.trees.find(t=>t.id===r.body.binding.ref.treeId).visibility).toBe('private');
 const other=(await bob.get('/api/nodes')).body;expect(other.nodes.some(n=>n.id===r.body.binding.ref.nodeId)).toBe(false);expect(other.trees.some(t=>t.id===r.body.binding.ref.treeId)).toBe(false);expect((await bob.get('/api/review-private-targets')).body.bindings).toHaveLength(0);
});
it('keeps retries stable and preserves the registry after app restart',async()=>{
 const first=(await submit()).body,file=path.join(directory,'private-target-bindings',ownerId+'.json'),before=fs.readFileSync(file,'utf8');expect((await submit()).body.repeated).toBe(true);expect(fs.readFileSync(file,'utf8')).toBe(before);
 const fresh=request.agent(createAuthenticatedActionApp(options()).app);await fresh.post('/api/login').send({name:'private-target-alice',password:'test-only-2026'});expect((await fresh.get('/api/review-private-targets')).body.bindings[0]).toEqual(first.binding);
});
it('keeps old full targets while mapping explicit new versions to the same private service identity',async()=>{
 const first=(await submit()).body.binding;state.nodes[0].version=2;state.nodes[0].goal='明确修订的第二版完整目标。';await save();const second=(await submit()).body.binding;
 expect(second.ref.nodeId).toBe(first.ref.nodeId);expect(second.ref.targetVersion).not.toBe(first.ref.targetVersion);const registry=(await alice.get('/api/review-private-targets')).body;expect(registry.bindings[0]).toEqual(first);expect(registry.current[0].node.versions.map(v=>v.goal)).toEqual(['完成属于本人的完整私人作品。','明确修订的第二版完整目标。']);
});
it('refuses overwritten source versions and stale action revisions without losing old bytes',async()=>{
 await submit();const file=path.join(directory,'private-target-bindings',ownerId+'.json'),before=fs.readFileSync(file,'utf8'),old=revision;state.nodes[0].goal='同一版本内被改写';await save();expect((await submit({},alice,old)).body.code).toBe('ACTION_CONFLICT');expect((await submit()).body.code).toBe('PRIVATE_TARGET_VERSION_REUSED');expect(fs.readFileSync(file,'utf8')).toBe(before);
});
it('does not overwrite a concurrent service edit and preserves that edit on an explicit new-version save',async()=>{
 const first=(await submit()).body.binding,old=(await alice.get('/api/review-private-targets')).body.current[0];expect((await alice.patch('/api/nodes/'+first.ref.nodeId).send({goal:'另一窗口的服务编辑'})).status).toBe(200);
 expect((await alice.post('/api/review-private-targets').set('If-Match',revision).set('If-Target-Match',old.revision).send({nodeId:'private-origin',sourceVersion:1})).body.code).toBe('PRIVATE_TARGET_CONFLICT');expect((await submit()).body.code).toBe('PRIVATE_TARGET_DIVERGED');
 state.nodes[0].version=2;state.nodes[0].goal='重新核对后明确修订的目标';await save();expect((await submit()).status).toBe(201);expect((await alice.get('/api/review-private-targets')).body.current[0].node.versions.some(v=>v.kind==='external-service-edit'&&v.goal==='另一窗口的服务编辑')).toBe(true);
});
it('rejects caller-supplied ownership and isolates identical source ids in different accounts',async()=>{
 const first=(await submit()).body.binding;expect((await submit({ownerId:'another'})).status).toBe(400);expect((await request(app).get('/api/review-private-targets')).status).toBe(401);expect((await alice.get('/api/review-private-targets').set('X-Action-Account','another')).status).toBe(409);
 const bobRevision=await save(bob),second=(await submit({},bob,bobRevision)).body.binding;expect(second.ref.nodeId).not.toBe(first.ref.nodeId);expect(second.ref.treeId).not.toBe(first.ref.treeId);
});
it('recovers an interrupted node-and-registry transaction before returning a confirmed read',async()=>{
 fail=true;const result=await submit();expect(result.status).toBe(500);expect(result.body.code).toBe('PRIVATE_TARGET_COMMIT_UNCONFIRMED');expect(fs.existsSync(path.join(directory,'restore-journal.json'))).toBe(true);expect((await alice.get('/api/review-private-targets')).body.bindings).toHaveLength(1);expect(fs.existsSync(path.join(directory,'restore-journal.json'))).toBe(false);expect((await submit()).body.repeated).toBe(true);
});
it('preserves a damaged registry and rejects further writes',async()=>{
 await submit();const file=path.join(directory,'private-target-bindings',ownerId+'.json');fs.writeFileSync(file,'{damaged');expect((await alice.get('/api/review-private-targets')).status).toBe(500);expect((await submit()).status).toBe(500);expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
});
it('saves independent private-target practice without tutorial references and never exposes it to another account',async()=>{
 const bound=(await submit()).body.binding,n=state.nodes[0],k={nodeId:n.id,nodeTitle:n.title,nodeGoal:n.goal,nodeVersion:n.version,five:n.five,nodeDomain:n.domain,nodeBranch:n.branch,nodeOwnership:n.ownership,nodeVisibility:n.visibility,methodId:null,methodTitle:'独立尝试',version:null,content:'',resource:''};
 state.events=[{id:'private-event',name:n.title,startedAt:0,endedAt:1000,segments:[{start:0,end:1000}],steps:[],stepDone:{},draft:'私人草稿',notes:[],knowledge:k}];state.lights=[{id:'private-light',eventId:'private-event',nodeId:n.id,confirmed:true,public:true,result:'本人的完成结果',evidence:'本人的私人证据'}];await save();
 const body={eventId:'private-event',practiceMode:'independent',tutorialId:null,tutorialVersion:null,visibility:'private',lightId:'private-light'},saved=await alice.post('/api/review-practices').set('If-Match',revision).send(body);expect(saved.status).toBe(201);expect(saved.body.record.nodeId).toBe(bound.ref.nodeId);expect(saved.body.record.targetVersion).toBe(bound.ref.targetVersion);expect(saved.body.record.tutorialId).toBeNull();
 expect((await alice.post('/api/review-practices').set('If-Match',revision).send({...body,visibility:'public'})).status).toBe(403);expect((await bob.get('/api/records')).body.records).toHaveLength(0);
 n.version=2;n.goal='后来的私人目标';await save();expect((await submit()).status).toBe(201);const old=(await alice.post('/api/review-practices').set('If-Match',revision).send(body)).body.record;expect(old.targetVersion).toBe(bound.ref.targetVersion);expect(old.sourceSnapshot.nodeGoal).toBe(k.nodeGoal);
});
