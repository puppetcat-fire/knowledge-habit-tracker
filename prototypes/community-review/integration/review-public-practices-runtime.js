function reviewPracticeSnapshot(p){return p.snapshotStatus==='bound'?`<details class="saved-notes practice-snapshot"><summary>${p.tutorialReference&&p.snapshot.methodTitle?`所用教程 · ${esc(p.snapshot.methodTitle)}`:'查看当时知识与材料'}</summary><p class="pre small">当时目标 · v${esc(p.snapshot.nodeVersion)}<br>${esc(p.snapshot.nodeGoal)}</p><p class="pre small">${p.tutorialUnavailable?'原教程版本目前不可公开访问。':p.independent?'独立尝试':`当时方法：${esc(p.snapshot.methodTitle)} · ${esc(p.snapshot.methodAuthor||'作者未记录')} · ${esc(p.tutorialReference?.version||p.snapshot.version)}`}<br>${esc(p.snapshot.content||'')}</p>${p.snapshot.five?`<p class="pre small">起步：${esc(p.snapshot.five)}</p>`:''}${p.tutorialReference?reviewTutorialVersionLink(p.treeId,p.nodeId,p.tutorialReference.id,p.tutorialReference.version):''}<p class="small muted">实际活动 ${clock(p.activity.actualMilliseconds)} · ${p.activity.segmentCount} 段</p>${Array.isArray(p.snapshot.resourceLinks)?p.snapshot.resourceLinks.map(reviewResourceLink).join(''):p.snapshot.resource?`<p class="pre small">当时资料：${esc(p.snapshot.resource)}</p>`:''}</details>`:'<p class="small muted">这条旧记录尚未核对完整目标与活动快照。</p>'}
let reviewPendingPracticeLink=new URLSearchParams(location.search).getAll('practice');
function reviewPracticeUrl(practice){
 const url=new URL(location.pathname,location.origin);
 url.searchParams.set('practice',practice.id);
 return url.href;
}
function reviewPracticeLink(practice){
 return `<a class="small" data-practice-link href="${esc(reviewPracticeUrl(practice))}">实践链接</a>`;
}
function reviewApplyPracticeLink(){
 if(!reviewPendingPracticeLink.length||reviewAuthBusy||reviewAccountConnecting||!reviewReady||!S.user?.reviewService)return;
 const ids=reviewPendingPracticeLink;
 reviewPendingPracticeLink=[];
 if(ids.length!==1||!/^[A-Za-z0-9_-]{1,100}$/.test(ids[0])){toast('实践链接无效。');return}
 void reviewOpenPracticeLink(ids[0],reviewContext());
}
async function reviewOpenPracticeLink(id,context){
 const dialog=modal('<h2>公开实践</h2><p id="linked-practice-status" role="status">正在核对公开实践…</p><div id="linked-practice-content"></div>','','公开实践链接');
 const host=document.getElementById('linked-practice-content'),status=document.getElementById('linked-practice-status');
 const current=()=>dialog.open&&host.isConnected&&reviewContextCurrent(context);
 async function load(){
 if(!current())return;
 host.replaceChildren();
 status.textContent='正在核对公开实践…';
 try{
  const result=await reviewKnowledgeRequest('/api/review-public-practices/one?id='+encodeURIComponent(id),{context});
  if(!current())return;
  const p=result.practice;
  if(result.ownerId!==context.ownerId||p?.id!==id)throw Error('实践回执不一致，请重新打开链接。');
  host.innerHTML=`<h3>${esc(p.snapshot?.nodeTitle||p.currentTarget.title)}</h3><button type="button" class="ghost" data-linked-practice-author>${esc(p.authorName)}</button><p class="pre">${esc(p.text)}</p>${reviewPracticeSnapshot(p)}${reviewPublicPracticeImages(p)}<button type="button" class="ghost" data-linked-practice-target>查看当前目标与方法</button>`;
  status.textContent='';
  host.querySelector('[data-linked-practice-author]').onclick=()=>{if(current())reviewGoPublicAuthor({id:p.authorId,name:p.authorName},context)};
  host.querySelector('[data-linked-practice-target]').onclick=e=>reviewOpenPracticeTarget(p,context,e.currentTarget,status);
  reviewAppendShareCopy(host,reviewPracticeUrl(p),{
   label:'复制实践链接',fieldLabel:'公开实践链接',success:'已复制实践链接。',current
  });
 }catch(error){
  if(!current())return;
  if(!reviewIsNetworkError(error)&&error.code!=='PUBLIC_PRACTICE_UNREADABLE'){
   status.textContent=error.message;
   return;
  }
  status.textContent='暂时无法读取公开实践，请重试。';
  const retry=document.createElement('button');
  retry.type='button';
  retry.textContent='重新读取实践';
  retry.onclick=()=>void load();
  host.append(retry);
 }
 }
 await load();
}
function reviewPublicPracticeAuthor(){const a=U.publicPracticeAuthor;return a&&a.ownerId===S.user?.id&&a.generation===reviewAccountGeneration?a:null}
function reviewPublicPracticeTarget(){const t=U.publicPracticeTarget;return t&&t.ownerId===S.user?.id&&t.generation===reviewAccountGeneration?t:null}
function reviewOpenTargetPractices(target,context=reviewContext()){if(!reviewContextCurrent(context))return;U.publicPracticeTarget={...context,treeId:target.treeId,nodeId:target.nodeId||target.id,title:target.title};U.publicPracticeAuthor=null;U.publicPracticePager=null;closeModal();navigate('publicPractices')}
function reviewPublicPracticePage(){queueMicrotask(()=>reviewBindPublicPractices());const a=reviewPublicPracticeAuthor(),t=reviewPublicPracticeTarget();return title('公开实践','大家主动公开的实践、结果和所用知识。')+(t?`<section class="box"><h2>${esc(t.title)}的公开实践</h2><p class="small muted">各次实践保留当时的目标和方法版本。</p><button id="public-practice-target-clear" class="ghost">浏览全部目标</button></section>`:'')+(a?`<section class="box"><h2>${esc(a.name)}的公开实践</h2><button id="public-practice-author-home" class="ghost">查看作者主页</button><button id="public-practice-author-details" class="ghost">查看作者介绍与公开教程</button><button id="public-practice-author-clear" class="ghost">浏览全部作者</button></section>`:'')+`<form id="public-practice-form" class="row" style="margin:16px 0"><input style="flex:1 1 240px;width:auto" value="${esc(S.settings.publicPracticeSearch||'')}" name="query" type="search" maxlength="120" aria-label="搜索公开实践" placeholder="结果、目标或作者"><button>搜索</button></form><p id="public-practice-status" class="small muted" role="status"></p><div id="public-practice-results"></div>`;}
function reviewOpenPublicPractices(){if(S.user?.reviewService)navigate('publicPractices')}
function reviewPublicPracticeImages(practice){return practice.images.map((v,i)=>`<figure style="margin:12px 0"><a href="/api/media/${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer"><img data-practice-image alt="${esc(practice.authorName)}的公开实践图片 ${i+1}" src="/api/media/${encodeURIComponent(v.id)}" loading="lazy" decoding="async" style="display:block;width:100%;max-height:320px;object-fit:contain;border-radius:8px"></a><figcaption class="small muted">公开图片 ${i+1} · 点击查看原图</figcaption></figure>`).join('')}
function reviewOpenAuthorPractices(author,context){if(!reviewContextCurrent(context))return;U.publicPracticeAuthor={...context,id:author.id,name:author.name};U.publicPracticeTarget=null;U.publicPracticePager=null;closeModal();navigate('publicPractices')}
async function reviewOpenPracticeTarget(practice,context,button,status){
 if(!button.isConnected||button.disabled||!reviewContextCurrent(context))return;button.disabled=true;
 try{const r=await reviewKnowledgeRequest('/api/review-public-practices/one?id='+encodeURIComponent(practice.id),{context});if(!button.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId||JSON.stringify(r.practice)!==JSON.stringify(practice))throw Error('实践或目标已变化，请重新读取后核对。');
  const t=practice.currentTarget;if(practice.kind==='personal-public'){reviewShowVisibleTarget(t,context,'');return}
  const n=S.nodes.find(n=>n.id===t.originId);if(!n||!['title','goal','five','domain','branch','ownership','visibility'].every(k=>n[k]===t[k])||n.version!==t.sourceVersion)throw Error('本机目标与当前公开目标不一致，原记录保留，请先核对。');
  handle('node-nav:'+n.id);await reviewLoadShared(n.id);
 }catch(e){if(button.isConnected&&reviewContextCurrent(context))status.textContent=e instanceof TypeError?'目标读取未确认，请重试。':e.message}finally{button.disabled=false}
}
async function reviewBindPublicPractices(){
 const f0=document.getElementById('public-practice-form');if(!f0||f0.dataset.bound==='true'||reviewAuthBusy||reviewAccountConnecting||!S.user?.reviewService)return;f0.dataset.bound='true';const context=reviewContext();const f=document.getElementById('public-practice-form'),host=document.getElementById('public-practice-results'),status=document.getElementById('public-practice-status');let generation=0;const author=reviewPublicPracticeAuthor(),authorId=author?.id||'',target=reviewPublicPracticeTarget(),treeId=target?.treeId||'',nodeId=target?.nodeId||'';document.getElementById('public-practice-target-clear')?.addEventListener('click',()=>{if(!f.isConnected||!reviewContextCurrent(context))return;U.publicPracticeTarget=null;U.publicPracticePager=null;render();document.getElementById('main-content')?.focus({preventScroll:true})});document.getElementById('public-practice-author-home')?.addEventListener('click',()=>{if(f.isConnected)reviewGoPublicAuthor({id:author.id,name:author.name},context)});document.getElementById('public-practice-author-details')?.addEventListener('click',e=>reviewOpenPublicAuthor({authorId},context,e.currentTarget,status));document.getElementById('public-practice-author-clear')?.addEventListener('click',()=>{if(!f.isConnected||!reviewContextCurrent(context))return;U.publicPracticeAuthor=null;U.publicPracticePager=null;render();document.getElementById('main-content')?.focus({preventScroll:true})});const savedPage=U.publicPracticePager;const validSavedPage=savedPage&&savedPage.ownerId===context.ownerId&&savedPage.generation===context.generation&&savedPage.treeId===treeId&&savedPage.nodeId===nodeId&&savedPage.authorId===authorId&&savedPage.query===f.elements.namedItem('query').value;const initialCursor=validSavedPage?savedPage.cursor:'',initialHistory=validSavedPage&&Array.isArray(savedPage.history)?savedPage.history:[];
 async function load(cursor='',history=[]){if(!f.isConnected||!reviewContextCurrent(context))return;const requestGeneration=++generation,query=f.elements.namedItem('query').value;host.innerHTML='';f.querySelector('button').disabled=true;status.textContent='正在读取公开实践…';try{const r=await reviewKnowledgeRequest('/api/review-public-practices?query='+encodeURIComponent(query)+(nodeId?'&treeId='+encodeURIComponent(treeId)+'&nodeId='+encodeURIComponent(nodeId):'')+(authorId?'&authorId='+encodeURIComponent(authorId):'')+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});if(!host.isConnected||!reviewContextCurrent(context)||requestGeneration!==generation)return;if(r.ownerId!==context.ownerId||r.authorId!==authorId||r.treeId!==treeId||r.nodeId!==nodeId||!Array.isArray(r.practices))throw Error('公开实践回执不一致。');U.publicPracticePager={...context,query,cursor,history:[...history],authorId,treeId,nodeId};status.textContent=`找到 ${r.total} 条公开实践，本页 ${r.practices.length} 条。第 ${history.length+1} 页。`;host.innerHTML=r.practices.map((p,i)=>`<article class="list-row"><h3>${esc(p.snapshot?.nodeTitle||(p.currentTarget?.title?'当前关联目标 · '+p.currentTarget.title:'公开行动记录'))}</h3><p class="small muted"><button class="ghost" data-practice-author="${i}" aria-label="查看实践作者：${esc(p.authorName)}">${esc(p.authorName)}</button> · ${esc(new Date(p.createdAt).toLocaleString('zh-CN'))} · ${p.lightUp?'作者本人自证':'公开行动记录'}</p><p class="pre">${esc(p.text)}</p>${reviewPracticeSnapshot(p)}<button class="ghost" data-practice-target="${i}">查看当前目标与方法</button>${reviewPracticeLink(p)}${reviewPublicPracticeImages(p)}</article>`).join('')||'<p class="small muted">暂未找到符合条件的公开实践。</p>';host.querySelectorAll('[data-practice-image]').forEach(img=>img.addEventListener('error',()=>{if(!f.isConnected||!reviewContextCurrent(context))return;img.hidden=true;img.style.display='none';img.closest('a').hidden=true;img.closest('figure').querySelector('figcaption').textContent='图片暂时无法读取，请重新读取实践。'}));host.querySelectorAll('[data-practice-author]').forEach(b=>b.addEventListener('click',()=>{if(!b.isConnected||!reviewContextCurrent(context))return;const p=r.practices[Number(b.dataset.practiceAuthor)];U.publicPracticeAuthor={...context,id:p.authorId,name:p.authorName};U.publicPracticePager=null;render();document.getElementById('main-content')?.focus({preventScroll:true})}));host.querySelectorAll('[data-practice-target]').forEach(b=>b.addEventListener('click',()=>reviewOpenPracticeTarget(r.practices[Number(b.dataset.practiceTarget)],context,b,status)));if(history.length){const previous=document.createElement('button');previous.textContent='上一页公开实践';previous.dataset.publicPracticePrevious='true';previous.addEventListener('click',()=>load(history.at(-1),history.slice(0,-1)));host.append(previous)}if(r.nextCursor){const next=document.createElement('button');next.textContent='下一页公开实践';next.dataset.publicPracticeNext='true';next.addEventListener('click',()=>load(r.nextCursor,[...history,cursor]));host.append(next)}}catch(e){if(host.isConnected&&reviewContextCurrent(context)&&requestGeneration===generation){status.textContent=e instanceof TypeError?'公开实践读取未确认，请重新读取。':e.message;host.innerHTML='';const retry=document.createElement('button');retry.textContent='重新读取第一页';retry.addEventListener('click',()=>load());host.append(retry)}}finally{if(requestGeneration===generation)f.querySelector('button').disabled=false}}
 f.elements.namedItem('query').addEventListener('input',()=>{if(!f.isConnected||!reviewContextCurrent(context))return;generation++;U.publicPracticePager=null;S.settings.publicPracticeSearch=f.elements.namedItem('query').value;save();host.innerHTML='';f.querySelector('button').disabled=false;status.textContent='搜索词已修改，点击搜索查看结果。'});f.addEventListener('submit',e=>{e.preventDefault();load()});await load(initialCursor,initialHistory);
}
