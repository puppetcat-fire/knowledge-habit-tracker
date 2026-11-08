const fs = require('node:fs'), path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
let window;
function mount(events = [], formedAt = null) {
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  window = new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() }).window;
  window.HTMLElement.prototype.checkVisibility = function () { return !this.hidden; };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  window.eval(script + `\nwindow.installFixture=(events,formedAt)=>{S=seed();S.user={id:'test',name:'时间边界测试',example:true};S.events=events;S.habits[0].formedAt=formedAt;validateSavedState(S);normalize();render();};`);
  window.installFixture(events, formedAt);
  return window.document;
}
const event = (id, endedAt) => ({ id, name: id, startedAt: endedAt === null ? 1 : -1000, endedAt,
  segments: [{ start: endedAt === null ? 1 : -1000, end: endedAt === null ? 2 : endedAt }], steps: [], repeatText: '', stepDone: {}, draft: '', notes: [], source: 'test', habitId: 'h-read' });
function click(action) { const el = window.document.querySelector('[data-action="' + action + '"]'); if (!el) throw Error('Missing ' + action); el.click(); }
afterEach(() => window?.close());
it('keeps a zero-timestamp ended event out of unfinished items and shows it in all history', () => {
  const doc = mount([event('零时刻结束', 0), event('暂停待续', null)]);
  expect([...doc.querySelectorAll('[data-event-id]')].map(e => e.dataset.eventId)).toEqual(['暂停待续']);
  click('nav:records'); click('range:all');
  expect(doc.querySelector('[data-record-id="零时刻结束"]')).not.toBeNull();
  expect(doc.querySelector('[data-record-id="暂停待续"]')).toBeNull();
});
it('opens historical detail for an event ended at timestamp zero', () => {
  const doc = mount([event('零时刻结束', 0)]); click('nav:records'); click('range:all');
  click('event-detail:零时刻结束');
  expect(doc.querySelector('[data-action="delete-event:零时刻结束"]')).not.toBeNull();
  expect(doc.querySelector('.list').textContent).not.toContain('正在计时');
});
it('preserves a habit formed at timestamp zero as formed', () => {
  const doc = mount([], 0); click('nav:habits');
  expect(doc.querySelector('[data-od-id="current-habit"] .tag').textContent).toBe('已养成');
  expect(doc.querySelector('[data-action="appreciate"]')).toBeNull();
  click('nav:profile'); click('nav:account'); expect(doc.querySelector('[data-action="appreciate"]')).not.toBeNull();
});
it('includes zero-timestamp ended events in the personal practice timeline', () => {
  const doc = mount([event('零时刻结束', 0), event('尚未结束', null)]); click('nav:profile');
  expect(doc.querySelector('.timeline').textContent).toContain('零时刻结束');
  expect(doc.querySelector('.timeline').textContent).not.toContain('尚未结束');
});
it('does not change a parent already ended at zero when its unfinished child is finished', () => {
  const parent = event('父事件', 0); parent.steps = [{ id: 'step', text: '子步骤' }];
  const child = event('子事件', null); child.startedAt = 1; child.segments = [{ start: 1, end: 2 }];
  child.parentId = parent.id; child.parentStepId = 'step';
  mount([parent, child]); click('finish:子事件');
  const stored = window.dianliangState.events;
  expect(stored.find(e => e.id === parent.id).endedAt).toBe(0);
  expect(stored.find(e => e.id === parent.id).stepDone).toEqual({});
  expect(stored.find(e => e.id === child.id).endedAt).not.toBeNull();
});
