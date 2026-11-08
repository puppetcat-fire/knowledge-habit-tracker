// Isolated author revision and reader discussion fixtures; never uses main data.
const fs=require('node:fs'),path=require('node:path');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const base=path.join(__dirname,'../output/root-audit/native-discussion-source-proof'),origin='http://localhost:3114';
const {app}=createAuthenticatedActionApp({dataDir:path.join(base,'data'),reviewDirectory:path.join(base,'assets'),rateLimitEnabled:false});
const server=app.listen(3114,'localhost',async()=>{
 try{
  let cookie='';async function call(url,body,options={}){const r=await fetch(origin+url,{method:options.method||(body?'POST':'GET'),headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...options.headers},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const value=await r.json();if(!r.ok||!value.ok)throw Error(value.code||'Native source fixture failed');return value}
  async function account(name){try{return (await call('/api/register',{name,password:'test-only-2026'})).user}catch{return (await call('/api/login',{name,password:'test-only-2026'})).user}}
  const author=await account('讨论来源验收作者'),authorCookie=cookie,records=(await call('/api/records')).records;
  if(!records.some(r=>r.lightUp))await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'隔离验收：本人完成方程代回。',visibility:'private',lightUp:true});
  let tutorial=(await call('/api/tutorials')).tutorials.find(t=>t.authorId===author.id&&t.nodeId==='od-eq');
  if(!tutorial)tutorial=(await call('/api/tutorials',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',title:'原教程：求解后代回',method:'先求未知数，再代回原式。',startAction:'从2x+3=11开始。',resources:[],visibility:'public'})).tutorial;
  const reader=await account('讨论来源验收读者'),url='/api/review-tutorial-discussions/'+tutorial.id,old=(await call(url)).comments.find(c=>c.parentId===null),oldVersion=old?.tutorialVersion||tutorial.version;
  const question=(await call(url,{text:'原教程的代回步骤失败时，先检查什么？',tutorialVersion:oldVersion,parentId:null,requestId:'native-source-question-v1',consent:true})).comment;
  const revised=(await call('/api/tutorials/'+tutorial.id,{title:'新版教程：增加失败检查',method:'先求未知数并代回原式；若结果不同，先检查移项符号和逐项计算。'},{method:'PATCH',headers:{Cookie:authorCookie,'If-Match':tutorial.version}})).tutorial;
  await call(url,{text:'新版已经补充检查步骤，先核对移项符号，再逐项计算。',tutorialVersion:revised.version,parentId:question.id,requestId:'native-source-answer-v1',consent:true},{headers:{Cookie:authorCookie}});
  fs.writeFileSync(path.join(base,'fixture.json'),JSON.stringify({authorId:author.id,readerId:reader.id,tutorialId:tutorial.id,oldVersion,newVersion:revised.version,questionId:question.id}));
  console.log('Native discussion source QA ready: '+origin+'/review/');
 }catch(e){console.error(e.message);server.close()}
});
