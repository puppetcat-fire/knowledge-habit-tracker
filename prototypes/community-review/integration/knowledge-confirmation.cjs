const fs=require('node:fs'),path=require('node:path');
const {FORMAT,validateActionState}=require('./action-state.cjs');
const {TREE,loadCatalog,resolveCatalogTarget}=require('./knowledge-catalog.cjs');
function confirmedActionLight(data,node,lightId){
 return (data.lights||[]).find(l=>{
  if(lightId!==undefined&&l.id!==lightId)return false;
  if(l.nodeId!==node.id||l.confirmed!==true||typeof l.result!=='string'||!l.result.trim()||typeof l.evidence!=='string'||!l.evidence.trim())return false;
  const e=data.events.find(e=>e.id===l.eventId),k=e?.knowledge;
  return e?.endedAt!==null&&Number.isFinite(e?.endedAt)&&k?.nodeId===node.id&&k.nodeVersion===node.version&&k.nodeTitle===node.title&&k.nodeGoal===node.goal;
 });
}
function hasStoredActionConfirmation(config,user,treeId,nodeId){
 if(treeId!==TREE)return false;
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(user.id))throw Error('Invalid owner');
 const canonical=loadCatalog().nodes.find(n=>n.id===nodeId);if(!canonical)return false;
 const file=path.join(config.dataDir,'action-states',user.id+'.json');if(!fs.existsSync(file))return false;
 const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value?.format!==FORMAT)throw Error('Invalid action source');validateActionState(value.data);
 const node=value.data.nodes?.find(n=>n.id===canonical.originId);if(!node)return false;
 try{resolveCatalogTarget(node)}catch{return false}
 return !!confirmedActionLight(value.data,node);
}
module.exports={confirmedActionLight,hasStoredActionConfirmation};
