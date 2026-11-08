const {searchTerms,matchesSearch}=require('./public-search-terms.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {recoverTransactions}=require('../../../storage-transaction');
const {loadCatalog}=require('./knowledge-catalog.cjs');
const {disclosedTarget}=require('./knowledge-visible-targets.cjs');
const {readPublicPaths}=require('./knowledge-path-publications.cjs');
const {readPublicPractices}=require('./public-practices.cjs');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function readPublicTutorials(config){
 recoverTransactions(config.dataDir);
 const file=path.join(config.dataDir,'tutorials.json'),tutorials=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[],store=JSON.parse(fs.readFileSync(config.customNodesPath,'utf8'));
 if(!Array.isArray(tutorials)||!Array.isArray(store.nodes)||!Array.isArray(store.trees))throw Error('Invalid public store');
 const catalog=loadCatalog(),nodes=new Map(store.nodes.map(n=>[JSON.stringify([n.treeId,n.id]),n])),trees=new Map(store.trees.map(t=>[t.id,t])),canonical=new Map(catalog.nodes.map(n=>[JSON.stringify([n.treeId,n.id]),n]));
 const results=[];
 for(const t of tutorials){
  if(!t||t.archived||t.visibility!=='public')continue;
  const key=JSON.stringify([t.treeId,t.nodeId]),n=nodes.get(key),tree=trees.get(t.treeId);if(!n||n.visibility!=='public'||tree?.visibility!=='public')continue;
  let target,kind;
  if(n.publicationOrigin){target=disclosedTarget(n,tree);kind='personal-public';if(!t.targetSnapshot||t.targetSnapshot.version!==target.version)continue;if(JSON.stringify(t.targetSnapshot)!==JSON.stringify(target))throw Error('Invalid public target binding')}
  else {const expected=canonical.get(key);if(!expected)continue;if(['title','goal','five','domain','branch','ownership','visibility','sourceVersion','version','ownerId'].some(k=>n[k]!==expected[k]))throw Error('Catalog drift');target=expected;kind='catalog'}
  const v=t.versions?.findLast(v=>v.version===t.version&&v.visibility==='public'),content=v&&tutorialInput(v);
  if(!v||typeof t.id!=='string'||!t.id||typeof t.authorId!=='string'||!t.authorId||typeof t.authorName!=='string'||!t.authorName.trim()||contentVersion(content)!==t.version||contentVersion(tutorialInput(t))!==t.version||!Number.isFinite(Date.parse(v.createdAt)))throw Error('Invalid current public tutorial');
  if(kind==='personal-public'&&JSON.stringify(v.targetSnapshot)!==JSON.stringify(target))throw Error('Invalid public version binding');
  // Only disclosed current fields are returned: never history, origins or private drafts.
  results.push({id:t.id,treeId:t.treeId,nodeId:t.nodeId,authorId:t.authorId,authorName:t.authorName,version:t.version,createdAt:v.createdAt,kind,target,...content});
 }
 if(new Set(results.map(t=>t.id)).size!==results.length)throw Error('Duplicate tutorial identity');
 return results.sort((a,b)=>a.id.localeCompare(b.id));
}
function installPublicTutorialSearch(app,{config,authenticate}){
 app.get('/api/review-public-tutorials/author',(req,res)=>{
  const user=authenticate(req);if(!user)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  const id=req.query.id;if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(id))return res.status(400).json({ok:false,code:'PUBLIC_TUTORIAL_INPUT'});
  try{const tutorials=readPublicTutorials(config).filter(t=>t.authorId===id),practice=tutorials.length?null:readPublicPractices(config).find(p=>p.authorId===id);const publicPath=tutorials.length||practice?null:readPublicPaths(config).find(p=>p.authorId===id);if(!tutorials.length&&!practice&&!publicPath)return res.status(404).json({ok:false,code:'PUBLIC_AUTHOR_UNAVAILABLE',message:'这位作者当前没有可公开读取的教程、实践或路径，请重新读取。'});
   const file=path.join(config.dataDir,'profiles.json'),profiles=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];if(!Array.isArray(profiles))throw Error('Invalid profile store');const own=profiles.filter(p=>p?.id===id);if(own.length>1)throw Error('Duplicate profile');let profile=null;
   if(own[0]?.visibility==='public'){profile={};for(const [key,max] of [['tagline',120],['about',1600],['focus',120]]){if(typeof own[0][key]!=='string'||own[0][key].length>max)throw Error('Invalid public profile');profile[key]=own[0][key]}}
   return res.set('Cache-Control','no-store').json({ok:true,ownerId:user.id,author:{id,name:tutorials[0]?.authorName||practice?.authorName||publicPath.authorName,profile},total:tutorials.length});
  }catch{return res.status(503).json({ok:false,code:'PUBLIC_AUTHOR_STORE_UNREADABLE',message:'公开作者资料暂时无法核对，请稍后重试。'})}
 });
 app.get('/api/review-public-tutorials/one',(req,res)=>{
  const user=authenticate(req);if(!user)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  if(typeof req.query.id!=='string'||!req.query.id||req.query.id.length>100)return res.status(400).json({ok:false,code:'PUBLIC_TUTORIAL_INPUT'});
  try{const tutorial=readPublicTutorials(config).find(t=>t.id===req.query.id);if(!tutorial)return res.status(404).json({ok:false,code:'PUBLIC_TUTORIAL_UNAVAILABLE',message:'教程或对应目标已不可公开读取，请重新搜索。'});return res.set('Cache-Control','no-store').json({ok:true,ownerId:user.id,tutorial})}catch{return res.status(503).json({ok:false,code:'PUBLIC_TUTORIAL_STORE_UNREADABLE'})}
 });
 app.get('/api/review-public-tutorials',(req,res)=>{
  const user=authenticate(req);if(!user)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  const query=req.query.query??'',cursor=req.query.cursor??'',order=req.query.order??'stable',authorId=req.query.authorId??'',limit=req.query.limit===undefined?20:Number(req.query.limit);
  if(typeof query!=='string'||query.length>120||typeof cursor!=='string'||cursor.length>100||typeof authorId!=='string'||authorId!==''&&!/^[A-Za-z0-9_-]{1,64}$/.test(authorId)||!['stable','recent'].includes(order)||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'PUBLIC_TUTORIAL_INPUT'});
  try{const all=readPublicTutorials(config),terms=searchTerms(query),matches=all.filter(t=>(!authorId||t.authorId===authorId)&&matchesSearch([t.title,t.method,t.startAction,t.authorName,t.target.title,t.target.goal,t.target.domain,t.target.branch],terms));
   if(order==='recent')matches.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
   const revision=hash({query,order,authorId,limit,tutorials:matches});let offset=0;
   if(cursor){const [version,position,...rest]=cursor.split(':');if(rest.length||version!==revision||!/^(0|[1-9][0-9]*)$/.test(position||''))return res.status(409).json({ok:false,code:'PUBLIC_TUTORIAL_CURSOR_CHANGED',message:'公开教程已有变化，请重新读取第一页。'});offset=Number(position);if(!Number.isSafeInteger(offset)||offset>matches.length)return res.status(400).json({ok:false,code:'PUBLIC_TUTORIAL_INPUT'})}
   const tutorials=matches.slice(offset,offset+limit);return res.set('Cache-Control','no-store').json({ok:true,ownerId:user.id,query,order,authorId,revision,total:matches.length,tutorials,nextCursor:offset+tutorials.length<matches.length?revision+':'+(offset+tutorials.length):null});
  }catch{return res.status(503).json({ok:false,code:'PUBLIC_TUTORIAL_STORE_UNREADABLE',message:'公开教程或目标版本无法核对，原资料保留，请稍后重新读取。'})}
 });
}
module.exports={installPublicTutorialSearch,readPublicTutorials};
