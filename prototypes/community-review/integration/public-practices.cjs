const {searchTerms,matchesSearch}=require('./public-search-terms.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {recoverTransactions}=require('../../../storage-transaction');
const {loadCatalog}=require('./knowledge-catalog.cjs');
const {disclosedTarget}=require('./knowledge-visible-targets.cjs');
const {readReceipts}=require('./knowledge-practice-store.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function readPublicPractices(config){
 recoverTransactions(config.dataDir);const records=fs.existsSync(config.recordsPath)?JSON.parse(fs.readFileSync(config.recordsPath,'utf8')):[],store=JSON.parse(fs.readFileSync(config.customNodesPath,'utf8'));if(!Array.isArray(records)||!Array.isArray(store.nodes)||!Array.isArray(store.trees))throw Error('Invalid public practice store');const catalog=loadCatalog(),canonical=new Map(catalog.nodes.map(n=>[JSON.stringify([n.treeId,n.id]),n])),nodes=new Map(store.nodes.map(n=>[JSON.stringify([n.treeId,n.id]),n])),trees=new Map(store.trees.map(t=>[t.id,t])),archives=new Map(),output=[];
 const tutorialFile=path.join(config.dataDir,'tutorials.json');
 const tutorials=new Map((fs.existsSync(tutorialFile)?JSON.parse(fs.readFileSync(tutorialFile,'utf8')):[]).map(t=>[t.id,t]));
 for(const r of records){if(!r||r.visibility!=='public')continue;const key=JSON.stringify([r.treeId,r.nodeId]),n=nodes.get(key),tree=trees.get(r.treeId);if(!n||n.visibility!=='public'||tree?.visibility!=='public')continue;let currentTarget,kind;if(n.publicationOrigin){currentTarget=disclosedTarget(n,tree);kind='personal-public'}else{kind='catalog';const expected=canonical.get(key);if(!expected)continue;if(['title','goal','five','domain','branch','ownership','visibility','sourceVersion','version','ownerId'].some(k=>n[k]!==expected[k]))throw Error('Public target drift');currentTarget=expected}
  if(typeof r.id!=='string'||typeof r.authorId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(r.authorId)||typeof r.authorName!=='string'||typeof r.text!=='string'||!Number.isFinite(Date.parse(r.createdAt))||!Array.isArray(r.images))throw Error('Invalid public record');let proof=null;
  if(r.sourceFingerprint){if(!archives.has(r.authorId))archives.set(r.authorId,readReceipts(path.join(config.dataDir,'practice-receipts',r.authorId+'.json'),r.authorId));const receipt=archives.get(r.authorId).receipts.findLast(p=>p.record.id===r.id);if(receipt&&receipt.record.visibility==='public'){if(receipt.record.eventId!==r.eventId||receipt.record.treeId!==r.treeId||receipt.record.nodeId!==r.nodeId||receipt.record.targetVersion!==r.targetVersion||receipt.record.tutorialId!==r.tutorialId||receipt.record.tutorialVersion!==r.tutorialVersion||receipt.record.sourceFingerprint!==r.sourceFingerprint||JSON.stringify(receipt.record.sourceSnapshot)!==JSON.stringify(r.sourceSnapshot))throw Error('Changed public practice snapshot');proof=receipt}}
  const item={kind,currentTarget,id:r.id,authorId:r.authorId,authorName:r.authorName,treeId:r.treeId,nodeId:r.nodeId,createdAt:r.createdAt,text:r.text,lightUp:r.lightUp===true,images:r.images.map(p=>{if(typeof p.id!=='string'||typeof p.mediaType!=='string')throw Error('Invalid public image');return {id:p.id,mediaType:p.mediaType}}),snapshotStatus:proof?'bound':'unverified'};
  if(proof){const k=r.sourceSnapshot,a=r.activity;if(typeof k?.nodeTitle!=='string'||typeof k.nodeGoal!=='string'||!Number.isFinite(a?.actualMilliseconds)||a.actualMilliseconds<0||!Number.isInteger(a.segmentCount)||a.segmentCount<0)throw Error('Invalid public snapshot');const actual=proof.activitySnapshot.segments.reduce((sum,p)=>sum+p.end-p.start,0);if(actual!==a.actualMilliseconds||proof.activitySnapshot.segments.length!==a.segmentCount)throw Error('Public activity mismatch');item.snapshot=Object.fromEntries(['nodeTitle','nodeGoal','nodeVersion','methodTitle','methodAuthor','version','content','five','resource','resourceLinks'].filter(k=>r.sourceSnapshot[k]!==undefined).map(k=>[k,r.sourceSnapshot[k]]));item.independent=r.tutorialId===null;item.tutorialReference=r.tutorialId?{id:r.tutorialId,version:r.tutorialVersion}:null;item.activity={actualMilliseconds:a.actualMilliseconds,segmentCount:a.segmentCount}}
  if(proof&&r.tutorialId){
   const tutorial=tutorials.get(r.tutorialId);
   const visible=tutorial?.visibility==='public'&&tutorial.treeId===r.treeId&&tutorial.nodeId===r.nodeId&&
    tutorial.versions?.some(v=>v.version===r.tutorialVersion&&v.visibility==='public');
   if(!visible){
    item.snapshot={nodeTitle:item.snapshot.nodeTitle,nodeGoal:item.snapshot.nodeGoal,nodeVersion:item.snapshot.nodeVersion};
    item.tutorialReference=null;
    item.tutorialUnavailable=true;
   }
  }
  output.push(item);
 }
 if(new Set(output.map(r=>r.id)).size!==output.length)throw Error('Duplicate public practice');return output.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
}
function matchesPracticeSearch(practice,terms){
 const {authorName,text,currentTarget,snapshot}=practice;
 const fields=[authorName,text,currentTarget.title,currentTarget.goal,snapshot?.nodeTitle,snapshot?.nodeGoal,snapshot?.methodTitle,snapshot?.methodAuthor];
 return matchesSearch(fields,terms);
}
function installPublicPractices(app,{config,authenticate}){
 app.get('/api/review-public-practices/one',(req,res)=>{const u=authenticate(req);if(!u)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});const id=req.query.id;if(typeof id!=='string'||!id||id.length>100)return res.status(400).json({ok:false,code:'PUBLIC_PRACTICE_INPUT'});try{const practice=readPublicPractices(config).find(p=>p.id===id);if(!practice)return res.status(404).json({ok:false,code:'PUBLIC_PRACTICE_UNAVAILABLE',message:'这条实践或目标已不再公开，请重新读取。'});return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,practice})}catch{return res.status(503).json({ok:false,code:'PUBLIC_PRACTICE_UNREADABLE'})}});

 app.get('/api/review-public-practices',(req,res)=>{const u=authenticate(req);if(!u)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});const query=req.query.query??'',cursor=req.query.cursor??'',authorId=req.query.authorId??'',treeId=req.query.treeId??'',nodeId=req.query.nodeId??'',limit=req.query.limit===undefined?20:Number(req.query.limit);if(typeof treeId!=='string'||typeof nodeId!=='string'||Boolean(treeId)!==Boolean(nodeId)||[treeId,nodeId].some(v=>v&&!/^[A-Za-z0-9_-]{1,100}$/.test(v))||typeof authorId!=='string'||(authorId&&!/^[A-Za-z0-9_-]{1,64}$/.test(authorId))||typeof query!=='string'||query.length>120||typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:'PUBLIC_PRACTICE_INPUT'});
  try{const all=readPublicPractices(config),terms=searchTerms(query),matches=all.filter(r=>(!authorId||r.authorId===authorId)&&(!nodeId||r.treeId===treeId&&r.nodeId===nodeId)&&matchesPracticeSearch(r,terms)),revision=hash({ownerId:u.id,query,authorId,treeId,nodeId,limit,records:matches});let offset=0;if(cursor){const [v,p,...rest]=cursor.split(':');if(rest.length||v!==revision||!/^(0|[1-9][0-9]*)$/.test(p||''))return res.status(409).json({ok:false,code:'PUBLIC_PRACTICE_CURSOR_CHANGED',message:'公开实践已变化，请重新读取第一页。'});offset=Number(p);if(!Number.isSafeInteger(offset)||offset>matches.length)return res.status(400).json({ok:false,code:'PUBLIC_PRACTICE_INPUT'})}const practices=matches.slice(offset,offset+limit);return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,query,authorId,treeId,nodeId,total:matches.length,practices,nextCursor:offset+practices.length<matches.length?revision+':'+(offset+practices.length):null})}catch{return res.status(503).json({ok:false,code:'PUBLIC_PRACTICE_UNREADABLE',message:'公开实践或当时快照无法核对，原资料保留，请稍后重试。'})}
 });
}
module.exports={installPublicPractices,readPublicPractices};
