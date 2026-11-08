const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {FORMAT}=require('./action-state.cjs');
const {loadCatalog,TREE}=require('./knowledge-catalog.cjs');
const {methodSource,tutorialPayload}=require('./knowledge-version-mapping.cjs');
let directory,app,alice,bob,aliceId,state,tutorial,revision;
const options=()=>({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false});
async function saveState(agent,data){const current=(await agent.get('/api/action-state')).body;const result=await agent.put('/api/action-state').set('If-Match',current.revision).send({format:FORMAT,data});expect(result.status).toBe(200);return result.body.revision}
function body(extra={}){return {nodeId:'eq',methodId:'local-method',sourceVersion:1,tutorialId:tutorial.id,tutorialVersion:tutorial.version,...extra}}
async function bind(agent=alice,rev=revision,input=body()){return agent.post('/api/review-method-bindings').set('If-Match',rev).send(input)}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-bindings-'));app=createAuthenticatedActionApp(options()).app;
 alice=request.agent(app);bob=request.agent(app);aliceId=(await alice.post('/api/register').send({name:'binding-alice',password:'test-only-2026'})).body.user.id;
 await bob.post('/api/register').send({name:'binding-bob',password:'test-only-2026'});
 const node={...loadCatalog().nodes.find(n=>n.originId==='eq'),id:'eq',version:1};
 node.methods=[{id:'local-method',title:'原方法',author:'binding-alice',visibility:'private',versions:[{number:1,created:0,content:'求解，再代回原等式。',five:'从2x+3=11开始。',resource:''}]}];
 state={schema:1,mode:'local-simulation',events:[],activeId:null,habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{},nodes:[node]};
 revision=await saveState(alice,state);
 tutorial=(await alice.post('/api/tutorials').send(tutorialPayload(methodSource(node,node.methods[0],1)))).body.tutorial;
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected directory');fs.rmSync(directory,{recursive:true,force:true})});
it('persists complete source mappings across app restart and makes retries byte-stable',async()=>{
 const result=await bind();expect(result.status).toBe(201);expect(result.body.binding.source.source.created).toBe(0);
 const file=path.join(directory,'method-bindings',aliceId+'.json'),bytes=fs.readFileSync(file,'utf8');
 expect((await bind()).body.repeated).toBe(true);expect(fs.readFileSync(file,'utf8')).toBe(bytes);
 const restarted=createAuthenticatedActionApp(options()).app;
 // Re-authenticate through the actual account API on the fresh app.
 const fresh=request.agent(restarted);await fresh.post('/api/login').send({name:'binding-alice',password:'test-only-2026'});
 expect((await fresh.get('/api/review-method-bindings')).body.bindings[0]).toEqual(result.body.binding);
});
it('requires the reviewed action revision and leaves old bindings unchanged on source conflict',async()=>{
 await bind();const file=path.join(directory,'method-bindings',aliceId+'.json'),bytes=fs.readFileSync(file,'utf8');
 state.nodes[0].methods[0].title='后来的标题';await saveState(alice,state);
 const result=await bind();expect(result.status).toBe(409);expect(result.body.code).toBe('ACTION_CONFLICT');
 expect(fs.readFileSync(file,'utf8')).toBe(bytes);
 expect((await alice.post('/api/review-method-bindings').send(body())).status).toBe(428);
});
it('rejects mismatched receipt content and caller-supplied account data',async()=>{
 state.nodes[0].methods[0].versions[0].content='另一份内容';revision=await saveState(alice,state);
 expect((await bind()).status).toBe(400);
 expect((await bind(alice,revision,body({authorId:aliceId}))).status).toBe(400);
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(0);
});
it('keeps private tutorial versions and mapping stores scoped to the actual authenticated reader',async()=>{
 await bind();const bobRevision=await saveState(bob,state);
 expect((await bind(bob,bobRevision)).status).toBe(404);
 expect((await bob.get('/api/review-method-bindings')).body.bindings).toHaveLength(0);
 expect((await request(app).get('/api/review-method-bindings')).status).toBe(401);
 expect((await alice.get('/api/review-method-bindings').set('X-Action-Account','another')).status).toBe(409);
});
it('allows another reader to bind a published method to their own private action archive',async()=>{
 await alice.post('/api/records').send({treeId:TREE,nodeId:'od-eq',text:'我确认完成目标。',lightUp:true,visibility:'private'});
 tutorial=(await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send({visibility:'public'})).body.tutorial;
 const bobRevision=await saveState(bob,state);expect((await bind(bob,bobRevision)).status).toBe(201);
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(0);
 expect((await bob.get('/api/review-method-bindings')).body.bindings[0].service.authorId).toBe(aliceId);
});
it('adds a new version mapping without overwriting the old immutable source',async()=>{
 const first=(await bind()).body.binding,method=state.nodes[0].methods[0];
 method.title='第二版方法';method.versions.push({number:2,created:1000,content:'先说明依据，再求解。',five:'写出等式平衡的理由。',resource:''});
 revision=await saveState(alice,state);const payload=tutorialPayload(methodSource(state.nodes[0],method,2));
 tutorial=(await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send(payload)).body.tutorial;
 expect((await bind(alice,revision,body({sourceVersion:2}))).status).toBe(201);
 const mappings=(await alice.get('/api/review-method-bindings')).body.bindings;expect(mappings).toHaveLength(2);expect(mappings[0]).toEqual(first);
});
it('preserves unreadable mapping bytes and blocks further writes',async()=>{
 await bind();const file=path.join(directory,'method-bindings',aliceId+'.json');fs.writeFileSync(file,'{damaged');
 expect((await alice.get('/api/review-method-bindings')).status).toBe(500);expect((await bind()).status).toBe(500);
 expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
});
it('does not overwrite a source version when its content is reused under the same integer number',async()=>{
 const first=(await bind()).body.binding,method=state.nodes[0].methods[0];
 method.versions[0].content='同一数字下被改写的内容';revision=await saveState(alice,state);
 tutorial=(await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send(tutorialPayload(methodSource(state.nodes[0],method,1)))).body.tutorial;
 const result=await bind();expect(result.status).toBe(409);expect(result.body.code).toBe('METHOD_SOURCE_VERSION_REUSED');
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toEqual([first]);
});
it('preserves unreadable tutorial data instead of constructing a mapping from guessed content',async()=>{
 const file=path.join(directory,'tutorials.json');fs.writeFileSync(file,'{damaged');
 expect((await bind()).status).toBe(500);expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
 expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(0);
});
