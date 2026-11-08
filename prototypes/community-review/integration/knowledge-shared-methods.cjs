const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {recoverTransactions}=require('../../../storage-transaction');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {resolveCatalogTarget,loadCatalog}=require('./knowledge-catalog.cjs');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const {sharedMethod}=require('./knowledge-version-mapping.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function installSharedMethodRoutes(app,{config,authenticate}){
 app.get('/api/review-shared-methods',(req,res)=>{
  const u=authenticate(req);if(!u)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});
  if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  const expected=req.get('If-Match');if(!expected)return res.status(428).json({ok:false,code:'ACTION_REVISION_REQUIRED'});
  if(typeof req.query.nodeId!=='string')return res.status(400).json({ok:false,code:'SHARED_TARGET_REQUIRED'});
  let source,methods;
  try{recoverTransactions(config.dataDir);if(!/^[A-Za-z0-9_-]{1,64}$/.test(u.id))throw Error('Invalid user');source=JSON.parse(fs.readFileSync(path.join(config.dataDir,'action-states',u.id+'.json'),'utf8'));if(source.format!==FORMAT)throw Error('Invalid source');validateActionState(source.data);const file=path.join(config.dataDir,'tutorials.json');methods=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];if(!Array.isArray(methods))throw Error('Unreadable methods')}
  catch{return res.status(500).json({ok:false,code:'SHARED_METHOD_STORE_UNREADABLE'})}
  if(expected!==hash(source)&&expected!=='"'+hash(source)+'"')return res.status(409).json({ok:false,code:'ACTION_CONFLICT'});
  let ref;try{ref=resolveCatalogTarget(source.data.nodes?.find(n=>n.id===req.query.nodeId))}catch{return res.status(409).json({ok:false,code:'SHARED_TARGET_MISMATCH',message:'当前完整目标与服务目录不一致，未加载其他目标的方法。'})}
  try{
   const tutorials=methods.filter(t=>!t.archived&&t.authorId!==u.id&&t.visibility==='public'&&t.treeId===ref.treeId&&t.nodeId===ref.nodeId).map(t=>{
    if(typeof t.id!=='string'||!t.id||typeof t.authorId!=='string'||!t.authorId||typeof t.authorName!=='string'||!t.authorName.trim())throw Error('Missing author identity');
    const v=t.versions?.findLast(v=>v.version===t.version&&v.visibility==='public');if(!v)throw Error('Missing current public version');
    const content=tutorialInput(v);if(contentVersion(content)!==t.version||!Number.isFinite(Date.parse(v.createdAt)))throw Error('Invalid service receipt');
    return {id:t.id,version:t.version,treeId:t.treeId,nodeId:t.nodeId,authorId:t.authorId,authorName:t.authorName,createdAt:v.createdAt,...content};
   });
   const canonical=loadCatalog().nodes.find(n=>n.id===ref.nodeId);
   const references=tutorials.map(t=>sharedMethod(source.data.nodes.find(n=>n.id===req.query.nodeId),t));
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,ref,target:canonical,tutorials,methods:references});
  }catch{return res.status(500).json({ok:false,code:'SHARED_METHOD_VERSION_UNREADABLE'})}
 });
}
module.exports={installSharedMethodRoutes};
