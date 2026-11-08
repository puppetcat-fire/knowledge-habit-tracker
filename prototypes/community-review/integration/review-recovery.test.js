const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createAuthenticatedActionApp } = require('./authenticated-app.cjs');
const KEY = 'dianliang-service-review-v1';
let directory, server, cookie, offline, windows, assets;
async function until(predicate, label) {
  const limit = Date.now() + 5000;
  while (Date.now() < limit) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error('Timed out: ' + label + '; visible error: ' + (windows?.at(-1)?.document.querySelector('#visible-contribution-error')?.textContent || ''));
}
function transport(url, options = {}) {
  if (offline) return Promise.reject(new TypeError('Test network disconnected'));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method: options.method || 'GET',
      headers: { Cookie: cookie, ...options.headers } }, res => {
      if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(body) }));
    });
    req.on('error', reject); req.end(options.body);
  });
}
function ui(cache, extraStorage = {}, query = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(assets, 'index.html'), 'utf8'), {
    url: 'http://127.0.0.1:' + server.address().port + '/review/' + query, runScripts: 'outside-only', virtualConsole: new VirtualConsole()
  });
  const w = dom.window; windows.push(w); w.fetch = transport;
  Object.defineProperty(w.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle,configurable:true});
  w.TextEncoder=require('node:util').TextEncoder;
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.checkVisibility = function () { return !this.hidden; };
  w.HTMLElement.prototype.scrollTo = function (options) { this.scrollLeft=options?.left||0;this.scrollTop=options?.top||0; };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  if (cache) w.localStorage.setItem(KEY, cache);
  for(const [key,value] of Object.entries(extraStorage))w.localStorage.setItem(key,value);
  w.eval(fs.readFileSync(path.join(assets, 'action-client.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(assets, 'review.js'), 'utf8') + '\nwindow.readTransportSnapshot = () => reviewClient.snapshot();');
  return w;
}
function click(w, action) {
  const el = w.document.querySelector('[data-action="' + action + '"]');
  if (!el) throw Error('Missing action ' + action); el.click();
}
function input(w, selector, value) {
  const el = w.document.querySelector(selector); if (!el) throw Error('Missing input ' + selector);
  el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true }));
}
async function startedUI() {
  const w = ui(); await until(() => w.document.querySelector('#auth-form'), 'login screen');
  click(w, 'auth-mode:register'); input(w, '#auth-name', 'recovery-ui'); input(w, '#auth-password', 'test-only-2026');
  w.document.querySelector('#auth-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => w.document.querySelector('[data-action="start-candidate"]'), 'registered screen');
  await until(async () => (await (await transport('/api/action-state')).json()).state, 'initial server data');
  click(w, 'start-candidate');
  await until(async () => (await (await transport('/api/action-state')).json()).state.data.events.length === 1, 'active server event');
  return w;
}
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-full-ui-recovery-')); assets = path.join(directory, 'assets');
  const app = createAuthenticatedActionApp({ dataDir: directory, reviewDirectory: assets, rateLimitEnabled: false }).app;
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  cookie = ''; offline = false; windows = [];
});
afterEach(async () => {
  windows.forEach(w => w.close());
  await new Promise(resolve => server.close(resolve));
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected directory');
  fs.rmSync(directory, { recursive: true, force: true });
});

it('publishes a copied own path only after review and browses its full target sequence from another account',async()=>{
 const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:paths');click(w,'fork-path:p-algebra');const p=w.dianliangState.paths.find(p=>!p.seed);click(w,'share-path:'+p.id);await until(()=>w.document.querySelector('#review-path-form'),'path sharing review');const submit=()=>w.document.querySelector('#review-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();expect(w.document.querySelector('#review-path-error').textContent).toContain('明确确认');expect((await(await transport('/api/review-public-paths')).json()).total).toBe(0);w.document.querySelector('#review-path-form [name="consent"]').checked=true;submit();await until(()=>w.document.querySelector('#dialogs').textContent.includes('已公开分享'),'path service published');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.lights).toHaveLength(0);expect(w.dianliangState.paths.find(x=>x.id===p.id).visibility).toBe('private');click(w,'dialog-close');click(w,'review-owned-paths');await until(()=>w.document.querySelector('[data-owned-path]'),'own path history');expect(w.document.querySelector('#owned-path-results').textContent).toContain('1 次保存');await switchUser(w,'path-public-reader');expect(w.document.querySelector('#owned-path-results')).toBeNull();click(w,'group:knowledge');click(w,'nav:paths');click(w,'review-public-paths');await until(()=>w.document.querySelector('#public-path-status').textContent.includes('找到 1'),'peer path catalogue');expect(w.document.querySelector('#public-path-results').textContent).toContain('求出未知数，并代回原方程验证等式成立。');expect(w.document.querySelector('#public-path-results').textContent).toContain('公共节点');expect(w.dianliangState.events).toHaveLength(0);expect(w.dianliangState.paths.some(x=>x.id===p.id)).toBe(false);
});
it('preserves a committed path after a lost acknowledgement and retries without duplicate public versions',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:paths');click(w,'fork-path:p-science');const p=w.dianliangState.paths.find(p=>!p.seed);click(w,'share-path:'+p.id);await until(()=>w.document.querySelector('#review-path-form'),'lost path review');const actual=w.fetch;let drop=true;w.fetch=async(url,o)=>{const r=await actual(url,o);if(drop&&url==='/api/review-path-publications'&&o?.method==='POST'){drop=false;throw new TypeError('Test lost path receipt')}return r};w.document.querySelector('#review-path-form [name="consent"]').checked=true;w.document.querySelector('#review-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#review-path-error')?.textContent.includes('连接未确认'),'lost path retained');expect((await(await transport('/api/review-public-paths')).json()).total).toBe(1);w.document.querySelector('#review-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#dialogs').textContent.includes('已公开分享'),'path retry acknowledged');const own=(await(await transport('/api/review-path-publications')).json()).store;expect(own.entries).toHaveLength(1);expect(own.entries[0].versions).toHaveLength(1);w.document.querySelector('#review-path-form [name="action"]').value='withdraw';w.document.querySelector('#review-path-form [name="consent"]').checked=true;w.document.querySelector('#review-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#dialogs').textContent.includes('已撤回公开'),'path withdrawal acknowledged');expect((await(await transport('/api/review-public-paths')).json()).total).toBe(0);
});
it('does not reopen an old owner path review after another reader signs in during its held receipt read',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:paths');click(w,'fork-path:p-algebra');const p=w.dianliangState.paths.find(p=>!p.seed),held=holdResponse(w,'/api/review-path-publications');click(w,'share-path:'+p.id);await held.wait();await switchUser(w,'path-review-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#review-path-form')).toBeNull();expect(w.document.querySelector('#review-path-loading')).toBeNull();expect(w.dianliangState.user.name).toBe('path-review-next-reader');
});
async function peerPublishedPathUI(personal=false){
 const {authorCookie}=personal?await visiblePeerTutorial():await peerTutorial();const source=(await(await transport('/api/action-state',{headers:{Cookie:authorCookie}})).json());if(!source.state){const n=require('./knowledge-catalog.cjs').loadCatalog().nodes.find(n=>n.originId==='eq');source.state={format:require('./action-state.cjs').FORMAT,data:{schema:1,mode:'local-simulation',events:[],activeId:null,habits:[{id:'h',name:'Read',formedAt:null}],habitId:'h',templates:{},lights:[],nodes:[{...n,id:n.originId,version:n.sourceVersion,methods:[]}]}}}source.state.data.paths=[{id:'peer-path',title:'作者分享的知识路径',nodes:[source.state.data.nodes[0].id],visibility:'private'}];const saved=await transport('/api/action-state',{method:'PUT',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':source.revision},body:JSON.stringify(source.state)});expect(saved.status).toBe(200);const revision=(await saved.json()).revision,plan=(await(await transport('/api/review-path-publications',{headers:{Cookie:authorCookie}})).json());expect((await transport('/api/review-path-publications',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':revision,'If-Path-Match':plan.revision},body:JSON.stringify({pathId:'peer-path',action:'publish',consent:true})})).status).toBe(200);const w=await startedUI();click(w,'group:knowledge');click(w,'nav:paths');click(w,'review-public-paths');await until(()=>w.document.querySelector('[data-public-path-save]'),'peer public path');return {w,authorCookie,path:(await(await transport('/api/review-public-paths')).json()).paths[0]};
}
it('rejects conflicting content links without fetching either item',async()=>{
 const original=await startedUI(),active=original.dianliangState.activeId;
 const cache=original.localStorage.getItem(KEY);
 original.close();
 const params=new URLSearchParams({tutorial:'shared-tutorial',version:'a'.repeat(64),path:'path-'+'b'.repeat(32),pathVersion:'c'.repeat(64)});
 const w=ui(cache,{},'?'+params);
 const reads=[];
 w.fetch=(url,options)=>{
  if(url.startsWith('/api/review-public-tutorials/one')||url.startsWith('/api/review-public-paths/one'))reads.push(url);
  return transport(url,options);
 };
 await until(()=>w.document.getElementById('toast')?.textContent.includes('多个分享目标'),'mixed content link rejected');
 expect(reads).toEqual([]);
 expect(w.document.querySelector('#public-tutorial-link-status, #linked-path-status')).toBeNull();
 expect(w.dianliangState.activeId).toBe(active);
});
it('ignores a shared path response after the reader closes its dialog',async()=>{
 const {w,path:p}=await peerPublishedPathUI();
 const href=new URL(w.document.querySelector('[data-path-link]').href);
 const active=w.dianliangState.activeId,cache=w.localStorage.getItem(KEY);
 w.close();
 const reader=ui(cache,{},href.search);
 const held=holdResponse(reader,'/api/review-public-paths/one?id='+p.id);
 await held.wait();
 const host=reader.document.getElementById('linked-path-content');
 const dialog=host.closest('dialog');
 // Native close clears open before dispatching the queued close event.
 dialog.open=false;
 held.release();
 await new Promise(resolve=>setImmediate(resolve));
 expect(host.textContent).toBe('');
 expect(reader.dianliangState.activeId).toBe(active);
 dialog.dispatchEvent(new reader.Event('close'));
 expect(host.isConnected).toBe(false);
});
it('opens a shared path and distinguishes a revision from a withdrawal',async()=>{
 const {w,path:p,authorCookie}=await peerPublishedPathUI();
 const href=new URL(w.document.querySelector('[data-path-link]').href);
 expect(href.searchParams.get('path')).toBe(p.id);
 expect(href.searchParams.get('pathVersion')).toBe(p.version);
 const active=w.dianliangState.activeId,cache=w.localStorage.getItem(KEY);
 const open=()=>ui(cache,{},href.search);
 cookie='';
 const original=ui(null,{},href.search);
 let reads=0;
 original.fetch=(url,options)=>{
  if(url==='/api/review-public-paths/one?id='+p.id&&++reads===1)return Promise.reject(new original.TypeError('Network disconnected'));
  return transport(url,options);
 };
 await until(()=>original.document.querySelector('#auth-form'),'shared path login gate');
 expect(reads).toBe(0);
 input(original,'#auth-name','recovery-ui');
 input(original,'#auth-password','test-only-2026');
 original.document.querySelector('#auth-form').dispatchEvent(new original.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>original.document.querySelector('#linked-path-retry')?.hidden===false,'shared path retry offered');
 original.document.querySelector('#linked-path-retry').click();
 await until(()=>original.document.querySelector('[data-linked-path-target]'),'linked path visible');
 expect(reads).toBe(2);
 expect(original.document.querySelector('#linked-path-content').textContent).toContain(p.title);
 Object.defineProperty(original.navigator,'clipboard',{value:{writeText:async()=>{throw Error('Denied')}}});
 [...original.document.querySelectorAll('#linked-path-content button')].find(button=>button.textContent==='复制路径链接').click();
 await until(()=>original.document.querySelector('#linked-path-content input')?.hidden===false,'path copy fallback');
 expect(original.document.activeElement.value).toBe(href.href);
 expect(original.document.activeElement.selectionEnd).toBe(href.href.length);
 expect(original.dianliangState.activeId).toBe(active);
 original.close();

 const headers={Cookie:authorCookie,'Content-Type':'application/json'};
 const source=await(await transport('/api/action-state',{headers})).json();
 source.state.data.paths[0].title='修订后的共享路径';
 const saved=await transport('/api/action-state',{method:'PUT',headers:{...headers,'If-Match':source.revision},body:JSON.stringify(source.state)});
 expect(saved.status).toBe(200);
 const actionRevision=(await saved.json()).revision;
 const plan=await(await transport('/api/review-path-publications',{headers})).json();
 const publish=(action,revision)=>transport('/api/review-path-publications',{method:'POST',headers:{...headers,'If-Match':actionRevision,'If-Path-Match':revision},body:JSON.stringify({pathId:'peer-path',action,consent:true})});
 const revised=await publish('publish',plan.revision);
 expect(revised.status).toBe(200);
 const updated=await revised.json();
 const stale=open();
 await until(()=>stale.document.querySelector('#linked-path-status')?.textContent.includes('作者已修订'),'old path version flagged');
 expect(new URL(stale.document.querySelector('#linked-path-content a').href).searchParams.get('pathVersion')).toBe(updated.entry.version);
 expect(stale.document.querySelector('[data-linked-path-target]')).toBeNull();
 stale.close();
 expect((await publish('withdraw',updated.revision)).status).toBe(200);
 const withdrawn=open();
 await until(()=>withdrawn.document.querySelector('#linked-path-status')?.textContent.includes('已不再公开'),'withdrawn path refused');
 expect(withdrawn.document.querySelector('#linked-path-content').textContent).toBe('');
});
it('keeps a peer path version in account bookmarks and starts a goal with its original path reference after reload',async()=>{
 let {w,path:p}=await peerPublishedPathUI(),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-save]').click();await until(()=>w.dianliangState.settings.publicPathBookmarks?.length===1,'path bookmark stored');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'path bookmark acknowledged');const exported=(await(await transport('/api/review-account-export')).json());expect(exported.service.actionState.data.settings.publicPathBookmarks[0]).toEqual(p);expect(w.dianliangState.lights).toHaveLength(0);const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('[data-action^="review-bookmarked-target:"]')&&!w.document.querySelector('#app').inert,'bookmark reload');expect(w.document.querySelector('main').textContent).toContain(p.authorName);w.document.querySelector('[data-action^="review-bookmarked-target:"]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','bookmarked path target');await until(()=>w.document.querySelector('[data-action="practice"]')&&!w.document.querySelector('#app').inert,'target ready');expect(w.dianliangState.activeId).toBe(active);click(w,'practice');const event=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(event.knowledge.pathReference).toEqual({...p,targetIndex:0});expect(w.dianliangState.events.find(e=>e.id===active).endedAt).toBeNull();expect(w.dianliangState.events.find(e=>e.id===active).segments.at(-1).end).not.toBeNull();expect(w.dianliangState.lights).toHaveLength(0);
});
it('uses a personal target from a saved peer path without adopting its ownership and retains its path snapshot in the new event',async()=>{
 const {w,path:p}=await peerPublishedPathUI(true),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-save]').click();await until(()=>w.dianliangState.settings.publicPathBookmarks?.length===1,'personal path bookmark');click(w,'dialog-close');w.document.querySelector('[data-action^="review-bookmarked-target:"]').click();await until(()=>w.document.querySelector('#visible-target-start'),'personal path goal');expect(w.document.querySelector('#dialogs').textContent).toContain('个人持有人');expect(w.dianliangState.nodes.some(n=>n.id===p.targets[0].nodeId)).toBe(false);w.document.querySelector('#visible-target-start').click();await until(()=>w.dianliangState.activeId!==active,'personal path event');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.targetServiceReference.ownerId).toBe(p.targets[0].ownerId);expect(e.knowledge.pathReference).toEqual({...p,targetIndex:0});expect(w.dianliangState.lights).toHaveLength(0);
});
it('retains a withdrawn path bookmark but refuses entering it and permits cancelling only that saved version',async()=>{
 const {w,path:p,authorCookie}=await peerPublishedPathUI(),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-save]').click();await until(()=>w.dianliangState.settings.publicPathBookmarks?.length===1,'withdrawal path bookmark');const plan=(await(await transport('/api/review-path-publications',{headers:{Cookie:authorCookie}})).json());expect((await transport('/api/review-path-publications',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Path-Match':plan.revision},body:JSON.stringify({pathId:'peer-path',action:'withdraw',consent:true})})).status).toBe(200);click(w,'dialog-close');w.document.querySelector('[data-action^="review-bookmarked-target:"]').click();await until(()=>w.document.querySelector('#path-target-loading')?.textContent.includes('已不再公开'),'withdrawn saved path blocked');expect(w.dianliangState.settings.publicPathBookmarks[0]).toEqual(p);expect(w.dianliangState.activeId).toBe(active);click(w,'dialog-close');w.document.querySelector('[data-action^="review-remove-path-bookmark:"]').click();expect(w.dianliangState.settings.publicPathBookmarks).toHaveLength(0);expect(w.dianliangState.activeId).toBe(active);
});
it('isolates saved service path snapshots and rejects a held old target result after account change',async()=>{
 const {w,path:p}=await peerPublishedPathUI();w.document.querySelector('[data-public-path-save]').click();await until(()=>w.dianliangState.settings.publicPathBookmarks?.length===1,'account path bookmark');click(w,'dialog-close');const held=holdResponse(w,'/api/review-public-paths/one?id='+p.id);w.document.querySelector('[data-action^="review-bookmarked-target:"]').click();await held.wait();await switchUser(w,'path-bookmark-new-owner');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#path-target-loading')).toBeNull();expect(w.dianliangState.settings.publicPathBookmarks).toBeUndefined();expect(w.dianliangState.events).toHaveLength(0);expect(w.dianliangState.user.name).toBe('path-bookmark-new-owner');
});
it('retains both the tutorial and path source when starting a personal path target by a peer method',async()=>{
 const {w,path:p}=await peerPublishedPathUI(true),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-target]').click();await until(()=>w.document.querySelector('#visible-method-load'),'path tutorial target');w.document.querySelector('#visible-method-load').click();await until(()=>w.document.querySelector('[data-visible-method-index]'),'path peer tutorial');w.document.querySelector('[data-visible-method-index]').click();await until(()=>w.dianliangState.activeId!==active,'path tutorial started');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.practiceMode).toBe('visible-tutorial');expect(e.knowledge.serviceReference.authorId).toBe(p.targets[0].ownerId);expect(e.knowledge.pathReference).toEqual({...p,targetIndex:0});expect(e.knowledge.resourceLinks).toHaveLength(2);expect(w.dianliangState.lights).toHaveLength(0);
});
it('clears a path selection when browsing a graph node directly instead of carrying an unrelated source into the next event',async()=>{
 const {w}=await peerPublishedPathUI();w.document.querySelector('[data-public-path-target]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','path graph target');click(w,'node:eq');click(w,'practice');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge).not.toHaveProperty('pathReference');
});
it('copies and rearranges a personal peer path privately and publishes the new sequence with its original source and ownership',async()=>{
 const {w,path:parent}=await peerPublishedPathUI(true),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-copy]').click();await until(()=>w.document.querySelector('#copied-path-form'),'private path copy editor');const copy=w.dianliangState.paths.find(p=>p.targetRefs);expect(copy.visibility).toBe('private');expect(copy.bookmarked).toBe(false);expect(copy.sourcePathSnapshot).toEqual(parent);expect(w.dianliangState.nodes.some(n=>n.id===parent.targets[0].nodeId)).toBe(false);input(w,'#copied-path-form [name="title"]','重新编排后的本人路径');w.document.querySelector('#copied-path-add').value=String(w.dianliangState.nodes.findIndex(n=>n.id==='num'));w.document.querySelector('#copied-path-add-button').click();w.document.querySelector('#copied-path-add').value=String(w.dianliangState.nodes.findIndex(n=>n.id==='eq'));w.document.querySelector('#copied-path-add-button').click();w.document.querySelector('[data-copy-down="0"]').click();w.document.querySelector('[data-copy-remove="2"]').click();w.document.querySelector('#copied-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#copied-path-form'),'private rearrangement saved');expect(copy.targetRefs[0]).toEqual({kind:'local',nodeId:'num'});expect(copy.targetRefs[1].target).toEqual(parent.targets[0]);expect(copy.sourcePathSnapshot).toEqual(parent);expect(w.dianliangState.activeId).toBe(active);click(w,'share-path:'+copy.id);await until(()=>w.document.querySelector('#review-path-form'),'copied path sharing');expect(w.document.querySelector('#dialogs').textContent).toContain(parent.targets[0].goal);w.document.querySelector('#review-path-form [name="consent"]').checked=true;w.document.querySelector('#review-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#dialogs').textContent.includes('已公开分享'),'copy published');const pub=(await(await transport('/api/review-public-paths')).json()).paths.find(p=>p.title===copy.title);expect(pub.sourcePath.authorId).toBe(parent.authorId);expect(pub.targets.map(t=>t.ownership)).toEqual(['group','personal']);expect(pub.targets[1].ownerId).toBe(parent.targets[0].ownerId);expect(w.dianliangState.lights).toHaveLength(0);
});
it('starts a personal goal from a private path copy even after the parent path is withdrawn without changing its node ownership',async()=>{
 const {w,path:parent,authorCookie}=await peerPublishedPathUI(true),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-copy]').click();await until(()=>w.document.querySelector('#copied-path-form'),'copied personal path editor');w.document.querySelector('#copied-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#copied-path-form'),'copy saved');const copy=w.dianliangState.paths.find(p=>p.targetRefs),plan=(await(await transport('/api/review-path-publications',{headers:{Cookie:authorCookie}})).json());expect((await transport('/api/review-path-publications',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Path-Match':plan.revision},body:JSON.stringify({pathId:'peer-path',action:'withdraw',consent:true})})).status).toBe(200);w.document.querySelector('[data-action^="review-copy-target:"]').click();await until(()=>w.document.querySelector('#visible-target-start'),'private copy still public target');w.document.querySelector('#visible-target-start').click();await until(()=>w.dianliangState.activeId!==active,'copied path goal started');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.pathReference.kind).toBe('private-copy');expect(e.knowledge.pathReference.copyId).toBe(copy.id);expect(e.knowledge.pathReference.sourcePath).toEqual(parent);expect(e.knowledge.targetServiceReference.ownerId).toBe(parent.targets[0].ownerId);expect(w.dianliangState.nodes.some(n=>n.id===parent.targets[0].nodeId)).toBe(false);
});
it('refuses a withdrawn copied target while preserving the private order and closes its editor on account change',async()=>{
 const {w,path:parent,authorCookie}=await peerPublishedPathUI(true),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-copy]').click();await until(()=>w.document.querySelector('#copied-path-form'),'copy editor');w.document.querySelector('#copied-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#copied-path-form'),'copy saved');const copy=w.dianliangState.paths.find(p=>p.targetRefs),source=(await(await transport('/api/action-state',{headers:{Cookie:authorCookie}})).json()),nodeId=source.state.data.nodes[0].id,plan=(await(await transport('/api/review-target-sharing?nodeId='+nodeId,{headers:{Cookie:authorCookie}})).json());expect((await transport('/api/review-target-sharing',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':source.revision,'If-Target-Match':plan.revision},body:JSON.stringify({nodeId,sourceVersion:1,action:'withdraw',consent:true})})).status).toBe(200);w.document.querySelector('[data-action^="review-copy-target:"]').click();await until(()=>w.document.querySelector('#copied-target-loading')?.textContent.includes('目标已撤回'),'withdrawn copied node blocked');expect(w.dianliangState.activeId).toBe(active);expect(copy.targetRefs[0].target).toEqual(parent.targets[0]);click(w,'dialog-close');w.document.querySelector('[data-action^="review-edit-path-copy:"]').click();await until(()=>w.document.querySelector('#copied-path-form'),'copy reopened');await switchUser(w,'path-copy-new-reader');expect(w.document.querySelector('#copied-path-form')).toBeNull();expect(w.dianliangState.paths.some(p=>p.targetRefs)).toBe(false);
});
it('starts and archives an independent public goal from a private copy with both its own order and original path source intact',async()=>{
 const {w,path:parent}=await peerPublishedPathUI(),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-copy]').click();await until(()=>w.document.querySelector('#copied-path-form'),'canonical copy editor');w.document.querySelector('#copied-path-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#copied-path-form'),'canonical copy saved');const copy=w.dianliangState.paths.find(p=>p.targetRefs);w.document.querySelector('[data-action^="review-copy-target:"]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','copied canonical target');expect(w.dianliangState.activeId).toBe(active);click(w,'practice');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.pathReference.kind).toBe('private-copy');expect(e.knowledge.pathReference.copyId).toBe(copy.id);expect(e.knowledge.pathReference.sourcePath).toEqual(parent);click(w,'finish:'+e.id);click(w,'review-practice-open:'+e.id);await until(()=>w.document.querySelector('#review-practice-form'),'copied goal archive');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'copied goal saved');const archive=(await(await transport('/api/review-practices')).json()).receipts.find(p=>p.record.eventId===e.id);expect(archive.sourceSnapshot.pathReference.sourcePath).toEqual(parent);expect(archive.sourceSnapshot.pathReference.targets[0].goal).toBe(parent.targets[0].goal);expect(archive.record.visibility).toBe('private');expect(archive.record.lightUp).toBe(false);
});
it('connects path author browsing to current public introduction and tutorials and returns to only that author paths',async()=>{
 const {w,path:p}=await peerPublishedPathUI(),active=w.dianliangState.activeId;fs.writeFileSync(require('node:path').join(directory,'profiles.json'),JSON.stringify([{id:p.authorId,visibility:'public',tagline:'公开路径作者介绍',about:'按目标解释行动顺序',focus:'代数',secret:'PRIVATE-PATH-AUTHOR'}]));w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-details'),'author path scope');expect(w.document.querySelector('#dialogs').textContent).toContain(p.authorName+'的公开路径');w.document.querySelector('#public-path-author-details').click();await until(()=>w.document.querySelector('#public-author-paths'),'path author tutorial tools');expect(w.document.querySelector('#dialogs').textContent).toContain('公开路径作者介绍');expect(w.document.querySelector('#dialogs').textContent).not.toContain('PRIVATE-PATH-AUTHOR');w.document.querySelector('#public-author-paths').click();await until(()=>w.document.querySelector('#public-path-status')?.textContent.includes('找到 1'),'author path return');expect(w.document.querySelector('#public-path-author-clear')).not.toBeNull();expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.lights).toHaveLength(0);
});
it('does not reopen an old path author introduction after another account replaces the reader',async()=>{
 const {w,path:p}=await peerPublishedPathUI();w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-status')?.textContent.includes('找到 1'),'author scope read');const held=holdResponse(w,'/api/review-public-tutorials/author?id='+p.authorId);w.document.querySelector('#public-path-author-details').click();await held.wait();await switchUser(w,'path-author-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#public-author-paths')).toBeNull();expect(w.document.querySelector('#public-path-form')).toBeNull();expect(w.dianliangState.user.name).toBe('path-author-next-reader');
});
it('shows an actual public author main page with tutorials practices and paths while retaining private introduction and the reader clock',async()=>{
 const {w,path:p,authorCookie}=await peerPublishedPathUI(),active=w.dianliangState.activeId;expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'作者主页公开实践',visibility:'public',lightUp:false})})).status).toBe(201);fs.writeFileSync(require('node:path').join(directory,'profiles.json'),JSON.stringify([{id:p.authorId,visibility:'private',tagline:'PRIVATE-HOME-TAG',about:'PRIVATE-HOME-ABOUT',focus:'PRIVATE-HOME-FOCUS'}]));w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-home'),'author home入口');w.document.querySelector('#public-path-author-home').click();await until(()=>w.document.querySelector('#author-tutorials-status')?.textContent.includes('1 条')&&w.document.querySelector('#author-practices-status')?.textContent.includes('1 条')&&w.document.querySelector('#author-paths-status')?.textContent.includes('1 条'),'author all sections');expect(w.document.querySelector('main').dataset.page).toBe('author');expect(w.document.querySelector('[data-action="nav:author"]')).not.toBeNull();expect(w.document.querySelector('main').textContent).not.toContain('PRIVATE-HOME-');expect(w.document.querySelector('#public-author-page-intro').textContent).toContain('尚未公开');expect(w.document.querySelector('#author-practices-results').textContent).toContain('作者主页公开实践');expect(w.document.querySelector('#author-paths-results').textContent).toContain(p.title);expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('#author-paths-browse').click();await until(()=>w.document.querySelector('#public-path-author-clear'),'author path full directory');expect(w.dianliangState.activeId).toBe(active);
});
it('keeps the public author other sections usable when one category read fails and restores the category only on retry',async()=>{
 const {w,path:p}=await peerPublishedPathUI(),active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-home'),'author scope');const actual=w.fetch;let fail=true;w.fetch=(url,o)=>fail&&url==='/api/review-public-paths?query=&authorId='+p.authorId?Promise.reject(new w.TypeError('Test paths unavailable')):actual(url,o);w.document.querySelector('#public-path-author-home').click();await until(()=>w.document.querySelector('#author-paths-results button')?.textContent==='重新读取公开路径','independent category retry');await until(()=>w.document.querySelector('#author-tutorials-status')?.textContent.includes('1 条'),'tutorials still readable');expect(w.document.querySelector('#author-paths-status').textContent).toContain('读取未确认');expect(w.document.querySelector('#author-paths-status').textContent).not.toContain('0 条');fail=false;w.document.querySelector('#author-paths-results button').click();await until(()=>w.document.querySelector('#author-paths-status').textContent.includes('1 条'),'category retried');expect(w.document.querySelector('#author-tutorials-results').textContent).toContain('代回');expect(w.dianliangState.activeId).toBe(active);
});
it('discards held public author contents after a different reader logs in and never restores the old selected author',async()=>{
 const {w,path:p}=await peerPublishedPathUI();w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-home'),'old author home scope');const held=holdResponse(w,'/api/review-public-practices?query=&authorId='+p.authorId);w.document.querySelector('#public-path-author-home').click();await held.wait();await switchUser(w,'public-home-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#public-author-page')).toBeNull();expect(w.dianliangState.settings.publicAuthorSelection).toBeUndefined();expect(w.dianliangState.events).toHaveLength(0);expect(w.dianliangState.user.name).toBe('public-home-next-reader');
});
it('restores the public author main page after reload and preserves the original reader activity while starting only on an explicit goal action',async()=>{
 let {w,path:p}=await peerPublishedPathUI();const active=w.dianliangState.activeId;w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-home'),'author header');w.document.querySelector('#public-path-author-home').click();await until(()=>w.document.querySelector('#author-paths-status')?.textContent.includes('1 条'),'author home before reload');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'author selection saved');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('#author-paths-results [data-author-path-save]'),'author home reloaded');expect(w.dianliangState.settings.publicAuthorSelection.id).toBe(p.authorId);expect(w.document.querySelector('main').dataset.page).toBe('author');expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('[data-author-path-save]').click();await until(()=>w.dianliangState.settings.publicPathBookmarks?.length===1,'author page path bookmark');expect(w.dianliangState.settings.publicPathBookmarks[0]).toEqual(p);w.document.querySelector('[data-author-path-target]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','author path goal entered');expect(w.dianliangState.activeId).toBe(active);click(w,'practice');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.id).not.toBe(active);expect(e.knowledge.pathReference.id).toBe(p.id);expect(w.dianliangState.events.find(e=>e.id===active).endedAt).toBeNull();
});
it('opens an exact public author link after connecting the reader account and removes the route when leaving without switching the active event',async()=>{
 let {w,path:p}=await peerPublishedPathUI();const active=w.dianliangState.activeId;await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'reader cache acknowledged');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache,{},'?author='+p.authorId);await until(()=>w.document.querySelector('#author-paths-status')?.textContent.includes('1 条'),'linked author loaded');expect(w.document.querySelector('main').dataset.page).toBe('author');expect(w.dianliangState.settings.publicAuthorSelection.id).toBe(p.authorId);const href=new URL(w.document.querySelector('#public-author-page-link').href);expect(href.searchParams.get('author')).toBe(p.authorId);expect(href.searchParams.size).toBe(1);expect(href.pathname).toBe('/review/');expect(w.document.querySelector('#public-author-page-name').textContent).toBe(p.authorName);expect(w.document.querySelector('#public-author-page-avatar').textContent).toBe(Array.from(p.authorName)[0]);expect(w.dianliangState.activeId).toBe(active);click(w,'nav:atlas');expect(w.location.search).toBe('');expect(w.dianliangState.activeId).toBe(active);
});
it('keeps the author destination when an old tutorial and comment are also in the URL',async()=>{
 const {w:original,path:p}=await peerPublishedPathUI();
 const active=original.dianliangState.activeId;
 await until(()=>!JSON.parse(original.localStorage.getItem(KEY)).reviewSync.pending,'reader cache acknowledged');
 const cache=original.localStorage.getItem(KEY);
 original.close();
 const query=new URLSearchParams({author:p.authorId,tutorial:'old-tutorial',version:'a'.repeat(64),comment:'old-comment'});
 const w=ui(cache,{},'?'+query);
 await until(()=>w.document.querySelector('#author-paths-status')?.textContent.includes('1 条'),'author loaded from mixed route');
 expect(w.location.search).toBe('?author='+p.authorId);
 expect(w.document.querySelector('#public-tutorial-link-status')).toBeNull();
 expect(w.dianliangState.activeId).toBe(active);
});
it('retains an author destination through required login without leaking a prior reader cache or creating a new event',async()=>{
 let {w,path:p}=await peerPublishedPathUI();const active=w.dianliangState.activeId;await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'login link cache');w.close();cookie='';w=ui(null,{},'?author='+p.authorId);await until(()=>w.document.querySelector('#auth-form'),'linked author login');expect(w.document.querySelector('#public-author-page')).toBeNull();input(w,'#auth-name','recovery-ui');input(w,'#auth-password','test-only-2026');w.document.querySelector('#auth-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#author-paths-status')?.textContent.includes('1 条'),'linked destination after login');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events).toHaveLength(1);expect(w.dianliangState.settings.publicAuthorSelection.id).toBe(p.authorId);
});
it('rejects ambiguous author links and shows unavailable authors without falling back to a different author content',async()=>{
 let {w,path:p}=await peerPublishedPathUI();const active=w.dianliangState.activeId;await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'invalid link cache');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache,{},'?author='+p.authorId+'&author=other-author');await until(()=>w.document.querySelector('#app').getAttribute('aria-busy')==='false'&&w.dianliangState.user?.reviewService,'invalid route connected');expect(w.document.querySelector('#public-author-page')).toBeNull();expect(w.dianliangState.activeId).toBe(active);w.close();w=ui(cache,{},'?author=missing-author');await until(()=>w.document.querySelector('#public-author-page-error')?.textContent,'missing linked author');expect(w.document.querySelector('#public-author-page-content').textContent).toBe('');expect(w.document.querySelector('main').textContent).not.toContain(p.title);expect(w.dianliangState.activeId).toBe(active);
});
async function followableAuthorUI(){const fixture=await peerPublishedPathUI();const {w}=fixture;w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-home'),'follow author entrance');w.document.querySelector('#public-path-author-home').click();await until(()=>w.document.querySelector('#public-author-follow'),'followable author');return fixture}
it('shares the same tutorial version from the author profile, discovery and following',async()=>{
 const {w}=await followableAuthorUI(),active=w.dianliangState.activeId;
 const authorLink=()=>w.document.querySelector('[data-author-tutorial-link]');
 await until(authorLink,'author tutorial link ready');
 const href=authorLink().href,linked=new URL(href);
 const tutorial=(await(await transport('/api/review-public-tutorials')).json()).tutorials[0];
 expect(linked.searchParams.get('tutorial')).toBe(tutorial.id);
 expect(linked.searchParams.get('version')).toBe(tutorial.version);
 w.document.querySelector('#public-author-follow').click();
 await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'author followed');
 click(w,'nav:discover');
 await until(()=>w.document.querySelector('[data-feed-tutorial-link]'),'discovery tutorial link ready');
 expect(w.document.querySelector('[data-feed-tutorial-link]').href).toBe(href);
 click(w,'nav:following');
 await until(()=>w.document.querySelector('[data-feed-tutorial-link]'),'following tutorial link ready');
 expect(w.document.querySelector('[data-feed-tutorial-link]').href).toBe(href);
 expect(w.dianliangState.activeId).toBe(active);
},15000);
it('keeps a followed feed cursor usable after an unfollowed author publishes, while discovery refreshes',async()=>{
 const {w}=await followableAuthorUI();
 w.document.querySelector('#public-author-follow').click();
 await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'author followed');
 const following='/api/review-following-feed?limit=1',discovery='/api/review-community-feed?limit=1';
 const first=(await(await transport(following)).json()),publicFirst=(await(await transport(discovery)).json());
 expect(first.nextCursor).toBeTruthy();
 expect(publicFirst.nextCursor).toBeTruthy();
 const target={treeId:'dianliang-review-catalog-v1',nodeId:'od-eq'};
 const post=(url,body)=>transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...target,...body})});
 expect((await post('/api/records',{text:'读者也完成了一次独立验证。',lightUp:true,visibility:'private'})).status).toBe(201);
 expect((await post('/api/tutorials',{title:'未关注账号公开的方法',method:'核对两侧是否相等。',visibility:'public'})).status).toBe(201);
 const next=await transport(following+'&cursor='+encodeURIComponent(first.nextCursor));
 expect(next.status).toBe(200);
 expect((await next.json()).entries[0].key).not.toBe(first.entries[0].key);
 expect((await transport(discovery+'&cursor='+encodeURIComponent(publicFirst.nextCursor))).status).toBe(409);
 expect((await transport('/api/review-following-feed?limit=2&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);
},15000);
it('follows an actual author privately across reload export and cancellation without switching the event or leaking the list to another reader',async()=>{
 let {w,path:p}=await followableAuthorUI();const active=w.dianliangState.activeId;w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'author followed');expect(w.dianliangState.settings.followedAuthors).toHaveLength(1);expect(w.dianliangState.settings.followedAuthors[0]).toMatchObject({id:p.authorId,name:p.authorName});expect(w.dianliangState.activeId).toBe(active);const backup=await(await transport('/api/review-account-export')).json();expect(backup.service.actionState.data.settings.followedAuthors).toEqual(w.dianliangState.settings.followedAuthors);await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'follow acknowledged');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('#public-author-follow')?.textContent==='取消关注','follow reloaded');click(w,'nav:following');await until(()=>w.document.querySelector('[data-followed-open]'),'follow list');input(w,'#followed-author-search input','not-a-name');expect(w.document.querySelector('[data-followed-open]')).toBeNull();input(w,'#followed-author-search input',p.authorName);w.document.querySelector('[data-followed-open]').click();await until(()=>w.document.querySelector('#public-author-follow'),'followed author opened');expect(w.dianliangState.activeId).toBe(active);click(w,'nav:following');await until(()=>w.document.querySelector('[data-followed-remove]'),'follow removal list ready');w.document.querySelector('[data-followed-remove]').click();await until(()=>w.dianliangState.settings.followedAuthors.length===0&&!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'follow removed');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('0 条'),'cancel refreshes followed feed');expect(w.dianliangState.activeId).toBe(active);await switchUser(w,'following-next-reader');click(w,'group:knowledge');click(w,'nav:following');expect(w.dianliangState.settings.followedAuthors).toBeUndefined();expect(w.document.querySelector('[data-followed-open]')).toBeNull();
});
it('keeps a failed follow save as a private pending choice and retries synchronization without duplicating the author',async()=>{
 const {w,path:p}=await followableAuthorUI(),active=w.dianliangState.activeId,actual=w.fetch;w.fetch=async(url,o)=>{const r=await actual(url,o);if(url==='/api/review-public-tutorials/author?id='+p.authorId)offline=true;return r};w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#review-sync-warning'),'follow save disconnected');expect(w.dianliangState.settings.followedAuthors).toHaveLength(1);expect(w.dianliangState.activeId).toBe(active);offline=false;w.fetch=actual;click(w,'review-sync-retry');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'follow retry acknowledged');const remote=await(await transport('/api/action-state')).json();expect(remote.state.data.settings.followedAuthors).toHaveLength(1);expect(remote.state.data.settings.followedAuthors[0].id).toBe(p.authorId);
});
it('does not claim a saved follow when author verification is offline and permits removing a self entry retained from an imported private list',async()=>{
 const {w}=await followableAuthorUI(),active=w.dianliangState.activeId;offline=true;w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('尚未改变关注'),'verification failed before changing choice');expect(w.dianliangState.settings.followedAuthors).toBeUndefined();offline=false;w.dianliangState.settings.followedAuthors=[{id:w.dianliangState.user.id,name:w.dianliangState.user.name,followedAt:1}];click(w,'nav:following');await until(()=>w.document.querySelector('[data-followed-remove]'),'imported self entry');w.document.querySelector('[data-followed-remove]').click();await until(()=>w.dianliangState.settings.followedAuthors.length===0&&!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'imported self entry removed');expect(w.dianliangState.activeId).toBe(active);
});
it('discards an old author verification after account change without adding the follow to the new account',async()=>{
 const {w,path:p}=await followableAuthorUI(),held=holdResponse(w,'/api/review-public-tutorials/author?id='+p.authorId);w.document.querySelector('#public-author-follow').click();await held.wait();await switchUser(w,'follow-held-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.dianliangState.settings.followedAuthors).toBeUndefined();expect(w.document.querySelector('#public-author-follow')).toBeNull();expect(w.dianliangState.events).toHaveLength(0);
});
it('refuses invalid followed author fields and duplicate identities without changing the stored reader state',async()=>{
 const {w,path:p}=await followableAuthorUI(),current=await(await transport('/api/action-state')).json();for(const list of [[{id:p.authorId,name:p.authorName,followedAt:1,secret:'PRIVATE'}],[{id:p.authorId,name:p.authorName,followedAt:1},{id:p.authorId,name:p.authorName,followedAt:2}],[{id:'bad/id',name:p.authorName,followedAt:1}]]){const state=JSON.parse(JSON.stringify(current.state));state.data.settings.followedAuthors=list;expect((await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':current.revision},body:JSON.stringify(state)})).status).toBe(400)}expect((await(await transport('/api/action-state')).json()).revision).toBe(current.revision);expect(w.dianliangState.settings.followedAuthors).toBeUndefined();
});
it('takes a new reader from empty following to discovery and back to their first followed posts',async()=>{
 const {w,path:p}=await peerPublishedPathUI();
 const active=w.dianliangState.activeId;
 click(w,'dialog-close');
 click(w,'nav:following');
 await until(()=>w.document.querySelector('[data-feed-discover]'),'empty following action');
 w.document.querySelector('[data-feed-discover]').click();
 await until(()=>w.document.querySelector('[data-feed-author]'),'discovery authors available');
 w.document.querySelector('[data-feed-author]').click();
 await until(()=>w.document.getElementById('public-author-follow'),'discovered author profile');
 expect(w.document.getElementById('public-author-page-name').textContent).toBe(p.authorName);
 w.document.getElementById('public-author-follow').click();
 await until(()=>w.document.getElementById('public-author-follow').textContent==='取消关注','first author followed');
 click(w,'nav:following');
 await until(()=>w.document.querySelector('#following-feed-results article'),'first followed posts loaded');
 expect(w.document.querySelector('#following-feed-results').textContent).toContain(p.title);
 expect(w.document.querySelector('[data-feed-discover]')).toBeNull();
 expect(w.dianliangState.activeId).toBe(active);
});
it('reads only followed authors current public tutorials practices and paths and keeps goal entry separate from starting an event',async()=>{
 const {w,path:p,authorCookie}=await followableAuthorUI(),active=w.dianliangState.activeId;for(const visibility of ['public','private'])expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:visibility==='public'?'关注作者公开实践':'PRIVATE-FOLLOW-PRACTICE',visibility,lightUp:false})})).status).toBe(201);expect((await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'UNFOLLOWED-READER-PRACTICE',visibility:'public',lightUp:false})})).status).toBe(201);w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'feed author followed');click(w,'nav:following');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('3 条'),'three category feed');const r=await(await transport('/api/review-following-feed')).json();expect(r.entries.map(e=>e.type).sort()).toEqual(['path','practice','tutorial']);expect(r.entries.every(e=>e.authorId===p.authorId)).toBe(true);const practice=r.entries.find(e=>e.type==='practice');expect(practice.title).toBe('当前关联目标 · '+practice.item.currentTarget.title);expect(practice.item.snapshotStatus).not.toBe('bound');expect(JSON.stringify(r)).not.toContain('PRIVATE-FOLLOW-');expect(JSON.stringify(r)).not.toContain('UNFOLLOWED-');expect(w.dianliangState.activeId).toBe(active);const select=w.document.querySelector('#following-feed-form select');select.value='tutorial';select.dispatchEvent(new w.Event('change',{bubbles:true}));w.document.querySelector('#following-feed-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('1 条'),'tutorial feed filtered');w.document.querySelector('[data-feed-open]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','feed tutorial target entered');expect(w.dianliangState.activeId).toBe(active);
});
it('removes withdrawn followed content while retaining the private follow and refuses entering a stale tutorial card without switching the reader event',async()=>{
 const {w,path:p,authorCookie}=await followableAuthorUI(),active=w.dianliangState.activeId;const posted=await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'关注撤回验收实践',visibility:'public',lightUp:false})});expect(posted.status).toBe(201);const record=(await posted.json()).record;w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'withdrawal author followed');click(w,'nav:following');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('3 条'),'withdrawal initial feed');const first=await(await transport('/api/review-following-feed?limit=1')).json(),all=await(await transport('/api/review-following-feed')).json(),tutorial=all.entries.find(e=>e.type==='tutorial').item;
 expect((await transport('/api/records/'+record.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})})).status).toBe(200);expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);w.document.querySelector('[data-feed-discuss]').closest('article').querySelector('[data-feed-open]').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('不可公开读取'),'stale tutorial denied');expect(w.document.querySelector('main').dataset.page).toBe('following');expect(w.dianliangState.activeId).toBe(active);
 const plan=await(await transport('/api/review-path-publications',{headers:{Cookie:authorCookie}})).json();expect((await transport('/api/review-path-publications',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Path-Match':plan.revision},body:JSON.stringify({pathId:'peer-path',action:'withdraw',consent:true})})).status).toBe(200);expect((await transport('/api/review-following-feed?limit=1&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);w.document.querySelector('#following-feed-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('0 条'),'withdrawal feed empty');expect(w.dianliangState.settings.followedAuthors[0].id).toBe(p.authorId);expect(w.document.querySelector('[data-followed-remove]')).not.toBeNull();expect(w.dianliangState.activeId).toBe(active);const ownerRecords=await(await transport('/api/records',{headers:{Cookie:authorCookie}})).json();expect(ownerRecords.records.find(r=>r.id===record.id).visibility).toBe('private');
},15000);
it('requires rereading a revised followed tutorial and preserves the earlier event method version and materials when starting the new version',async()=>{
 const {w,authorCookie}=await followableAuthorUI(),seedEvent=w.dianliangState.activeId;w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'revision author followed');click(w,'nav:following');await until(()=>w.document.querySelector('[data-feed-discuss]'),'initial followed tutorial');const first=await(await transport('/api/review-following-feed?limit=1')).json(),original=(await(await transport('/api/review-following-feed')).json()).entries.find(e=>e.type==='tutorial').item;expect(w.document.querySelector('[data-feed-tutorial-version]').textContent).toContain(original.version.slice(0,8));w.document.querySelector('[data-feed-discuss]').closest('article').querySelector('[data-feed-open]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','original method entered');click(w,'practice');const firstEvent=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId),savedKnowledge=JSON.parse(JSON.stringify(firstEvent.knowledge));expect(firstEvent.id).not.toBe(seedEvent);expect(firstEvent.knowledge.serviceReference.version).toBe(original.version);await until(()=>w.dianliangState.nodes.find(n=>n.id===firstEvent.knowledge.nodeId).methods.find(m=>m.id===firstEvent.knowledge.methodId)?.serviceBinding?.version===original.version,'original binding acknowledged');click(w,'group:knowledge');click(w,'nav:following');await until(()=>w.document.querySelector('[data-feed-discuss]'),'old version card reloaded');
 const newResources=[{label:'修订后练习材料',url:'https://example.com/revised-practice',optional:true,affiliate:false}],changed=await transport('/api/tutorials/'+original.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':original.version},body:JSON.stringify({method:'修订后的完整方法：先逐步求解，再独立代回检查。',startAction:'先写出代回检验的两边结果。',resources:newResources})});expect(changed.status).toBe(200);const revised=(await changed.json()).tutorial;expect(revised.version).not.toBe(original.version);w.document.querySelector('[data-feed-open]').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('已变化'),'old followed method refreshed');expect(w.document.querySelector('#tutorial-discussion-form')).toBeNull();expect(w.document.querySelector('main').dataset.page).toBe('following');expect(w.dianliangState.activeId).toBe(firstEvent.id);expect((await transport('/api/review-following-feed?limit=1&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);expect(w.document.querySelector('[data-feed-tutorial-version]').textContent).toContain(revised.version.slice(0,8));expect(w.dianliangState.events.find(e=>e.id===firstEvent.id).knowledge).toEqual(savedKnowledge);w.document.querySelector('[data-feed-discuss]').closest('article').querySelector('[data-feed-open]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','revised method entered');expect(w.dianliangState.activeId).toBe(firstEvent.id);click(w,'practice');const newEvent=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(newEvent.id).not.toBe(firstEvent.id);expect(newEvent.knowledge.serviceReference.version).toBe(revised.version);expect(newEvent.knowledge.resourceLinks).toEqual(newResources);await until(()=>w.dianliangState.nodes.find(n=>n.id===newEvent.knowledge.nodeId).methods.find(m=>m.id===newEvent.knowledge.methodId)?.serviceBinding?.version===revised.version,'revised binding acknowledged');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'revised practice synced');expect(w.dianliangState.events.find(e=>e.id===firstEvent.id).knowledge).toEqual(savedKnowledge);expect(w.dianliangState.events.find(e=>e.id===firstEvent.id).endedAt).toBeNull();expect(w.dianliangState.lights).toHaveLength(0);
},15000);
it('keeps the followed tutorial card in place until its selected method is loaded and ignores a held load after the reader leaves',async()=>{
 const {w}=await followableAuthorUI(),active=w.dianliangState.activeId;w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'held method author followed');click(w,'nav:following');await until(()=>w.document.querySelector('[data-feed-discuss]'),'held method feed loaded');const held=holdResponse(w,'/api/review-shared-methods?nodeId=eq');w.document.querySelector('[data-feed-discuss]').closest('article').querySelector('[data-feed-open]').click();await held.wait();expect(w.document.querySelector('main').dataset.page).toBe('following');expect(w.dianliangState.activeId).toBe(active);expect(w.document.querySelector('[data-action="practice"]')).toBeNull();click(w,'nav:paths');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('main').dataset.page).toBe('paths');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events).toHaveLength(1);
});
it('discovers actual public tutorials practices and paths from multiple authors without requiring follows or exposing private contents',async()=>{
 const {w,path:p,authorCookie}=await peerPublishedPathUI(),active=w.dianliangState.activeId;for(const visibility of ['public','private'])expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:visibility==='public'?'发现作者公开实践':'PRIVATE-DISCOVERY',visibility,lightUp:false})})).status).toBe(201);expect((await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'另一作者的公开实践',visibility:'public',lightUp:false})})).status).toBe(201);click(w,'dialog-close');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('4 条'),'public discovery content');const r=await(await transport('/api/review-community-feed')).json();expect(r.scope).toBe('community');expect(r.followedCount).toBeNull();expect(r.entries.map(e=>e.type).sort()).toEqual(['path','practice','practice','tutorial']);expect(new Set(r.entries.map(e=>e.authorId)).size).toBe(2);expect(JSON.stringify(r)).not.toContain('PRIVATE-DISCOVERY');const goalSearch=await(await transport('/api/review-community-feed?query='+encodeURIComponent(p.targets[0].goal))).json();expect(goalSearch.total).toBe(4);expect((await(await transport('/api/review-following-feed')).json()).total).toBe(0);expect(w.dianliangState.settings.followedAuthors).toBeUndefined();const select=w.document.querySelector('#following-feed-form select');select.value='tutorial';select.dispatchEvent(new w.Event('change',{bubbles:true}));w.document.querySelector('#following-feed-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('1 条'),'discovery tutorial filter');expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('[data-feed-author]').click();await until(()=>w.document.querySelector('#author-tutorials-status')?.textContent.includes('1 条'),'discovered author homepage');expect(w.dianliangState.settings.publicAuthorSelection.id).toBe(p.authorId);expect(w.dianliangState.activeId).toBe(active);
});
it('ranks exact discovery titles above newer body matches while keeping the unfiltered feed recent',async()=>{
 const {path:p,w}=await peerPublishedPathUI();
 const created=await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'练习参考：'+p.title,visibility:'public'})});
 expect(created.status).toBe(201);
 const record=(await created.json()).record;
 const route='/api/review-community-feed';
 const recent=await(await transport(route)).json();
 expect(recent.entries[0].item.id).toBe(record.id);
 const search=await(await transport(route+'?limit=1&query='+encodeURIComponent(p.title))).json();
 expect(search.entries[0].item.id).toBe(p.id);
 expect(search.nextCursor).toBeTruthy();
 const next=await(await transport(route+'?limit=1&query='+encodeURIComponent(p.title)+'&cursor='+encodeURIComponent(search.nextCursor))).json();
 expect(next.entries[0].item.id).toBe(record.id);
 const recentSearch=route+'?limit=1&order=recent&query='+encodeURIComponent(p.title);
 const sorted=await(await transport(recentSearch)).json();
 expect(sorted.order).toBe('recent');
 expect(sorted.entries[0].item.id).toBe(record.id);
 expect((await transport(recentSearch+'&cursor='+encodeURIComponent(search.nextCursor))).status).toBe(409);
 const recentNext=await(await transport(recentSearch+'&cursor='+encodeURIComponent(sorted.nextCursor))).json();
 expect(recentNext.entries[0].item.id).toBe(p.id);
 click(w,'dialog-close');click(w,'nav:discover');
 await until(()=>w.document.querySelector('#following-feed-form'),'discovery search form');
 const form=w.document.querySelector('#following-feed-form');
 form.elements.query.value=p.title;
 form.elements.order.value='recent';
 form.elements.order.dispatchEvent(new w.Event('change',{bubbles:true}));
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#following-feed-results article')?.textContent.includes('练习参考'),'recent search starts with the newer practice');
 expect(w.dianliangState.settings.publicFeedViews.community).toMatchObject({order:'recent',query:p.title});
});
it('finds discovery results when author and goal keywords match different public fields',async()=>{
 const {w,path:p}=await peerPublishedPathUI();
 const active=w.dianliangState.activeId;
 click(w,'dialog-close');
 click(w,'nav:discover');
 const form=w.document.getElementById('following-feed-form');
 const query=p.targets[0].goal+'　'+p.authorName.toUpperCase();
 input(w,'#following-feed-form [name="query"]',query);
 form.elements.kind.value='path';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('找到 1 条'),'combined discovery keywords');
 expect(w.document.querySelector('#following-feed-results h3').textContent).toBe(p.title);
 input(w,'#following-feed-form [name="query"]',query+' 不存在的关键词');
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('找到 0 条'),'all discovery keywords required');
 w.document.querySelector('[data-feed-clear]').click();
 await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('找到 2 条'),'discovery cleared to unfiltered feed');
 expect(form.elements.query.value).toBe('');
 expect(form.elements.kind.value).toBe('all');
 expect(w.document.activeElement).toBe(form.elements.query);
 expect(w.dianliangState.settings.publicFeedViews.community).toMatchObject({query:'',kind:'all',cursor:'',history:[]});
 expect(w.dianliangState.activeId).toBe(active);
});
it('isolates community discovery cursors from followed scope and keeps discovery independent of unreadable private follows',async()=>{
 const {w}=await peerPublishedPathUI(),first=await(await transport('/api/review-community-feed?limit=1')).json();expect(first.total).toBe(2);const next=await(await transport('/api/review-community-feed?limit=1&cursor='+encodeURIComponent(first.nextCursor))).json();expect(next.entries).toHaveLength(1);expect(next.entries[0].key).not.toBe(first.entries[0].key);expect((await transport('/api/review-following-feed?limit=1&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);expect((await transport('/api/review-community-feed',{headers:{Cookie:''}})).status).toBe(401);expect((await transport('/api/review-community-feed',{headers:{Origin:'https://foreign.example'}})).status).toBe(403);expect((await transport('/api/review-community-feed',{headers:{'X-Action-Account':'different-account'}})).status).toBe(409);const file=path.join(directory,'action-states',w.dianliangState.user.id+'.json');fs.writeFileSync(file,'{BROKEN-PRIVATE-DISCOVERY-FOLLOWS');const stillPublic=await transport('/api/review-community-feed');expect(stillPublic.status).toBe(200);expect((await stillPublic.json()).total).toBe(2);expect((await transport('/api/review-following-feed')).status).toBe(503);expect(fs.readFileSync(file,'utf8')).toBe('{BROKEN-PRIVATE-DISCOVERY-FOLLOWS');
});
it('discards held community discovery after changing accounts and leaves the next reader original event state intact',async()=>{
 const {w}=await peerPublishedPathUI();click(w,'dialog-close');const held=holdResponse(w,'/api/review-community-feed?query=&kind=all');click(w,'nav:discover');await held.wait();await switchUser(w,'discovery-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#following-feed-results')).toBeNull();expect(w.dianliangState.events).toHaveLength(0);expect(w.dianliangState.settings.followedAuthors).toBeUndefined();
});
it('restores the exact community search type and second page after author browsing while keeping followed browsing separate and the event unchanged',async()=>{
 const {w}=await paginatedPublicAuthorUI(),active=w.dianliangState.activeId;click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'discovery before saved scope');const form=w.document.querySelector('#following-feed-form');form.elements.kind.value='practice';form.elements.kind.dispatchEvent(new w.Event('change',{bubbles:true}));input(w,'#following-feed-form input','作者分页实践');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('21 条'),'practice search read');w.document.querySelector('#following-feed-results > button:last-child').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 2 页'),'community page two');const pageTwo=w.document.querySelector('#following-feed-results article').textContent;w.document.querySelector('[data-feed-author]').click();await until(()=>w.document.querySelector('#author-practices-status')?.textContent.includes('21 条'),'page two author opened');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 2 页'),'community page restored');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('作者分页实践');expect(w.document.querySelector('#following-feed-form').elements.kind.value).toBe('practice');expect(w.document.querySelector('#following-feed-results article').textContent).toBe(pageTwo);click(w,'nav:following');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('0 条'),'independent followed default');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('');expect(w.document.querySelector('#following-feed-form').elements.kind.value).toBe('all');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 2 页'),'community retained across followed page');expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('#following-feed-results > button:last-child').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 1 页'),'restored history previous page');expect(w.document.querySelectorAll('#following-feed-results article')).toHaveLength(20);
},15000);
it('retains an unsubmitted discovery filter without silently reading it on return and clears browsing scope when reader accounts change',async()=>{
 const {w}=await peerPublishedPathUI();click(w,'dialog-close');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'draft discovery loaded');const actual=w.fetch;let reads=0;w.fetch=(url,o)=>{if(url.startsWith('/api/review-community-feed?'))reads++;return actual(url,o)};input(w,'#following-feed-form input','尚未提交的搜索');click(w,'nav:paths');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('筛选已修改'),'draft filter restored');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('尚未提交的搜索');expect(reads).toBe(0);expect(w.document.querySelector('#following-feed-results').textContent).toBe('');await switchUser(w,'discovery-draft-next');click(w,'group:knowledge');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'new reader discovery');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('');expect(w.dianliangState.events).toHaveLength(0);
},15000);
it('retains restored discovery filters when its old page becomes unavailable and returns to the first page only on explicit recovery',async()=>{
 const {w,authorCookie}=await paginatedPublicAuthorUI(),active=w.dianliangState.activeId;click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'recovery discovery initial');const form=w.document.querySelector('#following-feed-form');form.elements.kind.value='practice';form.elements.kind.dispatchEvent(new w.Event('change',{bubbles:true}));input(w,'#following-feed-form input','作者分页实践');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('21 条'),'recovery filtered');w.document.querySelector('#following-feed-results > button:last-child').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 2 页'),'recovery saved page');w.document.querySelector('[data-feed-author]').click();await until(()=>w.document.querySelector('#author-practices-status')?.textContent.includes('21 条'),'recovery author');expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'作者分页实践 新记录',visibility:'public',lightUp:false})})).status).toBe(201);click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('已变化'),'restored cursor rejected');expect(w.document.querySelectorAll('#following-feed-results article')).toHaveLength(0);expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('作者分页实践');expect(w.document.querySelector('#following-feed-form').elements.kind.value).toBe('practice');w.document.querySelector('#following-feed-results > button:last-child').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('22 条')&&w.document.querySelector('#following-feed-status').textContent.includes('第 1 页'),'explicit first page restored');expect(w.document.activeElement.id).toBe('following-feed-status');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('restores saved discovery filters and second page after reload and exports only the reader own browsing preference while preserving the active event',async()=>{
 let {w}=await paginatedPublicAuthorUI();const active=w.dianliangState.activeId;click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'persistent discovery initial');const form=w.document.querySelector('#following-feed-form');form.elements.kind.value='practice';form.elements.kind.dispatchEvent(new w.Event('change',{bubbles:true}));input(w,'#following-feed-form input','作者分页实践');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('21 条'),'persistent filtered page');w.document.querySelector('#following-feed-results > button:last-child').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 2 页'),'persistent page two');expect(w.document.activeElement.id).toBe('following-feed-status');const contents=w.document.querySelector('#following-feed-results article').textContent;await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'page preference acknowledged');const remote=(await(await transport('/api/action-state')).json()).state.data.settings.publicFeedViews.community;expect(remote.kind).toBe('practice');expect(remote.query).toBe('作者分页实践');expect(remote.cursor).not.toBe('');expect(remote.history).toEqual(['']);const backup=await(await transport('/api/review-account-export')).json();expect(backup.service.actionState.data.settings.publicFeedViews.community).toEqual(remote);const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('#following-feed-status')?.textContent.includes('第 2 页'),'persistent page restored after reload');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('作者分页实践');expect(w.document.querySelector('#following-feed-form').elements.kind.value).toBe('practice');expect(w.document.querySelector('#following-feed-results article').textContent).toBe(contents);expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('#following-feed-results > button:last-child').click();await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('第 1 页'),'reloaded previous page');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'reloaded preference saved');w.close();w=ui(null);await until(()=>w.dianliangState?.user?.reviewService&&w.document.querySelector('#app').getAttribute('aria-busy')==='false','same reader without local cache');click(w,'group:knowledge');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-status')?.textContent.includes('21 条'),'preference read from service only');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('作者分页实践');expect(w.document.querySelector('#following-feed-form').elements.kind.value).toBe('practice');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('restores an unsubmitted feed draft after reload without requesting it and never copies that draft into a different reader account',async()=>{
 let {w}=await peerPublishedPathUI();click(w,'dialog-close');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'persistent draft initial');input(w,'#following-feed-form input','私人筛选草稿');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'private filter draft saved');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('#following-feed-status')?.textContent.includes('筛选已修改'),'private filter draft reloaded');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('私人筛选草稿');expect(w.document.querySelector('#following-feed-results').textContent).toBe('');await switchUser(w,'pref-next-reader');click(w,'group:knowledge');click(w,'nav:discover');await until(()=>w.document.querySelector('#following-feed-results article'),'different reader discovery');expect(w.document.querySelector('#following-feed-form').elements.query.value).toBe('');expect(JSON.stringify((await(await transport('/api/action-state')).json()).state)).not.toContain('私人筛选草稿');expect(w.dianliangState.events).toHaveLength(0);
},15000);
it('rejects malformed persisted feed scopes and hidden fields while leaving the original action version unchanged',async()=>{
 const w=await startedUI(),original=await(await transport('/api/action-state')).json();for(const views of [{secret:{query:'',kind:'all',cursor:'',history:[],draft:false}},{community:{query:'',kind:'private',cursor:'',history:[],draft:false}},{community:{query:'',kind:'all',cursor:'',history:[],draft:false,secret:'PRIVATE'}},{community:{query:'',kind:'all',cursor:'',history:[1],draft:false}}]){const state=JSON.parse(JSON.stringify(original.state));state.data.settings.publicFeedViews=views;expect((await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':original.revision},body:JSON.stringify(state)})).status).toBe(400)}expect((await(await transport('/api/action-state')).json()).revision).toBe(original.revision);expect(w.dianliangState.activeId).toBeTruthy();
});
async function bookmarkableTutorialUI(personal=false){const fixture=await peerPublishedPathUI(personal);const {w}=fixture;click(w,'dialog-close');click(w,'nav:discover');await until(()=>w.document.querySelector('[data-feed-bookmark]'),'bookmarkable tutorial');return fixture}
it.each(['non-list','missing-goal','non-text-method','duplicate-version','broken-materials'])('preserves malformed local tutorial bookmarks (%s) through viewing, export and a refused new bookmark',async(kind)=>{
 let {w}=await bookmarkableTutorialUI();const active=w.dianliangState.activeId;
 w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','initial valid bookmark');
 await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'initial bookmark synchronized');
 const valid=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks)),bad=JSON.parse(JSON.stringify(valid));
 if(kind==='missing-goal')delete bad[0].tutorial.target;
 if(kind==='non-text-method')bad[0].tutorial.method={unreadable:'original data'};
 if(kind==='duplicate-version')bad.push(JSON.parse(JSON.stringify(bad[0])));
 if(kind==='broken-materials')bad[0].tutorial.resources=[null];
 const original=kind==='non-list'?{unreadable:valid}:bad;
 w.dianliangState.settings.publicTutorialBookmarks=original;click(w,'nav:savedTutorials');
 await until(()=>w.document.querySelector('#tutorial-bookmark-status')?.textContent.includes('收藏资料不完整'),'malformed collection recovery');
 expect(w.document.querySelector('#tutorial-bookmark-status').textContent).not.toContain('收藏 0');expect(w.document.querySelector('[data-tutorial-bookmark-remove]')).toBeNull();
 expect(JSON.parse(w.localStorage.getItem(KEY)).settings.publicTutorialBookmarks).toEqual(original);
 const downloads=captureReviewDownloads(w);click(w,'review-sync-export');const exported=await downloads.read(downloads.files[0]);expect(exported.data.settings.publicTutorialBookmarks).toEqual(original);
 expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events.filter(e=>e.segments.at(-1)?.end===null)).toHaveLength(1);
 click(w,'nav:discover');await until(()=>w.document.querySelector('[data-feed-bookmark]'),'discovery still works');w.document.querySelector('[data-feed-bookmark]').click();
 await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('收藏资料不完整'),'new bookmark refused');expect(w.dianliangState.settings.publicTutorialBookmarks).toEqual(original);
 expect((await(await transport('/api/action-state')).json()).state.data.settings.publicTutorialBookmarks).toEqual(valid);
 if(kind==='non-list'){const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('#app').getAttribute('aria-busy')==='false'&&w.dianliangState?.user?.reviewService,'damaged bookmark local draft reloaded');click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('#tutorial-bookmark-status')?.textContent.includes('收藏资料不完整'),'reloaded malformed collection recovery');expect(w.dianliangState.settings.publicTutorialBookmarks).toEqual(original);expect(w.dianliangState.activeId).toBe(active);expect((await(await transport('/api/action-state')).json()).state.data.settings.publicTutorialBookmarks).toEqual(valid)}
},15000);
it('keeps a complete tutorial bookmark across account export and reload and starts only after explicit practice with the exact method and resources',async()=>{
 let {w}=await bookmarkableTutorialUI();const active=w.dianliangState.activeId,tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item;w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]')?.textContent==='已收藏这个版本','tutorial bookmark saved');w.document.querySelector('[data-feed-bookmark]').click();await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'tutorial bookmark acknowledged');expect(w.dianliangState.settings.publicTutorialBookmarks).toHaveLength(1);expect(w.dianliangState.settings.publicTutorialBookmarks[0].tutorial).toEqual(tutorial);expect(w.dianliangState.activeId).toBe(active);const backup=await(await transport('/api/review-account-export')).json();expect(backup.service.actionState.data.settings.publicTutorialBookmarks[0].tutorial).toEqual(tutorial);click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('[data-tutorial-bookmark-open]'),'saved tutorial list');input(w,'#tutorial-bookmark-search input','no-matching-bookmark');expect(w.document.querySelector('[data-tutorial-bookmark-open]')).toBeNull();input(w,'#tutorial-bookmark-search input',tutorial.target.goal);expect(w.document.querySelector('[data-tutorial-bookmark-open]')).not.toBeNull();await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'bookmark page acknowledged');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('[data-tutorial-bookmark-open]'),'bookmarked method reloaded');expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('[data-tutorial-bookmark-open]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','bookmarked method target');expect(w.dianliangState.activeId).toBe(active);click(w,'practice');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.serviceReference.version).toBe(tutorial.version);expect(e.knowledge.resourceLinks).toEqual(tutorial.resources);expect(e.id).not.toBe(active);await until(()=>w.dianliangState.nodes.find(n=>n.id===e.knowledge.nodeId).methods.find(m=>m.id===e.knowledge.methodId)?.serviceBinding?.version===tutorial.version,'bookmarked practice binding complete');expect(w.dianliangState.lights).toHaveLength(0);
},15000);
it('refreshes a revised tutorial card before saving another version without replacing the earlier bookmark',async()=>{
 const {w,authorCookie}=await bookmarkableTutorialUI();
 const card=()=>w.document.querySelector('[data-feed-bookmark]');
 const bookmarks=()=>w.dianliangState.settings.publicTutorialBookmarks;
 card().click();
 await until(()=>card()?.textContent==='已收藏这个版本','old bookmark saved');
 const old=JSON.parse(JSON.stringify(bookmarks()[0])),tutorial=old.tutorial;
 const response=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'收藏前核对的新版步骤'})});
 expect(response.status).toBe(200);
 const revised=(await response.json()).tutorial;
 card().click();
 await until(()=>w.document.querySelector('#following-feed-status')?.textContent.includes('核对更新后的版本再收藏'),'stale card refreshed');
 expect(bookmarks()).toEqual([old]);
 card().click();
 await until(()=>card()?.textContent==='已收藏这个版本','new bookmark saved');
 expect(bookmarks()).toHaveLength(2);
 expect(bookmarks()[0]).toEqual(old);
 expect(bookmarks()[1].tutorial.version).toBe(revised.version);
},15000);
it('retains a revised and then withdrawn tutorial bookmark with its old materials while refusing stale entry and permitting cancellation of that version',async()=>{
 const {w,authorCookie}=await bookmarkableTutorialUI(),active=w.dianliangState.activeId,tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item;w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','revision bookmark saved');expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'作者修订后的新方法，不改读者收藏。'})})).status).toBe(200);click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('[data-tutorial-bookmark-open]'),'old bookmark list');w.document.querySelector('[data-tutorial-bookmark-open]').click();await until(()=>w.document.querySelector('#tutorial-bookmark-results [role="status"]').textContent.includes('已变化'),'old bookmark refused');expect(w.dianliangState.settings.publicTutorialBookmarks[0].tutorial).toEqual(tutorial);expect(w.document.querySelector('main').dataset.page).toBe('savedTutorials');expect(w.dianliangState.activeId).toBe(active);const current=(await(await transport('/api/tutorials',{headers:{Cookie:authorCookie}})).json()).tutorials.find(t=>t.id===tutorial.id);expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':current.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);w.document.querySelector('[data-tutorial-bookmark-open]').click();await until(()=>w.document.querySelector('#tutorial-bookmark-results [role="status"]').textContent.includes('不可公开读取'),'withdrawn bookmark refused');w.document.querySelector('[data-tutorial-bookmark-remove]').click();await until(()=>w.dianliangState.settings.publicTutorialBookmarks.length===0&&!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'only saved version cancelled');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('discards a held tutorial bookmark verification after changing accounts without saving a foreign bookmark into the new reader',async()=>{
 const {w}=await bookmarkableTutorialUI(),tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item,held=holdResponse(w,'/api/review-public-tutorials/one?id='+tutorial.id);w.document.querySelector('[data-feed-bookmark]').click();await held.wait();await switchUser(w,'bookmark-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.dianliangState.settings.publicTutorialBookmarks).toBeUndefined();expect(w.dianliangState.events).toHaveLength(0);
});
it('rejects altered complete tutorial bookmarks and duplicate versions without changing the reader service state',async()=>{
 const {w}=await bookmarkableTutorialUI();w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','validated bookmark');const original=await(await transport('/api/action-state')).json(),bookmark=original.state.data.settings.publicTutorialBookmarks[0];for(const changed of [(()=>{const b=JSON.parse(JSON.stringify(bookmark));b.tutorial.target.goal='改写目标';return [b]})(),[bookmark,bookmark],(()=>{const b=JSON.parse(JSON.stringify(bookmark));b.tutorial.resources[0].optional=!b.tutorial.resources[0].optional;return [b]})(),[{...bookmark,secret:'PRIVATE'}]]){const state=JSON.parse(JSON.stringify(original.state));state.data.settings.publicTutorialBookmarks=changed;expect((await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':original.revision},body:JSON.stringify(state)})).status).toBe(400)}expect((await(await transport('/api/action-state')).json()).revision).toBe(original.revision);
});
it('bookmarks a personal public goal tutorial without adopting the goal ownership or starting the reader activity on opening its current details',async()=>{
 const {w}=await bookmarkableTutorialUI(true),active=w.dianliangState.activeId,tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item;expect(tutorial.kind).toBe('personal-public');w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','personal tutorial bookmark');expect(w.dianliangState.settings.publicTutorialBookmarks[0].tutorial.target.ownerId).toBe(tutorial.target.ownerId);expect(w.dianliangState.nodes.some(n=>n.id===tutorial.target.nodeId)).toBe(false);click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('[data-tutorial-bookmark-open]'),'personal bookmark list');w.document.querySelector('[data-tutorial-bookmark-open]').click();await until(()=>w.document.querySelector('#visible-target-start'),'personal bookmark current goal');expect(w.document.querySelector('#dialogs').textContent).toContain(tutorial.target.goal);expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.lights).toHaveLength(0);
});
it('recovers an offline complete tutorial bookmark from the original reader pending state and synchronizes without duplicating its version',async()=>{
 let {w}=await bookmarkableTutorialUI();const active=w.dianliangState.activeId,tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item,actual=w.fetch;w.fetch=async(url,o)=>{const r=await actual(url,o);if(url==='/api/review-public-tutorials/one?id='+tutorial.id)offline=true;return r};w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('#review-sync-warning')&&w.dianliangState.settings.publicTutorialBookmarks?.length===1,'offline bookmark pending');await until(()=>!w.document.querySelector('[data-feed-bookmark]').disabled,'offline bookmark attempt finished');const saved=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks[0])),cache=w.localStorage.getItem(KEY);w.close();offline=false;w=ui(cache);await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('已恢复')&&w.document.querySelector('#app').getAttribute('aria-busy')==='false','offline bookmark restored');expect(w.dianliangState.settings.publicTutorialBookmarks[0]).toEqual(saved);expect(w.dianliangState.activeId).toBe(active);click(w,'review-sync-retry');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'offline bookmark synchronized');const remote=await(await transport('/api/action-state')).json();expect(remote.state.data.settings.publicTutorialBookmarks).toHaveLength(1);expect(remote.state.data.settings.publicTutorialBookmarks[0].tutorial).toEqual(tutorial);
},15000);
it('opens a bookmarked tutorial after its identical version is publicly republished while retaining the original saved publication snapshot',async()=>{
 const {w,authorCookie}=await bookmarkableTutorialUI(),active=w.dianliangState.activeId,tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item;w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','republished bookmark saved');const saved=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks[0]));const privateResponse=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})});expect(privateResponse.status).toBe(200);const privateVersion=(await privateResponse.json()).tutorial.version;expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':privateVersion},body:JSON.stringify({visibility:'public'})})).status).toBe(200);const republished=(await(await transport('/api/review-public-tutorials/one?id='+tutorial.id)).json()).tutorial;expect(republished.version).toBe(tutorial.version);expect(republished.createdAt).not.toBe(tutorial.createdAt);click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('[data-tutorial-bookmark-open]'),'republished saved list');w.document.querySelector('[data-tutorial-bookmark-open]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','same version remains usable');expect(w.dianliangState.settings.publicTutorialBookmarks[0]).toEqual(saved);expect(w.dianliangState.activeId).toBe(active);
},15000);
async function savedTutorialComparisonUI(){const fixture=await bookmarkableTutorialUI(),{w}=fixture;const tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item;w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','comparison bookmark saved');click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('[data-tutorial-bookmark-compare]'),'comparison bookmark list');return {...fixture,tutorial};}
it.each(['snapshot','method','goal','materials'])('detects offline tutorial bookmark integrity changes (%s) without displaying or rewriting them',async(kind)=>{
 const {w}=await savedTutorialComparisonUI(),active=w.dianliangState.activeId,valid=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks));await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'valid collection saved before damage');
 const b=w.dianliangState.settings.publicTutorialBookmarks[0];if(kind==='snapshot')b.snapshotHash='0'.repeat(64);if(kind==='method')b.tutorial.method='格式正常但不是收藏时的原方法';if(kind==='goal')b.tutorial.target.goal='格式正常但不是收藏时的原目标';if(kind==='materials')b.tutorial.resources[0].affiliate=!b.tutorial.resources[0].affiliate;
 if(kind!=='snapshot')b.snapshotHash=require('node:crypto').createHash('sha256').update(JSON.stringify(b.tutorial)).digest('hex');
 const damaged=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks));offline=true;input(w,'#tutorial-bookmark-search input','');await until(()=>w.document.querySelector('#tutorial-bookmark-status').textContent.includes('收藏内容与原版本不一致'),'offline integrity error');expect(w.document.querySelector('[data-tutorial-bookmark-compare]')).toBeNull();expect(w.document.querySelector('#tutorial-bookmark-results').textContent).not.toContain('格式正常但不是');const downloads=captureReviewDownloads(w);click(w,'review-sync-export');expect((await downloads.read(downloads.files[0])).data.settings.publicTutorialBookmarks).toEqual(damaged);expect(w.dianliangState.settings.publicTutorialBookmarks).toEqual(damaged);expect(w.dianliangState.activeId).toBe(active);offline=false;expect((await(await transport('/api/action-state')).json()).state.data.settings.publicTutorialBookmarks).toEqual(valid);
},15000);
it('does not show an unchecked old tutorial as a comparison version after the local snapshot is changed',async()=>{
 const {w}=await savedTutorialComparisonUI();const button=w.document.querySelector('[data-tutorial-bookmark-compare]');w.dianliangState.settings.publicTutorialBookmarks[0].tutorial.method='损坏内容不可冒充原作者版本';button.click();await until(()=>w.document.querySelector('#tutorial-version-comparison [role="alert"]')?.textContent.includes('收藏内容与原版本不一致'),'comparison local integrity error');expect(w.document.querySelector('#tutorial-version-comparison').textContent).not.toContain('损坏内容不可冒充');expect(w.document.querySelector('#tutorial-version-comparison [data-comparison-field]')).toBeNull();expect(w.document.querySelector('#tutorial-version-comparison [data-action="review-sync-export"]')).not.toBeNull();
},15000);
it('keeps valid tutorial bookmarks exportable when the browser checksum facility is unavailable',async()=>{
 const {w}=await savedTutorialComparisonUI(),original=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks));Object.defineProperty(w.crypto,'subtle',{value:undefined,configurable:true});click(w,'nav:discover');await until(()=>w.document.querySelector('[data-feed-bookmark]'),'bookmark crypto fallback discovery');click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('#tutorial-bookmark-status')?.textContent.includes('无法核对收藏完整性'),'bookmark crypto fallback');expect(w.document.querySelector('[data-tutorial-bookmark-open]')).toBeNull();const downloads=captureReviewDownloads(w);click(w,'review-sync-export');expect((await downloads.read(downloads.files[0])).data.settings.publicTutorialBookmarks).toEqual(original);expect(w.dianliangState.settings.publicTutorialBookmarks).toEqual(original);
},15000);
it('rejects a stale checksum result when local tutorial contents change during verification',async()=>{
 const {w}=await savedTutorialComparisonUI();click(w,'nav:discover');await until(()=>w.document.querySelector('[data-feed-bookmark]'),'checksum mutation discovery');let release,captured=false;const gate=new Promise(r=>release=r),subtle=require('node:crypto').webcrypto.subtle;Object.defineProperty(w.crypto,'subtle',{value:{digest:async(...args)=>{captured=true;await gate;return subtle.digest(...args)}},configurable:true});click(w,'nav:savedTutorials');await until(()=>captured,'held mutation digest');w.dianliangState.settings.publicTutorialBookmarks[0].tutorial.method='核对期间的新改动';release();await until(()=>w.document.querySelector('#tutorial-bookmark-status').textContent.includes('核对期间收藏已变化'),'stale hash result refused');expect(w.document.querySelector('[data-tutorial-bookmark-open]')).toBeNull();expect(w.dianliangState.settings.publicTutorialBookmarks[0].tutorial.method).toBe('核对期间的新改动');
},15000);
it('accepts a valid bookmarked method with an empty optional five-minute action',async()=>{
 const {w,authorCookie}=await bookmarkableTutorialUI(),tutorial=(await(await transport('/api/review-community-feed')).json()).entries.find(e=>e.type==='tutorial').item;expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({startAction:''})})).status).toBe(200);w.document.querySelector('#following-feed-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#following-feed-results').textContent.includes(tutorial.startAction)&&w.document.querySelector('[data-feed-bookmark]'),'empty action version loaded');w.document.querySelector('[data-feed-bookmark]').click();await until(()=>w.document.querySelector('[data-feed-bookmark]').textContent==='已收藏这个版本','empty action version saved');click(w,'nav:savedTutorials');await until(()=>w.document.querySelector('[data-tutorial-bookmark-open]'),'empty action version verified');expect(w.dianliangState.settings.publicTutorialBookmarks[0].tutorial.startAction).toBe('');
},15000);
it('discards a held bookmark checksum result after the owner switches accounts',async()=>{
 const {w}=await savedTutorialComparisonUI();let release,captured=false;const gate=new Promise(r=>release=r),subtle=require('node:crypto').webcrypto.subtle;Object.defineProperty(w.crypto,'subtle',{value:{digest:async(...args)=>{captured=true;await gate;return subtle.digest(...args)}},configurable:true});click(w,'nav:discover');await until(()=>w.document.querySelector('[data-feed-bookmark]'),'checksum switch discovery');click(w,'nav:savedTutorials');await until(()=>captured,'held local bookmark digest');await switchUser(w,'checksum-next-reader');release();await new Promise(r=>setTimeout(r,60));expect(w.dianliangState.settings.publicTutorialBookmarks).toBeUndefined();expect(w.document.querySelector('#tutorial-bookmark-results')).toBeNull();expect(w.document.querySelector('#dialogs').textContent).toBe('');
},15000);
it('compares complete saved and revised tutorial versions and adds the new version without replacing the old snapshot or starting an event',async()=>{
 const {w,tutorial,authorCookie}=await savedTutorialComparisonUI(),active=w.dianliangState.activeId,saved=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks[0])),resources=[{label:'新版材料',url:'https://example.com/new-material',optional:false,affiliate:true}];expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'新版完整方法：先展开结构，再逐步核对每一处等式。',startAction:'先在五分钟内列出核对步骤。',resources})})).status).toBe(200);const latest=(await(await transport('/api/review-public-tutorials/one?id='+tutorial.id)).json()).tutorial;w.document.querySelector('[data-tutorial-bookmark-compare]').focus();w.document.querySelector('[data-tutorial-bookmark-compare]').click();await until(()=>w.document.querySelector('#tutorial-comparison-save'),'complete comparison');const columns=w.document.querySelectorAll('#tutorial-version-comparison section.box');expect(columns).toHaveLength(2);expect(columns[0].textContent).toContain(tutorial.target.goal);const links=[...w.document.querySelectorAll('#tutorial-version-comparison .row a')];expect(links.map(a=>a.getAttribute('href'))).toEqual([tutorial,latest].map(t=>'/platform/#node/'+t.treeId+'/'+t.nodeId+'/tutorial/'+t.id+'/'+t.version));expect(columns[0].textContent).toContain(tutorial.method);expect(columns[1].textContent).toContain(latest.method);expect(columns[1].textContent).toContain(latest.startAction);expect(columns[1].textContent).toContain('需用');expect(columns[1].textContent).toContain('外链抽成标记');expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('#tutorial-comparison-save').click();await until(()=>w.dianliangState.settings.publicTutorialBookmarks.length===2&&w.document.querySelector('#tutorial-comparison-status').textContent.includes('已收藏'),'new version saved separately');expect(w.dianliangState.settings.publicTutorialBookmarks[0]).toEqual(saved);expect(w.dianliangState.settings.publicTutorialBookmarks[1].tutorial).toEqual(latest);expect(w.document.querySelectorAll('[data-tutorial-bookmark-compare]')).toHaveLength(2);click(w,'dialog-close');expect(w.document.activeElement.id).toBe('tutorial-bookmark-compare-'+tutorial.id+'-'+tutorial.version);expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.lights).toHaveLength(0);
},15000);
it('shows only the saved tutorial when current publication is withdrawn and retries without exposing the author private revision',async()=>{
 const {w,tutorial,authorCookie}=await savedTutorialComparisonUI(),active=w.dianliangState.activeId;expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'PRIVATE-COMPARISON-REVISION',visibility:'private'})})).status).toBe(200);w.document.querySelector('[data-tutorial-bookmark-compare]').click();await until(()=>w.document.querySelector('#tutorial-comparison-retry'),'withdrawn comparison');expect(w.document.querySelector('#tutorial-version-comparison').textContent).toContain(tutorial.method);expect(w.document.querySelector('#tutorial-version-comparison').textContent).not.toContain('PRIVATE-COMPARISON-REVISION');expect(w.document.querySelector('#tutorial-comparison-save')).toBeNull();expect(w.document.querySelector('#tutorial-version-comparison [role="alert"]').textContent).toContain('不可公开读取');w.document.querySelector('#tutorial-comparison-retry').click();await until(()=>w.document.querySelector('#tutorial-comparison-retry'),'withdrawn comparison retry');expect(w.dianliangState.settings.publicTutorialBookmarks).toHaveLength(1);expect(w.dianliangState.activeId).toBe(active);
});
it('never restores a held private tutorial comparison after the reader closes it and changes accounts',async()=>{
 const {w,tutorial}=await savedTutorialComparisonUI(),held=holdResponse(w,'/api/review-public-tutorials/one?id='+tutorial.id);w.document.querySelector('[data-tutorial-bookmark-compare]').click();await held.wait();expect(w.document.querySelector('#tutorial-version-loading')).not.toBeNull();click(w,'dialog-close');await switchUser(w,'comparison-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#tutorial-version-comparison')).toBeNull();expect(w.dianliangState.settings.publicTutorialBookmarks).toBeUndefined();expect(w.dianliangState.events).toHaveLength(0);
});
it('requires refreshing a comparison before saving when the author revises again and retains the original bookmark throughout',async()=>{
 const {w,tutorial,authorCookie}=await savedTutorialComparisonUI(),active=w.dianliangState.activeId,saved=JSON.parse(JSON.stringify(w.dianliangState.settings.publicTutorialBookmarks[0]));w.document.querySelector('[data-tutorial-bookmark-compare]').click();await until(()=>w.document.querySelector('#tutorial-comparison-save'),'comparison before later revision');expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'对照打开后作者再次修订的完整方法。'})})).status).toBe(200);w.document.querySelector('#tutorial-comparison-save').click();await until(()=>w.document.querySelector('#tutorial-comparison-status').textContent.includes('已变化'),'stale comparison save blocked');expect(w.dianliangState.settings.publicTutorialBookmarks).toHaveLength(1);expect(w.dianliangState.settings.publicTutorialBookmarks[0]).toEqual(saved);w.document.querySelector('#tutorial-comparison-refresh').click();await until(()=>w.document.querySelector('#tutorial-version-comparison')?.textContent.includes('对照打开后作者再次修订'),'comparison explicitly refreshed');w.document.querySelector('#tutorial-comparison-save').click();await until(()=>w.dianliangState.settings.publicTutorialBookmarks.length===2&&w.document.querySelector('#tutorial-comparison-status').textContent.includes('已收藏'),'fresh comparison version saved');expect(w.dianliangState.settings.publicTutorialBookmarks[0]).toEqual(saved);expect(w.dianliangState.activeId).toBe(active);
},15000);
it('identifies a materials-only tutorial change and folds only unchanged fields without losing complete content or changing the event',async()=>{
 const {w,tutorial,authorCookie}=await savedTutorialComparisonUI(),active=w.dianliangState.activeId,changedResources=tutorial.resources.map((r,i)=>i===0?{...r,optional:!r.optional,affiliate:!r.affiliate}:r);expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({resources:changedResources})})).status).toBe(200);w.document.querySelector('[data-tutorial-bookmark-compare]').click();await until(()=>w.document.querySelector('#tutorial-comparison-only-changes'),'materials change summary');const summary=w.document.querySelector('#tutorial-comparison-summary').textContent;expect(summary).toContain('内容变化：材料与产品链接');expect(w.document.querySelectorAll('[data-comparison-field][data-changed="true"]')).toHaveLength(2);const toggle=w.document.querySelector('#tutorial-comparison-only-changes');toggle.checked=true;toggle.dispatchEvent(new w.Event('change',{bubbles:true}));expect([...w.document.querySelectorAll('[data-comparison-field="method"]')].every(f=>f.hidden)).toBe(true);expect([...w.document.querySelectorAll('[data-comparison-field="resources"]')].every(f=>!f.hidden)).toBe(true);expect(w.document.querySelector('[data-comparison-field="method"] .pre').textContent).toBe(tutorial.method);toggle.checked=false;toggle.dispatchEvent(new w.Event('change',{bubbles:true}));expect([...w.document.querySelectorAll('[data-comparison-field]')].every(f=>!f.hidden)).toBe(true);expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.settings.publicTutorialBookmarks).toHaveLength(1);
});
it('distinguishes a republished unchanged tutorial from content changes and still allows reading both complete definitions',async()=>{
 const {w,tutorial,authorCookie}=await savedTutorialComparisonUI(),active=w.dianliangState.activeId;const privateResponse=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})});expect(privateResponse.status).toBe(200);const privateVersion=(await privateResponse.json()).tutorial.version;expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':privateVersion},body:JSON.stringify({visibility:'public'})})).status).toBe(200);w.document.querySelector('[data-tutorial-bookmark-compare]').click();await until(()=>w.document.querySelector('#tutorial-comparison-summary'),'republished summary');expect(w.document.querySelector('#tutorial-comparison-summary').textContent).toContain('目标、方法与材料内容一致');expect(w.document.querySelector('#tutorial-comparison-summary').textContent).toContain('版本发布时间');expect(w.document.querySelectorAll('[data-comparison-field][data-changed="true"]')).toHaveLength(0);expect([...w.document.querySelectorAll('[data-comparison-field="goal"]')].every(f=>f.textContent.includes(tutorial.target.goal))).toBe(true);expect([...w.document.querySelectorAll('[data-comparison-field="method"]')].every(f=>f.textContent.includes(tutorial.method))).toBe(true);expect(w.dianliangState.activeId).toBe(active);
});
it('paginates the followed feed by stable scope and rejects old cursors after the reader cancels a follow',async()=>{
 const {w,path:p,authorCookie}=await followableAuthorUI();for(let i=0;i<4;i++)expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'关注分页实践 '+i,visibility:'public',lightUp:false})})).status).toBe(201);w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'paged feed followed');const first=await(await transport('/api/review-following-feed?limit=2')).json(),next=await(await transport('/api/review-following-feed?limit=2&cursor='+encodeURIComponent(first.nextCursor))).json();expect(first.total).toBe(6);expect(first.entries).toHaveLength(2);expect(next.entries).toHaveLength(2);expect(next.entries.some(e=>first.entries.some(a=>a.key===e.key))).toBe(false);expect(first.entries[0].publishedAt).toBeGreaterThanOrEqual(first.entries[1].publishedAt);w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已取消'),'feed follow cancelled');expect((await transport('/api/review-following-feed?limit=1&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);const empty=await(await transport('/api/review-following-feed')).json();expect(empty.entries).toEqual([]);expect(empty.followedCount).toBe(0);expect(p.authorId).toBeTruthy();
});
it('discards a held followed feed when its search changes without displaying old contents or switching the event',async()=>{
 const {w}=await followableAuthorUI(),active=w.dianliangState.activeId;w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'held feed followed');const held=holdResponse(w,'/api/review-following-feed?query=&kind=all');click(w,'nav:following');await held.wait();input(w,'#following-feed-form input','no-matching-feed');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#following-feed-results').textContent).toBe('');expect(w.document.querySelector('#following-feed-status').textContent).toContain('筛选已修改');w.document.querySelector('#following-feed-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#following-feed-status').textContent.includes('0 条'),'edited feed read');expect(w.dianliangState.activeId).toBe(active);
});
it('rejects a held followed feed after changing reader accounts instead of restoring the old private follow scope',async()=>{
 const {w}=await followableAuthorUI();w.document.querySelector('#public-author-follow').click();await until(()=>w.document.querySelector('#public-author-follow-status').textContent.includes('已关注'),'old reader followed');const held=holdResponse(w,'/api/review-following-feed?query=&kind=all');click(w,'nav:following');await held.wait();await switchUser(w,'feed-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#following-feed-results')).toBeNull();expect(w.dianliangState.settings.followedAuthors).toBeUndefined();expect((await(await transport('/api/review-following-feed')).json()).entries).toEqual([]);
});
it('protects the followed feed with account and Origin checks and preserves an unreadable private follow store',async()=>{
 const {w}=await followableAuthorUI(),me=await(await transport('/api/me')).json();expect((await transport('/api/review-following-feed',{headers:{'X-Action-Account':'different-reader'}})).status).toBe(409);expect((await transport('/api/review-following-feed',{headers:{Origin:'https://foreign.example'}})).status).toBe(403);expect((await transport('/api/review-following-feed?kind=private')).status).toBe(400);expect((await transport('/api/review-following-feed',{headers:{Cookie:''}})).status).toBe(401);const file=path.join(directory,'action-states',me.user.id+'.json');fs.writeFileSync(file,'{BROKEN-PRIVATE-FOLLOWS');expect((await transport('/api/review-following-feed')).status).toBe(503);expect(fs.readFileSync(file,'utf8')).toBe('{BROKEN-PRIVATE-FOLLOWS');expect(w.dianliangState.activeId).toBeTruthy();
});
async function paginatedPublicAuthorUI(){
 const fixture=await peerPublishedPathUI();for(let i=0;i<21;i++)expect((await transport('/api/records',{method:'POST',headers:{Cookie:fixture.authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'作者分页实践 '+i,visibility:'public',lightUp:false})})).status).toBe(201);
 const {w}=fixture;w.document.querySelector('[data-public-path-author]').click();await until(()=>w.document.querySelector('#public-path-author-home'),'paged author entrance');w.document.querySelector('#public-path-author-home').click();await until(()=>w.document.querySelector('#author-practices-status')?.textContent.includes('21 条'),'author practice first page');return fixture;
}
it('browses actual author practice pages in both directions without mixing categories or changing the reader event',async()=>{
 const {w}=await paginatedPublicAuthorUI(),active=w.dianliangState.activeId,host=w.document.querySelector('#author-practices-results'),first=Array.from(host.querySelectorAll('article')).map(v=>v.textContent);expect(first).toHaveLength(20);expect(w.document.querySelector('#author-practices-status').textContent).toContain('第 1 页');host.querySelector(':scope > button:last-child').click();await until(()=>w.document.querySelector('#author-practices-status').textContent.includes('第 2 页'),'author second page');const second=Array.from(host.querySelectorAll('article')).map(v=>v.textContent);expect(second).toHaveLength(1);expect(first).not.toContain(second[0]);expect(host.textContent).toContain('上一页公开实践');expect(host.textContent).not.toContain('下一页公开实践');host.querySelector(':scope > button:last-child').click();await until(()=>w.document.querySelector('#author-practices-status').textContent.includes('第 1 页'),'author previous page');expect(Array.from(host.querySelectorAll('article')).map(v=>v.textContent)).toEqual(first);expect(w.document.querySelector('#author-tutorials-status').textContent).toContain('1 条');expect(w.document.querySelector('#author-paths-status').textContent).toContain('1 条');expect(w.dianliangState.activeId).toBe(active);
});
it('retries the requested author page after transport loss and can return to the first page after its cursor becomes stale',async()=>{
 const {w,authorCookie}=await paginatedPublicAuthorUI(),active=w.dianliangState.activeId,host=w.document.querySelector('#author-practices-results'),actual=w.fetch;let fail=true;const cursors=[];w.fetch=(url,o)=>{if(url.startsWith('/api/review-public-practices?')&&url.includes('&cursor=')){cursors.push(url);if(fail)return Promise.reject(new w.TypeError('Test author page disconnected'))}return actual(url,o)};host.querySelector(':scope > button:last-child').click();await until(()=>host.textContent.includes('重新读取第一页公开实践'),'author page recovery options');expect(w.document.querySelector('#author-practices-status').textContent).toContain('读取未确认');fail=false;host.querySelector(':scope > button').click();await until(()=>w.document.querySelector('#author-practices-status').textContent.includes('第 2 页'),'same author page retry');expect(cursors[1]).toBe(cursors[0]);expect(host.querySelectorAll('article')).toHaveLength(1);
 host.querySelector(':scope > button:last-child').click();await until(()=>w.document.querySelector('#author-practices-status').textContent.includes('第 1 页'),'return before stale page');fail=true;host.querySelector(':scope > button:last-child').click();await until(()=>host.textContent.includes('重新读取第一页公开实践'),'held failed next page');
 expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'作者新增公开实践',visibility:'public',lightUp:false})})).status).toBe(201);fail=false;host.querySelector(':scope > button').click();await until(()=>w.document.querySelector('#author-practices-status').textContent.includes('已变化'),'stale cursor rejected');expect(host.querySelectorAll('article')).toHaveLength(0);host.querySelector(':scope > button:last-child').click();await until(()=>w.document.querySelector('#author-practices-status').textContent.includes('22 条')&&w.document.querySelector('#author-practices-status').textContent.includes('第 1 页'),'explicit first page recovery');expect(host.querySelectorAll('article')).toHaveLength(20);expect(w.dianliangState.activeId).toBe(active);
});
it('keeps an author practice cursor valid for unrelated posts but invalidates it on withdrawal',async()=>{
 const {path:p,authorCookie}=await paginatedPublicAuthorUI();
 const route='/api/review-public-practices?limit=20&authorId='+p.authorId;
 const first=await(await transport(route)).json();
 expect(first.total).toBe(21);
 expect(first.nextCursor).toBeTruthy();
 const next=route+'&cursor='+encodeURIComponent(first.nextCursor);
 const other=await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'其他作者公开实践',visibility:'public'})});
 expect(other.status).toBe(201);
 const nextPage=await transport(next);
 expect(nextPage.status).toBe(200);
 const [last]=(await nextPage.json()).practices;
 expect(last.authorId).toBe(p.authorId);
 expect((await transport('/api/records/'+last.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})})).status).toBe(200);
 expect((await transport(next)).status).toBe(409);
 expect((await transport('/api/review-public-practices/one?id='+last.id)).status).toBe(404);
 const refreshed=await(await transport(route)).json();
 expect(refreshed.total).toBe(20);
 expect(refreshed.practices.some(item=>item.id===last.id)).toBe(false);
});
it('opens a shared practice and refuses its old link after the author withdraws it',async()=>{
 const {w,authorCookie}=await paginatedPublicAuthorUI();
 const active=w.dianliangState.activeId;
 const link=w.document.querySelector('#author-practices-results [data-practice-link]');
 const url=new URL(link.href);
 const id=url.searchParams.get('practice');
 expect(id).toBeTruthy();
 const cache=w.localStorage.getItem(KEY);
 w.close();
 const shared=ui(cache,{},url.search);
 let reads=0;
 shared.fetch=(path,options)=>{
  if(path==='/api/review-public-practices/one?id='+id&&++reads===1)return Promise.reject(new shared.TypeError('Network disconnected'));
  return transport(path,options);
 };
 await until(()=>shared.document.querySelector('#linked-practice-content button')?.textContent==='重新读取实践','shared practice retry available');
 shared.document.querySelector('#linked-practice-content button').click();
 await until(()=>shared.document.querySelector('[data-linked-practice-target]'),'shared practice visible');
 expect(reads).toBe(2);
 expect(shared.document.querySelector('#linked-practice-content').textContent).toContain('作者分页实践');
 let copied;
 Object.defineProperty(shared.navigator,'clipboard',{value:{writeText:async value=>{copied=value}}});
 [...shared.document.querySelectorAll('#linked-practice-content button')].find(button=>button.textContent==='复制实践链接').click();
 await until(()=>shared.document.querySelector('#linked-practice-content').textContent.includes('已复制实践链接'),'practice link copied');
 expect(copied).toBe(url.href);
 expect(shared.dianliangState.activeId).toBe(active);
 shared.close();
 expect((await transport('/api/records/'+id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})})).status).toBe(200);
 const withdrawn=ui(cache,{},url.search);
 await until(()=>withdrawn.document.querySelector('#linked-practice-status')?.textContent.includes('已不再公开'),'shared practice withdrawn');
 expect(withdrawn.document.querySelector('#linked-practice-content').textContent).toBe('');
 expect(withdrawn.dianliangState.activeId).toBe(active);
});
it('saves path bookmarks with the account, filters them and keeps copying separate from progress',async()=>{
 let w=await startedUI();const active=w.dianliangState.activeId,original=JSON.parse(JSON.stringify(w.dianliangState.paths.find(p=>p.id==='p-algebra')));click(w,'group:knowledge');click(w,'nav:paths');click(w,'path-bookmark:p-algebra');click(w,'path-filter:saved');expect(w.document.querySelectorAll('.path-card')).toHaveLength(1);expect(w.document.querySelector('[data-action="path-bookmark:p-algebra"]').textContent).toBe('取消收藏');expect(w.dianliangState.paths.find(p=>p.id==='p-algebra').nodes).toEqual(original.nodes);expect(w.dianliangState.lights).toHaveLength(0);expect(w.dianliangState.activeId).toBe(active);
 await until(async()=> (await(await transport('/api/action-state')).json()).state.data.paths.find(p=>p.id==='p-algebra').bookmarked===true&&!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'bookmark stored and acknowledged');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('[data-action="nav:paths"]')&&w.document.querySelector('#app').getAttribute('aria-busy')==='false','bookmark reload navigation ready');click(w,'nav:paths');click(w,'path-filter:saved');expect(w.document.querySelectorAll('.path-card')).toHaveLength(1);click(w,'fork-path:p-algebra');const copy=w.dianliangState.paths.find(p=>!p.seed);expect(copy.bookmarked).toBe(false);expect(copy.visibility).toBe('private');expect(copy.nodes).toEqual(original.nodes);expect(w.document.querySelectorAll('.path-card')).toHaveLength(1);click(w,'path-bookmark:p-algebra');expect(w.document.querySelectorAll('.path-card')).toHaveLength(0);expect(w.document.querySelector('main').textContent).toContain('还没有收藏路径');click(w,'path-filter:all');expect(w.document.querySelectorAll('.path-card')).toHaveLength(4);expect(w.dianliangState.activeId).toBe(active);
 await until(async()=> (await(await transport('/api/action-state')).json()).state.data.paths.find(p=>p.id==='p-algebra').bookmarked===false&&!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'bookmark cancellation stored and acknowledged');await switchUser(w,'path-bookmark-next-owner');click(w,'group:knowledge');click(w,'nav:paths');click(w,'path-filter:saved');expect(w.document.querySelectorAll('.path-card')).toHaveLength(0);expect(w.dianliangState.paths.every(p=>!p.bookmarked)).toBe(true);
});
it('recovers an offline path bookmark and exports it without changing the active event',async()=>{
 let w=await startedUI();const active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:paths');offline=true;click(w,'path-bookmark:p-science');await until(()=>w.document.querySelector('#review-sync-warning'),'offline bookmark warning');const cache=w.localStorage.getItem(KEY);w.close();offline=false;w=ui(cache);await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('已恢复')&&w.document.querySelector('#app').getAttribute('aria-busy')==='false','bookmark recovered and ready');expect(w.dianliangState.paths.find(p=>p.id==='p-science').bookmarked).toBe(true);click(w,'review-sync-retry');await until(()=>!w.document.querySelector('#review-sync-warning'),'bookmark retry saved');const exported=await(await transport('/api/review-account-export')).json();expect(exported.service.actionState.data.paths.find(p=>p.id==='p-science').bookmarked).toBe(true);expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.lights).toHaveLength(0);
});
async function ownProfileUI(){const w=await startedUI();click(w,'group:space');click(w,'nav:profile');click(w,'review-own-profile');await until(()=>w.document.querySelector('#own-profile-form'),'own profile editor');return w}
it('counts actual own service tutorials without duplicating a mapped local method or deduplicating unrelated same titles',async()=>{
 const w=await newMethodUI(),active=w.dianliangState.activeId;click(w,'group:space');click(w,'nav:profile');await until(()=>w.document.querySelector('#profile-method-total').textContent==='1','mapped method counted once');expect(w.document.querySelector('#profile-method-status').textContent).toContain('行动档案中另有 0');const r=await transport('/api/tutorials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',title:'界面保存的方法',method:'同名但独立创建的另一份教程',visibility:'private'})});expect(r.status).toBe(201);const independent=(await r.json()).tutorial;w.document.querySelector('#profile-method-refresh').click();await until(()=>w.document.querySelector('#profile-method-total').textContent==='2','independent same title counted separately');expect(w.document.querySelector('#profile-method-content').textContent).toContain('界面保存的方法');expect((await transport('/api/tutorials/'+independent.id,{method:'DELETE'})).status).toBe(200);w.document.querySelector('#profile-method-refresh').click();await until(()=>w.document.querySelector('#profile-method-total').textContent==='1','archive removed from current count');expect(w.document.querySelector('#profile-method-status').textContent).toContain('已归档 1');click(w,'review-owned-visible');await until(()=>w.document.querySelector('#owned-visible-status').textContent.includes('2 份'),'archived tutorial history remains');expect(w.document.querySelector('#owned-visible-results').textContent).toContain('已归档');expect(w.dianliangState.activeId).toBe(active);
});
it('does not show zero contributions after an own tutorial read fails and discards the old account inventory',async()=>{
 const w=await startedUI();click(w,'group:space');let fail=true;w.fetch=(url,options)=>url==='/api/review-owned-tutorials'&&fail?Promise.reject(new w.TypeError('Test own inventory disconnected')):transport(url,options);click(w,'nav:profile');await until(()=>w.document.querySelector('#profile-method-total').textContent==='待核对','failed tutorial count distinguished');expect(w.document.querySelector('main').textContent).toContain('个人实践时间线');fail=false;const held=holdResponse(w,'/api/review-owned-tutorials');w.document.querySelector('#profile-method-refresh').click();await held.wait();await switchUser(w,'inventory-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#profile-method-summary')).toBeNull();expect(w.dianliangState.user.name).toBe('inventory-next-reader');
});
it('shows a saved own profile on the personal page and does not replace it with an earlier held read',async()=>{
 const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:space');const held=holdResponse(w,'/api/review-own-profile');click(w,'nav:profile');await held.wait();click(w,'review-own-profile');await until(()=>w.document.querySelector('#own-profile-form'),'summary race editor');input(w,'#own-profile-form [name="tagline"]','已经保存的一句话');input(w,'#own-profile-form [name="about"]','完整服务介绍');input(w,'#own-profile-form [name="focus"]','学习代数');w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#own-profile-summary-content').textContent.includes('已经保存的一句话'),'saved summary shown');const before=w.document.querySelector('#own-profile-summary-content').innerHTML;held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#own-profile-summary-content').innerHTML).toBe(before);expect(w.document.querySelector('#own-profile-summary-status').textContent).toContain('仅自己可见');expect(w.document.querySelector('#own-profile-summary-content').textContent).toContain('完整服务介绍');expect(w.dianliangState.activeId).toBe(active);await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'summary profile cleanup');
});
it('offers a retry when the own profile page read disconnects without losing the personal timeline',async()=>{
 const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:space');let fail=true;w.fetch=(url,options)=>url==='/api/review-own-profile'&&fail?Promise.reject(new w.TypeError('Test profile page disconnected')):transport(url,options);click(w,'nav:profile');await until(()=>!w.document.querySelector('#own-profile-summary-retry').hidden,'profile summary retry');expect(w.document.querySelector('#own-profile-summary-status').textContent).toContain('连接或保存未确认');expect(w.document.querySelector('main').textContent).toContain('个人实践时间线');fail=false;w.document.querySelector('#own-profile-summary-retry').click();await until(()=>w.document.querySelector('#own-profile-summary-status').textContent.includes('尚未保存'),'profile summary recovered');expect(w.dianliangState.activeId).toBe(active);
});
it('keeps profile editing private until explicit service saving and public consent',async()=>{
 const w=await ownProfileUI(),active=w.dianliangState.activeId;input(w,'#own-profile-form [name="about"]','本人服务介绍');expect((await(await transport('/api/review-own-profile')).json()).profile).toBeNull();click(w,'dialog-close');click(w,'review-own-profile');await until(()=>w.document.querySelector('#own-profile-form'),'profile draft reopened');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('本人服务介绍');const submit=()=>w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('私人保存'),'private profile saved');const visibility=w.document.querySelector('#own-profile-form [name="visibility"]');visibility.value='public';visibility.dispatchEvent(new w.Event('change',{bubbles:true}));submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('主动确认公开'),'public consent refused');w.document.querySelector('#own-profile-form [name="consent"]').checked=true;submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('明确公开'),'public profile saved');const read=await(await transport('/api/review-own-profile')).json();expect(read.profile.about).toBe('本人服务介绍');expect(read.profile.visibility).toBe('public');expect(w.dianliangState.activeId).toBe(active);await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'profile draft cleanup acknowledged');
});
it('retains both profile versions on conflict and updates only after explicit comparison',async()=>{
 const w=await ownProfileUI();input(w,'#own-profile-form [name="about"]','本人保留的输入');const before=await(await transport('/api/review-own-profile')).json();expect((await transport('/api/review-own-profile',{method:'POST',headers:{'Content-Type':'application/json','If-Match':before.revision},body:JSON.stringify({tagline:'',about:'另一窗口资料',focus:'',visibility:'private'})})).status).toBe(200);const submit=()=>w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('另一窗口'),'profile conflict visible');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('本人保留的输入');w.document.querySelector('#own-profile-refresh').click();await until(()=>!w.document.querySelector('#own-profile-rebase').hidden,'profile comparison available');expect(w.document.querySelector('#own-profile-current-text').textContent).toContain('另一窗口资料');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('本人保留的输入');w.document.querySelector('#own-profile-rebase').click();submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('私人保存'),'reviewed profile saved');expect((await(await transport('/api/review-own-profile')).json()).profile.about).toBe('本人保留的输入');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'reviewed draft cleanup');
});
it('restores an offline profile draft after reload and closes its private editor on account change',async()=>{
 let w=await ownProfileUI();offline=true;input(w,'#own-profile-form [name="about"]','断线私人资料草稿');await until(()=>w.document.querySelector('#review-sync-warning'),'profile offline warning');const cache=w.localStorage.getItem(KEY);w.close();offline=false;w=ui(cache);await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('已恢复')&&!w.document.querySelector('#app').inert,'profile draft recovery');click(w,'review-sync-retry');await until(()=>!w.document.querySelector('#review-sync-warning'),'profile draft sync retry');click(w,'review-own-profile');await until(()=>w.document.querySelector('#own-profile-form'),'restored profile editor');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('断线私人资料草稿');expect((await(await transport('/api/review-own-profile')).json()).profile).toBeNull();const archive=await(await transport('/api/review-account-export')).json();expect(archive.service.actionState.data.settings.profileDraft.data.about).toBe('断线私人资料草稿');await switchUser(w,'profile-next-reader');expect(w.document.querySelector('#own-profile-form')).toBeNull();expect(w.dianliangState.settings.profileDraft).toBeUndefined();
});
it('keeps newer profile input when a committed earlier save acknowledgement is delayed',async()=>{
 const w=await ownProfileUI(),active=w.dianliangState.activeId;input(w,'#own-profile-form [name="about"]','这次提交的介绍');const held=holdResponse(w,'/api/review-own-profile','POST');w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();input(w,'#own-profile-form [name="about"]','回执等待时继续写的介绍');held.release();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('之后的新输入保留'),'newer profile input retained');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('回执等待时继续写的介绍');expect((await(await transport('/api/review-own-profile')).json()).profile.about).toBe('这次提交的介绍');expect(w.dianliangState.settings.profileDraft.data.about).toBe('回执等待时继续写的介绍');expect(w.dianliangState.activeId).toBe(active);w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('私人保存'),'newer profile submitted');expect((await(await transport('/api/review-own-profile')).json()).profile.about).toBe('回执等待时继续写的介绍');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'newer profile cleanup');
});
it('stops an earlier profile submission when the reader edits while its private draft is still saving',async()=>{
 const w=await ownProfileUI();input(w,'#own-profile-form [name="about"]','准备提交的旧输入');const held=holdResponse(w,'/api/action-state','PUT');w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();input(w,'#own-profile-form [name="about"]','提交前已改的新输入');held.release();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('保存等待期间资料又有编辑'),'old submission stopped');expect((await(await transport('/api/review-own-profile')).json()).profile).toBeNull();expect(w.dianliangState.settings.profileDraft.data.about).toBe('提交前已改的新输入');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('提交前已改的新输入');await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'preflight draft acknowledged');
});
it('leaves a committed old-account profile in its owner account without showing its late receipt to the next account',async()=>{
 const w=await ownProfileUI(),originalOwner=w.dianliangState.user.id;input(w,'#own-profile-form [name="about"]','只属于原账号的服务资料');const held=holdResponse(w,'/api/review-own-profile','POST');w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();await switchUser(w,'profile-late-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#own-profile-form')).toBeNull();expect(w.dianliangState.user.name).toBe('profile-late-reader');expect((await(await transport('/api/review-own-profile')).json()).profile).toBeNull();const profiles=JSON.parse(fs.readFileSync(path.join(directory,'profiles.json'),'utf8'));expect(profiles.find(p=>p.id===originalOwner).about).toBe('只属于原账号的服务资料');
});
it('retries a committed profile with a lost acknowledgement without duplicating or rewriting the saved profile',async()=>{
 const w=await ownProfileUI();input(w,'#own-profile-form [name="about"]','回执丢失仍需保留的介绍');let lost=false;w.fetch=async(url,options)=>{const r=await transport(url,options);if(url==='/api/review-own-profile'&&options?.method==='POST'&&!lost){lost=true;throw new w.TypeError('Test lost profile acknowledgement')}return r};const submit=()=>w.document.querySelector('#own-profile-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('连接或保存未确认'),'lost profile acknowledgement visible');expect(w.document.querySelector('#own-profile-form [name="about"]').value).toBe('回执丢失仍需保留的介绍');expect(w.dianliangState.settings.profileDraft.data.about).toBe('回执丢失仍需保留的介绍');const file=path.join(directory,'profiles.json'),before=fs.readFileSync(file,'utf8');expect(JSON.parse(before)).toHaveLength(1);submit();await until(()=>w.document.querySelector('#own-profile-status').textContent.includes('私人保存'),'lost profile retry acknowledged');expect(fs.readFileSync(file,'utf8')).toBe(before);await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'lost profile draft cleanup');expect(w.dianliangState.settings.profileDraft).toBeUndefined();
});
it('preserves disconnected editing through two UI reloads and commits it on explicit retry', async () => {
  let w = await startedUI(); offline = true;
  input(w, '#single-note', '断线后的未同步草稿');
  await until(() => w.document.querySelector('#review-sync-warning'), 'failure warning');
  let cache = w.localStorage.getItem(KEY); expect(JSON.parse(cache).reviewSync.pending).toBe(true); w.close();
  offline = false;
  for (let i = 0; i < 2; i++) {
    w = ui(cache); await until(() => w.document.querySelector('#review-sync-warning')?.textContent.includes('已恢复'), 'restored edit warning');
    expect(w.document.querySelector('#single-note').value).toBe('断线后的未同步草稿');
    cache = w.localStorage.getItem(KEY); expect(JSON.parse(cache).reviewSync.pending).toBe(true);
    if (i === 0) w.close();
  }
  click(w, 'review-sync-retry');
  await until(() => !w.document.querySelector('#review-sync-warning'), 'retry completion');
  expect(JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending).toBe(false);
  const stored = (await (await transport('/api/action-state')).json()).state.data;
  expect(stored.events[0].draft).toBe('断线后的未同步草稿');
});

it('does not overwrite another server revision when a disconnected draft is restored', async () => {
  let w = await startedUI(); offline = true; input(w, '#single-note', '甲断线未保存');
  await until(() => w.document.querySelector('#review-sync-warning'), 'failure warning');
  const cache = w.localStorage.getItem(KEY); w.close(); offline = false;
  const remote = await (await transport('/api/action-state')).json(); remote.state.data.bio = '乙窗口已经保存的新介绍';
  const change = await transport('/api/action-state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': remote.revision }, body: JSON.stringify(remote.state) });
  expect(change.status).toBe(200);
  w = ui(cache); await until(() => w.document.querySelector('#review-sync-warning')?.textContent.includes('已恢复'), 'restored conflict');
  click(w, 'review-sync-retry');
  await until(() => w.document.querySelector('#review-sync-warning')?.textContent.includes('仍未完成'), 'conflict retained');
  expect(w.document.querySelector('#single-note').value).toBe('甲断线未保存');
  expect(JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending).toBe(true);
  expect((await (await transport('/api/action-state')).json()).state.data.bio).toBe('乙窗口已经保存的新介绍');
});

it('keeps only one failed transport snapshot while later offline edits stay in local recovery', async () => {
  const w = await startedUI(); offline = true;
  for (const text of ['断线编辑一', '断线编辑二', '断线编辑最终内容']) {
    input(w, '#single-note', text);
    await new Promise(resolve => setTimeout(resolve, 160));
  }
  // Read-only assertion of the transport queue after actual DOM editing.
  expect(w.readTransportSnapshot().pending.length).toBe(1);
  expect(JSON.parse(w.localStorage.getItem(KEY)).events[0].draft).toBe('断线编辑最终内容');
  offline = false; click(w, 'review-sync-retry');
  await until(() => !w.document.querySelector('#review-sync-warning'), 'latest offline edit saved');
  expect((await (await transport('/api/action-state')).json()).state.data.events[0].draft).toBe('断线编辑最终内容');
});
async function conflictingUI(){
  const w=await startedUI();
  const remote=await (await transport('/api/action-state')).json();remote.state.data.bio='另一窗口的介绍';
  expect((await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':remote.revision},body:JSON.stringify(remote.state)})).status).toBe(200);
  input(w,'#single-note','本机尚未同步的笔记');await until(()=>w.document.querySelector('#review-sync-warning'),'conflict warning');
  click(w,'review-sync-compare');await until(()=>w.document.querySelector('[data-action="review-resolve-local"]'),'review panel');
  return w;
}
it('unlocks only the requested history and discards a closed dialog password response',async()=>{
 const w=await startedUI();input(w,'#single-note','仅此事件的私人笔记');click(w,'save-note');const eventId=w.dianliangState.activeId;click(w,'finish:'+eventId);click(w,'dialog-close');click(w,'group:space');click(w,'nav:account');const lock=w.document.querySelector('[data-change="history-lock"]');lock.checked=true;lock.dispatchEvent(new w.Event('change',{bubbles:true}));click(w,'group:habit');click(w,'nav:records');click(w,'event-detail:'+eventId);expect(w.document.querySelector('#main-content').textContent).not.toContain('仅此事件的私人笔记');
 const before=cookie,held=holdResponse(w,'/api/review-password-check','POST');input(w,'#unlock-form [name="password"]','test-only-2026');w.document.querySelector('#unlock-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();click(w,'dialog-close');held.release();await new Promise(r=>setTimeout(r,30));expect(cookie).toBe(before);expect(w.document.querySelector('#main-content').textContent).not.toContain('仅此事件的私人笔记');
 click(w,'event-detail:'+eventId);input(w,'#unlock-form [name="password"]','test-only-2026');w.document.querySelector('#unlock-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#main-content').textContent.includes('仅此事件的私人笔记'),'verified event history');expect(cookie).toBe(before);
});
it('does not switch the current service session when an old password-check response arrives after account change',async()=>{
 const w=await startedUI();input(w,'#single-note','旧账号的历史私密内容');click(w,'save-note');const eventId=w.dianliangState.activeId;click(w,'finish:'+eventId);click(w,'dialog-close');click(w,'group:space');click(w,'nav:account');const lock=w.document.querySelector('[data-change="history-lock"]');lock.checked=true;lock.dispatchEvent(new w.Event('change',{bubbles:true}));click(w,'group:habit');click(w,'nav:records');click(w,'event-detail:'+eventId);
 const held=holdResponse(w,'/api/review-password-check','POST');input(w,'#unlock-form [name="password"]','test-only-2026');w.document.querySelector('#unlock-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();click(w,'dialog-close');await switchUser(w,'password-next-account');const currentCookie=cookie;held.release();await new Promise(r=>setTimeout(r,30));expect(cookie).toBe(currentCookie);expect((await(await transport('/api/me')).json()).user.name).toBe('password-next-account');expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.body.textContent).not.toContain('旧账号的历史私密内容');
});
it.each(['local','remote'])('resolves %s through the review dialog and retains both pre-replacement backups',async choice=>{
  let w=await conflictingUI();expect(w.document.querySelector('#dialogs').textContent).toContain('另一窗口的介绍');
  expect(w.document.querySelector('#dialogs').textContent).toContain('本机尚未同步的笔记');
  click(w,'review-resolve-'+choice);await until(()=>!w.document.querySelector('#dialogs dialog'),'resolution finished');
  const stored=(await (await transport('/api/action-state')).json()).state.data;
  expect(stored.events[0].draft).toBe(choice==='local'?'本机尚未同步的笔记':'');
  const archiveKey=Array.from({length:w.localStorage.length},(_,i)=>w.localStorage.key(i)).find(k=>k.includes('-version-review-'));
  const archives=JSON.parse(w.localStorage.getItem(archiveKey));expect(archives).toHaveLength(1);
  expect(archives[0].local.data.events[0].draft).toBe('本机尚未同步的笔记');expect(archives[0].remote.data.bio).toBe('另一窗口的介绍');
  const cache=w.localStorage.getItem(KEY),extra={[archiveKey]:w.localStorage.getItem(archiveKey)};w.close();w=ui(cache,extra);
  await until(()=>w.document.querySelector('[data-action="nav:profile"]')&&!w.document.querySelector('#app').inert,'restored page connected and interactive');
  click(w,'nav:profile');click(w,'nav:account');
  expect(w.document.querySelector('[data-action="review-archive-local:'+archives[0].id+'"]')).not.toBeNull();
  expect(w.document.querySelector('[data-action="review-archive-remote:'+archives[0].id+'"]')).not.toBeNull();
  const downloads=[];w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:review-backup'};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  const read=blob=>new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(JSON.parse(reader.result));reader.readAsText(blob)});
  click(w,'review-archive-local:'+archives[0].id);const localFile=await read(downloads.at(-1));
  expect(localFile.format).toBe('dianliang-local-backup/v1');expect(localFile.data.events[0].draft).toBe('本机尚未同步的笔记');
  click(w,'review-archive-remote:'+archives[0].id);expect((await read(downloads.at(-1))).data.bio).toBe('另一窗口的介绍');
});
it('cancels version review without replacing either copy',async()=>{
  const w=await conflictingUI(),before=JSON.stringify(w.dianliangState.events);click(w,'dialog-close');
  expect(JSON.stringify(w.dianliangState.events)).toBe(before);
  expect((await (await transport('/api/action-state')).json()).state.data.bio).toBe('另一窗口的介绍');
});
it('keeps both current copies when the service changes again before UI confirmation',async()=>{
  const w=await conflictingUI(),remote=await (await transport('/api/action-state')).json();remote.state.data.bio='核对后新增的服务介绍';
  await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':remote.revision},body:JSON.stringify(remote.state)});
  click(w,'review-resolve-local');await until(()=>w.document.querySelector('#review-version-error')?.textContent.includes('又有新修改'),'renewed conflict');
  expect(w.document.querySelector('#single-note').value).toBe('本机尚未同步的笔记');
  expect((await (await transport('/api/action-state')).json()).state.data.bio).toBe('核对后新增的服务介绍');
});
it('stops replacement if the local pre-replacement archive cannot be stored',async()=>{
  const w=await conflictingUI(),original=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(key,value){if(key.includes('-version-review-'))throw new w.DOMException('Archive full','QuotaExceededError');return original.call(this,key,value)};
  click(w,'review-resolve-remote');await until(()=>w.document.querySelector('#review-version-error')?.textContent.includes('未完成'),'archive error');
  expect(w.document.querySelector('#single-note').value).toBe('本机尚未同步的笔记');
  expect(JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending).toBe(true);
  expect((await (await transport('/api/action-state')).json()).state.data.bio).toBe('另一窗口的介绍');
});
it('requires a new review when local editing changes after the dialog opens',async()=>{
  const w=await conflictingUI();input(w,'#single-note','核对期间的新增笔记');click(w,'review-resolve-remote');
  await until(()=>w.document.querySelector('#review-version-error')?.textContent.includes('本机又有新修改'),'local review changed');
  expect(w.document.querySelector('#single-note').value).toBe('核对期间的新增笔记');
  expect((await (await transport('/api/action-state')).json()).state.data.events[0].draft).toBe('');
});
async function newMethodUI(title='界面保存的方法'){
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'contribute-node');
 input(w,'#method-form [name="title"]',title);input(w,'#method-form [name="content"]','求出x，再代回验证等式成立。');input(w,'#method-form [name="five"]','从2x+3=11开始。');
 w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#main-content')?.textContent.includes('服务私人'),'private service receipt');
 await until(async()=>{const s=(await (await transport('/api/action-state')).json()).state?.data;return s?.nodes.find(n=>n.id==='eq').methods.some(m=>m.title===title&&m.serviceReceipts?.length)},'private receipt synced');
 return w;
}
it('preserves unreadable service materials and reconnects on explicit retry after external recovery',async()=>{
 let w=await startedUI();const owner=w.dianliangState.user.id,name=path.join(directory,'action-states',owner+'.json'),original=fs.readFileSync(name,'utf8'),corrupt=JSON.parse(original);corrupt.data.events[0].knowledge={nodeId:'eq',resourceLinks:[{label:'旧资料',url:'javascript:alert(1)',optional:true,affiliate:false}]};const damaged=JSON.stringify(corrupt);fs.writeFileSync(name,damaged);const cache=w.localStorage.getItem(KEY),eventId=w.dianliangState.events[0].id;w.close();w=ui(cache);
 await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('服务档案无法读取')&&!w.document.querySelector('#app').inert,'unreadable archive warning');expect(w.dianliangState.events[0].id).toBe(eventId);expect(fs.readFileSync(name,'utf8')).toBe(damaged);
 click(w,'review-sync-retry');await until(()=>!w.document.querySelector('#app').inert,'failed retry finished');expect(w.document.querySelector('#review-sync-warning').textContent).toContain('原文件已保留');expect(fs.readFileSync(name,'utf8')).toBe(damaged);expect(w.readTransportSnapshot().ownerId).toBeNull();
 // Only the disposable test fixture restores the original server file.
 fs.writeFileSync(name,original);click(w,'review-sync-retry');await until(()=>!w.document.querySelector('#review-sync-warning')&&!w.document.querySelector('#app').inert,'explicit reconnect');expect(w.readTransportSnapshot().ownerId).toBe(owner);expect(w.dianliangState.events[0].id).toBe(eventId);input(w,'#single-note','恢复后继续记录');await until(async()=>{const state=(await(await transport('/api/action-state')).json()).state;return state?.data.events[0].draft==='恢复后继续记录'},'saving restored connection');
});
it('preserves multiple author resources through draft restoration, service saving and immutable revision',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'contribute-node');
 input(w,'#method-form [name="title"]','完整资料的方法');input(w,'#method-form [name="content"]','求解并代回。');input(w,'#method-form [name="five"]','写出等式。');
 for(let i=1;i<=2;i++){w.document.querySelector('#method-resource-add').click();input(w,`[aria-label="资料 ${i} 名称"]`,i===1?'练习材料':'辅助工具');input(w,`[aria-label="资料 ${i} 地址"]`,`https://example.com/material-${i}`)}
 const rows=w.document.querySelectorAll('#method-resource-rows fieldset');rows[0].querySelector('[data-resource-field="optional"]').checked=false;rows[0].querySelector('[data-resource-field="optional"]').dispatchEvent(new w.Event('input',{bubbles:true}));rows[1].querySelector('[data-resource-field="affiliate"]').checked=true;rows[1].querySelector('[data-resource-field="affiliate"]').dispatchEvent(new w.Event('input',{bubbles:true}));
 input(w,'[aria-label="资料 2 地址"]','javascript:alert(1)');w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));expect(w.document.querySelector('#method-error').textContent).toContain('HTTP');expect(w.document.querySelector('[aria-label="资料 2 名称"]').value).toBe('辅助工具');input(w,'[aria-label="资料 2 地址"]','https://example.com/material-2');
 click(w,'dialog-close');click(w,'contribute-node');expect(w.document.querySelector('[aria-label="资料 2 名称"]').value).toBe('辅助工具');
 const form=w.document.querySelector('#method-form');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#main-content')?.textContent.includes('服务私人'),'resource receipt');
 let tutorial=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.title==='完整资料的方法');const original=tutorial.resources;expect(original).toEqual([{label:'练习材料',url:'https://example.com/material-1',optional:false,affiliate:false},{label:'辅助工具',url:'https://example.com/material-2',optional:true,affiliate:true}]);
 const m=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='完整资料的方法');click(w,'edit-method:eq:'+m.id);input(w,'[aria-label="资料 2 地址"]','https://example.com/revised');w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#review-method-publish-form'),'revision review');expect(w.document.querySelector('#dialogs').textContent).toContain('https://example.com/revised');w.document.querySelector('#review-method-publish-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(async()=>{const t=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.title==='完整资料的方法');return t?.resources[1]?.url==='https://example.com/revised'},'revised resources');expect(m.versions[0].resourceLinks).toEqual(original);expect(m.versions[1].resourceLinks[1].url).toBe('https://example.com/revised');
 const history=[...w.document.querySelectorAll('summary')].find(s=>s.textContent==='审阅全部版本（2）').closest('details');expect(history.querySelector('a[href="https://example.com/material-2"]')).not.toBeNull();expect(history.querySelector('a[href="https://example.com/revised"]')).not.toBeNull();expect(history.textContent).toContain('当时的五分钟起步');expect(history.textContent).toContain('写出等式。');
 click(w,'nav:atlas');click(w,'node:eq');click(w,'select-method:'+m.id);click(w,'practice');const event=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(event.knowledge.resourceLinks).toEqual(m.versions[1].resourceLinks);m.versions[1].resourceLinks[1].label='Later mutation';expect(event.knowledge.resourceLinks[1].label).toBe('辅助工具');
});
it('saves a method through the full editor into the actual private tutorial service',async()=>{
 const w=await newMethodUI();const response=await (await transport('/api/tutorials')).json();expect(response.tutorials).toHaveLength(1);
 expect(response.tutorials[0].visibility).toBe('private');expect(response.tutorials[0].method).toBe('求出x，再代回验证等式成立。');
 expect(w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法').visibility).toBe('private');
});
it('publishes only after completing target self-confirmation and explicit service consent in the UI',async()=>{
 const w=await newMethodUI();click(w,'nav:atlas');click(w,'node:eq');click(w,'practice');
 const eventId=w.dianliangState.activeId;click(w,'finish:'+eventId);
 const light=w.dianliangState.lights.find(l=>l.eventId===eventId);click(w,'report-light:'+eventId);
 input(w,'#light-form [name="result"]','解出x=4。');input(w,'#light-form [name="evidence"]','私人依据：代回两侧都是11。');
 w.document.querySelector('#light-form [name="confirm"]').checked=true;
 w.document.querySelector('#light-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 click(w,'group:knowledge');click(w,'nav:contribute');const method=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法');
 click(w,'share-method:eq:'+method.id);await until(()=>w.document.querySelector('#review-method-publish-form'),'service review');
 expect((await (await transport('/api/tutorials')).json()).tutorials[0].visibility).toBe('private');
 w.document.querySelector('#review-method-publish-form [name="consent"]').checked=true;
 w.document.querySelector('#review-method-publish-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>!w.document.querySelector('#review-method-publish-form'),'public receipt');
 await until(async()=>{const data=(await (await transport('/api/action-state')).json()).state.data;return data.nodes.find(n=>n.id==='eq').methods.find(m=>m.id===method.id).serviceReceipts.at(-1).visibility==='public'},'public receipt synced');
 const tutorial=(await (await transport('/api/tutorials')).json()).tutorials[0];expect(tutorial.visibility).toBe('public');
 expect(w.document.querySelector('#main-content').textContent).toContain('服务公开');
 const aliceCookie=cookie;await transport('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'ui-method-reader',password:'test-only-2026'})});
 const shared=await (await transport('/api/tutorials')).json();expect(shared.tutorials).toHaveLength(1);expect(JSON.stringify(shared)).not.toContain('私人依据');cookie=aliceCookie;
});
it('keeps the local method version when the service updates after the review opened',async()=>{
 const w=await newMethodUI();const method=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法');
 click(w,'edit-method:eq:'+method.id);input(w,'#method-form [name="content"]','第二版界面文字必须保留。');
 w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#review-method-publish-form'),'revision review');
 const old=(await (await transport('/api/tutorials')).json()).tutorials[0];
 expect((await transport('/api/tutorials/'+old.id,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':old.version},body:JSON.stringify({method:'另一窗口已经保存的服务修改。'})})).status).toBe(200);
 w.document.querySelector('#review-method-publish-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#review-method-publish-error')?.textContent.includes('新版本'),'method conflict');
 expect(w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.id===method.id).versions.at(-1).content).toBe('第二版界面文字必须保留。');
 expect((await (await transport('/api/tutorials')).json()).tutorials[0].method).toBe('另一窗口已经保存的服务修改。');
});
it('does not create duplicate methods when the service save is confirmed twice',async()=>{
 const w=await newMethodUI();const method=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法');
 click(w,'share-method:eq:'+method.id);await until(()=>w.document.querySelector('#review-method-publish-form'),'service review');
 const form=w.document.querySelector('#review-method-publish-form'),select=form.elements.namedItem('visibility');select.value='private';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>!w.document.querySelector('#review-method-publish-form'),'idempotent service save');
 expect((await (await transport('/api/tutorials')).json()).tutorials).toHaveLength(1);
});
it('retains editor content and avoids a public-success label when the service request disconnects',async()=>{
 const w=await newMethodUI(),method=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法');
 click(w,'share-method:eq:'+method.id);await until(()=>w.document.querySelector('#review-method-publish-form'),'service review');
 const form=w.document.querySelector('#review-method-publish-form'),select=form.elements.namedItem('visibility');select.value='private';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 offline=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#review-method-publish-error')?.textContent.includes('文字已保留'),'failed request retained');
 expect(w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.id===method.id).versions[0].content).toBe('求出x，再代回验证等式成立。');
 expect(w.document.querySelector('#main-content').textContent).not.toContain('服务公开');
});
it('continues service saving when a native-like dialog close event is delivered asynchronously',async()=>{
 const w=await startedUI();w.HTMLDialogElement.prototype.close=function(){this.open=false;setTimeout(()=>this.dispatchEvent(new w.Event('close')),0)};
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'contribute-node');
 input(w,'#method-form [name="title"]','异步关闭不阻断服务保存');input(w,'#method-form [name="content"]','求解后代回检验。');input(w,'#method-form [name="five"]','先写出等式。');
 w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(async()=>{const r=await (await transport('/api/tutorials')).json();return r.tutorials.some(m=>m.title==='异步关闭不阻断服务保存')},'asynchronous dialog service save');
 expect(w.document.querySelector('#main-content').textContent).toContain('服务私人');
});
async function peerTutorial(){
 await transport('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'shared-ui-author',password:'test-only-2026'})});
 const authorCookie=cookie,treeId='dianliang-review-catalog-v1',nodeId='od-eq';
 await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId,nodeId,text:'本人完成求解与检验。',lightUp:true,visibility:'private'})});
 const r=await transport('/api/tutorials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId,nodeId,title:'他人的代回方法',method:'先求解，再代回原等式。',startAction:'先求2x+3=11。',resources:[{label:'必需材料',url:'https://example.com/first',affiliate:false,optional:false},{label:'可选材料',url:'https://example.com/second',affiliate:true,optional:true}],visibility:'public'})});
 expect(r.status).toBe(201);cookie='';return {tutorial:(await r.json()).tutorial,authorCookie};
}
it('loads folded peer methods and starts a real event with the original author, version and every resource',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');
 const ownIds=w.dianliangState.nodes.find(n=>n.id==='eq').methods.map(m=>m.id);
 click(w,'review-shared-load:eq');await until(()=>w.document.querySelector('#node-detail')?.textContent.includes('本次读取 1 份'),'shared method load');
 const methodId='service-'+tutorial.id+'-'+tutorial.version,detail=w.document.querySelector('[data-method-id="'+methodId+'"]');expect(detail.open).toBe(false);expect(detail.textContent).toContain('shared-ui-author');const versionHistory=detail.querySelector('.method-body > details');expect(versionHistory.open).toBe(false);expect([...detail.querySelectorAll('a')].filter(a=>!versionHistory.contains(a))).toHaveLength(2);expect(versionHistory.querySelectorAll('a')).toHaveLength(2);
 expect(w.dianliangState.nodes.find(n=>n.id==='eq').methods.map(m=>m.id)).toEqual(ownIds);
 click(w,'select-method:'+methodId);click(w,'practice');const eventId=w.dianliangState.activeId;
 await until(async()=>{const r=await(await transport('/api/review-method-bindings')).json();return r.bindings.some(b=>b.source.source.id===methodId)},'peer binding');
 const event=w.dianliangState.events.find(e=>e.id===eventId),before=JSON.stringify(event.knowledge);expect(event.knowledge.methodAuthor).toBe('shared-ui-author');expect(event.knowledge.resourceLinks).toEqual(tutorial.resources);expect(event.knowledge.serviceReference.version).toBe(tutorial.version);
 expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'作者后来修订的内容。'})})).status).toBe(200);
 expect(JSON.stringify(event.knowledge)).toBe(before);expect(w.dianliangState.events.filter(e=>e.segments.some(s=>s.end===null))).toHaveLength(1);
 click(w,'finish:'+eventId);expect(w.document.querySelector('#dialogs').textContent).toContain('shared-ui-author');expect(w.document.querySelector('#dialogs').querySelectorAll('a')).toHaveLength(2);expect(w.document.querySelector('#dialogs').textContent).toContain(tutorial.version.slice(0,8));
});
it('shows a retryable peer-load failure without removing own methods or changing an existing event',async()=>{
 await peerTutorial();const w=await startedUI(),eventId=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');
 const before=JSON.stringify(w.dianliangState.nodes.find(n=>n.id==='eq').methods);w.fetch=(url,options)=>url.startsWith('/api/review-shared-methods')?Promise.reject(new TypeError('Disconnected shared read')):transport(url,options);
 click(w,'review-shared-load:eq');await until(()=>w.document.querySelector('#node-detail')?.textContent.includes('自己的方法与原快照保留'),'shared failure');
 expect(JSON.stringify(w.dianliangState.nodes.find(n=>n.id==='eq').methods)).toBe(before);expect(w.dianliangState.activeId).toBe(eventId);
 w.fetch=transport;click(w,'review-shared-load:eq');await until(()=>w.document.querySelector('#node-detail')?.textContent.includes('本次读取 1 份'),'shared retry');
});
async function endedPeerUI(){
 const {tutorial}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'review-shared-load:eq');
 await until(()=>w.document.querySelector('#node-detail')?.textContent.includes('本次读取 1 份'),'practice peer read');
 const methodId='service-'+tutorial.id+'-'+tutorial.version;click(w,'select-method:'+methodId);click(w,'practice');const eventId=w.dianliangState.activeId;
 await until(async()=>{const r=await(await transport('/api/review-method-bindings')).json();return r.bindings.some(b=>b.source.source.id===methodId)},'practice peer bound');
 click(w,'finish:'+eventId);return {w,eventId,tutorial};
}
function submitPractice(w){w.document.querySelector('#review-practice-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))}
it('opens saved service practices with their original method, goal, materials and corresponding event notes',async()=>{
 const {w,eventId,tutorial}=await endedPeerUI();click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'archive practice review');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'archive practice saved');click(w,'group:space');click(w,'nav:profile');click(w,'review-owned-practices');await until(()=>w.document.querySelector('#own-practice-status').textContent.includes('1 条已保存'),'own practice archive');const content=w.document.querySelector('#own-practice-results').textContent;expect(content).toContain('求出未知数，并代回原方程验证等式成立。');expect(content).toContain(tutorial.authorName);expect(content).toContain('尚未确认点亮');expect(w.document.querySelectorAll('#own-practice-results a')).toHaveLength(4);expect(w.document.querySelector('#own-practice-results').textContent).toContain('保存历史（1 次）');expect(w.dianliangState.activeId).toBeNull();w.document.querySelector('[data-own-practice-event]').click();expect(w.document.querySelector('main').textContent).toContain('知识实践快照');expect(w.dianliangState.events.find(e=>e.id===eventId).knowledge.serviceReference.version).toBe(tutorial.version);
});
it('labels older own records without filling missing knowledge or timing from current nodes and excludes other authors',async()=>{
 await peerTutorial();const w=await startedUI(),active=w.dianliangState.activeId;expect((await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'LEGACY-OWN-PRACTICE',visibility:'private',lightUp:true})})).status).toBe(201);click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-owned-practices');await until(()=>w.document.querySelector('#own-practice-status').textContent.includes('1 条未核对'),'legacy own practice archive');const text=w.document.querySelector('#own-practice-results').textContent;expect(text).toContain('LEGACY-OWN-PRACTICE');expect(text).toContain('未核对完整目标与活动段');expect(text).not.toContain('求出未知数，并代回原方程验证等式成立。');expect(text).not.toContain('本人完成求解与检验。');expect(w.dianliangState.activeId).toBe(active);
});
it('retries failed service practice reads and discards a delayed archive after another account logs in',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:contribute');let fail=true;w.fetch=(url,options)=>url==='/api/review-practices'&&fail?Promise.reject(new w.TypeError('Test practice archive disconnected')):transport(url,options);click(w,'review-owned-practices');await until(()=>!w.document.querySelector('#own-practice-retry').hidden,'practice archive retry visible');expect(w.document.querySelector('#own-practice-status').textContent).toContain('实践读取未确认');fail=false;const held=holdResponse(w,'/api/review-practices');w.document.querySelector('#own-practice-retry').click();await held.wait();await switchUser(w,'practice-archive-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#own-practice-results')).toBeNull();expect(w.dianliangState.user.name).toBe('practice-archive-reader');
});
it('counts a practice once across draft and self-confirmed saves while retaining unreadable-current history',async()=>{
 const {w,eventId}=await endedPeerUI();click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'practice history first save');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'practice history draft saved');click(w,'group:knowledge');click(w,'nav:contribute');const light=w.dianliangState.lights.find(l=>l.eventId===eventId);click(w,'confirm-light:'+light.id);input(w,'#light-form [name="result"]','已求出x=4');input(w,'#light-form [name="evidence"]','代回后两边都是11');w.document.querySelector('#light-form [name="confirm"]').checked=true;w.document.querySelector('#light-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'practice history self confirmation');const f=w.document.querySelector('#review-practice-form');f.elements.namedItem('useLight').checked=true;f.elements.namedItem('updateConsent').checked=true;submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'practice self confirmation saved');click(w,'review-owned-practices');await until(()=>w.document.querySelector('#own-practice-status').textContent.includes('1 条已保存'),'practice history count');expect(w.document.querySelector('#own-practice-results').textContent).toContain('保存历史（2 次）');expect(w.document.querySelector('#own-practice-results').textContent).toContain('当时草稿');expect(w.document.querySelector('#own-practice-results').textContent).toContain('当时本人自证');const archive=await(await transport('/api/review-practices')).json(),id=archive.current[0].record.id;expect((await transport('/api/records/'+id,{method:'DELETE'})).status).toBe(200);click(w,'dialog-close');click(w,'review-owned-practices');await until(()=>w.document.querySelector('#own-practice-status').textContent.includes('1 条已保存'),'missing current receipt history');expect(w.document.querySelector('#own-practice-results').textContent).toContain('当前记录不可读，显示保存历史');expect(w.dianliangState.events.some(e=>e.id===eventId)).toBe(true);
});
async function pagedPublicPracticeUI(count=21){
 const {authorCookie}=await peerTutorial();const records=[];
 for(let i=0;i<count;i++){const response=await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'分页公开实践 '+i,visibility:'public',lightUp:false})});expect(response.status).toBe(201);records.push((await response.json()).record)}
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 20'),'public first page');w.document.querySelector('#public-practice-results > button').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('第 2 页'),'public second page');return {w,records,authorCookie};
}
it('reads previous public practice pages through three pages and retains the back trail after sidebar rebuilding',async()=>{
 const {w}=await pagedPublicPracticeUI(41),active=w.dianliangState.activeId,second=[...w.document.querySelectorAll('#public-practice-results article')].map(e=>e.textContent);expect(second).toHaveLength(20);w.document.querySelector('[data-public-practice-next]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('第 3 页'),'third practice page');expect(w.document.querySelectorAll('#public-practice-results article')).toHaveLength(1);click(w,'group:space');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('第 3 页'),'third page sidebar redraw');w.document.querySelector('[data-public-practice-previous]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('第 2 页'),'back to second');expect([...w.document.querySelectorAll('#public-practice-results article')].map(e=>e.textContent)).toEqual(second);w.document.querySelector('[data-public-practice-previous]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('第 1 页'),'back to first');expect(w.document.querySelector('[data-public-practice-previous]')).toBeNull();expect(w.document.querySelectorAll('#public-practice-results article')).toHaveLength(20);expect(w.dianliangState.activeId).toBe(active);
});
it('resets the public practice back trail after a new search while retaining the active clock',async()=>{
 const {w}=await pagedPublicPracticeUI(),active=w.dianliangState.activeId;expect(w.document.querySelector('[data-public-practice-previous]')).not.toBeNull();input(w,'#public-practice-form [name="query"]','分页公开实践');w.document.querySelector('#public-practice-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('第 1 页'),'new search first page');expect(w.document.querySelector('[data-public-practice-previous]')).toBeNull();expect(w.document.querySelectorAll('#public-practice-results article')).toHaveLength(20);expect(w.dianliangState.activeId).toBe(active);
});
it('keeps the public practice page position through sidebar rebuilds without retaining stale rendered results',async()=>{
 const {w}=await pagedPublicPracticeUI(),active=w.dianliangState.activeId,second=w.document.querySelector('#public-practice-results article').textContent;
 click(w,'group:space');await until(()=>w.document.querySelector('#public-practice-results article'),'second page after sidebar');expect(w.document.querySelector('#public-practice-status').textContent).toContain('本页 1');expect(w.document.querySelector('#public-practice-results article').textContent).toBe(second);expect(w.dianliangState.activeId).toBe(active);
 input(w,'#public-practice-form [name="query"]','分页公开实践');w.document.querySelector('#public-practice-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 20'),'new search starts first page');
});
it('requires an explicit first-page read when retained public pagination becomes invalid after withdrawal',async()=>{
 const {w,records,authorCookie}=await pagedPublicPracticeUI();expect((await transport('/api/records/'+records[0].id,{method:'DELETE',headers:{Cookie:authorCookie}})).status).toBe(200);click(w,'group:space');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('公开实践已变化'),'withdrawn cursor warning');expect(w.document.querySelectorAll('#public-practice-results article')).toHaveLength(0);w.document.querySelector('#public-practice-results > button').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 20'),'explicit first page refresh');
});
it('does not reuse public pagination across another account or a fresh login by the original reader',async()=>{
 const {w}=await pagedPublicPracticeUI();await switchUser(w,'page-position-reader');click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 20'),'different reader starts first page');w.document.querySelector('#public-practice-results > button').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 1'),'different reader second page');await switchUser(w,'recovery-ui',false);if(!w.document.querySelector('[data-action="nav:publicPractices"]'))click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 20'),'original reader fresh login starts first page');
});
it('opens the current knowledge target from a public practice without starting or switching the active event',async()=>{
 const {w}=await pagedPublicPracticeUI(),active=w.dianliangState.activeId;w.document.querySelector('[data-practice-target]').click();await until(()=>w.document.querySelector('main').dataset.page==='atlas','practice current target');expect(w.document.querySelector('main').textContent).toContain('求出未知数');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events).toHaveLength(1);click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('本页 1'),'return to original practice page');
});
it('rejects a withdrawn practice entry and ignores an old target read after account change',async()=>{
 const {w,authorCookie}=await pagedPublicPracticeUI();const page=await(await transport('/api/review-public-practices')).json();const second=(await(await transport('/api/review-public-practices?cursor='+encodeURIComponent(page.nextCursor))).json()).practices[0];expect((await transport('/api/records/'+second.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})})).status).toBe(200);w.document.querySelector('[data-practice-target]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('已不再公开'),'withdrawn practice blocked');expect(w.document.querySelector('main').dataset.page).toBe('publicPractices');click(w,'nav:atlas');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-results > button'),'invalid page retry');w.document.querySelector('#public-practice-results > button').click();await until(()=>w.document.querySelector('[data-practice-target]'),'first page restored');const now=(await(await transport('/api/review-public-practices')).json()).practices[0],held=holdResponse(w,'/api/review-public-practices/one?id='+now.id);w.document.querySelector('[data-practice-target]').click();await held.wait();await switchUser(w,'practice-entry-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.dianliangState.user.name).toBe('practice-entry-reader');expect(w.document.querySelector('main').dataset.page).not.toBe('atlas');expect(w.dianliangState.events).toHaveLength(0);
});
it('opens a personally held public target from a practice while retaining its ownership and the reader clock',async()=>{
 const {node,authorCookie}=await visiblePeerTutorial();expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:node.treeId,nodeId:node.id,text:'公开草图实践',visibility:'public',lightUp:false})})).status).toBe(201);const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('[data-practice-target]'),'personal public practice');w.document.querySelector('[data-practice-target]').click();await until(()=>w.document.querySelector('#visible-target-start'),'personal practice target');expect(w.document.querySelector('#dialogs').textContent).toContain('个人持有人');expect(w.document.querySelector('#dialogs').textContent).toContain('完成草图并解释构图关系。');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events).toHaveLength(1);expect(w.dianliangState.nodes.some(n=>n.id===node.id)).toBe(false);
});
it('browses an author public practices, searches within that scope and returns to all authors without changing the clock',async()=>{
 const {w}=await pagedPublicPracticeUI(),active=w.dianliangState.activeId;expect((await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'另一个作者的公开实践',visibility:'public',lightUp:false})})).status).toBe(201);w.document.querySelector('[data-practice-author]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'author practice scope');expect(w.document.querySelector('main').textContent).toContain('shared-ui-author的公开实践');expect(w.document.querySelector('#public-practice-results').textContent).not.toContain('另一个作者的公开实践');click(w,'group:space');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'author retained after sidebar');input(w,'#public-practice-form [name="query"]','另一个作者');w.document.querySelector('#public-practice-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 0'),'search within author');w.document.querySelector('#public-practice-author-clear').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 1'),'all authors with retained search');expect(w.document.querySelector('#public-practice-results').textContent).toContain('另一个作者的公开实践');expect(w.dianliangState.activeId).toBe(active);
});
it('does not retain an author practice filter after another reader logs in',async()=>{
 const {w}=await pagedPublicPracticeUI();w.document.querySelector('[data-practice-author]').click();await until(()=>w.document.querySelector('#public-practice-author-clear'),'author scope');await switchUser(w,'author-scope-reader');click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'new reader all scope');expect(w.document.querySelector('#public-practice-author-clear')).toBeNull();expect(w.dianliangState.events).toHaveLength(0);
});
it('connects author practices to public introduction and tutorials and returns to the same author without switching clocks',async()=>{
 const {w}=await pagedPublicPracticeUI(),active=w.dianliangState.activeId,owner=(await(await transport('/api/review-public-practices')).json()).practices[0].authorId;fs.writeFileSync(path.join(directory,'profiles.json'),JSON.stringify([{id:owner,visibility:'public',tagline:'本人公开的代数介绍',about:'实践后整理检验步骤',focus:'代回检验',secret:'PRIVATE-AUTHOR-SECRET'}]));w.document.querySelector('[data-practice-author]').click();await until(()=>w.document.querySelector('#public-practice-author-details'),'practice author details');w.document.querySelector('#public-practice-author-details').click();await until(()=>w.document.querySelector('#public-tutorial-status')?.textContent.includes('找到 1'),'author tutorial browser');expect(w.document.querySelector('#dialogs').textContent).toContain('本人公开的代数介绍');expect(w.document.querySelector('#dialogs').textContent).not.toContain('PRIVATE-AUTHOR-SECRET');w.document.querySelector('#public-author-practices').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'return author practices');expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.querySelector('main').textContent).toContain('shared-ui-author的公开实践');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events).toHaveLength(1);
});
it('ignores a held practice author introduction after the reader changes accounts',async()=>{
 const {w}=await pagedPublicPracticeUI(),owner=(await(await transport('/api/review-public-practices')).json()).practices[0].authorId;w.document.querySelector('[data-practice-author]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'author practices');const held=holdResponse(w,'/api/review-public-tutorials/author?id='+owner);w.document.querySelector('#public-practice-author-details').click();await held.wait();await switchUser(w,'author-intro-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#public-tutorial-search')).toBeNull();expect(w.dianliangState.user.name).toBe('author-intro-reader');
});
it('browses practices for a graph target and composes author filtering without changing the active event',async()=>{
 const {w}=await pagedPublicPracticeUI(),active=w.dianliangState.activeId;expect((await transport('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-num',text:'其他目标记录',visibility:'public',lightUp:false})})).status).toBe(201);click(w,'nav:atlas');click(w,'node:eq');click(w,'review-node-practices:eq');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'exact graph target practices');expect(w.document.querySelector('#public-practice-target-clear')).not.toBeNull();expect(w.document.querySelector('#public-practice-results').textContent).not.toContain('其他目标记录');w.document.querySelector('[data-practice-author]').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'author with target');expect(w.document.querySelector('#public-practice-target-clear')).not.toBeNull();w.document.querySelector('#public-practice-author-clear').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 21'),'target retained without author');w.document.querySelector('#public-practice-target-clear').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 22'),'all targets');expect(w.dianliangState.activeId).toBe(active);
});
it('opens a personally held target practice scope from its public details and clears it after account change',async()=>{
 const {node,authorCookie}=await visiblePeerTutorial();expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:node.treeId,nodeId:node.id,text:'草图目标的实践',visibility:'public',lightUp:false})})).status).toBe(201);const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('[data-practice-target]'),'personal public practice');w.document.querySelector('[data-practice-target]').click();await until(()=>w.document.querySelector('#visible-target-practices'),'personal target practices entry');w.document.querySelector('#visible-target-practices').click();await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 1'),'personal target scope');expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.querySelector('main').textContent).toContain('说明草图结构的公开实践');expect(w.dianliangState.activeId).toBe(active);await switchUser(w,'target-scope-reader');click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 1'),'new reader all practices');expect(w.document.querySelector('#public-practice-target-clear')).toBeNull();
});
it('previews disclosed practice images through protected media and keeps a readable failure without changing clocks',async()=>{
 const {authorCookie}=await peerTutorial(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';const saved=await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'公开图片实践',visibility:'public',lightUp:false,images:[{mediaType:'image/png',dataUrl:'data:image/png;base64,'+png}]})});expect(saved.status).toBe(201);const record=(await saved.json()).record,w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('[data-practice-image]'),'protected image preview');const img=w.document.querySelector('[data-practice-image]');expect(img.getAttribute('src')).toBe('/api/media/'+record.images[0].id);expect(img.getAttribute('loading')).toBe('lazy');expect(img.alt).toContain('shared-ui-author');expect(img.closest('a').getAttribute('href')).toBe(img.getAttribute('src'));img.dispatchEvent(new w.Event('error'));expect(img.hidden).toBe(true);expect(img.closest('a').hidden).toBe(true);expect(img.closest('figure').textContent).toContain('图片暂时无法读取');expect(w.document.querySelector('#public-practice-results').textContent).toContain('公开图片实践');expect(w.dianliangState.activeId).toBe(active);
});
it('discovers peer public records without exposing their private source and keeps the active event unchanged',async()=>{
 const {authorCookie}=await peerTutorial();expect((await transport('/api/records',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({treeId:'dianliang-review-catalog-v1',nodeId:'od-eq',text:'公开实践：代回验证',visibility:'public',lightUp:true})})).status).toBe(201);const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-practices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 1'),'peer public practice');expect(w.document.querySelector('#public-practice-results').textContent).toContain('公开实践：代回验证');expect(w.document.querySelector('#public-practice-results').textContent).toContain('尚未核对完整目标与活动快照');expect(w.document.querySelector('#public-practice-results').textContent).not.toContain('本人完成求解与检验。');expect(w.dianliangState.activeId).toBe(active);input(w,'#public-practice-form [name="query"]','不存在的实践');w.document.querySelector('#public-practice-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 0'),'public practice search');expect(w.dianliangState.activeId).toBe(active);
});
it('ignores a held public practice page after its search changes and after a different account logs in',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');let held=holdResponse(w,'/api/review-public-practices?query=');click(w,'review-public-practices');await held.wait();input(w,'#public-practice-form [name="query"]','新搜索');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#public-practice-status').textContent).toContain('搜索词已修改');input(w,'#public-practice-form [name="query"]','');click(w,'nav:atlas');held=holdResponse(w,'/api/review-public-practices?query=');click(w,'review-public-practices');await held.wait();await switchUser(w,'public-practice-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#public-practice-results')).toBeNull();expect(w.dianliangState.user.name).toBe('public-practice-reader');
});
it('keeps the public practice route and account-private search through reload without opening a modal or switching clocks',async()=>{
 let w=await startedUI();const active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 0'),'public sidebar page');expect(w.document.querySelector('main').dataset.page).toBe('publicPractices');expect(w.document.querySelector('[data-action="nav:publicPractices"]').classList.contains('selected')).toBe(true);expect(w.document.querySelector('#dialogs').textContent).toBe('');input(w,'#public-practice-form [name="query"]','留给本人的搜索');w.document.querySelector('#public-practice-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!JSON.parse(w.localStorage.getItem(KEY)).reviewSync.pending,'public page search saved privately');const cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);await until(()=>w.document.querySelector('#public-practice-form')&&!w.document.querySelector('#app').inert,'public page restored');expect(w.document.querySelector('main').dataset.page).toBe('publicPractices');expect(w.document.querySelector('#public-practice-form [name="query"]').value).toBe('留给本人的搜索');expect(w.dianliangState.activeId).toBe(active);await switchUser(w,'practice-page-reader');click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 0'),'new owner public page');expect(w.document.querySelector('#public-practice-form [name="query"]').value).toBe('');
});
it('discards the public practice page response after the reader leaves the page',async()=>{
 const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');const held=holdResponse(w,'/api/review-public-practices?query=');click(w,'nav:publicPractices');await held.wait();click(w,'nav:paths');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('main').dataset.page).toBe('paths');expect(w.document.querySelector('#public-practice-results')).toBeNull();expect(w.dianliangState.activeId).toBe(active);
});
it('keeps focus in the service mobile menu after expanding groups and restores the menu trigger with Escape',async()=>{
 const w=await startedUI(),active=w.dianliangState.activeId;expect(w.document.querySelector('.sidebar').inert).toBe(true);click(w,'open-nav');expect(w.document.querySelector('.main').inert).toBe(true);expect(w.document.activeElement.dataset.action).toBe('close-nav');click(w,'group:knowledge');expect(w.document.activeElement.dataset.action).toBe('group:knowledge');expect(w.document.querySelector('.sidebar').getAttribute('aria-modal')).toBe('true');w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(w.document.querySelector('.main').inert).toBe(false);expect(w.document.querySelector('.sidebar').inert).toBe(true);expect(w.document.activeElement.dataset.action).toBe('open-nav');expect(w.dianliangState.activeId).toBe(active);
});
it('moves focus to the public practice page after mobile navigation without moving the active clock',async()=>{
 const w=await startedUI(),active=w.dianliangState.activeId;click(w,'open-nav');click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 0'),'mobile public page ready');expect(w.document.querySelector('.main').inert).toBe(false);expect(w.document.querySelector('.sidebar').inert).toBe(true);expect(w.document.activeElement.id).toBe('main-content');expect(w.document.querySelector('main').dataset.page).toBe('publicPractices');expect(w.dianliangState.activeId).toBe(active);
});
it('ignores a late input from a detached public search after the account changes',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:publicPractices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 0'),'late input public page');const old=w.document.querySelector('#public-practice-form [name="query"]');await switchUser(w,'late-query-reader');old.value='原账号迟到的私人搜索';old.dispatchEvent(new w.Event('input',{bubbles:true}));expect(w.dianliangState.settings.publicPracticeSearch).toBeUndefined();expect(w.dianliangState.user.name).toBe('late-query-reader');
});
it('saves an ended practice as a private service draft without confirming light-up or exposing private notes',async()=>{
 const {w,eventId}=await endedPeerUI();click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'private practice review');
 const f=w.document.querySelector('#review-practice-form');expect(f.elements.namedItem('visibility').value).toBe('private');expect(f.elements.namedItem('useLight').checked).toBe(false);
 submitPractice(w);submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'private practice saved');
 const records=(await(await transport('/api/records')).json()).records.filter(r=>r.eventId===eventId);expect(records).toHaveLength(1);expect(records[0].visibility).toBe('private');expect(records[0].lightUp).toBe(false);
 expect(w.dianliangState.lights.find(l=>l.eventId===eventId).confirmed).toBe(false);expect(w.dianliangState.events.find(e=>e.id===eventId).practiceReceipts).toHaveLength(1);
});
it('publishes a practice only after local L1 confirmation, separate public consent and existing-record update consent',async()=>{
 const {w,eventId}=await endedPeerUI();click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'initial draft review');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'initial draft saved');
 click(w,'group:knowledge');click(w,'nav:contribute');const light=w.dianliangState.lights.find(l=>l.eventId===eventId);click(w,'confirm-light:'+light.id);input(w,'#light-form [name="result"]','解得x=4。');input(w,'#light-form [name="evidence"]','代回得到11=11。');w.document.querySelector('#light-form [name="confirm"]').checked=true;w.document.querySelector('#light-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'public practice review');const f=w.document.querySelector('#review-practice-form'),scope=f.elements.namedItem('visibility');scope.value='public';scope.dispatchEvent(new w.Event('change',{bubbles:true}));f.elements.namedItem('useLight').checked=true;f.elements.namedItem('updateConsent').checked=true;
 submitPractice(w);expect((await(await transport('/api/records')).json()).records.find(r=>r.eventId===eventId).visibility).toBe('private');
 f.elements.namedItem('publicConsent').checked=true;submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'public practice receipt');
 const record=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===eventId);expect(record.visibility).toBe('public');expect(record.lightUp).toBe(true);expect(record.text).toContain('11=11');
 click(w,'nav:atlas');click(w,'review-public-practices');await until(()=>w.document.querySelector('#public-practice-status').textContent.includes('找到 1'),'bound public practice feed');expect(w.document.querySelector('#public-practice-results details summary').textContent).toBe('所用教程 · 他人的代回方法');expect(w.document.querySelector('#public-practice-results').textContent).toContain('求出未知数，并代回原方程验证等式成立。');expect(w.document.querySelector('#public-practice-results').textContent).toContain('shared-ui-author');expect(w.document.querySelectorAll('#public-practice-results details a[href^="http"][target="_blank"]')).toHaveLength(2);expect(w.document.querySelectorAll('#public-practice-results details a[href^="/platform/#node/"][target="_blank"]')).toHaveLength(1);expect(w.document.querySelectorAll('#public-practice-results [data-practice-link]')).toHaveLength(1);click(w,'nav:contribute');
 const archive=(await(await transport('/api/review-practices')).json());expect(archive.receipts.filter(r=>r.eventId===eventId)).toHaveLength(2);expect(archive.current.find(r=>r.eventId===eventId).record.visibility).toBe('public');
 click(w,'share-light:'+light.id);await until(()=>w.document.querySelector('#review-practice-form'),'withdraw practice review');const withdraw=w.document.querySelector('#review-practice-form');expect(withdraw.elements.namedItem('visibility').value).toBe('private');expect(withdraw.elements.namedItem('useLight').checked).toBe(true);withdraw.elements.namedItem('updateConsent').checked=true;submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'withdraw practice saved');
 const withdrawn=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===eventId);expect(withdrawn.visibility).toBe('private');expect(withdrawn.lightUp).toBe(true);expect(w.dianliangState.lights.find(l=>l.id===light.id).confirmed).toBe(true);expect(w.dianliangState.lights.find(l=>l.id===light.id).public).toBe(false);expect(w.document.querySelector('[data-action="share-light:'+light.id+'"]').textContent).toBe('选择公开证据');
});
it('retains a failed practice save for explicit review and rejects a concurrent record revision',async()=>{
 const {w,eventId}=await endedPeerUI();click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'offline practice review');
 w.fetch=(url,options)=>url==='/api/review-practices'&&options?.method==='POST'?Promise.reject(new TypeError('Practice disconnected')):transport(url,options);submitPractice(w);await until(()=>w.document.querySelector('#review-practice-error')?.textContent.includes('原事件与选择保留'),'practice network failure');
 expect(w.dianliangState.events.find(e=>e.id===eventId).practiceReceipts).toBeUndefined();w.fetch=transport;click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form')&&!w.document.querySelector('#review-practice-error').textContent,'practice retry review');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'practice retry saved');
 click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'existing practice review');const file=path.join(directory,'records.json'),records=JSON.parse(fs.readFileSync(file,'utf8'));records.find(r=>r.eventId===eventId).text='另一窗口保存的当前记录';fs.writeFileSync(file,JSON.stringify(records));
 w.document.querySelector('#review-practice-form [name="updateConsent"]').checked=true;submitPractice(w);await until(()=>w.document.querySelector('#review-practice-error')?.textContent.length,'practice concurrency failure');expect(JSON.parse(fs.readFileSync(file,'utf8')).find(r=>r.eventId===eventId).text).toBe('另一窗口保存的当前记录');
});
it('starts an independent target and saves it through the UI without a fictional tutorial reference',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'practice');const eventId=w.dianliangState.activeId,k=w.dianliangState.events.find(e=>e.id===eventId).knowledge;
 expect(k.methodId).toBeNull();expect(k.nodeOwnership).toBe('group');expect(k.nodeDomain).toBe('数学');expect(w.document.querySelector('.timer-core').textContent).not.toContain('vnull');click(w,'finish:'+eventId);click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'independent review');
 expect(w.document.querySelector('#review-practice-form').textContent).toContain('不创建教程引用');expect(w.document.querySelector('[name="binding"]')).toBeNull();submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'independent saved');
 const record=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===eventId);expect(record.practiceMode).toBe('independent');expect(record.tutorialId).toBeNull();expect(record.lightUp).toBe(false);expect((await(await transport('/api/tutorials')).json()).tutorials).toHaveLength(0);
});
it('publishes independent L1 from the UI without borrowing another tutorial or changing the target snapshot',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'practice');const eventId=w.dianliangState.activeId,original=JSON.stringify(w.dianliangState.events.find(e=>e.id===eventId).knowledge);click(w,'finish:'+eventId);click(w,'report-light:'+eventId);
 input(w,'#light-form [name="result"]','独立求得x=4。');input(w,'#light-form [name="evidence"]','自行代回检验等式成立。');w.document.querySelector('#light-form [name="confirm"]').checked=true;w.document.querySelector('#light-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'independent public review');const f=w.document.querySelector('#review-practice-form'),scope=f.elements.namedItem('visibility');scope.value='public';scope.dispatchEvent(new w.Event('change',{bubbles:true}));f.elements.namedItem('useLight').checked=true;f.elements.namedItem('publicConsent').checked=true;submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'independent public saved');
 const record=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===eventId);expect(record.visibility).toBe('public');expect(record.lightUp).toBe(true);expect(record.practiceMode).toBe('independent');expect(record.tutorialId).toBeNull();expect(record.sourceSnapshot.methodAuthor).toBeUndefined();expect(JSON.stringify(w.dianliangState.events.find(e=>e.id===eventId).knowledge)).toBe(original);
});
it('creates and explicitly saves a private target from the UI while preserving source and service revisions',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:contribute');click(w,'new-node');input(w,'#node-form [name="title"]','本人界面私人目标');input(w,'#node-form [name="goal"]','保留这个完整私人目标。');input(w,'#node-form [name="five"]','先写一行草图说明。');w.document.querySelector('#node-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const n=w.dianliangState.nodes.find(n=>n.title==='本人界面私人目标');click(w,'review-private-target:'+n.id);await until(()=>w.document.querySelector('#review-private-target-form'),'private target review');w.document.querySelector('#review-private-target-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#review-private-target-form'),'private target saved');
 const first=(await(await transport('/api/review-private-targets')).json()).bindings[0];expect(first.target.goal).toBe('保留这个完整私人目标。');expect(w.document.querySelector('#main-content').textContent).toContain('上次服务私人回执：目标 v1');
 click(w,'edit-node:'+n.id);input(w,'#node-form [name="goal"]','界面明确修订后的完整私人目标。');w.document.querySelector('#node-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));click(w,'review-private-target:'+n.id);await until(()=>w.document.querySelector('#review-private-target-form'),'private target revision review');w.document.querySelector('#review-private-target-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#review-private-target-form'),'private target revision saved');
 const bindings=(await(await transport('/api/review-private-targets')).json()).bindings;expect(bindings).toHaveLength(2);expect(bindings[0]).toEqual(first);expect(bindings[1].ref.nodeId).toBe(first.ref.nodeId);
 click(w,'node-nav:'+n.id);click(w,'practice');const eventId=w.dianliangState.activeId;click(w,'finish:'+eventId);click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'private target practice review');expect(w.document.querySelector('#review-practice-form [name="visibility"] option[value="public"]').disabled).toBe(true);submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'private target practice saved');const record=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===eventId);expect(record.visibility).toBe('private');expect(record.targetVersion).toBe(bindings[1].ref.targetVersion);expect(record.tutorialId).toBeNull();
 click(w,'group:knowledge');click(w,'nav:contribute');click(w,'node-nav:'+n.id);click(w,'contribute-node');input(w,'#method-form [name="title"]','私人目标的方法');input(w,'#method-form [name="content"]','先画草图，再解释理由。');input(w,'#method-form [name="five"]','先画三条线。');w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(async()=>{const tutorials=(await(await transport('/api/tutorials')).json()).tutorials;return tutorials.some(t=>t.title==='私人目标的方法')},'private target method saved');const method=w.dianliangState.nodes.find(x=>x.id===n.id).methods.find(m=>m.title==='私人目标的方法');
 click(w,'share-method:'+n.id+':'+method.id);await until(()=>w.document.querySelector('#review-method-publish-form'),'private method scope review');expect(w.document.querySelector('#review-method-publish-form [name="visibility"]').value).toBe('private');expect(w.document.querySelector('#review-method-publish-form option[value="public"]').disabled).toBe(true);click(w,'dialog-close');click(w,'node-nav:'+n.id);click(w,'select-method:'+method.id);click(w,'practice');const methodEvent=w.dianliangState.activeId;click(w,'finish:'+methodEvent);click(w,'review-practice-open:'+methodEvent);await until(()=>w.document.querySelector('#review-practice-form'),'private method practice review');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'private method practice saved');expect((await(await transport('/api/records')).json()).records.find(r=>r.eventId===methodEvent).tutorialId).toBeTruthy();
});
it('publishes and withdraws only the reviewed target from the full UI while keeping its private source',async()=>{
 const w=await startedUI();input(w,'#single-note','SHARING-PRIVATE-NOTE');click(w,'save-note');click(w,'group:knowledge');click(w,'nav:contribute');click(w,'new-node');input(w,'#node-form [name="title"]','界面目标公开验收');input(w,'#node-form [name="goal"]','完成一个可以解释的草图。');input(w,'#node-form [name="five"]','先画三条线。');w.document.querySelector('#node-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const n=w.dianliangState.nodes.find(n=>n.title==='界面目标公开验收');click(w,'review-private-target:'+n.id);await until(()=>w.document.querySelector('#review-private-target-form'),'private source review');w.document.querySelector('#review-private-target-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#review-private-target-form'),'private source saved');
 const binding=(await(await transport('/api/review-private-targets')).json()).bindings[0];click(w,'share-node:'+n.id);await until(()=>w.document.querySelector('#review-target-sharing-form'),'target sharing review');expect(w.document.querySelector('#dialogs').textContent).toContain('个人持有权保留');const f=w.document.querySelector('#review-target-sharing-form');f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#review-target-sharing-error').textContent,'consent refusal');expect(n.visibility).toBe('private');f.elements.namedItem('consent').checked=true;f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>n.targetSharingReceipt?.visibility==='public','public receipt');expect(n.visibility).toBe('private');expect(n.ownership).toBe('personal');expect(w.document.querySelector('#main-content').textContent).toContain('公开展示');
 const originalCookie=cookie;await transport('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'sharing-ui-reader',password:'test-only-2026'})});const others=(await(await transport('/api/nodes')).json()).nodes;expect(others.some(x=>x.id===n.targetSharingReceipt.nodeId)).toBe(true);expect(JSON.stringify(others)).not.toContain('SHARING-PRIVATE-NOTE');expect(others.some(x=>x.id===binding.ref.nodeId)).toBe(false);cookie=originalCookie;
 click(w,'share-node:'+n.id);await until(()=>w.document.querySelector('#review-target-sharing-form'),'withdraw review');const withdraw=w.document.querySelector('#review-target-sharing-form');withdraw.elements.namedItem('action').value='withdraw';withdraw.elements.namedItem('consent').checked=true;withdraw.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>n.targetSharingReceipt.visibility==='private','withdraw receipt');expect((await(await transport('/api/review-private-targets')).json()).bindings[0]).toEqual(binding);expect(w.dianliangState.events[0].notes[0].text).toBe('SHARING-PRIVATE-NOTE');
});
it('discovers another account target and saves an independent practice with its exact public version',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:contribute');click(w,'new-node');input(w,'#node-form [name="title"]','他人发现用的草图');input(w,'#node-form [name="goal"]','解释一幅草图的构思。');input(w,'#node-form [name="five"]','先画三条线。');w.document.querySelector('#node-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const n=w.dianliangState.nodes.find(n=>n.title==='他人发现用的草图');click(w,'review-private-target:'+n.id);await until(()=>w.document.querySelector('#review-private-target-form'),'private definition');w.document.querySelector('#review-private-target-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!w.document.querySelector('#review-private-target-form'),'private saved');click(w,'share-node:'+n.id);await until(()=>w.document.querySelector('#review-target-sharing-form'),'public review');const publish=w.document.querySelector('#review-target-sharing-form');publish.elements.namedItem('consent').checked=true;publish.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>n.targetSharingReceipt?.visibility==='public','public target');const reference=structuredClone(n.targetSharingReceipt);
 await switchUser(w,'discovery-reader');click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-visible-targets');await until(()=>w.document.querySelector('[data-visible-index]'),'public discovery');expect(w.document.querySelector('#dialogs').textContent).toContain('他人发现用的草图');w.document.querySelector('[data-visible-index]').click();w.document.querySelector('#visible-target-start').click();await until(()=>w.dianliangState.activeId&&w.dianliangState.events[0].knowledge?.targetServiceReference,'independent public target event');const e=w.dianliangState.events[0],snapshot=JSON.stringify(e.knowledge);expect(e.knowledge.nodeId).toBe(reference.nodeId);expect(e.knowledge.targetServiceReference.targetVersion).toBe(reference.version);expect(e.knowledge.methodId).toBeNull();input(w,'#single-note','READER-PRIVATE-NOTE');click(w,'save-note');click(w,'finish:'+e.id);click(w,'review-practice-open:'+e.id);await until(()=>w.document.querySelector('#review-practice-form'),'reader practice review');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'reader private practice');const record=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===e.id);expect(record.nodeId).toBe(reference.nodeId);expect(record.targetVersion).toBe(reference.version);expect(record.visibility).toBe('private');expect(record.lightUp).toBe(false);expect(record.tutorialId).toBeNull();expect(JSON.stringify(e.knowledge)).toBe(snapshot);
});
it('deletes an ended event and its service practice through confirmation without stopping another event',async()=>{
 const w=await startedUI(),otherId=w.dianliangState.activeId;input(w,'#single-note','保留正在做的事');click(w,'save-note');click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');click(w,'practice');const eventId=w.dianliangState.activeId;click(w,'finish:'+eventId);click(w,'review-practice-open:'+eventId);await until(()=>w.document.querySelector('#review-practice-form'),'practice save panel');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'practice saved');click(w,'resume:'+otherId);click(w,'nav:records');click(w,'event-detail:'+eventId);click(w,'delete-event:'+eventId);expect(w.document.querySelector('#dialogs').textContent).toContain('已保存知识实践及其回执');
 offline=true;click(w,'confirm-delete:'+eventId);await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('删除尚未确认')&&!w.document.querySelector('#app').inert,'failed deletion retained');expect(w.dianliangState.events.some(e=>e.id===eventId)).toBe(true);offline=false;click(w,'review-sync-retry');await until(()=>!w.document.querySelector('#review-sync-warning'),'connection retry');click(w,'confirm-delete:'+eventId);await until(()=>!w.dianliangState.events.some(e=>e.id===eventId)&&!w.document.querySelector('#app').inert,'confirmed service deletion');expect(w.dianliangState.activeId).toBe(otherId);expect(w.dianliangState.events.find(e=>e.id===otherId).notes[0].text).toBe('保留正在做的事');expect((await(await transport('/api/records')).json()).records.some(r=>r.eventId===eventId)).toBe(false);expect((await(await transport('/api/review-practices')).json()).receipts.some(r=>r.eventId===eventId)).toBe(false);expect((await(await transport('/api/action-state')).json()).state.data.events.some(e=>e.id===eventId)).toBe(false);
});
it.each(['POST','GET'])('preserves a background edit while the deletion %s response is held and refuses to resurrect the deleted event on retry',async(method)=>{
 const w=await startedUI(),eventId=w.dianliangState.activeId;
 input(w,'#single-note','删除前的单次笔记');click(w,'save-note');
 click(w,'another');input(w,'#another-form [name="name"]','保留活动事件');
 w.document.querySelector('#another-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const activeId=w.dianliangState.activeId;expect(activeId).not.toBe(eventId);
 click(w,'finish:'+eventId);click(w,'dialog-close');click(w,'nav:records');click(w,'event-detail:'+eventId);click(w,'delete-event:'+eventId);
 const held=holdResponse(w,method==='POST'?'/api/review-event-deletion':'/api/action-state',method);
 click(w,'confirm-delete:'+eventId);await held.wait();
 const baseRevision=w.readTransportSnapshot().revision;
 const deleted=(await(await transport('/api/action-state')).json());
 expect(deleted.state.data.events.some(e=>e.id===eventId)).toBe(false);
 expect(deleted.revision).not.toBe(baseRevision);
 // Controlled asynchronous callback injection in this disposable JSDOM fixture:
 // user input is inert, but previously started background work can still complete.
 w.dianliangState.bio='删除请求途中到达的后台介绍更新';
 held.release();
 await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('服务删除已确认')&&!w.document.querySelector('#app').inert,'background edit retained');
 expect(w.dianliangState.bio).toBe('删除请求途中到达的后台介绍更新');
 expect(w.dianliangState.activeId).toBe(activeId);
 expect(w.readTransportSnapshot().revision).toBe(baseRevision);
 expect(w.readTransportSnapshot().pending.length).toBeGreaterThan(0);
 const cache=JSON.parse(w.localStorage.getItem(KEY));
 expect(cache.bio).toBe(w.dianliangState.bio);expect(cache.reviewSync.pending).toBe(true);expect(cache.reviewSync.revision).toBe(baseRevision);
 click(w,'review-sync-retry');
 await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('服务器有新版本')&&!w.document.querySelector('#app').inert,'stale resurrection refused');
 const after=(await(await transport('/api/action-state')).json());
 expect(after.revision).toBe(deleted.revision);
 expect(after.state.data.events.some(e=>e.id===eventId)).toBe(false);
 expect(after.state.data.activeId).toBe(activeId);
 expect(w.dianliangState.bio).toBe('删除请求途中到达的后台介绍更新');
});
it('keeps a pending local copy when deletion commits but its response is lost, including after reload',async()=>{
 let w=await startedUI();const eventId=w.dianliangState.activeId;
 input(w,'#single-note','响应丢失时保留的本机内容');click(w,'save-note');click(w,'finish:'+eventId);click(w,'dialog-close');click(w,'nav:records');click(w,'event-detail:'+eventId);click(w,'delete-event:'+eventId);
 w.fetch=async(url,options)=>{const result=await transport(url,options);if(url==='/api/review-event-deletion'&&options?.method==='POST')throw new TypeError('Fixture lost response after committed deletion');return result};
 click(w,'confirm-delete:'+eventId);
 await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('删除尚未确认')&&!w.document.querySelector('#app').inert,'ambiguous deletion response');
 const service=(await(await transport('/api/action-state')).json());
 expect(service.state.data.events.some(e=>e.id===eventId)).toBe(false);
 expect(w.dianliangState.events.some(e=>e.id===eventId)).toBe(true);
 const cache=w.localStorage.getItem(KEY);expect(JSON.parse(cache).reviewSync.pending).toBe(true);
 expect(JSON.parse(cache).reviewSync.revision).not.toBe(service.revision);
 w.close();w=ui(cache);
 await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('已恢复'),'ambiguous deletion restored');
 click(w,'review-sync-retry');await until(()=>w.document.querySelector('#review-sync-warning')?.textContent.includes('服务器有新版本')&&!w.document.querySelector('#app').inert,'deletion retry remains reviewable');
 const after=(await(await transport('/api/action-state')).json());expect(after.revision).toBe(service.revision);expect(after.state.data.events.some(e=>e.id===eventId)).toBe(false);
 expect(w.dianliangState.events.find(e=>e.id===eventId).notes[0].text).toBe('响应丢失时保留的本机内容');
 click(w,'review-sync-compare');await until(()=>w.document.querySelector('[data-action="review-resolve-remote"]'),'deletion versions reviewed');
 click(w,'review-resolve-remote');await until(()=>!w.document.querySelector('#review-sync-warning')&&!w.dianliangState.events.some(e=>e.id===eventId),'reviewed deletion adopted');
 const backups=JSON.parse(w.localStorage.getItem(KEY+'-version-review-'+w.dianliangState.user.id));
 expect(backups.at(-1).local.data.events.find(e=>e.id===eventId).notes[0].text).toBe('响应丢失时保留的本机内容');
 expect(backups.at(-1).remote.data.events.some(e=>e.id===eventId)).toBe(false);
 expect((await(await transport('/api/action-state')).json()).revision).toBe(service.revision);
});
async function visiblePeerTutorial(){
 async function call(url,body,headers={}){const r=await transport(url,{...(body?{method:url==='/api/action-state'?'PUT':'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',...headers}});const v=await r.json();expect(r.ok).toBe(true);return v}
 await call('/api/register',{name:'visible-tutorial-author',password:'test-only-2026'});
 const state={schema:1,mode:'local-simulation',activeId:null,habitId:'h',habits:[{id:'h',name:'阅读',formedAt:null}],templates:{},nodes:[{id:'my-visible-goal',title:'说明草图结构',goal:'完成草图并解释构图关系。',five:'先画三条构图线。',domain:'创造',branch:'草图',ownership:'personal',visibility:'private',version:1,methods:[]}],events:[],lights:[]};
 let revision=(await call('/api/action-state')).revision;revision=(await call('/api/action-state',{format:'dianliang-action-state/v1',data:state},{'If-Match':revision})).revision;
 await call('/api/review-private-targets',{nodeId:'my-visible-goal',sourceVersion:1},{'If-Match':revision});
 const node=(await call('/api/review-target-sharing',{nodeId:'my-visible-goal',sourceVersion:1,action:'publish',consent:true},{'If-Match':revision})).node;
 const knowledge={nodeId:node.id,nodeTitle:node.title,nodeGoal:node.goal,nodeVersion:node.sourceVersion,nodeDomain:node.domain,nodeBranch:node.branch,nodeOwnership:'personal',nodeVisibility:'public',methodId:null,methodTitle:'独立尝试',version:null,content:'',resource:'',five:node.five,targetServiceReference:{nodeId:node.id,treeId:node.treeId,targetVersion:node.version,sourceVersion:node.sourceVersion,ownerId:node.ownerId}};
 state.events=[{id:'author-proof',name:node.title,startedAt:0,endedAt:10,segments:[{start:0,end:10}],steps:[],stepDone:{},draft:'AUTHOR-PRIVATE-DRAFT',notes:[],knowledge}];state.lights=[{id:'author-light',eventId:'author-proof',nodeId:node.id,confirmed:true,public:false,result:'已完成构图',evidence:'核对了构图关系'}];revision=(await call('/api/action-state',{format:'dianliang-action-state/v1',data:state},{'If-Match':revision})).revision;
 await call('/api/review-practices',{eventId:'author-proof',practiceMode:'independent',tutorialId:null,tutorialVersion:null,lightId:'author-light',visibility:'private'},{'If-Match':revision});
 const tutorial=(await call('/api/tutorials',{treeId:node.treeId,nodeId:node.id,targetVersion:node.version,title:'先构图再补细节',method:'先安排主要结构，再补充细节。',startAction:'标出主体的三个位置。',resources:[{label:'所需练习纸',url:'https://example.com/paper',affiliate:false,optional:false},{label:'补充材料',url:'https://example.com/extra',affiliate:true,optional:true}],visibility:'public'})).tutorial;
 const authorCookie=cookie;cookie='';return {node,tutorial,authorCookie};
}
it('selects another account public-target tutorial and saves the actual historical method after its author revises it',async()=>{
 const {node,tutorial,authorCookie}=await visiblePeerTutorial(),w=await startedUI(),otherId=w.dianliangState.activeId;
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-visible-targets');await until(()=>w.document.querySelector('[data-visible-index]'),'visible target read');w.document.querySelector('[data-visible-index]').click();w.document.querySelector('#visible-method-load').click();await until(()=>w.document.querySelector('[data-visible-method-index]'),'target tutorials read');
 expect(w.document.querySelector('#visible-method-results').textContent).toContain('所需练习纸');expect(w.document.querySelector('#dialogs').textContent).not.toContain('AUTHOR-PRIVATE-DRAFT');w.document.querySelector('[data-visible-method-index]').click();
 await until(()=>w.dianliangState.events[0]?.knowledge?.practiceMode==='visible-tutorial','tutorial action started');
 const event=w.dianliangState.events[0],snapshot=JSON.stringify(event.knowledge);expect(event.knowledge.nodeFive).toBe(node.five);expect(event.knowledge.five).toBe(tutorial.startAction);expect(event.knowledge.methodAuthor).toBe('visible-tutorial-author');expect(event.knowledge.resourceLinks).toEqual(tutorial.resources);expect(w.dianliangState.events.find(e=>e.id===otherId).segments.every(s=>s.end!==null)).toBe(true);
 await until(async()=>{const s=(await(await transport('/api/action-state')).json()).state;return s?.data.events[0]?.knowledge?.practiceMode==='visible-tutorial'},'reader source saved');
 const readerCookie=cookie;cookie=authorCookie;let changed;try{changed=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({targetVersion:node.version,method:'作者后来修订的新步骤。'})});expect(changed.status).toBe(200)}finally{cookie=readerCookie}
 input(w,'#single-note','READER-PRIVATE-METHOD-NOTE');click(w,'save-note');click(w,'finish:'+event.id);click(w,'review-practice-open:'+event.id);await until(()=>w.document.querySelector('#review-practice-form'),'visible tutorial practice review');submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'historical tutorial practice saved');
 const record=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===event.id);expect(record.practiceMode).toBe('visible-tutorial');expect(record.tutorialVersion).toBe(tutorial.version);expect(record.sourceSnapshot.content).toBe(tutorial.method);expect(record.sourceSnapshot.resourceLinks).toEqual(tutorial.resources);expect(record.targetVersion).toBe(node.version);expect(record.lightUp).toBe(false);expect(record.visibility).toBe('private');expect(JSON.stringify(record)).not.toContain('READER-PRIVATE-METHOD-NOTE');expect(JSON.stringify(event.knowledge)).toBe(snapshot);
 const before=(await(await transport('/api/action-state')).json());const bad=structuredClone(before.state);bad.data.events.find(e=>e.id===event.id).knowledge.resourceLinks[0].optional=true;
 const independentClaim=await transport('/api/review-practices',{method:'POST',headers:{'Content-Type':'application/json','If-Match':before.revision},body:JSON.stringify({eventId:event.id,practiceMode:'independent',tutorialId:null,tutorialVersion:null,visibility:'private'})});expect(independentClaim.status).toBe(400);
 const altered=await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':before.revision},body:JSON.stringify(bad)});expect(altered.status).toBe(200);const alteredRevision=(await altered.json()).revision;
 const refused=await transport('/api/review-practices',{method:'POST',headers:{'Content-Type':'application/json','If-Match':alteredRevision},body:JSON.stringify({eventId:event.id,practiceMode:'visible-tutorial',tutorialId:tutorial.id,tutorialVersion:tutorial.version,visibility:'private'})});expect(refused.status).toBe(400);expect((await refused.json()).code).toBe('PRACTICE_SNAPSHOT_MISMATCH');expect((await(await transport('/api/records')).json()).records.find(r=>r.id===record.id)).toEqual(record);
 const restored=await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':alteredRevision},body:JSON.stringify(before.state)});expect(restored.status).toBe(200);const restoredRevision=(await restored.json()).revision;
 const currentCookie=cookie;cookie=authorCookie;try{const latest=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.id===tutorial.id);const withdraw=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':latest.version},body:JSON.stringify({visibility:'private'})});expect(withdraw.status).toBe(200)}finally{cookie=currentCookie}
 const privateRetry=await transport('/api/review-practices',{method:'POST',headers:{'Content-Type':'application/json','If-Match':restoredRevision},body:JSON.stringify({eventId:event.id,practiceMode:'visible-tutorial',tutorialId:tutorial.id,tutorialVersion:tutorial.version,visibility:'private'})});expect(privateRetry.status).toBe(200);expect((await privateRetry.json()).repeated).toBe(true);
 const publicData=structuredClone(before.state),light=publicData.data.lights.find(l=>l.eventId===event.id);Object.assign(light,{confirmed:true,public:true,result:'本人完成构图',evidence:'已核对结构'});const publicSource=await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':restoredRevision},body:JSON.stringify(publicData)});expect(publicSource.status).toBe(200);
 const publish=await transport('/api/review-practices',{method:'POST',headers:{'Content-Type':'application/json','If-Match':(await publicSource.json()).revision,'If-Practice-Match':record.practiceRevision||((await(await transport('/api/review-practices')).json()).current.find(c=>c.eventId===event.id).recordRevision)},body:JSON.stringify({eventId:event.id,practiceMode:'visible-tutorial',tutorialId:tutorial.id,tutorialVersion:tutorial.version,lightId:light.id,visibility:'public'})});expect(publish.status).toBe(403);expect((await publish.json()).code).toBe('PRACTICE_PUBLIC_CONFIRMATION_REQUIRED');
});
it('publishes a public-target tutorial practice only after this reader confirms L1 and chooses public consent',async()=>{
 const {tutorial,authorCookie}=await visiblePeerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-visible-targets');await until(()=>w.document.querySelector('[data-visible-index]'),'published target read');w.document.querySelector('[data-visible-index]').click();w.document.querySelector('#visible-method-load').click();await until(()=>w.document.querySelector('[data-visible-method-index]'),'published tutorial read');w.document.querySelector('[data-visible-method-index]').click();await until(()=>w.dianliangState.events[0]?.knowledge?.practiceMode==='visible-tutorial','published tutorial selected');
 const e=w.dianliangState.events[0];input(w,'#single-note','READER-PRIVATE-PUBLICATION-NOTE');click(w,'save-note');click(w,'finish:'+e.id);click(w,'dialog-close');click(w,'group:knowledge');click(w,'nav:contribute');const light=w.dianliangState.lights.find(l=>l.eventId===e.id);click(w,'confirm-light:'+light.id);input(w,'#light-form [name="result"]','本人完成一幅构图草图。');input(w,'#light-form [name="evidence"]','已经说明主体与背景的关系。');w.document.querySelector('#light-form [name="confirm"]').checked=true;w.document.querySelector('#light-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 click(w,'review-practice-open:'+e.id);await until(()=>w.document.querySelector('#review-practice-form'),'tutorial public practice review');const f=w.document.querySelector('#review-practice-form');f.elements.namedItem('visibility').value='public';f.elements.namedItem('visibility').dispatchEvent(new w.Event('change',{bubbles:true}));f.elements.namedItem('useLight').checked=true;
 submitPractice(w);expect((await(await transport('/api/records')).json()).records.some(r=>r.eventId===e.id)).toBe(false);f.elements.namedItem('publicConsent').checked=true;submitPractice(w);await until(()=>!w.document.querySelector('#review-practice-form'),'tutorial public practice saved');
 const own=(await(await transport('/api/records')).json()).records.find(r=>r.eventId===e.id);expect(own.practiceMode).toBe('visible-tutorial');expect(own.visibility).toBe('public');expect(own.lightUp).toBe(true);expect(own.tutorialVersion).toBe(tutorial.version);
 const readerCookie=cookie;cookie=authorCookie;try{const visible=(await(await transport('/api/records')).json()).records.find(r=>r.id===own.id);expect(visible).not.toHaveProperty('sourceSnapshot');expect(visible).not.toHaveProperty('sourceFingerprint');expect(JSON.stringify(visible)).not.toContain('READER-PRIVATE-PUBLICATION-NOTE');const detail=await transport('/api/review-public-practices/one?id='+encodeURIComponent(own.id));expect(detail.status).toBe(200);const {practice}=await detail.json();expect(practice.snapshot.methodAuthor).toBe('visible-tutorial-author');expect(practice.snapshot.resourceLinks).toEqual(tutorial.resources);expect(practice.activity.startedAt).toBeUndefined();expect(JSON.stringify(practice)).not.toContain('READER-PRIVATE-PUBLICATION-NOTE')}finally{cookie=readerCookie}
 click(w,'nav:atlas');await reopenVisibleTarget(w);w.document.querySelector('#visible-method-contribute').click();input(w,'#visible-contribution-form [name="title"]','读者已自证后的公开教程');input(w,'#visible-contribution-form [name="method"]','结合本人实践说明构图步骤。');const contribution=w.document.querySelector('#visible-contribution-form');contribution.elements.namedItem('visibility').value='public';contribution.elements.namedItem('visibility').dispatchEvent(new w.Event('change',{bubbles:true}));contribution.elements.namedItem('consent').checked=true;submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'confirmed reader public contribution');const published=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.title==='读者已自证后的公开教程');expect(published.visibility).toBe('public');expect(published.authorId).toBe(w.dianliangState.user.id);expect(published.targetSnapshot.version).toBe(own.targetVersion);
 const registration=await transport('/api/register',{method:'POST',headers:{Cookie:'','Content-Type':'application/json'},body:JSON.stringify({name:'practice-feed-observer',password:'test-password-2026'})});
 expect(registration.status).toBe(201);
 const observerCookie=cookie;cookie=readerCookie;
 const observer=(await registration.json()).user;
 const {FORMAT,validateActionState}=require('./action-state.cjs');
 const observerState=validateActionState({schema:1,mode:'local-simulation',activeId:null,events:[],habitId:'habit',habits:[{id:'habit',name:'阅读',formedAt:null}],templates:{},settings:{followedAuthors:[{id:own.authorId,name:own.authorName,followedAt:1}]}});
 const feed=(scope,query='')=>transport('/api/review-'+scope+'-feed?kind=practice&query='+encodeURIComponent(query),{headers:{Cookie:observerCookie}});
 const followingFile=path.join(directory,'action-states',observer.id+'.json');
 fs.writeFileSync(followingFile,JSON.stringify({format:FORMAT,data:observerState}));
 for(const scope of ['community','following']){
  const {entries}=await(await feed(scope,tutorial.title)).json();
  expect(entries.find(item=>item.item.id===own.id).item.tutorialReference.version).toBe(tutorial.version);
 }
 const withdrawn=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})});
 expect(withdrawn.status).toBe(200);
 const {practice:after}=await(await transport('/api/review-public-practices/one?id='+encodeURIComponent(own.id))).json();
 expect(after).toMatchObject({id:own.id,text:own.text,tutorialReference:null,tutorialUnavailable:true,snapshot:{nodeGoal:own.sourceSnapshot.nodeGoal}});
 for(const key of ['methodTitle','methodAuthor','content','five','resource','resourceLinks'])expect(after.snapshot).not.toHaveProperty(key);
 const {entries}=await(await transport('/api/review-community-feed?kind=practice')).json();
 expect(entries.find(e=>e.item.id===own.id).item).toEqual(after);
 expect((await(await feed('following')).json()).entries.find(item=>item.item.id===own.id).item).toEqual(after);
 for(const scope of ['community','following']){
  const {entries}=await(await feed(scope,tutorial.title)).json();
  expect(entries.some(item=>item.item.id===own.id)).toBe(false);
 }
 const {practices}=await(await transport('/api/review-public-practices?query='+encodeURIComponent(tutorial.title))).json();
 expect(practices.some(p=>p.id===own.id)).toBe(false);
 click(w,'nav:discover');
 await until(()=>[...w.document.querySelectorAll('#following-feed-results article')].some(row=>row.textContent.includes('原教程版本目前不可公开访问。')),'withdrawn source rendered in discovery');
 const card=[...w.document.querySelectorAll('#following-feed-results article')].find(row=>row.textContent.includes('原教程版本目前不可公开访问。'));
 expect(card.textContent).not.toContain('独立尝试');
 expect(card.querySelector('details a')).toBeNull();
});
async function visibleContributionUI(){const fixture=await visiblePeerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-visible-targets');await until(()=>w.document.querySelector('[data-visible-index]'),'contribution target read');w.document.querySelector('[data-visible-index]').click();w.document.querySelector('#visible-method-contribute').click();return {w,...fixture}}
function submitVisibleContribution(w){const f=w.document.querySelector('#visible-contribution-form');f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))}
async function reopenVisibleTarget(w){click(w,'review-visible-targets');await until(()=>w.document.querySelector('[data-visible-index]'),'reopened target');w.document.querySelector('[data-visible-index]').click()}
it('restores a public-target contribution draft and saves every material privately before reviewing and revising the same tutorial',async()=>{
 const {w,node}=await visibleContributionUI();input(w,'#visible-contribution-form [name="title"]','读者私人教程');input(w,'#visible-contribution-form [name="method"]','步骤一：检查结构。步骤二：补充细节。');input(w,'#visible-contribution-form [name="startAction"]','先画出一条中心线。');
 w.document.querySelector('#visible-resource-add').click();input(w,'[data-field="label"]','必需纸张');input(w,'[data-field="url"]','https://example.com/paper');const optional=w.document.querySelector('[data-field="optional"]');optional.checked=false;optional.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.querySelector('#visible-resource-add').click();const second=w.document.querySelectorAll('#visible-contribution-resources fieldset')[1];second.querySelector('[data-field="label"]').value='可选工具';second.querySelector('[data-field="label"]').dispatchEvent(new w.Event('input',{bubbles:true}));second.querySelector('[data-field="url"]').value='https://example.com/tool';second.querySelector('[data-field="url"]').dispatchEvent(new w.Event('input',{bubbles:true}));second.querySelector('[data-field="affiliate"]').checked=true;second.querySelector('[data-field="affiliate"]').dispatchEvent(new w.Event('input',{bubbles:true}));
 const scope=w.document.querySelector('#visible-contribution-form [name="visibility"]');scope.value='public';scope.dispatchEvent(new w.Event('change',{bubbles:true}));click(w,'dialog-close');await reopenVisibleTarget(w);w.document.querySelector('#visible-method-contribute').click();expect(w.document.querySelector('#visible-contribution-form [name="visibility"]').value).toBe('private');expect(w.document.querySelector('#visible-contribution-form [name="title"]').value).toBe('读者私人教程');expect(w.document.querySelectorAll('#visible-contribution-resources fieldset')).toHaveLength(2);
 submitVisibleContribution(w);submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'contribution private saved');const mine=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.title==='读者私人教程');expect(mine.visibility).toBe('private');expect(mine.targetSnapshot.version).toBe(node.version);expect(mine.resources.map(r=>[r.optional,r.affiliate])).toEqual([[false,false],[true,true]]);
 await reopenVisibleTarget(w);[...w.document.querySelectorAll('button')].find(b=>b.textContent==='我在这里的教程').click();await until(()=>w.document.querySelector('[data-own-visible-method]'),'own contribution review');w.document.querySelector('[data-own-visible-method]').click();input(w,'#visible-contribution-form [name="method"]','修订后的步骤：先验证结构再补充。');submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'contribution revision saved');const updated=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.id===mine.id);expect(updated.method).toBe('修订后的步骤：先验证结构再补充。');expect(updated.version).not.toBe(mine.version);expect(updated.resources).toEqual(mine.resources);expect((await(await transport('/api/tutorials/'+mine.id+'/versions/'+mine.version)).json()).tutorial.method).toBe(mine.method);
});
it('keeps contribution text after a lost creation response and confirms the saved tutorial on retry without duplication',async()=>{
 const {w}=await visibleContributionUI();input(w,'#visible-contribution-form [name="title"]','回执丢失的教程');input(w,'#visible-contribution-form [name="method"]','保留提交时的完整步骤。');
 w.fetch=async(url,options)=>{const r=await transport(url,options);if(url==='/api/tutorials'&&options?.method==='POST')throw new TypeError('Fixture lost tutorial response');return r};submitVisibleContribution(w);await until(()=>w.document.querySelector('#visible-contribution-error')?.textContent.includes('连接未完成'),'lost contribution response');expect(w.document.querySelector('#visible-contribution-form [name="method"]').value).toBe('保留提交时的完整步骤。');expect((await(await transport('/api/tutorials')).json()).tutorials.filter(t=>t.title==='回执丢失的教程')).toHaveLength(1);
 w.fetch=transport;submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'lost response explicitly confirmed');expect((await(await transport('/api/tutorials')).json()).tutorials.filter(t=>t.title==='回执丢失的教程')).toHaveLength(1);
});
it('requires separate public consent and matching reader self-confirmation without losing a rejected contribution',async()=>{
 const {w}=await visibleContributionUI();input(w,'#visible-contribution-form [name="title"]','需要本人自证的教程');input(w,'#visible-contribution-form [name="method"]','记录经过本人实践的具体步骤。');const f=w.document.querySelector('#visible-contribution-form'),scope=f.elements.namedItem('visibility');scope.value='public';scope.dispatchEvent(new w.Event('change',{bubbles:true}));submitVisibleContribution(w);expect((await(await transport('/api/tutorials')).json()).tutorials.some(t=>t.title==='需要本人自证的教程')).toBe(false);f.elements.namedItem('consent').checked=true;submitVisibleContribution(w);await until(()=>w.document.querySelector('#visible-contribution-error')?.textContent.includes('同一目标'),'public contribution L1 rejection');expect(f.elements.namedItem('method').value).toBe('记录经过本人实践的具体步骤。');scope.value='private';scope.dispatchEvent(new w.Event('change',{bubbles:true}));submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'rejected contribution private save');expect((await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.title==='需要本人自证的教程').visibility).toBe('private');
});
it('keeps the writer tutorial history after another owner withdraws the target and permits private revision without exposing new private goals',async()=>{
 const {w,node,authorCookie}=await visibleContributionUI();const activeId=w.dianliangState.activeId;input(w,'#visible-contribution-form [name="title"]','目标撤回后的本人教程');input(w,'#visible-contribution-form [name="method"]','保留作者原来的私人步骤。');submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'historical writer tutorial saved');const mine=(await(await transport('/api/tutorials')).json()).tutorials.find(t=>t.title==='目标撤回后的本人教程'),readerCookie=cookie;
 cookie=authorCookie;try{const plan=(await(await transport('/api/review-target-sharing?nodeId=my-visible-goal')).json());const withdrawn=await transport('/api/review-target-sharing',{method:'POST',headers:{'Content-Type':'application/json','If-Match':plan.actionRevision,'If-Target-Match':plan.revision},body:JSON.stringify({nodeId:'my-visible-goal',sourceVersion:node.sourceVersion,action:'withdraw',consent:true})});expect(withdrawn.status).toBe(200);
  const state=(await(await transport('/api/action-state')).json());state.state.data.nodes[0].goal='AUTHOR-NEW-PRIVATE-GOAL';state.state.data.nodes[0].version=2;const saved=await transport('/api/action-state',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':state.revision},body:JSON.stringify(state.state)});expect(saved.status).toBe(200);
  const foreign=(await(await transport('/api/review-visible-targets/my-tutorials')).json());expect(foreign.tutorials.some(t=>t.id===mine.id)).toBe(false);
  expect((await transport('/api/tutorials/'+mine.id,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':mine.version},body:JSON.stringify({method:'另一账号不能修订'})})).status).toBe(404);
 }finally{cookie=readerCookie}
 expect((await transport('/api/review-visible-targets/one?nodeId='+node.id)).status).toBe(404);expect((await(await transport('/api/tutorials')).json()).tutorials.some(t=>t.id===mine.id)).toBe(false);
 const own=(await(await transport('/api/review-visible-targets/my-tutorials')).json());expect(own.tutorials.map(t=>t.id)).toEqual([mine.id]);expect(own.tutorials[0].targetSnapshot.goal).toBe(node.goal);expect(own.tutorials[0].canPublishCurrent).toBe(false);expect(JSON.stringify(own)).not.toContain('AUTHOR-NEW-PRIVATE-GOAL');
 click(w,'nav:contribute');click(w,'review-owned-visible');await until(()=>w.document.querySelector('[data-owned-visible-edit]'),'writer historical list');w.document.querySelector('[data-owned-visible-edit]').click();expect(w.document.querySelector('#visible-contribution-form [name="visibility"] option[value="public"]').disabled).toBe(true);input(w,'#visible-contribution-form [name="method"]','目标撤回后本人修订的私人步骤。');submitVisibleContribution(w);await until(()=>!w.document.querySelector('#visible-contribution-form'),'private historical revision');
 const revised=(await(await transport('/api/review-visible-targets/my-tutorials')).json()).tutorials.find(t=>t.id===mine.id);expect(revised.method).toBe('目标撤回后本人修订的私人步骤。');expect(revised.visibility).toBe('private');expect(revised.targetSnapshot).toEqual(mine.targetSnapshot);expect(revised.versions).toHaveLength(2);expect(revised.versions[0].method).toBe(mine.method);expect(w.dianliangState.activeId).toBe(activeId);
 const file=path.join(directory,'tutorials.json'),original=fs.readFileSync(file,'utf8'),damaged=JSON.parse(original);damaged.find(t=>t.id===mine.id).targetSnapshot.goal='目标快照被外部改动';fs.writeFileSync(file,JSON.stringify(damaged));const failed=await transport('/api/review-visible-targets/my-tutorials');expect(failed.status).toBe(500);expect((await failed.json()).code).toBe('VISIBLE_TUTORIAL_STORE_UNREADABLE');expect(fs.readFileSync(file,'utf8')).toBe(JSON.stringify(damaged));
});
it('shows a catalog service tutorial in unified history and opens only its matching local source for revision',async()=>{
 const w=await newMethodUI('统一历史的目录教程');click(w,'nav:contribute');click(w,'review-owned-visible');await until(()=>w.document.querySelector('[data-owned-local-edit]'),'unified catalog history');expect(w.document.querySelector('#owned-visible-results').textContent).toContain('统一历史的目录教程');expect(w.document.querySelector('#owned-visible-results').textContent).toContain('公共目录');expect(w.document.querySelector('#owned-visible-results').textContent).toContain('求出未知数，并代回原方程验证等式成立。');w.document.querySelector('[data-owned-local-edit]').click();expect(w.document.querySelector('#method-form [name="title"]').value).toBe('统一历史的目录教程');expect(w.document.querySelector('#method-form').dataset.node).toBe('eq');
});
function captureReviewDownloads(w){const files=[];w.URL.createObjectURL=blob=>{files.push(blob);return 'blob:review-archive'};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};return {files,read:blob=>new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(JSON.parse(reader.result));reader.readAsText(blob)})}}
it('exports separate local and service actions plus own contribution drafts and excludes another account browser draft',async()=>{
 const {w}=await visibleContributionUI();input(w,'#visible-contribution-form [name="title"]','尚未提交的教程草稿');input(w,'#visible-contribution-form [name="method"]','完整的本机未提交步骤。');const activeId=w.dianliangState.activeId;w.localStorage.setItem(KEY+':visible-tutorial-draft:'+JSON.stringify(['foreign-owner','node','version','new']),JSON.stringify({ownerId:'foreign-owner',fields:{method:'FOREIGN-BROWSER-DRAFT'}}));click(w,'dialog-close');click(w,'group:space');click(w,'nav:account');input(w,'#profile-form [name="bio"]','未保存的个人介绍草稿');const downloads=captureReviewDownloads(w);click(w,'review-account-export');await until(()=>downloads.files.length===1,'combined export downloaded');const file=await downloads.read(downloads.files[0]);expect(file.format).toBe('dianliang-review-bundle/v1');expect(file.local.formDrafts).toEqual([{form:'profile',ownerId:file.ownerId,fields:{bio:'未保存的个人介绍草稿'}}]);expect(file.local.action.data.bio).not.toBe('未保存的个人介绍草稿');expect(file.local.action.data.activeId).toBeNull();expect(file.service.service.actionState.data.activeId).toBeNull();expect(file.local.action.data.events.find(e=>e.id===activeId).segments.at(-1).end).toBe(file.local.capturedAt);expect(w.dianliangState.activeId).toBe(activeId);expect(file.local.drafts.some(d=>d.raw.includes('完整的本机未提交步骤。'))).toBe(true);expect(JSON.stringify(file)).not.toContain('FOREIGN-BROWSER-DRAFT');expect(JSON.stringify(file)).not.toContain('test-only-2026');expect((await(await transport('/api/action-state')).json()).state.data.activeId).toBe(activeId);
});
it('does not download an older paired snapshot if local editing changes while service export is held',async()=>{
 const w=await startedUI();click(w,'group:space');click(w,'nav:account');const downloads=captureReviewDownloads(w),held=holdResponse(w,'/api/review-account-export');click(w,'review-account-export');await held.wait();input(w,'#profile-form [name="bio"]','导出等待期间的新介绍');held.release();await until(()=>w.document.querySelector('#review-account-export-status')?.textContent.includes('本机又有编辑'),'changed export snapshot refused');expect(downloads.files).toHaveLength(0);expect(w.document.querySelector('#profile-form [name="bio"]').value).toBe('导出等待期间的新介绍');
});
it.each(['changed-content','wrong-algorithm','missing-digest'])('refuses export integrity failure %s without altering local data',async kind=>{
 const w=await startedUI();click(w,'group:space');click(w,'nav:account');input(w,'#profile-form [name="bio"]','保留我的未保存介绍');const downloads=captureReviewDownloads(w),before=w.localStorage.getItem(KEY);
 w.fetch=async(url,options)=>{const r=await transport(url,options);if(url!=='/api/review-account-export')return r;const body=await r.json();if(kind==='changed-content')body.service.actionState.data.bio='CORRUPTED-ARCHIVE';if(kind==='wrong-algorithm')body.integrity.algorithm='unchecked';if(kind==='missing-digest')delete body.integrity.value;return {...r,json:async()=>body}};
 click(w,'review-account-export');await until(()=>w.document.querySelector('#review-account-export-status')?.textContent.includes('完整性'),'integrity refusal');expect(downloads.files).toHaveLength(0);expect(w.localStorage.getItem(KEY)).toBe(before);expect(w.document.querySelector('#profile-form [name="bio"]').value).toBe('保留我的未保存介绍');expect(w.document.querySelector('[data-action="review-account-export"]').disabled).toBe(false);
});
it('keeps local export drafts when service is offline and downloads a verified archive after explicit retry',async()=>{
 const w=await startedUI();click(w,'group:space');click(w,'nav:account');input(w,'#profile-form [name="bio"]','断线也保留的介绍');const downloads=captureReviewDownloads(w),id=w.dianliangState.activeId;offline=true;click(w,'review-account-export');await until(()=>w.document.querySelector('#review-account-export-status')?.textContent.includes('服务读取未完成'),'offline export');expect(downloads.files).toHaveLength(0);expect(w.dianliangState.activeId).toBe(id);offline=false;click(w,'review-account-export');await until(()=>downloads.files.length===1,'retry archive');expect((await downloads.read(downloads.files[0])).local.formDrafts[0].fields.bio).toBe('断线也保留的介绍');
});
it('discards an old account export response after another account logs in',async()=>{
 const w=await startedUI();click(w,'group:space');click(w,'nav:account');const downloads=captureReviewDownloads(w),held=holdResponse(w,'/api/review-account-export');click(w,'review-account-export');await held.wait();await switchUser(w,'archive-next-account');held.release();await new Promise(r=>setTimeout(r,50));expect(downloads.files).toHaveLength(0);expect(w.dianliangState.user.name).toBe('archive-next-account');click(w,'group:space');click(w,'nav:account');click(w,'review-account-export');await until(()=>downloads.files.length===1,'new account archive');expect((await downloads.read(downloads.files[0])).ownerId).toBe(w.dianliangState.user.id);
});
it('rechecks export edits after asynchronous cryptographic verification before downloading',async()=>{
 const w=await startedUI();click(w,'group:space');click(w,'nav:account');const downloads=captureReviewDownloads(w);let release,captured=false;const gate=new Promise(r=>release=r),subtle=require('node:crypto').webcrypto.subtle;Object.defineProperty(w.crypto,'subtle',{value:{digest:async(...args)=>{captured=true;await gate;return subtle.digest(...args)}},configurable:true});click(w,'review-account-export');await until(()=>captured,'held archive hash');input(w,'#profile-form [name="bio"]','校验期间的最新介绍');release();await until(()=>w.document.querySelector('#review-account-export-status')?.textContent.includes('本机又有编辑'),'edit after hash');expect(downloads.files).toHaveLength(0);expect(w.document.querySelector('#profile-form [name="bio"]').value).toBe('校验期间的最新介绍');
});
it('searches a peer catalog tutorial then starts its exact version without interrupting the clock while browsing',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI(),previous=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-public-tutorial]'),'public tutorial results');expect(w.dianliangState.activeId).toBe(previous);expect(w.document.querySelector('#public-tutorial-results').textContent).toContain(tutorial.authorName);expect(w.document.querySelectorAll('#public-tutorial-results a[href^="https://example.com/"]')).toHaveLength(2);input(w,'#public-tutorial-search [name="query"]','代回');w.document.querySelector('#public-tutorial-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('[data-public-tutorial]')&&!w.document.querySelector('#public-tutorial-search button').disabled,'searched public tutorial');w.document.querySelector('[data-public-tutorial]').click();const id='service-'+tutorial.id+'-'+tutorial.version;await until(()=>w.document.querySelector('[data-method-id="'+id+'"]'),'searched tutorial target');expect(w.dianliangState.activeId).toBe(previous);click(w,'practice');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.serviceReference.version).toBe(tutorial.version);expect(e.knowledge.resourceLinks).toEqual(tutorial.resources);expect(w.dianliangState.events.find(e=>e.id===previous).segments.at(-1).end).not.toBeNull();await until(()=>w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.id===id)?.serviceBinding?.version===tutorial.version,'searched method binding complete');
});
it('refuses a withdrawn public search result when entering its target and preserves the active event',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-public-tutorial]'),'search before withdrawal');expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);w.document.querySelector('[data-public-tutorial]').click();await until(()=>w.document.querySelector('#public-tutorial-status').textContent.includes('不可公开读取'),'withdrawn search refreshed');expect(w.document.querySelector('[data-public-tutorial]')).toBeNull();expect(w.document.querySelector('#public-tutorial-status').textContent).toContain('不可公开读取');expect(w.dianliangState.activeId).toBe(active);expect(w.dianliangState.events).toHaveLength(1);
});
it('refreshes a revised search result before the reader can practice the new tutorial version',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');
 await until(()=>w.document.querySelector('[data-public-tutorial]'),'initial public result');
 input(w,'#public-tutorial-search [name="query"]',tutorial.title);
 const order=w.document.querySelector('#public-tutorial-order');
 order.value='recent';order.dispatchEvent(new w.Event('change',{bubbles:true}));
 await until(()=>w.document.querySelector('[data-public-tutorial]'),'filtered public result');
 const response=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'修订后的检验步骤'})});
 expect(response.status).toBe(200);
 const updated=(await response.json()).tutorial;
 w.document.querySelector('[data-public-tutorial]').click();
 await until(()=>w.document.querySelector('#public-tutorial-results')?.textContent.includes('修订后的检验步骤'),'revised result visible');
 expect(w.document.querySelector('#public-tutorial-search [name="query"]').value).toBe(tutorial.title);
 expect(order.value).toBe('recent');
 expect(w.dianliangState.activeId).toBe(active);
 w.document.querySelector('[data-public-tutorial]').click();
 await until(()=>w.document.querySelector('[data-method-id="service-'+updated.id+'-'+updated.version+'"]'),'updated method selected');
 click(w,'practice');
 expect(w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId).knowledge.serviceReference.version).toBe(updated.version);
 await until(()=>w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.id==='service-'+updated.id+'-'+updated.version)?.serviceBinding?.version===updated.version,'revised method binding complete');
},15000);
it('opens a shared discussion entry and withholds its text after the author withdraws it',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;
 const headers={Cookie:authorCookie,'Content-Type':'application/json'};
 expect((await transport(url,{method:'POST',headers,body:JSON.stringify({text:'先发布的发言',tutorialVersion:tutorial.version,parentId:null,requestId:'shared-comment-earlier',consent:true})})).status).toBe(201);
 const publish=await transport(url,{method:'POST',headers,body:JSON.stringify({text:'从链接定位的公开发言',tutorialVersion:tutorial.version,parentId:null,requestId:'shared-comment',consent:true})});
 expect(publish.status).toBe(201);
 const comment=(await publish.json()).comment;
 click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);
 const href=new URL([...w.document.querySelectorAll('[data-discussion-share]')].find(a=>a.closest('article').textContent.includes(comment.text)).href);
 expect(href.searchParams.get('comment')).toBe(comment.id);
 const authorLink=[...w.document.querySelectorAll('[data-discussion-author]')].find(a=>a.closest('article').textContent.includes(comment.text));
 expect(authorLink.getAttribute('href')).toBe('/knowledge/#person/'+comment.authorId);
 const linked=ui(w.localStorage.getItem(KEY),{},href.search);
 const open=()=>linked.document.querySelector('[data-linked-tutorial-discussion]');
 await until(open,'comment link preview');
 expect(open().textContent).toBe('查看对应发言');
 open().click();
 await until(()=>linked.document.querySelector('[data-discussion-focus]'),'shared comment focused');
 expect(linked.document.querySelector('[data-discussion-focus]').textContent).toContain(comment.text);
 const helpful=linked.document.querySelector('[data-discussion-focus] [data-discussion-helpful]');
 const fetch=linked.fetch;
 let lostHelpfulReceipt=false;
 linked.fetch=async(route,options)=>{
  const response=await fetch(route,options);
  if(route.endsWith('/helpful')&&!lostHelpfulReceipt){lostHelpfulReceipt=true;throw new TypeError('Lost helpful receipt')}
  return response;
 };
 helpful.click();
 await until(()=>helpful.nextElementSibling.textContent.includes('可以重试'),'helpful retry offered');
 expect(helpful.getAttribute('aria-pressed')).toBe('false');
 helpful.click();
 await until(()=>helpful.getAttribute('aria-pressed')==='true','helpful vote acknowledged');
 expect(helpful.textContent).toBe('有帮助 1');
 input(linked,'#tutorial-discussion-form [name="text"]','排序期间保留的草稿');
 const order=linked.document.querySelector('#discussion-order');
 order.value='helpful';order.dispatchEvent(new linked.Event('change',{bubbles:true}));
 await until(()=>linked.document.querySelector('#discussion-comments article')?.textContent.includes(comment.text),'helpful comment ordered first');
 expect(linked.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('排序期间保留的草稿');
 const search=linked.document.querySelector('#discussion-search');
 const searchFor=value=>{
  search.elements.query.value=value;
  search.dispatchEvent(new linked.Event('submit',{bubbles:true,cancelable:true}));
 };
 searchFor(comment.text);
 await until(()=>linked.document.querySelector('#discussion-status')?.textContent.includes('匹配 1 条'),'discussion search returns only matching text');
 expect(linked.document.querySelector('#discussion-comments').textContent).not.toContain('先发布的发言');
 expect(linked.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('排序期间保留的草稿');
 searchFor('');
 await until(()=>linked.document.querySelector('#discussion-status')?.textContent.includes('共 2 条'),'discussion search cleared');
 const reorderedHelpful=linked.document.querySelector('#discussion-comments article [data-discussion-helpful]');
 reorderedHelpful.click();
 await until(()=>reorderedHelpful.getAttribute('aria-pressed')==='false','helpful vote removed');
 expect(reorderedHelpful.textContent).toBe('有帮助 0');
 const rerank=linked.document.querySelector('#discussion-rank-refresh');
 expect(rerank.hidden).toBe(false);
 rerank.click();
 await until(()=>linked.document.querySelector('#discussion-comments article')?.textContent.includes('先发布的发言'),'refresh restores publication order for equal votes');
 expect(linked.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('排序期间保留的草稿');
 expect((await transport(url+'/'+comment.id+'/withdraw',{method:'POST',headers:{...headers,'If-Match':comment.revision},body:JSON.stringify({consent:true})})).status).toBe(200);
 input(linked,'#tutorial-discussion-form [name="text"]','撤回后仍保留的草稿');
 [...linked.document.querySelectorAll('#discussion-comments article')].find(row=>row.textContent.includes(comment.text)).querySelector('[data-discussion-helpful]').click();
 await until(()=>linked.document.querySelector('#discussion-comments')?.textContent.includes('内容已撤回'),'stale helpful target refreshed');
 expect(linked.document.querySelector('#discussion-comments').textContent).not.toContain(comment.text);
 expect(linked.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('撤回后仍保留的草稿');
 [...linked.document.querySelectorAll('dialog button')].find(b=>b.textContent==='返回教程预览').click();
 await until(open,'comment link preview restored');
 open().click();
 await until(()=>linked.document.querySelector('#discussion-status')?.textContent.includes('不可公开读取'),'withdrawn comment rejected');
 expect(linked.document.querySelector('#discussion-comments').textContent).not.toContain(comment.text);
 expect(linked.document.querySelector('[data-discussion-focus]')).toBeNull();
},15000);
it('opens a shared tutorial link after checking the current version and refuses it after withdrawal',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');
 await until(()=>w.document.querySelector('#public-tutorial-results a[href*="tutorial="]'),'shareable tutorial link');
 const link=new URL(w.document.querySelector('#public-tutorial-results a[href*="tutorial="]').href);
 expect(link.searchParams.get('tutorial')).toBe(tutorial.id);
 expect(link.searchParams.get('version')).toBe(tutorial.version);
 const cache=w.localStorage.getItem(KEY);
 const patch=(version,body)=>transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':version},body:JSON.stringify(body)});
 const changed=await patch(tutorial.version,{method:'链接打开后的新版方法'});
 expect(changed.status).toBe(200);
 const revised=(await changed.json()).tutorial;
 const linked=ui(cache,{},link.search);
 await until(()=>linked.document.querySelector('#public-tutorial-link-content')?.textContent.includes('链接打开后的新版方法'),'linked version ready');
 expect(linked.document.querySelector('#public-tutorial-link-status').textContent).toContain('已有更新');
 expect(linked.dianliangState.activeId).toBe(active);
 const copy=linked.document.querySelector('[data-linked-tutorial-copy]');
 const copyField=linked.document.querySelector('[aria-label="当前版本教程链接"]');
 let copied;
 Object.defineProperty(linked.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value}}});
 copy.click();
 await until(()=>linked.document.querySelector('#public-tutorial-link-content').textContent.includes('已复制当前版本链接'),'clipboard confirmed');
 expect(new URL(copied).searchParams.get('version')).toBe(revised.version);
 Object.defineProperty(linked.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied')}}});
 copy.click();
 await until(()=>!copyField.hidden,'manual copy fallback');
 expect(copyField.value).toBe(copied);
 expect(linked.document.activeElement).toBe(copyField);
 expect(copyField.selectionEnd).toBe(copied.length);
 cookie='';
 const signedOut=ui(undefined,{},link.search);
 await until(()=>signedOut.document.querySelector('#auth-form'),'shared link prompts for login');
 expect(signedOut.document.querySelector('#public-tutorial-link-content')).toBeNull();
 input(signedOut,'#auth-name','recovery-ui');input(signedOut,'#auth-password','test-only-2026');
 signedOut.document.querySelector('#auth-form').dispatchEvent(new signedOut.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>signedOut.document.querySelector('#public-tutorial-link-content')?.textContent.includes('链接打开后的新版方法'),'login continues to shared link');
 const bookmark=signedOut.document.querySelector('[data-linked-tutorial-bookmark]');
 bookmark.click();
 await until(()=>bookmark.textContent==='已收藏这个版本','linked tutorial bookmarked');
 const saved=signedOut.dianliangState.settings.publicTutorialBookmarks[0].tutorial;
 expect(saved.version).toBe(revised.version);
 expect(saved.resources).toEqual(revised.resources);
 expect(signedOut.dianliangState.activeId).toBe(active);
 const openLinkedDiscussion=async()=>{
  signedOut.document.querySelector('[data-linked-tutorial-discussion]').click();
  await until(()=>signedOut.document.querySelector('#discussion-status')?.textContent.includes('共 '),'linked discussion loaded');
 };
 const returnToLink=()=>[...signedOut.document.querySelectorAll('dialog button')].find(b=>b.textContent==='返回教程预览').click();
 await openLinkedDiscussion();
 input(signedOut,'#tutorial-discussion-form [name="text"]','返回教程核对后继续写');
 returnToLink();
 await until(()=>signedOut.document.querySelector('[data-linked-tutorial-discussion]'),'linked tutorial preview restored');
 await openLinkedDiscussion();
 expect(signedOut.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('返回教程核对后继续写');
 expect((await patch(revised.version,{visibility:'private'})).status).toBe(200);
 returnToLink();
 await until(()=>signedOut.document.querySelector('#public-tutorial-link-status')?.textContent.includes('不可公开读取'),'linked preview rechecked after withdrawal');
 expect(signedOut.document.querySelector('#public-tutorial-link-content').textContent).toBe('');
 expect(signedOut.dianliangState.settings.publicTutorialBookmarks[0].tutorial).toEqual(saved);
 const denied=ui(cache,{},link.search);
 await until(()=>denied.document.querySelector('#public-tutorial-link-status')?.textContent.includes('不可公开读取'),'withdrawn link blocked');
 expect(denied.document.querySelector('#public-tutorial-link-content').textContent).toBe('');
},15000);
it('refreshes a revised tutorial before opening discussion from public search',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');
 await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'initial discussion entry');
 const response=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'提问前需要核对的新步骤'})});
 expect(response.status).toBe(200);
 const updated=(await response.json()).tutorial;
 w.document.querySelector('[data-tutorial-discussion]').click();
 await until(()=>w.document.querySelector('#public-tutorial-results')?.textContent.includes('提问前需要核对的新步骤'),'search shows revised method before opening discussion');
 expect(w.document.querySelector('#tutorial-discussion-form')).toBeNull();
 w.document.querySelector('[data-tutorial-discussion]').click();
 await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 '),'revised discussion loaded');
 expect(w.document.querySelector('dialog').textContent).toContain(updated.version.slice(0,8));
 expect(w.dianliangState.activeId).toBe(active);
},15000);
it('returns from discussion to the same tutorial search filters and keeps the discussion draft',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');
 await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'initial search results');
 input(w,'#public-tutorial-search [name="query"]',tutorial.title);
 const order=w.document.querySelector('#public-tutorial-order');
 order.value='recent';order.dispatchEvent(new w.Event('change',{bubbles:true}));
 await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'filtered search results');
 w.document.querySelector('[data-tutorial-discussion]').click();
 await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 '),'discussion loaded');
 input(w,'#tutorial-discussion-form [name="text"]','继续浏览之后回来写');
 [...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='返回教程搜索').click();
 await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'restored search results');
 expect(w.document.querySelector('#public-tutorial-search [name="query"]').value).toBe(tutorial.title);
 expect(w.document.querySelector('#public-tutorial-order').value).toBe('recent');
 w.document.querySelector('[data-tutorial-discussion]').click();
 await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 '),'discussion reopened');
 expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('继续浏览之后回来写');
 expect(w.dianliangState.activeId).toBe(active);
},15000);
it.each(['discussion return','next page','network retry'])('recovers paged tutorial search after %s',async(mode)=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI();
 const headers={Cookie:authorCookie,'Content-Type':'application/json'};
 const second=await transport('/api/tutorials',{method:'POST',headers,body:JSON.stringify({treeId:tutorial.treeId,nodeId:tutorial.nodeId,title:'另一个代回方法',method:'先写出等式两侧。',startAction:'从简单例子开始。',resources:[],visibility:'public'})});
 expect(second.status).toBe(201);
 w.fetch=(route,options)=>transport(route.startsWith('/api/review-public-tutorials?')?route+'&limit=1':route,options);
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');
 await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'first search page');
 input(w,'#public-tutorial-search [name="query"]','代回');
 const order=w.document.querySelector('#public-tutorial-order');
 order.value='recent';order.dispatchEvent(new w.Event('change',{bubbles:true}));
 const next=()=>[...w.document.querySelectorAll('#public-tutorial-results button')].find(b=>b.textContent==='下一页教程');
 await until(next,'filtered search has another page');
 if(mode==='network retry'){
  const fetch=w.fetch,requests=[];
  w.fetch=(route,options)=>{
   if(route.startsWith('/api/review-public-tutorials?')&&new URL(route,'http://localhost').searchParams.has('cursor')){
    requests.push(route);
    if(requests.length===1)return Promise.reject(new TypeError('测试翻页连接中断'));
   }
   return fetch(route,options);
  };
  next().focus();next().click();
  const retry=()=>[...w.document.querySelectorAll('#public-tutorial-results button')].find(b=>b.textContent==='重试读取这一页');
  await until(retry,'retry same page offered');
  expect(w.document.activeElement).toBe(retry());
  retry().click();
  const previous=()=>[...w.document.querySelectorAll('#public-tutorial-results button')].find(b=>b.textContent==='上一页教程');
  await until(previous,'second page restored');
  expect(requests).toEqual([requests[0],requests[0]]);
  expect(next()).toBeUndefined();
  expect(w.document.activeElement).toBe(w.document.querySelector('#public-tutorial-results article'));
  expect(w.document.querySelector('#public-tutorial-search [name="query"]').value).toBe('代回');
  expect(w.document.querySelector('#public-tutorial-order').value).toBe('recent');
  return;
 }
 next().click();
 await until(()=>w.document.querySelector('[data-tutorial-discussion]')&&!next(),'second search page');
 if(mode==='discussion return'){
  w.document.querySelector('[data-tutorial-discussion]').click();
  await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 '),'second-page discussion');
 }else{
  [...w.document.querySelectorAll('#public-tutorial-results button')].find(b=>b.textContent==='上一页教程').click();
  await until(next,'back on first search page');
 }
 expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{...headers,'If-Match':tutorial.version},body:JSON.stringify({method:'发布修订后的代回方法。'})})).status).toBe(200);
 if(mode==='discussion return')[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='返回教程搜索').click();
 else next().click();
 await until(()=>w.document.querySelector('#public-tutorial-status')?.textContent.includes('已回到第一页'),'stale return cursor recovered');
 expect(next()).toBeTruthy();
 expect(w.document.querySelector('#public-tutorial-search [name="query"]').value).toBe('代回');
 expect(w.document.querySelector('#public-tutorial-order').value).toBe('recent');
},15000);
it('discovers a personal public target tutorial through search and preserves the target and materials when practicing',async()=>{
 const {tutorial,node}=await visiblePeerTutorial(),w=await startedUI(),previous=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-public-tutorial]'),'personal tutorial search');expect(w.document.querySelector('#public-tutorial-results').textContent).toContain(node.goal);w.document.querySelector('[data-public-tutorial]').click();await until(()=>w.document.querySelector('#visible-method-load'),'searched personal target');expect(w.dianliangState.activeId).toBe(previous);w.document.querySelector('#visible-method-load').click();await until(()=>w.document.querySelector('[data-visible-method-index]'),'personal target methods');w.document.querySelector('[data-visible-method-index]').click();await until(()=>w.dianliangState.activeId!==previous,'searched personal practice');const e=w.dianliangState.events.find(e=>e.id===w.dianliangState.activeId);expect(e.knowledge.nodeGoal).toBe(node.goal);expect(e.knowledge.targetServiceReference.targetVersion).toBe(node.version);expect(e.knowledge.resourceLinks).toEqual(tutorial.resources);expect(e.knowledge.serviceReference.version).toBe(tutorial.version);
});
it('changes public tutorial order without a held old response replacing results or the active event',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');const held=holdResponse(w,'/api/review-public-tutorials?query=');click(w,'review-public-search');await held.wait();const order=w.document.querySelector('#public-tutorial-order');order.value='recent';order.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('[data-public-tutorial]')&&!w.document.querySelector('#public-tutorial-search button').disabled,'latest tutorial result');const before=w.document.querySelector('#public-tutorial-results').innerHTML;expect(before).toContain('版本发布：');expect(w.document.querySelector('#public-tutorial-results').textContent).toContain(tutorial.title);expect(w.document.querySelectorAll('#public-tutorial-results a[href^="https://example.com/"]')).toHaveLength(2);held.release();await new Promise(r=>setTimeout(r,50));expect(order.value).toBe('recent');expect(w.document.querySelector('#public-tutorial-results').innerHTML).toBe(before);expect(w.dianliangState.activeId).toBe(active);
 input(w,'#public-tutorial-search [name="query"]','不存在的目标');w.document.querySelector('#public-tutorial-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-tutorial-status').textContent.includes('找到 0'),'latest filtered empty results');expect(order.value).toBe('recent');expect(w.dianliangState.activeId).toBe(active);
});
it('opens author public methods, keeps filtering in scope and returns to all authors without changing the active clock',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-public-author]'),'author entry');w.document.querySelector('[data-public-author]').click();await until(()=>w.document.querySelector('#public-author-clear')&&w.document.querySelector('[data-public-tutorial]'),'author tutorials');expect(w.document.querySelector('#dialog-heading').textContent).toContain(tutorial.authorName);expect(w.document.querySelector('#public-tutorial-results').textContent).toContain(tutorial.title);expect(w.document.querySelectorAll('#public-tutorial-results a[href^="https://example.com/"]')).toHaveLength(2);const order=w.document.querySelector('#public-tutorial-order');order.value='recent';order.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('[data-public-tutorial]')&&!w.document.querySelector('#public-tutorial-search button').disabled,'author recent methods');input(w,'#public-tutorial-search [name="query"]','没有的教程');w.document.querySelector('#public-tutorial-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-tutorial-status').textContent.includes('找到 0'),'author empty search');expect(w.document.querySelector('#public-author-clear')).not.toBeNull();w.document.querySelector('#public-author-clear').click();await until(()=>!w.document.querySelector('#public-author-clear')&&w.document.querySelector('[data-public-tutorial]'),'all authors restored');expect(w.dianliangState.activeId).toBe(active);
});
it.each(['discussion','tutorial'])('refreshes a withdrawn tutorial from the author profile %s entry',async(entry)=>{
 const {w,authorCookie}=await followableAuthorUI();
 await until(()=>w.document.querySelector('[data-author-discussion]'),'author tutorial ready');
 const tutorial=(await(await transport('/api/review-public-tutorials')).json()).tutorials[0];
 expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);
 w.document.querySelector('[data-author-'+entry+']').click();
 await until(()=>w.document.querySelector('#author-tutorials-status')?.textContent.includes('已不可公开读取'),'author tutorial section refreshed');
 expect(w.document.querySelector('[data-author-discussion]')).toBeNull();
 expect(w.document.querySelector('#tutorial-discussion-form')).toBeNull();
 expect(w.document.querySelector('#public-author-page')).not.toBeNull();
},15000);
it('ignores a held author profile response after the account changes',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-public-author]'),'held author entry');const held=holdResponse(w,'/api/review-public-tutorials/author?id='+encodeURIComponent(tutorial.authorId));w.document.querySelector('[data-public-author]').click();await held.wait();await switchUser(w,'author-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#public-author-clear')).toBeNull();expect(w.dianliangState.user.name).toBe('author-next-reader');
});
it('discards old public search results after the reader edits the query during a held response',async()=>{
 await peerTutorial();const w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');const held=holdResponse(w,'/api/review-public-tutorials?query=');click(w,'review-public-search');await held.wait();input(w,'#public-tutorial-search [name="query"]','完全不同的搜索词');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('[data-public-tutorial]')).toBeNull();expect(w.document.querySelector('#public-tutorial-status').textContent).toContain('搜索词已修改');w.document.querySelector('#public-tutorial-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#public-tutorial-status').textContent.includes('找到 0'),'new query results');expect(w.dianliangState.activeId).toBe(active);
});
it('discards a held public search response after another account logs in',async()=>{
 await peerTutorial();const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');const held=holdResponse(w,'/api/review-public-tutorials?query=');click(w,'review-public-search');await held.wait();await switchUser(w,'search-next-reader');held.release();await new Promise(r=>setTimeout(r,50));expect(w.dianliangState.user.name).toBe('search-next-reader');expect(w.document.querySelector('#public-tutorial-results')).toBeNull();expect(w.document.querySelector('#dialogs').textContent).toBe('');
});
it('removes public-target tutorials from search after their owner withdraws the target without returning private history',async()=>{
 const {node,tutorial,authorCookie}=await visiblePeerTutorial(),w=await startedUI();let r=await(await transport('/api/review-public-tutorials')).json();expect(r.tutorials.map(t=>t.id)).toContain(tutorial.id);const authorHeaders={Cookie:authorCookie,'Content-Type':'application/json'},state=(await(await transport('/api/action-state',{headers:authorHeaders})).json()),share=(await(await transport('/api/review-target-sharing?nodeId=my-visible-goal',{headers:authorHeaders})).json());const result=await transport('/api/review-target-sharing',{method:'POST',headers:{...authorHeaders,'If-Match':state.revision,'If-Target-Match':share.revision},body:JSON.stringify({nodeId:'my-visible-goal',sourceVersion:1,action:'withdraw',consent:true})});expect(result.status).toBe(200);r=await(await transport('/api/review-public-tutorials')).json();expect(r.total).toBe(0);expect(JSON.stringify(r)).not.toContain(node.goal);expect(JSON.stringify(r)).not.toContain('AUTHOR-PRIVATE-DRAFT');expect((await transport('/api/review-public-tutorials/one?id='+tutorial.id)).status).toBe(404);expect(w.dianliangState.activeId).toBeTruthy();
});
it('does not search an old tutorial as a method for the revised public goal while retaining author history',async()=>{
 const {node,tutorial,authorCookie}=await visiblePeerTutorial();await startedUI();const headers={Cookie:authorCookie,'Content-Type':'application/json'},old=(await(await transport('/api/action-state',{headers})).json()),privateTargets=(await(await transport('/api/review-private-targets',{headers})).json()),previous=privateTargets.current.find(t=>t.originId==='my-visible-goal');old.state.data.nodes[0].version=2;old.state.data.nodes[0].goal='修订后的目标：完成三视图并说明透视关系。';const changed=await transport('/api/action-state',{method:'PUT',headers:{...headers,'If-Match':old.revision},body:JSON.stringify(old.state)});expect(changed.status).toBe(200);const revision=(await changed.json()).revision;expect((await transport('/api/review-private-targets',{method:'POST',headers:{...headers,'If-Match':revision,'If-Target-Match':previous.revision},body:JSON.stringify({nodeId:'my-visible-goal',sourceVersion:2})})).status).toBe(201);const sharing=(await(await transport('/api/review-target-sharing?nodeId=my-visible-goal',{headers})).json());expect((await transport('/api/review-target-sharing',{method:'POST',headers:{...headers,'If-Match':revision,'If-Target-Match':sharing.revision},body:JSON.stringify({nodeId:'my-visible-goal',sourceVersion:2,action:'publish',consent:true})})).status).toBe(201);const search=(await(await transport('/api/review-public-tutorials')).json());expect(search.total).toBe(0);expect((await transport('/api/review-public-tutorials/one?id='+tutorial.id)).status).toBe(404);const history=(await(await transport('/api/review-owned-tutorials',{headers})).json()).tutorials.find(t=>t.id===tutorial.id);expect(history.targetSnapshot.goal).toBe(node.goal);expect(history.targetSnapshot.version).toBe(node.version);expect(history.canPublishCurrent).toBe(false);
});
it('publishes a tutorial question only with explicit consent and reads a peer answer without changing the active clock',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'discussion entry');w.document.querySelector('[data-tutorial-discussion]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 0'),'empty discussion');input(w,'#tutorial-discussion-form [name="text"]','代回时左右两边不同怎么办？');const form=w.document.querySelector('#tutorial-discussion-form');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));expect(w.document.querySelector('#discussion-error').textContent).toContain('请选择公开');form.elements.namedItem('consent').checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#discussion-comments').textContent.includes('代回时左右两边不同怎么办？'),'question saved');const url='/api/review-tutorial-discussions/'+tutorial.id,question=(await(await transport(url)).json()).comments[0];expect((await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'请逐项检查代入后的计算。',parentId:question.id,tutorialVersion:tutorial.version,requestId:'native-test-peer-answer',consent:true})})).status).toBe(201);click(w,'dialog-close');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'discussion reopened');w.document.querySelector('[data-tutorial-discussion]').click();await until(()=>w.document.querySelector('#discussion-comments')?.textContent.includes('请逐项检查代入后的计算。'),'peer answer loaded');const withdrawal=w.document.querySelector('[data-discussion-visibility]');withdrawal.click();await until(()=>w.document.querySelector('#discussion-comments').textContent.includes('内容已撤回'),'question withdrawn');expect(w.document.querySelector('#discussion-comments').textContent).toContain('请逐项检查代入后的计算。');w.document.querySelector('[data-discussion-visibility]').click();await until(()=>w.document.querySelector('#discussion-comments').textContent.includes('代回时左右两边不同怎么办？'),'question restored');expect(w.dianliangState.activeId).toBe(active);
});
it.each(['submit','conflict','lost receipt'])('lets only a configured reviewer use the moderation UI to %s',async(mode)=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;
 const post=async(route,body,headers={})=>transport(route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const published=await post(url,{text:'仅审核时可见的测试证据',tutorialVersion:tutorial.version,parentId:null,requestId:'moderation-ui-post',consent:true},{Cookie:authorCookie});
 const comment=(await published.json()).comment;
 expect((await post(url+'/'+comment.id+'/report',{reason:'spam',details:'补充证据仅审核员可见'})).status).toBe(201);
 click(w,'group:knowledge');click(w,'nav:contribute');
 expect(w.document.querySelector('#discussion-moderation-entry').hidden).toBe(true);
 click(w,'review-my-discussion-reports');
 await until(()=>w.document.querySelector('#my-discussion-reports')?.textContent.includes('待处理'),'reporter sees pending status');
 expect(w.document.querySelector('#my-discussion-reports').textContent).not.toContain(comment.text);
 expect(w.document.querySelector('#my-discussion-reports').textContent).not.toContain('补充证据仅审核员可见');
 click(w,'dialog-close');
 const readerCookie=cookie,registered=await post('/api/register',{name:'moderation-ui-reviewer',password:'test-only-2026'});
 expect(registered.status).toBe(201);
 const reviewerId=(await registered.json()).user.id;
 const second=await post('/api/register',{name:'moderation-reviewer-b',password:'test-only-2026'});
 expect(second.status).toBe(201);
 const secondId=(await second.json()).user.id,secondCookie=cookie;
 const independent=await post('/api/register',{name:'moderation-report-peer',password:'test-only-2026'});
 expect(independent.status).toBe(201);
 const independentCookie=cookie;cookie=readerCookie;
 const guarded=createAuthenticatedActionApp({dataDir:directory,reviewDirectory:assets,rateLimitEnabled:false,discussionModeratorIds:[reviewerId,secondId]}).app;
 await new Promise(resolve=>server.close(resolve));
 server=guarded.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const reporterLogin=await post('/api/login',{name:'recovery-ui',password:'test-only-2026'});
 expect(reporterLogin.status).toBe(200);
 const reporterCookie=cookie;
 const reporter=ui();
 reporter.fetch=(url,options={})=>transport(url,{...options,headers:{...options.headers,Cookie:reporterCookie}});
 await until(()=>reporter.dianliangState?.user?.name==='recovery-ui'&&!reporter.document.querySelector('#app').inert,'reporter connected');
 click(reporter,'group:knowledge');click(reporter,'nav:contribute');click(reporter,'review-my-discussion-reports');
 await until(()=>reporter.document.querySelector('#my-discussion-reports')?.textContent.includes('待处理'),'reporter waits on pending report');
 const setReporterScope=value=>{
  const select=reporter.document.getElementById('my-discussion-reports-scope');
  select.value=value;
  select.dispatchEvent(new reporter.Event('change',{bubbles:true}));
 };
 setReporterScope('pending');
 await until(()=>reporter.document.querySelector('#my-discussion-reports')?.textContent.includes('待处理'),'pending report filtered');
 cookie=readerCookie;
 await switchUser(w,'moderation-ui-reviewer',false);
 click(w,'group:knowledge');click(w,'nav:contribute');
 await until(()=>w.document.querySelector('#discussion-moderation-entry button'),'moderator action available');
 w.document.querySelector('#discussion-moderation-entry button').click();
 await until(()=>w.document.querySelector('[data-moderation-report]'),'private review evidence ready');
 const form=w.document.querySelector('[data-moderation-report]');
 expect(form.closest('article').textContent).toContain(comment.text);
 expect(form.closest('article').textContent).toContain('补充证据仅审核员可见');
 let secondaryId;
 const secondaryCookie=mode==='conflict'?independentCookie:secondCookie;
 if(mode==='submit'||mode==='conflict'){
  const result=await post(url+'/'+comment.id+'/report',{reason:'other',details:'第二位举报人的私有说明'},
   {Cookie:secondaryCookie});
  expect(result.status).toBe(201);
  secondaryId=(await result.json()).reportId;
 }
 form.elements.outcome.value='substantiated';form.elements.note.value='审核员复核证据';
 if(mode==='conflict'){
  const queue='/api/review-tutorial-discussions/moderation/reports';
  const report=(await(await transport(queue,{headers:{Cookie:secondCookie}})).json()).reports.find(r=>r.id!==secondaryId);
  expect((await post(queue+'/'+report.id,{outcome:'substantiated',note:'审核员复核证据'},{Cookie:secondCookie,'If-Match':report.revision})).status).toBe(200);
  form.elements.outcome.value='dismissed';form.elements.note.value='另一位审核员的旧判断';
 }
 if(mode==='lost receipt'){
  const fetch=w.fetch;
  w.fetch=async(route,options)=>{
   const response=await fetch(route,options);
   if(options?.method==='POST'&&route.startsWith('/api/review-tutorial-discussions/moderation/reports/')&&response.ok)throw new w.TypeError('Lost moderation response');
   return response;
  };
 }
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const confirmed=mode==='submit'?'已隐藏公开发言':'已有审核结论：举报成立';
 await until(()=>w.document.querySelector('#discussion-moderation-results')?.textContent.includes(confirmed),'moderation confirmed');
 if(secondaryId){
  const queue='/api/review-tutorial-discussions/moderation/reports';
  const second=(await(await transport(queue)).json()).reports.find(r=>r.id===secondaryId);
  if(mode==='submit'){
   const ownQueue=(await(await transport(queue,{headers:{Cookie:secondCookie}})).json()).reports;
   expect(ownQueue.some(r=>r.commentId===comment.id)).toBe(false);
   expect((await transport(queue+'/'+secondaryId,{headers:{Cookie:secondCookie}})).status).toBe(403);
   const conflicted=await post(queue+'/'+secondaryId,{outcome:'dismissed',note:'自行处理'},{Cookie:secondCookie,'If-Match':second.revision});
   expect(conflicted.status).toBe(403);
   expect((await conflicted.json()).code).toBe('DISCUSSION_REVIEW_CONFLICT');
  }
  expect((await post(queue+'/'+second.id,{outcome:'substantiated',note:'同一条发言的补充举报'},{'If-Match':second.revision})).status).toBe(200);
 }
 reporter.document.getElementById('my-discussion-reports-refresh').click();
 await until(()=>reporter.document.getElementById('my-discussion-reports-status')?.textContent.includes('暂无待处理'),'resolved report leaves pending scope');
 expect(reporter.document.getElementById('my-discussion-reports-scope').value).toBe('pending');
 setReporterScope('processed');
 await until(()=>reporter.document.querySelector('#my-discussion-reports')?.textContent.includes('举报成立'),'reporter refreshes resolved report');
 expect(reporter.document.getElementById('my-discussion-reports').textContent).not.toContain('审核员复核证据');
 if(mode==='conflict')expect(w.document.querySelector('#discussion-moderation-results').textContent).toContain('审核员复核证据');
 const setModerationScope=value=>{
  const select=w.document.querySelector('#discussion-moderation-scope');
  select.value=value;select.dispatchEvent(new w.Event('change',{bubbles:true}));
 };
 setModerationScope('processed');
 await until(()=>w.document.querySelector('#discussion-moderation-results')?.textContent.includes('审核员复核证据'),'processed decision available');
 expect(w.document.querySelector('[data-moderation-report]')).toBeNull();
 setModerationScope('pending');
 await until(()=>w.document.querySelector('#discussion-moderation-status')?.textContent.includes('暂无举报'),'resolved item leaves pending queue');
 expect((await(await transport(url)).json()).comments[0]).toMatchObject({withdrawn:true,text:''});
 expect((await transport('/api/review-tutorial-discussions/moderation/reports',{headers:{Cookie:authorCookie}})).status).toBe(403);
 const reviewerCookie=cookie;cookie=authorCookie;
 const authorView=ui();
 await until(()=>authorView.dianliangState?.user?.name==='shared-ui-author'&&!authorView.document.querySelector('#app').inert,'author account ready');
 click(authorView,'group:knowledge');click(authorView,'nav:contribute');click(authorView,'review-owned-discussions');
 await until(()=>authorView.document.querySelector('[data-discussion-appeal]'),'author appeal form available');
 const authorForm=authorView.document.querySelector('[data-discussion-appeal]');
 authorForm.closest('details').open=true;
 authorForm.elements.explanation.value='作者请求复核讨论语境';
 if(mode==='submit'){
  const fetch=authorView.fetch;
  authorView.fetch=async(route,options)=>{
   const response=await fetch(route,options);
   if(options?.method==='POST'&&route.endsWith('/appeal')&&response.ok)throw new authorView.TypeError('Lost author appeal response');
   return response;
  };
 }
 authorForm.dispatchEvent(new authorView.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>authorForm.querySelector('[role="status"]').textContent.includes('申诉已提交'),'appeal submitted from author archive');
 expect((await transport(url+'/'+comment.id+'/appeal',{headers:{Cookie:reporterCookie}})).status).toBe(404);
 click(authorView,'dialog-close');click(authorView,'review-owned-discussions');
 await until(()=>authorView.document.querySelector('#owned-discussion-results')?.textContent.includes('申诉状态：待复核'),'pending appeal shown after reopening');
 expect(authorView.document.querySelector('[data-discussion-appeal]')).toBeNull();
 cookie=reviewerCookie;
 click(w,'dialog-close');
 [...w.document.querySelectorAll('#discussion-moderation-entry button')].find(b=>b.textContent==='讨论申诉复核').click();
 await until(()=>w.document.querySelector('[data-review-appeal]'),'appeal queue loaded');
 let appealForm=w.document.querySelector('[data-review-appeal]');
 const setAppealScope=value=>{
  const select=w.document.querySelector('#discussion-appeal-scope');
  select.value=value;select.dispatchEvent(new w.Event('change',{bubbles:true}));
 };
 expect(w.document.querySelector('#discussion-appeal-scope').value).toBe('pending');
 expect(appealForm.closest('article').textContent).toContain('作者请求复核讨论语境');
 expect(appealForm.closest('article').textContent).toContain(comment.text);
 expect(appealForm.closest('article').textContent).toContain('审核员复核证据');
 if(mode==='submit'){
  const appeals='/api/review-tutorial-discussions/moderation/appeals';
  const appeal=(await(await transport(appeals)).json()).appeals[0];
  const participantHeaders={Cookie:secondCookie};
  expect((await(await transport(appeals,{headers:participantHeaders})).json()).appeals).toEqual([]);
  expect((await transport(appeals+'/'+appeal.id,{headers:participantHeaders})).status).toBe(403);
  const conflicted=await post(appeals+'/'+appeal.id,{outcome:'upheld',note:'自行复核'},{...participantHeaders,'If-Match':appeal.revision});
  expect(conflicted.status).toBe(403);
  expect((await conflicted.json()).code).toBe('DISCUSSION_REVIEW_CONFLICT');
 }
 const overturned=mode==='conflict';
 const verdict=overturned?'已解除公开限制':'已维持原处置';
 appealForm.elements.outcome.value=overturned?'overturned':'upheld';
 appealForm.elements.note.value='审核员的内部复核说明';
 appealForm.elements.authorMessage.value='给作者的复核说明 <b>按原文显示</b>';
 appealForm.elements.authorMessage.dispatchEvent(new w.Event('input',{bubbles:true}));
 setAppealScope('processed');
 await until(()=>w.document.querySelector('#discussion-appeal-status')?.textContent.includes('暂无申诉'),'processed queue initially empty');
 setAppealScope('pending');
 await until(()=>w.document.querySelector('[data-review-appeal]'),'pending appeal restored');
 appealForm=w.document.querySelector('[data-review-appeal]');
 expect(appealForm.elements.note.value).toBe('审核员的内部复核说明');
 let lostAppealReceipt=false,appealEndpoint;
 if(mode==='submit'){
  const fetch=w.fetch;
  w.fetch=async(route,options)=>{
   const response=await fetch(route,options);
   if(!lostAppealReceipt&&route.includes('/moderation/appeals/')&&options?.method==='POST'){
    lostAppealReceipt=true;
    appealEndpoint=route;
    throw new TypeError('Test lost appeal decision receipt');
   }
   return response;
  };
 }
 appealForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#discussion-moderation-results')?.textContent.includes(verdict),'appeal decision confirmed');
 if(mode==='submit'){
  expect(lostAppealReceipt).toBe(true);
  expect(appealForm.isConnected).toBe(false);
  expect((await transport(appealEndpoint,{headers:{Cookie:authorCookie}})).status).toBe(403);
 }
 reporter.document.getElementById('my-discussion-reports-refresh').click();
 await until(()=>reporter.document.querySelector('#my-discussion-reports')?.textContent.includes(overturned?'复核后解除限制':'举报成立'),'reporter views appeal outcome');
 const reporterResults=reporter.document.getElementById('my-discussion-reports');
 expect(reporterResults.textContent).toContain('初审于');
 expect(Boolean(reporterResults.querySelector('[data-report-review-date]'))).toBe(overturned);
 expect(reporterResults.textContent).not.toContain('给作者的复核说明');
 reporter.close();
 setAppealScope('processed');
 await until(()=>w.document.querySelector('#discussion-moderation-results')?.textContent.includes('审核员的内部复核说明'),'decision appears in processed queue');
 expect(w.document.querySelector('[data-review-appeal]')).toBeNull();
 expect((await(await transport(url)).json()).comments[0]).toMatchObject({withdrawn:true,text:''});
 cookie=authorCookie;
 click(authorView,'dialog-close');click(authorView,'review-owned-discussions');
 await until(()=>authorView.document.querySelector('#owned-discussion-results')?.textContent.includes('申诉状态：'+verdict),'author sees reviewed appeal');
 expect(authorView.document.querySelector('#owned-discussion-results').textContent).not.toContain('审核员的内部复核说明');
 expect(authorView.document.querySelector('#owned-discussion-results').textContent).toContain('给作者的复核说明 <b>按原文显示</b>');
 expect(authorView.document.querySelector('#owned-discussion-results b')).toBeNull();
 const restore=authorView.document.querySelector('[data-owned-discussion-action]');
 if(overturned){
  expect(restore.textContent).toBe('恢复公开发言');
  restore.click();
  await until(()=>authorView.document.querySelector('[data-owned-discussion-action]')?.textContent==='撤回公开','author explicitly restores publication');
  expect((await(await transport(url,{headers:{Cookie:reviewerCookie}})).json()).comments[0]).toMatchObject({withdrawn:false,text:comment.text});
 }else expect(restore).toBeNull();
 cookie=reviewerCookie;
 const mine='/api/review-tutorial-discussions/reports/mine';
 expect((await(await transport(mine,{headers:{Cookie:authorCookie}})).json()).reports).toEqual([]);
 expect((await post('/api/login',{name:'recovery-ui',password:'test-only-2026'})).status).toBe(200);
 const reported=(await(await transport(mine)).json()).reports;
 expect(reported).toHaveLength(1);
 expect(reported[0]).toMatchObject({tutorialTitle:tutorial.title,status:'substantiated'});
 if(overturned)expect(reported[0].restrictionLiftedAt).toEqual(expect.any(Number));
 else expect(reported[0]).not.toHaveProperty('restrictionLiftedAt');
 expect(JSON.stringify(reported)).not.toContain('审核员的内部复核说明');
 expect(JSON.stringify(reported)).not.toContain('给作者的复核说明');
 expect(reported[0]).not.toHaveProperty('evidence');
 expect(reported[0]).not.toHaveProperty('decision');
 if(secondaryId){
  const {reports}=await(await transport(mine,{headers:{Cookie:secondaryCookie}})).json();
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({id:secondaryId,status:'substantiated'});
  expect(reports[0].restrictionLiftedAt).toBe(reported[0].restrictionLiftedAt);
  expect(reports[0]).not.toHaveProperty('details');
  const legacyFile=path.join(directory,'discussion-reports',secondaryId+'.json');
  const legacyReport=JSON.parse(fs.readFileSync(legacyFile,'utf8'));
  expect(legacyReport.moderationId).toBe(reported[0].id);
  delete legacyReport.moderationId;
  fs.writeFileSync(legacyFile,JSON.stringify(legacyReport));
  const legacy=(await(await transport(mine,{headers:{Cookie:secondaryCookie}})).json()).reports;
  expect(legacy).toEqual(reports);
 }
 click(w,'dialog-close');
 expect(w.document.querySelector('#discussion-moderation-results')).toBeNull();
},15000);
it.each(['same submission','different submission'])('recovers a reader discussion report after a lost receipt: %s',async(mode)=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;
 const post=(requestId,headers={})=>transport(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({text:requestId,tutorialVersion:tutorial.version,parentId:null,requestId,consent:true})});
 expect((await post('reportable-peer-post',{Cookie:authorCookie})).status).toBe(201);
 expect((await post('reader-own-post')).status).toBe(201);
 click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);
 const forms=w.document.querySelectorAll('[data-discussion-report]');
 expect(forms).toHaveLength(1);
 const form=forms[0],reason=form.elements.namedItem('reason'),status=form.querySelector('[role="status"]');
 expect(form.closest('article').textContent).toContain('reportable-peer-post');
 form.closest('details').open=true;reason.value='spam';form.elements.details.value='重复发布同一条广告';
 let lost=false,reportEndpoint,submissions=0;
 w.fetch=async(route,options)=>{
  if(mode==='different submission'&&!lost&&route.endsWith('/report')&&options?.method==='POST'){
   const prior=await transport(route,{...options,body:JSON.stringify({reason:'other',details:'另一窗口先提交的说明'})});
   expect(prior.status).toBe(201);
  }
  const response=await transport(route,options);
  if(route.endsWith('/report')&&options?.method==='POST'){
   submissions++;
   reportEndpoint=route;
   if(!lost){lost=true;throw new TypeError('Lost report receipt')}
  }
  return response;
 };
 const submit=()=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 submit();
 const receiptText=mode==='different submission'?'此前已提交过另一份举报':'举报已提交';
 await until(()=>status.textContent.includes(receiptText),'report receipt recovered');
 expect(reason.value).toBe('spam');
 expect(form.elements.details.value).toBe('重复发布同一条广告');
 expect(form.elements.details.disabled).toBe(false);
 expect(form.elements.details.readOnly).toBe(true);
 expect(submissions).toBe(1);
 const authorReceipt=await(await transport(reportEndpoint,{headers:{Cookie:authorCookie}})).json();
 expect(authorReceipt.reportId).toBeNull();
 expect(form.querySelector('button').disabled).toBe(true);
 expect(fs.readdirSync(path.join(directory,'discussion-reports'))).toHaveLength(1);
 input(w,'#tutorial-discussion-form [name="text"]','举报前未发送的讨论草稿');
 [...form.querySelectorAll('button')].find(button=>button.textContent==='查看我的举报').click();
 await until(()=>w.document.querySelector('#my-discussion-reports')?.textContent.includes('待处理'),'report progress from receipt');
 expect(w.document.getElementById('my-discussion-reports').textContent).not.toContain('重复发布同一条广告');
 expect(w.document.getElementById('my-discussion-reports').textContent).not.toContain('另一窗口先提交的说明');
 [...w.document.querySelectorAll('#dialogs button')].find(button=>button.textContent==='返回教程讨论').click();
 await until(()=>w.document.getElementById('discussion-status')?.textContent.includes('共 2 条'),'returns to the original tutorial discussion');
 expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('举报前未发送的讨论草稿');
},15000);
it('links the community knowledge atlas to the shared demand search',async()=>{
 const w=await startedUI();
 click(w,'group:knowledge');click(w,'nav:atlas');
 const link=[...w.document.querySelectorAll('main a')].find(a=>a.textContent==='浏览知识需求');
 expect(link?.getAttribute('href')).toBe('/platform/product.html?view=discover');
 const page=await fetch('http://127.0.0.1:'+server.address().port+link.getAttribute('href'));
 expect(page.status).toBe(200);
 expect(await page.text()).toContain('id="product-community-link" href="/review/"');
});
it('opens demand search with the public target selected',async()=>{
 const {node}=await visiblePeerTutorial(),w=await startedUI();
 click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-visible-targets');
 await until(()=>w.document.querySelector('[data-visible-index]'),'public target catalog');
 w.document.querySelector('[data-visible-index]').click();
 const link=[...w.document.querySelectorAll('#dialogs a')].find(a=>a.textContent==='浏览这个目标的需求');
 expect(link).toBeTruthy();
 const params=new URL(link.getAttribute('href'),'http://localhost').searchParams;
 expect(Object.fromEntries(params)).toEqual({view:'discover',treeId:node.treeId,nodeId:node.id});
 const result=await transport('/api/knowledge-demands?'+new URLSearchParams({treeId:node.treeId,nodeId:node.id}));
 expect(result.status).toBe(200);
 expect(w.document.querySelector('#visible-target-start')).toBeTruthy();
});
it('confirms publication while a discussion search is active and locates the post on request',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId;
 click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);
 const search=w.document.querySelector('#discussion-search');
 search.elements.query.value='筛选关键词';
 search.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#discussion-status').textContent.includes('匹配 0 条'),'discussion filter active');
 input(w,'#tutorial-discussion-form [name="text"]','一条与筛选无关的新发言');
 const form=w.document.querySelector('#tutorial-discussion-form');
 form.elements.consent.checked=true;
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.document.querySelector('#discussion-publish-status').textContent.includes('发言已发布'),'publication acknowledged');
 expect(search.elements.query.value).toBe('筛选关键词');
 expect(w.document.querySelector('#discussion-comments').textContent).not.toContain('一条与筛选无关的新发言');
 w.document.querySelector('#discussion-show-published').click();
 await until(()=>w.document.querySelector('[data-discussion-focus]')?.textContent.includes('一条与筛选无关的新发言'),'published post focused');
 expect(search.elements.query.value).toBe('');
 expect((await(await transport('/api/review-tutorial-discussions/'+tutorial.id)).json()).total).toBe(1);
 expect(w.dianliangState.activeId).toBe(active);
},15000);
it('preserves a discussion draft after a lost publication response and retries without duplicating the question',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'review-public-search');await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'discussion entry');w.document.querySelector('[data-tutorial-discussion]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 0'),'discussion ready');input(w,'#tutorial-discussion-form [name="text"]','回执丢失也保留的提问');const form=w.document.querySelector('#tutorial-discussion-form');form.elements.namedItem('consent').checked=true;let lost=false;const url='/api/review-tutorial-discussions/'+tutorial.id;w.fetch=async(path,options)=>{const r=await transport(path,options);if(path===url&&options?.method==='POST'&&!lost){lost=true;throw new TypeError('Lost test publication acknowledgement')}return r};form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>lost&&!form.querySelector('button').disabled,'lost response retained');expect(form.elements.namedItem('text').value).toBe('回执丢失也保留的提问');expect([...Array(w.localStorage.length)].map((_,i)=>w.localStorage.getItem(w.localStorage.key(i))).some(v=>v.includes('回执丢失也保留的提问'))).toBe(true);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>form.elements.namedItem('text').value==='','retry confirmed');expect((await(await transport(url)).json()).total).toBe(1);
});
async function openDiscussionFromSearch(w){click(w,'review-public-search');await until(()=>w.document.querySelector('[data-tutorial-discussion]'),'discussion search entry');w.document.querySelector('[data-tutorial-discussion]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('共 '),'discussion loaded');return w.document.querySelector('#tutorial-discussion-form')}
async function cachedDiscussionFixture(){const {tutorial,authorCookie}=await peerTutorial();await startedUI();const url='/api/review-tutorial-discussions/'+tutorial.id;async function post(text,parentId,requestId,headers={}){const r=await transport(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({text,parentId,requestId,tutorialVersion:tutorial.version,consent:true})});expect(r.status).toBe(201);return (await r.json()).comment}const question=await post('cache intact',null,'cache-question'),reply=await post('cached reply',question.id,'cache-reply',{Cookie:authorCookie});return {tutorial,authorCookie,url,question,reply}}
it('keeps cached discussion cursors account and page-size bound and returns a focused reply with its off-page parent',async()=>{
 const {url,question,reply,authorCookie}=await cachedDiscussionFixture(),first=(await(await transport(url+'?limit=1')).json());expect(first.comments[0].mine).toBe(true);expect(first.comments[0].revision).toBeTruthy();const cursor=encodeURIComponent(first.nextCursor);expect((await transport(url+'?limit=1&cursor='+cursor,{headers:{Cookie:authorCookie}})).status).toBe(409);expect((await transport(url+'?limit=2&cursor='+cursor)).status).toBe(409);const other=(await(await transport(url+'?limit=1',{headers:{Cookie:authorCookie}})).json()).comments[0];expect(other.mine).toBe(false);expect(other.revision).toBeUndefined();const focused=(await(await transport(url+'?limit=1&focus='+reply.id+'&replyTo='+question.id)).json());expect(focused.pageNumber).toBe(2);expect(focused.comments[0].id).toBe(reply.id);expect(focused.comments[0].replyContext.text).toBe(question.text);expect(focused.replyTarget.id).toBe(question.id);expect(focused.focusDigest).toMatch(/^[a-f0-9]{64}$/);
},15000);
it('invalidates a warmed discussion page after withdrawal and still enforces current tutorial visibility',async()=>{
 const {tutorial,url,question,reply,authorCookie}=await cachedDiscussionFixture(),first=(await(await transport(url+'?limit=1')).json());expect((await transport(url+'/'+question.id+'/withdraw',{method:'POST',headers:{'Content-Type':'application/json','If-Match':question.revision},body:JSON.stringify({consent:true})})).status).toBe(200);expect((await transport(url+'?limit=1&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);const focused=(await(await transport(url+'?limit=1&focus='+reply.id)).json());expect(focused.comments[0].replyContext).toMatchObject({withdrawn:true,text:''});expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);expect((await transport(url)).status).toBe(404);
},15000);
it('detects equal-size on-disk discussion corruption even after a page was cached',async()=>{
 const {tutorial,url}=await cachedDiscussionFixture();expect((await transport(url)).status).toBe(200);const file=path.join(directory,'tutorial-discussions',tutorial.id+'.json'),raw=fs.readFileSync(file,'utf8'),bad=raw.replace('cache intact','cache damage'),stat=fs.statSync(file);expect(Buffer.byteLength(bad)).toBe(Buffer.byteLength(raw));expect(bad).not.toBe(raw);fs.writeFileSync(file,bad);fs.utimesSync(file,stat.atime,stat.mtime);const denied=await transport(url);expect(denied.status).toBe(503);expect((await denied.json()).code).toBe('DISCUSSION_STORE_UNREADABLE');expect(fs.readFileSync(file,'utf8')).toBe(bad);fs.writeFileSync(file,raw);expect((await transport(url)).status).toBe(200);
},15000);
async function revisedDiscussionSourceUI(){const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;const questionResponse=await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'旧版本问题需要核对',tutorialVersion:tutorial.version,parentId:null,requestId:'inbox-source-question',consent:true})});expect(questionResponse.status).toBe(201);const question=(await questionResponse.json()).comment;const revised=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({title:'新版本的回复来源',method:'增加核对移项的步骤。'})});expect(revised.status).toBe(200);const current=(await revised.json()).tutorial;const answer=await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'按照新版增加的步骤核对移项。',tutorialVersion:current.version,parentId:question.id,requestId:'inbox-source-answer',consent:true})});expect(answer.status).toBe(201);return {w,tutorial,current,question,url}}
it('keeps reply and original-question source versions distinct in the received inbox without marking them read',async()=>{
 const {w,tutorial,current,question}=await revisedDiscussionSourceUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'source-aware inbox');const row=w.document.querySelector('#received-replies-results article'),source=row.querySelector('[data-discussion-source]'),original=[...row.querySelectorAll('details')].find(d=>d.querySelector('summary').textContent==='我当时的讨论');expect(source.open).toBe(false);expect(source.textContent).toContain(current.title);expect(source.textContent).toContain(current.version);expect(source.textContent).toContain(question.targetTitle);expect(source.textContent).toContain(question.targetVersion);expect(original.textContent).toContain(tutorial.version);expect(original.textContent).toContain('旧版本问题需要核对');expect(original.textContent).not.toContain(current.version);expect(row.querySelector('[data-discussion-source-change]')).toBeNull();source.querySelector('summary').click();original.querySelector('summary').click();expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(1);expect(w.dianliangState.activeId).toBe(active);
},15000);
it('keeps full original target and version identifiers in the own discussion archive after a tutorial revision',async()=>{
 const {w,tutorial,current,question}=await revisedDiscussionSourceUI(),active=w.dianliangState.activeId;click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-owned-discussions');await until(()=>w.document.querySelector('[data-owned-discussion-action]'),'source-aware owned discussion');const row=w.document.querySelector('#owned-discussion-results article');expect(row.querySelector('h3').textContent).toBe(tutorial.title);expect(row.textContent).toContain(tutorial.version);expect(row.textContent).toContain(question.targetTitle);expect(row.textContent).toContain(question.targetVersion);expect(row.textContent).toContain('求出未知数，并代回原方程验证等式成立。');expect(row.textContent).toContain('教程已修订');expect(row.textContent).not.toContain(current.title);expect(row.querySelector('details a').getAttribute('href')).toBe('/platform/#node/'+current.treeId+'/'+current.nodeId+'/tutorial/'+tutorial.id+'/'+tutorial.version);expect(row.textContent).not.toContain('按照新版增加的步骤核对移项');expect(row.textContent).not.toContain('本人完成求解与检验');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('shows the discussion source names and complete version markers without mixing in private or current-only content',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId,url='/api/review-tutorial-discussions/'+tutorial.id;expect((await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'请核对这份方法的原目标',tutorialVersion:tutorial.version,parentId:null,requestId:'source-context-current',consent:true})})).status).toBe(201);const comment=(await(await transport(url)).json()).comments[0];click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);const details=w.document.querySelector('[data-discussion-source]');expect(details.open).toBe(false);expect(details.textContent).toContain(tutorial.title);expect(details.textContent).toContain(tutorial.version);expect(details.textContent).toContain(comment.targetTitle);expect(details.textContent).toContain(comment.targetVersion);expect(w.document.querySelector('[data-discussion-source-change]')).toBeNull();expect(details.textContent).not.toContain(tutorial.method);expect(details.textContent).not.toContain('本人完成求解与检验');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('labels earlier-version discussion after its author revises the method while preserving the original source and draft',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId,url='/api/review-tutorial-discussions/'+tutorial.id;await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'针对原教程标题的提问',tutorialVersion:tutorial.version,parentId:null,requestId:'source-context-old',consent:true})});click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','修订后仍保留的输入');click(w,'dialog-close');expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({title:'新版方法标题',method:'增加检验失败后的检查步骤。'})})).status).toBe(200);const current=(await(await transport('/api/review-public-tutorials/one?id='+tutorial.id)).json()).tutorial;await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'针对新版的另一个问题',tutorialVersion:current.version,parentId:null,requestId:'source-context-new',consent:true})});const form=await openDiscussionFromSearch(w),rows=w.document.querySelectorAll('#discussion-comments article');expect(rows[0].querySelector('[data-discussion-source-change]').textContent).toContain('教程已有更新');expect(rows[0].querySelector('[data-discussion-source]').textContent).toContain(tutorial.title);expect(rows[0].querySelector('[data-discussion-source]').textContent).toContain(tutorial.version);expect(rows[0].querySelector('[data-discussion-source] a').getAttribute('href')).toBe('/platform/#node/'+current.treeId+'/'+current.nodeId+'/tutorial/'+tutorial.id+'/'+tutorial.version);expect(rows[0].querySelector('[data-discussion-source]').textContent).not.toContain('新版方法标题');expect(rows[1].querySelector('[data-discussion-source-change]')).toBeNull();expect(rows[1].querySelector('[data-discussion-source]').textContent).toContain(current.version);expect(form.elements.namedItem('text').value).toBe('修订后仍保留的输入');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('renders saved discussion source titles as text and keeps withdrawn comment text undisclosed',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),title='<img src=x onerror=alert(1)>旧教程';const changed=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({title})});expect(changed.status).toBe(200);const current=(await changed.json()).tutorial,url='/api/review-tutorial-discussions/'+tutorial.id,created=(await(await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'撤回后不可显示的私人化发言',tutorialVersion:current.version,parentId:null,requestId:'source-context-escaped',consent:true})})).json()).comment;expect((await transport(url+'/'+created.id+'/withdraw',{method:'POST',headers:{'Content-Type':'application/json','If-Match':created.revision},body:JSON.stringify({consent:true})})).status).toBe(200);click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);const host=w.document.querySelector('#discussion-comments');expect(host.querySelector('[data-discussion-source]').textContent).toContain(title);expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('内容已撤回');expect(host.textContent).not.toContain('撤回后不可显示的私人化发言');
},15000);
it('preserves new discussion writing while an older publication acknowledgement is held',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');const form=await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','第一次准备发布的问题');form.elements.namedItem('consent').checked=true;const held=holdResponse(w,'/api/review-tutorial-discussions/'+tutorial.id,'POST');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();input(w,'#tutorial-discussion-form [name="text"]','等待时新写的另一个问题');held.release();await until(()=>!form.querySelector('button').disabled,'old discussion receipt finished');expect(form.elements.namedItem('text').value).toBe('等待时新写的另一个问题');click(w,'dialog-close');const restored=await openDiscussionFromSearch(w);expect(restored.elements.namedItem('text').value).toBe('等待时新写的另一个问题');expect(restored.elements.namedItem('consent').checked).toBe(false);const published=(await(await transport('/api/review-tutorial-discussions/'+tutorial.id)).json()).comments;expect(published.map(c=>c.text)).toEqual(['第一次准备发布的问题']);
});
it('keeps a discussion draft in memory when both browser stores reject writes and includes it in the own export',async()=>{
 await peerTutorial();const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);const original=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(key,value){if(key.startsWith(KEY+':discussion-draft:'))throw new w.DOMException('Test storage full','QuotaExceededError');return original.call(this,key,value)};input(w,'#tutorial-discussion-form [name="text"]','存储满了也不能丢的问题');expect(w.document.querySelector('#discussion-error').textContent).toContain('仅留在当前窗口');click(w,'dialog-close');expect((await openDiscussionFromSearch(w)).elements.namedItem('text').value).toBe('存储满了也不能丢的问题');click(w,'dialog-close');click(w,'group:space');click(w,'nav:account');const downloads=captureReviewDownloads(w);click(w,'review-account-export');await until(()=>downloads.files.length===1,'memory discussion draft archive');const bundle=await downloads.read(downloads.files[0]);expect(bundle.local.drafts.some(d=>d.storage==='memory'&&d.raw.includes('存储满了也不能丢的问题'))).toBe(true);
});
it('does not clear another window newer discussion draft when a previous publication succeeds',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');const form=await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','当前窗口发布的问题');form.elements.namedItem('consent').checked=true;const key=KEY+':discussion-draft:'+JSON.stringify([w.dianliangState.user.id,tutorial.id]),held=holdResponse(w,'/api/review-tutorial-discussions/'+tutorial.id,'POST');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();const external={ownerId:w.dianliangState.user.id,text:'另一窗口后来保存的草稿',parentId:null,requestId:'other-window-new-request',updatedAt:Date.now()+100};w.localStorage.setItem(key,JSON.stringify(external));held.release();await until(()=>!form.querySelector('button').disabled,'ack keeps other window draft');expect(JSON.parse(w.localStorage.getItem(key))).toEqual(external);click(w,'dialog-close');expect((await openDiscussionFromSearch(w)).elements.namedItem('text').value).toBe(external.text);
});
it('isolates discussion drafts across accounts and restores them only when the original reader returns',async()=>{
 await peerTutorial();const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','只属于原读者的草稿');await switchUser(w,'discussion-next-reader');expect(w.document.querySelector('#tutorial-discussion-form')).toBeNull();click(w,'group:knowledge');click(w,'nav:atlas');expect((await openDiscussionFromSearch(w)).elements.namedItem('text').value).toBe('');await switchUser(w,'recovery-ui',false);click(w,'group:knowledge');click(w,'nav:atlas');const restored=await openDiscussionFromSearch(w);expect(restored.elements.namedItem('text').value).toBe('只属于原读者的草稿');expect(restored.elements.namedItem('consent').checked).toBe(false);
});
it('restores the latest session discussion draft after UI recreation when local draft writes fail',async()=>{
 await peerTutorial();let w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','本机原有的旧草稿');const original=w.Storage.prototype.setItem;
 // Storage named-property setters do not override methods reliably in browsers;
 // inject only this fixture's local store failure through the realm prototype.
 w.Storage.prototype.setItem=function(key,value){if(this===w.localStorage&&key.startsWith(KEY+':discussion-draft:'))throw new w.DOMException('Local quota full','QuotaExceededError');return original.call(this,key,value)};input(w,'#tutorial-discussion-form [name="text"]','后来保存在会话里的新草稿');expect(w.document.querySelector('#discussion-error').textContent).toContain('浏览器会话');const session=[...Array(w.sessionStorage.length)].map((_,i)=>{const k=w.sessionStorage.key(i);return [k,w.sessionStorage.getItem(k)]}),cache=w.localStorage.getItem(KEY);w.close();w=ui(cache);for(const [k,v] of session)w.sessionStorage.setItem(k,v);await until(()=>w.document.querySelector('[data-action="group:knowledge"]')&&w.readTransportSnapshot().revision,'recreated discussion UI');if(!w.document.querySelector('[data-action="nav:atlas"]'))click(w,'group:knowledge');click(w,'nav:atlas');const restored=await openDiscussionFromSearch(w);expect(restored.elements.namedItem('text').value).toBe('后来保存在会话里的新草稿');expect(w.document.querySelector('#discussion-error').textContent).toContain('浏览器会话');
});
it('retains the discussion draft original tutorial version until the reader explicitly reviews the revised method',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','原教程这一步需要解释');click(w,'dialog-close');const revised=await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({method:'作者修订后的新方法：先画图，再检查等式。'})});expect(revised.status).toBe(200);const version=(await revised.json()).tutorial.version,form=await openDiscussionFromSearch(w);expect(form.elements.namedItem('text').value).toBe('原教程这一步需要解释');form.elements.namedItem('consent').checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));expect(w.document.querySelector('#discussion-error').textContent).toContain('先核对当前教程');expect((await(await transport('/api/review-tutorial-discussions/'+tutorial.id)).json()).total).toBe(0);expect(w.document.querySelector('#discussion-version-review').parentElement.textContent).toContain('先画图，再检查等式');w.document.querySelector('#discussion-version-review').click();expect(form.elements.namedItem('consent').checked).toBe(false);form.elements.namedItem('consent').checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>form.elements.namedItem('text').value==='','revised discussion publication');expect((await(await transport('/api/review-tutorial-discussions/'+tutorial.id)).json()).comments[0].tutorialVersion).toBe(version);
});
it('shows the exact reply target after reopening a discussion draft and cancels only the reply binding',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'这个步骤需要怎样检查？',tutorialVersion:tutorial.version,parentId:null,requestId:'reply-label-parent',consent:true})});click(w,'group:knowledge');click(w,'nav:atlas');let form=await openDiscussionFromSearch(w);w.document.querySelector('[data-discussion-reply]').click();expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('这个步骤需要怎样检查？');input(w,'#tutorial-discussion-form [name="text"]','我的回答文字应当保留');click(w,'dialog-close');form=await openDiscussionFromSearch(w);expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('shared-ui-author');expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('这个步骤需要怎样检查？');form.elements.namedItem('consent').checked=true;w.document.querySelector('#discussion-reply-cancel').click();expect(form.elements.namedItem('text').value).toBe('我的回答文字应当保留');expect(form.elements.namedItem('consent').checked).toBe(false);expect(w.document.querySelector('#discussion-reply-label').textContent).toBe('新问题或反馈');expect(w.document.querySelector('#discussion-reply-cancel').hidden).toBe(true);
});
it('reads and withdraws only the reader original discussion from owned history after its tutorial is private',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId,url='/api/review-tutorial-discussions/'+tutorial.id;expect((await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'属于我的撤回后历史',tutorialVersion:tutorial.version,parentId:null,requestId:'owned-ui-history',consent:true})})).status).toBe(201);expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-owned-discussions');await until(()=>w.document.querySelector('[data-owned-discussion-action]'),'own discussion archive');expect(w.document.querySelector('#owned-discussion-results').textContent).toContain('属于我的撤回后历史');expect(w.document.querySelector('#owned-discussion-results').textContent).toContain('当前不可公开读取');w.document.querySelector('[data-owned-discussion-action]').click();await until(()=>w.document.querySelector('#owned-discussion-results').textContent.includes('已撤回公开'),'own archive withdrawal');expect(w.document.querySelector('#owned-discussion-results').textContent).toContain('属于我的撤回后历史');expect(w.document.querySelector('[data-owned-discussion-action]')).toBeNull();expect(w.dianliangState.activeId).toBe(active);
});
it('closes owned discussion history on account change and discards its old private response',async()=>{
 const {tutorial}=await peerTutorial(),w=await startedUI();await transport('/api/review-tutorial-discussions/'+tutorial.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'OLD-ACCOUNT-OWN-DISCUSSION',tutorialVersion:tutorial.version,parentId:null,requestId:'owned-late-read',consent:true})});click(w,'group:knowledge');click(w,'nav:contribute');const held=holdResponse(w,'/api/review-owned-discussions?query=');click(w,'review-owned-discussions');await held.wait();await switchUser(w,'owned-discussion-next');held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#owned-discussion-results')).toBeNull();expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.body.textContent).not.toContain('OLD-ACCOUNT-OWN-DISCUSSION');expect(w.dianliangState.user.name).toBe('owned-discussion-next');
});
it('reads received peer replies and opens the focused thread without changing the active clock',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId,url='/api/review-tutorial-discussions/'+tutorial.id,q=(await(await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'读者的问题',tutorialVersion:tutorial.version,parentId:null,requestId:'inbox-ui-parent',consent:true})})).json()).comment;const a=(await(await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'作者给你的回答',tutorialVersion:tutorial.version,parentId:q.id,requestId:'inbox-ui-reply',consent:true})})).json()).comment;click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'received reply entry');expect(w.document.querySelector('#received-replies-results').textContent).toContain('作者给你的回答');w.document.querySelector('[data-received-reply]').click();await until(()=>w.document.querySelector('[data-discussion-focus]'),'focused received reply');expect(w.document.querySelector('[data-discussion-focus]').textContent).toContain('作者给你的回答');expect(w.document.activeElement).toBe(w.document.querySelector('[data-discussion-focus]'));expect(w.dianliangState.activeId).toBe(active);expect(a.id).toBeTruthy();
});
it('discards a received-replies response after the participant changes accounts',async()=>{
 await peerTutorial();const w=await startedUI();click(w,'group:knowledge');click(w,'nav:contribute');const held=holdResponse(w,'/api/review-received-replies');click(w,'review-received-replies');await held.wait();await switchUser(w,'received-replies-next');held.release();await new Promise(r=>setTimeout(r,50));expect(w.dianliangState.user.name).toBe('received-replies-next');expect(w.document.querySelector('#received-replies-results')).toBeNull();expect(w.document.querySelector('#dialogs').textContent).toBe('');
});
it('marks only the actually focused reply read and retains a retry when the read acknowledgement is lost',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id,q=(await(await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'等待阅读的问题',tutorialVersion:tutorial.version,parentId:null,requestId:'read-ui-parent',consent:true})})).json()).comment;await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'待阅读的回答',tutorialVersion:tutorial.version,parentId:q.id,requestId:'read-ui-answer',consent:true})});click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'unread inbox loaded');expect(w.document.querySelector('#received-replies-status').textContent).toContain('未读 1');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(1);let lost=false;w.fetch=async(path,options)=>{const result=await transport(path,options);if(path==='/api/review-received-replies/read'&&!lost){lost=true;throw new TypeError('Lost read acknowledgement')}return result};w.document.querySelector('[data-received-reply]').click();await until(()=>w.document.querySelector('[data-reply-read-retry]'),'read acknowledgement retry');expect(w.document.querySelector('[data-discussion-focus]').textContent).toContain('待阅读的回答');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(0);w.document.querySelector('[data-reply-read-retry]').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('对应回复已标记已读'),'read retry confirmed');click(w,'dialog-close');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'read inbox reopened');expect(w.document.querySelector('#received-replies-status').textContent).toContain('未读 0');
});
it('does not mark a reply read when its focused discussion fails to load',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id,q=(await(await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'无法打开测试问题',tutorialVersion:tutorial.version,parentId:null,requestId:'failed-focus-parent',consent:true})})).json()).comment;await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'保持未读的回答',tutorialVersion:tutorial.version,parentId:q.id,requestId:'failed-focus-answer',consent:true})});click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'inbox before failed focus');let marked=false;w.fetch=async(path,options)=>{if(path.startsWith(url+'?'))throw new TypeError('Test focus read disconnected');if(path==='/api/review-received-replies/read')marked=true;return transport(path,options)};w.document.querySelector('[data-received-reply]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('Test focus read disconnected'),'failed focus status');expect(w.document.querySelector('[data-discussion-focus]')).toBeNull();expect(marked).toBe(false);expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(1);
});
async function manyReplyUI(){const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id,q=(await(await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'跨页问题',tutorialVersion:tutorial.version,parentId:null,requestId:'many-ui-parent',consent:true})})).json()).comment;for(let i=0;i<31;i++)expect((await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'跨页回答 '+i,tutorialVersion:tutorial.version,parentId:q.id,requestId:'many-ui-reply-'+i,consent:true})})).status).toBe(201);click(w,'group:knowledge');return {w,tutorial,url,authorCookie}}
function discussionPageButton(w,label){const button=[...w.document.querySelectorAll('#discussion-comments nav button')].find(b=>b.textContent===label);if(!button)throw Error('Missing discussion page control: '+label);return button}
async function manyOwnDiscussionUI(){const {tutorial}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;for(let i=0;i<31;i++)expect((await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'归档分页问题 '+i,tutorialVersion:tutorial.version,parentId:null,requestId:'own-page-question-'+i,consent:true})})).status).toBe(201);click(w,'group:knowledge');return {w,tutorial,url}}
it('invalidates a warm inbox cursor when only the read receipt changes',async()=>{
 const {tutorial}=await manyReplyUI(),api='/api/review-received-replies?scope=unread',first=(await(await transport(api)).json()),reply=first.replies[0];expect(first.unreadCount).toBe(31);const file=path.join(directory,'tutorial-discussions',tutorial.id+'.json'),original=fs.readFileSync(file,'utf8');expect((await transport('/api/review-received-replies/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tutorialId:tutorial.id,replyId:reply.id,digest:reply.digest})})).status).toBe(200);expect(fs.readFileSync(file,'utf8')).toBe(original);expect((await transport(api+'&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);const updated=(await(await transport(api)).json());expect(updated.unreadCount).toBe(30);expect(updated.replies.some(r=>r.id===reply.id)).toBe(false);
},15000);
it('binds warm archive cursors to account, query and limit without leaking another owner’s original text',async()=>{
 const {authorCookie}=await cachedDiscussionFixture(),api='/api/review-owned-discussions',first=(await(await transport(api+'?limit=1')).json());expect(first.entries[0].text).toBe('cache intact');const other=(await(await transport(api+'?limit=1',{headers:{Cookie:authorCookie}})).json());expect(other.entries.map(e=>e.text)).toEqual(['cached reply']);
 const post=await transport('/api/review-tutorial-discussions/'+first.entries[0].tutorialId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'second owned item',tutorialVersion:first.entries[0].tutorialSnapshot.version,parentId:null,requestId:'cache-own-second',consent:true})});expect(post.status).toBe(201);const current=(await(await transport(api+'?limit=1')).json()),cursor=encodeURIComponent(current.nextCursor);expect(current.total).toBe(2);expect((await transport(api+'?limit=1&cursor='+cursor,{headers:{Cookie:authorCookie}})).status).toBe(409);expect((await transport(api+'?limit=1&query=cache&cursor='+cursor)).status).toBe(409);expect((await transport(api+'?limit=2&cursor='+cursor)).status).toBe(409);
},15000);
it('keeps a warm own archive private and intact when the public tutorial becomes unavailable',async()=>{
 const {tutorial,authorCookie}=await cachedDiscussionFixture(),inbox='/api/review-received-replies',own='/api/review-owned-discussions';expect((await(await transport(inbox)).json()).total).toBe(1);expect((await(await transport(own)).json()).entries[0].publicAvailable).toBe(true);expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);expect((await(await transport(inbox)).json()).total).toBe(0);const after=(await(await transport(own)).json());expect(after.entries).toHaveLength(1);expect(after.entries[0]).toMatchObject({text:'cache intact',publicAvailable:false,currentVersionMatches:false});
},15000);
it('clears a stale discussion when a reply is withdrawn before its read receipt reaches the service',async()=>{
 const {tutorial,url,w,authorCookie}=await manyReplyUI();
 click(w,'nav:contribute');click(w,'review-received-replies');
 await until(()=>w.document.querySelector('[data-received-reply]'),'inbox loaded');
 let release,replyId;
 const gate=new Promise(resolve=>{release=resolve});
 w.fetch=async(route,options)=>{
  if(route==='/api/review-received-replies/read'){replyId=JSON.parse(options.body).replyId;await gate}
  return transport(route,options);
 };
 w.document.querySelector('[data-received-reply]').click();
 try{
  await until(()=>replyId,'read receipt waiting before transport');
  w.document.querySelector('[data-discussion-focus] [data-discussion-reply]').click();
  const entry=(await(await transport(url+'?focus='+replyId,{headers:{Cookie:authorCookie}})).json()).comments.find(e=>e.id===replyId);
  expect((await transport(url+'/'+replyId+'/withdraw',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':entry.revision},body:JSON.stringify({consent:true})})).status).toBe(200);
  input(w,'#tutorial-discussion-form [name="text"]','撤回期间保留的草稿');
 }finally{release()}
 await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('对应回复已不可读取'),'permission change shown');
 expect(w.document.querySelector('#discussion-comments').childElementCount).toBe(0);
 expect(w.document.querySelector('[data-reply-read-retry]')).toBeNull();
 expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('原问题不可读取');
 expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('撤回期间保留的草稿');
 expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(30);
},15000);
it('does not show the previous reader unread count after switching accounts',async()=>{
 const {w}=await manyReplyUI();
 const endpoint='/api/review-received-replies/summary';
 const held=holdResponse(w,endpoint);
 click(w,'nav:contribute');
 await held.wait();
 await switchUser(w,'new-inbox-reader');
 click(w,'group:knowledge');click(w,'nav:contribute');
 const entry=w.document.querySelector('[data-action="review-received-replies"]');
 expect(entry).not.toBeNull();
 const current=await(await transport(endpoint)).json();
 expect(current).toEqual({ok:true,ownerId:w.dianliangState.user.id,unreadCount:0});
 held.release();
 await new Promise(resolve=>setImmediate(resolve));
 expect(entry.textContent).toBe('收到的回复');
});
it('opens only the latest reply selection when the earlier lookup finishes first',async()=>{
 const {tutorial,w}=await manyReplyUI();
 const active=w.dianliangState.activeId;
 const inbox=await(await transport('/api/review-received-replies')).json();
 const expected=inbox.replies[1];
 click(w,'nav:contribute');click(w,'review-received-replies');
 const inboxEntry=()=>w.document.querySelector('[data-action="review-received-replies"]');
 await until(()=>inboxEntry()?.textContent.includes('31 条未读'),'entry shows current unread count');
 await until(()=>w.document.querySelectorAll('[data-received-reply]').length>=2,'two inbox replies available');
 const [first,second]=w.document.querySelectorAll('[data-received-reply]');
 const requests=[],marked=[];
 w.fetch=async(route,options)=>{
  if(route==='/api/review-received-replies/read')marked.push(JSON.parse(options.body).replyId);
  const result=await transport(route,options);
  if(route==='/api/review-public-tutorials/one?id='+tutorial.id)await new Promise(resolve=>requests.push(resolve));
  return result;
 };
 first.click();
 await until(()=>requests.length===1,'first tutorial lookup held');
 second.click();
 await until(()=>requests.length===2,'second tutorial lookup held');
 requests[0]();
 await until(()=>!first.disabled,'earlier lookup finished');
 expect(w.document.querySelector('#received-replies-results')).not.toBeNull();
 expect(marked).toEqual([]);
 requests[1]();
 await until(()=>w.document.getElementById('discussion-status')?.textContent.includes('对应回复已标记已读'),'latest reply focused and read');
 expect(w.document.querySelector('[data-discussion-focus]').textContent).toContain(expected.text);
 expect(marked).toEqual([expected.id]);
 await until(()=>inboxEntry()?.textContent.includes('30 条未读'),'entry reflects confirmed read');
 const summary=await(await transport('/api/review-received-replies/summary')).json();
 expect(summary).toEqual({ok:true,ownerId:w.dianliangState.user.id,unreadCount:30});
 expect(w.dianliangState.activeId).toBe(active);
});
it('keeps the inbox open when a reply resolves to the wrong tutorial',async()=>{
 const {tutorial,w}=await manyReplyUI();
 const active=w.dianliangState.activeId;
 click(w,'nav:contribute');click(w,'review-received-replies');
 await until(()=>w.document.querySelector('[data-received-reply]'),'inbox ready');
 let marks=0;
 w.fetch=async(route,options)=>{
  if(route==='/api/review-received-replies/read')marks++;
  const response=await transport(route,options);
  if(route==='/api/review-public-tutorials/one?id='+tutorial.id){
   const result=await response.json();
   return {...response,json:async()=>({...result,tutorial:{...result.tutorial,id:'different-tutorial'}})};
  }
  return response;
 };
 w.document.querySelector('[data-received-reply]').click();
 await until(()=>w.document.querySelector('#received-replies-status')?.textContent.includes('无法核对'),'mismatched tutorial rejected');
 expect(w.document.querySelector('#tutorial-discussion-form')).toBeNull();
 expect(marks).toBe(0);
 expect(w.dianliangState.activeId).toBe(active);
});
it.each(['open','refresh'])('removes replies whose tutorial became private on inbox %s',async(action)=>{
 const {tutorial,url,w,authorCookie}=await manyReplyUI();
 click(w,'nav:contribute');click(w,'review-received-replies');
 await until(()=>w.document.querySelector('[data-received-reply]'),'inbox displays public replies');
 const filter=w.document.querySelector('#received-replies-scope');
 filter.value='unread';filter.dispatchEvent(new w.Event('change',{bubbles:true}));
 await until(()=>w.document.querySelector('[data-received-reply]'),'unread inbox displays public replies');
 const inboxEntry=w.document.querySelector('[data-action="review-received-replies"]');
 expect(inboxEntry.textContent).toContain('31 条未读');
 expect((await transport('/api/tutorials/'+tutorial.id,{method:'PATCH',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':tutorial.version},body:JSON.stringify({visibility:'private'})})).status).toBe(200);
 const readRequests=[];
 w.fetch=(route,options)=>{if(route.startsWith(url)||route==='/api/review-received-replies/read')readRequests.push(route);return transport(route,options)};
 w.document.querySelector(action==='open'?'[data-received-reply]':'#received-replies-refresh').click();
 await until(()=>w.document.querySelector('#received-replies-results')?.textContent.includes('没有未读回复'),'inbox refresh removes private tutorial replies');
 expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');
 expect(w.document.querySelector('#received-replies-status').textContent).toContain('未读 0 条');
 expect(inboxEntry.textContent).toBe('收到的回复');
 expect(w.document.querySelector('dialog').textContent).not.toContain('跨页回答');
 expect(readRequests).toEqual([]);
 w.document.querySelector('[data-received-show-all]').click();
 await until(()=>w.document.querySelector('#received-replies-results')?.textContent.includes('暂无可公开读取的他人回复'),'empty inbox can return to all replies');
 expect(filter.value).toBe('all');
 expect(w.document.activeElement).toBe(filter);
 expect(readRequests).toEqual([]);
},15000);
it('lets a reader open the remaining discussion after an author withdraws an inbox reply',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),url='/api/review-tutorial-discussions/'+tutorial.id;
 const post=(body,headers={})=>transport(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({tutorialVersion:tutorial.version,consent:true,...body})});
 const question=(await(await post({text:'公开问题',parentId:null,requestId:'focus-parent'})).json()).comment;
 const reply=(await(await post({text:'稍后撤回的回答',parentId:question.id,requestId:'focus-child'},{Cookie:authorCookie})).json()).comment;
 click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-received-replies');
 await until(()=>w.document.querySelector('[data-received-reply]'),'inbox displays the reply');
 const versionLink=w.document.querySelector('#received-replies-results [data-discussion-source] a');
 expect(versionLink.getAttribute('href')).toMatch(new RegExp('/tutorial/'+tutorial.id+'/'+tutorial.version+'$'));
 const filter=w.document.querySelector('#received-replies-scope');
 filter.value='unread';filter.dispatchEvent(new w.Event('change',{bubbles:true}));
 await until(()=>w.document.querySelector('[data-received-reply]'),'unread filter displays the reply');
 expect((await transport(url+'/'+reply.id+'/withdraw',{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json','If-Match':reply.revision},body:JSON.stringify({consent:true})})).status).toBe(200);
 let receipts=0;
 w.fetch=(route,options)=>{if(route==='/api/review-received-replies/read')receipts++;return transport(route,options)};
 w.document.querySelector('[data-received-reply]').click();
 await until(()=>w.document.querySelector('[data-discussion-retry]')?.textContent==='查看其余讨论','withdrawn focus recovery');
 input(w,'#tutorial-discussion-form [name="text"]','继续写的草稿');
 w.document.querySelector('[data-discussion-retry]').click();
 await until(()=>w.document.querySelector('#discussion-comments article'),'remaining discussion visible');
 expect(w.document.querySelector('#discussion-comments').textContent).toContain('公开问题');
 expect(w.document.querySelector('#discussion-comments').textContent).not.toContain(reply.text);
 expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('继续写的草稿');
 expect(receipts).toBe(0);
 [...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='返回收到的回复').click();
 await until(()=>w.document.querySelector('#received-replies-results')?.textContent.includes('没有未读回复'),'refreshed inbox excludes withdrawn reply');
 expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');
 expect(w.document.querySelector('#received-replies-status').textContent).toContain('未读 0 条');
 expect(w.document.querySelector('dialog').textContent).not.toContain(reply.text);
},15000);
async function discussionArchiveUI(kind){const fixture=await(kind==='received'?manyReplyUI():manyOwnDiscussionUI()),{w}=fixture;click(w,'nav:contribute');click(w,kind==='received'?'review-received-replies':'review-owned-discussions');const prefix=kind==='received'?'received-replies':'owned-discussion',label=kind==='received'?'回复':'本人讨论',api=kind==='received'?'/api/review-received-replies':'/api/review-owned-discussions';await until(()=>w.document.querySelector('#'+prefix+'-status')?.textContent.includes('第 1 / 2 页'),'archive page ready');if(kind==='received'){const filter=w.document.querySelector('#received-replies-scope');filter.value='unread';filter.dispatchEvent(new w.Event('change',{bubbles:true}))}else{input(w,'#owned-discussion-search input','归档分页');w.document.querySelector('#owned-discussion-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))}await until(()=>w.document.querySelector('#'+prefix+'-results nav'),'archive filter ready');return {...fixture,kind,prefix,label,api,button:text=>{const b=[...w.document.querySelectorAll('#'+prefix+'-results nav button')].find(b=>b.textContent===text+label);if(!b)throw Error('Missing archive pager '+text+label);return b}}}
it.each(['received','owned'])('supports previous and first pages of the %s discussion archive without changing its filter or activity',async(kind)=>{
 const f=await discussionArchiveUI(kind),{w,prefix,label,api}=f,active=w.dianliangState.activeId,first=await(await transport(api+(kind==='received'?'?scope=unread':'?query='+encodeURIComponent('归档分页')))).json();expect(first.previousCursor).toBeNull();expect(first.pageCount).toBe(2);const next=f.button('下一页');next.focus();w.document.querySelector('dialog').scrollTop=400;next.click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 2 / 2 页'),'archive second page');expect(w.document.querySelector('dialog').scrollTop).toBe(0);expect(w.document.activeElement).toBe(w.document.querySelector('#'+prefix+'-results article'));const second=await(await transport(api+(kind==='received'?'?scope=unread':'?query='+encodeURIComponent('归档分页'))+'&cursor='+encodeURIComponent(first.nextCursor))).json();expect(second.previousCursor).toBe(first.nextCursor.split(':')[0]+':0');expect(second.pageNumber).toBe(2);f.button('上一页').click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 1 / 2 页'),'archive previous page');f.button('下一页').click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 2 / 2 页'),'archive second page again');f.button('回到第一页').click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 1 / 2 页'),'archive first page');if(kind==='received'){expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');expect((await(await transport(api)).json()).unreadCount).toBe(31)}else expect(w.document.querySelector('#owned-discussion-search input').value).toBe('归档分页');expect(w.dianliangState.activeId).toBe(active);expect(label).toBeTruthy();
},15000);
it.each(['received','owned'])('retries the same %s archive page after transport failure and ignores the removed retry control',async(kind)=>{
 const f=await discussionArchiveUI(kind),{w,prefix,api}=f,requests=[];let fail=true;w.fetch=(path,options)=>{if(path.startsWith(api)&&new URL(path,'http://localhost').searchParams.get('cursor')){requests.push(path);if(fail){fail=false;return Promise.reject(new TypeError('Archive page disconnected'))}}return transport(path,options)};f.button('下一页').click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('Archive page disconnected'),'archive page failure');const old=w.document.querySelector('[data-discussion-archive-retry]');old.click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 2 / 2 页'),'archive same page retry');expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);old.click();await new Promise(r=>setTimeout(r,20));expect(requests).toHaveLength(2);if(kind==='received')expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');else expect(w.document.querySelector('#owned-discussion-search input').value).toBe('归档分页');
},15000);
it.each(['received','owned'])('recovers a stale %s previous-page cursor at the first page with its criteria retained',async(kind)=>{
 const f=await discussionArchiveUI(kind),{w,prefix,url,tutorial}=f;f.button('下一页').click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 2 / 2 页'),'archive stale previous fixture');if(kind==='received'){const q=(await(await transport(url)).json()).comments[0];expect((await transport(url+'/'+q.id+'/withdraw',{method:'POST',headers:{'Content-Type':'application/json','If-Match':q.revision},body:JSON.stringify({consent:true})})).status).toBe(200)}else expect((await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'归档分页新增问题',tutorialVersion:tutorial.version,parentId:null,requestId:'own-page-newer-question',consent:true})})).status).toBe(201);f.button('上一页').click();await until(()=>w.document.querySelector('[data-discussion-archive-retry]'),'archive stale cursor retry');expect(w.document.querySelector('#'+prefix+'-status').textContent).toContain('变化');w.document.querySelector('[data-discussion-archive-retry]').click();await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 1 / 2 页'),'archive stale cursor first page');if(kind==='received')expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');else expect(w.document.querySelector('#owned-discussion-search input').value).toBe('归档分页');
},15000);
it.each(['received','owned'])('discards a held %s archive page after its criteria change',async(kind)=>{
 const f=await discussionArchiveUI(kind),{w,prefix,api}=f,first=await(await transport(api+(kind==='received'?'?scope=unread':'?query='+encodeURIComponent('归档分页')))).json(),request=api+(kind==='received'?'?scope=unread':'?query='+encodeURIComponent('归档分页'))+'&cursor='+encodeURIComponent(first.nextCursor),held=holdResponse(w,request);f.button('下一页').click();await held.wait();if(kind==='received'){const select=w.document.querySelector('#received-replies-scope');select.value='all';select.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('#'+prefix+'-status').textContent.includes('第 1 / 2 页'),'archive new scope loaded')}else input(w,'#owned-discussion-search input','尚未提交的搜索');held.release();await new Promise(r=>setTimeout(r,50));if(kind==='received'){expect(w.document.querySelector('#received-replies-scope').value).toBe('all');expect(w.document.querySelector('#'+prefix+'-status').textContent).toContain('第 1 / 2 页')}else{expect(w.document.querySelector('#'+prefix+'-status').textContent).toContain('搜索词已修改');expect(w.document.querySelector('#'+prefix+'-results').textContent).toBe('')}
},15000);
it('returns a deliberate discussion page navigation to its beginning and focuses the first comment',async()=>{
 const {w}=await manyReplyUI();click(w,'nav:atlas');await openDiscussionFromSearch(w);const dialog=w.document.querySelector('dialog'),next=discussionPageButton(w,'下一页讨论');dialog.scrollTop=600;next.focus();next.click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'discussion navigation reading position');expect(dialog.scrollTop).toBe(0);expect(w.document.activeElement).toBe(w.document.querySelector('#discussion-comments article'));expect(w.document.activeElement.textContent).toContain('跨页回答 29');
},15000);
it('does not take focus or scroll away from a draft edited during a held discussion page read',async()=>{
 const {w,url}=await manyReplyUI();click(w,'nav:atlas');await openDiscussionFromSearch(w);const first=(await(await transport(url)).json()),held=holdResponse(w,url+'?cursor='+encodeURIComponent(first.nextCursor)+'&replyTo=&focus='),next=discussionPageButton(w,'下一页讨论');next.focus();next.click();await held.wait();const textarea=w.document.querySelector('#tutorial-discussion-form [name="text"]'),dialog=w.document.querySelector('dialog');textarea.focus();input(w,'#tutorial-discussion-form [name="text"]','不要打断我正在写的回复');dialog.scrollTop=450;held.release();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'discussion draft focus retained');expect(w.document.activeElement).toBe(textarea);expect(dialog.scrollTop).toBe(450);expect(textarea.value).toBe('不要打断我正在写的回复');
},15000);
it('announces a held discussion page read while retaining visible content and allowing draft input',async()=>{
 const {w,url}=await manyReplyUI(),active=w.dianliangState.activeId;click(w,'nav:atlas');await openDiscussionFromSearch(w);const first=(await(await transport(url)).json()),held=holdResponse(w,url+'?cursor='+encodeURIComponent(first.nextCursor)+'&replyTo=&focus=');discussionPageButton(w,'下一页讨论').click();await held.wait();expect(w.document.querySelector('#discussion-comments').getAttribute('aria-busy')).toBe('true');expect(w.document.querySelector('#discussion-status').textContent).toContain('正在读取讨论');expect(w.document.querySelector('#discussion-comments').textContent).toContain('跨页问题');expect(discussionPageButton(w,'下一页讨论').disabled).toBe(true);w.document.querySelector('[data-discussion-reply]').click();input(w,'#tutorial-discussion-form [name="text"]','读取中也能写回复');expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('跨页问题');expect(w.document.querySelector('#tutorial-discussion-form button[type="submit"]').disabled).toBe(false);held.release();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'held discussion next page completed');expect(w.document.querySelector('#discussion-comments').getAttribute('aria-busy')).toBe('false');expect(discussionPageButton(w,'上一页讨论').disabled).toBe(false);expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('读取中也能写回复');expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('跨页问题');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('keeps only the latest discussion retry control after repeated page failures',async()=>{
 const {w,url}=await manyReplyUI();click(w,'nav:atlas');await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','多次失败仍保留');const requested=[];let failures=2;w.fetch=async(path,options)=>{if(path.startsWith(url+'?')&&new URL(path,'http://localhost').searchParams.get('cursor')){requested.push(path);if(failures-->0)throw new TypeError('Repeated discussion failure')}return transport(path,options)};discussionPageButton(w,'下一页讨论').click();await until(()=>w.document.querySelector('[data-discussion-retry]'),'first page retry control');const old=w.document.querySelector('[data-discussion-retry]');old.click();await until(()=>w.document.querySelector('[data-discussion-retry]')&&w.document.querySelector('[data-discussion-retry]')!==old,'replacement retry control');expect(w.document.querySelectorAll('[data-discussion-retry]')).toHaveLength(1);expect(w.document.querySelector('#discussion-comments').getAttribute('aria-busy')).toBe('false');expect(w.document.querySelector('#discussion-comments').textContent).toContain('跨页问题');old.click();await new Promise(r=>setTimeout(r,20));expect(requested).toHaveLength(2);w.document.querySelector('[data-discussion-retry]').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'repeated failure page recovered');expect(new Set(requested).size).toBe(1);expect(w.document.querySelector('[data-discussion-retry]')).toBeNull();expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('多次失败仍保留');
},15000);
it('keeps the latest discussion read busy when an earlier page completes after a publish reload begins',async()=>{
 const {w,url}=await manyReplyUI(),active=w.dianliangState.activeId;click(w,'nav:atlas');await openDiscussionFromSearch(w);const first=(await(await transport(url)).json()),earlier=holdResponse(w,url+'?cursor='+encodeURIComponent(first.nextCursor)+'&replyTo=&focus=');discussionPageButton(w,'下一页讨论').click();await earlier.wait();const latest=holdResponse(w,url+'?cursor=&replyTo=&focus=');input(w,'#tutorial-discussion-form [name="text"]','翻页等待读取时发布的新问题');const form=w.document.querySelector('#tutorial-discussion-form');form.elements.namedItem('consent').checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await latest.wait();earlier.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#discussion-comments').getAttribute('aria-busy')).toBe('true');expect(w.document.querySelector('#discussion-status').textContent).toContain('正在读取讨论');expect(w.document.querySelector('#discussion-comments').textContent).not.toContain('跨页回答 30');latest.release();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('共 33 条'),'latest discussion publish reload');expect(w.document.querySelector('#discussion-comments').getAttribute('aria-busy')).toBe('false');expect(w.document.querySelector('#discussion-status').textContent).toContain('第 1 / 2 页');expect(w.dianliangState.activeId).toBe(active);
},15000);
it('returns to previous discussion pages and preserves the draft and selected reply target',async()=>{
 const {w,url}=await manyReplyUI(),active=w.dianliangState.activeId;click(w,'nav:atlas');await openDiscussionFromSearch(w);expect(w.document.querySelector('#discussion-status').textContent).toContain('第 1 / 2 页');w.document.querySelector('[data-discussion-reply]').click();const target=w.document.querySelector('#discussion-reply-label').textContent;input(w,'#tutorial-discussion-form [name="text"]','来回翻页还要保留的回复');discussionPageButton(w,'下一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'discussion second page');expect(w.document.querySelector('#discussion-comments').textContent).toContain('跨页回答 30');const remote=(await(await transport(url)).json());expect(remote.previousCursor).toBeNull();const last=(await(await transport(url+'?cursor='+encodeURIComponent(remote.nextCursor))).json());expect(last.previousCursor).toBe(remote.revision+':0');expect(last.pageNumber).toBe(2);expect(last.pageCount).toBe(2);discussionPageButton(w,'上一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 1 / 2 页'),'discussion back to first page');expect(w.document.querySelector('#discussion-comments').textContent).toContain('跨页问题');expect(w.document.querySelector('#discussion-reply-label').textContent).toBe(target);expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('来回翻页还要保留的回复');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(31);expect(w.dianliangState.activeId).toBe(active);
},15000);
it('allows returning from a notification-focused later discussion page without marking other replies read',async()=>{
 const {w}=await manyReplyUI();click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'focused pagination inbox');w.document.querySelector('[data-received-reply]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('对应回复已标记已读'),'focused pagination read');expect(w.document.querySelector('#discussion-status').textContent).toContain('第 2 / 2 页');input(w,'#tutorial-discussion-form [name="text"]','从通知返回前文的草稿');discussionPageButton(w,'回到第一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 1 / 2 页'),'focused discussion first page');expect(w.document.querySelector('[data-discussion-focus]')).toBeNull();expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('从通知返回前文的草稿');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(30);
},15000);
it('recovers a stale previous discussion cursor at the first page while retaining input',async()=>{
 const {w,url,tutorial}=await manyReplyUI();click(w,'nav:atlas');await openDiscussionFromSearch(w);discussionPageButton(w,'下一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'stale back page');input(w,'#tutorial-discussion-form [name="text"]','讨论变动后也保留');expect((await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'翻页时新增的问题',tutorialVersion:tutorial.version,parentId:null,requestId:'changed-back-page',consent:true})})).status).toBe(201);discussionPageButton(w,'上一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('讨论内容或排序已有变化'),'stale previous cursor rejected');[...w.document.querySelectorAll('#discussion-comments button')].find(b=>b.textContent==='重新读取讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 1 / 2 页'),'stale back first page recovery');expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('讨论变动后也保留');expect(w.document.querySelector('#discussion-status').textContent).toContain('共 33 条');
},15000);
it('does not reopen a held previous discussion page after its dialog is closed',async()=>{
 const {w,url}=await manyReplyUI();click(w,'nav:atlas');await openDiscussionFromSearch(w);discussionPageButton(w,'下一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('第 2 / 2 页'),'held previous page fixture');const current=(await(await transport(url)).json()),request=url+'?cursor='+encodeURIComponent(current.revision+':0')+'&replyTo=&focus=',held=holdResponse(w,request);discussionPageButton(w,'上一页讨论').click();await held.wait();click(w,'dialog-close');held.release();await new Promise(r=>setTimeout(r,60));expect(w.document.querySelector('#tutorial-discussion-form')).toBeNull();expect(w.document.querySelector('#dialogs').textContent).toBe('');
},15000);
it('retries the original cross-page reply after a failed focus read and marks it read only after it renders',async()=>{
 const {w,url}=await manyReplyUI(),active=w.dianliangState.activeId;click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'cross page inbox');const inbox=(await(await transport('/api/review-received-replies')).json()),expected=inbox.replies[0];let failed=false;w.fetch=async(path,options)=>{if(path.startsWith(url+'?')&&!failed){failed=true;throw new TypeError('First cross page read failed')}return transport(path,options)};w.document.querySelector('[data-received-reply]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('First cross page read failed'),'first focus failure');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(31);input(w,'#tutorial-discussion-form [name="text"]','重试时也保留的草稿');[...w.document.querySelectorAll('#discussion-comments button')].find(b=>b.textContent==='重新读取讨论').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('对应回复已标记已读'),'focus retry read confirmed');expect(w.document.querySelector('[data-discussion-focus]').textContent).toContain(expected.text);expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('重试时也保留的草稿');const after=(await(await transport('/api/review-received-replies')).json());expect(after.unreadCount).toBe(30);expect(after.replies.find(e=>e.id===expected.id).unread).toBe(false);expect(w.dianliangState.activeId).toBe(active);
});
it('retries the same discussion page after a transport failure without marking a reply read',async()=>{
 const {w,url}=await manyReplyUI();click(w,'nav:atlas');await openDiscussionFromSearch(w);input(w,'#tutorial-discussion-form [name="text"]','分页重试不清空输入');let failed=false;w.fetch=async(path,options)=>{if(path.startsWith(url+'?')&&new URL(path,'http://localhost').searchParams.get('cursor')&&!failed){failed=true;throw new TypeError('Second page disconnected')}return transport(path,options)};[...w.document.querySelectorAll('#discussion-comments button')].find(b=>b.textContent==='下一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('Second page disconnected'),'failed second page');[...w.document.querySelectorAll('#discussion-comments button')].find(b=>b.textContent==='重新读取讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('本页 2'),'same page retry');expect(w.document.querySelector('#discussion-comments').textContent).toContain('跨页回答 30');expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('分页重试不清空输入');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(31);
});
it('allows replying and typing while an already rendered reply read acknowledgement is held',async()=>{
 const {tutorial,authorCookie}=await peerTutorial(),w=await startedUI(),active=w.dianliangState.activeId,url='/api/review-tutorial-discussions/'+tutorial.id,q=(await(await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'慢回执测试问题',tutorialVersion:tutorial.version,parentId:null,requestId:'slow-read-parent',consent:true})})).json()).comment;await transport(url,{method:'POST',headers:{Cookie:authorCookie,'Content-Type':'application/json'},body:JSON.stringify({text:'慢回执测试回答',tutorialVersion:tutorial.version,parentId:q.id,requestId:'slow-read-answer',consent:true})});click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'slow read inbox');const held=holdResponse(w,'/api/review-received-replies/read','POST');w.document.querySelector('[data-received-reply]').click();await held.wait();w.document.querySelector('[data-discussion-focus] [data-discussion-reply]').click();expect(w.document.querySelector('#discussion-reply-label').textContent).toContain('慢回执测试回答');input(w,'#tutorial-discussion-form [name="text"]','回执等待时写的回复');expect(w.document.querySelector('#tutorial-discussion-form button[type="submit"]').disabled).toBe(false);expect(w.document.querySelector('#discussion-reply-cancel').hidden).toBe(false);held.release();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('对应回复已标记已读'),'slow receipt finished');expect(w.document.querySelector('#tutorial-discussion-form [name="text"]').value).toBe('回执等待时写的回复');expect(w.dianliangState.activeId).toBe(active);
});
it('keeps discussion pagination usable during a held read acknowledgement and discards its late page feedback',async()=>{
 const {w,url}=await manyReplyUI();click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'slow pagination inbox');const held=holdResponse(w,'/api/review-received-replies/read','POST');w.document.querySelector('[data-received-reply]').click();await held.wait();input(w,'#tutorial-discussion-form [name="text"]','翻页期间的草稿');
 // A successful publish reloads the first discussion page while the earlier
 // read receipt is still held; its next-page button must already be wired.
 const form=w.document.querySelector('#tutorial-discussion-form');form.elements.namedItem('consent').checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#discussion-status').textContent.includes('本页 30')&&!form.querySelector('button[type="submit"]').disabled,'discussion reload while read held');[...w.document.querySelectorAll('#discussion-comments button')].find(b=>b.textContent==='下一页讨论').click();await until(()=>w.document.querySelector('#discussion-status').textContent.includes('本页 3 条'),'next page while read held');const before=w.document.querySelector('#discussion-status').textContent;held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#discussion-status').textContent).toBe(before);expect(w.document.querySelector('[data-reply-read-retry]')).toBeNull();
});
it('keeps the unread inbox selection on return and removes only the reply actually read',async()=>{
 const {w}=await manyReplyUI();click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'scope inbox loaded');const select=w.document.querySelector('#received-replies-scope');select.value='unread';select.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('[data-received-reply]'),'unread scope loaded');w.document.querySelector('[data-received-reply]').click();await until(()=>w.document.querySelector('#discussion-status')?.textContent.includes('对应回复已标记已读'),'scope reply read');click(w,'dialog-close');click(w,'review-received-replies');await until(()=>w.document.querySelector('#received-replies-status').textContent.includes('收到 30 条'),'unread return');expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');expect(w.document.querySelector('#received-replies-results').textContent).not.toContain('已读 ·');const filter=w.document.querySelector('#received-replies-scope');filter.value='all';filter.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('#received-replies-status').textContent.includes('收到 31 条'),'all scope return');expect((await(await transport('/api/review-received-replies')).json()).unreadCount).toBe(30);
});
it('does not replace the unread scope with an older held all-replies response',async()=>{
 const {w}=await manyReplyUI();const first=(await(await transport('/api/review-received-replies')).json()).replies[0];await transport('/api/review-received-replies/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tutorialId:first.tutorialId,replyId:first.id,digest:first.digest})});click(w,'nav:contribute');const held=holdResponse(w,'/api/review-received-replies');click(w,'review-received-replies');await held.wait();const filter=w.document.querySelector('#received-replies-scope');filter.value='unread';filter.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('#received-replies-status').textContent.includes('收到 30 条'),'new unread request');const before=w.document.querySelector('#received-replies-results').innerHTML;held.release();await new Promise(r=>setTimeout(r,50));expect(w.document.querySelector('#received-replies-scope').value).toBe('unread');expect(w.document.querySelector('#received-replies-results').innerHTML).toBe(before);expect(w.document.querySelector('#received-replies-status').textContent).toContain('收到 30 条');
});
it('shows no unread replies without implying that the already read discussions are gone',async()=>{
 const {w}=await manyReplyUI(),all=(await(await transport('/api/review-received-replies?limit=50')).json());for(const e of all.replies)expect((await transport('/api/review-received-replies/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tutorialId:e.tutorialId,replyId:e.id,digest:e.digest})})).status).toBe(200);click(w,'nav:contribute');click(w,'review-received-replies');await until(()=>w.document.querySelector('[data-received-reply]'),'read replies still present');const filter=w.document.querySelector('#received-replies-scope');filter.value='unread';filter.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('#received-replies-results').textContent.includes('没有未读回复'),'unread empty wording');expect(w.document.querySelector('#received-replies-status').textContent).toContain('未读 0');filter.value='all';filter.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>w.document.querySelector('#received-replies-status').textContent.includes('收到 31 条'),'read history present');expect(w.document.querySelector('[data-received-reply]')).not.toBeNull();
});
function holdResponse(w,url,method='GET'){
 let release,captured=false;const gate=new Promise(resolve=>release=resolve);
 w.fetch=async(path,options)=>{const result=await transport(path,options);if(path===url&&(options?.method||'GET')===method&&!captured){captured=true;await gate}return result};
 return {release,wait:()=>until(()=>captured,'held '+method+' '+url)};
}
async function switchUser(w,name,register=true){
 if(!w.document.querySelector('[data-action="nav:account"]'))click(w,'group:space');click(w,'nav:account');click(w,'logout');await until(()=>w.document.querySelector('#auth-form'),'logout finished');if(register)click(w,'auth-mode:register');
 input(w,'#auth-name',name);input(w,'#auth-password','test-only-2026');w.document.querySelector('#auth-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>w.dianliangState.user?.name===name&&w.document.querySelector('[data-action="start-candidate"]'),'new login');
 await until(async()=>{const state=(await(await transport('/api/action-state')).json()).state;return state?.data},'new account action connection');
}
it('ignores a held old-method read after registering another account without opening a stale private dialog',async()=>{
 const w=await newMethodUI(),m=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法'),held=holdResponse(w,'/api/review-method-publications');
 click(w,'share-method:eq:'+m.id);await held.wait();await switchUser(w,'late-reader-b');held.release();await new Promise(resolve=>setTimeout(resolve,80));
 expect(w.dianliangState.user.name).toBe('late-reader-b');expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.querySelector('#main-content').textContent).not.toContain('界面保存的方法');expect((await(await transport('/api/tutorials')).json()).tutorials).toHaveLength(0);
});
it('invalidates a held request even when logging back into the same account',async()=>{
 const w=await newMethodUI(),m=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法'),held=holdResponse(w,'/api/review-method-publications');
 click(w,'share-method:eq:'+m.id);await held.wait();await switchUser(w,'recovery-ui',false);held.release();await new Promise(resolve=>setTimeout(resolve,80));
 expect(w.dianliangState.user.name).toBe('recovery-ui');expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.querySelector('[data-action="start-candidate"]')).not.toBeNull();
});
it('leaves an already committed old-account method in its account while suppressing its late success response in the new account',async()=>{
 const w=await newMethodUI(),m=w.dianliangState.nodes.find(n=>n.id==='eq').methods.find(m=>m.title==='界面保存的方法');
 click(w,'edit-method:eq:'+m.id);input(w,'#method-form [name="content"]','旧账号已经提交的第二版内容。');w.document.querySelector('#method-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>w.document.querySelector('#review-method-publish-form'),'pending method review');
 const held=holdResponse(w,'/api/review-method-publications','POST');w.document.querySelector('#review-method-publish-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await held.wait();click(w,'dialog-close');await switchUser(w,'late-writer-b');held.release();await new Promise(resolve=>setTimeout(resolve,80));
 expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.document.querySelector('#toast').hidden).toBe(true);expect((await(await transport('/api/tutorials')).json()).tutorials).toHaveLength(0);
 await switchUser(w,'recovery-ui',false);expect((await(await transport('/api/tutorials')).json()).tutorials[0].method).toBe('旧账号已经提交的第二版内容。');
});
it('discards a private-target review from an earlier login session even for the same owner',async()=>{
 const w=await startedUI();click(w,'group:knowledge');click(w,'nav:contribute');click(w,'new-node');input(w,'#node-form [name="title"]','旧会话的私人目标');input(w,'#node-form [name="goal"]','只属于原会话账号的完整目标。');input(w,'#node-form [name="five"]','先写一行。');w.document.querySelector('#node-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const n=w.dianliangState.nodes.find(n=>n.title==='旧会话的私人目标');
 const held=holdResponse(w,'/api/review-private-targets');click(w,'review-private-target:'+n.id);await held.wait();await switchUser(w,'recovery-ui',false);held.release();await new Promise(resolve=>setTimeout(resolve,80));expect(w.document.querySelector('#dialogs').textContent).toBe('');expect(w.dianliangState.nodes.find(x=>x.id===n.id).goal).toBe('只属于原会话账号的完整目标。');
});
it('does not reopen an earlier practice review after the same owner logs in again',async()=>{
 const {w,eventId}=await endedPeerUI(),held=holdResponse(w,'/api/review-practices');click(w,'dialog-close');click(w,'group:knowledge');click(w,'nav:contribute');click(w,'review-practice-open:'+eventId);await held.wait();await switchUser(w,'recovery-ui',false);held.release();await new Promise(resolve=>setTimeout(resolve,80));expect(w.document.querySelector('#review-practice-form')).toBeNull();expect(w.dianliangState.events.some(e=>e.id===eventId)).toBe(true);
});
it('ignores a public-method load from a previous session instead of filling the current session cache',async()=>{
 await peerTutorial();const w=await startedUI();click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');const held=holdResponse(w,'/api/review-shared-methods?nodeId=eq');click(w,'review-shared-load:eq');await held.wait();await switchUser(w,'recovery-ui',false);held.release();await new Promise(resolve=>setTimeout(resolve,80));click(w,'group:knowledge');click(w,'nav:atlas');click(w,'node:eq');expect(w.document.querySelector('#node-detail').textContent).not.toContain('他人的代回方法');
});
