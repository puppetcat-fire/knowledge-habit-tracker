const {resolveCatalogTarget}=require('./knowledge-catalog.cjs');
function independentPractice(event,nodes,resolvePrivate,resolveVisible){
 const k=event?.knowledge;
 if(!k||k.methodId!==null||k.version!==null||k.methodTitle!=='独立尝试'||k.content!==''||k.resource!==''||k.resourceLinks!==undefined||k.serviceReference!==undefined||k.methodAuthor!==undefined)throw Error('这条事件不是未选教程的独立尝试，不能移除当时的方法引用。');
 if(event.endedAt===null||!Number.isFinite(event.startedAt)||!Number.isFinite(event.endedAt)||event.endedAt<event.startedAt||!Array.isArray(event.segments)||event.segments.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<event.startedAt||s.end<s.start||s.end>event.endedAt))throw Error('独立实践尚未结束或活动区间不完整。');
 const fields=['nodeDomain','nodeBranch','nodeOwnership','nodeVisibility'],has=fields.some(f=>k[f]!==undefined);
 let target;
 if(has){
  if(fields.some(f=>typeof k[f]!=='string'))throw Error('当时的完整目标属性不完整，不能猜测归属。');
  target={id:k.nodeId,title:k.nodeTitle,goal:k.nodeGoal,five:k.five,version:k.nodeVersion,domain:k.nodeDomain,branch:k.nodeBranch,ownership:k.nodeOwnership,visibility:k.nodeVisibility};
 }else{
  // Old events may use the unchanged, exact current definition; never infer an old revision.
  const n=nodes?.find(n=>n.id===k.nodeId);
  if(!n||n.title!==k.nodeTitle||n.goal!==k.nodeGoal||n.five!==k.five||n.version!==k.nodeVersion)throw Error('旧独立实践没有完整目标属性，当前定义也已变化；原档案保留，请先核对。');
  target=n;
 }
 const ref=k.targetServiceReference?(resolveVisible?resolveVisible(target,k.targetServiceReference):(()=>{throw Error('公开目标快照尚未核对，不能借用目录目标。')})()):target.ownership==='personal'&&target.visibility==='private'&&resolvePrivate?resolvePrivate(target):resolveCatalogTarget(target);
 return {treeId:ref.treeId,nodeId:ref.nodeId,targetVersion:ref.targetVersion,tutorialId:null,tutorialVersion:null,practiceMode:'independent',...(ref.visibility==='private'?{targetVisibility:'private'}:{})};
}
module.exports={independentPractice};
