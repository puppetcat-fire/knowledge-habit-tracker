// Disposable, isolated native image QA; never uses the 3107 data or cookie host.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {createAuthenticatedActionApp}=require('./authenticated-app.cjs');
const base=path.join(__dirname,'../output/root-audit/native-image-proof');
const {app,config}=createAuthenticatedActionApp({dataDir:path.join(base,'data'),reviewDirectory:path.join(base,'assets'),rateLimitEnabled:false});
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
function testPNG(){const width=600,height=400,header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const edge=x<18||x>581||y<18||y>381,grid=x%100<3||y%100<3,color=edge?[43,79,180]:grid?[195,207,225]:[238,244,251],at=y*(width*3+1)+1+x*3;raw.set(color,at)}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
const server=app.listen(3110,'127.0.0.2',async()=>{
 try{let cookie='';async function call(url,body){const r=await fetch('http://127.0.0.2:3110'+url,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const v=await r.json();if(!r.ok||!v.ok)throw Error(v.code||'Image fixture request failed');return v}
 async function account(name){try{await call('/api/register',{name,password:'test-only-2026'})}catch{await call('/api/login',{name,password:'test-only-2026'})}}
 await account('图片验收作者');const records=(await call('/api/records')).records;const ids={};
 for(const kind of ['normal','unavailable']){let record=records.find(r=>r.text==='图片布局验收 · '+kind);if(!record)record=(await call('/api/records',{treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'图片布局验收 · '+kind,visibility:'public',lightUp:false,images:[{mediaType:'image/png',dataUrl:'data:image/png;base64,'+testPNG().toString('base64')}]})).record;ids[kind]=record.id;
  if(kind==='unavailable'){const file=path.join(config.mediaDir,record.images[0].id);if(fs.existsSync(file))fs.renameSync(file,file+'.fixture-unavailable')}
 }
 await account('图片验收读者');fs.writeFileSync(path.join(base,'fixture.json'),JSON.stringify(ids));console.log('Native image QA ready: http://127.0.0.2:3110/review/');
 }catch(e){console.error(e.message);server.close()}
});
