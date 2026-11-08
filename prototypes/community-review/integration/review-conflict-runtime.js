let reviewPlan=null,reviewResolving=false;
function reviewArchiveKey(){if(!S.user?.reviewService)throw Error('请先登录服务账号');return KEY+'-version-review-'+S.user.id}
function reviewArchives(){const raw=localStorage.getItem(reviewArchiveKey());if(!raw)return [];const entries=JSON.parse(raw);if(!Array.isArray(entries))throw Error('核对备份无法读取，原内容仍保留');for(const e of entries){if(!e||typeof e.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(e.id)||!Number.isFinite(e.at)||typeof e.revision!=='string'||!e.local)throw Error('核对备份内容无效，原内容仍保留');for(const b of [e.local,e.remote].filter(Boolean)){if(!Number.isFinite(b.exportedAt))throw Error('核对备份时刻无效');validateImport(b)}}return entries}
function reviewKeepBoth(plan){
 const entries=reviewArchives(),at=Date.now();entries.push({id:uid(),at,revision:plan.revision,local:actionBackup(plan.local,at),remote:plan.remote? actionBackup(plan.remote,at):null});
 const raw=JSON.stringify(entries),key=reviewArchiveKey();localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw Error('未能保存替换前备份，已停止替换');
}
function reviewArchivePanel(){
 if(!S.user?.reviewService)return '';
 try{const entries=reviewArchives();if(!entries.length)return '';return `<section class="box" style="margin-top:24px"><h2>版本核对备份</h2><p class="small muted">每次替换前的两份内容保存在本浏览器，按账号隔离。导出后可从备份导入入口审阅恢复。</p>${entries.map(e=>`<details class="saved-notes"><summary>${dt(e.at)}</summary><div class="row">${btn('导出当时的本机版本','review-archive-local:'+e.id)}${e.remote?btn('导出当时的服务版本','review-archive-remote:'+e.id,'ghost'):''}</div></details>`).join('')}</section>`}catch{return '<section class="box"><p class="error">核对备份暂时无法读取，原文件保留；请勿清空浏览器数据。</p></section>'}
}
function accountPage(){return accountPageBase()+reviewArchivePanel()}
function reviewVersionContent(label,data){
 if(!data)return `<section><h3>${label}</h3><p>尚无服务内容。</p></section>`;
 const current=data.events?.find(e=>e.id===data.activeId);
 return `<section><h3>${label}</h3><p class="small muted">${data.events?.length||0} 条事件 · ${data.habits?.length||0} 个习惯 · ${data.nodes?.length||0} 个知识目标</p><p>当前事件：${esc(current?.name||'没有正在计时的事')}</p><p class="pre">个人介绍：${esc(data.bio||'')}</p><details class="saved-notes"><summary>事件与单次笔记</summary>${(data.events||[]).map(e=>`<article class="list-row"><h3>${esc(e.name)}</h3><p class="small muted">${e.endedAt===null?'未结束':'已结束'} · ${e.segments.length} 个活动区间</p>${e.notes.map(n=>`<p class="pre">${esc(n.text)}</p>`).join('')}${e.draft?`<p class="pre">草稿：${esc(e.draft)}</p>`:''}</article>`).join('')}</details><details class="saved-notes"><summary>完整内容</summary><pre class="pre small" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(data,null,2))}</pre></details></section>`;
}
async function reviewOpenConflict(){
 try{
  if(!reviewReady||reviewClient.snapshot().ownerId!==S.user?.id)throw Error('请重新登录原账户后核对');
  const remote=await reviewClient.readRemoteVersion();if(remote.ownerId!==S.user?.id)throw Error('核对期间账号已变化');
  reviewPlan={ownerId:remote.ownerId,revision:remote.revision,local:reviewActionData(),remote:remote.state?.data||null};
  modal(`<h2>核对两份行动档案</h2><p class="small muted">选择一整份版本。替换前会保存双方备份，账户页可导出恢复。计时继续，关闭此面板不改变任何版本。</p><div class="two" style="margin-top:20px">${reviewVersionContent('本机编辑',reviewPlan.local)}${reviewVersionContent('服务已保存',reviewPlan.remote)}</div><p id="review-version-error" class="error" role="alert"></p><div class="row actions">${btn('继续核对，暂不替换','dialog-close','ghost')}${reviewPlan.remote?btn('采用服务版本','review-resolve-remote'):''}${btn('保留本机版本并保存','review-resolve-local','primary')}</div>`,'','核对行动档案');
 }catch(error){reviewSyncWarning('暂时无法核对两份内容，当前编辑保留。'+error.message)}
}
async function reviewResolveConflict(choice){
 if(reviewResolving)return;const plan=reviewPlan;if(!plan)return;
 const buttons=[...document.querySelectorAll('#dialogs [data-action^="review-resolve-"]')];
 reviewResolving=true;buttons.forEach(b=>b.disabled=true);
 try{
  if(plan.ownerId!==S.user?.id||reviewClient.snapshot().ownerId!==plan.ownerId)throw Error('账号已变化，请重新核对');
  if(JSON.stringify(reviewActionData())!==JSON.stringify(plan.local))throw Error('本机又有新修改，请关闭后重新核对');
  reviewKeepBoth(plan);
  const result=await reviewClient.resolveReviewed(choice,plan.revision,plan.local);
  if(S.user?.id!==plan.ownerId)throw Error('账号已变化，原编辑仍在原账户备份');
  if(JSON.stringify(reviewActionData())!==JSON.stringify(plan.local)){
   reviewClient.restorePending(reviewActionData(),result.revision);
   throw Error('核对期间又有本机修改，已保留，请重新核对');
  }
  clearTimeout(reviewTimer);reviewQueued=null;reviewSuppress=true;
  reviewApplyData(result.data,S.user,{ownerId:plan.ownerId,revision:result.revision,pending:false});
  reviewPlan=null;closeModal();reviewSyncWarning('');toast('所选版本已采用，双方原版本可在账户页导出。');
 }catch(error){const box=document.getElementById('review-version-error');if(box)box.textContent=error.code==='ACTION_CONFLICT'?'服务又有新修改，请关闭后重新核对。当前编辑和双方备份保留。':error.name==='QuotaExceededError'?'未完成替换：本机空间不足，无法保存双方备份。请先导出当前内容，再释放空间。':'未完成替换，当前编辑保留。'+error.message}
 finally{reviewSuppress=false;reviewResolving=false;buttons.forEach(b=>b.disabled=false)}
}
function reviewExportArchive(id,side){try{const entry=reviewArchives().find(e=>e.id===id);if(entry?.[side])download('点亮-核对前-'+(side==='local'?'本机':'服务')+'备份.json',entry[side])}catch(error){toast(error.message)}}
