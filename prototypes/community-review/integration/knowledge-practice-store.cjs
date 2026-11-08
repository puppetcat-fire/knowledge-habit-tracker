const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {commitTransaction,recoverTransactions}=require('../../../storage-transaction');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {readBindings}=require('./knowledge-binding-store.cjs');
const {practiceBinding}=require('./knowledge-version-mapping.cjs');
const {independentPractice}=require('./knowledge-independent-practice.cjs');
const {resolvePrivateTarget}=require('./knowledge-private-targets.cjs');
const {resolveVisiblePractice}=require('./knowledge-visible-targets.cjs');
const {visibleTutorialPractice}=require('./visible-tutorial-practice.cjs');
const clone=v=>JSON.parse(JSON.stringify(v)),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
function ownerFile(config,user,folder){if(!/^[A-Za-z0-9_-]{1,64}$/.test(user.id))throw Error('Invalid owner');return path.join(config.dataDir,folder,user.id+'.json')}
function readReceipts(file,ownerId){const v=read(file,{format:'dianliang-practice-receipts/v1',ownerId,receipts:[]});if(v?.format!=='dianliang-practice-receipts/v1'||v.ownerId!==ownerId||!Array.isArray(v.receipts)||v.receipts.some(r=>!r||typeof r.eventId!=='string'||r.record?.eventId!==r.eventId||r.record?.authorId!==ownerId||hash(r.record)!==r.recordRevision||!r.sourceSnapshot||!Array.isArray(r.activitySnapshot?.segments)||hash({knowledge:r.sourceSnapshot,activity:r.activitySnapshot})!==r.record.sourceFingerprint))throw Error('Unreadable receipt store');return v}
function installReviewPracticeRoutes(app,{config,authenticate,commit=commitTransaction}){
 function owner(req,res){const u=authenticate(req);if(!u){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return u}
 app.get('/api/review-practices',(req,res)=>{const u=owner(req,res);if(!u)return;try{recoverTransactions(config.dataDir);const archive=readReceipts(ownerFile(config,u,'practice-receipts'),u.id),records=read(config.recordsPath,[]);if(!Array.isArray(records))throw Error('Unreadable current records');const ids=new Set(archive.receipts.map(r=>r.eventId)),current=records.filter(r=>r.authorId===u.id&&ids.has(r.eventId)).map(record=>({eventId:record.eventId,record,recordRevision:hash(record)}));return res.set('Cache-Control','no-store').json({ok:true,...archive,current})}catch{return res.status(500).json({ok:false,code:'PRACTICE_STORE_UNREADABLE'})}});
 app.post('/api/review-practices',(req,res)=>{
  const u=owner(req,res);if(!u)return;
  const expected=req.get('If-Match');if(!expected)return res.status(428).json({ok:false,code:'ACTION_REVISION_REQUIRED'});
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['eventId','tutorialId','tutorialVersion','lightId','visibility','shareExistingImages','practiceMode'].includes(k))||!['private','public'].includes(b.visibility)||(b.practiceMode!==undefined&&!['independent','visible-tutorial'].includes(b.practiceMode))||(b.shareExistingImages!==undefined&&typeof b.shareExistingImages!=='boolean'))return res.status(400).json({ok:false,code:'PRACTICE_INPUT_INVALID'});
  const independent=b.practiceMode==='independent',visibleTutorial=b.practiceMode==='visible-tutorial';
  if(independent&&(b.tutorialId!==null||b.tutorialVersion!==null))return res.status(400).json({ok:false,code:'PRACTICE_INPUT_INVALID'});
  let source,bindings,records,archive,tutorials;const file=ownerFile(config,u,'practice-receipts');
  try{recoverTransactions(config.dataDir);source=read(ownerFile(config,u,'action-states'),null);if(source?.format!==FORMAT)throw Error('Missing source');validateActionState(source.data);bindings=independent||visibleTutorial?[]:readBindings(ownerFile(config,u,'method-bindings'),u.id);records=read(config.recordsPath,[]);archive=readReceipts(file,u.id);tutorials=independent?[]:read(path.join(config.dataDir,'tutorials.json'),[]);if(!Array.isArray(records)||!Array.isArray(tutorials)||tutorials.some(t=>!t||!Array.isArray(t.versions)))throw Error('Unreadable records')}
  catch{return res.status(500).json({ok:false,code:'PRACTICE_SOURCE_UNREADABLE'})}
  const revision=hash(source);if(expected!==revision&&expected!=='"'+revision+'"')return res.status(409).json({ok:false,code:'ACTION_CONFLICT'});
  const event=source.data.events.find(e=>e.id===b.eventId),binding=bindings.find(m=>m.service.id===b.tutorialId&&m.service.version===b.tutorialVersion&&m.source.source.id===event?.knowledge?.methodId&&m.source.source.number===event?.knowledge?.version&&m.source.ref.sourceVersion===event?.knowledge?.nodeVersion&&m.source.target.title===event?.knowledge?.nodeTitle&&m.source.target.goal===event?.knowledge?.nodeGoal);
  if(!event||!independent&&!visibleTutorial&&!binding)return res.status(404).json({ok:false,code:'PRACTICE_MAPPING_UNAVAILABLE'});
  let mapped;try{mapped=visibleTutorial?visibleTutorialPractice(config,event,b):independent?independentPractice(event,source.data.nodes,t=>resolvePrivateTarget(config,u,t),(t,r)=>resolveVisiblePractice(config,t,r)):practiceBinding(event,binding);if(binding?.source.ref.visibility==='private'&&JSON.stringify(resolvePrivateTarget(config,u,binding.source.target))!==JSON.stringify(binding.source.ref))throw Error('私人目标回执已变化，请先核对。')}catch(error){return res.status(400).json({ok:false,code:'PRACTICE_SNAPSHOT_MISMATCH',message:error.message})}
  if(b.visibility==='public'&&mapped.targetVisibility==='private')return res.status(403).json({ok:false,code:'PRIVATE_TARGET_PUBLIC_REVIEW_REQUIRED',message:'这个目标在服务中仍为私人，实践仅对本人保存；分享目标需另行核对。'});
  const light=b.lightId?(source.data.lights||[]).find(l=>l.id===b.lightId&&l.eventId===event.id&&l.nodeId===event.knowledge.nodeId):null;
  if(b.lightId&&!light)return res.status(404).json({ok:false,code:'PRACTICE_LIGHT_UNAVAILABLE'});
  const confirmed=light?.confirmed===true;
  if(confirmed&&!(typeof light.result==='string'&&light.result.trim()&&typeof light.evidence==='string'&&light.evidence.trim()))return res.status(400).json({ok:false,code:'PRACTICE_EVIDENCE_REQUIRED'});
  if(b.visibility==='public'){
   const tutorial=visibleTutorial?mapped.tutorial:binding&&tutorials.find(t=>t.id===binding.service.id),version=tutorial?.versions?.find(v=>v.version===mapped.tutorialVersion);
   if(!confirmed||light.public!==true||(!independent&&(tutorial?.archived||(visibleTutorial?tutorial?.currentVisibility:tutorial?.visibility)!=='public'||version?.visibility!=='public')))return res.status(403).json({ok:false,code:'PRACTICE_PUBLIC_CONFIRMATION_REQUIRED'});
  }
  const activity={startedAt:event.startedAt,endedAt:event.endedAt,segments:clone(event.segments)};
  const snapshot=Object.fromEntries(['nodeId','nodeTitle','nodeGoal','nodeVersion','methodId','methodTitle','version','content','five','resource'].map(k=>[k,event.knowledge[k]]));
  if(independent){snapshot.practiceMode='independent';for(const key of ['nodeDomain','nodeBranch','nodeOwnership','nodeVisibility'])if(event.knowledge[key]!==undefined)snapshot[key]=event.knowledge[key]}
  else{const service=visibleTutorial?mapped.tutorial:binding.service;snapshot.methodAuthor=service.authorName;snapshot.serviceReference={id:service.id,version:service.version,authorId:service.authorId,authorName:service.authorName};if(visibleTutorial||binding.source.source.resourceLinks!==undefined)snapshot.resourceLinks=clone(service.resources);if(visibleTutorial){snapshot.practiceMode='visible-tutorial';for(const key of ['nodeFive','nodeDomain','nodeBranch','nodeOwnership','nodeVisibility'])snapshot[key]=event.knowledge[key]}}
  const fingerprint=hash({knowledge:event.knowledge,activity});
  const old=records.find(r=>r.authorId===u.id&&r.eventId===event.id&&r.treeId===mapped.treeId&&r.nodeId===mapped.nodeId);
  if(old&&old.sourceFingerprint!==fingerprint)return res.status(409).json({ok:false,code:'PRACTICE_SOURCE_CHANGED'});
  if(old?.visibility==='private'&&old.images?.length&&b.visibility==='public'&&b.shareExistingImages!==true)return res.status(409).json({ok:false,code:'PRACTICE_PRIVATE_IMAGES_REQUIRE_REVIEW',message:'原私人图片仍保留；公开前需要明确选择是否一并公开。'});
  const content={treeId:mapped.treeId,nodeId:mapped.nodeId,authorId:u.id,authorName:u.name,eventId:event.id,visibility:b.visibility,lightUp:confirmed,text:confirmed?light.result+'\n'+light.evidence:'这次知识实践已结束，尚未确认点亮。',images:clone(old?.images||[]),tutorialId:mapped.tutorialId,tutorialVersion:mapped.tutorialVersion,targetVersion:mapped.targetVersion,sourceSnapshot:snapshot,sourceFingerprint:fingerprint,activity:{actualMilliseconds:event.segments.reduce((sum,p)=>sum+p.end-p.start,0),segmentCount:event.segments.length}};
  if(independent||visibleTutorial)content.practiceMode=mapped.practiceMode;
  const oldContent=old&&Object.fromEntries(Object.keys(content).map(k=>[k,old[k]]));
  if(old&&JSON.stringify(oldContent)===JSON.stringify(content))return res.json({ok:true,record:old,recordRevision:hash(old),repeated:true});
  if(old&&req.get('If-Practice-Match')!==hash(old))return res.status(409).json({ok:false,code:'PRACTICE_CONFLICT'});
  const now=new Date().toISOString(),record={...content,id:old?.id||'rp-'+hash([u.id,event.id,mapped.treeId,mapped.nodeId]).slice(0,24),createdAt:old?.createdAt||now,updatedAt:now};
  if(old)records[records.indexOf(old)]=record;else records.unshift(record);
  archive.receipts.push({eventId:event.id,recordRevision:hash(record),record:clone(record),sourceSnapshot:clone(event.knowledge),activitySnapshot:activity});
  try{commit(config.dataDir,[{filePath:config.recordsPath,value:records},{filePath:file,value:archive}]);return res.status(old?200:201).json({ok:true,record,recordRevision:hash(record),repeated:false})}
  catch{return res.status(500).json({ok:false,code:'PRACTICE_COMMIT_UNCONFIRMED',message:'提交回执尚未完成，请重试核对；恢复日志和原档案保留。'})}
 });
}
module.exports={installReviewPracticeRoutes,readReceipts};
