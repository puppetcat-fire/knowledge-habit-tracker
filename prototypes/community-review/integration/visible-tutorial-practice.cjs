const fs=require('node:fs'),path=require('node:path');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const {resolveVisiblePractice}=require('./knowledge-visible-targets.cjs');
function visibleTutorialPractice(config,event,body){
 const k=event?.knowledge,r=k?.serviceReference;
 if(k?.practiceMode!=='visible-tutorial'||!r||typeof r.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(r.id)||typeof r.version!=='string'||!/^[a-f0-9]{64}$/.test(r.version)||typeof r.authorId!=='string'||!r.authorId||typeof r.authorName!=='string'||!r.authorName.trim()||typeof k.nodeFive!=='string'||!Array.isArray(k.resourceLinks)||event.endedAt===null||!Number.isFinite(event.startedAt)||!Number.isFinite(event.endedAt)||event.endedAt<event.startedAt||!Array.isArray(event.segments)||event.segments.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<event.startedAt||s.end<s.start||s.end>event.endedAt))throw Error('教程实践快照或活动段不完整。');
 const target={id:k.nodeId,title:k.nodeTitle,goal:k.nodeGoal,five:k.nodeFive,version:k.nodeVersion,domain:k.nodeDomain,branch:k.nodeBranch,ownership:k.nodeOwnership,visibility:k.nodeVisibility};
 const ref=resolveVisiblePractice(config,target,k.targetServiceReference);
 const methods=JSON.parse(fs.readFileSync(path.join(config.dataDir,'tutorials.json'),'utf8'));if(!Array.isArray(methods))throw Error('教程档案无法读取。');
 const tutorial=methods.find(t=>t.id===r.id&&t.treeId===ref.treeId&&t.nodeId===ref.nodeId),v=tutorial?.versions?.find(v=>v.version===r.version&&v.visibility==='public');
 if(!v||body.tutorialId!==r.id||body.tutorialVersion!==r.version||tutorial.authorId!==r.authorId||tutorial.authorName!==r.authorName||k.methodAuthor!==r.authorName||k.methodId!=='visible-service-'+r.id+'-'+r.version||k.version!==1)throw Error('实际教程身份或当时版本不一致。');
 const s=v.targetSnapshot,c=tutorialInput(v);
 if(contentVersion(c)!==r.version||s?.version!==ref.targetVersion||s.nodeId!==ref.nodeId||s.treeId!==ref.treeId||s.sourceVersion!==target.version||s.ownerId!==ref.ownerId||['title','goal','five','domain','branch','ownership','visibility'].some(f=>s[f]!==target[f])||k.methodTitle!==c.title||k.content!==c.method||k.five!==c.startAction||k.resource!==''||JSON.stringify(k.resourceLinks)!==JSON.stringify(c.resources))throw Error('实际教程内容、材料或完整目标已不一致。');
 return {...ref,eventId:event.id,tutorialId:r.id,tutorialVersion:r.version,practiceMode:'visible-tutorial',tutorial:{...tutorial,...c,version:r.version,currentVisibility:tutorial.visibility}};
}
module.exports={visibleTutorialPractice};
