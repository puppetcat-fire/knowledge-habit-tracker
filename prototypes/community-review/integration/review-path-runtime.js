function reviewPathBody(v){return `<h3>${esc(v.title)}</h3>${v.sourcePath?`<p class="small muted">来源：${esc(v.sourcePath.authorName)} / ${esc(v.sourcePath.title)} · ${esc(v.sourcePath.version.slice(0,8))}</p>`:''}<ol>${v.targets.map(t=>`<li><strong>${esc(t.title)}</strong><p class="small pre">完整目标：${esc(t.goal)}</p><p class="small pre">五分钟起步：${esc(t.five)}</p><p class="small muted">${t.ownership==='group'?'公共节点 · 全部点亮者持有':'个人节点 · '+esc(t.ownerName)} · 目标 v${t.sourceVersion}</p></li>`).join('')}</ol>`}
function reviewPathFingerprint(p){return JSON.stringify({path:p,nodes:(p?.targetRefs?p.targetRefs.filter(r=>r.kind==='local').map(r=>r.nodeId):p?.nodes).map(id=>{const n=node(id);return n&&{id:n.id,title:n.title,goal:n.goal,five:n.five,version:n.version,domain:n.domain,branch:n.branch,ownership:n.ownership}})})}
async function reviewOpenPathSharing(id){
 const context=reviewContext(),p=S.paths.find(p=>p.id===id),fingerprint=p&&reviewPathFingerprint(p);modal('<h2>核对路径分享与历史</h2><p id="review-path-loading" role="status">正在读取本人路径服务…</p>','','路径分享');const loading=document.getElementById('review-path-loading');
 try{const r=await reviewKnowledgeRequest('/api/review-path-publications',{context});if(!loading.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId)throw Error('路径账号回执不一致。');const e=r.store.entries.find(e=>e.sourceId===id);if(!p&&!e)throw Error('本人路径不存在，原资料保留。');
  modal(`<h2>路径分享与历史</h2><p class="small muted">公开路径只包含名称和有版本的目标顺序，不包含你的收藏、行动或点亮进度。私人目标需先单独选择公开，不能随路径自动公开。</p>${p?`<section class="box"><h3>当前本人编排：${esc(p.title)}</h3><ol>${reviewCurrentPathTargets(p).map(n=>`<li>${esc(n.title||'目标不存在')}<p class="small pre">${esc(n.goal||'')}</p></li>`).join('')}</ol></section>`:''}${e?`<section class="box"><h3>服务状态：${e.visibility==='public'?'已公开分享':'已撤回公开'}</h3>${e.versions.map((v,i)=>`<details><summary>保存版本 ${i+1} · ${esc(dt(v.createdAt))}</summary>${reviewPathBody(v)}</details>`).join('')}</section>`:'<p class="small muted">这条路径尚未提交公开服务。</p>'}<form id="review-path-form"><label>操作<select name="action">${p&&!p.seed?'<option value="publish">公开当前路径版本</option>':''}${e?'<option value="withdraw">撤回服务公开路径</option>':''}</select></label><label class="check"><input name="consent" type="checkbox">我已核对目标顺序与归属，确认执行所选公开或撤回操作</label><button class="primary">确认提交到服务</button><p id="review-path-error" class="error" role="alert"></p></form>`,'','路径分享与历史');const f=document.getElementById('review-path-form');
  f.addEventListener('submit',async ev=>{ev.preventDefault();if(!f.isConnected||!reviewContextCurrent(context)||f.querySelector('button').disabled)return;const b=f.querySelector('button'),error=f.querySelector('#review-path-error');if(!f.elements.namedItem('consent').checked){error.textContent='请先明确确认所选分享或撤回操作。';return}b.disabled=true;try{const action=f.elements.namedItem('action').value;if(action==='publish'){await reviewFlush();if(!f.isConnected||!reviewContextCurrent(context))return;const current=S.paths.find(p=>p.id===id);if(!current||reviewPathFingerprint(current)!==fingerprint)throw Error('路径或目标在核对后有新编辑，请保留内容并重新核对。')}
   const saved=await reviewKnowledgeRequest('/api/review-path-publications',{context,headers:{'If-Match':reviewClient.snapshot().revision,'If-Path-Match':r.revision},body:{pathId:id,action,consent:true}});if(!f.isConnected||!reviewContextCurrent(context))return;if(saved.ownerId!==context.ownerId)throw Error('路径保存回执不一致。');await reviewOpenPathSharing(id);
  }catch(e){if(f.isConnected&&reviewContextCurrent(context))error.textContent=reviewIsNetworkError(e)?'连接未确认，路径内容保留，请重新核对后重试。':e.message}finally{b.disabled=false}});
 }catch(e){if(loading.isConnected&&reviewContextCurrent(context))loading.textContent=reviewIsNetworkError(e)?'路径读取未确认，请重新打开核对。':e.message}
}
async function reviewOpenOwnedPaths(){const context=reviewContext();modal('<h2>我的路径分享与历史</h2><div id="owned-path-results" role="status">正在读取本人服务路径…</div>','','本人路径历史');const host=document.getElementById('owned-path-results');try{const r=await reviewKnowledgeRequest('/api/review-path-publications',{context});if(!host.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId)throw Error('路径账号回执不一致。');host.innerHTML=r.store.entries.map((e,i)=>`<article class="list-row"><h3>${esc(e.versions.at(-1).title)}</h3><p class="small muted">${e.visibility==='public'?'已选择服务公开':'已撤回公开'} · ${e.versions.length} 次保存</p><button data-owned-path="${i}" class="ghost">核对分享与全部历史</button></article>`).join('')||'<p>尚未提交公开路径，已有私人编排仍在本人路径页面。</p>';host.querySelectorAll('[data-owned-path]').forEach(b=>b.addEventListener('click',()=>{if(b.isConnected&&reviewContextCurrent(context))reviewOpenPathSharing(r.store.entries[Number(b.dataset.ownedPath)].sourceId)}))}catch(e){if(host.isConnected&&reviewContextCurrent(context))host.textContent=e.message}}
async function reviewOpenPublicPaths(query='',author=null){const context=reviewContext();modal(`<h2>${author?esc(author.name)+'的公开路径':'服务公开知识路径'}</h2>${author?'<section class="box"><button id="public-path-author-home" class="ghost">查看作者主页</button><button id="public-path-author-details" class="ghost">查看作者介绍与公开教程</button><button id="public-path-author-clear" class="ghost">浏览全部作者</button></section>':''}<p class="small muted">路径是目标顺序建议，节点仍按公共或个人归属持有；不会复制作者的实践或掌握进度。</p><form id="public-path-form" class="row"><input name="query" type="search" maxlength="120" value="${esc(query)}" aria-label="搜索公开路径" placeholder="路径、目标或作者"><button>搜索</button></form><p id="public-path-status" role="status" class="small muted"></p><div id="public-path-results"></div>`,'','公开知识路径');const f=document.getElementById('public-path-form'),host=document.getElementById('public-path-results'),status=document.getElementById('public-path-status');let generation=0;document.getElementById('public-path-author-home')?.addEventListener('click',()=>{if(f.isConnected)reviewGoPublicAuthor(author,context)});document.getElementById('public-path-author-clear')?.addEventListener('click',()=>{if(f.isConnected&&reviewContextCurrent(context))reviewOpenPublicPaths(f.elements.namedItem('query').value)});document.getElementById('public-path-author-details')?.addEventListener('click',ev=>reviewOpenPublicAuthor({authorId:author.id},context,ev.currentTarget,status));async function load(cursor=''){if(!f.isConnected||!reviewContextCurrent(context))return;const g=++generation;host.innerHTML='';f.querySelector('button').disabled=true;status.textContent='正在读取服务公开路径…';try{const r=await reviewKnowledgeRequest('/api/review-public-paths?query='+encodeURIComponent(f.elements.namedItem('query').value)+(author?'&authorId='+encodeURIComponent(author.id):'')+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});if(!host.isConnected||!reviewContextCurrent(context)||g!==generation)return;if(r.ownerId!==context.ownerId||r.authorId!==(author?.id||'')||!Array.isArray(r.paths))throw Error('路径目录回执不一致。');status.textContent=`找到 ${r.total} 条服务公开路径。`;host.innerHTML=r.paths.map((p,i)=>`<article class="list-row"><h3>${esc(p.title)}</h3><p class="small muted"><button class="ghost" data-public-path-author="${i}" aria-label="查看路径作者：${esc(p.authorName)}">${esc(p.authorName)}</button> · ${esc(dt(p.createdAt))}</p><details><summary>查看完整目标顺序与起步</summary>${reviewPathBody(p)}</details><button class="ghost" data-public-path-copy="${i}">复制为我的路径</button><button class="ghost" data-public-path-save="${i}">收藏这个版本</button>${reviewPathLink(p)}<div class="row">${p.targets.map((t,j)=>`<button class="ghost" data-public-path-target="${i}:${j}">查看目标 · ${esc(t.title)}</button>`).join('')}</div></article>`).join('')||'<p class="small muted">当前没有符合搜索的可公开路径。</p>';host.querySelectorAll('[data-public-path-author]').forEach(b=>b.addEventListener('click',()=>{if(b.isConnected&&reviewContextCurrent(context)){const p=r.paths[Number(b.dataset.publicPathAuthor)];reviewOpenPublicPaths('',{id:p.authorId,name:p.authorName})}}));host.querySelectorAll('[data-public-path-copy]').forEach(b=>b.addEventListener('click',()=>reviewCopyPublicPath(r.paths[Number(b.dataset.publicPathCopy)],context,b,status)));host.querySelectorAll('[data-public-path-save]').forEach(b=>b.addEventListener('click',()=>reviewBookmarkPublicPath(r.paths[Number(b.dataset.publicPathSave)],context,b,status)));host.querySelectorAll('[data-public-path-target]').forEach(b=>b.addEventListener('click',()=>{if(!b.isConnected||!reviewContextCurrent(context))return;const [i,j]=b.dataset.publicPathTarget.split(':').map(Number);reviewOpenServicePathTarget(r.paths[i],j,context)}));if(r.nextCursor){const next=document.createElement('button');next.textContent='下一页公开路径';next.addEventListener('click',()=>load(r.nextCursor));host.append(next)}}catch(e){if(host.isConnected&&reviewContextCurrent(context)&&g===generation){status.textContent=e.message;host.innerHTML='<button id="public-path-retry">重新读取第一页</button>';host.querySelector('button').addEventListener('click',()=>load())}}finally{if(g===generation)f.querySelector('button').disabled=false}}f.elements.namedItem('query').addEventListener('input',()=>{if(!f.isConnected||!reviewContextCurrent(context))return;generation++;host.innerHTML='';f.querySelector('button').disabled=false;status.textContent='搜索词已修改，点击搜索查看结果。'});f.addEventListener('submit',ev=>{ev.preventDefault();load()});await load()}
let reviewPendingPathLink=new URLSearchParams(location.search).getAll('path');
function reviewPathUrl(path){
 const url=new URL(location.pathname,location.origin);
 url.searchParams.set('path',path.id);
 url.searchParams.set('pathVersion',path.version);
 return url.href;
}
function reviewPathLink(path){
 return `<a class="small" data-path-link href="${esc(reviewPathUrl(path))}">路径链接</a>`;
}
function reviewApplyPathLink(){
 if(!reviewPendingPathLink.length||reviewAuthBusy||reviewAccountConnecting||!reviewReady||!S.user?.reviewService)return;
 const ids=reviewPendingPathLink;
 reviewPendingPathLink=[];
 const versions=new URLSearchParams(location.search).getAll('pathVersion');
 if(ids.length!==1||!/^path-[a-f0-9]{32}$/.test(ids[0])||versions.length!==1||!/^[a-f0-9]{64}$/.test(versions[0])){
  toast('路径链接无效。');
  return;
 }
 void reviewOpenPathLink(ids[0],versions[0],reviewContext());
}
async function reviewOpenPathLink(id,version,context){
 const dialog=modal('<h2>公开知识路径</h2><p id="linked-path-status" role="status">正在核对公开路径…</p><div id="linked-path-content"></div><button type="button" id="linked-path-retry" hidden>重新读取路径</button>','','公开路径链接');
 const host=document.getElementById('linked-path-content'),status=document.getElementById('linked-path-status');
 const retry=document.getElementById('linked-path-retry');
 const current=()=>dialog.open&&host.isConnected&&reviewContextCurrent(context);
 async function load(){
 if(!current())return;
 retry.hidden=true;
 status.textContent='正在核对公开路径…';
 try{
  const result=await reviewKnowledgeRequest('/api/review-public-paths/one?id='+encodeURIComponent(id),{context});
  if(!current())return;
  const path=result.path;
  if(result.ownerId!==context.ownerId||path?.id!==id)throw Error('路径回执不一致，请重新打开链接。');
  if(path.version!==version){
   status.textContent='作者已修订这条路径。';
   host.innerHTML=reviewPathLink(path);
   host.querySelector('a').textContent='打开当前公开版本';
   return;
  }
  status.textContent='';
  host.innerHTML=`<button type="button" class="ghost" data-linked-path-author>${esc(path.authorName)}</button>${reviewPathBody(path)}<button type="button" class="ghost" data-linked-path-save>收藏这个版本</button><button type="button" class="ghost" data-linked-path-copy>复制为我的路径</button><div class="row">${path.targets.map((target,index)=>`<button type="button" class="ghost" data-linked-path-target="${index}">查看目标 · ${esc(target.title)}</button>`).join('')}</div>`;
  host.querySelector('[data-linked-path-author]').onclick=()=>{if(current())reviewGoPublicAuthor({id:path.authorId,name:path.authorName},context)};
  host.querySelector('[data-linked-path-save]').onclick=e=>reviewBookmarkPublicPath(path,context,e.currentTarget,status);
  host.querySelector('[data-linked-path-copy]').onclick=e=>reviewCopyPublicPath(path,context,e.currentTarget,status);
  host.querySelectorAll('[data-linked-path-target]').forEach(button=>{
   button.onclick=()=>{if(current())reviewOpenServicePathTarget(path,Number(button.dataset.linkedPathTarget),context)};
  });
  reviewAppendShareCopy(host,reviewPathUrl(path),{
   label:'复制路径链接',fieldLabel:'当前版本路径链接',success:'已复制路径链接。',current
  });
 }catch(error){
  if(!current())return;
  const retryable=reviewIsNetworkError(error)||error.code==='PATH_STORE_UNREADABLE';
  status.textContent=retryable?'暂时无法读取公开路径，请重试。':error.message;
  retry.hidden=!retryable;
  if(retryable)retry.focus();
 }
 }
 retry.onclick=()=>void load();
 await load();
}
