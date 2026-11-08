const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {FORMAT}=require('./action-state.cjs');
const {loadCatalog}=require('./knowledge-catalog.cjs');
let directory,app,alice,bob,state,revision;
async function save(){const old=(await alice.get('/api/action-state')).body;const r=await alice.put('/api/action-state').set('If-Match',old.revision).send({format:FORMAT,data:state});expect(r.status).toBe(200);revision=r.body.revision}
function submit(extra={},headers={}){const req=alice.post('/api/review-practices').set('If-Match',revision);for(const [k,v] of Object.entries(headers))req.set(k,v);return req.send({eventId:'independent',practiceMode:'independent',tutorialId:null,tutorialVersion:null,visibility:'private',...extra})}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-independent-practice-'));app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;
 alice=request.agent(app);bob=request.agent(app);await alice.post('/api/register').send({name:'independent-alice',password:'test-only-2026'});await bob.post('/api/register').send({name:'independent-bob',password:'test-only-2026'});
 const n={...loadCatalog().nodes.find(n=>n.originId==='eq'),id:'eq',version:1,methods:[]};
 const k={nodeId:n.id,nodeTitle:n.title,nodeGoal:n.goal,nodeVersion:1,five:n.five,nodeDomain:n.domain,nodeBranch:n.branch,nodeOwnership:n.ownership,nodeVisibility:n.visibility,methodId:null,methodTitle:'独立尝试',version:null,content:'',resource:'',privateMemo:'本人的内部附注'};
 state={schema:1,mode:'local-simulation',nodes:[n],events:[{id:'independent',name:n.title,startedAt:0,endedAt:1000,segments:[{start:0,end:300},{start:600,end:1000}],steps:[],stepDone:{},draft:'本人私人草稿',notes:[{id:'note',text:'本人私人笔记',at:800}],knowledge:k}],activeId:null,habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{},lights:[{id:'light',eventId:'independent',nodeId:'eq',confirmed:false,public:false,result:'',evidence:''}]};await save();
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected test directory');fs.rmSync(directory,{recursive:true,force:true})});
it('refuses altered saved activity segments without changing the original receipt bytes',async()=>{
 expect((await submit()).status).toBe(201);const owner=(await alice.get('/api/me')).body.user.id,file=path.join(directory,'practice-receipts',owner+'.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data.receipts[0].activitySnapshot.segments[0].end=250;const bytes=JSON.stringify(data);fs.writeFileSync(file,bytes);const r=await alice.get('/api/review-practices');expect(r.status).toBe(500);expect(r.body.code).toBe('PRACTICE_STORE_UNREADABLE');expect((await alice.get('/api/review-account-export')).status).toBe(500);expect(fs.readFileSync(file,'utf8')).toBe(bytes);
});
it('saves an independent private draft without creating any tutorial or binding',async()=>{
 const r=await submit();expect(r.status).toBe(201);expect(r.body.record.tutorialId).toBeNull();expect(r.body.record.tutorialVersion).toBeNull();expect(r.body.record.practiceMode).toBe('independent');expect(r.body.record.lightUp).toBe(false);expect(r.body.record.activity.actualMilliseconds).toBe(700);
 expect(JSON.stringify(r.body.record)).not.toContain('本人');expect((await bob.get('/api/records')).body.records).toHaveLength(0);expect((await alice.get('/api/tutorials')).body.tutorials).toHaveLength(0);expect((await alice.get('/api/review-method-bindings')).body.bindings).toHaveLength(0);
 const archive=(await alice.get('/api/review-practices')).body;expect(archive.receipts[0].sourceSnapshot.privateMemo).toBe('本人的内部附注');expect((await submit()).body.repeated).toBe(true);
});
it('requires separate confirmed L1 and public choice before exposing an independent practice',async()=>{
 const first=(await submit()).body;expect((await submit({visibility:'public',lightId:'light'})).status).toBe(403);
 Object.assign(state.lights[0],{confirmed:true,result:'解得x=4。',evidence:'代回后等式成立。'});await save();expect((await submit({visibility:'public',lightId:'light'})).status).toBe(403);
 state.lights[0].public=true;await save();const published=await submit({visibility:'public',lightId:'light'},{'If-Practice-Match':first.recordRevision});expect(published.status).toBe(200);
 const visible=(await bob.get('/api/records')).body.records;expect(visible).toHaveLength(1);expect(visible[0].tutorialId).toBeNull();expect(visible[0].lightUp).toBe(true);expect(JSON.stringify(visible)).not.toContain('私人');expect(JSON.stringify(visible)).not.toContain('内部附注');expect(visible[0].activity.startedAt).toBeUndefined();
});
it('keeps an explicit old target snapshot after later local target changes',async()=>{
 state.nodes[0].version=2;state.nodes[0].goal='后来修订的新目标';await save();const r=await submit();expect(r.status).toBe(201);expect(r.body.record.sourceSnapshot.nodeGoal).toBe('求出未知数，并代回原方程验证等式成立。');
});
it('uses an unchanged exact definition for a legacy snapshot but refuses to guess after it changes',async()=>{
 for(const f of ['nodeDomain','nodeBranch','nodeOwnership','nodeVisibility'])delete state.events[0].knowledge[f];await save();expect((await submit()).status).toBe(201);
 state.nodes[0].version=2;state.nodes[0].goal='另一个版本';await save();expect((await submit()).status).toBe(400);
});
it.each(['selected-method','goal','version','ownership'])('rejects a mismatched %s rather than inventing an independent mapping',async kind=>{
 const k=state.events[0].knowledge;if(kind==='selected-method'){k.methodId='actually-used';k.version=1;k.content='使用过的方法'}if(kind==='goal')k.nodeGoal='另一个完整目标';if(kind==='version')k.nodeVersion=2;if(kind==='ownership')k.nodeOwnership='personal';await save();expect((await submit()).status).toBe(400);expect((await alice.get('/api/review-practices')).body.receipts).toHaveLength(0);
});
it('does not require unrelated tutorial and binding stores for an independent action',async()=>{
 fs.writeFileSync(path.join(directory,'tutorials.json'),'{damaged');const owner=(await alice.get('/api/me')).body.user.id;fs.mkdirSync(path.join(directory,'method-bindings'));fs.writeFileSync(path.join(directory,'method-bindings',owner+'.json'),'{damaged');
 expect((await submit()).status).toBe(201);expect(fs.readFileSync(path.join(directory,'tutorials.json'),'utf8')).toBe('{damaged');
});
