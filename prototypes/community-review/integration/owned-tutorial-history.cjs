const fs=require('node:fs'),path=require('node:path');
const {recoverTransactions}=require('../../../storage-transaction');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const {readBindings}=require('./knowledge-binding-store.cjs');
const {ownedTargetSnapshot}=require('./visible-target-tutorials.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
function readOwnedTutorialHistory(config,u){
if(!/^[A-Za-z0-9_-]{1,64}$/.test(u.id))throw Error('Invalid owner');recoverTransactions(config.dataDir);const file=path.join(config.dataDir,'tutorials.json'),all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];if(!Array.isArray(all))throw Error('Unreadable tutorials');const own=all.filter(t=>t?.authorId===u.id),bindings=own.some(t=>t.sourceOrigin)?readBindings(path.join(config.dataDir,'method-bindings',u.id+'.json'),u.id):[],index=new Map(),cache=new Map();
   for(const b of bindings)if(b.service.authorId===u.id){const key=JSON.stringify([b.service.id,b.service.version]);if(!index.has(key))index.set(key,[]);index.get(key).push(b)}
   function targetState(s){const key=JSON.stringify(s);if(!cache.has(key))cache.set(key,ownedTargetSnapshot(config,s,u));return cache.get(key)}
   const tutorials=own.map(t=>{
    if(typeof t.id!=='string'||typeof t.treeId!=='string'||typeof t.nodeId!=='string'||typeof t.authorName!=='string'||!t.authorName.trim()||!Array.isArray(t.versions))throw Error('Invalid owned tutorial');
    if(t.sourceOrigin&&(!t.sourceOrigin||Array.isArray(t.sourceOrigin)||Object.keys(t.sourceOrigin).some(k=>!['nodeId','methodId','sourceVersion'].includes(k))||typeof t.sourceOrigin.nodeId!=='string'||typeof t.sourceOrigin.methodId!=='string'||!Number.isInteger(t.sourceOrigin.sourceVersion)||t.sourceOrigin.sourceVersion<1))throw Error('Invalid source origin');
    if(t.creationRequest&&(Array.isArray(t.creationRequest)||Object.keys(t.creationRequest).some(k=>!['id','fingerprint'].includes(k))||typeof t.creationRequest.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(t.creationRequest.id)||typeof t.creationRequest.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(t.creationRequest.fingerprint)))throw Error('Invalid creation receipt');
    function associated(version){const seen=new Set();return (index.get(JSON.stringify([t.id,version]))||[]).filter(b=>b.service.treeId===t.treeId&&b.service.nodeId===t.nodeId).flatMap(b=>{const p={target:clone(b.source.target),ref:clone(b.source.ref)},key=JSON.stringify(p);if(seen.has(key))return [];seen.add(key);return [p]})}
    const versions=t.versions.map(v=>{const value=tutorialInput(v);if(contentVersion(value)!==v.version||!Number.isFinite(Date.parse(v.createdAt)))throw Error('Invalid owned content version');if(v.targetSnapshot){targetState(v.targetSnapshot);if(JSON.stringify(v.targetSnapshot)!==JSON.stringify(t.targetSnapshot))throw Error('Changed visible target binding')}return {...value,version:v.version,createdAt:v.createdAt,...(v.targetSnapshot?{targetSnapshot:clone(v.targetSnapshot)}:{}),targetSnapshots:associated(v.version)}});
    const value=tutorialInput(t),current=versions.find(v=>v.version===t.version);if(!current||contentVersion(value)!==t.version||JSON.stringify(tutorialInput(current))!==JSON.stringify(value))throw Error('Invalid current owned version');
    const targets=associated(t.version),mapped=t.targetSnapshot||targets.length>0,kind=t.targetSnapshot?'personal-public':targets.some(p=>p.ref.visibility==='private')?'personal-private':targets.length?'catalog':'unmapped';
    const state=t.targetSnapshot?targetState(t.targetSnapshot):{canPublishCurrent:false};
    return {id:t.id,treeId:t.treeId,nodeId:t.nodeId,authorId:u.id,authorName:t.authorName,...value,version:t.version,createdAt:t.createdAt,updatedAt:t.updatedAt,archived:t.archived===true,kind,targetMappingStatus:mapped?'verified':'unmapped',targetSnapshots:targets,...(t.targetSnapshot?{targetSnapshot:clone(t.targetSnapshot)}:{}),versions,canPublishCurrent:state.canPublishCurrent&&!t.archived,...(t.sourceOrigin?{sourceOrigin:clone(t.sourceOrigin)}:{}),...(t.creationRequest?{creationRequest:clone(t.creationRequest)}:{})};
   });
 return tutorials;
}
function installOwnedTutorialHistory(app,{config,authenticate}){
 app.get('/api/review-owned-tutorials',(req,res)=>{
  const u=authenticate(req);if(!u)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  try{const tutorials=readOwnedTutorialHistory(config,u);
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,tutorials});
  }catch{return res.status(500).json({ok:false,code:'OWNED_TUTORIAL_HISTORY_UNREADABLE',message:'本人教程或历史关联无法核对，原文件保留，未用当前目标替换旧版本。'})}
 });
}
module.exports={installOwnedTutorialHistory,readOwnedTutorialHistory};
