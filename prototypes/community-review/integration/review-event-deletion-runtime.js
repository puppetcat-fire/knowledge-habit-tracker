async function reviewDeleteEvent(eventId){
 if(reviewAuthBusy||reviewAccountConnecting)return;const context=reviewContext(),target=S.events.find(e=>e.id===eventId);if(!target||target.endedAt===null){toast('只能删除已结束的历史记录。');return}const user={id:S.user.id,name:S.user.name};let committed=false,baseRevision=null;
 reviewAccountConnecting=true;reviewAccountUIBusy();
 try{if(!reviewReady)throw Error('请先连接本人服务账号后再删除。');if(!save())throw Error('本机保存未完成，请保留备份后再核对删除。');await reviewFlush();const fingerprint=JSON.stringify(reviewActionData());baseRevision=reviewClient.snapshot().revision;reviewSuppress=true;const result=await reviewKnowledgeRequest('/api/review-event-deletion',{context,headers:{'If-Match':reviewClient.snapshot().revision},body:{eventId,confirmed:true}});committed=true;if(!reviewContextCurrent(context))return;if(JSON.stringify(reviewActionData())!==fingerprint){reviewClient.restorePending(reviewActionData(),baseRevision);S.reviewSync={ownerId:user.id,revision:baseRevision,pending:true};save();throw Error('服务删除已确认，但本机有新编辑，请核对双方版本；未覆盖本机内容。')}const adopted=await reviewClient.resolveReviewed('remote',result.revision);if(!reviewContextCurrent(context))return;if(JSON.stringify(reviewActionData())!==fingerprint){reviewClient.restorePending(reviewActionData(),baseRevision);S.reviewSync={ownerId:user.id,revision:baseRevision,pending:true};save();throw Error('服务删除已确认，但本机有新编辑，请核对双方版本；未覆盖本机内容。')}reviewApplyData(adopted.data,user,{ownerId:user.id,revision:adopted.revision,pending:false});snapshotProfile();save();closeModal();navigate('records');toast(persistError?'服务事件及关联实践已删除，本机缓存未更新，请核对保存状态。':'事件、关联点亮和知识服务实践已删除，子事件与计时保留。');
 }catch(error){if(reviewContextCurrent(context)){
  // A lost response can follow a committed service deletion. Keep the original
  // revision so retry/reload cannot silently adopt or resurrect either copy.
  if(baseRevision&&reviewClient.snapshot().pending.length===0){reviewSuppress=true;reviewClient.restorePending(reviewActionData(),baseRevision);S.reviewSync={ownerId:user.id,revision:baseRevision,pending:true};save()}
  reviewSyncWarning(committed?'服务删除已确认，本机同步尚未完成；请保留本机编辑并核对服务版本。':'删除尚未确认，原界面内容保留。服务可能已处理请求，请重新核对或重试，勿覆盖旧版本。'+error.message)
 }}
 finally{reviewSuppress=false;reviewAccountConnecting=false;reviewAccountUIBusy()}
}
