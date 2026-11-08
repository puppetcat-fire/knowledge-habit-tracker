const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
let w,narrow;
function mount(){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 w=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',virtualConsole:new VirtualConsole()}).window;
 narrow=true;w.matchMedia=()=>({matches:narrow});w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 click('example');return w.document;
}
function click(action){const el=w.document.querySelector('[data-action="'+action+'"]');if(!el)throw Error('Missing '+action);el.click()}
afterEach(()=>w?.close());
it('keeps narrow-screen keyboard and reading order action, unfinished list, notes in idle and active states',()=>{
 const d=mount();
 for(const active of [false,true]){
  if(active)click('start-candidate');
  const action=d.querySelector('.timer-core'),pending=d.querySelector('.timer-aside'),notes=d.querySelector(active?'.notes-grid':'.idle-notes');
  expect(action.compareDocumentPosition(pending)&w.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(pending.compareDocumentPosition(notes)&w.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 }
});
it('excludes a closed mobile sidebar from focus and accessibility, focuses its close control only when opened',()=>{
 const d=mount();expect(d.querySelector('.sidebar').inert).toBe(true);expect(d.querySelector('.sidebar').getAttribute('aria-hidden')).toBe('true');
 click('open-nav');expect(d.querySelector('.sidebar').inert).toBe(false);expect(d.querySelector('.sidebar').hasAttribute('aria-hidden')).toBe(false);
 expect(d.activeElement.dataset.action).toBe('close-nav');expect(d.querySelector('.main').inert).toBe(true);expect(d.querySelector('.sidebar').getAttribute('aria-modal')).toBe('true');
 d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 expect(d.querySelector('.sidebar').inert).toBe(true);expect(d.activeElement.dataset.action).toBe('open-nav');expect(d.querySelector('.main').inert).toBe(false);expect(d.querySelector('.sidebar').hasAttribute('aria-modal')).toBe(false);
});
it('makes the same navigation accessible again when resized to desktop without touching the running event',()=>{
 const d=mount();click('start-candidate');const activeId=w.dianliangState.activeId;
 narrow=false;w.dispatchEvent(new w.Event('resize'));
 expect(d.querySelector('.sidebar').inert).toBe(false);expect(d.querySelector('.sidebar').hasAttribute('aria-hidden')).toBe(false);
 expect(w.dianliangState.activeId).toBe(activeId);
 narrow=true;w.dispatchEvent(new w.Event('resize'));expect(d.querySelector('.sidebar').inert).toBe(true);
});
