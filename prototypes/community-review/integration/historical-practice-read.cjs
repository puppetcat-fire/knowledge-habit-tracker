const fs=require('node:fs'),path=require('node:path');
const {readReceipts}=require('./knowledge-practice-store.cjs');
function installHistoricalPracticeRead(app,{config,sessionAccount}){
 app.get('/api/records',async(req,res,next)=>{
  let user;try{user=await sessionAccount(req)}catch{return res.status(503).json({ok:false,code:'ACCOUNT_SERVICE_UNAVAILABLE'})}
  if(!user)return next();if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  // 历史回填只服务个人记录，公开发现必须保留原筛选与分页。
  if(req.query.scope==='public'||req.query.scope==='following')return next();
  const json=res.json.bind(res);res.set('Cache-Control','no-store');
  res.json=body=>{
   if(!body?.ok||!Array.isArray(body.records))return json(body);
   try{if(!/^[A-Za-z0-9_-]{1,64}$/.test(user.id))throw Error('Invalid owner');const archive=readReceipts(path.join(config.dataDir,'practice-receipts',user.id+'.json'),user.id),records=fs.existsSync(config.recordsPath)?JSON.parse(fs.readFileSync(config.recordsPath,'utf8')):[];if(!Array.isArray(records))throw Error('Unreadable records');const present=new Set(body.records.map(r=>r.id)),treeId=typeof req.query.treeId==='string'?req.query.treeId:'',nodeId=typeof req.query.nodeId==='string'?req.query.nodeId:'';
    const ownHistory=records.filter(r=>r.authorId===user.id&&!present.has(r.id)&&(!treeId||r.treeId===treeId)&&(!nodeId||r.nodeId===nodeId)&&archive.receipts.some(receipt=>{const proof=receipt.sourceSnapshot?.targetServiceReference,original=receipt.record;return proof&&original.id===r.id&&original.eventId===r.eventId&&original.authorId===r.authorId&&original.treeId===r.treeId&&original.nodeId===r.nodeId&&original.targetVersion===r.targetVersion&&proof.treeId===r.treeId&&proof.nodeId===r.nodeId&&proof.targetVersion===r.targetVersion&&JSON.stringify(original.sourceSnapshot)===JSON.stringify(r.sourceSnapshot)})).map(r=>({...r,historicalTargetOnly:true}));
    return json({...body,records:[...body.records,...ownHistory].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))});
   }catch{res.status(500);return json({ok:false,code:'PRACTICE_HISTORY_UNREADABLE',message:'本人历史快照无法核对，原文件保留，未返回其他账号的数据。'})}
  };next();
 });
}
module.exports={installHistoricalPracticeRead};
