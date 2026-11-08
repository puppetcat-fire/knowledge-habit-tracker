const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicJson}=require('../../../storage-transaction');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {methodSource,bindReceipt}=require('./knowledge-version-mapping.cjs');
const {resolvePrivateTarget}=require('./knowledge-private-targets.cjs');
const {resolveCatalogTarget}=require('./knowledge-catalog.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function accountFile(directory,user){if(!user||!/^[A-Za-z0-9_-]{1,64}$/.test(user.id))throw Error('Invalid account');return path.join(directory,user.id+'.json')}
function readBindings(file,ownerId){
 if(!fs.existsSync(file))return [];
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(value?.format!=='dianliang-method-bindings/v1'||value.ownerId!==ownerId||!Array.isArray(value.bindings))throw Error('Unreadable binding store');
 for(const b of value.bindings){if(b?.format!=='dianliang-method-binding/v1'||b.source?.ref?.visibility==='private'&&b.source.ref.ownerId!==ownerId)throw Error('Invalid binding');bindReceipt(b.source,b.service,b.service.authorId)}
 return value.bindings;
}
function installMethodBindingRoutes(app,{config,authenticate}){
 const directory=path.join(config.dataDir,'method-bindings');
 function owner(req,res){const user=authenticate(req);if(!user){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return user}
 app.get('/api/review-method-bindings',(req,res)=>{
  const user=owner(req,res);if(!user)return;
  try{return res.set('Cache-Control','no-store').json({ok:true,bindings:readBindings(accountFile(directory,user),user.id)})}
  catch{return res.status(500).json({ok:false,code:'METHOD_BINDING_STORE_UNREADABLE'})}
 });
 app.post('/api/review-method-bindings',(req,res)=>{
  const user=owner(req,res);if(!user)return;
  const expected=req.get('If-Match');if(!expected)return res.status(428).json({ok:false,code:'ACTION_REVISION_REQUIRED'});
  let envelope,bindings,tutorials;
  const file=accountFile(directory,user);
  let binding;
  try{
   const sourceFile=accountFile(path.join(config.dataDir,'action-states'),user);
   envelope=fs.existsSync(sourceFile)?JSON.parse(fs.readFileSync(sourceFile,'utf8')):null;
   if(envelope!==null){if(envelope.format!==FORMAT)throw Error('Invalid source format');validateActionState(envelope.data)}
   bindings=readBindings(file,user.id);
   const tutorialFile=path.join(config.dataDir,'tutorials.json');tutorials=fs.existsSync(tutorialFile)?JSON.parse(fs.readFileSync(tutorialFile,'utf8')):[];
   if(!Array.isArray(tutorials)||tutorials.some(t=>!t||typeof t!=='object'||!Array.isArray(t.versions)))throw Error('Unreadable tutorial store');
  }catch{return res.status(500).json({ok:false,code:'METHOD_BINDING_SOURCE_UNREADABLE'})}
  const revision=hash(envelope);if(expected!==revision&&expected!=='"'+revision+'"')return res.status(409).json({ok:false,code:'ACTION_CONFLICT'});
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['nodeId','methodId','sourceVersion','tutorialId','tutorialVersion'].includes(k)))return res.status(400).json({ok:false,code:'METHOD_BINDING_INPUT'});
  const tutorial=tutorials.find(t=>t.id===body.tutorialId);
  const version=tutorial?.versions?.find(v=>v.version===body.tutorialVersion);
  if(!tutorial||!version||!(tutorial.authorId===user.id||(tutorial.visibility==='public'&&version.visibility==='public')))return res.status(404).json({ok:false,code:'METHOD_VERSION_UNAVAILABLE'});
  try{
   const node=envelope?.data.nodes?.find(n=>n.id===body.nodeId),method=node?.methods?.find(m=>m.id===body.methodId);
   const source=methodSource(node,method,body.sourceVersion,t=>t.ownership==='personal'?resolvePrivateTarget(config,user,t):resolveCatalogTarget(t));
   binding=bindReceipt(source,{...version,id:tutorial.id,treeId:tutorial.treeId,nodeId:tutorial.nodeId,authorId:tutorial.authorId,authorName:tutorial.authorName},tutorial.authorId);
   const same=bindings.filter(b=>b.source.ref.originId===source.ref.originId&&b.source.ref.targetVersion===source.ref.targetVersion&&b.source.source.id===source.source.id&&b.source.source.number===source.source.number);
   if(same.some(b=>b.source.sourceHash!==source.sourceHash))return res.status(409).json({ok:false,code:'METHOD_SOURCE_VERSION_REUSED',message:'同一原版本的内容已变化，需要保留旧映射并建立明确的新版本。'});
   const existing=same.find(b=>b.service.id===binding.service.id&&b.service.version===binding.service.version);
   if(existing)return res.json({ok:true,binding:existing,repeated:true});
  }catch(error){return res.status(400).json({ok:false,code:'METHOD_BINDING_MISMATCH',message:error.message})}
  try{bindings.push(binding);atomicJson(file,{format:'dianliang-method-bindings/v1',ownerId:user.id,bindings});return res.status(201).json({ok:true,binding,repeated:false})}
  catch{return res.status(500).json({ok:false,code:'METHOD_BINDING_SAVE_FAILED',message:'映射尚未保存，请重试；原档案保留。'})}
 });
}
module.exports={installMethodBindingRoutes,readBindings};
