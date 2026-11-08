// Appended inside the full review script's lexical scope by the build step.
// Accounts use the existing service; action records are still browser-local.
let reviewAuthBusy=false;
let reviewAccountConnecting=false;
let reviewAccountGeneration=0;
function reviewContext(){return {ownerId:S.user?.id,generation:reviewAccountGeneration}}
function reviewContextCurrent(context){return !reviewAuthBusy&&!!S.user?.reviewService&&S.user.id===context?.ownerId&&reviewAccountGeneration===context.generation}
function reviewContextError(){const error=Error('原请求的账号上下文已结束，请在当前账号重新核对。');error.code='REVIEW_CONTEXT_CHANGED';return error}
function reviewClearFeedback(){clearTimeout(toast.timer);const status=document.getElementById('toast');if(status){status.hidden=true;status.textContent=''}}
function reviewApplyShareLink(){
 if(reviewAuthBusy||reviewAccountConnecting||!reviewReady||!S.user?.reviewService)return;
 reviewApplyAuthorLink();
 const pending=[reviewPendingTutorialLink,reviewPendingPracticeLink.length>0,reviewPendingPathLink.length>0];
 if(pending.filter(Boolean).length>1){
  reviewPendingTutorialLink=false;
  reviewPendingPracticeLink=[];
  reviewPendingPathLink=[];
  toast('链接包含多个分享目标，请打开其中一条内容的独立链接。');
  return;
 }
 if(pending[0])reviewApplyTutorialLink();
 if(pending[1])reviewApplyPracticeLink();
 if(pending[2])reviewApplyPathLink();
}
function reviewAccountUIBusy(){const app=document.getElementById('app');if(app){app.inert=reviewAuthBusy||reviewAccountConnecting;app.setAttribute('aria-busy',String(app.inert));if(!app.inert){reviewApplyShareLink();reviewReadOwnProfileSummary();reviewReadProfileMethods();reviewRefreshReceivedCount();reviewBindPublicPractices();reviewBindPublicAuthor();reviewBindFollowedAuthors();reviewBindFollowingFeed();reviewBindTutorialBookmarks()}}}
async function reviewAccountRequest(url, body, headers={}) {
  const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok||!result.ok){const error=Error(result.message||'账号请求失败，请重试。');error.status=response.status;error.code=result.code;throw error}
  return result;
}
async function reviewAcceptUser(user) {
  reviewAccountGeneration++;
  if(document.getElementById('tutorial-version-comparison')||document.getElementById('tutorial-version-loading')||document.getElementById('copied-path-form')||document.getElementById('copied-target-loading')||document.getElementById('path-target-loading')||document.getElementById('review-path-form')||document.getElementById('review-path-loading')||document.getElementById('owned-path-results')||document.getElementById('public-path-form')||document.getElementById('own-practice-results')||document.getElementById('own-profile-form')||document.getElementById('own-profile-loading')||document.getElementById('received-replies-results')||document.getElementById('owned-discussion-search')||document.getElementById('public-tutorial-search')||document.getElementById('tutorial-discussion-form')||document.getElementById('discussion-moderation-results')||document.getElementById('my-discussion-reports')||document.getElementById('public-tutorial-link-content'))closeModal(true);
  U.unlockedEvent=null;
  reviewClearFeedback();
  reviewAccountConnecting=true;reviewAccountUIBusy();
  reviewReady=false;reviewSuppress=true;
  const verified={id:user.id,name:user.name,example:false,reviewService:true};
  try{if(S.user?.id===user.id){S.user=verified;normalize();save();render(false)}
  else{if(S.user){freeze(active(),Date.now());S.activeId=null;snapshotProfile()}enter(verified)}
  await reviewConnectState(user)}catch(error){reviewReady=false;reviewSyncWarning(reviewFailureMessage(error))}finally{reviewSuppress=false;reviewAccountConnecting=false;reviewAccountUIBusy()}
}
async function reviewAuthSubmit(ev) {
  ev.preventDefault();if(reviewAuthBusy)return;
  const form=ev.target,fields=new FormData(form),button=form.querySelector('button');
  reviewAuthBusy=true;reviewAccountUIBusy();button.disabled=true;$('#auth-error').textContent='';
  try{const result=await reviewAccountRequest(U.auth==='register'?'/api/register':'/api/login',{name:String(fields.get('name')||'').trim(),password:String(fields.get('password')||'')});await reviewAcceptUser(result.user)}
  catch(error){const target=$('#auth-error');if(target)target.textContent=error instanceof TypeError?'无法连接独立账号服务，填写内容仍在。':error.message}
  finally{reviewAuthBusy=false;reviewAccountUIBusy();button.disabled=false}
}
async function reviewLogout() {
  if(reviewAuthBusy)return;reviewAuthBusy=true;
  U.unlockedEvent=null;
  reviewAccountUIBusy();
  reviewAccountGeneration++;
  if(document.getElementById('tutorial-version-comparison')||document.getElementById('tutorial-version-loading')||document.getElementById('copied-path-form')||document.getElementById('copied-target-loading')||document.getElementById('path-target-loading')||document.getElementById('review-path-form')||document.getElementById('review-path-loading')||document.getElementById('owned-path-results')||document.getElementById('public-path-form')||document.getElementById('own-practice-results')||document.getElementById('own-profile-form')||document.getElementById('own-profile-loading')||document.getElementById('received-replies-results')||document.getElementById('owned-discussion-search')||document.getElementById('public-tutorial-search')||document.getElementById('tutorial-discussion-form')||document.getElementById('discussion-moderation-results')||document.getElementById('my-discussion-reports')||document.getElementById('public-tutorial-link-content'))closeModal(true);
  reviewClearFeedback();
  try{const ownerId=S.user?.id;freeze(active(),Date.now());S.activeId=null;snapshotProfile();save();if(!reviewReady)throw Error('行动状态尚未连接，请先导出或处理保存状态。');await reviewFlush();await reviewAccountRequest('/api/logout',{}, {'X-Action-Account':ownerId});reviewReady=false;reviewClient?.disconnect();S.user=null;S.session=null;U.auth='login';save();render(false);reviewSyncWarning('')}
  catch(error){toast('退出服务账号失败，当前记录保留。'+error.message)}
  finally{reviewAuthBusy=false;reviewAccountUIBusy()}
}
async function reviewAccountBoot() {
  if(S.user?.example){normalize();render();updateStorageStatus();return}
  $('#app').innerHTML='<main class="content"><p role="status">正在核对服务账号…</p></main>';
  try{const result=await reviewAccountRequest('/api/me');await reviewAcceptUser(result.user)}
  catch(error){if(S.user){freeze(active(),Date.now());S.activeId=null;snapshotProfile()}S.user=null;S.session=null;U.auth='login';save();render(false);if(error.status!==401)$('#auth-error').textContent='账号服务暂时无法连接。已有记录保留在本浏览器。'}
  updateStorageStatus();
}
