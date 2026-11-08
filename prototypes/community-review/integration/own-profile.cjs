const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicJson,recoverTransactions}=require('../../../storage-transaction');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fields(p){if(!p||!['private','public'].includes(p.visibility))throw Error('Invalid profile');const v={};for(const [k,max] of [['tagline',120],['about',1600],['focus',120]]){if(typeof p[k]!=='string'||p[k].length>max)throw Error('Invalid profile field');v[k]=p[k]}return {...v,visibility:p.visibility}}
function installOwnProfile(app,{config,authenticate}){
 const file=path.join(config.dataDir,'profiles.json');
 function owner(req,res){const u=authenticate(req);if(!u){res.status(401).json({ok:false,code:'UNAUTHENTICATED'});return null}if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==u.id){res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});return null}return u}
 function read(id){recoverTransactions(config.dataDir);const all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];if(!Array.isArray(all))throw Error('Invalid store');const matches=all.filter(p=>p?.id===id);if(matches.length>1)throw Error('Duplicate profile');const old=matches[0]||null;if(old)fields(old);return {all,old}}
 app.get('/api/review-own-profile',(req,res)=>{const u=owner(req,res);if(!u)return;try{const {old}=read(u.id);return res.set('Cache-Control','no-store').json({ok:true,ownerId:u.id,profile:old?fields(old):null,revision:hash(old)})}catch{return res.status(503).json({ok:false,code:'PROFILE_STORE_UNREADABLE',message:'个人资料无法核对，原文件保留。'})}});
 app.post('/api/review-own-profile',(req,res)=>{
  const u=owner(req,res);if(!u)return;if(!req.get('If-Match'))return res.status(428).json({ok:false,code:'PROFILE_REVISION_REQUIRED'});let input;try{if(!req.body||Object.keys(req.body).some(k=>!['tagline','about','focus','visibility','consent','withdrawConsent'].includes(k)))throw Error('Invalid input');input=fields(req.body)}catch{return res.status(400).json({ok:false,code:'PROFILE_INPUT',message:'请检查介绍长度和保存范围。'})}
  try{const {all,old}=read(u.id);if(input.visibility==='public'&&req.body.consent!==true)return res.status(403).json({ok:false,code:'PROFILE_PUBLIC_CONSENT_REQUIRED',message:'请主动确认公开这份个人介绍。'});if(old?.visibility==='public'&&input.visibility==='private'&&req.body.withdrawConsent!==true)return res.status(403).json({ok:false,code:'PROFILE_WITHDRAW_CONSENT_REQUIRED',message:'请确认将已公开的个人介绍改为私人。'});
   if(old&&JSON.stringify(fields(old))===JSON.stringify(input))return res.json({ok:true,ownerId:u.id,profile:input,revision:hash(old),repeated:true});if(req.get('If-Match')!==hash(old))return res.status(409).json({ok:false,code:'PROFILE_CONFLICT',message:'另一窗口已更新个人资料。当前输入保留，请核对服务版本后再保存。'});
   const next={...old,id:u.id,...input,updatedAt:new Date().toISOString()};atomicJson(file,all.filter(p=>p?.id!==u.id).concat(next));return res.json({ok:true,ownerId:u.id,profile:input,revision:hash(next),repeated:false});
  }catch{return res.status(503).json({ok:false,code:'PROFILE_STORE_UNREADABLE',message:'个人资料保存未确认，当前输入保留，可重试。'})}
 });
}
module.exports={installOwnProfile};
