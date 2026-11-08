// Owned localhost fixtures for browser QA. Main preview data is never used.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const base=path.join(__dirname,'../output/root-audit/native-discussion-proof'),origin='http://localhost:3113';
const {app}=createAuthenticatedActionApp({dataDir:path.join(base,'data'),reviewDirectory:path.join(base,'assets'),rateLimitEnabled:false});
const server=http.createServer((req,res)=>{
 const flag=path.join(base,'delay-next-page.json'),evidenceFile=path.join(base,'delayed-page.json'),url=new URL(req.url,origin);
 if(req.method==='GET'&&url.pathname.startsWith('/api/review-tutorial-discussions/')&&url.searchParams.get('cursor')&&fs.existsSync(flag)){
  const setting=JSON.parse(fs.readFileSync(flag,'utf8'));
  if(Number.isInteger(setting.delayMs)&&setting.delayMs>0&&setting.delayMs<=30000){
   fs.unlinkSync(flag);const end=res.end.bind(res),evidence={url:req.url,delayMs:setting.delayMs,startedAt:null,completedAt:null};let held=false;
   res.end=(...args)=>{if(held)return res;held=true;evidence.startedAt=Date.now();fs.writeFileSync(evidenceFile,JSON.stringify(evidence));setTimeout(()=>{evidence.completedAt=Date.now();fs.writeFileSync(evidenceFile,JSON.stringify(evidence));end(...args)},setting.delayMs);return res};
  }
 }
 app(req,res);
}).listen(3113,'localhost',async()=>{
 try{
  let cookie='';async function call(url,body,options={}){const r=await fetch(origin+url,{method:options.method||(body?'POST':'GET'),headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...options.headers},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const v=await r.json();if(!r.ok||!v.ok)throw Error(v.code||v.message||'Native discussion fixture failed');return v}
  async function account(name){try{return (await call('/api/register',{name,password:'test-only-2026'})).user}catch{return (await call('/api/login',{name,password:'test-only-2026'})).user}}
  const author=await account('讨论浏览器验收作者'),authorCookie=cookie,records=(await call('/api/records')).records;
  if(!records.some(r=>r.lightUp&&r.nodeId==='od-eq'))await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'独立讨论验收：完成方程代回检验。',visibility:'private',lightUp:true});
  let tutorial=(await call('/api/tutorials')).tutorials.find(t=>t.title==='讨论验收：方程代回检验');
  if(!tutorial)tutorial=(await call('/api/tutorials',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',title:'讨论验收：方程代回检验',method:'先求未知数，再把结果代回原式；不一致时检查计算步骤。',startAction:'从2x+3=11开始，代回x=4检查两边相等。',resources:[],visibility:'public'})).tutorial;
  const reader=await account('讨论浏览器验收读者'),url='/api/review-tutorial-discussions/'+tutorial.id;
  const question=(await call(url,{text:'浏览器验收问题：代回以后两边不相等，应先检查哪一步？',tutorialVersion:tutorial.version,parentId:null,requestId:'native-discussion-question-v1',consent:true})).comment;
  for(let i=1;i<=63;i++)await call(url,{text:'浏览器验收回答 '+i+'：检查移项符号，再核对代回原等式的计算。',tutorialVersion:tutorial.version,parentId:question.id,requestId:'native-discussion-answer-'+i,consent:true},{headers:{Cookie:authorCookie}});
  const longText='浏览器长内容验收：\nhttps://example.invalid/'+ 'segment'.repeat(160)+'\nCODE_'+ 'Identifier'.repeat(60);
  const longComment=(await call(url,{text:longText,tutorialVersion:tutorial.version,parentId:null,requestId:'native-discussion-long-content-v1',consent:true})).comment;
  const thread=await call(url);fs.writeFileSync(path.join(base,'fixture.json'),JSON.stringify({authorId:author.id,readerId:reader.id,tutorialId:tutorial.id,tutorialVersion:tutorial.version,questionId:question.id,longCommentId:longComment.id,discussionCount:thread.total,pageCount:thread.pageCount}));
  console.log('Native discussion QA ready: '+origin+'/review/');
 }catch(e){console.error(e.message);server.close()}
});
