const fs=require('node:fs'),crypto=require('node:crypto');
function installPasswordCheck(app,{config,authenticate,sessionAccount}){
 const attempts=new Map(),windowMs=15*60*1000;
 app.post('/api/review-password-check',async(req,res)=>{
  const user=authenticate(req);if(!user)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});
  if(req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
  const now=Date.now();for(const [id,bucket] of attempts)if(now-bucket.start>=windowMs)attempts.delete(id);
  const bucket=attempts.get(user.id)||{start:now,count:0};attempts.set(user.id,bucket);if(++bucket.count>30)return res.status(429).json({ok:false,code:'PASSWORD_CHECK_LIMIT'});
  const body=req.body,password=body?.password;
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='password')||typeof password!=='string'||password.length<8||password.length>72)return res.status(401).json({ok:false,code:'INVALID_PASSWORD'});
  try{
   const users=JSON.parse(fs.readFileSync(config.usersPath,'utf8'));if(!Array.isArray(users))throw Error('Invalid account store');const record=users.find(u=>u.id===user.id);
   if(!record||typeof record.salt!=='string'||typeof record.hash!=='string'||!/^[0-9a-f]{128}$/i.test(record.hash))throw Error('Invalid account credential');
   const actual=await new Promise((resolve,reject)=>crypto.scrypt(password,record.salt,64,(error,key)=>error?reject(error):resolve(key)));
   const current=await sessionAccount(req);if(current?.id!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
   if(!crypto.timingSafeEqual(Buffer.from(record.hash,'hex'),actual))return res.status(401).json({ok:false,code:'INVALID_PASSWORD'});
   return res.set('Cache-Control','no-store').json({ok:true,verified:true,userId:user.id});
  }catch{return res.status(503).json({ok:false,code:'ACCOUNT_SERVICE_UNAVAILABLE'})}
 });
}
module.exports={installPasswordCheck};
