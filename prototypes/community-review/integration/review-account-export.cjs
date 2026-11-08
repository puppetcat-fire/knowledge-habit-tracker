const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {recoverTransactions}=require('../../../storage-transaction');
const {readBindings}=require('./knowledge-binding-store.cjs');
const {readPrivateTargets}=require('./knowledge-private-targets.cjs');
const {readReceipts}=require('./knowledge-practice-store.cjs');
const {readOwnedTutorialHistory}=require('./owned-tutorial-history.cjs');
const {readOwnedDiscussions}=require('./tutorial-discussion.cjs');
const {readPathPublications}=require('./knowledge-path-publications.cjs');
const {readReplyReadState}=require('./reply-read-state.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read=(f,fallback)=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):fallback;
function reviewExportSources(config,user,at){
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(user.id))throw Error('Invalid owner');recoverTransactions(config.dataDir);
 const file=folder=>path.join(config.dataDir,folder,user.id+'.json'),source=read(file('action-states'),null);if(source){if(source.format!==FORMAT)throw Error('Invalid action format');validateActionState(source.data)}
 const action=source&&JSON.parse(JSON.stringify(source));if(action){for(const e of action.data.events)for(const segment of e.segments)if(segment.end===null){if(segment.start>at)throw Error('Open segment begins after export time');segment.end=at}action.data.activeId=null;validateActionState(action.data)}
 const deletions=read(file('event-deletions'),{format:'dianliang-event-deletions/v1',ownerId:user.id,entries:[]});if(deletions.format!=='dianliang-event-deletions/v1'||deletions.ownerId!==user.id||!Array.isArray(deletions.entries)||deletions.entries.some(e=>!e||Object.keys(e).some(k=>!['eventId','baseRevision','deletedAt'].includes(k))||typeof e.eventId!=='string'||typeof e.baseRevision!=='string'||!Number.isFinite(e.deletedAt)))throw Error('Invalid deletion archive');
 return {actionState:action,sourceActionRevision:hash(source),exportedActionRevision:hash(action),actionCutoff:at,tutorials:readOwnedTutorialHistory(config,user),discussionEntries:readOwnedDiscussions(config,user),replyReadState:readReplyReadState(config,user).state,methodBindings:{format:'dianliang-method-bindings/v1',ownerId:user.id,bindings:readBindings(file('method-bindings'),user.id)},privateTargets:readPrivateTargets(config,user),practiceReceipts:readReceipts(file('practice-receipts'),user.id),eventDeletions:deletions,pathPublications:readPathPublications(config,user.id)};
}
function installReviewAccountExport(app,{config,authenticate,legacyApp}){
 app.get('/api/review-account-export',(req,res)=>{
  const user=authenticate(req);if(!user)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  const originalJson=res.json.bind(res),originalUrl=req.url;let sources,at;
  try{at=Date.now();sources=reviewExportSources(config,user,at)}catch{return res.status(500).json({ok:false,code:'REVIEW_ARCHIVE_SOURCE_UNREADABLE',message:'行动、教程或回执无法完整核对，未生成遗漏内容的备份；原文件保留。'})}
  res.json=base=>{
   req.url=originalUrl;if(base?.format!=='kht-account-archive/v1')return originalJson(base);
   if(base.account?.id!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
   const archive={format:'dianliang-service-archive/v1',exportedAt:at,ownerId:user.id,ownerName:user.name,service:{legacyState:base.state,profile:base.profile,nodes:base.nodes,edges:base.edges,trees:base.trees,records:base.records,...sources}};
   res.set({'Cache-Control':'no-store','Content-Disposition':'attachment; filename=dianliang-service-archive.json'});return originalJson({ok:true,...archive,integrity:{algorithm:'sha256-json-stringify',value:hash(archive)}});
  };
  // Run the existing read-only account export synchronously under this request's
  // session. Its own records, media and profile filtering remains authoritative.
  req.url='/api/account/export';legacyApp(req,res,()=>{req.url=originalUrl;res.status(500);originalJson({ok:false,code:'REVIEW_ARCHIVE_BASE_UNAVAILABLE'})});
 });
}
module.exports={installReviewAccountExport,reviewExportSources};
