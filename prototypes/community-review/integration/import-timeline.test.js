const fs = require('node:fs'), path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
let windows = [];
const source = () => fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function app(raw) {
  const html = source(), w = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() }).window;
  windows.push(w); if (raw) w.localStorage.setItem('dianliang-local-prototype-v1', raw);
  w.HTMLElement.prototype.checkVisibility = function () { return !this.hidden; };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1] + '\nwindow.testImport=validateImport;window.testSeed=()=>seed();');
  return w;
}
const event = (id, start, end) => ({ id, name: id, startedAt: start, endedAt: end, segments: [{ start, end }], notes: [], steps: [], stepDone: {}, draft: '' });
const envelope = (events, activeId = null) => ({ format: 'dianliang-local-backup/v1', data: { mode: 'local-simulation', events, activeId } });
afterEach(() => { windows.forEach(w => w.close()); windows = []; });
const invalid = [
  ['end before event start', () => envelope([event('a', 10, 9)])],
  ['segment before event start', () => { const e = event('a', 10, 20); e.segments[0].start = 9; return envelope([e]); }],
  ['segment after event end', () => { const e = event('a', 10, 20); e.segments[0].end = 21; return envelope([e]); }],
  ['unordered segments', () => { const e = event('a', 0, 20); e.segments = [{ start: 10, end: 15 }, { start: 2, end: 5 }]; return envelope([e]); }],
  ['overlap within event', () => { const e = event('a', 0, 20); e.segments = [{ start: 0, end: 10 }, { start: 5, end: 15 }]; return envelope([e]); }],
  ['overlap across events', () => envelope([event('a', 0, 10), event('b', 5, 15)])],
  ['two open clocks', () => envelope([event('a', 0, null), event('b', 1, null)], 'a')],
  ['active event without open segment', () => envelope([event('a', 0, 10)], 'a')],
  ['unknown active event', () => envelope([event('a', 0, 10)], 'missing')],
  ['open clock after ended event', () => { const e = event('a', 0, 10); e.segments[0].end = null; return envelope([e], 'a'); }],
  ['self parent cycle', () => { const e = event('a', 0, 0); e.parentId = 'a'; return envelope([e]); }],
  ['multi-event parent cycle', () => { const a = event('a', 0, 1), b = event('b', 1, 2); a.parentId = 'b'; b.parentId = 'a'; return envelope([a,b]); }]
];
it.each(invalid)('rejects %s before accepting backup data', (label, make) => {
  const w = app(), before = JSON.stringify(w.dianliangState);
  expect(() => w.testImport(make())).toThrow();
  expect(JSON.stringify(w.dianliangState)).toBe(before);
});
it('preserves an invalid startup cache instead of silently freezing extra open clocks', () => {
  const w = app(), state = w.testSeed(); state.events = [event('a', 0, null), event('b', 1, null)]; state.activeId = 'a';
  const raw = JSON.stringify(state), restored = app(raw);
  expect(restored.localStorage.getItem('dianliang-local-prototype-v1')).toBe(raw);
  expect(restored.document.querySelector('#storage-warning').hidden).toBe(false);
});
it('accepts adjacent parent and child activity while only one clock remains open', () => {
  const w = app(), parent = event('parent', 0, null), child = event('child', 10, null);
  parent.segments = [{ start: 0, end: 10 }]; child.parentId = parent.id;
  const backup = envelope([parent, child], child.id);
  expect(w.testImport(backup).events).toHaveLength(2);
});
it('accepts a deep event chain without introducing a user-visible nesting limit', () => {
  const w = app(), events = Array.from({ length: 10000 }, (_, i) => ({ ...event(String(i), 0, 0), ...(i ? { parentId: String(i-1) } : {}) }));
  expect(w.testImport(envelope(events)).events).toHaveLength(10000);
});
