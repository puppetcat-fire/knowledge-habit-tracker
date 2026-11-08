const reviewSharedCache=new Map(),reviewSharedJobs=new Set();
function reviewSharedTarget(n){return JSON.stringify({id:n.id,title:n.title,goal:n.goal,five:n.five,domain:n.domain,branch:n.branch,ownership:n.ownership,visibility:n.visibility,version:n.version})}
function reviewSharedKey(n){return JSON.stringify([S.user.id,n.id])}
function reviewAvailableMethods(n){const cache=reviewSharedCache.get(reviewSharedKey(n));return [...n.methods,...(cache?.target===reviewSharedTarget(n)?cache.methods.filter(m=>!n.methods.some(own=>own.id===m.id)):[])]}
function reviewSharedTools(n){if(!S.user?.reviewService||n.ownership!=='group'||n.visibility!=='public')return '';const cache=reviewSharedCache.get(reviewSharedKey(n)),valid=cache?.target===reviewSharedTarget(n);return `<div class="row" style="margin:12px 0">${btn(reviewSharedJobs.has(JSON.stringify([reviewSharedKey(n),reviewAccountGeneration]))?'正在加载…':'加载服务公开方法','review-shared-load:'+n.id,'ghost',reviewSharedJobs.has(JSON.stringify([reviewSharedKey(n),reviewAccountGeneration]))?'disabled':'')}</div>${valid?`<p class="small muted" role="status">${esc(cache.error||`本次读取 ${cache.methods.length} 份他人公开方法。选用后保留当时版本。`)}</p>`:''}`}
function reviewResourceLink(r){if(!r||typeof r!=='object')return '<p>资料格式待核对</p>';let url=null;try{const u=new URL(r.url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)url=u.href}catch{}return `<p>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`:`${esc(r.label||'资料')}：${esc(r.url||'链接待核对')}`} · ${r.optional?'可选':'需用'}${r.affiliate?' · 外链抽成标记':''}</p>`}
function reviewSharedResources(v){if(!Array.isArray(v.resourceLinks)||!v.resourceLinks.length)return '';return `<div class="small" style="margin:14px 0"><h3 class="small">当时的资料</h3>${v.resourceLinks.map(reviewResourceLink).join('')}<p class="muted">链接不代表已购买或发生抽成。</p></div>`}
async function reviewLoadShared(nid){
 const context=reviewContext(),ownerId=context.ownerId,n=S.nodes.find(n=>n.id===nid);if(!n||!S.user?.reviewService)return;const key=reviewSharedKey(n),jobKey=JSON.stringify([key,context.generation]);if(reviewSharedJobs.has(jobKey))return;
 const target=reviewSharedTarget(n),previous=reviewSharedCache.get(key);reviewSharedJobs.add(jobKey);if(S.page==='atlas'&&U.node===nid)render(false);
 try{
  if(!reviewReady||reviewClient.snapshot().ownerId!==ownerId)throw Error('请先连接本人服务账号。');
  if(!save())throw Error('本机保存未完成，编辑已保留，请先核对。');await reviewFlush();
  const result=await reviewKnowledgeRequest('/api/review-shared-methods?nodeId='+encodeURIComponent(nid),{context,headers:{'If-Match':reviewClient.snapshot().revision}});
  const current=S.nodes.find(n=>n.id===nid);if(!reviewContextCurrent(context)||!current||reviewSharedTarget(current)!==target)return;
  if(result.ownerId!==ownerId||result.target?.originId!==nid||!['title','goal','five','domain','branch','ownership','visibility'].every(k=>result.target[k]===current[k])||result.ref?.sourceVersion!==current.version||!Array.isArray(result.methods)||!Array.isArray(result.tutorials))throw Error('完整目标或服务回执不一致，未加载方法。');
  for(const m of result.methods){const ref=m.serviceReference,v=m.versions?.[0],t=result.tutorials.find(t=>t.id===ref?.id&&t.version===ref?.version);if(!t||m.id!=='service-'+t.id+'-'+t.version||m.author!==t.authorName||ref.authorId!==t.authorId||v?.number!==1||v.content!==t.method||v.five!==t.startAction||v.resource!==''||JSON.stringify(v.resourceLinks)!==JSON.stringify(t.resources))throw Error('方法快照回执不完整，未覆盖原内容。')}
  reviewSharedCache.set(key,{target,methods:clone(result.methods),error:''});return true;
 }catch(error){if(reviewContextCurrent(context)){reviewSharedCache.set(key,{target,methods:previous?.target===target?previous.methods:[],error:reviewIsNetworkError(error)?'连接未完成，自己的方法与原快照保留；可重新加载。':error.message})}}
 finally{reviewSharedJobs.delete(jobKey);if(reviewContextCurrent(context)&&S.page==='atlas'&&U.node===nid)render(false)}
}
async function reviewBindSharedEvent(eventId){
 const context=reviewContext(),ownerId=context.ownerId,e=S.events.find(e=>e.id===eventId),k=e?.knowledge,n=k&&S.nodes.find(n=>n.id===k.nodeId),m=n?.methods.find(m=>m.id===k.methodId),ref=m?.serviceReference;
 if(!S.user?.reviewService||!ref)return;const key=JSON.stringify([ownerId,context.generation,eventId]);if(reviewSharedJobs.has(key))return;reviewSharedJobs.add(key);
 try{
  if(!reviewReady||reviewClient.snapshot().ownerId!==ownerId)throw Error('请重新连接本人账号后核对。');if(!save())throw Error('本机保存未完成，请先保留备份。');await reviewFlush();
  if(!reviewContextCurrent(context))return;
  const result=await reviewKnowledgeRequest('/api/review-method-bindings',{context,body:{nodeId:k.nodeId,methodId:k.methodId,sourceVersion:k.version,tutorialId:ref.id,tutorialVersion:ref.version},headers:{'If-Match':reviewClient.snapshot().revision}});
  if(!reviewContextCurrent(context))return;if(result.binding?.service?.id!==ref.id||result.binding.service.version!==ref.version)throw Error('服务引用回执不一致，请重新核对。');
  const current=S.nodes.find(n=>n.id===k.nodeId)?.methods.find(m=>m.id===k.methodId);if(current){current.serviceBinding={id:ref.id,version:ref.version};save();if(S.page==='timer')render(false)}
 }catch(error){if(reviewContextCurrent(context))toast('计时和当时快照保留；服务引用尚未核对。'+(reviewIsNetworkError(error)?'连接恢复后可重试。':error.message))}
 finally{reviewSharedJobs.delete(key)}
}
function handle(action){
 if(reviewAuthBusy||reviewAccountConnecting)return;
 if(action.startsWith('review-private-target:')){reviewOpenPrivateTarget(action.slice('review-private-target:'.length));return}
 if(action.startsWith('review-practice-open:')){reviewOpenPractice(action.slice('review-practice-open:'.length));return}
 if(action.startsWith('share-light:')&&S.user?.reviewService){const l=S.lights.find(l=>l.id===action.slice('share-light:'.length));if(l)reviewOpenPractice(l.eventId);return}
 if(action.startsWith('review-shared-load:')){reviewLoadShared(action.slice('review-shared-load:'.length));return}
 if(action.startsWith('review-shared-bind:')){reviewBindSharedEvent(action.slice('review-shared-bind:'.length));return}
 if(action==='practice'&&S.user?.reviewService){const n=node(),chosen=reviewAvailableMethods(n).find(m=>m.id===U.method);if(U.method&&!chosen){toast('所选方法已不可读取，请重新选择，原记录保留。');return}if(chosen?.serviceReference&&!n.methods.some(m=>m.id===chosen.id))n.methods.push(clone(chosen));handleLocal(action);const e=active();if(e?.knowledge?.serviceReference)reviewBindSharedEvent(e.id);return}
 return handleLocal(action);
}
