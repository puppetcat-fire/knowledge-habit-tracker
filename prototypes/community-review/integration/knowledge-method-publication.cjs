const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {commitTransaction,recoverTransactions}=require('../../../storage-transaction');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {readBindings}=require('./knowledge-binding-store.cjs');
const {methodSource,tutorialPayload,bindReceipt}=require('./knowledge-version-mapping.cjs');
const {confirmedActionLight}=require('./knowledge-confirmation.cjs');
const {contentVersion}=require('../../../knowledge-service');
const {resolvePrivateTarget}=require('./knowledge-private-targets.cjs');
const {resolveCatalogTarget}=require('./knowledge-catalog.cjs');
const read=(f,d)=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):d;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function ownedFile(config,u,folder){if(!/^[A-Za-z0-9_-]{1,64}$/.test(u.id))throw Error('Invalid owner');return path.join(config.dataDir,folder,u.id+'.json')}
function installMethodPublicationRoutes(app,{config,authenticate,commit=commitTransaction}){
 function owner(req,res){const u=authenticate(req);if(!u){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return u}
 const file=path.join(config.dataDir,'tutorials.json');
 app.get('/api/review-method-publications',(req,res)=>{const u=owner(req,res);if(!u)return;try{recoverTransactions(config.dataDir);const methods=read(file,[]);if(!Array.isArray(methods))throw Error('Unreadable methods');return res.set('Cache-Control','no-store').json({ok:true,tutorials:methods.filter(m=>m.authorId===u.id&&m.sourceOrigin)})}catch{return res.status(500).json({ok:false,code:'METHOD_PUBLICATION_STORE_UNREADABLE'})}});
 app.post('/api/review-method-publications',(req,res)=>{
  const u=owner(req,res);if(!u)return;const expected=req.get('If-Match');if(!expected)return res.status(428).json({ok:false,code:'ACTION_REVISION_REQUIRED'});
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['nodeId','methodId','sourceVersion','visibility','lightId','publicConsent'].includes(k))||!['private','public'].includes(b.visibility))return res.status(400).json({ok:false,code:'METHOD_PUBLICATION_INPUT'});
  let envelope,methods,bindings;const bindingFile=ownedFile(config,u,'method-bindings');
  try{recoverTransactions(config.dataDir);envelope=read(ownedFile(config,u,'action-states'),null);if(envelope?.format!==FORMAT)throw Error('Missing source');validateActionState(envelope.data);methods=read(file,[]);if(!Array.isArray(methods)||methods.some(m=>!m||!Array.isArray(m.versions)))throw Error('Unreadable methods');bindings=readBindings(bindingFile,u.id)}catch{return res.status(500).json({ok:false,code:'METHOD_PUBLICATION_SOURCE_UNREADABLE'})}
  if(expected!==hash(envelope)&&expected!=='"'+hash(envelope)+'"')return res.status(409).json({ok:false,code:'ACTION_CONFLICT'});
  let source,payload,light;
  try{const n=envelope.data.nodes?.find(n=>n.id===b.nodeId),m=n?.methods?.find(m=>m.id===b.methodId);if(m?.author!==u.name)return res.status(403).json({ok:false,code:'METHOD_NOT_AUTHOR'});source=methodSource(n,m,b.sourceVersion,t=>t.ownership==='personal'?resolvePrivateTarget(config,u,t):resolveCatalogTarget(t));payload=tutorialPayload(source,b.visibility);if(b.visibility==='public'){if(b.publicConsent!==true||typeof b.lightId!=='string')return res.status(403).json({ok:false,code:'METHOD_PUBLIC_CONSENT_REQUIRED'});light=confirmedActionLight(envelope.data,n,b.lightId);if(!light)return res.status(403).json({ok:false,code:'KNOWLEDGE_LIGHT_REQUIRED'})}}catch(error){return res.status(400).json({ok:false,code:'METHOD_PUBLICATION_MISMATCH',message:error.message})}
  const same=bindings.filter(m=>m.source.ref.originId===source.ref.originId&&m.source.ref.targetVersion===source.ref.targetVersion&&m.source.source.id===source.source.id&&m.source.source.number===source.source.number);
  if(same.some(m=>m.source.sourceHash!==source.sourceHash))return res.status(409).json({ok:false,code:'METHOD_SOURCE_VERSION_REUSED'});
  const id='t-review-'+hash([u.id,payload.treeId,payload.nodeId,b.methodId]).slice(0,24),old=methods.find(m=>m.id===id);
  if(old&&(old.authorId!==u.id||old.treeId!==payload.treeId||old.nodeId!==payload.nodeId))return res.status(409).json({ok:false,code:'METHOD_PUBLICATION_ID_CONFLICT'});
  if(old?.archived)return res.status(409).json({ok:false,code:'METHOD_PUBLICATION_ARCHIVED'});
  const {treeId,nodeId,...content}=payload,version=contentVersion(content),existingBinding=same.find(m=>m.service.id===id&&m.service.version===version);
  if(old?.version===version&&existingBinding)return res.json({ok:true,tutorial:old,binding:existingBinding,repeated:true});
  if((old&&old.version!==version&&req.get('If-Method-Match')!==old.version)||(!old&&req.get('If-Method-Match')))return res.status(409).json({ok:false,code:'METHOD_PUBLICATION_CONFLICT'});
  const now=new Date().toISOString(),tutorial={...old,id,treeId,nodeId,authorId:u.id,authorName:u.name,...content,version,createdAt:old?.createdAt||now,updatedAt:now,sourceOrigin:{nodeId:b.nodeId,methodId:b.methodId,sourceVersion:b.sourceVersion},versions:old?structuredClone(old.versions):[]};
  if(!old||old.version!==version)tutorial.versions.push({...content,version,createdAt:now});
  const binding=bindReceipt(source,tutorial,u.id);if(light)binding.confirmationSource={lightId:light.id,eventId:light.eventId};
  if(!existingBinding)bindings.push(binding);if(old)methods[methods.indexOf(old)]=tutorial;else methods.push(tutorial);
  try{commit(config.dataDir,[{filePath:file,value:methods},{filePath:bindingFile,value:{format:'dianliang-method-bindings/v1',ownerId:u.id,bindings}}]);return res.status(old?200:201).json({ok:true,tutorial,binding,repeated:false})}
  catch{return res.status(500).json({ok:false,code:'METHOD_PUBLICATION_COMMIT_UNCONFIRMED',message:'发布回执尚未完成，请重试核对；恢复日志和原内容保留。'})}
 });
}
module.exports={installMethodPublicationRoutes};
