// Isolated native pagination QA. Main preview accounts and data are untouched.
const path=require('node:path');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const {buildReviewAssets}=require('./build-ui.cjs');
const base=path.join(__dirname,'../output/root-audit/native-author-pagination-proof');
buildReviewAssets(path.join(base,'assets'));
const {app}=createAuthenticatedActionApp({dataDir:path.join(base,'data'),reviewDirectory:path.join(base,'assets'),rateLimitEnabled:false});
const server=app.listen(3111,'127.0.0.2',async()=>{
 try{
  let cookie='';
  async function call(url,body){const r=await fetch('http://127.0.0.2:3111'+url,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const value=await r.json();if(!r.ok||!value.ok)throw Error(value.code||'Fixture request failed');return value}
  async function account(name){try{await call('/api/register',{name,password:'test-only-2026'})}catch{await call('/api/login',{name,password:'test-only-2026'})}}
  await account('作者分页验收作者');const records=(await call('/api/records')).records;
  for(let i=1;i<=21;i++){const text='作者分页验收 · 第 '+i+' 次实践';if(!records.some(r=>r.text===text))await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text,visibility:'public',lightUp:false})}
  await account('作者分页验收读者');console.log('Native author pagination QA ready: http://127.0.0.2:3111/review/');
 }catch(error){console.error(error.message);server.close()}
});
