const fs = require('node:fs'), path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
let w, now;
const event = () => ({ id:'e',name:'阅读',startedAt:0,endedAt:null,segments:[{start:0,end:100},{start:200,end:null}],steps:[{id:'s',text:'留一个理解'}],stepDone:{s:true},repeatText:'重复提醒',draft:'未保存想法',notes:[{id:'n',text:'已保存笔记',at:50}] });
const backup = at => ({format:'dianliang-local-backup/v1',...(at===undefined?{}:{exportedAt:at}),data:{mode:'local-simulation',events:[event()],activeId:'e'}});
beforeEach(() => {
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  w=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',virtualConsole:new VirtualConsole()}).window;
  w.HTMLElement.prototype.checkVisibility=function(){return !this.hidden};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  now=100000;w.Date.now=()=>now;
  w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]+`\nwindow.setup=()=>{S=seed();S.user={id:'test',name:'备份测试',example:true};render();};window.backupCopy=actionBackup;window.prepareBackup=prepareImport;window.timeOf=e=>elapsed(e);`);
  w.setup();
});
afterEach(()=>w.close());
function click(action){const el=w.document.querySelector('[data-action="'+action+'"]');if(!el)throw Error('Missing '+action);el.click()}
async function importFile(value){
  click('nav:profile');click('nav:account');click('import-data');
  const file=w.document.querySelector('#import-file');
  Object.defineProperty(file,'files',{configurable:true,value:[{size:1000,text:async()=>JSON.stringify(value)}]});
  file.dispatchEvent(new w.Event('change',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
}
it('imports only activity up to the old export time even when confirmation is delayed',async()=>{
  await importFile(backup(1000));
  expect(w.document.querySelector('#dialogs').textContent).toContain('截至备份导出时刻');
  now=9000000;click('confirm-import');const e=w.dianliangState.events[0];
  expect(e.segments).toEqual([{start:0,end:100},{start:200,end:1000}]);
  expect(w.timeOf(e)).toBe(900);expect(w.dianliangState.activeId).toBeNull();
  expect(e.endedAt).toBeNull();expect(e.notes[0].text).toBe('已保存笔记');expect(e.draft).toBe('未保存想法');
  expect(e.steps[0].id).toBe('s');expect(e.stepDone.s).toBe(true);
});
it('retains an unknown open interval start without inventing its duration',async()=>{
  await importFile(backup());expect(w.document.querySelector('#dialogs').textContent).toContain('无法确定用时');
  click('confirm-import');const e=w.dianliangState.events[0];
  expect(w.timeOf(e)).toBe(100);expect(e.importRecovery).toEqual({openStart:200,cutoff:null});
  expect(e.segments[1]).toEqual({start:200,end:200});
  click('nav:timer');click('finish:e');expect(w.document.querySelector('#dialogs').textContent).toContain('开放区间未计入用时');
});
it('freezes only the exported copy and keeps the live event open',()=>{
  const data=backup().data,before=JSON.stringify(data),copy=w.backupCopy(data,1000);
  expect(JSON.stringify(data)).toBe(before);expect(copy.data.activeId).toBeNull();
  expect(copy.data.events[0].segments[1].end).toBe(1000);
  expect(w.prepareBackup(copy).events[0].segments[1].end).toBe(1000);
});
it.each([100,NaN,'1000'])('rejects an invalid export cutoff %s without replacing current data',async at=>{
  const before=JSON.stringify(w.dianliangState.events);await importFile(backup(at));
  expect(w.document.querySelector('[data-action="confirm-import"]')).toBeNull();
  expect(w.document.querySelector('#toast').textContent).toContain('原数据未改变');
  expect(JSON.stringify(w.dianliangState.events)).toBe(before);
});
it('accepts zero as an export time when its open interval also starts at zero',()=>{
  const value=backup(0);value.data.events[0].segments=[{start:0,end:null}];
  expect(w.prepareBackup(value).events[0].segments).toEqual([{start:0,end:0}]);
});
