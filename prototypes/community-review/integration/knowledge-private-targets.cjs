const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {commitTransaction,recoverTransactions}=require('../../../storage-transaction');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const fields=['id','title','goal','five','domain','branch','ownership','visibility','version'];
function privateTarget(n){
 if(!n||n.ownership!=='personal'||n.visibility!=='private'||!Number.isInteger(n.version)||n.version<1||!['id','title','goal','five','domain','branch'].every(k=>typeof n[k]==='string'&&n[k].trim()))throw Error('需要完整的私人目标版本，不能推断归属或截断目标。');
 return Object.fromEntries(fields.map(k=>[k,n[k]]));
}
function registryFile(config,u){if(!/^[A-Za-z0-9_-]{1,64}$/.test(u.id))throw Error('Invalid account');return path.join(config.dataDir,'private-target-bindings',u.id+'.json')}
function readPrivateTargets(config,u){const file=registryFile(config,u),r=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{format:'dianliang-private-targets/v1',ownerId:u.id,bindings:[]};
 if(r.format!=='dianliang-private-targets/v1'||r.ownerId!==u.id||!Array.isArray(r.bindings)||r.bindings.some(b=>b?.ownerId!==u.id||hash({ownerId:u.id,target:privateTarget(b.target)})!==b.sourceHash||b.ref?.sourceVersion!==b.target.version||b.ref?.originId!==b.target.id||b.ref?.visibility!=='private'||b.ref?.ownership!=='personal'||b.ref?.ownerId!==u.id||b.ref?.targetVersion!==b.sourceHash||b.ref?.treeId!=='review-private-'+hash(u.id).slice(0,24)||b.ref?.nodeId!=='review-private-'+hash([u.id,b.target.id]).slice(0,32)))throw Error('Unreadable private target registry');return r;
}
function readNodes(config){const v=JSON.parse(fs.readFileSync(config.customNodesPath,'utf8'));if(!v||!Array.isArray(v.nodes)||!Array.isArray(v.edges)||!Array.isArray(v.trees))throw Error('Unreadable node store');return v}
function ownedCurrent(store,b,u){const n=store.nodes.find(n=>n.id===b.ref.nodeId&&n.treeId===b.ref.treeId),t=store.trees.find(t=>t.id===b.ref.treeId);if(!n||n.ownerId!==u.id||n.ownership!=='personal'||n.visibility!=='private'||!t||t.ownerId!==u.id||t.visibility!=='private'||!Array.isArray(n.versions))throw Error('Private target ownership changed');return n}
function installPrivateTargetRoutes(app,{config,authenticate,commit=commitTransaction}){
 function owner(req,res){const u=authenticate(req);if(!u){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return u}
 app.get('/api/review-private-targets',(req,res)=>{const u=owner(req,res);if(!u)return;try{recoverTransactions(config.dataDir);const registry=readPrivateTargets(config,u),store=readNodes(config),latest=new Map();for(const b of registry.bindings){const p=latest.get(b.target.id);if(!p||p.target.version<b.target.version)latest.set(b.target.id,b)}const current=[...latest.values()].map(b=>{const node=ownedCurrent(store,b,u);return {originId:b.target.id,node:clone(node),revision:hash(node)}});return res.set('Cache-Control','no-store').json({ok:true,...registry,current})}catch{return res.status(500).json({ok:false,code:'PRIVATE_TARGET_STORE_UNREADABLE'})}});
 app.post('/api/review-private-targets',(req,res)=>{
  const u=owner(req,res);if(!u)return;const expected=req.get('If-Match');if(!expected)return res.status(428).json({ok:false,code:'ACTION_REVISION_REQUIRED'});const body=req.body;if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['nodeId','sourceVersion'].includes(k)))return res.status(400).json({ok:false,code:'PRIVATE_TARGET_INPUT'});
  let source,registry,store;try{recoverTransactions(config.dataDir);source=JSON.parse(fs.readFileSync(path.join(config.dataDir,'action-states',u.id+'.json'),'utf8'));if(source.format!==FORMAT)throw Error('Invalid source');validateActionState(source.data);registry=readPrivateTargets(config,u);store=readNodes(config)}catch{return res.status(500).json({ok:false,code:'PRIVATE_TARGET_SOURCE_UNREADABLE'})}
  if(expected!==hash(source)&&expected!=='"'+hash(source)+'"')return res.status(409).json({ok:false,code:'ACTION_CONFLICT'});
  let target;try{target=privateTarget(source.data.nodes.find(n=>n.id===body.nodeId));if(target.version!==body.sourceVersion)throw Error('私人目标版本已变化，请重新核对。')}catch(error){return res.status(400).json({ok:false,code:'PRIVATE_TARGET_MISMATCH',message:error.message})}
  const sourceHash=hash({ownerId:u.id,target}),previous=registry.bindings.filter(b=>b.target.id===target.id),latest=previous.reduce((last,b)=>!last||last.target.version<b.target.version?b:last,null),same=previous.find(b=>b.target.version===target.version);
  if(same&&same.sourceHash!==sourceHash)return res.status(409).json({ok:false,code:'PRIVATE_TARGET_VERSION_REUSED',message:'同一目标版本的内容已变化，请保留原版本并明确修订新版本。'});
  if(latest){let actual;try{actual=ownedCurrent(store,latest,u)}catch{return res.status(409).json({ok:false,code:'PRIVATE_TARGET_OWNERSHIP_CHANGED'})}
   if(req.get('If-Target-Match')!==hash(actual))return res.status(409).json({ok:false,code:'PRIVATE_TARGET_CONFLICT',message:'服务目标已变化，请重新核对；原版本保留。'});
   if(same){const expectedTarget=latest.target;if(['title','goal','five','domain','branch'].some(k=>actual[k]!==expectedTarget[k])||actual.version!==latest.ref.targetVersion)return res.status(409).json({ok:false,code:'PRIVATE_TARGET_DIVERGED',message:'服务目标与保存回执不一致，请先保留双方内容，再修订新版本。'});return res.json({ok:true,binding:same,repeated:true})}
   if(target.version<=latest.target.version)return res.status(409).json({ok:false,code:'PRIVATE_TARGET_VERSION_REUSED'});
  }
  const treeId='review-private-'+hash(u.id).slice(0,24),nodeId='review-private-'+hash([u.id,target.id]).slice(0,32),now=new Date().toISOString();
  if(!latest&&(store.nodes.some(n=>n.id===nodeId)||store.trees.some(t=>t.id===treeId&&(t.ownerId!==u.id||t.visibility!=='private'))))return res.status(409).json({ok:false,code:'PRIVATE_TARGET_ID_COLLISION'});
  if(!store.trees.some(t=>t.id===treeId))store.trees.push({id:treeId,name:'我的私人知识目标',domain:'个人目标',ownerId:u.id,ownerName:u.name,visibility:'private',createdAt:now});
  const old=latest?store.nodes.find(n=>n.id===latest.ref.nodeId):null,versionEntry={title:target.title,goal:target.goal,five:target.five,domain:target.domain,branch:target.branch,version:sourceHash,sourceVersion:target.version,createdAt:now};
  const observed=old&&(['title','goal','five','domain','branch'].some(k=>old[k]!==latest.target[k])||old.version!==latest.ref.targetVersion)?[{kind:'external-service-edit',observedRecordRevision:hash(old),title:old.title,goal:old.goal,five:old.five,domain:old.domain,branch:old.branch,sourceVersion:null,recordedAt:now}]:[];
  const node={...old,id:nodeId,treeId,title:target.title,goal:target.goal,five:target.five,domain:target.domain,branch:target.branch,ownership:'personal',ownerId:u.id,ownerName:u.name,visibility:'private',version:sourceHash,sourceVersion:target.version,estMinutes:5,verifyHint:'本人实践后留下自己的结果与证据。',createdAt:old?.createdAt||now,updatedAt:now,versions:[...(old?.versions||[]),...observed,versionEntry]};
  if(old)store.nodes[store.nodes.indexOf(old)]=node;else store.nodes.push(node);
  const binding={ownerId:u.id,target:clone(target),sourceHash,ref:{treeId,nodeId,targetVersion:sourceHash,originId:target.id,sourceVersion:target.version,ownership:'personal',visibility:'private',ownerId:u.id},createdAt:now};registry.bindings.push(binding);
  try{commit(config.dataDir,[{filePath:config.customNodesPath,value:store},{filePath:registryFile(config,u),value:registry}]);return res.status(201).json({ok:true,binding,repeated:false})}catch{return res.status(500).json({ok:false,code:'PRIVATE_TARGET_COMMIT_UNCONFIRMED',message:'服务回执尚未确认，原目标保留，可重新核对。'})}
 });
}
function resolvePrivateTarget(config,u,target){const t=privateTarget(target),sourceHash=hash({ownerId:u.id,target:t}),registry=readPrivateTargets(config,u),b=registry.bindings.find(b=>b.sourceHash===sourceHash&&b.target.id===t.id&&b.target.version===t.version);if(!b)throw Error('这个私人目标的当时版本尚未保存到服务，请先核对目标版本；原实践保留。');ownedCurrent(readNodes(config),b,u);return clone(b.ref)}
function privateReference(target,ownerId){if(typeof ownerId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(ownerId))throw Error('私人目标缺少明确的账号归属。');const t=privateTarget(target),sourceHash=hash({ownerId,target:t});return {treeId:'review-private-'+hash(ownerId).slice(0,24),nodeId:'review-private-'+hash([ownerId,t.id]).slice(0,32),targetVersion:sourceHash,originId:t.id,sourceVersion:t.version,ownership:'personal',visibility:'private',ownerId}}
module.exports={installPrivateTargetRoutes,readPrivateTargets,privateTarget,resolvePrivateTarget,privateReference};
