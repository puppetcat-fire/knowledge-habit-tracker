const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),request=require('supertest');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
let directory,app,author,reader,tutorials;
beforeEach(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'dianliang-public-search-'));app=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'assets'),rateLimitEnabled:false}).app;author=request.agent(app);reader=request.agent(app);await author.post('/api/register').send({name:'搜索作者',password:'test-only-2026'});await reader.post('/api/register').send({name:'搜索读者',password:'test-only-2026'});
 const target={treeId:'dianliang-review-catalog-v1',nodeId:'od-eq'};expect((await author.post('/api/records').send({...target,text:'已完成求解和代回检验。',lightUp:true,visibility:'private'})).status).toBe(201);tutorials=[];
 for(const title of ['ＡＢＣ 代回检验','另一份检验方法']){const r=await author.post('/api/tutorials').send({...target,title,method:'先求未知数，再代回原等式。',startAction:'先写出2x+3=11。',resources:[{label:'所需资料',url:'https://example.com/required',optional:false,affiliate:false},{label:'可选材料',url:'https://example.com/optional',optional:true,affiliate:true}],visibility:'public'});expect(r.status).toBe(201);tutorials.push(r.body.tutorial)}
 expect((await author.post('/api/tutorials').send({...target,title:'PRIVATE-HIDDEN',method:'私人步骤不可搜索',visibility:'private'})).status).toBe(201);
});
afterEach(()=>{if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected fixture');fs.rmSync(directory,{recursive:true,force:true})});
it('browses an exact author with scope-bound pagination without including a matching name in another method',async()=>{
 const id=tutorials[0].authorId,target={treeId:'dianliang-review-catalog-v1',nodeId:'od-eq'};await reader.post('/api/records').send({...target,text:'本人已检验',lightUp:true,visibility:'private'});expect((await reader.post('/api/tutorials').send({...target,title:'搜索作者的名字出现在这份其他人的教程中',method:'仍属于读者这个账号。',visibility:'public'})).status).toBe(201);
 const first=(await reader.get('/api/review-public-tutorials').query({authorId:id,limit:1})).body;expect(first.total).toBe(2);expect(first.authorId).toBe(id);const second=(await reader.get('/api/review-public-tutorials').query({authorId:id,limit:1,cursor:first.nextCursor})).body;expect(second.tutorials[0].authorId).toBe(id);expect(second.tutorials[0].id).not.toBe(first.tutorials[0].id);expect((await reader.get('/api/review-public-tutorials').query({limit:1,cursor:first.nextCursor})).status).toBe(409);const search=(await reader.get('/api/review-public-tutorials').query({authorId:id,query:'abc　搜索作者 代回原等式',order:'recent'})).body;expect(search.total).toBe(1);expect(search.tutorials[0].id).toBe(tutorials[0].id);expect((await reader.get('/api/review-public-tutorials').query({authorId:['a','b']})).status).toBe(400);
});
it('discloses only explicitly public author profile fields and removes the author when all tutorials are withdrawn',async()=>{
 const id=tutorials[0].authorId,file=path.join(directory,'profiles.json');fs.writeFileSync(file,JSON.stringify([{id,visibility:'private',tagline:'PRIVATE-TAGLINE',about:'PRIVATE-ABOUT',focus:'PRIVATE-FOCUS',secret:'PRIVATE-SECRET'}]));let authorView=await reader.get('/api/review-public-tutorials/author').query({id});expect(authorView.status).toBe(200);expect(authorView.body.author.profile).toBeNull();expect(JSON.stringify(authorView.body)).not.toContain('PRIVATE-');
 fs.writeFileSync(file,JSON.stringify([{id,visibility:'public',tagline:'公开一句话',about:'公开方法介绍',focus:'当前关注代数',secret:'PRIVATE-SECRET',updatedAt:'PRIVATE-METADATA'}]));authorView=await reader.get('/api/review-public-tutorials/author').query({id});expect(authorView.body.author.profile).toEqual({tagline:'公开一句话',about:'公开方法介绍',focus:'当前关注代数'});expect(authorView.headers['cache-control']).toBe('no-store');expect(JSON.stringify(authorView.body)).not.toContain('PRIVATE-');expect(authorView.body.total).toBe(2);
 for(const t of tutorials)expect((await author.patch('/api/tutorials/'+t.id).set('If-Match',t.version).send({visibility:'private'})).status).toBe(200);expect((await reader.get('/api/review-public-tutorials/author').query({id})).status).toBe(404);
});
it('guards author reads and preserves unreadable profile files without leaking their bytes',async()=>{
 const id=tutorials[0].authorId,url='/api/review-public-tutorials/author';expect((await request(app).get(url).query({id})).status).toBe(401);expect((await reader.get(url).query({id}).set('X-Action-Account','wrong-owner')).status).toBe(409);expect((await reader.get(url).query({id}).set('Origin','https://not-authorized.example')).status).toBe(403);expect((await reader.get(url).query({id:'../profiles'})).status).toBe(400);const file=path.join(directory,'profiles.json'),bytes='{PRIVATE-BROKEN';fs.writeFileSync(file,bytes);const r=await reader.get(url).query({id});expect(r.status).toBe(503);expect(JSON.stringify(r.body)).not.toContain('PRIVATE-BROKEN');expect(fs.readFileSync(file,'utf8')).toBe(bytes);
});
it('uses the latest matching publication after withdrawal and republication without rewriting the older history',async()=>{
 const t=tutorials[0],file=path.join(directory,'tutorials.json'),data=JSON.parse(fs.readFileSync(file,'utf8')),original=data.find(v=>v.id===t.id).versions[0];original.createdAt='2024-01-01T00:00:00.000Z';fs.writeFileSync(file,JSON.stringify(data));const first=(await reader.get('/api/review-public-tutorials/one').query({id:t.id})).body.tutorial;expect(first.createdAt).toBe(original.createdAt);
 const withdrawn=await author.patch('/api/tutorials/'+t.id).set('If-Match',t.version).send({visibility:'private'});expect(withdrawn.status).toBe(200);expect((await reader.get('/api/review-public-tutorials/one').query({id:t.id})).status).toBe(404);
 const restored=await author.patch('/api/tutorials/'+t.id).set('If-Match',withdrawn.body.tutorial.version).send({visibility:'public'});expect(restored.status).toBe(200);expect(restored.body.tutorial.version).toBe(t.version);const latest=restored.body.tutorial.versions.at(-1),current=(await reader.get('/api/review-public-tutorials/one').query({id:t.id})).body.tutorial;expect(current.createdAt).toBe(latest.createdAt);expect(current.createdAt).not.toBe(first.createdAt);expect(current.resources).toEqual(first.resources);expect(restored.body.tutorial.versions[0]).toEqual(original);expect(restored.body.tutorial.versions).toHaveLength(3);
 const recent=(await reader.get('/api/review-public-tutorials').query({order:'recent'})).body;expect(recent.tutorials[0].id).toBe(t.id);expect(recent.tutorials[0].createdAt).toBe(latest.createdAt);expect(current).not.toHaveProperty('versions');
});
it('orders by current public version time and binds pagination to the selected order',async()=>{
 const file=path.join(directory,'tutorials.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const [i,t] of data.entries())t.versions.find(v=>v.version===t.version).createdAt=['2024-01-01T00:00:00.000Z','2024-02-01T00:00:00.000Z','2024-03-01T00:00:00.000Z'][i];fs.writeFileSync(file,JSON.stringify(data));
 const first=(await reader.get('/api/review-public-tutorials').query({order:'recent',limit:1})).body;expect(first.order).toBe('recent');expect(first.tutorials[0].id).toBe(tutorials[1].id);expect(first.tutorials[0].createdAt).toBe('2024-02-01T00:00:00.000Z');expect(first.total).toBe(2);
 const second=(await reader.get('/api/review-public-tutorials').query({order:'recent',limit:1,cursor:first.nextCursor})).body;expect(second.tutorials[0].id).toBe(tutorials[0].id);expect(second.nextCursor).toBeNull();expect((await reader.get('/api/review-public-tutorials').query({limit:1,cursor:first.nextCursor})).status).toBe(409);
 const changed=await author.patch('/api/tutorials/'+tutorials[0].id).set('If-Match',tutorials[0].version).send({method:'先整理等式，再求未知数，最后代回。'});expect(changed.status).toBe(200);
 const updated=(await reader.get('/api/review-public-tutorials').query({order:'recent'})).body;expect(updated.tutorials[0].id).toBe(tutorials[0].id);expect(updated.tutorials[0].version).toBe(changed.body.tutorial.version);expect(Date.parse(updated.tutorials[0].createdAt)).toBeGreaterThan(Date.parse('2024-02-01T00:00:00.000Z'));expect(updated.tutorials[0].resources).toEqual(tutorials[0].resources);expect((await reader.get('/api/review-public-tutorials').query({order:'recent',cursor:first.nextCursor})).status).toBe(409);
});
it('breaks equal publication times by stable identity and rejects unsupported sorting',async()=>{
 const file=path.join(directory,'tutorials.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));for(const t of data)t.versions.find(v=>v.version===t.version).createdAt='2024-01-01T00:00:00.000Z';fs.writeFileSync(file,JSON.stringify(data));
 const recent=(await reader.get('/api/review-public-tutorials').query({order:'recent'})).body,stable=(await reader.get('/api/review-public-tutorials')).body;expect(recent.tutorials.map(t=>t.id)).toEqual(stable.tutorials.map(t=>t.id));expect(stable.order).toBe('stable');for(const order of ['popular',['recent','stable'],''])expect((await reader.get('/api/review-public-tutorials').query({order})).status).toBe(400);
});
it('searches normalized public titles, methods and authors while preserving materials and identities',async()=>{
 for(const [query,count] of [['abc',1],['代回原等式',2],['搜索作者',2]]){const r=await reader.get('/api/review-public-tutorials').query({query});expect(r.status).toBe(200);expect(r.body.total).toBe(count);expect(r.headers['cache-control']).toBe('no-store');expect(JSON.stringify(r.body)).not.toContain('PRIVATE-HIDDEN');expect(r.body.tutorials[0].resources).toEqual(tutorials[0].resources);expect(r.body.tutorials[0].target.goal).toBeTruthy();expect(r.body.tutorials[0]).not.toHaveProperty('versions');expect(r.body.tutorials[0]).not.toHaveProperty('sourceOrigin')}
 const r=await reader.get('/api/review-public-tutorials/one').query({id:tutorials[0].id});expect(r.status).toBe(200);expect(r.body.tutorial.version).toBe(tutorials[0].version);
});
it('paginates distinct methods and keeps a cursor valid when only private content changes',async()=>{
 const first=await reader.get('/api/review-public-tutorials').query({limit:1});expect(first.body.nextCursor).toBeTruthy();await author.post('/api/tutorials').send({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',title:'更多私人资料',method:'不可公开',visibility:'private'});const next=await reader.get('/api/review-public-tutorials').query({limit:1,cursor:first.body.nextCursor});expect(next.status).toBe(200);expect(next.body.tutorials[0].id).not.toBe(first.body.tutorials[0].id);expect(next.body.nextCursor).toBeNull();
});
it('invalidates only ranked discussion pagination when a vote changes the order',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id;
 const post=(requestId,parentId=null)=>author.post(url).send({text:requestId,tutorialVersion:t.version,parentId,requestId,consent:true});
 const first=(await post('rank-parent')).body.comment,second=(await post('rank-child',first.id)).body.comment;
 const chronological=(await reader.get(url).query({limit:1})).body;
 const ranked=(await reader.get(url).query({limit:1,order:'helpful'})).body;
 expect(ranked.comments[0].id).toBe(first.id);
 expect((await reader.post(url+'/'+second.id+'/helpful').send({selected:true})).status).toBe(200);
 expect((await reader.get(url).query({limit:1,order:'helpful',cursor:ranked.nextCursor})).status).toBe(409);
 const next=await reader.get(url).query({limit:1,cursor:chronological.nextCursor});
 expect(next.status).toBe(200);
 expect(next.body.comments[0].id).toBe(second.id);
 const focused=(await reader.get(url).query({limit:1,order:'helpful',focus:second.id})).body;
 expect(focused.pageNumber).toBe(1);
 expect(focused.comments[0]).toMatchObject({id:second.id,replyContext:{id:first.id,text:first.text}});
 expect((await reader.get(url).query({query:'ＲＡＮＫ－ＣＨＩＬＤ'})).body.comments.map(e=>e.id)).toEqual([second.id]);
 expect((await reader.get(url).query({limit:1,query:'rank-child',cursor:chronological.nextCursor})).status).toBe(409);
 expect((await author.post(url+'/'+second.id+'/withdraw').set('If-Match',second.revision).send({consent:true})).status).toBe(200);
 expect((await reader.get(url).query({query:'rank-child'})).body).toMatchObject({total:0,comments:[]});
});
it('counts helpful votes once, exposes only the current reader selection and hides votes on withdrawal',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id;
 const response=await author.post(url).send({text:'可以复用的检验方法',tutorialVersion:t.version,parentId:null,requestId:'helpful-case',consent:true});
 expect(response.status).toBe(201);
 const comment=response.body.comment,vote=url+'/'+comment.id+'/helpful';
 expect((await author.post(vote).send({selected:true})).status).toBe(403);
 expect((await reader.post(vote).send({selected:'yes'})).status).toBe(400);
 const first=await reader.post(vote).send({selected:true});
 expect(first.body.helpful).toEqual({count:1,selected:true});
 expect((await reader.post(vote).send({selected:true})).body).toEqual(first.body);
 expect((await author.get(url)).body.comments[0].helpful).toEqual({count:1,selected:false});
 expect((await reader.get(url)).body.comments[0].helpful).toEqual({count:1,selected:true});
 expect((await reader.post(vote).send({selected:false})).body.helpful).toEqual({count:0,selected:false});
 expect((await reader.post(vote).send({selected:true})).status).toBe(200);
 expect((await author.post(url+'/'+comment.id+'/withdraw').set('If-Match',comment.revision).send({consent:true})).status).toBe(200);
 expect((await reader.get(url)).body.comments[0].helpful).toBeNull();
 expect((await reader.post(vote).send({selected:true})).status).toBe(404);
});
it('guards receipt and appeal reads against anonymous, cross-origin and stale-account requests',async()=>{
 const tutorial=tutorials[0];
 const thread='/api/review-tutorial-discussions/'+tutorial.id;
 const routes=[
  thread+'/sample-comment/report',
  thread+'/sample-comment/appeal',
  '/api/review-tutorial-discussions/reports/mine?status=pending',
  '/api/review-tutorial-discussions/moderation/appeals/'+'a'.repeat(64)
 ];
 for(const route of routes){
  expect((await request(app).get(route)).status).toBe(401);
  const crossOrigin=await reader.get(route).set('Origin','https://untrusted.example');
  expect(crossOrigin.status).toBe(403);
  expect(crossOrigin.body.code).toBe('ORIGIN_NOT_ALLOWED');
  const staleAccount=await reader.get(route).set('X-Action-Account',tutorial.authorId);
  expect(staleAccount.status).toBe(409);
  expect(staleAccount.body.code).toBe('ACTION_ACCOUNT_CHANGED');
 }
 const receipt=await reader.get(routes[0]);
 expect(receipt.headers['cache-control']).toBe('no-store');
 expect(receipt.body).toMatchObject({ok:true,commentId:'sample-comment',reportId:null});
 expect((await reader.get(routes[3])).body.code).toBe('DISCUSSION_MODERATOR_REQUIRED');
 expect((await reader.get('/api/review-tutorial-discussions/reports/mine').query({status:['pending','processed']})).status).toBe(400);
});
it('accepts one private discussion report per reader and rejects self-reports and newly withdrawn content',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id;
 const publish=async(requestId,text)=>(await author.post(url).send({text,tutorialVersion:t.version,parentId:null,requestId,consent:true})).body.comment;
 const comment=await publish('report-case','被举报的公开内容'),withdrawn=await publish('withdrawn-report-case','已经撤回的内容');
 const reportUrl=url+'/'+comment.id+'/report';
 expect((await request(app).post(reportUrl).send({reason:'spam'})).status).toBe(401);
 expect((await author.post(reportUrl).send({reason:'spam'})).status).toBe(403);
 expect((await reader.post(reportUrl).send({reason:'invalid'})).status).toBe(400);
 expect((await reader.post(reportUrl).send({reason:'other',details:'字'.repeat(501)})).status).toBe(400);
 const accepted=await reader.post(reportUrl).send({reason:'spam'});
 expect(accepted.status).toBe(201);
 expect(accepted.headers['cache-control']).toBe('no-store');
 expect(accepted.body).toEqual({ok:true,ownerId:expect.any(String),reportId:expect.any(String),repeated:false});
 const retry=await reader.post(reportUrl).send({reason:'spam'});
 expect(retry.body).toEqual({...accepted.body,repeated:true});
 const different=await reader.post(reportUrl).send({reason:'other',details:'后来填写的说明'});
 expect(different.status).toBe(409);
 expect(different.body.code).toBe('DISCUSSION_REPORT_ALREADY_SUBMITTED');
 expect((await reader.get(reportUrl)).body).toMatchObject({reportId:accepted.body.reportId,submission:{reason:'spam',details:''}});
 expect((await author.get(reportUrl)).body).not.toHaveProperty('submission');
 const listing=await author.get(url);
 expect(listing.body.comments.find(e=>e.id===comment.id).text).toBe(comment.text);
 expect(JSON.stringify(listing.body)).not.toContain(accepted.body.reportId);
 expect((await author.post(url+'/'+withdrawn.id+'/withdraw').set('If-Match',withdrawn.revision).send({consent:true})).status).toBe(200);
 expect((await reader.post(url+'/'+withdrawn.id+'/report').send({reason:'other'})).status).toBe(404);
 const files=fs.readdirSync(path.join(directory,'discussion-reports'));
 expect(files).toHaveLength(1);
 expect(JSON.parse(fs.readFileSync(path.join(directory,'discussion-reports',files[0]),'utf8'))).toMatchObject({reason:'spam',evidence:{text:comment.text,tutorialVersion:t.version}});
});
it.each(['normal write','interrupted write'])('restricts report evidence to configured reviewers and records one decision after %s',async(mode)=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,queue='/api/review-tutorial-discussions/moderation/reports';
 const credentials={name:'社区审核员',password:'test-only-2026'};
 const registered=await request(app).post('/api/register').send(credentials);
 expect(registered.status).toBe(201);
 const comment=(await author.post(url).send({text:'待审核的发言',tutorialVersion:t.version,parentId:null,requestId:'moderation-test',consent:true})).body.comment;
 const accepted=await reader.post(url+'/'+comment.id+'/report').send({reason:'harassment'});
 expect(accepted.status).toBe(201);
 const other=(await author.post(url).send({text:'独立的第二条举报证据',tutorialVersion:t.version,parentId:null,requestId:'moderation-test-other',consent:true})).body.comment;
 expect((await reader.post(url+'/'+other.id+'/report').send({reason:'spam'})).status).toBe(201);
 const {commitTransaction,atomicJson}=require('../../../storage-transaction');
 const interrupted=mode==='interrupted write';
 let failNextReportWrite=interrupted;
 const discussionModerationCommit=interrupted?(root,entries)=>commitTransaction(root,entries,(file,value)=>{
  if(failNextReportWrite&&path.dirname(file)===path.join(root,'discussion-reports')){
   failNextReportWrite=false;
   throw Error('Simulated decision write interruption');
  }
  atomicJson(file,value);
 }):undefined;
 const guarded=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:path.join(directory,'moderation-assets'),rateLimitEnabled:false,discussionModeratorIds:[registered.body.user.id],discussionModerationCommit}).app;
 const login=async(name)=>{const agent=request.agent(guarded);expect((await agent.post('/api/login').send({name,password:credentials.password})).status).toBe(200);return agent};
 const reviewer=await login(credentials.name),ordinary=await login('搜索读者'),writer=await login('搜索作者');
 const reporter=request.agent(guarded);
 expect((await reporter.post('/api/register').send({name:'独立举报读者',password:credentials.password})).status).toBe(201);
 const duplicateReport=await reporter.post(url+'/'+comment.id+'/report').send({reason:'other'});
 expect(duplicateReport.status).toBe(201);
 const staleReport=(await reviewer.get(queue+'/'+duplicateReport.body.reportId)).body.report;
 const action=queue+'/'+accepted.body.reportId,decision={outcome:'substantiated',note:'已复核举报时的原始发言'};
 const conflict=(await author.post(url).send({text:'审核员本人举报的内容',tutorialVersion:t.version,parentId:null,requestId:'reviewer-conflict',consent:true})).body.comment;
 const conflictRoute=url+'/'+conflict.id+'/report';
 expect((await reviewer.post(conflictRoute).send({reason:'spam'})).status).toBe(201);
 const otherReport=await reporter.post(conflictRoute).send({reason:'other'});
 expect(otherReport.status).toBe(201);
 const conflictAction=queue+'/'+otherReport.body.reportId;
 expect((await reviewer.get(conflictAction)).body.code).toBe('DISCUSSION_REVIEW_CONFLICT');
 expect((await reviewer.post(conflictAction).set('If-Match','stale').send(decision)).body.code).toBe('DISCUSSION_REVIEW_CONFLICT');
 const mine='/api/review-tutorial-discussions/reports/mine';
 const personal=(await ordinary.get(mine).query({limit:1})).body;
 expect(personal).toMatchObject({total:2,pageNumber:1,pageCount:2,reports:[{status:'pending'}]});
 const personalNext=await ordinary.get(mine).query({limit:1,cursor:personal.nextCursor});
 expect(personalNext.status).toBe(200);
 expect(personalNext.body.reports[0].id).not.toBe(personal.reports[0].id);
 expect(personalNext.body.reports[0]).not.toHaveProperty('evidence');
 expect((await writer.get(mine).query({limit:1,cursor:personal.nextCursor})).status).toBe(409);
 const anonymousQueue=await request(guarded).get(queue);
 expect(anonymousQueue.status).toBe(401);
 expect(anonymousQueue.headers['cache-control']).toBe('no-store');
 const crossOriginQueue=await reviewer.get(queue).set('Origin','https://outside.invalid');
 expect(crossOriginQueue.status).toBe(403);
 expect(crossOriginQueue.headers['cache-control']).toBe('no-store');
 expect((await ordinary.get(queue)).status).toBe(403);
 expect((await writer.post(action).send(decision)).status).toBe(403);
 expect((await ordinary.post(url).send({text:'公开回复继续保留',tutorialVersion:t.version,parentId:comment.id,requestId:'moderated-parent-reply',consent:true})).status).toBe(201);
 const listing=await reviewer.get(queue);
 expect(listing.headers['cache-control']).toBe('no-store');
 const report=listing.body.reports.find(item=>item.id===accepted.body.reportId);
 const first=(await reviewer.get(queue).query({status:'pending',limit:1})).body;
 expect(first).toMatchObject({total:3,pageNumber:1,pageCount:3});
 const second=await reviewer.get(queue).query({status:'pending',limit:1,cursor:first.nextCursor});
 expect(second.status).toBe(200);
 expect(second.body.reports[0].id).not.toBe(first.reports[0].id);
 expect(second.body.previousCursor).toBeTruthy();
 expect((await reviewer.get(queue).query({status:'all',limit:1,cursor:first.nextCursor})).status).toBe(409);
 expect(report).toMatchObject({decision:null,evidence:{text:comment.text}});
 expect(report).not.toHaveProperty('reporterId');
 expect((await reviewer.post(action).set('If-Match','stale').send(decision)).status).toBe(409);
 const commit=()=>reviewer.post(action).set('If-Match',report.revision).send(decision);
 let saved=await commit();
 const journal=path.join(directory,'restore-journal.json');
 if(interrupted){
  expect(saved.status).toBe(503);
  expect(fs.existsSync(journal)).toBe(true);
  const storedReport=path.join(directory,'discussion-reports',accepted.body.reportId+'.json');
  expect(JSON.parse(fs.readFileSync(storedReport,'utf8')).decision).toBeUndefined();
  expect((await ordinary.get(url)).body.comments[0]).toMatchObject({withdrawn:true,text:''});
  expect(fs.existsSync(journal)).toBe(false);
  saved=await commit();
 }
 expect(saved.body).toMatchObject({ok:true,repeated:interrupted,report:{decision:{...decision,reviewerId:registered.body.user.id}}});
 const publicThread=(await ordinary.get(url).query({replyTo:comment.id})).body;
 expect(publicThread.comments[0]).toMatchObject({withdrawn:true,text:''});
 expect(publicThread.comments.find(e=>e.parentId===comment.id)).toMatchObject({text:'公开回复继续保留',replyContext:{withdrawn:true,text:''}});
 expect(JSON.stringify(publicThread)).not.toContain(comment.text);
 const own=(await writer.get('/api/review-owned-discussions')).body.entries.find(e=>e.id===comment.id);
 expect(own).toMatchObject({moderated:true,withdrawn:true,text:comment.text});
 expect((await writer.post(url+'/'+comment.id+'/restore').set('If-Match',own.revision).send({consent:true})).status).toBe(403);
 const appealUrl=url+'/'+comment.id+'/appeal',explanation='请复核发言所在的讨论语境。';
 expect((await ordinary.post(appealUrl).send({explanation})).status).toBe(404);
 expect((await writer.post(url+'/'+other.id+'/appeal').send({explanation})).status).toBe(409);
 const appeal=await writer.post(appealUrl).set('If-Match',own.revision).send({explanation});
 expect(appeal.status).toBe(201);
 const pending=(await writer.get('/api/review-owned-discussions')).body.entries.find(e=>e.id===comment.id);
 expect(pending.appeal).toEqual({status:'pending',createdAt:appeal.body.createdAt,decidedAt:null});
 expect((await ordinary.get('/api/review-owned-discussions')).body.entries.some(e=>e.appeal)).toBe(false);
 expect(appeal.headers['cache-control']).toBe('no-store');
 expect((await writer.post(appealUrl).send({explanation})).body).toEqual({...appeal.body,repeated:true});
 expect((await writer.post(appealUrl).send({explanation:'尝试覆盖原申诉'})).status).toBe(409);
 expect(JSON.stringify((await ordinary.get(url)).body)).not.toContain(explanation);
 expect(fs.readdirSync(path.join(directory,'discussion-appeals'))).toHaveLength(1);
 expect((await reviewer.post(action).set('If-Match',report.revision).send(decision)).body.repeated).toBe(true);
 expect((await reviewer.post(action).set('If-Match',saved.body.report.revision).send({...decision,outcome:'dismissed'})).status).toBe(409);
 expect((await reviewer.get(queue).query({status:'pending',limit:1,cursor:first.nextCursor})).status).toBe(409);
 expect((await ordinary.get(mine).query({limit:1,cursor:personal.nextCursor})).status).toBe(409);
 const appeals='/api/review-tutorial-discussions/moderation/appeals';
 expect((await ordinary.get(appeals)).status).toBe(403);
 const submitted=(await reviewer.get(appeals)).body.appeals[0];
 expect(submitted).toMatchObject({id:appeal.body.appealId,explanation,decision:null});
 const verdict={outcome:'overturned',note:'复核后解除公开限制。',authorMessage:'请按需要恢复公开。'};
 const decide=(agent,revision)=>agent.post(appeals+'/'+submitted.id).set('If-Match',revision).send(verdict);
 expect((await decide(writer,submitted.revision)).status).toBe(403);
 expect((await decide(reviewer,'stale')).status).toBe(409);
 expect((await decide(reviewer,submitted.revision)).body).toMatchObject({ok:true,repeated:false,appeal:{decision:verdict}});
 expect((await decide(reviewer,submitted.revision)).body.repeated).toBe(true);
 expect((await ordinary.get(url)).body.comments[0]).toMatchObject({withdrawn:true,text:''});
 const threadFile=path.join(directory,'tutorial-discussions',t.id+'.json');
 if(interrupted){
  const legacy=JSON.parse(fs.readFileSync(threadFile,'utf8'));
  delete legacy.entries.find(e=>e.id===comment.id).lastAppealId;
  fs.writeFileSync(threadFile,JSON.stringify(legacy));
 }
 const beforeArchive=fs.readFileSync(threadFile,'utf8');
 const unblocked=(await writer.get('/api/review-owned-discussions')).body.entries.find(e=>e.id===comment.id);
 expect(unblocked).toMatchObject({moderated:false,withdrawn:true,appeal:{status:'overturned',createdAt:appeal.body.createdAt,decidedAt:expect.any(Number)}});
 expect(unblocked.appeal).not.toHaveProperty('note');
 expect(unblocked.appeal.authorMessage).toBe(verdict.authorMessage);
 expect(JSON.stringify((await ordinary.get(url)).body)).not.toContain(verdict.authorMessage);
 expect((await writer.post(appealUrl).send({explanation})).body).toEqual({...appeal.body,repeated:true});
 expect((await writer.post(appealUrl).send({explanation:'复核后尝试覆盖原说明'})).body.code).toBe('DISCUSSION_APPEAL_ALREADY_SUBMITTED');
 expect((await ordinary.post(appealUrl).send({explanation})).status).toBe(404);
 expect((await ordinary.get('/api/review-owned-discussions')).body.entries.some(e=>e.appeal)).toBe(false);
 expect(fs.readFileSync(threadFile,'utf8')).toBe(beforeArchive);
 expect((await writer.post(url+'/'+comment.id+'/restore').set('If-Match',unblocked.revision).send({consent:true})).status).toBe(200);
 const staleDecision=await reviewer.post(queue+'/'+staleReport.id).set('If-Match',staleReport.revision).send(decision);
 expect(staleDecision.status).toBe(409);
 expect(staleDecision.body.code).toBe('DISCUSSION_REPORT_SUPERSEDED');
 expect((await ordinary.get(url)).body.comments[0].text).toBe(comment.text);
 const newReader=request.agent(guarded);
 expect((await newReader.post('/api/register').send({name:'后来举报的读者',password:credentials.password})).status).toBe(201);
 const freshReport=await newReader.post(url+'/'+comment.id+'/report').send({reason:'spam'});
 expect(freshReport.status).toBe(201);
 const freshAction=queue+'/'+freshReport.body.reportId;
 const freshRevision=(await reviewer.get(freshAction)).body.report.revision;
 expect((await reviewer.post(freshAction).set('If-Match',freshRevision).send(decision)).status).toBe(200);
 expect((await writer.post(appealUrl).set('If-Match',own.revision).send({explanation})).body.code).toBe('DISCUSSION_APPEAL_CHANGED');
 const fresh=(await writer.get('/api/review-owned-discussions')).body.entries.find(e=>e.id===comment.id);
 expect(fresh.appeal).toBeNull();
 const nextAppeal=await writer.post(appealUrl).set('If-Match',fresh.revision).send({explanation:'申请复核本轮新处置。'});
 expect(nextAppeal.status).toBe(201);
 expect(nextAppeal.body.appealId).not.toBe(appeal.body.appealId);
});
it('keeps author search pagination valid when another author publishes',async()=>{
 const scope={authorId:tutorials[0].authorId,limit:1};
 const first=(await reader.get('/api/review-public-tutorials').query(scope)).body;
 expect(first.nextCursor).toBeTruthy();
 const target={treeId:'dianliang-review-catalog-v1',nodeId:'od-eq'};
 expect((await reader.post('/api/records').send({...target,text:'已代回检验',lightUp:true,visibility:'private'})).status).toBe(201);
 expect((await reader.post('/api/tutorials').send({...target,title:'另一位作者公开教程',method:'先检查两侧结果。',visibility:'public'})).status).toBe(201);
 const next=await reader.get('/api/review-public-tutorials').query({...scope,cursor:first.nextCursor});
 expect(next.status).toBe(200);
 expect(next.body.revision).toBe(first.revision);
 expect(next.body.tutorials[0].id).not.toBe(first.tutorials[0].id);
 expect((await reader.get('/api/review-public-tutorials').query({...scope,limit:2,cursor:first.nextCursor})).status).toBe(409);
});
it('invalidates cursors and direct results when an author withdraws or archives a tutorial',async()=>{
 const first=await reader.get('/api/review-public-tutorials').query({limit:1});expect((await author.patch('/api/tutorials/'+tutorials[0].id).set('If-Match',tutorials[0].version).send({visibility:'private'})).status).toBe(200);expect((await reader.get('/api/review-public-tutorials').query({limit:1,cursor:first.body.nextCursor})).status).toBe(409);expect((await reader.get('/api/review-public-tutorials/one').query({id:tutorials[0].id})).status).toBe(404);expect((await author.delete('/api/tutorials/'+tutorials[1].id)).status).toBe(200);expect((await reader.get('/api/review-public-tutorials')).body.total).toBe(0);
});
it('refuses corrupted public content without changing the original store or exposing arbitrary fields',async()=>{
 const file=path.join(directory,'tutorials.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data[0].versions[0].method='CORRUPTED-PUBLIC';data[0].secret='PRIVATE-CREDENTIAL';const bytes=JSON.stringify(data);fs.writeFileSync(file,bytes);const r=await reader.get('/api/review-public-tutorials');expect(r.status).toBe(503);expect(JSON.stringify(r.body)).not.toContain('PRIVATE-CREDENTIAL');expect(fs.readFileSync(file,'utf8')).toBe(bytes);
});
it('enforces authentication, expected actor, origin and bounded query parameters',async()=>{
 expect((await request(app).get('/api/review-public-tutorials')).status).toBe(401);expect((await reader.get('/api/review-public-tutorials').set('X-Action-Account','someone-else')).status).toBe(409);expect((await reader.get('/api/review-public-tutorials').set('Origin','https://not-authorized.example')).status).toBe(403);for(const args of [{query:'x'.repeat(121)},{limit:51},{limit:0},{query:['a','b']}])expect((await reader.get('/api/review-public-tutorials').query(args)).status).toBe(400);
});
it('persists questions and peer replies with exact versions, explicit public consent and idempotent retry',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,body={text:'我在代回这一步卡住了。',tutorialVersion:t.version,parentId:null,requestId:'reader-question',consent:true};expect((await reader.post(url).send({...body,consent:false})).status).toBe(403);const a=await reader.post(url).send(body);expect(a.status).toBe(201);expect((await reader.post(url).send(body)).body.comment.id).toBe(a.body.comment.id);expect((await reader.post(url).send({...body,text:'不同请求内容'})).status).toBe(409);const answer=await author.post(url).send({text:'先把求出的数代入左侧，再比较两侧。',tutorialVersion:t.version,parentId:a.body.comment.id,requestId:'author-answer',consent:true});expect(answer.status).toBe(201);const comments=(await reader.get(url)).body.comments;expect(comments).toHaveLength(2);expect(comments[1].parentId).toBe(comments[0].id);expect(comments[0].tutorialVersion).toBe(t.version);expect(comments[1].authorName).toBe('搜索作者');expect(comments[1]).not.toHaveProperty('requestId');expect((await reader.get('/api/review-account-export')).body.service.discussionEntries.map(e=>e.text)).toEqual([body.text]);
});
it('allows only the author to withdraw and restore a comment, retaining peer replies and backup content',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,a=(await reader.post(url).send({text:'需要解释的步骤',tutorialVersion:t.version,parentId:null,requestId:'withdraw-question',consent:true})).body.comment;await author.post(url).send({text:'回复仍然保留。',tutorialVersion:t.version,parentId:a.id,requestId:'answer-kept',consent:true});const action=url+'/'+a.id;expect((await author.post(action+'/withdraw').set('If-Match',a.revision).send({consent:true})).status).toBe(404);expect((await reader.post(action+'/withdraw').set('If-Match','wrong').send({consent:true})).status).toBe(409);const withdrawn=await reader.post(action+'/withdraw').set('If-Match',a.revision).send({consent:true});expect(withdrawn.status).toBe(200);const entries=(await author.get(url)).body.comments;expect(entries[0].text).toBe('');expect(entries[0].withdrawn).toBe(true);expect(entries[1].text).toBe('回复仍然保留。');expect((await reader.post(action+'/restore').set('If-Match',withdrawn.body.comment.revision).send({consent:true})).status).toBe(200);expect((await author.get(url)).body.comments[0].text).toBe('需要解释的步骤');
});
it('refuses stale tutorial publication and preserves corrupt discussion files without exposing their content',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id;expect((await reader.post(url).send({text:'旧版本卡点',tutorialVersion:'outdated',parentId:null,requestId:'stale-version',consent:true})).status).toBe(409);expect((await reader.post(url).send({text:'找不到的回复',tutorialVersion:t.version,parentId:'missing-parent',requestId:'bad-parent',consent:true})).status).toBe(409);const file=path.join(directory,'tutorial-discussions',t.id+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{damaged');expect((await reader.get(url)).status).toBe(503);expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
});
it('keeps reply context across pages and redacts withdrawn parent text in every response',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,question=(await reader.post(url).send({text:'PARENT-TEXT-TO-WITHDRAW',tutorialVersion:t.version,parentId:null,requestId:'parent-context',consent:true})).body.comment;await author.post(url).send({text:'分页后的回答',tutorialVersion:t.version,parentId:question.id,requestId:'reply-context',consent:true});const first=(await reader.get(url).query({limit:1})).body,second=(await reader.get(url).query({limit:1,cursor:first.nextCursor,replyTo:question.id})).body;expect(second.comments[0].replyContext.text).toBe('PARENT-TEXT-TO-WITHDRAW');expect(second.replyTarget.id).toBe(question.id);expect(second.comments[0].replyContext).not.toHaveProperty('requestId');expect((await reader.post(url+'/'+question.id+'/withdraw').set('If-Match',question.revision).send({consent:true})).status).toBe(200);const redacted=(await author.get(url).query({replyTo:question.id})).body;expect(redacted.comments[1].replyContext.withdrawn).toBe(true);expect(redacted.comments[1].replyContext.text).toBe('');expect(redacted.replyTarget.text).toBe('');expect(JSON.stringify(redacted)).not.toContain('PARENT-TEXT-TO-WITHDRAW');
});
it('keeps only the reader own discussion history after a tutorial becomes private and permits withdrawing the original record',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,mine=(await reader.post(url).send({text:'READER-ARCHIVE-ORIGINAL',tutorialVersion:t.version,parentId:null,requestId:'archive-reader',consent:true})).body.comment;await author.post(url).send({text:'OTHER-AUTHOR-REPLY',tutorialVersion:t.version,parentId:mine.id,requestId:'archive-author',consent:true});expect((await author.patch('/api/tutorials/'+t.id).set('If-Match',t.version).send({visibility:'private'})).status).toBe(200);expect((await reader.get(url)).status).toBe(404);const own=await reader.get('/api/review-owned-discussions');expect(own.status).toBe(200);expect(own.body.entries).toHaveLength(1);expect(own.body.entries[0].text).toBe('READER-ARCHIVE-ORIGINAL');expect(own.body.entries[0].tutorialSnapshot.version).toBe(t.version);expect(own.body.entries[0].publicAvailable).toBe(false);expect(JSON.stringify(own.body)).not.toContain('OTHER-AUTHOR-REPLY');const entry=own.body.entries[0];expect((await reader.post(url+'/'+entry.id+'/withdraw').set('If-Match',entry.revision).send({consent:true})).status).toBe(200);const withdrawn=(await reader.get('/api/review-owned-discussions')).body.entries[0];expect(withdrawn.withdrawn).toBe(true);expect(withdrawn.text).toBe('READER-ARCHIVE-ORIGINAL');expect((await reader.post(url+'/'+entry.id+'/restore').set('If-Match',withdrawn.revision).send({consent:true})).status).toBe(404);expect((await request(app).get('/api/review-owned-discussions')).status).toBe(401);expect((await author.get('/api/review-owned-discussions').set('X-Action-Account',own.body.ownerId)).status).toBe(409);expect((await reader.get('/api/review-owned-discussions').set('Origin','https://not-authorized.example')).status).toBe(403);
});
it('paginates and searches owned discussions while distinguishing an unreadable public status from withdrawal',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id;for(let i=0;i<2;i++)expect((await reader.post(url).send({text:'本人历史问题 '+i,tutorialVersion:t.version,parentId:null,requestId:'owned-page-'+i,consent:true})).status).toBe(201);const first=(await reader.get('/api/review-owned-discussions').query({limit:1})).body,second=(await reader.get('/api/review-owned-discussions').query({limit:1,cursor:first.nextCursor})).body;expect(first.total).toBe(2);expect(second.entries[0].id).not.toBe(first.entries[0].id);expect((await reader.get('/api/review-owned-discussions').query({query:'历史问题 1'})).body.total).toBe(1);const file=path.join(directory,'tutorials.json'),values=JSON.parse(fs.readFileSync(file,'utf8'));values[0].method='CORRUPTED-CURRENT-METHOD';fs.writeFileSync(file,JSON.stringify(values));const own=await reader.get('/api/review-owned-discussions');expect(own.status).toBe(200);expect(own.body.entries.every(e=>e.publicAvailable===null)).toBe(true);expect(own.body.entries.every(e=>e.tutorialSnapshot.version===t.version)).toBe(true);expect((await reader.get('/api/review-owned-discussions').query({limit:51})).status).toBe(400);
});
it('returns only peer direct replies to this reader and removes withdrawn or inaccessible content',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,question=(await reader.post(url).send({text:'我的问题',tutorialVersion:t.version,parentId:null,requestId:'received-parent',consent:true})).body.comment;const answer=(await author.post(url).send({text:'对你的回答',tutorialVersion:t.version,parentId:question.id,requestId:'received-peer',consent:true})).body.comment;await reader.post(url).send({text:'我自己的补充',tutorialVersion:t.version,parentId:question.id,requestId:'received-self',consent:true});await author.post(url).send({text:'另一条无关问题',tutorialVersion:t.version,parentId:null,requestId:'received-unrelated',consent:true});const inbox=await reader.get('/api/review-received-replies');expect(inbox.status).toBe(200);expect(inbox.body.replies.map(e=>e.id)).toEqual([answer.id]);expect(inbox.body.replies[0].replyContext.text).toBe('我的问题');expect(inbox.body.replies[0]).not.toHaveProperty('requestId');expect((await author.get('/api/review-received-replies')).body.total).toBe(0);expect((await author.post(url+'/'+answer.id+'/withdraw').set('If-Match',answer.revision).send({consent:true})).status).toBe(200);expect((await reader.get('/api/review-received-replies')).body.total).toBe(0);expect((await author.post(url+'/'+answer.id+'/restore').set('If-Match',(await author.get('/api/review-owned-discussions')).body.entries.find(e=>e.id===answer.id).revision).send({consent:true})).status).toBe(200);await author.patch('/api/tutorials/'+t.id).set('If-Match',t.version).send({visibility:'private'});expect((await reader.get('/api/review-received-replies')).body.total).toBe(0);
});
it('paginates received replies and opens the exact response beyond the first discussion page',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,question=(await reader.post(url).send({text:'需要多人解答',tutorialVersion:t.version,parentId:null,requestId:'many-replies-parent',consent:true})).body.comment;let last;for(let i=0;i<31;i++){const r=await author.post(url).send({text:'回答 '+i,tutorialVersion:t.version,parentId:question.id,requestId:'many-replies-'+i,consent:true});expect(r.status).toBe(201);last=r.body.comment}const first=(await reader.get('/api/review-received-replies').query({limit:1})).body,second=(await reader.get('/api/review-received-replies').query({limit:1,cursor:first.nextCursor})).body;expect(first.total).toBe(31);expect(second.replies[0].id).not.toBe(first.replies[0].id);const focused=await reader.get(url).query({focus:last.id});expect(focused.status).toBe(200);expect(focused.body.comments.some(e=>e.id===last.id)).toBe(true);expect((await reader.get(url).query({focus:'missing-response'})).status).toBe(404);expect((await request(app).get('/api/review-received-replies')).status).toBe(401);expect((await author.get('/api/review-received-replies').set('X-Action-Account',first.ownerId)).status).toBe(409);
});
it('persists exact received reply read state idempotently without marking new replies or another account',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,q=(await reader.post(url).send({text:'读状态测试问题',tutorialVersion:t.version,parentId:null,requestId:'read-parent',consent:true})).body.comment;const answer=async id=>(await author.post(url).send({text:'回复 '+id,tutorialVersion:t.version,parentId:q.id,requestId:id,consent:true})).body.comment;await answer('read-first');let inbox=(await reader.get('/api/review-received-replies')).body;expect(inbox.unreadCount).toBe(1);const e=inbox.replies[0],body={tutorialId:t.id,replyId:e.id,digest:e.digest};expect((await author.post('/api/review-received-replies/read').send(body)).status).toBe(404);expect((await reader.post('/api/review-received-replies/read').send({...body,digest:'a'.repeat(64)})).status).toBe(409);const first=await reader.post('/api/review-received-replies/read').send(body);expect(first.status).toBe(200);const repeated=await reader.post('/api/review-received-replies/read').send(body);expect(repeated.body.repeated).toBe(true);expect(repeated.body.entry.readAt).toBe(first.body.entry.readAt);inbox=(await reader.get('/api/review-received-replies')).body;expect(inbox.unreadCount).toBe(0);expect(inbox.replies[0].unread).toBe(false);await answer('read-new');inbox=(await reader.get('/api/review-received-replies')).body;expect(inbox.unreadCount).toBe(1);expect(inbox.replies.find(r=>r.id===e.id).unread).toBe(false);expect((await reader.get('/api/review-account-export')).body.service.replyReadState.entries).toHaveLength(1);const ownerId=inbox.ownerId,file=path.join(directory,'reply-read-state',ownerId+'.json'),bytes=fs.readFileSync(file,'utf8');expect(JSON.parse(bytes).entries).toHaveLength(1);fs.writeFileSync(file,'{damaged');expect((await reader.get('/api/review-received-replies')).status).toBe(503);expect((await reader.post('/api/review-received-replies/read').send(body)).status).toBe(503);expect(fs.readFileSync(file,'utf8')).toBe('{damaged');
});
it('filters unread replies with scope-bound cursors and updates results after an exact read confirmation',async()=>{
 const t=tutorials[0],url='/api/review-tutorial-discussions/'+t.id,q=(await reader.post(url).send({text:'未读筛选问题',tutorialVersion:t.version,parentId:null,requestId:'scope-parent',consent:true})).body.comment;for(let i=0;i<3;i++)await author.post(url).send({text:'筛选回答 '+i,tutorialVersion:t.version,parentId:q.id,requestId:'scope-answer-'+i,consent:true});const all=(await reader.get('/api/review-received-replies').query({limit:1})).body,unread=(await reader.get('/api/review-received-replies').query({scope:'unread',limit:1})).body;expect(all.scope).toBe('all');expect(unread.total).toBe(3);expect(unread.replies.every(e=>e.unread)).toBe(true);expect((await reader.get('/api/review-received-replies').query({scope:'unread',cursor:all.nextCursor})).status).toBe(409);const e=unread.replies[0];await reader.post('/api/review-received-replies/read').send({tutorialId:e.tutorialId,replyId:e.id,digest:e.digest});const updated=(await reader.get('/api/review-received-replies').query({scope:'unread'})).body;expect(updated.total).toBe(2);expect(updated.availableTotal).toBe(3);expect(updated.replies.some(r=>r.id===e.id)).toBe(false);expect((await reader.get('/api/review-received-replies').query({scope:'unread',cursor:unread.nextCursor})).status).toBe(409);expect((await reader.get('/api/review-received-replies').query({scope:'unknown'})).status).toBe(400);
});
