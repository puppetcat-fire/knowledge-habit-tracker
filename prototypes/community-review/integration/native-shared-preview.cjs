const path=require('node:path');
const fs=require('node:fs'),http=require('node:http');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const base=path.join(__dirname,'../output/root-audit/native-shared-proof');
const discussionModeratorIds=(process.env.DIANLIANG_DISCUSSION_MODERATOR_IDS||'').split(',').map(id=>id.trim()).filter(Boolean);
const {app}=createAuthenticatedActionApp({dataDir:path.join(base,'data'),reviewDirectory:path.join(base,'assets'),rateLimitEnabled:false,discussionModeratorIds});
// Test fixture only: one controlled delayed read for native account-switch QA.
const server=http.createServer((req,res)=>{
 const flag=path.join(base,'delay-next-method-read.json'),proof=path.join(base,'delayed-method-read.json');
 if(req.method==='GET'&&req.url==='/api/review-method-publications'&&fs.existsSync(flag)){
  const setting=JSON.parse(fs.readFileSync(flag,'utf8'));if(Number.isInteger(setting.delayMs)&&setting.delayMs>0&&setting.delayMs<=30000){
   fs.renameSync(flag,proof);const end=res.end.bind(res),evidence={delayMs:setting.delayMs,expectedActor:req.headers['x-action-account'],startedAt:null,completedAt:null};let held=false;
   res.end=(...args)=>{if(held)return res;held=true;evidence.startedAt=Date.now();fs.writeFileSync(proof,JSON.stringify(evidence));setTimeout(()=>{evidence.completedAt=Date.now();fs.writeFileSync(proof,JSON.stringify(evidence));end(...args)},setting.delayMs);return res};
  }
 }
 app(req,res);
}).listen(3107,'127.0.0.1',async()=>{
 try{
  let cookie='';
  async function call(url,body){const r=await fetch('http://127.0.0.1:3107'+url,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const v=await r.json();if(!r.ok||!v.ok)throw Error(v.code||v.error||'Fixture request failed');return v}
  async function account(name){try{await call('/api/register',{name,password:'test-only-2026'})}catch{await call('/api/login',{name,password:'test-only-2026'})}}
  await account('原生共创验收作者');
  const records=(await call('/api/records')).records;
  if(!records.some(r=>r.nodeId==='od-eq'&&r.lightUp))await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'测试账号确认求解并代回检验。',lightUp:true,visibility:'private'});
  const methods=(await call('/api/tutorials')).tutorials;
  if(!methods.some(t=>t.title==='代回原式检验'&&t.authorName==='原生共创验收作者'))await call('/api/tutorials',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',title:'代回原式检验',method:'先求出未知数，再把结果代回原等式，核对两侧是否相等。',startAction:'从2x+3=11开始，先写出x=4。',resources:[{label:'练习材料',url:'https://example.com/practice',affiliate:false,optional:false},{label:'补充阅读',url:'https://example.com/extra',affiliate:true,optional:true}],visibility:'public'});
  await account('原生共创验收读者');
  console.log('Isolated native proof ready: http://127.0.0.1:3107/review/');
 }catch(error){console.error(error.message);server.close()}
});
