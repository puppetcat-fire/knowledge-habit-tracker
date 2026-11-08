const {resolveCatalogTarget}=require('./knowledge-catalog.cjs');
const {privateReference}=require('./knowledge-private-targets.cjs');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const clone=v=>JSON.parse(JSON.stringify(v));
function requireValue(ok,message){if(!ok)throw Error(message)}
function methodSource(node,method,number,resolveTarget=resolveCatalogTarget){
 const target=Object.fromEntries(['id','title','goal','five','domain','branch','ownership','visibility','version'].map(k=>[k,node[k]]));
 const ref=resolveTarget(target),v=method?.versions?.at(-1);
 requireValue(typeof method?.id==='string'&&method.id&&typeof method.title==='string'&&typeof method.author==='string'&&Number.isInteger(number)&&number>0&&v?.number===number,'需要完整的当前方法版本，不能猜测旧标题。');
 requireValue(['content','five','resource'].every(k=>typeof v[k]==='string')&&Number.isFinite(v.created),'方法版本快照不完整。');
 const source={id:method.id,title:method.title,author:method.author,number,created:v.created,content:v.content,five:v.five,resource:v.resource};
 if(v.resourceLinks!==undefined){requireValue(Array.isArray(v.resourceLinks),'资料列表无效。');source.resourceLinks=clone(v.resourceLinks)}
 return {format:'dianliang-method-source/v1',target,ref,source,sourceHash:contentVersion({target,source})};
}
function verifySource(mapping){
 requireValue(mapping?.format==='dianliang-method-source/v1','方法映射格式无效。');
 const ref=mapping.target?.ownership==='personal'&&mapping.target?.visibility==='private'?privateReference(mapping.target,mapping.ref?.ownerId):resolveCatalogTarget(mapping.target);
 requireValue(JSON.stringify(ref)===JSON.stringify(mapping.ref),'目标标识与完整目标不一致。');
 requireValue(contentVersion({target:mapping.target,source:mapping.source})===mapping.sourceHash,'来源快照已变化，需要重新核对。');
}
function tutorialPayload(mapping,visibility='private'){
 verifySource(mapping);requireValue(['private','public'].includes(visibility),'需要明确的私人或公开选择。');
 requireValue(mapping.ref.visibility!=='private'||visibility==='private','目标在服务中仍为私人，教程只对本人保存；目标分享需另行核对。');
 const s=mapping.source,resources=s.resourceLinks===undefined?[]:clone(s.resourceLinks);
 if(s.resourceLinks===undefined&&s.resource.trim()){
  let url;try{url=new URL(s.resource.trim())}catch{throw Error('资料文字不是单个链接，需先核对，不能丢弃原文字。')}
  requireValue(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'资料链接不能执行脚本或包含登录凭据。');
  resources.push({label:'方法资料',url:url.href,affiliate:false,optional:true});
 }
 if(s.resourceLinks!==undefined){
  requireValue(!s.resource.trim(),'同时存在资料文字与结构化链接，需要核对，不能丢弃原文字。');
  requireValue(resources.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>['label','url','affiliate','optional'].includes(k))&&typeof r.label==='string'&&typeof r.url==='string'&&typeof r.affiliate==='boolean'&&typeof r.optional==='boolean'),'资料列表必须保留明确的名称、链接、抽成标记与可选标记。');
 }
 const content=tutorialInput({title:s.title,method:s.content,startAction:s.five,resources,visibility});
 return {treeId:mapping.ref.treeId,nodeId:mapping.ref.nodeId,...content};
}
function bindReceipt(mapping,receipt,ownerId){
 verifySource(mapping);requireValue(typeof ownerId==='string'&&ownerId&&receipt?.authorId===ownerId&&receipt.authorName===mapping.source.author,'作者回执与原方法不一致。');
 const payload=tutorialPayload(mapping,receipt.visibility),{treeId,nodeId,...expected}=payload;
 requireValue(receipt.treeId===treeId&&receipt.nodeId===nodeId&&typeof receipt.id==='string'&&receipt.id,'回执目标或方法标识不一致。');
 const actual=Object.fromEntries(['title','method','startAction','resources','visibility'].map(k=>[k,receipt[k]]));
 requireValue(JSON.stringify(actual)===JSON.stringify(expected)&&receipt.version===contentVersion(expected),'回执内容或内容哈希与来源方法不一致。');
 return {format:'dianliang-method-binding/v1',source:clone(mapping),service:{id:receipt.id,version:receipt.version,authorId:ownerId,authorName:receipt.authorName,...payload}};
}
function practiceBinding(event,binding){
 requireValue(binding?.format==='dianliang-method-binding/v1','缺少已核对的方法回执。');
 const m=binding.source,s=m.source;verifySource(m);
 bindReceipt(m,binding.service,binding.service.authorId);
 const k=event?.knowledge;
 requireValue(typeof event?.id==='string'&&event.id&&Number.isFinite(event.startedAt)&&event.endedAt!==null&&Number.isFinite(event.endedAt)&&event.endedAt>=event.startedAt,'只能绑定已结束的实际事件。');
 requireValue(Array.isArray(event.segments)&&event.segments.every(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.start>=event.startedAt&&p.end>=p.start&&p.end<=event.endedAt),'实际活动段尚未结束或不完整。');
 requireValue(k&&k.nodeId===m.ref.originId&&k.nodeVersion===m.ref.sourceVersion&&k.nodeTitle===m.target.title&&k.nodeGoal===m.target.goal,'事件的当时完整目标与目录版本不一致。');
 requireValue(k.methodId===s.id&&k.version===s.number&&k.methodTitle===s.title&&k.content===s.content&&k.five===s.five&&k.resource===s.resource,'事件的当时方法与回执来源版本不一致。');
 if(s.resourceLinks!==undefined)requireValue(JSON.stringify(k.resourceLinks)===JSON.stringify(s.resourceLinks),'事件的当时资料列表与原版本不一致。');
 return {treeId:m.ref.treeId,nodeId:m.ref.nodeId,eventId:event.id,tutorialId:binding.service.id,tutorialVersion:binding.service.version,targetVersion:m.ref.targetVersion,sourceSnapshot:clone(k),...(m.ref.visibility==='private'?{targetVisibility:'private'}:{})};
}
function sharedMethod(target,receipt){
 const ref=resolveCatalogTarget(target);
 requireValue(receipt&&receipt.visibility==='public'&&receipt.treeId===ref.treeId&&receipt.nodeId===ref.nodeId,'公开方法与当前完整目标不一致。');
 requireValue(typeof receipt.id==='string'&&/^[A-Za-z0-9_-]+$/.test(receipt.id)&&typeof receipt.authorId==='string'&&receipt.authorId&&typeof receipt.authorName==='string'&&receipt.authorName.trim(),'公开方法缺少确切身份。');
 const content=tutorialInput(receipt),created=Date.parse(receipt.createdAt);
 requireValue(contentVersion(content)===receipt.version&&Number.isFinite(created),'公开方法版本内容或创建时间无效。');
 // The local integer is a reference version, never an inferred author revision.
 const method={id:'service-'+receipt.id+'-'+receipt.version,title:content.title,author:receipt.authorName,visibility:'public',serviceReference:{id:receipt.id,version:receipt.version,authorId:receipt.authorId,authorName:receipt.authorName},versions:[{number:1,created,content:content.method,five:content.startAction,resource:'',resourceLinks:clone(content.resources)}]};
 bindReceipt(methodSource(target,method,1),receipt,receipt.authorId);
 return method;
}
module.exports={methodSource,tutorialPayload,bindReceipt,practiceBinding,sharedMethod};
