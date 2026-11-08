const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {FORMAT}=require('./action-state.cjs');
const {loadCatalog,TREE}=require('./knowledge-catalog.cjs');
const {methodSource,tutorialPayload}=require('./knowledge-version-mapping.cjs');
const {commitTransaction,atomicJson}=require('../../../storage-transaction');
let directory,app,alice,bob,ownerId,state,revision,tutorial,failReceipt;
const body=(visibility='private',lightId)=>({eventId:'event-one',tutorialId:tutorial.id,tutorialVersion:tutorial.version,visibility,...(lightId?{lightId}:{})});
async function save(){const previous=(await alice.get('/api/action-state')).body.revision;const r=await alice.put('/api/action-state').set('If-Match',previous).send({format:FORMAT,data:state});expect(r.status).toBe(200);revision=r.body.revision}
async function submit(input=body(),recordRevision){let r=alice.post('/api/review-practices').set('If-Match',revision);if(recordRevision)r=r.set('If-Practice-Match',recordRevision);return r.send(input)}
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-practice-'));failReceipt=false;
 const practiceCommit=(dir,entries)=>commitTransaction(dir,entries,(file,value)=>{if(failReceipt&&file.includes('practice-receipts')){failReceipt=false;throw Error('Injected receipt disk failure')}atomicJson(file,value)});
 app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false,practiceCommit}).app;
 alice=request.agent(app);bob=request.agent(app);ownerId=(await alice.post('/api/register').send({name:'practice-alice',password:'test-only-2026'})).body.user.id;
 await bob.post('/api/register').send({name:'practice-bob',password:'test-only-2026'});
 const node={...loadCatalog().nodes.find(n=>n.originId==='eq'),id:'eq',version:1};node.methods=[{id:'own-method',title:'代回验证',author:'practice-alice',versions:[{number:1,created:0,content:'解出未知数，再代回验证。',five:'从2x+3=11开始。',resource:''}]}];
 const k={nodeId:'eq',nodeTitle:node.title,nodeGoal:node.goal,nodeVersion:1,methodId:'own-method',methodTitle:'代回验证',version:1,content:node.methods[0].versions[0].content,five:node.methods[0].versions[0].five,resource:'',privateMemo:'私人快照附注'};
 state={schema:1,mode:'local-simulation',nodes:[node],habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{},activeId:null,events:[{id:'event-one',name:'知识实践',startedAt:0,endedAt:1000,segments:[{start:0,end:400},{start:700,end:1000}],steps:[],stepDone:{},draft:'私人草稿',notes:[{id:'n',text:'私人单次笔记',at:800}],knowledge:k}],lights:[{id:'light-one',eventId:'event-one',nodeId:'eq',confirmed:false,result:'',evidence:'',public:false}]};
 await save();await alice.post('/api/records').send({treeId:TREE,nodeId:'od-eq',text:'首次确认完成目标。',eventId:'earlier-confirmation',lightUp:true,visibility:'private'});
 tutorial=(await alice.post('/api/tutorials').send(tutorialPayload(methodSource(node,node.methods[0],1),'public'))).body.tutorial;
 expect((await alice.post('/api/review-method-bindings').set('If-Match',revision).send({nodeId:'eq',methodId:'own-method',sourceVersion:1,tutorialId:tutorial.id,tutorialVersion:tutorial.version})).status).toBe(201);
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected directory');fs.rmSync(directory,{recursive:true,force:true})});
it('submits an ended private draft without automatic light-up or duplicate practice',async()=>{
 const first=await submit();expect(first.status).toBe(201);expect(first.body.record.lightUp).toBe(false);expect(first.body.record.visibility).toBe('private');expect(first.body.record.activity.actualMilliseconds).toBe(700);
 expect(JSON.stringify(first.body.record)).not.toContain('私人单次笔记');expect(JSON.stringify(first.body.record)).not.toContain('私人草稿');
 const second=await submit();expect(second.body.repeated).toBe(true);expect(second.body.record.id).toBe(first.body.record.id);
 expect((await bob.get('/api/records')).body.records).toHaveLength(0);
 expect((await alice.get('/api/review-practices')).body.receipts).toHaveLength(1);
});
it('requires separate light-up and public consent, preserving old private receipts on explicit update',async()=>{
 const draft=(await submit()).body;
 expect((await submit(body('public','light-one'))).status).toBe(403);
 Object.assign(state.lights[0],{confirmed:true,result:'解得x=4。',evidence:'代回得到等式成立。'});await save();
 expect((await submit(body('public','light-one'),draft.recordRevision)).status).toBe(403);
 state.lights[0].public=true;await save();
 expect((await submit(body('public','light-one'))).status).toBe(409);
 const published=await submit(body('public','light-one'),draft.recordRevision);expect(published.status).toBe(200);expect(published.body.record.id).toBe(draft.record.id);
 const visible=(await bob.get('/api/records')).body.records;expect(visible).toHaveLength(1);expect(visible[0].lightUp).toBe(true);expect(JSON.stringify(visible)).not.toContain('私人');expect(visible[0].activitySnapshot).toBeUndefined();
 const archive=(await alice.get('/api/review-practices')).body.receipts;expect(archive).toHaveLength(2);expect(archive[0].record.visibility).toBe('private');expect(archive[1].sourceSnapshot.privateMemo).toBe('私人快照附注');
 expect((await bob.get('/api/review-practices')).body.receipts).toHaveLength(0);
});
it('refuses unfinished events and source snapshots that do not match the bound method',async()=>{
 state.events[0].endedAt=null;state.events[0].segments[1].end=null;state.activeId='event-one';await save();expect((await submit()).status).toBe(400);
 state.events[0].endedAt=1000;state.events[0].segments[1].end=1000;state.activeId=null;state.events[0].knowledge.content='不是当时绑定的方法';await save();expect((await submit()).status).toBe(400);
 expect((await alice.get('/api/review-practices')).body.receipts).toHaveLength(0);
});
it('rejects a stale action revision and an outdated practice receipt without losing previous history',async()=>{
 const first=(await submit()).body,oldSource=revision;
 Object.assign(state.lights[0],{confirmed:true,result:'结果',evidence:'证据'});await save();
 expect((await alice.post('/api/review-practices').set('If-Match',oldSource).send(body('private','light-one'))).status).toBe(409);
 expect((await submit(body('private','light-one'),'stale-record-revision')).status).toBe(409);
 expect((await alice.get('/api/review-practices')).body.receipts[0].recordRevision).toBe(first.recordRevision);
});
it('recovers a durable partial-write journal and makes the following retry idempotent',async()=>{
 failReceipt=true;const result=await submit();expect(result.status).toBe(500);expect(result.body.code).toBe('PRACTICE_COMMIT_UNCONFIRMED');
 expect(fs.existsSync(path.join(directory,'restore-journal.json'))).toBe(true);
 const recovered=await alice.get('/api/review-practices');expect(recovered.status).toBe(200);expect(recovered.body.receipts).toHaveLength(1);expect(fs.existsSync(path.join(directory,'restore-journal.json'))).toBe(false);
 expect((await submit()).body.repeated).toBe(true);
 expect((await alice.get('/api/records')).body.records.filter(r=>r.eventId==='event-one')).toHaveLength(1);
});
it('rejects another account, caller-supplied evidence text and visibility without explicit selection',async()=>{
 expect((await request(app).post('/api/review-practices').set('If-Match',revision).send(body())).status).toBe(401);
 expect((await submit({...body(),text:'伪造的证据'})).status).toBe(400);
 const noVisibility=body();delete noVisibility.visibility;expect((await submit(noVisibility)).status).toBe(400);
 expect((await bob.post('/api/review-practices').set('X-Action-Account',ownerId).set('If-Match',revision).send(body())).status).toBe(409);
});
it('preserves existing private image references and requires separate image-sharing consent',async()=>{
 const draft=(await submit()).body,file=path.join(directory,'records.json'),rows=JSON.parse(fs.readFileSync(file));
 const record=rows.find(r=>r.id===draft.record.id);record.images=[{id:'existing-private-image',mediaType:'image/png'}];
 fs.writeFileSync(file,JSON.stringify(rows));const actualRevision=crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
 const current=(await alice.get('/api/review-practices')).body.current.find(r=>r.eventId==='event-one');expect(current.recordRevision).toBe(actualRevision);expect(current.record.images).toEqual(record.images);expect((await bob.get('/api/review-practices')).body.current).toHaveLength(0);
 Object.assign(state.lights[0],{confirmed:true,public:true,result:'结果',evidence:'证据'});await save();
 const blocked=await submit(body('public','light-one'),actualRevision);expect(blocked.status).toBe(409);expect(blocked.body.code).toBe('PRACTICE_PRIVATE_IMAGES_REQUIRE_REVIEW');
 expect((await bob.get('/api/records')).body.records).toHaveLength(0);
 const approved=await submit({...body('public','light-one'),shareExistingImages:true},actualRevision);
 expect(approved.status).toBe(200);expect(approved.body.record.images).toEqual(record.images);
});
it('preserves a corrupted private receipt and refuses to silently replace it',async()=>{
 await submit();const file=path.join(directory,'practice-receipts',ownerId+'.json'),raw='{damaged';fs.writeFileSync(file,raw);
 expect((await alice.get('/api/review-practices')).status).toBe(500);expect((await submit()).status).toBe(500);
 expect(fs.readFileSync(file,'utf8')).toBe(raw);
});
it('keeps a private historical snapshot but refuses new public practice against an archived tutorial',async()=>{
 const file=path.join(directory,'tutorials.json'),rows=JSON.parse(fs.readFileSync(file,'utf8'));rows.find(t=>t.id===tutorial.id).archived=true;fs.writeFileSync(file,JSON.stringify(rows));
 Object.assign(state.lights[0],{confirmed:true,public:true,result:'结果',evidence:'证据'});await save();
 expect((await submit(body('public','light-one'))).status).toBe(403);
 expect((await submit(body('private','light-one'))).status).toBe(201);
 expect((await bob.get('/api/records')).body.records).toHaveLength(0);
});
