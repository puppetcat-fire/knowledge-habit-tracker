function reviewBindDiscussionAppeal(form,entry,context){
 const button=form.querySelector('button'),explanation=form.elements.namedItem('explanation'),status=form.querySelector('[role="status"]');
 const current=()=>form.isConnected&&reviewContextCurrent(context);
 const url='/api/review-tutorial-discussions/'+encodeURIComponent(entry.tutorialId)+'/'+encodeURIComponent(entry.id)+'/appeal';
 form.onsubmit=async event=>{
  event.preventDefault();
  if(!current()||button.disabled||!form.reportValidity())return;
  button.disabled=true;explanation.disabled=true;status.textContent='正在提交申诉…';
  let submitted=false;
  try{
   const result=await reviewKnowledgeRequest(url,{context,body:{explanation:explanation.value},headers:{'If-Match':entry.revision}});
   if(!current())return;
   if(result.ownerId!==context.ownerId||typeof result.appealId!=='string')throw Error('申诉回执无法核对。');
   submitted=true;status.textContent='申诉已提交。';
  }catch(error){
   if(!current())return;
   if(reviewIsNetworkError(error)||error.code==='DISCUSSION_APPEAL_UNCONFIRMED'){
    status.textContent='申诉回执未收到，正在核对…';
    try{
     const latest=await reviewKnowledgeRequest(url,{context});
     if(!current())return;
     submitted=latest.ownerId===context.ownerId&&latest.commentId===entry.id&&Boolean(latest.appeal);
    }catch{if(!current())return}
    status.textContent=submitted?'申诉已提交。':'申诉暂未确认，说明已保留，可以重试。';
    return;
   }
   submitted=error.code==='DISCUSSION_APPEAL_ALREADY_SUBMITTED';
   status.textContent=submitted?'这条发言已有申诉记录。':error.message;
  }finally{if(current()&&!submitted){button.disabled=false;explanation.disabled=false}}
 };
}
async function reviewOpenOwnedDiscussions(query=''){
 const context=reviewContext();modal(`<h2>我的讨论档案</h2><p class="small muted">这里仅显示本人发出的内容及当时版本，包括撤回后的本人原件。不会读取他人的私人内容。</p><form id="owned-discussion-search" class="row"><input name="query" type="search" maxlength="120" aria-label="搜索本人讨论" value="${esc(query)}" placeholder="内容、教程或目标"><button>搜索</button></form><p id="owned-discussion-status" class="small muted" role="status"></p><div id="owned-discussion-results"></div>`,'discussion-dialog','本人讨论档案');const form=document.getElementById('owned-discussion-search'),host=document.getElementById('owned-discussion-results'),status=document.getElementById('owned-discussion-status');let generation=0;
 async function load(cursor='',fromNavigation=false){if(!form.isConnected||!reviewContextCurrent(context))return;const job=++generation,q=form.elements.namedItem('query').value;form.querySelector('button').disabled=true;host.innerHTML='';status.textContent='正在读取本人讨论…';try{const r=await reviewKnowledgeRequest('/api/review-owned-discussions?query='+encodeURIComponent(q)+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});if(!host.isConnected||!reviewContextCurrent(context)||job!==generation)return;if(r.ownerId!==context.ownerId||!Array.isArray(r.entries))throw Error('本人讨论回执不一致。');status.textContent=`本人 ${r.total} 条讨论，本页 ${r.entries.length} 条。${Number.isInteger(r.pageNumber)&&Number.isInteger(r.pageCount)?' 第 '+r.pageNumber+' / '+r.pageCount+' 页。':''}`;host.innerHTML=r.entries.map((e,i)=>`<article class="list-row" tabindex="-1"><h3>${esc(e.tutorialSnapshot.title)}</h3><p class="small muted">${dt(e.createdAt)} · ${e.moderated?'已由审核处理':e.withdrawn?'已撤回公开':'原发布内容'} · 教程 ${esc(e.tutorialSnapshot.version.slice(0,8))}${e.parentId?' · 回复':''}</p><details class="saved-notes"><summary>查看本人原文与当时目标</summary><p class="pre">${esc(e.text)}</p><p class="pre small">当时目标：${esc(e.tutorialSnapshot.target.title||'未记录名称')}<br>完整目标：${esc(e.tutorialSnapshot.target.goal)}<br>目标版本：${esc(e.tutorialSnapshot.target.version||'未记录版本')}<br>教程版本：${esc(e.tutorialSnapshot.version)}</p>${e.publicAvailable===true?reviewTutorialVersionLink(e.tutorialSnapshot.target.treeId,e.tutorialSnapshot.target.nodeId??e.tutorialSnapshot.target.id,e.tutorialId,e.tutorialSnapshot.version):''}</details><p class="small muted">${e.publicAvailable===null?'当前公开范围暂时无法核对。':e.publicAvailable?e.currentVersionMatches?'教程当前仍可公开读取。':'教程已修订，本人的原版本记录保留。':'教程或目标当前不可公开读取，原记录保留。'}</p>${!e.moderated&&(!e.withdrawn||e.publicAvailable===true)?`<button class="ghost" data-owned-discussion-action="${i}">${e.withdrawn?(e.appeal?.status==='overturned'?'恢复公开发言':'恢复公开原记录'):'撤回公开'}</button>`:''}${e.appeal?`<p class="small muted">申诉状态：${e.appeal.status==='overturned'?'已解除公开限制':e.appeal.status==='upheld'?'已维持原处置':'待复核'}</p>${e.appeal.authorMessage?`<p class="pre small">${esc(e.appeal.authorMessage)}</p>`:''}`:e.moderated?`<details class="saved-notes"><summary>提交申诉</summary><form class="stack" data-discussion-appeal="${i}"><label class="field">复核说明<textarea name="explanation" required maxlength="1000"></textarea></label><button type="submit">提交申诉</button><p role="status"></p></form></details>`:''}</article>`).join('')||'<p class="small muted">没有符合条件的本人讨论。</p>';host.querySelectorAll('[data-discussion-appeal]').forEach(form=>reviewBindDiscussionAppeal(form,r.entries[Number(form.dataset.discussionAppeal)],context));host.querySelectorAll('[data-owned-discussion-action]').forEach(b=>b.addEventListener('click',async()=>{if(!b.isConnected||b.disabled)return;const e=r.entries[Number(b.dataset.ownedDiscussionAction)];b.disabled=true;try{await reviewKnowledgeRequest('/api/review-tutorial-discussions/'+encodeURIComponent(e.tutorialId)+'/'+encodeURIComponent(e.id)+'/'+(e.withdrawn?'restore':'withdraw'),{context,headers:{'If-Match':e.revision},body:{consent:true}});if(b.isConnected&&reviewContextCurrent(context))await load()}catch(error){if(b.isConnected&&reviewContextCurrent(context))status.textContent=error.message}finally{b.disabled=false}}));reviewDiscussionArchivePager(host,r,load,'本人讨论');if(fromNavigation)reviewDiscussionArchivePosition(host,form)}catch(e){if(host.isConnected&&reviewContextCurrent(context)&&job===generation){status.textContent=e.message;const retry=document.createElement('button');retry.textContent='重新读取本人讨论';retry.type='button';retry.dataset.discussionArchiveRetry='true';retry.addEventListener('click',()=>{if(retry.isConnected&&reviewContextCurrent(context))load(e.code==='DISCUSSION_CURSOR_CHANGED'?'':cursor,true)});host.append(retry)}}finally{if(job===generation)form.querySelector('button').disabled=false}}
 form.elements.namedItem('query').addEventListener('input',()=>{generation++;host.innerHTML='';status.textContent='搜索词已修改，点击搜索查看本人档案。';form.querySelector('button').disabled=false});form.addEventListener('submit',e=>{e.preventDefault();load()});await load();
}
