function reviewAppendShareCopy(host,shareUrl,{label,fieldLabel,success,current}){
 const copy=document.createElement('button'),status=document.createElement('p'),field=document.createElement('input');
 copy.type='button';copy.className='ghost';copy.textContent=label;
 status.className='small muted';status.setAttribute('role','status');
 field.type='url';field.readOnly=true;field.hidden=true;field.value=shareUrl;field.setAttribute('aria-label',fieldLabel);
 copy.onclick=async()=>{
  if(!current()||copy.disabled)return;
  copy.disabled=true;
  try{
   if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
   await navigator.clipboard.writeText(shareUrl);
   if(current()){field.hidden=true;status.textContent=success}
  }catch{
   if(current()){status.textContent='请手动复制已选中的链接。';field.hidden=false;field.focus();field.select()}
  }finally{copy.disabled=false}
 };
 host.append(copy,field,status);
 return copy;
}
const reviewTutorialLinkParams=new URLSearchParams(location.search);
let reviewPendingTutorialLink=reviewTutorialLinkParams.has('tutorial');
function reviewTutorialLink(tutorial,commentId=null){
 const url=new URL(location.pathname,location.origin);
 url.searchParams.set('tutorial',tutorial.id);url.searchParams.set('version',tutorial.version);
 if(commentId)url.searchParams.set('comment',commentId);
 return url.href;
}
function reviewApplyTutorialLink(){
 if(!reviewPendingTutorialLink||reviewAuthBusy||reviewAccountConnecting||!reviewReady||!S.user?.reviewService)return;
 reviewPendingTutorialLink=false;
 const ids=reviewTutorialLinkParams.getAll('tutorial'),versions=reviewTutorialLinkParams.getAll('version');
 const comments=reviewTutorialLinkParams.getAll('comment');
 if(ids.length!==1||versions.length!==1||!/^[A-Za-z0-9_-]{1,100}$/.test(ids[0])||!/^[a-f0-9]{64}$/.test(versions[0])||comments.length>1||comments.length===1&&!/^[A-Za-z0-9_-]{1,100}$/.test(comments[0])){
  toast('教程链接无效。');return;
 }
 reviewOpenTutorialLink(ids[0],versions[0],comments[0]);
}
async function reviewOpenTutorialLink(id,version,commentId=null){
 const context=reviewContext();
 modal('<h2>公开教程</h2><p id="public-tutorial-link-status" role="status">正在核对公开教程…</p><div id="public-tutorial-link-content"></div>','','公开教程链接');
 const host=document.getElementById('public-tutorial-link-content'),status=document.getElementById('public-tutorial-link-status');
 const current=()=>host.isConnected&&reviewContextCurrent(context);
 try{
  const result=await reviewKnowledgeRequest('/api/review-public-tutorials/one?id='+encodeURIComponent(id),{context});
  if(!current())return;
  const tutorial=result.tutorial;
  if(result.ownerId!==context.ownerId||tutorial?.id!==id)throw Error('教程链接回执无法核对。');
  status.textContent=tutorial.version===version?'已核对链接版本。':'链接所指版本已有更新。下面是当前公开版本，请核对后继续。';
  host.innerHTML=`<article class="box"><h3>${esc(tutorial.title)}</h3><p class="small muted">${esc(tutorial.authorName)} · 版本 ${esc(tutorial.version.slice(0,8))}</p><p class="pre">目标：${esc(tutorial.target.goal)}</p><p class="pre">${esc(tutorial.method)}</p><p class="pre small">五分钟起步：${esc(tutorial.startAction)}</p>${tutorial.resources.map(reviewResourceLink).join('')}<div class="row"><button type="button" data-linked-tutorial-target>查看目标与方法</button><button type="button" data-linked-tutorial-discussion>讨论与提问</button><button type="button" data-linked-tutorial-bookmark>收藏这个版本</button></div></article>`;
  const refresh=()=>{if(current())return reviewOpenTutorialLink(id,version,commentId)};
  reviewAppendShareCopy(host.querySelector('article'),reviewTutorialLink(tutorial),{
   label:'复制当前版本链接',fieldLabel:'当前版本教程链接',success:'已复制当前版本链接。',current
  }).dataset.linkedTutorialCopy='true';
  host.querySelector('[data-linked-tutorial-bookmark]').onclick=event=>reviewBookmarkTutorial(tutorial,context,event.currentTarget,status,refresh);
  host.querySelector('[data-linked-tutorial-target]').onclick=event=>reviewOpenSearchTarget(tutorial,context,event.currentTarget,status,refresh);
  const discussion=host.querySelector('[data-linked-tutorial-discussion]');
  if(commentId)discussion.textContent='查看对应发言';
  discussion.onclick=event=>reviewOpenSearchTarget(tutorial,context,event.currentTarget,status,refresh,verified=>
   reviewOpenDiscussion(verified,commentId,null,()=>reviewOpenTutorialLink(id,version,commentId),'返回教程预览'));
 }catch(error){
  if(!current())return;
  status.textContent=error.message;
  if(error.code==='PUBLIC_TUTORIAL_UNAVAILABLE')return;
  const retry=document.createElement('button');retry.type='button';retry.textContent='重新核对教程链接';
  retry.onclick=()=>{if(current())reviewOpenTutorialLink(id,version,commentId)};
  host.append(retry);
 }
}
function reviewPublicSearchTools(){return S.user?.reviewService?btn('搜索公开教程','review-public-search','ghost'):''}
async function reviewOpenPublicSearch(query='',author=null,view=null){
 const context=reviewContext();modal(`<h2>${author?esc(author.name)+'的公开教程':'搜索公开教程'}</h2>${author?`<section class="box">${author.profile?`<p>${esc(author.profile.tagline)}</p><p class="pre small">${esc(author.profile.about)}</p><p class="small muted">${esc(author.profile.focus)}</p>`:'<p class="small muted">这里只展示作者当前公开的教程。</p>'}<button id="public-author-home" class="ghost">查看作者主页</button><button id="public-author-paths" class="ghost">查看作者公开路径</button><button id="public-author-practices" class="ghost">查看作者公开实践</button><button id="public-author-clear" class="ghost">浏览全部作者</button></section>`:''}<form id="public-tutorial-search" class="row" style="margin:16px 0"><input name="query" type="search" aria-label="搜索目标、方法或作者" maxlength="120" value="${esc(query)}" placeholder="目标、方法或作者"><button>搜索</button></form><label class="small">浏览顺序 <select id="public-tutorial-order" aria-label="公开教程浏览顺序"><option value="stable">固定顺序</option><option value="recent">最新版本</option></select></label><p id="public-tutorial-status" class="small muted" role="status"></p><div id="public-tutorial-results"></div>`,'','公开教程搜索');
 const form=document.getElementById('public-tutorial-search'),host=document.getElementById('public-tutorial-results'),status=document.getElementById('public-tutorial-status'),orderSelect=document.getElementById('public-tutorial-order');orderSelect.value=view?.order||'stable';let generation=0;
 async function load(cursor='',notice='',history=[],restoreFocus=false){
  if(!form.isConnected||!reviewContextCurrent(context))return;const requestGeneration=++generation;form.querySelector('button').disabled=true;host.innerHTML='';status.textContent='正在读取公开教程…';const q=form.elements.namedItem('query').value,order=orderSelect.value;
  try{const r=await reviewKnowledgeRequest('/api/review-public-tutorials?query='+encodeURIComponent(q)+(author?'&authorId='+encodeURIComponent(author.id):'')+(order==='recent'?'&order=recent':'')+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});if(!host.isConnected||!reviewContextCurrent(context)||requestGeneration!==generation)return;if(r.ownerId!==context.ownerId||r.order!==order||r.authorId!==(author?.id||'')||!Array.isArray(r.tutorials))throw Error('公开教程回执不一致。');status.textContent=`${notice}找到 ${r.total} 份公开教程，本页 ${r.tutorials.length} 份。`;host.innerHTML=r.tutorials.map((t,i)=>`<article class="list-row" tabindex="-1"><h3>${esc(t.title)}</h3><p class="small muted"><button class="ghost" data-public-author="${i}" aria-label="查看作者：${esc(t.authorName)}">${esc(t.authorName)}</button> · ${esc(t.target.title)} · 教程 ${esc(t.version.slice(0,8))}</p><p class="small muted">版本发布：${esc(new Date(t.createdAt).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}))}</p><details class="saved-notes"><summary>查看方法、目标与材料</summary><p class="pre small">完整目标：${esc(t.target.goal)}</p><p class="pre">${esc(t.method)}</p><p class="pre small">教程五分钟：${esc(t.startAction)}</p>${t.resources.map(reviewResourceLink).join('')}</details><button class="ghost" data-public-tutorial="${i}">查看目标与方法</button><button class="ghost" data-tutorial-discussion="${i}">讨论与提问</button><button class="ghost" data-search-bookmark="${i}">收藏这个版本</button><a class="small" href="${esc(reviewTutorialLink(t))}">教程链接</a></article>`).join('')||'<p class="small muted">没有符合条件的公开教程，可以换个词再试。</p>';host.querySelectorAll('[data-public-author]').forEach(b=>b.addEventListener('click',()=>reviewOpenPublicAuthor(r.tutorials[Number(b.dataset.publicAuthor)],context,b,status)));host.querySelectorAll('[data-public-tutorial]').forEach(b=>b.addEventListener('click',()=>reviewOpenSearchTarget(r.tutorials[Number(b.dataset.publicTutorial)],context,b,status,notice=>load('',notice))));host.querySelectorAll('[data-search-bookmark]').forEach(b=>b.onclick=()=>reviewBookmarkTutorial(r.tutorials[Number(b.dataset.searchBookmark)],context,b,status,notice=>load('',notice)));host.querySelectorAll('[data-tutorial-discussion]').forEach(b=>b.addEventListener('click',()=>reviewOpenSearchTarget(r.tutorials[Number(b.dataset.tutorialDiscussion)],context,b,status,notice=>load('',notice),tutorial=>reviewOpenDiscussion(tutorial,null,null,()=>reviewOpenPublicSearch(q,author,{order,cursor,history}),'返回教程搜索'))));if(history.length||r.nextCursor){
   const pager=document.createElement('nav');pager.className='row';pager.setAttribute('aria-label','教程搜索分页');
   const control=(label,nextCursor,nextHistory)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>load(nextCursor,'',nextHistory,host.contains(document.activeElement));pager.append(button)};
   if(history.length)control('上一页教程',history.at(-1),history.slice(0,-1));
   if(r.nextCursor)control('下一页教程',r.nextCursor,[...history,cursor]);
   host.append(pager);
  }
  if(restoreFocus&&document.activeElement===document.body)reviewDiscussionArchivePosition(host,form);
  }catch(e){if(host.isConnected&&reviewContextCurrent(context)&&requestGeneration===generation){
   if(cursor&&e.code==='PUBLIC_TUTORIAL_CURSOR_CHANGED')return await load('','教程列表有变化，已回到第一页。',[],restoreFocus);
   status.textContent=e.message;host.innerHTML='';const retry=document.createElement('button');retry.type='button';retry.textContent=cursor?'重试读取这一页':'重新读取第一页';retry.addEventListener('click',()=>load(cursor,notice,history,host.contains(document.activeElement)));host.append(retry);if(restoreFocus&&document.activeElement===document.body)retry.focus()}}finally{if(requestGeneration===generation)form.querySelector('button').disabled=false}
 }
 form.elements.namedItem('query').addEventListener('input',()=>{generation++;host.innerHTML='';form.querySelector('button').disabled=false;status.textContent='搜索词已修改，点击搜索查看结果。'});document.getElementById('public-author-home')?.addEventListener('click',()=>{if(form.isConnected)reviewGoPublicAuthor(author,context)});document.getElementById('public-author-paths')?.addEventListener('click',()=>{if(form.isConnected&&reviewContextCurrent(context))reviewOpenPublicPaths('',author)});document.getElementById('public-author-practices')?.addEventListener('click',()=>{if(form.isConnected)reviewOpenAuthorPractices(author,context)});document.getElementById('public-author-clear')?.addEventListener('click',()=>reviewOpenPublicSearch());orderSelect.addEventListener('change',()=>load());form.addEventListener('submit',e=>{e.preventDefault();load()});await load(view?.cursor||'','',view?.history||[]);
}
async function reviewOpenSearchTarget(t,context,button,status,refresh=null,openDiscussion=null){
 if(!button.isConnected||button.disabled)return;button.disabled=true;
 try{const r=await reviewKnowledgeRequest('/api/review-public-tutorials/one?id='+encodeURIComponent(t.id),{context});if(!button.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId)throw Error('教程归属回执不一致。');
  if(JSON.stringify(r.tutorial)!==JSON.stringify(t)){
   if(refresh)return await refresh('教程或目标已变化，请核对更新后的结果。');
   throw Error('教程或目标已变化，请重新搜索后核对。');
  }
  if(openDiscussion)return await openDiscussion(r.tutorial);
  if(t.kind==='personal-public'){reviewShowVisibleTarget(t.target,context,'');return}
  const n=S.nodes.find(n=>n.id===t.target.originId);if(!n||!['title','goal','five','domain','branch','ownership','visibility'].every(k=>n[k]===t.target[k])||n.version!==t.target.sourceVersion)throw Error('本机完整目标与教程目录不一致，原记录保留，请先核对。');
  const loaded=await reviewLoadShared(n.id);if(!button.isConnected||!reviewContextCurrent(context))return;if(!loaded)throw Error('指定方法读取未确认，请重试后再进入目标。');const m=reviewAvailableMethods(n).find(m=>m.serviceReference?.id===t.id&&m.serviceReference.version===t.version);if(!m)throw Error('指定方法版本已变化，请重新读取后核对。');closeModal();handle('node-nav:'+n.id);U.method=m.id;render(false);
 }catch(e){
  if(!button.isConnected||!reviewContextCurrent(context))return;
  if(refresh&&e.code==='PUBLIC_TUTORIAL_UNAVAILABLE')await refresh('教程或目标已不可公开读取。');
  else status.textContent=e.message;
 }finally{button.disabled=false}
}

async function reviewOpenPublicAuthor(t,context,button,status){
 if(!button.isConnected||button.disabled||!reviewContextCurrent(context))return;button.disabled=true;
 try{const r=await reviewKnowledgeRequest('/api/review-public-tutorials/author?id='+encodeURIComponent(t.authorId),{context});if(!button.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId||r.author?.id!==t.authorId)throw Error('作者资料回执不一致，请重新搜索。');await reviewOpenPublicSearch('',r.author)}catch(e){if(button.isConnected&&reviewContextCurrent(context))status.textContent=e.message}finally{button.disabled=false}
}
