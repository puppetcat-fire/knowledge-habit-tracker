const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {TREE,loadCatalog,installCatalog,resolveCatalogTarget}=require('./knowledge-catalog.cjs');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {methodSource,tutorialPayload,bindReceipt,practiceBinding}=require('./knowledge-version-mapping.cjs');
let directory;
beforeEach(()=>directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-catalog-')));
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected directory');fs.rmSync(directory,{recursive:true,force:true})});
it('preserves every prototype target, full goal, five-minute suggestion and relationship',()=>{
 const catalog=loadCatalog();expect(catalog.nodes).toHaveLength(31);expect(catalog.edges).toHaveLength(31);
 const eq=catalog.nodes.find(n=>n.originId==='eq');expect(eq.goal).toBe('求出未知数，并代回原方程验证等式成立。');
 expect(eq.five).toBe('从 2x + 3 = 11 开始，写下每一步变换。');expect(catalog.nodes.every(n=>n.ownership==='group'&&n.ownerId===null)).toBe(true);
 expect(catalog.edges.filter(e=>e.type==='instance-of')).toHaveLength(6);
});
it('does not equate changed goals or private targets with a public catalog identifier',()=>{
 const canonical=loadCatalog().nodes.find(n=>n.originId==='eq'),source={...canonical,id:'eq',version:1};
 expect(resolveCatalogTarget(source).nodeId).toBe('od-eq');
 for(const patch of [{goal:'另一个目标'},{visibility:'private'},{ownership:'personal'},{version:2},{id:'linear-equation'}])expect(()=>resolveCatalogTarget({...source,...patch})).toThrow();
});
it('preserves other private nodes and makes repeated installation byte-stable',()=>{
 const file=path.join(directory,'nodes.json'),own={id:'private-one',treeId:'own',visibility:'private',ownership:'personal',ownerId:'alice'};
 fs.writeFileSync(file,JSON.stringify({nodes:[own],edges:[],trees:[]}));installCatalog(file);const first=fs.readFileSync(file,'utf8');installCatalog(file);
 expect(fs.readFileSync(file,'utf8')).toBe(first);expect(JSON.parse(first).nodes[0]).toEqual(own);
});
it('preserves collisions and malformed or changed catalogs instead of resetting them',()=>{
 const file=path.join(directory,'nodes.json');fs.writeFileSync(file,'{damaged');expect(()=>installCatalog(file)).toThrow();expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
 const collision=JSON.stringify({nodes:[{id:'od-eq',goal:'自己的目标'}],edges:[],trees:[]});fs.writeFileSync(file,collision);expect(()=>installCatalog(file)).toThrow();expect(fs.readFileSync(file,'utf8')).toBe(collision);
 fs.unlinkSync(file);installCatalog(file);const modified=JSON.parse(fs.readFileSync(file));modified.nodes[0].goal='已修改目标';const raw=JSON.stringify(modified);fs.writeFileSync(file,raw);expect(()=>installCatalog(file)).toThrow();expect(fs.readFileSync(file,'utf8')).toBe(raw);
});
it('exposes the exact catalog to authenticated accounts while retaining collective ownership',async()=>{
 const app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app,alice=request.agent(app);
 await alice.post('/api/register').send({name:'catalog-alice',password:'test-only-2026'});
 const result=await alice.get('/api/nodes');expect(result.body.nodes.filter(n=>n.treeId===TREE)).toHaveLength(31);
 expect((await alice.patch('/api/nodes/od-eq').send({title:'个人改写公共目标'})).status).toBe(403);
 const holders=await alice.get('/api/holders').query({treeId:TREE,nodeId:'od-eq'});expect(holders.body.ownership).toBe('group');
 expect((await request(app).get('/api/nodes')).status).toBe(401);
});
it('supports actual method publication and another account practice on the exact mapped target and immutable version',async()=>{
 const app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;
 const alice=request.agent(app),bob=request.agent(app);
 await alice.post('/api/register').send({name:'mapping-alice',password:'test-only-2026'});
 await bob.post('/api/register').send({name:'mapping-bob',password:'test-only-2026'});
 const canonical=loadCatalog().nodes.find(n=>n.originId==='eq');
 const ref=resolveCatalogTarget({...canonical,id:'eq',version:1});
 const scope={treeId:ref.treeId,nodeId:ref.nodeId};
 expect((await alice.post('/api/records').send({...scope,text:'求解并代回确认等式成立。',lightUp:true,visibility:'private'})).status).toBe(201);
 const localNode={...canonical,id:'eq',version:1},localMethod={id:'method-alice-original',title:'从代回验证开始',author:'mapping-alice',versions:[{number:1,created:0,content:'解出未知数，代回等式两边检验。',five:'从2x+3=11开始。',resource:''}]};
 const source=methodSource(localNode,localMethod,1);
 const created=await alice.post('/api/tutorials').send(tutorialPayload(source,'public'));
 expect(created.status).toBe(201);const tutorial=created.body.tutorial;
 expect((await bob.get('/api/tutorials').query(scope)).body.tutorials[0].id).toBe(tutorial.id);
 const owner=(await alice.get('/api/me')).body.user.id,binding=bindReceipt(source,tutorial,owner);
 const localEvent={id:'mapping-bob-practice',startedAt:0,endedAt:1000,segments:[{start:0,end:1000}],knowledge:{nodeId:'eq',nodeTitle:localNode.title,nodeGoal:localNode.goal,nodeVersion:1,methodId:localMethod.id,methodTitle:localMethod.title,version:1,content:source.source.content,five:source.source.five,resource:source.source.resource}};
 const mappedPractice=practiceBinding(localEvent,binding);
 const practice=await bob.post('/api/records').send({...mappedPractice,text:'按原方法完成检验。',lightUp:true});
 expect(practice.status).toBe(201);expect(practice.body.record.tutorialVersion).toBe(tutorial.version);
 const updated=await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send({method:'补充对两侧做同一运算的理由。'});
 expect(updated.status).toBe(200);expect(updated.body.tutorial.version).not.toBe(tutorial.version);
 expect((await bob.get('/api/tutorials/'+tutorial.id+'/versions/'+tutorial.version)).body.tutorial.method).toBe(tutorial.method);
 expect((await bob.get('/api/records').query(scope)).body.records.find(r=>r.id===practice.body.record.id).tutorialVersion).toBe(tutorial.version);
 expect(practiceBinding(localEvent,binding).sourceSnapshot).toEqual(localEvent.knowledge);
});
