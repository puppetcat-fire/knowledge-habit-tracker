let reviewClient=null,reviewReady=false,reviewSuppress=false,reviewQueued=null,reviewCounter=0,reviewTimer=null,reviewPumpPromise=null;
function reviewFailureMessage(error){if(error?.code==='ACTION_STORE_UNREADABLE')return '服务档案无法读取，原文件已保留。请先导出本机数据，恢复服务档案后再重试连接。';if(error?.code==='ACTION_VALIDATION')return '服务拒绝了无效档案，原服务版本未覆盖。请导出本机数据并核对内容。';return '服务连接或保存未完成，当前本机内容保留，可重试或导出。'}
function reviewActionData(){return {schema:1,...portableData(S)}}
function reviewBeforeLocalSave(){
  if(reviewSuppress||!reviewReady||!S.user?.reviewService)return;
  const state=reviewClient.snapshot();
  if(state.ownerId!==S.user.id)return;
  const changed=JSON.stringify(state.data)!==JSON.stringify(reviewActionData())||state.pending.length>0;
  S.reviewSync={ownerId:S.user.id,revision:state.revision,pending:changed};
}
function reviewSyncWarning(message){
  let panel=document.getElementById('review-sync-warning');
  if(!message){panel?.remove();return}
  if(!panel){panel=document.createElement('section');panel.id='review-sync-warning';panel.setAttribute('role','alert');panel.className='box';panel.style.cssText='position:sticky;top:0;z-index:90;margin:0;border-radius:0;background:var(--surface)';document.body.prepend(panel)}
  panel.innerHTML='<p>'+esc(message)+'</p><div class="row" style="margin-top:8px">'+btn('核对本机与服务内容','review-sync-compare')+btn('重试连接与保存','review-sync-retry','ghost')+btn('导出当前未同步数据','review-sync-export','ghost')+btn('导出服务器版本','review-sync-remote','ghost')+'</div>';bind(panel);
}
function reviewQueueRemote(){
  if(reviewSuppress||!reviewReady||!S.user?.reviewService)return;
  const state=reviewClient.snapshot();
  if(state.ownerId!==S.user.id){reviewReady=false;reviewSyncWarning('服务账号已变化，当前编辑仍在本机，请重新登录后核对。');return}
  const data=reviewActionData();
  if(!state.pending.length&&JSON.stringify(state.data)===JSON.stringify(data))return;
  reviewQueued={ownerId:S.user.id,data,counter:++reviewCounter};
  clearTimeout(reviewTimer);reviewTimer=setTimeout(()=>{reviewPump().catch(()=>{})},100);
}
async function reviewPump(){
  if(reviewPumpPromise)return reviewPumpPromise;
  if(reviewClient?.snapshot().blocked)throw Error('服务保存未完成，请先重试；最新编辑保留在本机。');
  reviewPumpPromise=(async()=>{
    while(reviewQueued){
      const work=reviewQueued;reviewQueued=null;
      if(!reviewReady||S.user?.id!==work.ownerId)throw Error('服务账号已变化，当前编辑保留在原账户本机档案。');
      try{
        await reviewClient.save(work.data);
        if(S.user?.id===work.ownerId){
          reviewSuppress=true;
          S.reviewSync={ownerId:work.ownerId,revision:reviewClient.snapshot().revision,pending:reviewCounter!==work.counter};save();reviewSuppress=false;
        }
        reviewSyncWarning('');
      }catch(error){
        if(S.user?.id===work.ownerId)reviewQueued={ownerId:work.ownerId,data:reviewActionData(),counter:reviewCounter};
        reviewSyncWarning(error.code==='ACTION_CONFLICT'?'服务器已有另一版本，当前编辑已保留在本机。请先导出双方内容并核对。':reviewFailureMessage(error));
        throw error;
      }
    }
  })();
  try{return await reviewPumpPromise}finally{reviewPumpPromise=null;reviewSuppress=false}
}
async function reviewFlush(){clearTimeout(reviewTimer);if(reviewPumpPromise)await reviewPumpPromise;if(reviewQueued)await reviewPump()}
function reviewApplyData(data,user,meta){
  const candidate={...seed(),...clone(data),accounts:S.accounts,profiles:S.profiles,user:{id:user.id,name:user.name,example:false,reviewService:true},session:S.session||uid(),page:S.page,reviewSync:meta};
  validateSavedState(candidate);S=candidate;normalize();save();render(false);
}
async function reviewConnectState(user){
  reviewReady=false;reviewSuppress=true;
  if(!reviewClient)reviewClient=DianliangActionClient.createActionStateClient((...args)=>fetch(...args));
  const connected=await reviewClient.connect();
  if(connected.ownerId!==user.id)throw Error('服务账号已变化，请重新登录。');
  const pending=S.reviewSync?.pending&&S.reviewSync.ownerId===user.id&&typeof S.reviewSync.revision==='string'?{data:reviewActionData(),revision:S.reviewSync.revision}:null;
  if(pending){
    if(JSON.stringify(pending.data)===JSON.stringify(connected.data))reviewApplyData(connected.data,user,{ownerId:user.id,revision:connected.revision,pending:false});
    else{reviewClient.restorePending(pending.data,pending.revision);reviewApplyData(pending.data,user,{ownerId:user.id,revision:pending.revision,pending:true});reviewSyncWarning('已恢复本机未同步编辑，请重试保存；服务器有变化时会停止覆盖。')}
  }else if(connected.data)reviewApplyData(connected.data,user,{ownerId:user.id,revision:connected.revision,pending:false});
  reviewSuppress=false;reviewReady=true;
  if(!pending){save();reviewQueueRemote()}
}
async function reviewRetryState(){
  if(reviewAccountConnecting||reviewAuthBusy)return;
  try{if(!S.user?.reviewService)throw Error('请登录原服务账号后核对。');reviewAccountConnecting=true;reviewAccountUIBusy();if(!reviewReady||reviewClient?.snapshot().ownerId!==S.user.id)await reviewConnectState(S.user);await reviewClient.retryPending();await reviewFlush();reviewSuppress=true;S.reviewSync={ownerId:S.user.id,revision:reviewClient.snapshot().revision,pending:false};save();reviewSuppress=false;reviewSyncWarning('')}
  catch(error){reviewSyncWarning(error.code==='ACTION_CONFLICT'?'服务保存仍未完成，服务器有新版本。当前编辑保留，请导出双方内容并核对。':reviewFailureMessage(error))}
  finally{reviewSuppress=false;reviewAccountConnecting=false;reviewAccountUIBusy()}
}
