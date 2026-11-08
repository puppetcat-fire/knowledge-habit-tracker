function reviewValidFeedView(v){return v&&(v.order===undefined||['relevance','recent'].includes(v.order))&&typeof v.query==='string'&&v.query.length<=120&&['all','tutorial','practice','path'].includes(v.kind)&&typeof v.cursor==='string'&&v.cursor.length<=100&&Array.isArray(v.history)&&v.history.every(c=>typeof c==='string'&&c.length<=100)&&typeof v.draft==='boolean'}
function reviewFeedView(scope){const v=U.reviewFeedViews?.[scope];if(v&&v.ownerId===S.user?.id&&v.generation===reviewAccountGeneration&&reviewValidFeedView(v))return v;const saved=S.user?.reviewService&&S.settings.publicFeedViews?.[scope];return reviewValidFeedView(saved)?saved:null}
function reviewStoreFeedView(scope,value,context){if(!reviewContextCurrent(context)||!['community','following'].includes(scope)||!reviewValidFeedView(value))return;const view={query:value.query,kind:value.kind,...(value.order==='recent'?{order:'recent'}:{}),cursor:value.cursor,history:[...value.history],draft:value.draft};U.reviewFeedViews??={};U.reviewFeedViews[scope]={...context,...view};S.settings.publicFeedViews??={};if(JSON.stringify(S.settings.publicFeedViews[scope])!==JSON.stringify(view)){S.settings.publicFeedViews[scope]=view;save()}}
function reviewCommunityPage(){queueMicrotask(()=>reviewBindFollowingFeed());return title('发现','浏览大家主动公开的方法、行动与知识路径。')+reviewFollowingFeedSection('community')}
function reviewFollowedAuthors(){return Array.isArray(S.settings.followedAuthors)?S.settings.followedAuthors:[]}
function reviewFollowingFeedSection(scope='following'){const label=scope==='community'?'公开内容':'关注内容',view=reviewFeedView(scope);return `<section class="box" style="margin-top:24px"><h2>${scope==='community'?'教程、实践与知识路径':'关注作者的公开内容'}</h2><form id="following-feed-form" data-feed-scope="${scope}" class="row"><input name="query" value="${esc(view?.query||'')}" type="search" maxlength="120" aria-label="搜索${label}" placeholder="目标、内容或作者"><select name="kind" aria-label="${label}类型"><option value="all" ${!view||view.kind==='all'?'selected':''}>全部内容</option><option value="tutorial" ${view?.kind==='tutorial'?'selected':''}>教程</option><option value="practice" ${view?.kind==='practice'?'selected':''}>实践</option><option value="path" ${view?.kind==='path'?'selected':''}>路径</option></select><select name="order" aria-label="排序"><option value="relevance">相关度</option><option value="recent" ${view?.order==='recent'?'selected':''}>最近发布</option></select><button>读取最新内容</button></form><p id="following-feed-status" class="small muted" role="status"></p><div id="following-feed-results"></div></section>`}
async function reviewBindFollowingFeed(){
 const form=document.getElementById('following-feed-form');if(!form||form.dataset.bound||reviewAuthBusy||reviewAccountConnecting||!S.user?.reviewService)return;form.dataset.bound='true';const scope=form.dataset.feedScope||'following',label=scope==='community'?'公开内容':'关注内容',context=reviewContext(),host=document.getElementById('following-feed-results'),status=document.getElementById('following-feed-status');let generation=0;
 async function load(cursor='',history=[],notice=''){if(!form.isConnected||!reviewContextCurrent(context))return;const g=++generation,query=form.elements.query.value,kind=form.elements.kind.value,order=form.elements.order.value;reviewStoreFeedView(scope,{query,kind,order,cursor,history,draft:false},context);host.innerHTML='';status.textContent='正在读取'+label+'…';form.querySelector('button').disabled=true;const current=()=>form.isConnected&&reviewContextCurrent(context)&&g===generation;
  try{if(scope==='following')await reviewFlush();if(!current())return;const r=await reviewKnowledgeRequest((scope==='community'?'/api/review-community-feed':'/api/review-following-feed')+'?query='+encodeURIComponent(query)+'&kind='+encodeURIComponent(kind)+(order==='recent'?'&order=recent':'')+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});if(!current())return;if(r.ownerId!==context.ownerId||r.scope!==scope||r.query!==query||r.kind!==kind||(r.order??'relevance')!==order||!Array.isArray(r.entries)||scope==='following'&&r.entries.some(e=>!reviewFollowedAuthors().some(a=>a.id===e.authorId)))throw Error(label+'回执不一致，请重新读取。');status.textContent=scope==='community'?`${notice}找到 ${r.total} 条公开内容。第 ${history.length+1} 页。`:`${notice}关注 ${r.followedCount} 位作者，${r.total} 条公开内容。第 ${history.length+1} 页。`;
   host.innerHTML=r.entries.map((e,i)=>{const p=e.item;let body;if(e.type==='tutorial')body=`<p class="small muted" data-feed-tutorial-version>方法版本 ${esc(p.version.slice(0,8))} · ${esc(p.target.title)}</p><details><summary>完整目标、方法与材料</summary><p class="pre">${esc(p.target.goal)}</p><p class="pre">${esc(p.method)}</p><p class="small pre">五分钟起步：${esc(p.startAction)}</p>${p.resources.map(reviewResourceLink).join('')}</details><button class="ghost" data-feed-open="${i}">查看目标与方法</button><button class="ghost" data-feed-discuss="${i}">讨论与提问</button><button class="ghost" data-feed-bookmark="${i}">收藏这个版本</button><a class="small" data-feed-tutorial-link href="${esc(reviewTutorialLink(p))}">教程链接</a>`;else if(e.type==='practice')body=`<p class="small muted">${p.lightUp?'作者本人自证':'公开行动记录'}</p><p class="pre">${esc(p.text)}</p>${reviewPracticeSnapshot(p)}${reviewPracticeLink(p)}${reviewPublicPracticeImages(p)}<button class="ghost" data-feed-open="${i}">查看当前目标与方法</button>`;else body=`<details><summary>完整目标顺序与来源</summary>${reviewPathBody(p)}</details><button class="ghost" data-feed-save="${i}">收藏这个版本</button><button class="ghost" data-feed-copy="${i}">复制为我的路径</button>${reviewPathLink(p)}${p.targets.map((t,j)=>`<button class="ghost" data-feed-target="${i}:${j}">查看目标 · ${esc(t.title)}</button>`).join('')}`;return `<article class="list-row"><p class="small muted">${{tutorial:'教程',practice:'实践',path:'路径'}[e.type]} · ${esc(dt(e.publishedAt))} · <button class="ghost" data-feed-author="${i}">${esc(e.authorName)}</button></p><h3>${esc(e.title)}</h3>${body}</article>`}).join('')||'<p class="muted">当前没有符合条件的'+label+'。</p>';
   const valid=b=>current()&&b.isConnected;host.querySelectorAll('[data-feed-author]').forEach(b=>b.onclick=()=>{if(valid(b)){const e=r.entries[Number(b.dataset.feedAuthor)];reviewGoPublicAuthor({id:e.authorId,name:e.authorName},context)}});host.querySelectorAll('[data-feed-open]').forEach(b=>b.onclick=()=>{if(valid(b)){const e=r.entries[Number(b.dataset.feedOpen)];if(e.type==='tutorial')reviewOpenSearchTarget(e.item,context,b,status,notice=>load('',[],notice));else reviewOpenPracticeTarget(e.item,context,b,status)}});host.querySelectorAll('[data-feed-bookmark]').forEach(b=>b.onclick=()=>{if(valid(b))reviewBookmarkTutorial(r.entries[Number(b.dataset.feedBookmark)].item,context,b,status,notice=>load('',[],notice))});host.querySelectorAll('[data-feed-discuss]').forEach(b=>b.onclick=()=>{if(valid(b))reviewOpenSearchTarget(r.entries[Number(b.dataset.feedDiscuss)].item,context,b,status,notice=>load('',[],notice),reviewOpenDiscussion)});host.querySelectorAll('[data-feed-save]').forEach(b=>b.onclick=()=>{if(valid(b))reviewBookmarkPublicPath(r.entries[Number(b.dataset.feedSave)].item,context,b,status)});host.querySelectorAll('[data-feed-copy]').forEach(b=>b.onclick=()=>{if(valid(b))reviewCopyPublicPath(r.entries[Number(b.dataset.feedCopy)].item,context,b,status)});host.querySelectorAll('[data-feed-target]').forEach(b=>b.onclick=()=>{if(valid(b)){const [i,j]=b.dataset.feedTarget.split(':').map(Number);reviewOpenServicePathTarget(r.entries[i].item,j,context)}});host.querySelectorAll('[data-practice-image]').forEach(img=>img.onerror=()=>{if(current()&&img.isConnected){img.hidden=true;img.style.display='none';img.closest('a').hidden=true;img.closest('figure').querySelector('figcaption').textContent='图片暂时无法读取，请重新读取。'}});
   if(scope==='following'&&r.followedCount===0){
    host.innerHTML='<p class="muted">关注作者后，这里会显示他们公开的教程、实践和路径。</p>';
    const discover=document.createElement('button');
    discover.type='button';
    discover.dataset.feedDiscover='true';
    discover.textContent='去发现公开内容';
    discover.onclick=()=>{if(current()&&discover.isConnected)navigate('discover')};
    host.append(discover);
   }else if(!r.total&&(query.trim()||kind!=='all')){
    const clear=document.createElement('button');
    clear.type='button';
    clear.dataset.feedClear='true';
    clear.textContent='清除筛选';
    clear.onclick=()=>{
     if(!current()||!clear.isConnected)return;
     form.elements.query.value='';
     form.elements.kind.value='all';
     form.elements.query.focus();
     void load();
    };
    host.append(clear);
   }
   if(history.length)addPageButton('上一页'+label,history.at(-1),history.slice(0,-1));
   if(r.nextCursor)addPageButton('下一页'+label,r.nextCursor,[...history,cursor]);
  }catch(e){
   if(current()){
    status.textContent=reviewIsNetworkError(e)?label+'读取未确认，请重试。':e.message;
    addPageButton('重试当前页',cursor,history);
    if(cursor)addPageButton('重新读取第一页');
   }
  }finally{if(current())form.querySelector('button').disabled=false}
 }
 function addPageButton(text,cursor='',history=[]){
  const button=document.createElement('button');
  button.type='button';
  button.textContent=text;
  button.onclick=()=>{
   status.tabIndex=-1;
   status.focus();
   void load(cursor,history);
  };
  host.append(button);
 }
 function edited(){if(!form.isConnected||!reviewContextCurrent(context))return;generation++;reviewStoreFeedView(scope,{query:form.elements.query.value,kind:form.elements.kind.value,order:form.elements.order.value,cursor:'',history:[],draft:true},context);host.innerHTML='';status.textContent='筛选已修改，点击读取最新内容。';form.querySelector('button').disabled=false}form.elements.query.oninput=edited;form.elements.kind.onchange=edited;form.elements.order.onchange=edited;form.onsubmit=e=>{e.preventDefault();load()};const initial=reviewFeedView(scope);if(initial?.draft){status.textContent='筛选已修改，点击读取最新内容。';return}await load(initial?.cursor||'',initial?.history||[]);
}
async function reviewToggleAuthorFollow(author,context,button,status){
 if(!reviewContextCurrent(context)||!button.isConnected||button.disabled)return;
 const removing=reviewFollowedAuthors().some(a=>a.id===author.id);if(!removing&&author.id===context.ownerId)return;button.disabled=true;let changed=false;
 try{
  let verified=author;if(!removing){const r=await reviewKnowledgeRequest('/api/review-public-tutorials/author?id='+encodeURIComponent(author.id),{context});if(!reviewContextCurrent(context)||!button.isConnected)return;if(r.ownerId!==context.ownerId||r.author?.id!==author.id||typeof r.author.name!=='string')throw Error('作者身份读取不一致，请重新核对。');verified=r.author}
  if(!reviewContextCurrent(context)||!button.isConnected)return;
  S.settings.followedAuthors=removing?reviewFollowedAuthors().filter(a=>a.id!==author.id):[...reviewFollowedAuthors(),{id:verified.id,name:verified.name,followedAt:Date.now()}];save();changed=true;button.textContent=removing?'关注作者':'取消关注';status.textContent='正在保存到本人账号…';await reviewFlush();if(!reviewContextCurrent(context)||!button.isConnected)return;status.textContent=removing?'已取消关注。':'已关注，关注列表仅自己可见。';
 }catch(e){if(reviewContextCurrent(context)&&button.isConnected)status.textContent=reviewIsNetworkError(e)?changed?'保存未确认，本机选择保留，请在同步提示中重试。':'作者读取未确认，尚未改变关注。':e.message}finally{if(button.isConnected&&reviewContextCurrent(context))button.disabled=false}
}
function reviewFollowedAuthorsPage(){queueMicrotask(()=>{reviewBindFollowedAuthors();reviewBindFollowingFeed()});return title('关注的作者','保存你想再次浏览的作者；关注列表仅自己可见。')+`<form id="followed-author-search" class="row"><input type="search" name="query" aria-label="搜索关注的作者" placeholder="按关注时的名称搜索"></form><p id="followed-author-status" class="small muted" role="status"></p><div id="followed-author-results"></div>${reviewFollowingFeedSection()}`}
function reviewBindFollowedAuthors(){const form=document.getElementById('followed-author-search');if(!form||form.dataset.bound||reviewAuthBusy||reviewAccountConnecting||!S.user?.reviewService)return;form.dataset.bound='true';const context=reviewContext(),host=document.getElementById('followed-author-results'),status=document.getElementById('followed-author-status');function draw(){if(!form.isConnected||!reviewContextCurrent(context))return;const query=form.elements.query.value.trim().normalize('NFKC').toLowerCase(),all=reviewFollowedAuthors(),rows=all.filter(a=>a.name.normalize('NFKC').toLowerCase().includes(query));status.textContent=`关注 ${all.length} 位作者，当前 ${rows.length} 位。`;host.innerHTML=rows.map((a,i)=>`<article class="list-row"><h2>${esc(a.name)}</h2><p class="small muted">关注于 ${esc(dt(a.followedAt))} · 关注时的名称</p><button class="ghost" data-followed-open="${i}">查看作者主页</button><button class="ghost" data-followed-remove="${i}">取消关注</button><p class="small muted" role="status"></p></article>`).join('')||'<p class="muted">当前没有符合条件的关注作者。</p>';host.querySelectorAll('[data-followed-open]').forEach(b=>b.onclick=()=>{if(form.isConnected&&reviewContextCurrent(context))reviewGoPublicAuthor(rows[Number(b.dataset.followedOpen)],context)});host.querySelectorAll('[data-followed-remove]').forEach(b=>b.onclick=async()=>{const a=rows[Number(b.dataset.followedRemove)];await reviewToggleAuthorFollow(a,context,b,b.parentElement.querySelector('[role="status"]'));if(form.isConnected&&reviewContextCurrent(context)){const pending=S.reviewSync?.pending;draw();document.getElementById('following-feed-form')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));if(pending)status.textContent+=' 本机选择保留，服务保存尚未确认。'}})}form.onsubmit=e=>e.preventDefault();form.elements.query.oninput=draw;draw()}
