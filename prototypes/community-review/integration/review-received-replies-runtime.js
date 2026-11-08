function reviewSetReceivedCount(button,count){
 button.textContent=count?`收到的回复 · ${count} 条未读`:'收到的回复';
}
function reviewUpdateReceivedCount(count){
 const button=document.querySelector('[data-action="review-received-replies"]');
 if(!button)return;
 button.dataset.countGeneration=String(Number(button.dataset.countGeneration||0)+1);
 reviewSetReceivedCount(button,count);
}
async function reviewRefreshReceivedCount(force=false){
 const button=document.querySelector('[data-action="review-received-replies"]'),context=reviewContext();
 if(!button||reviewAccountConnecting||!reviewContextCurrent(context)||!force&&button.dataset.countGeneration)return;
 const generation=String(Number(button.dataset.countGeneration||0)+1);
 button.dataset.countGeneration=generation;
 const current=()=>button.isConnected&&reviewContextCurrent(context)&&button.dataset.countGeneration===generation;
 try{
  const result=await reviewKnowledgeRequest('/api/review-received-replies/summary',{context});
  if(!current())return;
  if(result.ownerId!==context.ownerId||!Number.isSafeInteger(result.unreadCount)||result.unreadCount<0)throw Error('Invalid unread count');
  reviewSetReceivedCount(button,result.unreadCount);
 }catch{if(current())reviewSetReceivedCount(button,0)}
}
async function reviewMarkReceivedRead(receipt,context){
 if(!receipt.panel.isConnected||!receipt.focusedElement.isConnected||!reviewContextCurrent(context))return;const status=document.getElementById('discussion-status');
 try{const r=await reviewKnowledgeRequest('/api/review-received-replies/read',{context,body:{tutorialId:receipt.tutorialId,replyId:receipt.replyId,digest:receipt.digest}});if(!receipt.panel.isConnected||!receipt.focusedElement.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId||r.entry?.replyId!==receipt.replyId||r.entry.digest!==receipt.digest)throw Error('已读回执无法核对。');receipt.panel.querySelector('[data-reply-read-retry]')?.remove();void reviewRefreshReceivedCount(true);if(status)status.textContent=status.textContent.replace(/ · 已读记录未确认.*$/,'')+' · 对应回复已标记已读。'}
 catch(e){if(receipt.panel.isConnected&&receipt.focusedElement.isConnected&&reviewContextCurrent(context)){
  if(e.code==='REPLY_READ_UNAVAILABLE'||e.code==='REPLY_READ_CHANGED'){
   receipt.panel.replaceChildren();
   receipt.clearContext();
   if(status)status.textContent='对应回复已不可读取或状态已变化，请返回收到的回复重新查看。';
   return;
  }
  if(status)status.textContent=status.textContent.replace(/ · 已读记录未确认.*$/,'')+' · 已读记录未确认，可重试。';if(!receipt.panel.querySelector('[data-reply-read-retry]')){const retry=document.createElement('button');retry.type='button';retry.className='ghost';retry.dataset.replyReadRetry='true';retry.textContent='重试已读记录';retry.addEventListener('click',async()=>{if(retry.disabled)return;retry.disabled=true;await reviewMarkReceivedRead(receipt,context);retry.disabled=false});receipt.panel.prepend(retry)}}}
}
const reviewReceivedScopes=new Map();
async function reviewOpenReceivedReplies(){
 const context=reviewContext();const dialog=modal('<h2>收到的回复</h2><p class="small muted">这里只读取他人对你讨论的直接回复。显示公开可读的内容，不发送站外通知。</p><label class="field small">回复范围<select id="received-replies-scope" aria-label="回复范围"><option value="all">全部回复</option><option value="unread">只看未读</option></select></label><button type="button" id="received-replies-refresh" class="ghost">刷新回复</button><p id="received-replies-status" class="small muted" role="status"></p><div id="received-replies-results"></div>','discussion-dialog','收到的回复');const host=document.getElementById('received-replies-results'),status=document.getElementById('received-replies-status');const filter=document.getElementById('received-replies-scope');const refresh=document.getElementById('received-replies-refresh');const current=()=>dialog.open&&host.isConnected&&reviewContextCurrent(context);filter.value=reviewReceivedScopes.get(context.ownerId)||'all';let generation=0,selection=0;
 async function load(cursor='',fromNavigation=false){if(!current())return;const job=++generation,scope=filter.value;host.innerHTML='';refresh.disabled=true;status.textContent='正在读取回复…';try{const r=await reviewKnowledgeRequest('/api/review-received-replies'+(scope==='unread'?'?scope=unread':'')+(cursor?(scope==='unread'?'&':'?')+'cursor='+encodeURIComponent(cursor):''),{context});if(!current()||job!==generation)return;if(r.ownerId!==context.ownerId||r.scope!==scope||!Array.isArray(r.replies)||!Number.isSafeInteger(r.unreadCount)||r.unreadCount<0)throw Error('回复归属回执不一致。');reviewUpdateReceivedCount(r.unreadCount);status.textContent=`收到 ${r.total} 条可公开读取的回复，未读 ${r.unreadCount} 条，本页 ${r.replies.length} 条。${Number.isInteger(r.pageNumber)&&Number.isInteger(r.pageCount)?' 第 '+r.pageNumber+' / '+r.pageCount+' 页。':''}`;host.innerHTML=r.replies.map((e,i)=>`<article class="list-row" tabindex="-1"><h3>${esc(e.tutorialTitle)}</h3><p class="small muted">${e.unread?'未读':'已读'} · ${esc(e.authorName)} · ${dt(e.createdAt)} · 教程 ${esc(e.tutorialVersion.slice(0,8))}</p>${reviewDiscussionSource(e)}<p class="pre">${esc(e.text)}</p><details class="saved-notes"><summary>我当时的讨论</summary><p class="pre small">原发言关联教程版本：${esc(e.replyContext.tutorialVersion||'未记录版本')}</p><p class="pre small">${e.replyContext.withdrawn?'原讨论已撤回':esc(e.replyContext.text)}</p></details><button class="ghost" data-received-reply="${i}">查看对应讨论</button></article>`).join('')||(scope==='unread'?'<p class="small muted">没有未读回复。</p>':'<p class="small muted">暂无可公开读取的他人回复。</p>');if(scope==='unread'&&!r.total){
 const showAll=document.createElement('button');
 showAll.type='button';
 showAll.dataset.receivedShowAll='true';
 showAll.textContent='查看全部回复';
 showAll.onclick=()=>{
  if(!current()||!showAll.isConnected)return;
  filter.value='all';
  changeScope();
  filter.focus();
 };
 host.append(showAll);
}
host.querySelectorAll('[data-received-reply]').forEach(button=>button.addEventListener('click',async()=>{
 if(!current()||!button.isConnected||button.disabled)return;
 button.disabled=true;
 const selected=++selection,reply=r.replies[Number(button.dataset.receivedReply)];
 const stillSelected=()=>current()&&button.isConnected&&selection===selected;
 try{
  const result=await reviewKnowledgeRequest('/api/review-public-tutorials/one?id='+encodeURIComponent(reply.tutorialId),{context});
  if(!stillSelected())return;
  if(result.ownerId!==context.ownerId||result.tutorial?.id!==reply.tutorialId){
   status.textContent='回复关联的教程无法核对，请重试。';
   return;
  }
  await reviewOpenDiscussion(result.tutorial,reply.id,receipt=>reviewMarkReceivedRead(receipt,context),reviewOpenReceivedReplies);
 }catch(error){
  if(!stillSelected())return;
  if(error.code==='PUBLIC_TUTORIAL_UNAVAILABLE')await load('',true);
  else status.textContent=error.message;
 }finally{button.disabled=false}
}));
reviewDiscussionArchivePager(host,r,load,'回复');if(fromNavigation)reviewDiscussionArchivePosition(host,filter)}catch(e){if(current()&&job===generation){status.textContent=e.message;const retry=document.createElement('button');retry.textContent='重新读取回复';retry.type='button';retry.dataset.discussionArchiveRetry='true';retry.addEventListener('click',()=>{if(retry.isConnected&&reviewContextCurrent(context))load(e.code==='DISCUSSION_CURSOR_CHANGED'?'':cursor,true)});host.append(retry)}}finally{if(current()&&job===generation)refresh.disabled=false}}
 refresh.onclick=()=>{if(current())void load('',true)};
 function changeScope(){if(current()){reviewReceivedScopes.set(context.ownerId,filter.value);void load()}}
 filter.addEventListener('change',changeScope);await load();
}
