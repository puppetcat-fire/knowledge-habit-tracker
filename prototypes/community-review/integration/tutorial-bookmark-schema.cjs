const crypto=require('node:crypto');
const {tutorialInput,contentVersion}=require('../../../knowledge-service');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function validateTutorialBookmarks(list){
 if(!Array.isArray(list))throw Error('Invalid tutorial bookmarks');const seen=new Set();
 for(const b of list){const t=b?.tutorial;if(!b||Object.keys(b).some(k=>!['tutorial','snapshotHash'].includes(k))||!t||Object.keys(t).some(k=>!['id','treeId','nodeId','authorId','authorName','version','createdAt','kind','target','title','method','startAction','resources','visibility'].includes(k))||['id','treeId','nodeId','authorId','authorName','version','createdAt'].some(k=>typeof t[k]!=='string'||!t[k])||!/^[A-Za-z0-9_-]{1,64}$/.test(t.authorId)||!Number.isFinite(Date.parse(t.createdAt))||t.visibility!=='public'||!['catalog','personal-public'].includes(t.kind)||b.snapshotHash!==hash(t)||contentVersion(tutorialInput(t))!==t.version)throw Error('Invalid tutorial bookmark snapshot');
  const key=JSON.stringify([t.id,t.version]);if(seen.has(key))throw Error('Duplicate tutorial bookmark');seen.add(key);
  if(!Array.isArray(t.resources)||t.resources.some(r=>!r||Object.keys(r).some(k=>!['label','url','optional','affiliate'].includes(k))||typeof r.optional!=='boolean'||typeof r.affiliate!=='boolean'))throw Error('Invalid bookmarked materials');
  const n=t.target,keys=t.kind==='catalog'?['id','treeId','originId','sourceVersion','title','goal','five','domain','branch','ownership','ownerId','visibility','source','version']:['nodeId','treeId','title','goal','five','domain','branch','version','sourceVersion','ownership','visibility','ownerId','ownerName'];if(!n||Object.keys(n).some(k=>!keys.includes(k))||['treeId','title','goal','five','domain','branch','version'].some(k=>typeof n[k]!=='string')||n.treeId!==t.treeId||!Number.isInteger(n.sourceVersion)||n.sourceVersion<1||n.visibility!=='public')throw Error('Invalid bookmarked goal');
  if(t.kind==='catalog'){if(n.id!==t.nodeId||typeof n.originId!=='string'||n.ownership!=='group'||n.ownerId!==null||n.version!==hash({title:n.title,goal:n.goal,five:n.five,domain:n.domain,branch:n.branch,ownership:n.ownership}))throw Error('Changed bookmarked public goal')}
  else if(n.nodeId!==t.nodeId||n.ownership!=='personal'||typeof n.ownerId!=='string'||typeof n.ownerName!=='string')throw Error('Changed bookmarked personal ownership');
 }
 return list;
}
module.exports={validateTutorialBookmarks};
