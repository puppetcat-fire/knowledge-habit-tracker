const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Script}=require('node:vm');
const {atomicJson}=require('../../../storage-transaction');
const TREE='dianliang-review-catalog-v1';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonicalContent(n){return {title:n.title,goal:n.goal,five:n.five,domain:n.domain,branch:n.branch,ownership:n.ownership}}
function loadCatalog(){
 const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const rows=source.match(/const nodeSeed=([\s\S]*?);\s*const seedEdges=/),links=source.match(/const seedEdges=([\s\S]*?);\s*function seed\(/);
 if(!rows||!links)throw Error('Knowledge catalog source changed; review extraction');
 // Evaluate only checked-in literal seed arrays, never request or stored input.
 const values=new Script('({rows:'+rows[1]+',links:'+links[1]+'})').runInNewContext(Object.create(null),{timeout:1000});
 if(!Array.isArray(values.rows)||!values.rows.length||values.rows.some(r=>!Array.isArray(r)||r.length!==6||r.some(v=>typeof v!=='string'))||!Array.isArray(values.links))throw Error('Invalid catalog arrays');
 const ids=new Set(values.rows.map(r=>r[0]));if(ids.size!==values.rows.length||[...ids].some(id=>!/^[A-Za-z0-9_-]{1,48}$/.test(id)))throw Error('Invalid catalog identifiers');
 const nodes=values.rows.map(r=>{const n={id:'od-'+r[0],treeId:TREE,originId:r[0],sourceVersion:1,title:r[3],goal:r[4],five:r[5],domain:r[1],branch:r[2],ownership:'group',ownerId:null,visibility:'public',source:'独立原型示例目录 · 非完整课程'};return {...n,version:hash(canonicalContent(n))}});
 const edges=values.links.map(e=>{if(!Array.isArray(e)||!ids.has(e[0])||!ids.has(e[1])||(e[2]!==undefined&&e[2]!=='instance'))throw Error('Invalid catalog edge');return {from:'od-'+e[0],to:'od-'+e[1],type:e[2]==='instance'?'instance-of':'prereq',treeId:TREE}});
 return {tree:{id:TREE,name:'点亮独立原型示例目录',domain:'多领域',ownership:'group',ownerId:null,visibility:'public'},nodes,edges};
}
function installCatalog(file){
 const catalog=loadCatalog();
 const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{nodes:[],edges:[],trees:[]};
 if(!data||!Array.isArray(data.nodes)||!Array.isArray(data.edges)||(data.trees!==undefined&&!Array.isArray(data.trees)))throw Error('Unreadable node store; preserved');
 data.trees=data.trees||[];
 if(data.trees.some(t=>t.id===TREE)){
  const tree=data.trees.find(t=>t.id===TREE);if(tree.ownership!=='group'||tree.ownerId!==null||tree.visibility!=='public')throw Error('Catalog ownership drift; explicit migration required');
  for(const expected of catalog.nodes){const old=data.nodes.find(n=>n.id===expected.id&&n.treeId===TREE);if(!old||old.ownership!=='group'||old.ownerId!==null||old.visibility!=='public'||old.sourceVersion!==1||old.version!==expected.version||hash(canonicalContent(old))!==expected.version)throw Error('Catalog drift; explicit migration required')}
  for(const e of catalog.edges)if(!data.edges.some(old=>old.from===e.from&&old.to===e.to&&old.type===e.type))throw Error('Catalog relations changed; explicit migration required');
  return catalog;
 }
 if(data.nodes.some(n=>catalog.nodes.some(c=>c.id===n.id)))throw Error('Catalog ID collision; preserved');
 data.trees.push(catalog.tree);data.nodes.push(...catalog.nodes);data.edges.push(...catalog.edges);atomicJson(file,data);
 return catalog;
}
function resolveCatalogTarget(node){
 const expected=loadCatalog().nodes.find(n=>n.originId===node?.id);
 if(!expected||node.ownership!=='group'||node.visibility!=='public'||node.version!==1||hash(canonicalContent(node))!==expected.version)
  throw Error('目标没有精确的目录映射，不能用相近名称代替。');
 return {treeId:TREE,nodeId:expected.id,targetVersion:expected.version,originId:node.id,sourceVersion:node.version};
}
module.exports={TREE,loadCatalog,installCatalog,resolveCatalogTarget};
