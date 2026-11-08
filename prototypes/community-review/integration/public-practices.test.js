const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');const {FORMAT}=require('./action-state.cjs');const {loadCatalog}=require('./knowledge-catalog.cjs');
let directory,app,author,reader,revision,owner;const target={treeId:'dianliang-review-catalog-v1',nodeId:'od-eq'};
beforeEach(async()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-public-practice-'));app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;author=request.agent(app);reader=request.agent(app);owner=(await author.post('/api/register').send({name:'实践作者',password:'test-only-2026'})).body.user.id;await reader.post('/api/register').send({name:'实践读者',password:'test-only-2026'});const n={...loadCatalog().nodes.find(n=>n.originId==='eq'),id:'eq',version:1,methods:[]},knowledge={nodeId:'eq',nodeTitle:n.title,nodeGoal:n.goal,nodeVersion:1,five:n.five,nodeDomain:n.domain,nodeBranch:n.branch,nodeOwnership:n.ownership,nodeVisibility:n.visibility,methodId:null,methodTitle:'独立尝试',version:null,content:'',resource:'',privateMemo:'PRIVATE-MEMO'};const state={schema:1,mode:'local-simulation',activeId:null,habitId:'h',habits:[{id:'h',name:'阅读',formedAt:null}],templates:{},nodes:[n],events:[{id:'e',name:n.title,startedAt:0,endedAt:1000,segments:[{start:0,end:300},{start:600,end:1000}],steps:[],stepDone:{},draft:'PRIVATE-DRAFT',notes:[{id:'n',text:'PRIVATE-NOTE',at:900}],knowledge}],lights:[{id:'light',eventId:'e',nodeId:'eq',confirmed:true,public:true,result:'求得x=4',evidence:'代回成立'}]};const old=(await author.get('/api/action-state')).body;revision=(await author.put('/api/action-state').set('If-Match',old.revision).send({format:FORMAT,data:state})).body.revision});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected fixture');fs.rmSync(directory,{recursive:true,force:true})});
async function publish(visibility='public',previous){let q=author.post('/api/review-practices').set('If-Match',revision);if(previous)q=q.set('If-Practice-Match',previous);return q.send({eventId:'e',practiceMode:'independent',tutorialId:null,tutorialVersion:null,lightId:'light',visibility})}
it('returns only disclosed practice fields with exact activity and hides private drafts before public consent',async()=>{
 const first=await publish('private');expect(first.status).toBe(201);expect((await reader.get('/api/review-public-practices')).body.total).toBe(0);expect((await publish('public',first.body.recordRevision)).status).toBe(200);const r=await reader.get('/api/review-public-practices');expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(r.body.total).toBe(1);const entry=r.body.practices[0];expect(entry.snapshotStatus).toBe('bound');expect(entry.independent).toBe(true);expect(entry.snapshot.nodeGoal).toBeTruthy();expect(entry.activity).toEqual({actualMilliseconds:700,segmentCount:2});expect(JSON.stringify(r.body)).not.toContain('PRIVATE-');for(const field of ['eventId','sourceSnapshot','sourceFingerprint','recordRevision'])expect(entry).not.toHaveProperty(field);expect(entry.activity).not.toHaveProperty('startedAt');
});
it('reads a current public practice and target without exposing a withdrawn record through the direct entry',async()=>{
 const saved=await publish();expect(saved.status).toBe(201);const url='/api/review-public-practices/one';let r=await reader.get(url).query({id:saved.body.record.id});expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(r.body.practice.currentTarget.originId).toBe('eq');expect(r.body.practice.kind).toBe('catalog');expect(JSON.stringify(r.body)).not.toContain('PRIVATE-');expect((await request(app).get(url).query({id:saved.body.record.id})).status).toBe(401);expect((await reader.get(url).set('X-Action-Account',owner).query({id:saved.body.record.id})).status).toBe(409);expect((await reader.get(url).query({id:['a','b']})).status).toBe(400);expect((await author.patch('/api/records/'+saved.body.record.id).send({visibility:'private'})).status).toBe(200);expect((await reader.get(url).query({id:saved.body.record.id})).status).toBe(404);
});
it('finds practices by the public target even when the record has no knowledge snapshot',async()=>{
 const publicRecord=await author.post('/api/records').send({...target,text:'练习完成',visibility:'public'});
 expect(publicRecord.status).toBe(201);
 expect((await author.post('/api/records').send({...target,text:'私人练习完成',visibility:'private'})).status).toBe(201);
 const node=loadCatalog().nodes.find(n=>n.id===target.nodeId);
 for(const query of [node.title,node.goal,node.goal+'　实践作者']){
  const result=await reader.get('/api/review-public-practices').query({query});
  expect(result.status).toBe(200);
  expect(result.body.practices.map(p=>p.id)).toEqual([publicRecord.body.record.id]);
  expect(result.body.practices[0].snapshotStatus).toBe('unverified');
 }
});
it('keeps complete source receipts on the author side while main discovery returns only disclosed record fields', async () => {
 const saved = await publish();
 expect(saved.status).toBe(201);
 const id = saved.body.record.id;
 const detail = '/api/records/' + id;
 const ownerView = (await author.get(detail).expect(200)).body;
 expect(ownerView.record.sourceSnapshot).toEqual(saved.body.record.sourceSnapshot);
 await author.patch(detail + '/text').set('X-Action-Account', owner).set('If-Match', ownerView.revision)
  .send({ text: '补充了实践细节' }).expect(200);
 for (const record of [
  (await reader.get(detail).expect(200)).body.record,
  (await author.get('/api/records').query({ scope: 'public' }).expect(200)).body.records.find(item => item.id === id),
  (await reader.get('/api/records').query({ scope: 'public' }).expect(200)).body.records.find(item => item.id === id),
  (await reader.get('/api/profiles/' + owner).expect(200)).body.records.find(item => item.id === id)
 ]) {
  expect(record.text).toBe('补充了实践细节');
  expect(record).not.toHaveProperty('sourceSnapshot');
  expect(record).not.toHaveProperty('sourceFingerprint');
 }
 const reviewed = (await reader.get('/api/review-public-practices/one').query({ id }).expect(200)).body.practice;
 expect(reviewed.snapshotStatus).toBe('bound');
 expect(reviewed.snapshot.nodeGoal).toBe(saved.body.record.sourceSnapshot.nodeGoal);
 expect((await author.get('/api/review-practices').expect(200)).body.receipts[0].record).toEqual(saved.body.record);
 const readerId = (await reader.get('/api/me').expect(200)).body.user.id;
 fs.writeFileSync(path.join(directory, 'practice-receipts', readerId + '.json'), '{damaged');
 await reader.get('/api/records').expect(500);
 await reader.get('/api/records').query({ scope: 'public' }).expect(200);
});
it('filters public practices by the exact author and binds cursors to that author scope',async()=>{
 expect((await publish()).status).toBe(201);expect((await author.post('/api/records').send({...target,text:'作者第二次实践',visibility:'public',lightUp:false})).status).toBe(201);const peer=(await reader.post('/api/records').send({...target,text:'读者本人公开实践',visibility:'public',lightUp:false})).body.record;const all=(await reader.get('/api/review-public-practices').query({limit:1})).body;expect(all.total).toBe(3);const filtered=(await reader.get('/api/review-public-practices').query({authorId:owner,limit:1})).body;expect(filtered.total).toBe(2);expect(filtered.authorId).toBe(owner);expect(filtered.practices.every(p=>p.authorId===owner)).toBe(true);expect((await reader.get('/api/review-public-practices').query({authorId:owner,limit:1,cursor:all.nextCursor})).status).toBe(409);const second=(await reader.get('/api/review-public-practices').query({authorId:owner,limit:1,cursor:filtered.nextCursor})).body;expect(second.practices).toHaveLength(1);expect(second.practices[0].id).not.toBe(peer.id);expect((await reader.get('/api/review-public-practices').query({authorId:owner,query:'不存在'})).body.total).toBe(0);for(const authorId of [['a','b'],'../private','x'.repeat(65)])expect((await reader.get('/api/review-public-practices').query({authorId})).status).toBe(400);
});
it('discloses a practice-only author public introduction while retaining private fields and removing withdrawn discovery',async()=>{
 const saved=await publish();expect(saved.status).toBe(201);const url='/api/review-public-tutorials/author',file=path.join(directory,'profiles.json');fs.writeFileSync(file,JSON.stringify([{id:owner,visibility:'private',tagline:'PRIVATE-TAG',about:'PRIVATE-ABOUT',focus:'PRIVATE-FOCUS'}]));let r=await reader.get(url).query({id:owner});expect(r.status).toBe(200);expect(r.body.total).toBe(0);expect(r.body.author.name).toBe('实践作者');expect(r.body.author.profile).toBeNull();expect(JSON.stringify(r.body)).not.toContain('PRIVATE-');fs.writeFileSync(file,JSON.stringify([{id:owner,visibility:'public',tagline:'公开实践介绍',about:'我的实践方法',focus:'代数',secret:'PRIVATE-SECRET'}]));r=await reader.get(url).query({id:owner});expect(r.body.author.profile).toEqual({tagline:'公开实践介绍',about:'我的实践方法',focus:'代数'});expect(JSON.stringify(r.body)).not.toContain('PRIVATE-');await author.patch('/api/records/'+saved.body.record.id).send({visibility:'private'});expect((await reader.get(url).query({id:owner})).status).toBe(404);
});
it('filters by exact public target identity and rejects cursors from a different target scope',async()=>{
 await publish();const other=loadCatalog().nodes.find(n=>n.originId!=='eq');expect((await author.post('/api/records').send({treeId:other.treeId,nodeId:other.id,text:'另一个目标的公开实践',visibility:'public',lightUp:false})).status).toBe(201);const all=(await reader.get('/api/review-public-practices').query({limit:1})).body,r=await reader.get('/api/review-public-practices').query({...target,authorId:owner});expect(r.status).toBe(200);expect(r.body.total).toBe(1);expect(r.body.nodeId).toBe(target.nodeId);expect(r.body.practices[0].nodeId).toBe(target.nodeId);expect((await reader.get('/api/review-public-practices').query({...target,cursor:all.nextCursor})).status).toBe(409);for(const args of [{nodeId:target.nodeId},{treeId:target.treeId},{...target,nodeId:['a','b']},{...target,treeId:'../private'}])expect((await reader.get('/api/review-public-practices').query(args)).status).toBe(400);
});
it('refuses an image after its target is no longer public and keeps denied media responses uncached',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',saved=await author.post('/api/records').send({...target,text:'目标公开图片',visibility:'public',lightUp:false,images:[{mediaType:'image/png',dataUrl:'data:image/png;base64,'+png}]});expect(saved.status).toBe(201);const url='/api/media/'+saved.body.record.images[0].id;expect((await reader.get(url)).status).toBe(200);const file=path.join(directory,'custom-nodes.json'),store=JSON.parse(fs.readFileSync(file,'utf8'));store.nodes.find(n=>n.id===target.nodeId).visibility='private';fs.writeFileSync(file,JSON.stringify(store));const denied=await reader.get(url);expect(denied.status).toBe(404);expect(denied.headers['cache-control']).toBe('private, no-store');expect((await reader.get('/api/review-public-practices')).body.total).toBe(0);
});
it('paginates public records, labels unverified legacy entries and invalidates withdrawn results',async()=>{
 const bound=await publish();expect(bound.status).toBe(201);const legacy=await author.post('/api/records').send({...target,text:'公开旧版记录ABC',visibility:'public',lightUp:true});expect(legacy.status).toBe(201);const first=(await reader.get('/api/review-public-practices').query({limit:1})).body,second=(await reader.get('/api/review-public-practices').query({limit:1,cursor:first.nextCursor})).body;expect(first.total).toBe(2);expect(second.practices[0].id).not.toBe(first.practices[0].id);const old=(await reader.get('/api/review-public-practices').query({query:'abc'})).body.practices[0];expect(old.snapshotStatus).toBe('unverified');expect(old).not.toHaveProperty('snapshot');expect(old).not.toHaveProperty('activity');expect((await author.delete('/api/records/'+legacy.body.record.id)).status).toBe(200);expect((await reader.get('/api/review-public-practices').query({cursor:first.nextCursor})).status).toBe(409);
});
it('omits records when their target is private and preserves corrupted receipt files without exposing their data',async()=>{
 expect((await publish()).status).toBe(201);const file=path.join(directory,'custom-nodes.json'),store=JSON.parse(fs.readFileSync(file,'utf8'));store.nodes.find(n=>n.id===target.nodeId).visibility='private';fs.writeFileSync(file,JSON.stringify(store));expect((await reader.get('/api/review-public-practices')).body.total).toBe(0);store.nodes.find(n=>n.id===target.nodeId).visibility='public';fs.writeFileSync(file,JSON.stringify(store));const receipts=path.join(directory,'practice-receipts',owner+'.json');fs.writeFileSync(receipts,'{PRIVATE-BROKEN');const r=await reader.get('/api/review-public-practices');expect(r.status).toBe(503);expect(JSON.stringify(r.body)).not.toContain('PRIVATE-BROKEN');expect(fs.readFileSync(receipts,'utf8')).toBe('{PRIVATE-BROKEN');
});
it('checks actor, authentication, origin and bounded discovery inputs',async()=>{
 const url='/api/review-public-practices';expect((await request(app).get(url)).status).toBe(401);expect((await reader.get(url).set('X-Action-Account',owner)).status).toBe(409);expect((await reader.get(url).set('Origin','https://not-authorized.example')).status).toBe(403);for(const args of [{query:'x'.repeat(121)},{limit:51},{query:['a','b']}])expect((await reader.get(url).query(args)).status).toBe(400);
});
it('removes a withdrawn practice from discovery while retaining the author original receipt history',async()=>{
 const saved=await publish();expect(saved.status).toBe(201);const first=(await reader.get('/api/review-public-practices')).body;expect(first.total).toBe(1);expect((await author.patch('/api/records/'+saved.body.record.id).send({visibility:'private'})).status).toBe(200);expect((await reader.get('/api/review-public-practices')).body.total).toBe(0);const own=(await author.get('/api/review-practices')).body;expect(own.receipts).toHaveLength(1);expect(own.current[0].record.visibility).toBe('private');expect(own.receipts[0].record.visibility).toBe('public');
});
