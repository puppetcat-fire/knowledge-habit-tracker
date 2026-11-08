const reviewDiscussionMemoryDrafts=new Map();
function reviewDiscussionArchivePager(host,result,load,label){
 if(!result.previousCursor&&!result.nextCursor)return;
 const nav=document.createElement('nav');nav.className='row';nav.setAttribute('aria-label',label+'分页');
 function control(text,cursor){const b=document.createElement('button');b.type='button';b.className='ghost';b.textContent=text;b.onclick=()=>{if(b.isConnected&&host.isConnected)load(cursor,true)};nav.append(b)}
 if(result.previousCursor){control('回到第一页'+label,'');control('上一页'+label,result.previousCursor)}
 if(result.nextCursor)control('下一页'+label,result.nextCursor);host.append(nav);
}
function reviewDiscussionArchivePosition(host,control){if(control?.contains(document.activeElement))return;host.querySelector('article')?.focus({preventScroll:true});const panel=host.closest('dialog');if(panel)panel.scrollTop=0}
function reviewDiscussionAuthor(c){
 const name=esc(c.authorName);
 return !c.withdrawn&&/^[A-Za-z0-9_-]{1,64}$/.test(c.authorId||'')
  ? `<a data-discussion-author href="/knowledge/#person/${c.authorId}">${name}</a>`
  : name;
}
function reviewTutorialVersionLink(treeId,nodeId,tutorialId,version,label='打开当时的教程版本'){
 const parts=[treeId,nodeId,tutorialId,version];
 return parts.every(value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value))
  ? `<a href="/platform/#node/${treeId}/${nodeId}/tutorial/${tutorialId}/${version}" target="_blank" rel="noopener">${esc(label)}（新标签页）</a>`
  : '';
}
function reviewDiscussionSource(c,t=null){
 const methodChanged=!!t&&c.tutorialVersion!==t.version,targetChanged=!!t&&typeof c.targetVersion==='string'&&c.targetVersion!==t.target.version;
 const label=methodChanged&&targetChanged?'教程与目标已有更新':methodChanged?'教程已有更新':targetChanged?'目标已有更新':'';
 const sourceLink=c.withdrawn?'':reviewTutorialVersionLink(t?.treeId??c.treeId,t?.nodeId??c.nodeId,t?.id??c.tutorialId,c.tutorialVersion);
 return `${label?`<p class="small muted" data-discussion-source-change>${label}，这条发言保留当时的版本关联。</p>`:''}<details class="saved-notes" data-discussion-source><summary>查看发言时的教程与目标</summary><p class="pre small">当时教程：${esc(c.tutorialTitle||'未记录名称')}<br>版本：${esc(c.tutorialVersion)}</p><p class="pre small">当时目标：${esc(c.targetTitle||'未记录名称')}<br>版本：${esc(c.targetVersion||'未记录版本')}</p>${sourceLink}${label?'<p class="small muted">继续讨论前，可先核对当前教程和目标。</p>':''}</details>`;
}
function reviewReadDiscussionDraft(key,ownerId){
 const candidates=[localStorage.getItem(key),sessionStorage.getItem(key),reviewDiscussionMemoryDrafts.get(key)].filter(raw=>raw!==null&&raw!==undefined).map(raw=>{const value=JSON.parse(raw);if(!value||Object.keys(value).some(k=>!['ownerId','text','parentId','requestId','updatedAt','tutorialVersion'].includes(k))||value.ownerId!==ownerId||typeof value.text!=='string'||value.text.length>3000||value.parentId!==null&&typeof value.parentId!=='string'||typeof value.requestId!=='string'||value.updatedAt!==undefined&&!Number.isFinite(value.updatedAt)||value.tutorialVersion!==undefined&&(!/^[a-f0-9]{64}$/.test(value.tutorialVersion)))throw Error('Invalid discussion draft');return value});
 return candidates.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0]||null;
}
function reviewStoreDiscussionDraft(key,draft){const raw=JSON.stringify(draft);reviewDiscussionMemoryDrafts.set(key,raw);try{localStorage.setItem(key,raw);return 'local'}catch{try{sessionStorage.setItem(key,raw);return 'session'}catch{return 'memory'}}}
function reviewClearDiscussionDraft(key,requestId){for(const storage of [localStorage,sessionStorage]){const raw=storage.getItem(key);if(raw){try{if(JSON.parse(raw).requestId===requestId)storage.removeItem(key)}catch{}}}const raw=reviewDiscussionMemoryDrafts.get(key);if(raw&&JSON.parse(raw).requestId===requestId)reviewDiscussionMemoryDrafts.delete(key)}
const reviewModerationPath='/api/review-tutorial-discussions/moderation';
const reviewReportReasons={spam:'垃圾信息',harassment:'骚扰或攻击',other:'其他'};
async function reviewOpenMyDiscussionReports(cursor='',fromNavigation=false,scope='all',onBack=null){
 const context=reviewContext();
 const dialog=modal('<h2>我的举报</h2><label class="field">处理状态<select id="my-discussion-reports-scope"><option value="all">全部</option><option value="pending">待处理</option><option value="processed">已处理</option></select></label><p id="my-discussion-reports-status" role="status">正在读取举报…</p><div id="my-discussion-reports"></div><button type="button" id="my-discussion-reports-refresh" class="ghost" disabled>刷新举报状态</button>','discussion-dialog','我的举报');
 const host=document.getElementById('my-discussion-reports'),status=document.getElementById('my-discussion-reports-status');
 const refresh=document.getElementById('my-discussion-reports-refresh');
 const current=()=>dialog.open&&host.isConnected&&reviewContextCurrent(context);
 const select=document.getElementById('my-discussion-reports-scope');
 if(onBack){
  const back=document.createElement('button');
  back.type='button';
  back.className='ghost';
  back.textContent='返回教程讨论';
  back.onclick=()=>{if(current())onBack()};
  select.closest('label').before(back);
 }
 select.value=scope;
 select.onchange=()=>{if(current())void reviewOpenMyDiscussionReports('',false,select.value,onBack)};
 refresh.onclick=()=>{if(current())void reviewOpenMyDiscussionReports('',true,scope,onBack)};
 try{
  const result=await reviewKnowledgeRequest('/api/review-tutorial-discussions/reports/mine?status='+encodeURIComponent(scope)+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});
  if(!current())return;
  if(result.ownerId!==context.ownerId||result.scope!==scope||!Array.isArray(result.reports))throw Error('举报档案归属或筛选状态无法核对。');
  const labels={pending:'待处理',dismissed:'已驳回',substantiated:'举报成立'};
  const empty={all:'暂无已提交的举报。',pending:'暂无待处理的举报。',processed:'暂无已处理的举报。'};
  status.textContent=result.reports.length?`共 ${result.total} 条举报。第 ${result.pageNumber} / ${result.pageCount} 页。`:empty[scope];
  host.innerHTML=result.reports.map(report=>`<article class="list-row" tabindex="-1"><h3>${esc(report.tutorialTitle||'教程讨论')}</h3><p>${esc(reviewReportReasons[report.reason]||'其他')} · ${esc(report.restrictionLiftedAt?'初审举报成立 · 复核后解除限制':labels[report.status]||'状态待核对')}</p><p class="small muted">提交于 ${esc(dt(report.createdAt))}${report.decidedAt?' · 初审于 '+esc(dt(report.decidedAt)):''}</p>${report.restrictionLiftedAt?`<p class="small muted" data-report-review-date>复核解除限制于 ${esc(dt(report.restrictionLiftedAt))}</p>`:''}</article>`).join('');
  reviewDiscussionArchivePager(host,result,(next,navigation)=>reviewOpenMyDiscussionReports(next,navigation,scope,onBack),'举报');
  refresh.disabled=false;
  if(fromNavigation)reviewDiscussionArchivePosition(host,null);
 }catch(error){
  if(!current())return;
  status.textContent=error.message;
  const changed=error.code==='DISCUSSION_CURSOR_CHANGED',retry=document.createElement('button');
  retry.type='button';retry.textContent=changed?'重新读取第一页':'重新读取举报';
  retry.onclick=()=>{if(current())reviewOpenMyDiscussionReports(changed?'':cursor,true,scope,onBack)};
  host.append(retry);
 }
}
async function reviewBindModerationEntry(){
 const entry=document.getElementById('discussion-moderation-entry'),context=reviewContext();
 if(!entry||entry.dataset.bound||!reviewContextCurrent(context))return;
 entry.dataset.bound='true';
 try{
  const result=await reviewKnowledgeRequest(reviewModerationPath+'/access',{context});
  if(!entry.isConnected||!reviewContextCurrent(context)||result.ownerId!==context.ownerId||result.allowed!==true)return;
  const button=document.createElement('button');
  button.type='button';button.className='ghost';button.textContent='讨论举报审核';
  button.onclick=()=>{if(entry.isConnected&&reviewContextCurrent(context))reviewOpenModeration(context)};
  const appeals=document.createElement('button');
  appeals.type='button';appeals.className='ghost';appeals.textContent='讨论申诉复核';
  appeals.onclick=()=>{if(entry.isConnected&&reviewContextCurrent(context))reviewOpenAppealModeration(context)};
  entry.append(button,appeals);entry.hidden=false;
 }catch{delete entry.dataset.bound}
}
async function reviewOpenAppealModeration(context,cursor='',drafts=new Map(),scope='pending',focusFilter=false){
 modal('<h2>讨论申诉复核</h2><p class="small muted">解除限制后，作者可自行恢复公开。</p><label class="field">复核状态<select id="discussion-appeal-scope"><option value="pending">待复核</option><option value="processed">已复核</option><option value="all">全部</option></select></label><p id="discussion-appeal-status" role="status">正在读取申诉…</p><div id="discussion-moderation-results"></div>','discussion-dialog','讨论申诉复核');
 const host=document.getElementById('discussion-moderation-results'),status=document.getElementById('discussion-appeal-status');
 const current=()=>host.isConnected&&reviewContextCurrent(context),url=reviewModerationPath+'/appeals';
 const filter=document.getElementById('discussion-appeal-scope');
 filter.value=scope;
 filter.onchange=()=>{if(current())reviewOpenAppealModeration(context,'',drafts,filter.value,true)};
 if(focusFilter)filter.focus();
 const verdict=decision=>decision.outcome==='overturned'?'已解除公开限制':'已维持原处置';
 try{
  const result=await reviewKnowledgeRequest(url+'?status='+encodeURIComponent(scope)+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});
  if(!current())return;
  if(result.ownerId!==context.ownerId||result.status!==scope||!Array.isArray(result.appeals))throw Error('申诉队列归属无法核对。');
  status.textContent=result.total?`共 ${result.total} 条申诉。第 ${result.pageNumber} / ${result.pageCount} 页。`:'当前范围暂无申诉。';
  host.innerHTML=result.appeals.map((a,index)=>`<article class="list-row"><h3>${esc(a.original?.tutorialTitle||'教程讨论')}</h3><p class="small muted">作者申诉</p><p class="pre">${esc(a.explanation)}</p><details><summary>查看原发言与处置说明</summary><p class="pre">${esc(a.original?.text||'原发言暂不可读取')}</p><p class="pre">${esc(a.originalDecision?.note||'原处置说明暂不可读取')}</p></details>${a.decision?`<p>${verdict(a.decision)}</p><p class="pre">${esc(a.decision.note)}</p>${a.decision.authorMessage?`<p class="small muted">给作者的说明</p><p class="pre">${esc(a.decision.authorMessage)}</p>`:''}`:`<form class="stack" data-review-appeal="${index}"><label class="field">复核结论<select name="outcome" required><option value="">选择结论</option><option value="upheld">维持原处置</option><option value="overturned">解除公开限制</option></select></label><label class="field">内部复核说明<textarea name="note" required maxlength="1000"></textarea></label><label class="field">给作者的说明（选填）<textarea name="authorMessage" maxlength="1000"></textarea></label><button type="submit">记录复核结果</button><p role="status"></p></form>`}</article>`).join('');
  host.querySelectorAll('[data-review-appeal]').forEach(form=>{
   const a=result.appeals[Number(form.dataset.reviewAppeal)],button=form.querySelector('button'),feedback=form.querySelector('[role="status"]');
   const draft=drafts.get(a.id);
   if(draft)for(const [name,value] of Object.entries(draft))form.elements[name].value=value;
   const readDraft=()=>({outcome:form.elements.outcome.value,note:form.elements.note.value,authorMessage:form.elements.authorMessage.value});
   const endpoint=url+'/'+encodeURIComponent(a.id);
   const showDecision=decision=>{
    drafts.delete(a.id);
    const summary=document.createElement('p');summary.textContent=verdict(decision);
    form.replaceWith(summary);
   };
   form.oninput=()=>drafts.set(a.id,readDraft());
   form.onsubmit=async event=>{
    event.preventDefault();
    if(!current()||button.disabled||!form.reportValidity())return;
    const body=readDraft();
    drafts.set(a.id,body);
    const fields=[...form.elements];fields.forEach(field=>field.disabled=true);
    feedback.textContent='正在提交复核结果…';
    try{
     const saved=await reviewKnowledgeRequest(endpoint,{context,body,headers:{'If-Match':a.revision}});
     if(!current())return;
     if(saved.appeal?.id!==a.id||saved.appeal.decision?.outcome!==body.outcome)throw Error('复核回执无法核对。');
     showDecision(saved.appeal.decision);
    }catch(error){
     if(!current())return;
     if(error.code==='DISCUSSION_APPEAL_CHANGED'){reviewOpenAppealModeration(context,'',drafts,'all');return}
     if(reviewIsNetworkError(error)){
      feedback.textContent='复核回执未收到，正在核对当前结论…';
      try{
       const latest=await reviewKnowledgeRequest(endpoint,{context});
       if(!current())return;
       if(latest.ownerId===context.ownerId&&latest.appeal?.id===a.id&&latest.appeal.decision){
        showDecision(latest.appeal.decision);
        return;
       }
      }catch{if(!current())return}
      feedback.textContent='复核结论未确认，说明已保留，可以重试。';
     }else feedback.textContent=error.message;
     fields.forEach(field=>field.disabled=false);
    }
   };
  });
  reviewDiscussionArchivePager(host,result,next=>reviewOpenAppealModeration(context,next,drafts,scope),'申诉');
 }catch(error){
  if(!current())return;
  status.textContent=error.message;
  const retry=document.createElement('button');retry.type='button';retry.textContent='重新读取申诉';
  retry.onclick=()=>{if(current())reviewOpenAppealModeration(context,error.code==='DISCUSSION_CURSOR_CHANGED'?'':cursor,drafts,scope)};
  host.append(retry);
 }
}
async function reviewOpenModeration(context,scope='pending',focusFilter=false,cursor='',drafts=new Map()){
 modal('<h2>讨论举报审核</h2><p class="small muted">确认成立会隐藏公开发言和引用。处理结论仅审核员可见。</p><label class="field">处理状态<select id="discussion-moderation-scope"><option value="pending">待处理</option><option value="processed">已处理</option><option value="all">全部</option></select></label><p id="discussion-moderation-status" role="status"></p><div id="discussion-moderation-results"></div>','discussion-dialog','讨论举报审核');
 const status=document.getElementById('discussion-moderation-status'),host=document.getElementById('discussion-moderation-results');
 const filter=document.getElementById('discussion-moderation-scope');
 const current=()=>host.isConnected&&reviewContextCurrent(context);
 filter.value=scope;
 filter.onchange=()=>{if(current())reviewOpenModeration(context,filter.value,true,'',drafts)};
 if(focusFilter)filter.focus();
 status.textContent='正在读取举报…';
 try{
  const result=await reviewKnowledgeRequest(reviewModerationPath+'/reports?status='+encodeURIComponent(scope)+(cursor?'&cursor='+encodeURIComponent(cursor):''),{context});
  if(!current())return;
  if(result.ownerId!==context.ownerId||result.status!==scope||!Array.isArray(result.reports))throw Error('举报列表回执无法核对。');
  status.textContent=result.reports.length?`共 ${result.total} 条举报。第 ${result.pageNumber} / ${result.pageCount} 页。`:'当前范围暂无举报。';
  host.innerHTML=result.reports.map((report,index)=>`<article class="list-row"><h3>${esc(reviewReportReasons[report.reason]||'其他')}</h3><p class="small muted">${esc(dt(report.createdAt))} · 教程版本 ${esc(report.evidence.tutorialVersion)}</p><p class="pre">${esc(report.evidence.text)}</p>${report.details?`<p class="small muted">举报补充说明</p><p class="pre">${esc(report.details)}</p>`:''}${report.decision?`<p>${report.decision.outcome==='substantiated'?'举报成立':'已驳回'}</p><p class="pre">${esc(report.decision.note)}</p>`:`<form class="stack" data-moderation-report="${index}"><label class="field">结论<select name="outcome" required><option value="">选择结论</option><option value="substantiated">确认成立并隐藏</option><option value="dismissed">驳回举报</option></select></label><label class="field">处理说明<textarea name="note" required maxlength="1000"></textarea></label><button type="submit">记录结论</button><p role="status"></p></form>`}</article>`).join('');
  host.querySelectorAll('[data-moderation-report]').forEach(form=>{
   const report=result.reports[Number(form.dataset.moderationReport)],button=form.querySelector('button'),feedback=form.querySelector('[role="status"]');
   const draft=drafts.get(report.id);
   if(draft){form.elements.outcome.value=draft.outcome;form.elements.note.value=draft.note}
   form.oninput=()=>drafts.set(report.id,{outcome:form.elements.outcome.value,note:form.elements.note.value});
   const endpoint=reviewModerationPath+'/reports/'+encodeURIComponent(report.id);
   async function readDecision(){
    const latest=await reviewKnowledgeRequest(endpoint,{context});
    if(!current())return;
    if(latest.report?.id!==report.id)throw Error('当前处理结论无法核对，请重新读取队列。');
    if(!latest.report.decision)return false;
    const decision=latest.report.decision,summary=document.createElement('p'),note=document.createElement('p');
    summary.textContent=decision.outcome==='substantiated'?'已有审核结论：举报成立。':'已有审核结论：已驳回。';
    note.className='pre';note.textContent=decision.note;
    drafts.delete(report.id);form.replaceWith(summary,note);
    return true;
   }
   form.onsubmit=async event=>{
    event.preventDefault();
    if(!current()||button.disabled||!form.reportValidity())return;
    const body={outcome:form.elements.outcome.value,note:form.elements.note.value};
    const fields=[...form.elements];fields.forEach(field=>field.disabled=true);
    try{
     const saved=await reviewKnowledgeRequest(endpoint,{context,body,headers:{'If-Match':report.revision}});
     if(!current())return;
     if(saved.report?.id!==report.id||saved.report.decision?.outcome!==body.outcome)throw Error('处理回执无法核对。');
     drafts.delete(report.id);
     form.replaceWith(Object.assign(document.createElement('p'),{textContent:body.outcome==='substantiated'?'举报成立，已隐藏公开发言。':'已驳回举报。'}));
    }catch(error){
     if(!current())return;
     const lostReceipt=reviewIsNetworkError(error);
     if(error.code!=='DISCUSSION_REPORT_CHANGED'&&!lostReceipt){
      feedback.textContent=error.message;fields.forEach(field=>field.disabled=false);return;
     }
     feedback.textContent=lostReceipt?'提交回执未收到，正在核对当前结论…':'举报记录已变化，正在核对当前结论…';
     try{
      if(await readDecision()||!current())return;
      feedback.textContent='尚未读到已保存的结论。当前输入已保留，可以重试。';
      fields.forEach(field=>field.disabled=false);
     }catch{
      if(!current())return;
      feedback.textContent='处理结论读取未确认，请重新读取当前队列。';
      const reload=document.createElement('button');reload.type='button';reload.textContent='重新读取审核队列';
      reload.onclick=()=>{if(current())reviewOpenModeration(context,scope,true,'',drafts)};
      feedback.after(reload);
     }
    }
   };
  });
  reviewDiscussionArchivePager(host,result,next=>reviewOpenModeration(context,scope,true,next,drafts),'举报');
 }catch(error){
  if(!current())return;
  status.textContent=error.message;
  const changed=error.code==='DISCUSSION_CURSOR_CHANGED';
  const retry=document.createElement('button');
  retry.type='button';retry.textContent=changed?'重新读取第一页':'重新读取举报';
  retry.onclick=()=>{if(current())reviewOpenModeration(context,scope,true,changed?'':cursor,drafts)};
  host.append(retry);
 }
}
function reviewDiscussionHelpfulMarkup(comment,index){
 if(!comment.helpful)return '';
 const label='有帮助 '+comment.helpful.count;
 return comment.mine?`<span class="small muted">${label}</span>`:`<button type="button" class="ghost" data-discussion-helpful="${index}" aria-pressed="${comment.helpful.selected}">${label}</button><span class="small muted" role="status"></span>`;
}
function reviewBindDiscussionHelpful(button,tutorial,comment,context,onUnavailable,onConfirmed){
 const status=button.nextElementSibling;
 button.onclick=async()=>{
  const current=()=>button.isConnected&&reviewContextCurrent(context);
  if(button.disabled||!current())return;
  button.disabled=true;status.textContent='';
  const selected=button.getAttribute('aria-pressed')!=='true';
  try{
   const url='/api/review-tutorial-discussions/'+encodeURIComponent(tutorial.id)+'/'+encodeURIComponent(comment.id)+'/helpful';
   const result=await reviewKnowledgeRequest(url,{context,body:{selected}});
   if(!current())return;
   if(result.ownerId!==context.ownerId||result.commentId!==comment.id||result.helpful?.selected!==selected||!Number.isSafeInteger(result.helpful.count)||result.helpful.count<0)throw Error('反馈回执无法核对。');
   button.setAttribute('aria-pressed',String(selected));button.textContent='有帮助 '+result.helpful.count;
   onConfirmed();
  }catch(error){
   if(!current())return;
   if(error.code==='DISCUSSION_COMMENT_UNAVAILABLE'||error.code==='DISCUSSION_UNAVAILABLE'){await onUnavailable();return}
   status.textContent='反馈未确认，可以重试。';
  }
  finally{if(current())button.disabled=false}
 };
}
function reviewDiscussionReportForm(index){
 return `<details class="saved-notes"><summary>举报发言</summary><form class="stack" data-discussion-report="${index}"><label class="field">举报原因<select name="reason" required><option value="">选择原因</option><option value="spam">垃圾信息</option><option value="harassment">骚扰或攻击</option><option value="other">其他</option></select></label><label class="field">补充说明（选填，仅审核员可见）<textarea name="details" maxlength="500"></textarea></label><button type="submit" class="ghost">提交举报</button><p class="small muted" role="status"></p></form></details>`;
}
function reviewBindDiscussionReport(form,tutorial,comment,context,onBack){
 const button=form.querySelector('button'),reason=form.elements.namedItem('reason'),details=form.elements.namedItem('details'),status=form.querySelector('[role="status"]');
 const url='/api/review-tutorial-discussions/'+encodeURIComponent(tutorial.id)+'/'+encodeURIComponent(comment.id)+'/report';
 const dialog=form.closest('dialog');
 const current=()=>dialog.open&&form.isConnected&&reviewContextCurrent(context);
 function showReceipt(message){
  status.textContent=message;
  const history=document.createElement('button');
  history.type='button';
  history.className='ghost';
  history.textContent='查看我的举报';
  history.onclick=()=>{if(current())void reviewOpenMyDiscussionReports('',true,'all',onBack)};
  status.after(history);
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(button.disabled||!current()||!form.reportValidity())return;
  button.disabled=true;reason.disabled=true;details.readOnly=true;status.textContent='正在提交举报…';
  const submission={reason:reason.value,details:details.value.trim()};
  const alreadySubmitted='此前已提交过另一份举报。本次填写的内容仍在这里。';
  let finished=false;
  try{
   const result=await reviewKnowledgeRequest(url,{context,body:submission});
   if(!current())return;
   if(result.ownerId!==context.ownerId||typeof result.reportId!=='string'||typeof result.repeated!=='boolean')throw Error('举报回执无法核对。');
   finished=true;
   showReceipt(result.repeated?'此前已提交过这条举报。':'举报已提交。');
  }catch(error){
   if(!current())return;
   if(error.code==='DISCUSSION_REPORT_ALREADY_SUBMITTED'){
    finished=true;
    showReceipt(alreadySubmitted);
    return;
   }
   if(reviewIsNetworkError(error)||error.code==='DISCUSSION_REPORT_UNCONFIRMED'){
    status.textContent='举报回执未收到，正在核对…';
    let sameSubmission=false;
    try{
     const receipt=await reviewKnowledgeRequest(url,{context});
     if(!current())return;
     finished=receipt.ownerId===context.ownerId&&receipt.commentId===comment.id&&typeof receipt.reportId==='string';
     sameSubmission=receipt.submission?.reason===submission.reason&&receipt.submission?.details===submission.details;
    }catch{if(!current())return}
    if(finished)showReceipt(sameSubmission?'举报已提交。':alreadySubmitted);
    else status.textContent='举报提交未确认，输入已保留，可以重试。';
    return;
   }
   finished=['DISCUSSION_UNAVAILABLE','DISCUSSION_COMMENT_UNAVAILABLE'].includes(error.code);
   status.textContent=finished?'发言已不可公开读取。':'举报提交未确认，可以重试。';
  }finally{
   if(current()&&!finished){button.disabled=false;reason.disabled=false;details.readOnly=false}
  }
 });
}
async function reviewOpenDiscussion(t,focusId=null,onFocused=null,onBack=null,backLabel='返回收到的回复'){
 const receivedFocusId=onFocused?focusId:null;
 const context=reviewContext(),key=KEY+':discussion-draft:'+JSON.stringify([context.ownerId,t.id]);let draft={text:'',parentId:null,requestId:uid(),tutorialVersion:t.version};try{draft=reviewReadDiscussionDraft(key,context.ownerId)||draft}catch{toast('讨论草稿无法读取，原内容保留，请先核对本机档案。');return}
 modal(`<h2>${esc(t.title)} · 讨论</h2><p class="small muted">提问与回复公开显示你的账号名称，不发送站外通知。内容关联教程 ${esc(t.version.slice(0,8))}，不改变计时。</p><p id="discussion-status" class="small muted" role="status"></p><form id="discussion-search" class="row"><input type="search" name="query" aria-label="搜索讨论正文" maxlength="120" placeholder="搜索讨论正文"><button type="submit">搜索讨论</button></form><label class="field small">讨论顺序<select id="discussion-order"><option value="chronological">发布顺序</option><option value="helpful">有帮助优先</option></select></label><button type="button" class="ghost" id="discussion-rank-refresh" hidden>重新按有帮助排序</button><div id="discussion-comments"></div><form id="tutorial-discussion-form" class="stack"><p id="discussion-reply-label" class="small muted"></p><label class="field">问题或回复<textarea name="text" maxlength="3000" required aria-label="讨论内容">${esc(draft.text)}</textarea></label><label class="check-row"><input name="consent" type="checkbox" required>我选择公开这段内容和账号名称</label><button type="submit" class="primary">发布到教程讨论</button><button type="button" id="discussion-reply-cancel" class="ghost" hidden>取消回复，保留文字</button><p id="discussion-error" class="error" role="alert"></p><p id="discussion-publish-status" class="small muted" role="status"></p><button type="button" class="ghost" id="discussion-show-published" hidden>查看刚发布的发言</button></form>`,'discussion-dialog','教程讨论');
 const form=document.getElementById('tutorial-discussion-form'),status=document.getElementById('discussion-status'),host=document.getElementById('discussion-comments'),error=document.getElementById('discussion-error');const publishedStatus=document.getElementById('discussion-publish-status'),showPublished=document.getElementById('discussion-show-published');let saving=false,replyContext=null,replyLoaded=false,seenView=null,loadGeneration=0,discussionQuery='';
 if(onBack){
  const back=document.createElement('button');back.type='button';back.className='ghost';back.textContent=backLabel;
  status.before(back);
  back.addEventListener('click',()=>{if(back.isConnected&&reviewContextCurrent(context))onBack()});
 }
 if(draft.text){const local=localStorage.getItem(key),session=sessionStorage.getItem(key);if(!local||JSON.parse(local).requestId!==draft.requestId)error.textContent=session&&JSON.parse(session).requestId===draft.requestId?'草稿暂存当前浏览器会话，关闭浏览器前请导出。':'草稿仅留在当前窗口，关闭或刷新前请复制或导出。'}
 function stash(){draft.ownerId=context.ownerId;draft.text=form.elements.namedItem('text').value;draft.updatedAt=Math.max(Date.now(),(draft.updatedAt||0)+1);const storage=reviewStoreDiscussionDraft(key,draft);if(storage==='memory')error.textContent='草稿仅留在当前窗口，关闭或刷新前请复制或导出。';else if(storage==='session')error.textContent='草稿暂存当前浏览器会话，关闭浏览器前请导出。';return storage}
 if(draft.tutorialVersion!==t.version){const review=document.createElement('section');review.className='box';review.innerHTML=`<p class="small muted">草稿原教程版本：${esc(draft.tutorialVersion?.slice(0,8)||'旧草稿未绑定')}。当前版本：${esc(t.version.slice(0,8))}。文字保留，请明确核对后再发布。</p><p class="pre small">当前目标：${esc(t.target.goal)}</p><p class="pre">${esc(t.method)}</p><button type="button" class="ghost" id="discussion-version-review">使用已核对的当前版本</button>`;form.prepend(review);review.querySelector('button').addEventListener('click',()=>{draft.tutorialVersion=t.version;draft.requestId=uid();const storage=stash();if(storage==='local')error.textContent='';review.remove();form.elements.namedItem('consent').checked=false})}
 function label(){document.getElementById('discussion-reply-label').textContent=draft.parentId?(replyContext?replyContext.withdrawn?'原问题已撤回，可取消回复后保留文字':'正在回复 '+replyContext.authorName+'：'+replyContext.text.slice(0,120):replyLoaded?'原问题不可读取，可取消回复后保留文字':'正在核对回复的原问题'):'新问题或反馈';document.getElementById('discussion-reply-cancel').hidden=!draft.parentId}label();form.elements.namedItem('text').addEventListener('input',()=>{draft.requestId=uid();try{const storage=stash();if(storage==='local')error.textContent=''}catch{error.textContent='本机草稿保存未完成，请保留输入或复制后再离开。'}});
 document.getElementById('discussion-reply-cancel').addEventListener('click',()=>{if(saving)return;draft.parentId=null;replyContext=null;draft.requestId=uid();stash();label();form.elements.namedItem('consent').checked=false});async function load(cursor='',fromNavigation=false){if(!host.isConnected||!reviewContextCurrent(context))return;const job=++loadGeneration,requestedParentId=draft.parentId,requestedFocus=cursor?null:focusId,order=document.getElementById('discussion-order').value,query=discussionQuery;document.getElementById('discussion-rank-refresh').hidden=true;host.setAttribute('aria-busy','true');host.querySelectorAll('[data-discussion-retry]').forEach(b=>b.remove());host.querySelectorAll('nav button').forEach(b=>b.disabled=true);status.textContent=host.querySelector('article')?'正在读取讨论…当前内容和草稿保留。':'正在读取讨论…';try{const r=await reviewKnowledgeRequest('/api/review-tutorial-discussions/'+encodeURIComponent(t.id)+'?cursor='+encodeURIComponent(cursor)+'&replyTo='+encodeURIComponent(requestedParentId||'')+'&focus='+encodeURIComponent(requestedFocus||'')+(order==='helpful'?'&order=helpful':'')+(query?'&query='+encodeURIComponent(query):''),{context});if(!host.isConnected||!reviewContextCurrent(context)||job!==loadGeneration)return;if(r.ownerId!==context.ownerId||r.tutorialVersion!==t.version||r.order!==order||r.query!==query)throw Error('教程已修订，请保留草稿，重新读取教程后讨论。');if(draft.parentId===requestedParentId){replyContext=r.replyTarget;replyLoaded=true;label()}status.textContent=`${query?'匹配':'共'} ${r.total} 条讨论，本页 ${r.comments.length} 条。${Number.isInteger(r.pageNumber)&&Number.isInteger(r.pageCount)?' 第 '+r.pageNumber+' / '+r.pageCount+' 页。':''}`;host.innerHTML=r.comments.map((c,i)=>`<article class="list-row" tabindex="-1" ${c.id===requestedFocus?'data-discussion-focus="true" aria-label="对应发言"':''}><p class="small muted">${reviewDiscussionAuthor(c)} · ${dt(c.createdAt)} · 教程 ${esc(c.tutorialVersion.slice(0,8))}${c.parentId?' · 回复':''}</p><details class="saved-notes" ${c.replyContext?'' :'hidden'}><summary>查看回复的原问题</summary><p class="small muted">${esc(c.replyContext?.authorName||'')} · 教程 ${esc(c.replyContext?.tutorialVersion?.slice(0,8)||'')}</p><p class="pre small">${c.replyContext?.withdrawn?'原问题已撤回':esc(c.replyContext?.text||'')}</p></details>${reviewDiscussionSource(c,t)}<p class="pre">${c.moderated?'内容已由审核处理':c.withdrawn?'内容已撤回':esc(c.text)}</p>${reviewDiscussionHelpfulMarkup(c,i)}${!c.withdrawn?`<button class="ghost" data-discussion-reply="${i}">回复</button><a class="small" data-discussion-share href="${esc(reviewTutorialLink(t,c.id))}">发言链接</a>`:''}${c.mine&&!c.moderated?`<button class="ghost" data-discussion-visibility="${i}">${c.withdrawn?'恢复公开':'撤回公开'}</button>`:''}${!c.mine&&!c.withdrawn?reviewDiscussionReportForm(i):''}</article>`).join('')||(query?'<p class="small muted">没有匹配的公开讨论。</p>':'<p class="small muted">还没有讨论，可以记录具体卡点。</p>');if(requestedFocus){const focused=host.querySelector('[data-discussion-focus]');if(focused){focused.focus();seenView={tutorialId:t.id,replyId:requestedFocus,digest:r.focusDigest,panel:host,focusedElement:focused,clearContext:()=>{replyContext=null;replyLoaded=true;label();form.elements.namedItem('consent').checked=false}}}focusId=null;if(!host.isConnected||!reviewContextCurrent(context)||job!==loadGeneration)return}host.querySelectorAll('[data-discussion-helpful]').forEach(button=>reviewBindDiscussionHelpful(button,t,r.comments[Number(button.dataset.discussionHelpful)],context,()=>{host.replaceChildren();replyContext=null;replyLoaded=false;label();form.elements.namedItem('consent').checked=false;return load()},()=>{if(order==='helpful')document.getElementById('discussion-rank-refresh').hidden=false}));host.querySelectorAll('[data-discussion-report]').forEach(form=>reviewBindDiscussionReport(form,t,r.comments[Number(form.dataset.discussionReport)],context,()=>reviewOpenDiscussion(t,null,null,onBack,backLabel)));host.querySelectorAll('[data-discussion-reply]').forEach(b=>b.addEventListener('click',()=>{if(!b.isConnected||saving)return;replyContext=r.comments[Number(b.dataset.discussionReply)];replyLoaded=true;draft.parentId=replyContext.id;draft.requestId=uid();try{stash();label();form.elements.namedItem('text').focus()}catch{error.textContent='回复草稿保存未完成，请保留输入。'}}));host.querySelectorAll('[data-discussion-visibility]').forEach(b=>b.addEventListener('click',async()=>{if(b.disabled||!b.isConnected)return;const c=r.comments[Number(b.dataset.discussionVisibility)];b.disabled=true;try{await reviewKnowledgeRequest('/api/review-tutorial-discussions/'+encodeURIComponent(t.id)+'/'+encodeURIComponent(c.id)+'/'+(c.withdrawn?'restore':'withdraw'),{context,body:{consent:true},headers:{'If-Match':c.revision}});if(b.isConnected&&reviewContextCurrent(context))await load()}catch(e){if(b.isConnected&&reviewContextCurrent(context))error.textContent=e.message}finally{b.disabled=false}}));if(r.previousCursor||r.nextCursor){const pagination=document.createElement('nav');pagination.className='row';pagination.setAttribute('aria-label','讨论分页');const control=(label,cursor)=>{const b=document.createElement('button');b.className='ghost';b.textContent=label;b.type='button';b.addEventListener('click',()=>{if(b.isConnected&&reviewContextCurrent(context))load(cursor,true)});pagination.append(b)};if(r.previousCursor){control('回到第一页讨论','');control('上一页讨论',r.previousCursor)}if(r.nextCursor)control('下一页讨论',r.nextCursor);host.append(pagination)}if(fromNavigation&&!form.contains(document.activeElement)){host.querySelector('article')?.focus({preventScroll:true});const panel=host.closest('dialog');if(panel)panel.scrollTop=0}if(requestedFocus&&requestedFocus===receivedFocusId&&seenView&&onFocused){const receipt=seenView;Promise.resolve().then(()=>onFocused(receipt)).catch(()=>{if(receipt.panel.isConnected&&receipt.focusedElement.isConnected&&reviewContextCurrent(context))error.textContent='已读确认未完成，请重新查看或重试。'})}}catch(e){if(host.isConnected&&reviewContextCurrent(context)&&job===loadGeneration){status.textContent=e.message;const retry=document.createElement('button');retry.type='button';retry.className='ghost';retry.dataset.discussionRetry='true';const focusUnavailable=e.code==='DISCUSSION_FOCUS_UNAVAILABLE';retry.textContent=focusUnavailable?'查看其余讨论':'重新读取讨论';retry.addEventListener('click',()=>{if(!retry.isConnected||!reviewContextCurrent(context))return;if(focusUnavailable)focusId=null;load(focusUnavailable||e.code==='DISCUSSION_CURSOR_CHANGED'?'':cursor,true)});host.append(retry)}}finally{if(host.isConnected&&reviewContextCurrent(context)&&job===loadGeneration){host.setAttribute('aria-busy','false');host.querySelectorAll('nav button').forEach(b=>b.disabled=false)}}}
 form.addEventListener('submit',async e=>{e.preventDefault();if(saving||!form.isConnected||!reviewContextCurrent(context))return;if(draft.tutorialVersion!==t.version){error.textContent='草稿关联的教程版本不同或尚未绑定，请先核对当前教程。';return}if(!form.elements.namedItem('consent').checked){error.textContent='发布前请选择公开内容和账号名称。';return}saving=true;form.querySelector('button[type="submit"]').disabled=true;try{stash();const submitted=JSON.stringify(draft),r=await reviewKnowledgeRequest('/api/review-tutorial-discussions/'+encodeURIComponent(t.id),{context,body:{text:draft.text,parentId:draft.parentId,requestId:draft.requestId,tutorialVersion:draft.tutorialVersion,consent:true}});if(!form.isConnected||!reviewContextCurrent(context))return;if(r.ownerId!==context.ownerId||r.comment?.authorId!==context.ownerId||typeof r.comment.id!=='string')throw Error('讨论发布回执无法核对。');if(JSON.stringify(draft)===submitted){reviewClearDiscussionDraft(key,draft.requestId);draft={text:'',parentId:null,requestId:uid(),tutorialVersion:t.version};form.elements.namedItem('text').value='';form.elements.namedItem('consent').checked=false;label();error.textContent=''}
 publishedStatus.textContent=discussionQuery?'发言已发布，当前搜索条件仍保留。':'发言已发布。';
 showPublished.hidden=false;
 showPublished.onclick=()=>{if(!showPublished.isConnected||!reviewContextCurrent(context))return;discussionQuery='';document.getElementById('discussion-search').elements.query.value='';focusId=r.comment.id;load()};
 await load()}catch(e){if(form.isConnected&&reviewContextCurrent(context))error.textContent=e.message}finally{saving=false;form.querySelector('button[type="submit"]').disabled=false}});document.getElementById('discussion-search').onsubmit=event=>{event.preventDefault();discussionQuery=event.currentTarget.elements.query.value.trim();focusId=null;load()};document.getElementById('discussion-order').onchange=()=>load();document.getElementById('discussion-rank-refresh').onclick=()=>load('',true);
 await load();return seenView;
}
