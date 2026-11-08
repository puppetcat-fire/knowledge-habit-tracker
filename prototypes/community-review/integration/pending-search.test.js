const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
let w;
function click(action){const el=w.document.querySelector('[data-action="'+action+'"]');if(!el)throw Error('Missing '+action);el.click()}
function search(value){const el=w.document.querySelector('#pending-search');el.focus();el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));return el}
function mount(){const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');w=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',virtualConsole:new VirtualConsole()}).window;w.Date.now=()=>1000000;w.HTMLElement.prototype.checkVisibility=function(){return !this.hidden};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]+'\nwindow.refreshTestTimer=()=>render(false);');click('example');click('start-candidate');const current=w.dianliangState.events[0];current.draft='活动事件的草稿';w.dianliangState.events.push(...Array.from({length:240},(_,i)=>({id:'pending-'+i,name:i===239?'检索目标 AlphaFocus':'暂放事件'+i,startedAt:i*1000,endedAt:null,segments:[{start:i*1000,end:i*1000}],steps:[],stepDone:{},notes:[],draft:'该实例的草稿'+i})));w.refreshTestTimer();return current}
afterEach(()=>w?.close());
it('searches all 240 pending instances without redrawing the active clock or notes and resumes the sole match',()=>{
 const original=mount(),before=JSON.stringify(w.dianliangState),clock=w.document.querySelector('[data-od-id="active-clock"]'),draft=w.document.querySelector('#single-note');
 expect(w.document.querySelectorAll('.pending-row')).toHaveLength(240);
 const oldRow=w.document.querySelector('[data-action="resume:pending-0"]'),input=search('alphafocus');
 expect(w.document.querySelectorAll('.pending-row')).toHaveLength(1);expect(w.document.querySelector('.pending-row').dataset.eventId).toBe('pending-239');
 expect(w.document.querySelector('[data-od-id="active-clock"]')).toBe(clock);expect(w.document.querySelector('#single-note')).toBe(draft);expect(w.document.activeElement).toBe(input);expect(JSON.stringify(w.dianliangState)).toBe(before);
 oldRow.click();expect(w.dianliangState.activeId).toBe(original.id);
 input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 expect(w.dianliangState.activeId).toBe('pending-239');expect(w.document.querySelector('#single-note').value).toBe('该实例的草稿239');expect(original.draft).toBe('活动事件的草稿');
 expect(w.dianliangState.events.flatMap(e=>e.segments).filter(s=>s.end===null)).toHaveLength(1);expect(w.dianliangState.events).toHaveLength(241);
});
it('does not pick an ambiguous or composing search and restores every row when Escape clears a missing result',()=>{
 const original=mount();let input=search('暂放事件');input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(w.dianliangState.activeId).toBe(original.id);
 input=search('alphafocus');input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));expect(w.dianliangState.activeId).toBe(original.id);
 input=search('没有这一件');expect(w.document.querySelectorAll('.pending-row')).toHaveLength(0);expect(w.document.querySelector('#pending-results').textContent).toContain('没有匹配');
 input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(input.value).toBe('');expect(w.document.querySelectorAll('.pending-row')).toHaveLength(240);expect(w.document.activeElement).toBe(input);expect(w.document.querySelector('#pending-search-status').hidden).toBe(true);
});
it('keeps same-name records distinct and lets either original instance resume by ID',()=>{
 mount();const one=w.dianliangState.events.find(e=>e.id==='pending-0'),two=w.dianliangState.events.find(e=>e.id==='pending-1');one.name=two.name='重复但独立的事';one.startedAt=100000;two.startedAt=200000;one.segments=[{start:100000,end:100000}];two.segments=[{start:200000,end:200000}];w.refreshTestTimer();search(one.name);
 expect(w.document.querySelectorAll('.pending-row')).toHaveLength(2);const origins=[...w.document.querySelectorAll('.pending-origin')].map(e=>e.textContent);expect(origins).toHaveLength(2);expect(origins[0]).not.toBe(origins[1]);
 click('resume:'+two.id);expect(w.dianliangState.activeId).toBe(two.id);expect(w.document.querySelector('#single-note').value).toBe(two.draft);click('resume:'+one.id);expect(w.dianliangState.activeId).toBe(one.id);expect(w.document.querySelector('#single-note').value).toBe(one.draft);
});
