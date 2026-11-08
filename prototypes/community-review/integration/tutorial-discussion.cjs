const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicJson,commitTransaction,recoverTransactions}=require('../../../storage-transaction');
const {readPublicTutorials}=require('./public-tutorial-search.cjs');
const {readReplyReadState,installReplyReadRoute}=require('./reply-read-state.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const replyDigest=(e,tutorialId)=>hash({tutorialId,id:e.id,authorId:e.authorId,text:e.text,parentId:e.parentId,createdAt:e.createdAt,version:e.tutorialSnapshot.version});
function threadFile(config,id){
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Invalid tutorial ID');
 return path.join(config.dataDir,'tutorial-discussions',id+'.json');
}
function threadBytes(file){try{return fs.readFileSync(file)}catch(error){if(error.code==='ENOENT')return null;throw error}}
function parseThread(bytes,id){
 const data=bytes===null?{format:'dianliang-tutorial-discussion/v1',tutorialId:id,entries:[]}:JSON.parse(bytes.toString('utf8'));
 if(data.format!=='dianliang-tutorial-discussion/v1'||data.tutorialId!==id||!Array.isArray(data.entries))throw Error('Invalid thread');
 const seen=new Set();for(const e of data.entries){if(!e||Object.keys(e).some(k=>!['id','authorId','authorName','text','parentId','createdAt','withdrawnAt','requestId','fingerprint','tutorialSnapshot','snapshotHash','moderated','moderationId','lastAppealId'].includes(k))||typeof e.id!=='string'||seen.has(e.id)||typeof e.authorId!=='string'||typeof e.authorName!=='string'||!e.authorName.trim()||typeof e.text!=='string'||!e.text.trim()||e.text.length>3000||!Number.isFinite(e.createdAt)||e.withdrawnAt!==null&&!Number.isFinite(e.withdrawnAt)||e.moderated!==undefined&&(e.moderated!==true||e.withdrawnAt===null)||e.moderationId!==undefined&&(e.moderated!==true||!/^[a-f0-9]{64}$/.test(e.moderationId))||e.lastAppealId!==undefined&&(typeof e.lastAppealId!=='string'||!/^[a-f0-9]{64}$/.test(e.lastAppealId))||typeof e.requestId!=='string'||typeof e.fingerprint!=='string'||e.tutorialSnapshot?.id!==id||typeof e.tutorialSnapshot.version!=='string'||!e.tutorialSnapshot.target||e.snapshotHash!==hash(e.tutorialSnapshot)||e.fingerprint!==hash({text:e.text,tutorialVersion:e.tutorialSnapshot.version,parentId:e.parentId})||e.parentId!==null&&!seen.has(e.parentId))throw Error('Invalid comment');seen.add(e.id)}
 return data;
}
function readThread(config,id){recoverTransactions(config.dataDir);const file=threadFile(config,id);return {file,data:parseThread(threadBytes(file),id)}}
function createThreadPageReader(config){
 const cache=new Map(),maxBytes=8*1024*1024,maxFile=4*1024*1024,maxThreads=64;let retained=0;
 function drop(file){const previous=cache.get(file);if(previous){retained-=previous.bytes.length;cache.delete(file)}}
 return (id,{scan=false}={})=>{
  recoverTransactions(config.dataDir);
  const file=threadFile(config,id),bytes=threadBytes(file),previous=cache.get(file);
  if(bytes&&previous?.bytes.equals(bytes)){if(!scan){cache.delete(file);cache.set(file,previous)}return previous}
  drop(file);
  const {entries}=parseThread(bytes,id),positions=new Map(entries.map((entry,index)=>[entry.id,index]));
  const revision=crypto.createHash('sha256').update(bytes??'').digest('hex'),snapshot={bytes,entries,positions,revision};
  if(bytes&&bytes.length<=maxFile){
   const fits=()=>cache.size<maxThreads&&retained+bytes.length<=maxBytes;
   // A full archive scan must not displace pages being actively browsed.
   if(!scan)while(!fits())drop(cache.keys().next().value);
   if(fits()){cache.set(file,snapshot);retained+=bytes.length}
  }
  return snapshot;
 };
}
function disclosedComment(e,user){return {id:e.id,authorId:e.authorId,authorName:e.authorName,parentId:e.parentId,createdAt:e.createdAt,withdrawn:e.withdrawnAt!==null,text:e.withdrawnAt!==null?'':e.text,tutorialVersion:e.tutorialSnapshot.version,tutorialTitle:e.tutorialSnapshot.title,targetTitle:e.tutorialSnapshot.target.title,targetVersion:e.tutorialSnapshot.target.version,mine:e.authorId===user.id,...(e.authorId===user.id?{revision:hash(e),moderated:e.moderated===true}:{})}}
function discussionIds(config){const directory=path.join(config.dataDir,'tutorial-discussions');try{return fs.readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>name.slice(0,-5))}catch(error){if(error.code==='ENOENT')return [];throw error}}
function readOwnedDiscussions(config,user){return discussionIds(config).flatMap(id=>readThread(config,id).data.entries.filter(e=>e.authorId===user.id).map(e=>({tutorialId:id,...e})))}
const newestFirst=(a,b)=>b.entry.createdAt-a.entry.createdAt||a.entry.id.localeCompare(b.entry.id);
const searchText=value=>value.normalize('NFKC').toLowerCase();
function archivePage(res,cursor,revision,total,limit,changed){
 let offset=0;
 if(cursor){const [r,p,...rest]=cursor.split(':');if(rest.length||r!==revision||!/^(0|[1-9][0-9]*)$/.test(p||'')){res.status(409).json({ok:false,code:'DISCUSSION_CURSOR_CHANGED',message:changed});return null}offset=Number(p);if(!Number.isSafeInteger(offset)||offset>total){res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});return null}}
 return {offset,meta:{pageNumber:Math.floor(offset/limit)+1,pageCount:Math.max(1,Math.ceil(total/limit)),previousCursor:offset>0?revision+':'+Math.max(0,offset-limit):null,nextCursor:offset+limit<total?revision+':'+(offset+limit):null}};
}
function installTutorialDiscussion(app,{config,authenticate,moderatorIds=[],commit=commitTransaction}){
 const moderators=new Set(moderatorIds),reportDirectory=path.join(config.dataDir,'discussion-reports'),appealDirectory=path.join(config.dataDir,'discussion-appeals');
 const readPageThread=createThreadPageReader(config);
 const indexes=new WeakMap();
 function archiveIndex(thread,id){
  if(indexes.has(thread))return indexes.get(thread);
  const own=new Map(),received=new Map();
  function add(map,key,value){if(!map.has(key))map.set(key,[]);map.get(key).push(value)}
  for(const entry of thread.entries){
   add(own,entry.authorId,entry);
   const parent=thread.entries[thread.positions.get(entry.parentId)];
   if(parent&&parent.authorId!==entry.authorId&&entry.withdrawnAt===null)add(received,parent.authorId,{entry,parent,digest:replyDigest(entry,id),key:JSON.stringify([id,entry.id])});
  }
  const index={own,received};indexes.set(thread,index);return index;
 }
 installReplyReadRoute(app,{config,authenticate,resolveReply:(tutorialId,id,u)=>{if(!readPublicTutorials(config).some(t=>t.id===tutorialId))return null;const {data}=readThread(config,tutorialId),e=data.entries.find(e=>e.id===id),parent=e&&data.entries.find(p=>p.id===e.parentId);return e&&e.withdrawnAt===null&&e.authorId!==u.id&&parent?.authorId===u.id?{digest:replyDigest(e,tutorialId)}:null}});
 function user(req,res){const u=authenticate(req);if(!u){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return u}
 function current(req,res){const t=readPublicTutorials(config).find(t=>t.id===req.params.id);if(!t)res.status(404).json({ok:false,code:'DISCUSSION_UNAVAILABLE',message:'教程或目标已不可公开读取，讨论原件保留。'});return t}
 function receivedArchive(u){
   const seen=new Map(readReplyReadState(config,u).state.entries.map(e=>[JSON.stringify([e.tutorialId,e.replyId]),e.digest])),entries=[],sources=[];
   for(const t of readPublicTutorials(config)){
    const thread=readPageThread(t.id,{scan:true}),matches=archiveIndex(thread,t.id).received.get(u.id);
    if(!matches?.length)continue;
    sources.push([t.id,thread.revision]);
    for(const ref of matches)entries.push({...ref,tutorialId:t.id,treeId:t.treeId,nodeId:t.nodeId,unread:seen.get(ref.key)!==ref.digest});
   }
   return {entries,sources};
 }
 app.get('/api/review-received-replies/summary',(req,res)=>{
  const u=user(req,res);if(!u)return;
  try{
   const {entries}=receivedArchive(u);
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,unreadCount:entries.filter(entry=>entry.unread).length});
  }catch{return res.status(503).json({ok:false,code:'RECEIVED_REPLIES_UNREADABLE'})}
 });
 app.get('/api/review-received-replies',(req,res)=>{
  const u=user(req,res);if(!u)return;const cursor=req.query.cursor??'',scope=req.query.scope??'all',limit=req.query.limit===undefined?25:Number(req.query.limit);if(!['all','unread'].includes(scope)||typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});
  try{
   const {entries,sources}=receivedArchive(u);
   entries.sort(newestFirst);
   const unread=entries.filter(e=>e.unread),matches=scope==='unread'?unread:entries,revision=hash({ownerId:u.id,scope,limit,sources,read:entries.map(e=>!e.unread)});
   const page=archivePage(res,cursor,revision,matches.length,limit,'收到的回复有变化，请重新读取第一页。');if(!page)return;
   const replies=matches.slice(page.offset,page.offset+limit).map(({tutorialId,treeId,nodeId,entry,parent,digest,unread})=>({tutorialId,treeId,nodeId,...disclosedComment(entry,u),digest,unread,replyContext:{id:parent.id,text:parent.withdrawnAt!==null?'':parent.text,withdrawn:parent.withdrawnAt!==null,tutorialVersion:parent.tutorialSnapshot.version}}));
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,total:matches.length,availableTotal:entries.length,scope,unreadCount:unread.length,replies,...page.meta});
  }catch{return res.status(503).json({ok:false,code:'RECEIVED_REPLIES_UNREADABLE',message:'回复暂时无法核对，原讨论保留。'})}
 });
 app.get('/api/review-owned-discussions',(req,res)=>{
  const u=user(req,res);if(!u)return;const cursor=req.query.cursor??'',query=req.query.query??'',limit=req.query.limit===undefined?25:Number(req.query.limit);if(typeof cursor!=='string'||cursor.length>100||typeof query!=='string'||query.length>120||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});
  try{
   let available=null;try{available=new Map(readPublicTutorials(config).map(t=>[t.id,t.version]))}catch{}
   const own=[],sources=[],needle=searchText(query.trim());
   for(const tutorialId of discussionIds(config)){
    const thread=readPageThread(tutorialId,{scan:true}),entries=archiveIndex(thread,tutorialId).own.get(u.id);
    if(!entries?.length)continue;
    const version=available?.get(tutorialId),publicAvailable=available?version!==undefined:null;
    sources.push([tutorialId,thread.revision,publicAvailable,version??null]);
    for(const entry of entries){const snapshot=entry.tutorialSnapshot;if(needle&&![entry.text,snapshot.title,snapshot.target.title,snapshot.target.goal].some(s=>searchText(s).includes(needle)))continue;own.push({tutorialId,entry,publicAvailable,currentVersionMatches:available?version===snapshot.version:null})}
   }
   own.sort(newestFirst);const revision=hash({ownerId:u.id,query,limit,sources}),page=archivePage(res,cursor,revision,own.length,limit,'本人讨论或公开范围已有变化，请重新读取第一页。');if(!page)return;
   const legacyAppeal=legacyAppealsFor(u.id);
   const entries=own.slice(page.offset,page.offset+limit).map(({tutorialId,entry,publicAvailable,currentVersionMatches})=>({id:entry.id,tutorialId,authorName:entry.authorName,text:entry.text,parentId:entry.parentId,createdAt:entry.createdAt,withdrawn:entry.withdrawnAt!==null,moderated:entry.moderated===true,appeal:ownAppealStatus(entry,tutorialId,legacyAppeal),revision:hash(entry),tutorialSnapshot:entry.tutorialSnapshot,publicAvailable,currentVersionMatches}));
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,total:own.length,entries,...page.meta});
  }catch{return res.status(503).json({ok:false,code:'OWNED_DISCUSSION_UNREADABLE',message:'本人讨论档案无法核对，原文件保留。'})}
 });
 function moderator(req,res){
  res.set('Cache-Control','no-store');
  const u=user(req,res);
  if(!u)return null;
  if(moderators.has(u.id))return u;
  res.status(403).json({ok:false,code:'DISCUSSION_MODERATOR_REQUIRED'});
  return null;
 }
 function readReport(id){
  recoverTransactions(config.dataDir);
  const bytes=threadBytes(path.join(reportDirectory,id+'.json'));
  if(!bytes)return null;
  const report=JSON.parse(bytes.toString('utf8'));
  if(report.format!=='dianliang-discussion-report/v1'||report.id!==id||hash([report.reporterId,report.tutorialId,report.commentId])!==id||!Number.isFinite(report.createdAt)||typeof report.evidence?.text!=='string')throw Error('Invalid discussion report');
  return report;
 }
 function disclosedReport(report){
  return {id:report.id,tutorialId:report.tutorialId,commentId:report.commentId,reason:report.reason,details:report.details??'',createdAt:report.createdAt,evidence:report.evidence,decision:report.decision??null,revision:hash(report)};
 }
 const reportTarget=({tutorialId,commentId})=>JSON.stringify([tutorialId,commentId]);
 function canReviewReport(report,userId,reported){
  return report.evidence.authorId!==userId&&!(reported
   ? reported.has(reportTarget(report))
   : readReport(hash([userId,report.tutorialId,report.commentId])));
 }
 function appealConflicts(userId){
  const reported=new Set(listReports().filter(report=>report.reporterId===userId).map(report=>JSON.stringify([report.tutorialId,report.commentId])));
  return appeal=>appeal.authorId===userId||reported.has(JSON.stringify([appeal.tutorialId,appeal.commentId]));
 }
 function listReports(){
  const files=fs.existsSync(reportDirectory)?fs.readdirSync(reportDirectory):[];
  return files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>readReport(name.slice(0,-5))).filter(Boolean)
   .sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
 }
 app.get('/api/review-tutorial-discussions/reports/mine',(req,res)=>{
  const u=user(req,res);if(!u)return;
  res.set('Cache-Control','no-store');
  const cursor=req.query.cursor??'',limit=req.query.limit===undefined?25:Number(req.query.limit);
  const scope=req.query.status??'all';
  if(!['all','pending','processed'].includes(scope)||typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'DISCUSSION_REPORT_STATUS_INPUT'});
  try{
   const allReports=listReports();
   const owned=allReports.filter(report=>report.reporterId===u.id&&(scope==='all'||(scope==='processed')===Boolean(report.decision)));
   let legacyAppeals;
   const reports=owned.map(report=>{
    const status=report.decision?.outcome??'pending';
    let appeal=status==='substantiated'?readAppeal(hash([report.evidence.authorId,report.tutorialId,report.commentId,report.moderationId??report.id])):null;
    if(status==='substantiated'&&!appeal&&!report.moderationId){
     legacyAppeals??=listAppeals();
     const candidates=legacyAppeals.filter(candidate=>{
      if(!candidate.decision||candidate.authorId!==report.evidence.authorId||candidate.tutorialId!==report.tutorialId||candidate.commentId!==report.commentId)return false;
      const original=allReports.find(item=>item.id===candidate.moderationId);
      return original?.decision?.outcome==='substantiated'&&original.afterAppealId===report.afterAppealId&&
       original.decision.decidedAt<=report.decision.decidedAt&&report.decision.decidedAt<=candidate.decision.decidedAt;
     });
     if(candidates.length===1)appeal=candidates[0];
    }
    return {
     id:report.id,tutorialTitle:report.tutorialTitle??null,reason:report.reason,createdAt:report.createdAt,
     status,decidedAt:report.decision?.decidedAt??null,
     ...(appeal?.decision?.outcome==='overturned'?{restrictionLiftedAt:appeal.decision.decidedAt}:{}),
    };
   });
   const revision=hash({ownerId:u.id,scope,limit,reports});
   const page=archivePage(res,cursor,revision,reports.length,limit,'你的举报状态已变化，请重新读取第一页。');
   if(!page)return;
   return res.json({ok:true,ownerId:u.id,scope,total:reports.length,reports:reports.slice(page.offset,page.offset+limit),...page.meta});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_REPORTS_UNREADABLE'})}
 });
 app.get('/api/review-tutorial-discussions/moderation/access',(req,res)=>{
  const u=user(req,res);if(!u)return;
  return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,allowed:moderators.has(u.id)});
 });
 function readAppeal(id){
  recoverTransactions(config.dataDir);
  const bytes=threadBytes(path.join(appealDirectory,id+'.json'));
  if(!bytes)return null;
  const appeal=JSON.parse(bytes.toString('utf8'));
  if(appeal.format!=='dianliang-discussion-appeal/v1'||appeal.id!==id||hash([appeal.authorId,appeal.tutorialId,appeal.commentId,...(appeal.moderationId?[appeal.moderationId]:[])])!==id||!Number.isFinite(appeal.createdAt)||typeof appeal.explanation!=='string')throw Error('Invalid discussion appeal');
  return appeal;
 }
 function disclosedAppeal(a){
  return {id:a.id,tutorialId:a.tutorialId,commentId:a.commentId,createdAt:a.createdAt,explanation:a.explanation,decision:a.decision??null,revision:hash(a)};
 }
 function appealIdFor(entry,tutorialId){
  return hash([entry.authorId,tutorialId,entry.id,...(entry.moderationId?[entry.moderationId]:[])]);
 }
 function listAppeals(){
  const files=fs.existsSync(appealDirectory)?fs.readdirSync(appealDirectory):[];
  return files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>readAppeal(name.slice(0,-5))).filter(Boolean)
   .sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
 }
 function legacyAppealsFor(ownerId){
  let index;
  return (tutorialId,commentId)=>{
   if(!index){
    index=new Map();
    for(const appeal of listAppeals()){
     if(appeal.authorId!==ownerId||appeal.decision?.outcome!=='overturned')continue;
     const key=JSON.stringify([appeal.tutorialId,appeal.commentId]);
     if(!index.has(key))index.set(key,appeal);
    }
   }
   return index.get(JSON.stringify([tutorialId,commentId]));
  };
 }
 function ownAppealStatus(entry,tutorialId,legacyAppeal){
  const id=entry.moderated?appealIdFor(entry,tutorialId):entry.lastAppealId;
  const appeal=id?readAppeal(id):legacyAppeal(tutorialId,entry.id);
  if(!appeal)return null;
  if(appeal.authorId!==entry.authorId||appeal.tutorialId!==tutorialId||appeal.commentId!==entry.id)throw Error('Discussion appeal owner mismatch');
  return {status:appeal.decision?.outcome??'pending',createdAt:appeal.createdAt,decidedAt:appeal.decision?.decidedAt??null,...(appeal.decision?.authorMessage?{authorMessage:appeal.decision.authorMessage}:{})};
 }
 app.get('/api/review-tutorial-discussions/moderation/appeals',(req,res)=>{
  const u=moderator(req,res);if(!u)return;
  const status=req.query.status??'all',cursor=req.query.cursor??'',limit=req.query.limit===undefined?25:Number(req.query.limit);
  if(!['all','pending','processed'].includes(status)||typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'DISCUSSION_APPEAL_INPUT'});
  try{
   const conflicts=appealConflicts(u.id);
   const appeals=listAppeals().filter(a=>!conflicts(a)&&(status==='all'||(status==='processed')===Boolean(a.decision)));
   const page=archivePage(res,cursor,hash({ownerId:u.id,status,limit,appeals}),appeals.length,limit,'申诉队列已变化，请重新读取第一页。');
   if(!page)return;
   const rows=appeals.slice(page.offset,page.offset+limit).map(a=>{
    const comment=readPageThread(a.tutorialId,{scan:true}).entries.find(e=>e.id===a.commentId&&e.authorId===a.authorId);
    const report=a.moderationId?readReport(a.moderationId):listReports().find(r=>r.tutorialId===a.tutorialId&&r.commentId===a.commentId&&r.decision?.outcome==='substantiated');
    return {...disclosedAppeal(a),original:comment?{text:comment.text,tutorialTitle:comment.tutorialSnapshot.title,tutorialVersion:comment.tutorialSnapshot.version}:null,originalDecision:report?.decision?{note:report.decision.note,decidedAt:report.decision.decidedAt}:null};
   });
   return res.json({ok:true,ownerId:u.id,status,total:appeals.length,appeals:rows,...page.meta});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_APPEALS_UNREADABLE'})}
 });
 app.get('/api/review-tutorial-discussions/moderation/appeals/:appealId',(req,res)=>{
  const u=moderator(req,res);if(!u)return;
  const id=req.params.appealId;
  if(!/^[a-f0-9]{64}$/.test(id))return res.status(400).json({ok:false,code:'DISCUSSION_APPEAL_INPUT'});
  try{
   const appeal=readAppeal(id);
   if(!appeal)return res.status(404).json({ok:false,code:'DISCUSSION_APPEAL_UNAVAILABLE'});
   if(appealConflicts(u.id)(appeal))return res.status(403).json({ok:false,code:'DISCUSSION_REVIEW_CONFLICT',message:'与本人有关的申诉须由其他审核员复核。'});
   return res.json({ok:true,ownerId:u.id,appeal:disclosedAppeal(appeal)});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_APPEALS_UNREADABLE'})}
 });
 app.post('/api/review-tutorial-discussions/moderation/appeals/:appealId',(req,res)=>{
  const u=moderator(req,res);if(!u)return;
  const id=req.params.appealId,b=req.body;
  if(!/^[a-f0-9]{64}$/.test(id)||!b||Object.keys(b).some(k=>!['outcome','note','authorMessage'].includes(k))||!['upheld','overturned'].includes(b.outcome)||typeof b.note!=='string'||!b.note.trim()||b.note.length>1000||b.authorMessage!==undefined&&(typeof b.authorMessage!=='string'||b.authorMessage.length>1000))return res.status(400).json({ok:false,code:'DISCUSSION_APPEAL_INPUT'});
  try{
   const appeal=readAppeal(id);
   if(!appeal)return res.status(404).json({ok:false,code:'DISCUSSION_APPEAL_UNAVAILABLE'});
   if(appealConflicts(u.id)(appeal))return res.status(403).json({ok:false,code:'DISCUSSION_REVIEW_CONFLICT',message:'与本人有关的申诉须由其他审核员复核。'});
   const note=b.note.trim(),authorMessage=b.authorMessage?.trim()??'';
   if(appeal.decision?.reviewerId===u.id&&appeal.decision.outcome===b.outcome&&appeal.decision.note===note&&(appeal.decision.authorMessage??'')===authorMessage)return res.json({ok:true,appeal:disclosedAppeal(appeal),repeated:true});
   if(appeal.decision||req.get('If-Match')!==hash(appeal))return res.status(409).json({ok:false,code:'DISCUSSION_APPEAL_CHANGED'});
   const thread=readThread(config,appeal.tutorialId),comment=thread.data.entries.find(e=>e.id===appeal.commentId&&e.authorId===appeal.authorId);
   if(!comment?.moderated||comment.moderationId!==appeal.moderationId)return res.status(409).json({ok:false,code:'DISCUSSION_APPEAL_CHANGED'});
   appeal.decision={reviewerId:u.id,outcome:b.outcome,note,...(authorMessage?{authorMessage}:{}),decidedAt:Date.now()};
   const file=path.join(appealDirectory,id+'.json');
   if(b.outcome==='overturned'){
    delete comment.moderated;
    delete comment.moderationId;
    comment.lastAppealId=id;
    commit(config.dataDir,[{filePath:thread.file,value:thread.data},{filePath:file,value:appeal}]);
   }else atomicJson(file,appeal);
   return res.json({ok:true,appeal:disclosedAppeal(appeal),repeated:false});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_APPEAL_DECISION_UNCONFIRMED'})}
 });
 app.get('/api/review-tutorial-discussions/moderation/reports',(req,res)=>{
  const u=moderator(req,res);if(!u)return;
  const status=req.query.status??'all',cursor=req.query.cursor??'',limit=req.query.limit===undefined?25:Number(req.query.limit);
  if(!['all','pending','processed'].includes(status)||typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'DISCUSSION_REPORT_STATUS_INPUT'});
  try{
   const allReports=listReports();
   const reported=new Set(allReports.filter(report=>report.reporterId===u.id).map(reportTarget));
   const reports=allReports.filter(report=>canReviewReport(report,u.id,reported)&&(status==='all'||(status==='processed')===Boolean(report.decision)));
   const revision=hash({ownerId:u.id,status,limit,reports});
   const page=archivePage(res,cursor,revision,reports.length,limit,'举报队列已变化，请重新读取第一页。');
   if(!page)return;
   return res.json({ok:true,ownerId:u.id,status,total:reports.length,reports:reports.slice(page.offset,page.offset+limit).map(disclosedReport),...page.meta});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_REPORTS_UNREADABLE'})}
 });
 app.get('/api/review-tutorial-discussions/moderation/reports/:reportId',(req,res)=>{
  const u=moderator(req,res);if(!u)return;
  const id=req.params.reportId;
  if(!/^[a-f0-9]{64}$/.test(id))return res.status(400).json({ok:false,code:'DISCUSSION_REPORT_STATUS_INPUT'});
  try{
   const report=readReport(id);
   if(!report)return res.status(404).json({ok:false,code:'DISCUSSION_REPORT_UNAVAILABLE'});
   if(!canReviewReport(report,u.id))return res.status(403).json({ok:false,code:'DISCUSSION_REVIEW_CONFLICT',message:'与本人有关的举报须由其他审核员处理。'});
   return res.json({ok:true,report:disclosedReport(report)});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_REPORTS_UNREADABLE'})}
 });
 app.post('/api/review-tutorial-discussions/moderation/reports/:reportId',(req,res)=>{
  const u=moderator(req,res);if(!u)return;
  const id=req.params.reportId,b=req.body;
  if(!/^[a-f0-9]{64}$/.test(id)||!b||Object.keys(b).some(k=>!['outcome','note'].includes(k))||!['dismissed','substantiated'].includes(b.outcome)||typeof b.note!=='string'||!b.note.trim()||b.note.length>1000)return res.status(400).json({ok:false,code:'DISCUSSION_DECISION_INPUT'});
  try{
   const report=readReport(id);
   if(!report)return res.status(404).json({ok:false,code:'DISCUSSION_REPORT_UNAVAILABLE'});
   if(!canReviewReport(report,u.id))return res.status(403).json({ok:false,code:'DISCUSSION_REVIEW_CONFLICT',message:'与本人有关的举报须由其他审核员处理。'});
   const note=b.note.trim();
   if(report.decision?.reviewerId===u.id&&report.decision.outcome===b.outcome&&report.decision.note===note)return res.json({ok:true,report:disclosedReport(report),repeated:true});
   if(report.decision||req.get('If-Match')!==hash(report))return res.status(409).json({ok:false,code:'DISCUSSION_REPORT_CHANGED'});
   report.decision={reviewerId:u.id,outcome:b.outcome,note,decidedAt:Date.now()};
   const file=path.join(reportDirectory,id+'.json');
   if(b.outcome==='substantiated'){
    const thread=readThread(config,report.tutorialId),comment=thread.data.entries.find(e=>e.id===report.commentId);
    if(!comment||comment.authorId!==report.evidence.authorId||comment.text!==report.evidence.text||comment.tutorialSnapshot.version!==report.evidence.tutorialVersion)throw Error('Reported discussion evidence mismatch');
    const previousAppeal=comment.lastAppealId?readAppeal(comment.lastAppealId):legacyAppealsFor(comment.authorId)(report.tutorialId,comment.id);
    if(previousAppeal&&(previousAppeal.authorId!==comment.authorId||previousAppeal.tutorialId!==report.tutorialId||previousAppeal.commentId!==comment.id))throw Error('Discussion appeal owner mismatch');
    if(previousAppeal?.decision?.outcome==='overturned'&&report.createdAt<=previousAppeal.decision.decidedAt&&report.afterAppealId!==previousAppeal.id)
     return res.status(409).json({ok:false,code:'DISCUSSION_REPORT_SUPERSEDED',message:'这条举报早于解除限制的复核结论，无法再次隐藏发言。可记录驳回结论。'});
    comment.withdrawnAt??=report.decision.decidedAt;
    if(!comment.moderated)comment.moderationId=report.id;
    if(comment.moderationId&&comment.moderationId!==report.id)report.moderationId=comment.moderationId;
    comment.moderated=true;
    commit(config.dataDir,[{filePath:thread.file,value:thread.data},{filePath:file,value:report}]);
   }else atomicJson(file,report);
   return res.json({ok:true,report:disclosedReport(report),repeated:false});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_DECISION_UNCONFIRMED'})}
 });
 app.get('/api/review-tutorial-discussions/:id/:commentId/report',(req,res)=>{
  const u=user(req,res);if(!u)return;
  res.set('Cache-Control','no-store');
  const {id,commentId}=req.params;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!/^[A-Za-z0-9_-]{1,100}$/.test(commentId))return res.status(400).json({ok:false,code:'DISCUSSION_REPORT_INPUT'});
  try{
   const report=readReport(hash([u.id,id,commentId]));
   return res.json({ok:true,ownerId:u.id,commentId,reportId:report?.id??null,
    ...(report?{submission:{reason:report.reason,details:report.details??''}}:{})});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_REPORT_UNCONFIRMED'})}
 });
 app.post('/api/review-tutorial-discussions/:id/:commentId/report',(req,res)=>{
  const u=user(req,res);if(!u)return;
  const {id,commentId}=req.params,b=req.body;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!/^[A-Za-z0-9_-]{1,100}$/.test(commentId)||!b||Object.keys(b).some(k=>!['reason','details'].includes(k))||!['spam','harassment','other'].includes(b.reason)||b.details!==undefined&&(typeof b.details!=='string'||b.details.length>500))return res.status(400).json({ok:false,code:'DISCUSSION_REPORT_INPUT'});
  res.set('Cache-Control','no-store');
  try{
   const reportId=hash([u.id,id,commentId]),file=path.join(reportDirectory,reportId+'.json'),details=b.details?.trim()??'';
   const report=readReport(reportId);
   if(report){
    if(report.reason!==b.reason||(report.details??'')!==details)
     return res.status(409).json({ok:false,code:'DISCUSSION_REPORT_ALREADY_SUBMITTED',message:'此前已提交过另一份举报。本次填写的内容仍在这里。'});
    return res.json({ok:true,ownerId:u.id,reportId,repeated:true});
   }
   if(!current(req,res))return;
   const comment=readPageThread(id).entries.find(e=>e.id===commentId&&e.withdrawnAt===null);
   if(!comment)return res.status(404).json({ok:false,code:'DISCUSSION_COMMENT_UNAVAILABLE'});
   if(comment.authorId===u.id)return res.status(403).json({ok:false,code:'DISCUSSION_REPORT_SELF'});
   atomicJson(file,{format:'dianliang-discussion-report/v1',id:reportId,reporterId:u.id,tutorialId:id,commentId,tutorialTitle:comment.tutorialSnapshot.title,afterAppealId:comment.lastAppealId,reason:b.reason,details,createdAt:Date.now(),evidence:{authorId:comment.authorId,text:comment.text,tutorialVersion:comment.tutorialSnapshot.version}});
   return res.status(201).json({ok:true,ownerId:u.id,reportId,repeated:false});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_REPORT_UNCONFIRMED',message:'举报提交未确认，可以重试。'})}
 });
 app.get('/api/review-tutorial-discussions/:id/:commentId/appeal',(req,res)=>{
  const u=user(req,res);if(!u)return;
  res.set('Cache-Control','no-store');
  const {id,commentId}=req.params;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!/^[A-Za-z0-9_-]{1,100}$/.test(commentId))return res.status(400).json({ok:false,code:'DISCUSSION_APPEAL_INPUT'});
  try{
   const comment=readThread(config,id).data.entries.find(e=>e.id===commentId&&e.authorId===u.id);
   if(!comment)return res.status(404).json({ok:false,code:'DISCUSSION_COMMENT_UNAVAILABLE'});
   const appeal=ownAppealStatus(comment,id,legacyAppealsFor(u.id));
   return res.json({ok:true,ownerId:u.id,commentId,appeal});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_APPEAL_UNCONFIRMED'})}
 });
 app.post('/api/review-tutorial-discussions/:id/:commentId/appeal',(req,res)=>{
  const u=user(req,res);if(!u)return;
  res.set('Cache-Control','no-store');
  const {id,commentId}=req.params,b=req.body;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!/^[A-Za-z0-9_-]{1,100}$/.test(commentId)||!b||Object.keys(b).some(k=>k!=='explanation')||typeof b.explanation!=='string'||!b.explanation.trim()||b.explanation.length>1000)return res.status(400).json({ok:false,code:'DISCUSSION_APPEAL_INPUT'});
  try{
   const comment=readThread(config,id).data.entries.find(e=>e.id===commentId&&e.authorId===u.id);
   if(!comment)return res.status(404).json({ok:false,code:'DISCUSSION_COMMENT_UNAVAILABLE'});
   const revision=req.get('If-Match');
   if(comment.moderated&&revision&&revision!==hash(comment))return res.status(409).json({ok:false,code:'DISCUSSION_APPEAL_CHANGED',message:'发言的处置状态已变化，请重新打开本人讨论档案核对。'});
   const appealId=comment.moderated?appealIdFor(comment,id):comment.lastAppealId;
   const appeal=appealId?readAppeal(appealId):legacyAppealsFor(u.id)(id,commentId);
   const explanation=b.explanation.trim();
   if(appeal){
    if(appeal.authorId!==u.id||appeal.tutorialId!==id||appeal.commentId!==commentId)throw Error('Discussion appeal owner mismatch');
    if(appeal.explanation!==explanation)return res.status(409).json({ok:false,code:'DISCUSSION_APPEAL_ALREADY_SUBMITTED',message:'这条发言已有申诉记录。'});
    return res.json({ok:true,ownerId:u.id,appealId:appeal.id,createdAt:appeal.createdAt,repeated:true});
   }
   if(!comment.moderated)return res.status(409).json({ok:false,code:'DISCUSSION_APPEAL_NOT_ELIGIBLE'});
   const createdAt=Date.now();
   const file=path.join(appealDirectory,appealId+'.json');
   atomicJson(file,{format:'dianliang-discussion-appeal/v1',id:appealId,authorId:u.id,tutorialId:id,commentId,moderationId:comment.moderationId,explanation,createdAt});
   return res.status(201).json({ok:true,ownerId:u.id,appealId,createdAt,repeated:false});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_APPEAL_UNCONFIRMED',message:'申诉提交未确认，可以重试。'})}
 });
 function readHelpful(tutorialId){
  const file=path.join(config.dataDir,'discussion-helpful',tutorialId+'.json'),bytes=threadBytes(file);
  const store=bytes?JSON.parse(bytes.toString('utf8')):{format:'dianliang-discussion-helpful/v1',tutorialId,votes:[]};
  if(store.format!=='dianliang-discussion-helpful/v1'||store.tutorialId!==tutorialId||!Array.isArray(store.votes))throw Error('Invalid discussion feedback');
  const votes=new Map();
  for(const row of store.votes){
   if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||votes.has(row[0])||!Array.isArray(row[1])||row[1].some(id=>typeof id!=='string')||new Set(row[1]).size!==row[1].length)throw Error('Invalid discussion vote');
   votes.set(row[0],new Set(row[1]));
  }
  return {file,store,votes};
 }
 function helpfulFor(votes,commentId,ownerId){
  const voters=votes.get(commentId);
  return {count:voters?.size??0,selected:voters?.has(ownerId)??false};
 }
 app.post('/api/review-tutorial-discussions/:id/:commentId/helpful',(req,res)=>{
  const u=user(req,res);if(!u)return;
  res.set('Cache-Control','no-store');
  const b=req.body;
  if(!b||Object.keys(b).some(k=>k!=='selected')||typeof b.selected!=='boolean')return res.status(400).json({ok:false,code:'DISCUSSION_HELPFUL_INPUT'});
  try{
   const t=current(req,res);if(!t)return;
   const thread=readPageThread(t.id),id=req.params.commentId,comment=thread.entries[thread.positions.get(id)];
   if(!comment||comment.withdrawnAt!==null)return res.status(404).json({ok:false,code:'DISCUSSION_COMMENT_UNAVAILABLE'});
   if(comment.authorId===u.id)return res.status(403).json({ok:false,code:'DISCUSSION_HELPFUL_SELF'});
   const {file,store,votes}=readHelpful(t.id),voters=votes.get(id)??new Set();
   if(voters.has(u.id)!==b.selected){
    if(b.selected)voters.add(u.id);else voters.delete(u.id);
    if(voters.size)votes.set(id,voters);else votes.delete(id);
    store.votes=Array.from(votes,([commentId,owners])=>[commentId,[...owners]]);
    atomicJson(file,store);
   }
   return res.json({ok:true,ownerId:u.id,commentId:id,helpful:helpfulFor(votes,id,u.id)});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_HELPFUL_UNCONFIRMED',message:'反馈未确认，可以重试。'})}
 });
 app.post('/api/review-tutorial-discussions/:id/:commentId/:action',(req,res)=>{
  const u=user(req,res);if(!u)return;if(!['withdraw','restore'].includes(req.params.action))return res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});if(!req.body||req.body.consent!==true||Object.keys(req.body).some(k=>k!=='consent'))return res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});
  try{const {file,data}=readThread(config,req.params.id),e=data.entries.find(e=>e.id===req.params.commentId&&e.authorId===u.id);if(!e)return res.status(404).json({ok:false,code:'DISCUSSION_COMMENT_UNAVAILABLE'});const withdraw=req.params.action==='withdraw';if(!withdraw&&e.moderated)return res.status(403).json({ok:false,code:'DISCUSSION_MODERATED',message:'这条发言已由审核处理。'});if(!withdraw&&!current(req,res))return;if(withdraw===(e.withdrawnAt!==null))return res.json({ok:true,ownerId:u.id,comment:disclosedComment(e,u)});if(req.get('If-Match')!==hash(e))return res.status(409).json({ok:false,code:'DISCUSSION_COMMENT_CHANGED'});e.withdrawnAt=withdraw?Date.now():null;atomicJson(file,data);return res.json({ok:true,ownerId:u.id,comment:disclosedComment(e,u)})}catch{return res.status(503).json({ok:false,code:'DISCUSSION_SAVE_UNCONFIRMED'})}
 });
 app.get('/api/review-tutorial-discussions/:id',(req,res)=>{
  const u=user(req,res);if(!u)return;
  const cursor=req.query.cursor??'',replyTo=req.query.replyTo??'',focus=req.query.focus??'',query=req.query.query??'',order=req.query.order??'chronological',limit=req.query.limit===undefined?30:Number(req.query.limit);
  if([cursor,replyTo,focus].some(value=>typeof value!=='string'||value.length>100)||typeof query!=='string'||query.length>120||!['chronological','helpful'].includes(order)||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});
  try{
   const t=current(req,res);if(!t)return;
   const {entries,positions,revision:threadRevision}=readPageThread(t.id);
   const entry=id=>entries[positions.get(id)];
   const context=e=>({id:e.id,authorName:e.authorName,text:e.withdrawnAt!==null?'':e.text,withdrawn:e.withdrawnAt!==null,tutorialVersion:e.tutorialSnapshot.version});
   let votes;try{votes=readHelpful(t.id).votes}catch{}
   const count=e=>e.withdrawnAt===null?(votes?.get(e.id)?.size??0):0;
   const needle=searchText(query.trim());
   const matches=needle?entries.filter(e=>e.withdrawnAt===null&&searchText(e.text).includes(needle)):entries;
   const ordered=order==='helpful'?[...matches].sort((a,b)=>count(b)-count(a)):matches;
   const revision=hash({tutorialId:t.id,tutorialVersion:t.version,targetVersion:t.target.version,ownerId:u.id,limit,threadRevision,order,needle,...(order==='helpful'?{positions:ordered.map(e=>e.id)}:{})});
   if(focus&&!cursor){
    const target=entry(focus);
    if(!target||target.withdrawnAt!==null||!ordered.includes(target))return res.status(404).json({ok:false,code:'DISCUSSION_FOCUS_UNAVAILABLE',message:'对应发言已不可公开读取或不在当前搜索范围。'});
   }
   const pageCursor=focus&&!cursor?revision+':'+Math.floor(ordered.indexOf(entry(focus))/limit)*limit:cursor;
   const page=archivePage(res,pageCursor,revision,ordered.length,limit,'讨论内容或排序已有变化，请重新读取第一页。');
   if(!page)return;
   const comments=ordered.slice(page.offset,page.offset+limit).map(e=>({...disclosedComment(e,u),helpful:e.withdrawnAt===null&&votes?helpfulFor(votes,e.id,u.id):null,replyContext:e.parentId?context(entry(e.parentId)):null}));
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,tutorialVersion:t.version,order,query,total:ordered.length,revision,comments,focusDigest:focus&&!cursor?replyDigest(entry(focus),t.id):null,replyTarget:replyTo&&positions.has(replyTo)?context(entry(replyTo)):null,...page.meta});
  }catch{return res.status(503).json({ok:false,code:'DISCUSSION_STORE_UNREADABLE',message:'讨论内容暂时无法核对，原文件保留。'})}
 });
 app.post('/api/review-tutorial-discussions/:id',(req,res)=>{
  const u=user(req,res);if(!u)return;const b=req.body;if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['text','tutorialVersion','parentId','requestId','consent'].includes(k))||typeof b.text!=='string'||!b.text.trim()||b.text.trim().length>3000||typeof b.tutorialVersion!=='string'||typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.requestId)||b.parentId!==null&&typeof b.parentId!=='string')return res.status(400).json({ok:false,code:'DISCUSSION_INPUT'});if(b.consent!==true)return res.status(403).json({ok:false,code:'DISCUSSION_PUBLIC_CONSENT_REQUIRED'});
  try{const t=current(req,res);if(!t)return;const {file,data}=readThread(config,t.id),fingerprint=hash({text:b.text.trim(),tutorialVersion:b.tutorialVersion,parentId:b.parentId}),previous=data.entries.find(e=>e.authorId===u.id&&e.requestId===b.requestId);if(previous){if(previous.fingerprint!==fingerprint||previous.withdrawnAt!==null)return res.status(409).json({ok:false,code:'DISCUSSION_REQUEST_REUSED'});return res.json({ok:true,ownerId:u.id,repeated:true,comment:disclosedComment(previous,u)})}if(t.version!==b.tutorialVersion)return res.status(409).json({ok:false,code:'DISCUSSION_TUTORIAL_CHANGED',message:'教程版本已变化，请保留输入，重新核对后发布。'});if(b.parentId&&!data.entries.some(e=>e.id===b.parentId&&e.withdrawnAt===null))return res.status(409).json({ok:false,code:'DISCUSSION_REPLY_UNAVAILABLE'});const entry={id:crypto.randomUUID(),authorId:u.id,authorName:u.name,text:b.text.trim(),parentId:b.parentId,createdAt:Date.now(),withdrawnAt:null,requestId:b.requestId,fingerprint,tutorialSnapshot:{id:t.id,title:t.title,version:t.version,target:t.target}};entry.snapshotHash=hash(entry.tutorialSnapshot);data.entries.push(entry);atomicJson(file,data);return res.status(201).json({ok:true,ownerId:u.id,repeated:false,comment:disclosedComment(entry,u)})}catch{return res.status(503).json({ok:false,code:'DISCUSSION_SAVE_UNCONFIRMED',message:'发布回执未确认，输入保留，可用原请求重试。'})}
 });
}
module.exports={installTutorialDiscussion,readThread,readOwnedDiscussions};
