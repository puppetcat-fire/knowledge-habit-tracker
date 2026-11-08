const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {validateActionState}=require('./action-state.cjs');
let windows=[];
function mount(cache){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const w=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',virtualConsole:new VirtualConsole()}).window;windows.push(w);
 w.Date.now=()=>1000;w.HTMLElement.prototype.checkVisibility=function(){return !this.hidden};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 if(cache)w.localStorage.setItem('dianliang-local-prototype-v1',cache);
 w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]+`\nwindow.fixture=()=>{S=seed();S.user={id:'test',name:'删除测试',example:true};const e=(id,start,end)=>({id,name:id,startedAt:start,endedAt:end,segments:[{start,end}],steps:[],stepDone:{},repeatText:'',draft:id+'草稿',notes:[{id:id+'note',text:id+'单次笔记',at:start}]});const parent=e('父记录',0,10),child=e('子记录',10,null),grand=e('孙记录',10,10);child.parentId=parent.id;child.parentStepId='step';grand.parentId=child.id;grand.parentStepId='grandstep';S.events=[parent,child,grand];S.activeId=child.id;S.templates[child.name]={text:'',steps:[]};S.lights=[{id:'lp',eventId:parent.id,nodeId:'num',confirmed:false,evidence:'',result:''},{id:'lc',eventId:child.id,nodeId:'num',confirmed:false,evidence:'',result:''}];validateSavedState(S);render();};window.checkSaved=validateSavedState;window.makeBackup=()=>actionBackup(portableData(S));window.prepareBackup=prepareImport;window.guardDelete=deleteEventRecord;`);
 if(!cache)w.fixture();return w;
}
function missingFixture(){const w=mount(),s=w.dianliangState;s.events=s.events.filter(e=>e.id!=='父记录');s.lights=s.lights.filter(l=>l.eventId!=='父记录');w.checkSaved(s);return w}
function openMissing(w){click(w,'nav:profile');click(w,'nav:account');click(w,'review-missing-parent')}
function click(w,action){const el=w.document.querySelector('[data-action="'+action+'"]');if(!el)throw Error('Missing '+action);el.click()}
function openDelete(w){click(w,'nav:records');click(w,'range:all');click(w,'event-detail:父记录');click(w,'delete-event:父记录')}
afterEach(()=>{windows.forEach(w=>w.close());windows=[]});
it('deletes only the ended parent while preserving the running child and its descendants',()=>{
 const w=mount(),before=JSON.parse(JSON.stringify(w.dianliangState.events.find(e=>e.id==='子记录')));
 openDelete(w);expect(w.document.querySelector('#dialogs').textContent).toContain('子事件和计时保留');click(w,'confirm-delete:父记录');
 const s=w.dianliangState,child=s.events.find(e=>e.id==='子记录');
 expect(s.events.map(e=>e.id)).toEqual(['子记录','孙记录']);expect(s.activeId).toBe(child.id);
 const {parentId,parentStepId,...own}=before;expect(child).toEqual({...own,parentOrigin:{id:'父记录',name:'父记录',stepId:'step',deletedAt:1000}});
 expect(s.events.find(e=>e.id==='孙记录').parentId).toBe(child.id);
 expect(s.lights.map(l=>l.id)).toEqual(['lc']);
 expect(JSON.stringify(child.parentOrigin)).not.toContain('单次笔记');
 expect(()=>validateActionState({schema:1,...w.makeBackup().data})).not.toThrow();
});
it('survives cache reload and backup restoration with deleted-parent provenance',()=>{
 const w=mount();openDelete(w);click(w,'confirm-delete:父记录');
 const cache=w.localStorage.getItem('dianliang-local-prototype-v1'),reloaded=mount(cache);
 expect(reloaded.dianliangState.activeId).toBe('子记录');expect(reloaded.checkSaved(reloaded.dianliangState)).toBeTruthy();
 const restored=reloaded.prepareBackup(reloaded.makeBackup());expect(restored.activeId).toBeNull();
 expect(restored.events[0].parentOrigin.id).toBe('父记录');expect(restored.events[0].draft).toBe('子记录草稿');
 click(reloaded,'nav:timer');click(reloaded,'finish:子记录');
 expect(reloaded.document.querySelector('#dialogs').textContent).toContain('父记录「父记录」已删除');
 expect(reloaded.dianliangState.events.some(e=>e.id==='父记录')).toBe(false);
});
it('cancelling deletion leaves all event relationships and activity untouched',()=>{
 const w=mount(),before=JSON.stringify(w.dianliangState.events);openDelete(w);click(w,'dialog-close');
 expect(JSON.stringify(w.dianliangState.events)).toBe(before);expect(w.dianliangState.activeId).toBe('子记录');
});
it('refuses to delete an unfinished event even if a stale action targets it',()=>{
 const w=mount(),before=JSON.stringify(w.dianliangState.events);expect(w.guardDelete('子记录')).toBe(false);
 expect(JSON.stringify(w.dianliangState.events)).toBe(before);
});
it('explicitly marks an old unavailable source without inventing deletion or changing child activity',()=>{
 const w=missingFixture(),before=JSON.parse(JSON.stringify(w.dianliangState.events[0]));openMissing(w);
 expect(w.document.querySelector('#dialogs').textContent).toContain('无法判断是已删除还是未导入');
 click(w,'confirm-missing-parent');const child=w.dianliangState.events[0];
 const {parentId,parentStepId,...own}=before;
 expect(child).toEqual({...own,parentMissing:{id:parentId,stepId:parentStepId}});
 expect(child.parentOrigin).toBeUndefined();expect(w.dianliangState.activeId).toBe(child.id);
 expect(()=>validateActionState({schema:1,...w.makeBackup().data})).not.toThrow();
 const restored=mount(w.localStorage.getItem('dianliang-local-prototype-v1'));expect(restored.dianliangState.events[0].parentMissing.id).toBe(parentId);
 click(restored,'nav:timer');click(restored,'finish:子记录');
 expect(restored.document.querySelector('#dialogs').textContent).toContain('未推断来源名称或删除原因');
});
it('keeps old source references unchanged when the review is cancelled',()=>{
 const w=missingFixture(),before=JSON.stringify(w.dianliangState.events);openMissing(w);click(w,'dialog-close');
 expect(JSON.stringify(w.dianliangState.events)).toBe(before);
 expect(w.dianliangState.activeId).toBe('子记录');
});
it('does not apply an old review after the source relationship changes',()=>{
 const w=missingFixture();openMissing(w);w.dianliangState.events[0].parentId='other-missing-source';
 click(w,'confirm-missing-parent');expect(w.dianliangState.events[0].parentId).toBe('other-missing-source');
 expect(w.dianliangState.events[0].parentMissing).toBeUndefined();
 expect(w.document.querySelector('#toast').textContent).toContain('请重新核对');
});
it('keeps the recovery section absent when all source records are available',()=>{
 const w=mount();click(w,'nav:profile');click(w,'nav:account');expect(w.document.querySelector('[data-action="review-missing-parent"]')).toBeNull();
});
it('displays an old source identifier as text instead of executable markup',()=>{
 const w=missingFixture(),id='missing"><img src=x onerror="alert(1)">';w.dianliangState.events[0].parentId=id;openMissing(w);
 expect(w.document.querySelector('#dialogs').textContent).toContain(id);expect(w.document.querySelector('#dialogs img')).toBeNull();
});
it('rejects invented source descriptions in local recovery metadata as well',()=>{
 const w=missingFixture(),candidate=JSON.parse(JSON.stringify(w.dianliangState));
 delete candidate.events[0].parentId;delete candidate.events[0].parentStepId;
 candidate.events[0].parentMissing={id:'missing',stepId:null,name:'猜测名称'};
 expect(()=>w.checkSaved(candidate)).toThrow();
 expect(w.dianliangState.events[0].parentId).toBe('父记录');
});
