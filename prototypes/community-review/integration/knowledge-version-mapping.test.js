const {loadCatalog}=require('./knowledge-catalog.cjs');
const {contentVersion}=require('../../../knowledge-service');
const {methodSource,tutorialPayload,bindReceipt,practiceBinding}=require('./knowledge-version-mapping.cjs');
function fixture(){
 const target=loadCatalog().nodes.find(n=>n.originId==='eq'),node={...target,id:'eq',version:1};
 const method={id:'own-method',title:'代回检验',author:'alice',versions:[{number:1,created:0,content:'先求解，再代回原式。',five:'从2x+3=11开始。',resource:'https://example.com/material'}]};
 const source=methodSource(node,method,1),payload=tutorialPayload(source,'public'),{treeId,nodeId,...content}=payload;
 const receipt={...payload,id:'t-source',authorId:'alice-id',authorName:'alice',version:contentVersion(content)};
 const event={id:'event',startedAt:0,endedAt:1000,segments:[{start:0,end:400},{start:700,end:1000}],knowledge:{nodeId:'eq',nodeTitle:node.title,nodeGoal:node.goal,nodeVersion:1,methodId:method.id,methodTitle:method.title,version:1,content:method.versions[0].content,five:method.versions[0].five,resource:method.versions[0].resource}};
 return {node,method,source,payload,receipt,event};
}
it('binds integer source versions to exact service hashes and keeps the entire practice snapshot unchanged',()=>{
 const {source,receipt,event}=fixture(),before=JSON.stringify(event),binding=bindReceipt(source,receipt,'alice-id'),mapped=practiceBinding(event,binding);
 expect(mapped.tutorialVersion).toBe(receipt.version);expect(mapped.sourceSnapshot).toEqual(event.knowledge);
 expect(mapped.eventId).toBe('event');expect(mapped.nodeId).toBe('od-eq');expect(mapped.targetVersion).toBe(source.ref.targetVersion);
 expect(JSON.stringify(event)).toBe(before);expect(source.source.created).toBe(0);
});
it.each(['goal','owner','content','hash'])('rejects a mismatched %s receipt rather than recording a successful mapping',kind=>{
 const {source,receipt}=fixture(),bad={...receipt};
 if(kind==='goal')bad.nodeId='od-num';if(kind==='owner')bad.authorId='bob';if(kind==='content')bad.method='不同步骤';if(kind==='hash')bad.version='fake';
 expect(()=>bindReceipt(source,bad,'alice-id')).toThrow();
});
it('continues binding an old practice from its original mapping after a newer method is created',()=>{
 const {node,method,source,receipt,event}=fixture(),old=bindReceipt(source,receipt,'alice-id');
 method.title='新标题';method.versions.push({number:2,created:2000,content:'新的步骤。',five:'新起步建议。',resource:''});
 const newer=methodSource(node,method,2);expect(newer.sourceHash).not.toBe(source.sourceHash);
 expect(practiceBinding(event,old).tutorialVersion).toBe(receipt.version);
 expect(()=>methodSource(node,method,1)).toThrow();
});
it('refuses unfinished events and mismatched historical targets or method content',()=>{
 const {source,receipt,event}=fixture(),binding=bindReceipt(source,receipt,'alice-id');
 expect(()=>practiceBinding({...event,endedAt:null},binding)).toThrow();
 for(const patch of [{nodeGoal:'不同目标'},{nodeVersion:2},{version:2},{content:'更晚的内容'}])expect(()=>practiceBinding({...event,knowledge:{...event.knowledge,...patch}},binding)).toThrow();
});
it('preserves freeform resource text in the source and requests review instead of dropping it',()=>{
 const {node,method}=fixture();method.versions[0].resource='纸和笔；先阅读自己的上一条笔记。';
 const source=methodSource(node,method,1);expect(source.source.resource).toBe(method.versions[0].resource);
 expect(()=>tutorialPayload(source,'public')).toThrow('不能丢弃原文字');
});
it('rejects source mutations and credential-bearing or executable resource links',()=>{
 const {node,method,source}=fixture();source.source.content='核对之后被修改';expect(()=>tutorialPayload(source)).toThrow();
 for(const resource of ['javascript:alert(1)','https://user:password@example.com/']){method.versions[0].resource=resource;expect(()=>tutorialPayload(methodSource(node,method,1))).toThrow();}
});
it('retains multiple structured materials and requires review of extra resource text or hidden fields',()=>{
 const {node,method}=fixture(),v=method.versions[0];v.resource='';v.resourceLinks=[{label:'必需材料',url:'https://example.com/required',affiliate:false,optional:false},{label:'补充',url:'https://example.com/extra',affiliate:true,optional:true}];
 expect(tutorialPayload(methodSource(node,method,1)).resources).toEqual(v.resourceLinks);
 v.resource='不能丢失的附加文字';expect(()=>tutorialPayload(methodSource(node,method,1))).toThrow('不能丢弃');
 v.resource='';v.resourceLinks[0].privateMemo='私密字段';expect(()=>tutorialPayload(methodSource(node,method,1))).toThrow();
});
