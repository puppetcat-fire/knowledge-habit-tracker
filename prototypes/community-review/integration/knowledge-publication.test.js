const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
let directory,app,alice,bob,aliceId;
const method=extra=>({treeId:'k9-math',nodeId:'linear-equation',title:'等式实践',method:'对两侧做同一运算，再代回验证。',startAction:'写出一个等式。',...extra});
const evidence=extra=>({treeId:'k9-math',nodeId:'linear-equation',text:'我完成目标并留下自己的推导。',lightUp:true,...extra});
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-publication-'));
 app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;
 alice=request.agent(app);bob=request.agent(app);
 aliceId=(await alice.post('/api/register').send({name:'publication-alice',password:'test-only-2026'})).body.user.id;
 await bob.post('/api/register').send({name:'publication-bob',password:'test-only-2026'});
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected directory');fs.rmSync(directory,{recursive:true,force:true})});
it('allows private drafts but blocks direct public creation without personal confirmation',async()=>{
 expect((await alice.post('/api/tutorials').send(method())).status).toBe(201);
 const result=await alice.post('/api/tutorials').send(method({visibility:'public',lightUp:true,authorId:aliceId}));
 expect(result.status).toBe(403);expect(result.body.code).toBe('KNOWLEDGE_LIGHT_REQUIRED');
 expect((await bob.get('/api/tutorials')).body.tutorials).toHaveLength(0);
});
it('accepts personal private evidence without exposing that evidence to another reader',async()=>{
 expect((await alice.post('/api/records').send(evidence({visibility:'private'}))).status).toBe(201);
 expect((await alice.post('/api/tutorials').send(method({visibility:'public'}))).status).toBe(201);
 expect((await bob.get('/api/tutorials')).body.tutorials).toHaveLength(1);
 expect((await bob.get('/api/records')).body.records).toHaveLength(0);
});
it('does not borrow another account confirmation or confirmation on another target',async()=>{
 await bob.post('/api/records').send(evidence());
 await alice.post('/api/records').send(evidence({nodeId:'natural-numbers'}));
 expect((await alice.post('/api/tutorials').send(method({visibility:'public'}))).status).toBe(403);
});
it('does not treat a practice record without explicit light-up as confirmation',async()=>{
 await alice.post('/api/records').send(evidence({lightUp:false}));
 expect((await alice.post('/api/tutorials').send(method({visibility:'public'}))).status).toBe(403);
});
it('gates private-to-public updates and retains private historical version boundaries',async()=>{
 const created=(await alice.post('/api/tutorials').send(method())).body.tutorial;
 expect((await alice.patch('/api/tutorials/'+created.id).set('If-Match',created.version).send({visibility:'public'})).status).toBe(403);
 await alice.post('/api/records').send(evidence());
 const published=await alice.patch('/api/tutorials/'+created.id).set('If-Match',created.version).send({visibility:'public'});
 expect(published.status).toBe(200);expect(published.body.tutorial.authorId).toBe(aliceId);
 expect((await bob.get('/api/tutorials/'+created.id+'/versions/'+created.version)).status).toBe(404);
});
it('preserves published versions and rejects stale or non-author edits after confirmation',async()=>{
 await alice.post('/api/records').send(evidence());
 const created=(await alice.post('/api/tutorials').send(method({visibility:'public'}))).body.tutorial;
 const changed=await alice.patch('/api/tutorials/'+created.id).set('If-Match',created.version).send({method:'保留每一步依据，再验算。'});
 expect(changed.status).toBe(200);
 expect((await alice.patch('/api/tutorials/'+created.id).set('If-Match',created.version).send({title:'过时编辑'})).status).toBe(409);
 expect((await bob.patch('/api/tutorials/'+created.id).set('If-Match',changed.body.tutorial.version).send({title:'越权编辑'})).status).toBe(404);
 expect((await bob.get('/api/tutorials/'+created.id+'/versions/'+created.version)).body.tutorial.method).toBe(created.method);
});
it('preserves an unreadable evidence store and refuses to bypass publication checks',async()=>{
 const file=path.join(directory,'records.json'),raw='{damaged';fs.writeFileSync(file,raw);
 expect((await alice.post('/api/tutorials').send(method({visibility:'public'}))).status).toBe(503);
 expect(fs.readFileSync(file,'utf8')).toBe(raw);
 expect((await alice.post('/api/tutorials').send(method())).status).toBe(201);
});
it('allows withdrawing a method to private after its own evidence has been removed',async()=>{
 await alice.post('/api/records').send(evidence());
 const tutorial=(await alice.post('/api/tutorials').send(method({visibility:'public'}))).body.tutorial;
 fs.writeFileSync(path.join(directory,'records.json'),'[]');
 const result=await alice.patch('/api/tutorials/'+tutorial.id).set('If-Match',tutorial.version).send({visibility:null});
 expect(result.status).toBe(200);expect(result.body.tutorial.visibility).toBe('private');
 expect((await bob.get('/api/tutorials')).body.tutorials).toHaveLength(0);
});
it('rejects an expected-account mismatch even for a private save',async()=>{
 const response=await alice.post('/api/tutorials').set('X-Action-Account','different-account').send(method());
 expect(response.status).toBe(409);expect(response.body.code).toBe('ACTION_ACCOUNT_CHANGED');
 expect((await alice.get('/api/tutorials')).body.tutorials).toHaveLength(0);
});
it('rejects unauthenticated publishing and foreign-origin tutorial writes',async()=>{
 expect((await request(app).post('/api/tutorials').send(method({visibility:'public'}))).status).toBe(401);
 expect((await alice.post('/api/tutorials').set('Origin','https://foreign.example').send(method())).status).toBe(403);
});
