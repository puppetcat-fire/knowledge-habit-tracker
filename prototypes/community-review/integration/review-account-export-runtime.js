let reviewArchiveBusy=false;
function reviewAccountExportTools(){return S.user?.reviewService?btn('导出本机与服务档案','review-account-export','ghost')+'<p id="review-account-export-status" class="small muted" role="status">新档案分别保留本机与服务版本；现有导入入口只接受行动备份。</p>':''}
function reviewArchiveLocal(){
 const ownerId=S.user?.id,at=Date.now(),data=reviewActionData(),drafts=[];
 for(const [storage,kind] of [[localStorage,'local'],[sessionStorage,'session']])for(let i=0;i<storage.length;i++){
  const key=storage.key(i),prefixes=[KEY+':visible-tutorial-draft:',KEY+':method-draft:',KEY+':discussion-draft:'];const prefix=prefixes.find(p=>key?.startsWith(p));if(!prefix)continue;
  let ids;try{ids=JSON.parse(key.slice(prefix.length))}catch{continue}if(!Array.isArray(ids)||ids[0]!==ownerId)continue;const raw=storage.getItem(key);let value;try{value=JSON.parse(raw)}catch{value=null}
  if(value&&(value.ownerId||value.owner)&&(value.ownerId||value.owner)!==ownerId)throw Error('本机草稿归属无法核对，未混入其他账号内容。');drafts.push({storage:kind,key,raw,readable:value!==null});
 }
 for(const [key,raw] of reviewDiscussionMemoryDrafts){let ids;try{ids=JSON.parse(key.slice((KEY+':discussion-draft:').length))}catch{continue}if(ids[0]===ownerId)drafts.push({storage:'memory',key,raw,readable:true})}const versionReview=reviewArchives(),profileInput=document.querySelector('#profile-form [name="bio"]');
 // Keep the explicitly unsaved form separate from the saved account profile.
 const formDrafts=profileInput&&profileInput.value!==S.bio?[{form:'profile',ownerId,fields:{bio:profileInput.value}}]:[];
 return {fingerprint:JSON.stringify({data,drafts,formDrafts,versionReview}),archive:{capturedAt:at,ownerId,action:actionBackup(data,at),drafts,formDrafts,versionReview}};
}
async function reviewVerifyServiceArchive(service){
 const integrity=service.integrity;
 if(integrity?.algorithm!=='sha256-json-stringify'||typeof integrity.value!=='string'||!/^[a-f0-9]{64}$/.test(integrity.value))throw Error('服务档案完整性标记无效，未下载不完整文件。');
 if(!crypto.subtle?.digest||typeof TextEncoder==='undefined')throw Error('当前浏览器无法核对档案完整性，内容保留，请使用支持安全校验的浏览器重试。');
 const core=clone(service);delete core.ok;delete core.integrity;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(core)));
 const actual=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==integrity.value)throw Error('服务档案内容与完整性标记不符，未下载；原始资料保留。');
}
async function reviewExportAccountBundle(button){
 if(reviewArchiveBusy||!S.user?.reviewService)return;const context=reviewContext();reviewArchiveBusy=true;if(button)button.disabled=true;const status=document.getElementById('review-account-export-status');
 try{const local=reviewArchiveLocal();if(status)status.textContent='正在读取本人服务档案，计时继续…';const service=await reviewKnowledgeRequest('/api/review-account-export',{context});if(!reviewContextCurrent(context)||button&&!button.isConnected)return;if(service.ownerId!==context.ownerId||service.format!=='dianliang-service-archive/v1'||!service.service?.tutorials||!service.integrity)throw Error('服务档案回执无法核对，未下载不完整文件。');
  await reviewVerifyServiceArchive(service);
  if(!reviewContextCurrent(context)||button&&!button.isConnected)return;
  if(reviewArchiveLocal().fingerprint!==local.fingerprint)throw Error('读取期间本机又有编辑，内容保留，请重新导出当前版本。');
  const copy=clone(service);delete copy.ok;const bundle={format:'dianliang-review-bundle/v1',exportedAt:Date.now(),ownerId:context.ownerId,local:local.archive,service:copy};download('点亮-本机与服务档案.json',bundle);if(status)status.textContent=`已导出本机行动、${local.archive.drafts.length} 份草稿，以及服务行动、${copy.service.tutorials.length} 份教程、目标关联和实践回执。两个版本分别保留。`;
 }catch(e){if(reviewContextCurrent(context)&&(!button||button.isConnected)){if(status)status.textContent=reviewIsNetworkError(e)?'服务读取未完成，本机内容保留。可重试，或先导出本机行动备份。':e.message}}
 finally{reviewArchiveBusy=false;if(button)button.disabled=false}
}
