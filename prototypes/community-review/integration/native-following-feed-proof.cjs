// Separate localhost cookie host and owned fixtures; never uses main preview data.
const fs=require('node:fs'),path=require('node:path');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {loadCatalog}=require('./knowledge-catalog.cjs');
const {FORMAT}=require('./action-state.cjs');
const base=path.join(__dirname,'../output/root-audit/native-following-feed-proof');
const {app}=createAuthenticatedActionApp({dataDir:path.join(base,'data'),reviewDirectory:path.join(base,'assets'),rateLimitEnabled:false});
const origin='http://localhost:3112';
const server=app.listen(3112,'localhost',async()=>{
 try{
  let cookie='';async function call(url,body,options={}){const r=await fetch(origin+url,{method:options.method||(body?'POST':'GET'),headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...options.headers},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const v=await r.json();if(!r.ok||!v.ok)throw Error(v.code||v.message||'Native fixture request failed');return v}
  async function account(name){try{return (await call('/api/register',{name,password:'test-only-2026'})).user}catch{return (await call('/api/login',{name,password:'test-only-2026'})).user}}
  const author=await account('关注内容验收作者'),records=(await call('/api/records')).records;
  if(!records.some(r=>r.lightUp))await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'独立验收：代回验证，私人自证。',visibility:'private',lightUp:true});
  for(let i=1;i<=21;i++){const text='关注内容验收 · 第 '+i+' 次公开实践';if(!records.some(r=>r.text===text))await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text,visibility:'public',lightUp:false})}
  const tutorials=(await call('/api/tutorials')).tutorials;if(!tutorials.some(t=>t.title==='关注内容验收：代回检验'))await call('/api/tutorials',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',title:'关注内容验收：代回检验',method:'先解方程，再把结果代回原式检验。',startAction:'在五分钟内代回x=4核对2x+3=11。',resources:[{label:'验收练习材料',url:'https://example.com/practice',optional:true,affiliate:false}],visibility:'public'});
  let source=await call('/api/action-state');if(!source.state){const n=loadCatalog().nodes.find(n=>n.originId==='eq');const state={format:FORMAT,data:{schema:1,mode:'local-simulation',events:[],activeId:null,habits:[{id:'h',name:'阅读',formedAt:null}],habitId:'h',templates:{},nodes:[{...n,id:n.originId,version:n.sourceVersion,methods:[]}],paths:[{id:'native-follow-path',title:'关注内容验收：从方程到检验',nodes:['eq'],visibility:'private'}],settings:{}}};await call('/api/action-state',state,{method:'PUT',headers:{'If-Match':source.revision}});source=await call('/api/action-state')}
  const plan=await call('/api/review-path-publications');if(!plan.store.entries.some(e=>e.sourceId==='native-follow-path'&&e.visibility==='public'))await call('/api/review-path-publications',{pathId:'native-follow-path',action:'publish',consent:true},{headers:{'If-Match':source.revision,'If-Path-Match':plan.revision}});
  const reader=await account('关注内容验收读者');fs.writeFileSync(path.join(base,'fixture.json'),JSON.stringify({authorId:author.id,readerId:reader.id}));console.log('Native followed feed QA ready: '+origin+'/review/');
 }catch(error){console.error(error.message);server.close()}
});
