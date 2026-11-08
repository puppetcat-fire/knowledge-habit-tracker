const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicJson,recoverTransactions}=require('../../../storage-transaction');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const {disclosedTarget}=require('./knowledge-visible-targets.cjs');
function readTutorials(file){const v=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];if(!Array.isArray(v)||v.some(t=>!t||!Array.isArray(t.versions)))throw Error('Unreadable tutorials');return v}
function visibleTarget(config,nodeId,treeId,user,privateSave=false){
 const store=JSON.parse(fs.readFileSync(config.customNodesPath,'utf8'));if(!Array.isArray(store.nodes)||!Array.isArray(store.trees))throw Error('Unreadable targets');
 const node=store.nodes.find(n=>n.id===nodeId&&(!treeId||n.treeId===treeId)),tree=store.trees.find(t=>t.id===node?.treeId);
 if(!node||tree?.visibility!=='public'||node.visibility!=='public'&&!(privateSave&&node.ownerId===user.id))throw Object.assign(Error('目标当前不可访问。'),{status:404,code:'VISIBLE_TARGET_UNAVAILABLE'});
 return {...disclosedTarget({...node,visibility:'public'},tree),visibility:node.visibility};
}
function ownedTargetSnapshot(config,snapshot,user){
 if(!snapshot||Object.keys(snapshot).some(k=>!['nodeId','treeId','title','goal','five','domain','branch','version','sourceVersion','ownership','visibility','ownerId','ownerName'].includes(k))||snapshot.ownership!=='personal'||!['private','public'].includes(snapshot.visibility)||snapshot.visibility==='private'&&snapshot.ownerId!==user.id)throw Error('Invalid owned target snapshot');
 const store=JSON.parse(fs.readFileSync(config.customNodesPath,'utf8'));if(!Array.isArray(store.nodes)||!Array.isArray(store.trees))throw Error('Unreadable historical targets');
 const n=store.nodes.find(n=>n.id===snapshot.nodeId&&n.treeId===snapshot.treeId),tree=store.trees.find(t=>t.id===snapshot.treeId);
 if(!n||!tree)throw Error('Historical target unavailable');
 const current=disclosedTarget({...n,visibility:'public'},{...tree,visibility:'public'}),version=n.versions?.find(v=>v.version===snapshot.version&&v.sourceVersion===snapshot.sourceVersion);
 if(!version||snapshot.ownerId!==current.ownerId||snapshot.ownerName!==current.ownerName||['title','goal','five','domain','branch'].some(k=>snapshot[k]!==version[k]))throw Error('Historical target snapshot mismatch');
 const original={id:n.publicationOrigin.originId,title:version.title,goal:version.goal,five:version.five,domain:version.domain,branch:version.branch,ownership:'personal',visibility:'private',version:version.sourceVersion};
 if(contentVersion({ownerId:n.ownerId,target:original})!==snapshot.version)throw Error('Historical target hash mismatch');
 return {canPublishCurrent:n.visibility==='public'&&tree.visibility==='public'&&JSON.stringify(snapshot)===JSON.stringify(current)};
}
function installVisibleTargetTutorials(app,{config,authenticate,sessionAccount}){
 const file=path.join(config.dataDir,'tutorials.json');
 async function actor(req,res){const u=authenticate(req)||await sessionAccount(req);if(!u){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return u}
 const fail=(res,e)=>res.status(e.status||500).json({ok:false,code:e.code||'VISIBLE_TUTORIAL_STORE_UNREADABLE',message:e.status?e.message:'目标或教程档案无法核对，原文件保留。'});
 function content(body){try{return tutorialInput(body)}catch(e){throw Object.assign(e,{status:400,code:'VISIBLE_TUTORIAL_INPUT'})}}
 function reviewed(body,target){if(body.targetVersion!==target.version)throw Object.assign(Error('请重新核对完整目标版本后保存教程。'),{status:409,code:'VISIBLE_TUTORIAL_TARGET_CHANGED'})}
 app.post('/api/tutorials',async(req,res,next)=>{
  if(typeof req.body?.nodeId!=='string'||!req.body.nodeId.startsWith('review-visible-'))return next();
  try{const u=await actor(req,res);if(!u)return;recoverTransactions(config.dataDir);const value=content(req.body),target=visibleTarget(config,req.body.nodeId,req.body.treeId,u,value.visibility==='private');reviewed(req.body,target);const methods=readTutorials(file),now=new Date().toISOString();
   const requestId=req.body.requestId;
   if(requestId!==undefined&&(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(requestId)))return res.status(400).json({ok:false,code:'VISIBLE_TUTORIAL_REQUEST_INVALID'});
   const fingerprint=contentVersion({target,value}),previous=requestId&&methods.find(t=>t.authorId===u.id&&t.creationRequest?.id===requestId);
   if(previous){if(previous.archived)return res.status(409).json({ok:false,code:'VISIBLE_TUTORIAL_REQUEST_ARCHIVED',message:'上次提交的教程已归档，请核对历史内容后另建教程。'});if(previous.creationRequest.fingerprint!==fingerprint)return res.status(409).json({ok:false,code:'VISIBLE_TUTORIAL_REQUEST_REUSED',message:'上次提交已保存，但当前文字或目标不同；请核对已保存教程后创建新版本。'});if(previous.version!==contentVersion(value))return res.status(409).json({ok:false,code:'VISIBLE_TUTORIAL_REQUEST_CHANGED',message:'上次提交已保存，教程随后又有修订或撤回；请查看当前教程，原版本保留。'});return res.json({ok:true,tutorial:previous,repeated:true})}
   const tutorial={id:'t'+crypto.randomBytes(12).toString('hex'),treeId:target.treeId,nodeId:target.nodeId,authorId:u.id,authorName:u.name,...value,version:contentVersion(value),targetSnapshot:target,...(requestId?{creationRequest:{id:requestId,fingerprint}}:{}),createdAt:now,updatedAt:now,versions:[{...value,version:contentVersion(value),targetSnapshot:target,createdAt:now}]};methods.push(tutorial);atomicJson(file,methods);return res.status(201).json({ok:true,tutorial});
  }catch(e){return fail(res,e)}
 });
 app.patch('/api/tutorials/:id',async(req,res,next)=>{
  try{const u=await actor(req,res);if(!u)return;recoverTransactions(config.dataDir);const methods=readTutorials(file),old=methods.find(t=>t.id===req.params.id&&t.authorId===u.id&&!t.archived);if(!old||!old.nodeId.startsWith('review-visible-'))return next();
   if(req.get('If-Match')!==old.version)return res.status(409).json({ok:false,code:'TUTORIAL_CONFLICT'});
   const value=content({...old,...req.body});
   if(old.targetSnapshot)ownedTargetSnapshot(config,old.targetSnapshot,u);
   if(value.visibility==='public'){const target=visibleTarget(config,old.nodeId,old.treeId,u);reviewed(req.body,target);if(!old.targetSnapshot||JSON.stringify(old.targetSnapshot)!==JSON.stringify(target))return res.status(409).json({ok:false,code:'VISIBLE_TUTORIAL_NEW_TARGET_REQUIRED',message:'这份教程属于原目标版本，请为新目标另建教程；原版本保留。'})}
   const version=contentVersion(value);if(version!==old.version){const now=new Date().toISOString();old.versions.push({...value,version,...(old.targetSnapshot?{targetSnapshot:old.targetSnapshot}:{}),createdAt:now});Object.assign(old,value,{version,updatedAt:now});atomicJson(file,methods)}return res.json({ok:true,tutorial:old});
  }catch(e){return fail(res,e)}
 });
 app.get('/api/review-visible-targets/tutorials',async(req,res)=>{
  try{const u=await actor(req,res);if(!u)return;if(typeof req.query.nodeId!=='string')return res.status(400).json({ok:false,code:'VISIBLE_TARGET_INPUT'});recoverTransactions(config.dataDir);const target=visibleTarget(config,req.query.nodeId,null,u),methods=readTutorials(file),tutorials=[];let unboundCount=0;
   for(const t of methods.filter(t=>!t.archived&&t.visibility==='public'&&t.nodeId===target.nodeId&&t.treeId===target.treeId)){
    if(!t.targetSnapshot){unboundCount++;continue}if(t.targetSnapshot.version!==target.version)continue;
    const v=t.versions.findLast(v=>v.version===t.version&&v.visibility==='public'),value=v&&content(v);
    if(!v||JSON.stringify(v.targetSnapshot)!==JSON.stringify(target)||JSON.stringify(t.targetSnapshot)!==JSON.stringify(target)||contentVersion(value)!==t.version||!Number.isFinite(Date.parse(v.createdAt))||typeof t.authorId!=='string'||typeof t.authorName!=='string')throw Error('Invalid target tutorial binding');
    tutorials.push({id:t.id,treeId:t.treeId,nodeId:t.nodeId,authorId:t.authorId,authorName:t.authorName,version:t.version,createdAt:v.createdAt,targetSnapshot:target,...value});
   }
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,target,tutorials,unboundCount});
  }catch(e){return fail(res,e)}
 });
 app.get('/api/review-visible-targets/my-tutorials',async(req,res)=>{
  try{const u=await actor(req,res);if(!u)return;recoverTransactions(config.dataDir);const methods=readTutorials(file),tutorials=[];
   for(const t of methods.filter(t=>t.authorId===u.id&&t.nodeId?.startsWith('review-visible-')&&t.targetSnapshot)){
    if(t.treeId!==t.targetSnapshot.treeId||t.nodeId!==t.targetSnapshot.nodeId||typeof t.authorName!=='string'||!t.authorName.trim())throw Error('Invalid owned tutorial');
    const state=ownedTargetSnapshot(config,t.targetSnapshot,u),value=content(t),versions=t.versions.map(v=>{const c=content(v);if(contentVersion(c)!==v.version||JSON.stringify(v.targetSnapshot)!==JSON.stringify(t.targetSnapshot)||!Number.isFinite(Date.parse(v.createdAt)))throw Error('Invalid owned tutorial version');return {...c,version:v.version,createdAt:v.createdAt,targetSnapshot:v.targetSnapshot}});
    if(contentVersion(value)!==t.version||!versions.some(v=>v.version===t.version))throw Error('Invalid current owned tutorial');
    tutorials.push({id:t.id,treeId:t.treeId,nodeId:t.nodeId,authorId:t.authorId,authorName:t.authorName,...value,version:t.version,targetSnapshot:t.targetSnapshot,versions,archived:t.archived===true,createdAt:t.createdAt,updatedAt:t.updatedAt,canPublishCurrent:state.canPublishCurrent&&!t.archived,...(t.creationRequest?{creationRequest:t.creationRequest}:{})});
   }
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,tutorials});
  }catch(e){return fail(res,e)}
 });
}
module.exports={installVisibleTargetTutorials,ownedTargetSnapshot};
