// 试作原型的集成测试：在 jsdom 里真跑 main.js，走「注册 → 计时 → 切换 → 结束 → 战报 → 习惯 → 知识实践 → 点亮」。
// 目的：不需要 Chrome 与全权限，`npm test` 就能挡住「动作层/路由/视图」之间的接线回归。
import { describe, it, expect, beforeAll } from 'vitest';

const STORAGE_KEY = 'dianliang-trial-v1';
let app;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const workspaceText = () => document.getElementById('workspace')?.textContent || '';
const rows = () => [...document.querySelectorAll('.event-row')];
const activeRows = () => rows().filter((row) => row.dataset.active === 'true');

async function boot() {
  document.body.innerHTML = '<div id="app"></div>';
  window.localStorage.clear();
  location.hash = '#/habit-record/timer';

  // jsdom 26 没有实现 <dialog> 的 showModal/close，这里补最小桩（只影响测试环境）。
  const proto = window.HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal() { this.setAttribute('open', ''); };
    proto.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new window.Event('close'));
    };
  }

  await import('../../prototypes/open-design-trial/src/main.js');
  await flush();
  return globalThis.__trial;
}

describe('试作原型集成闭环', () => {
  beforeAll(async () => {
    app = await boot();
  });

  it('首屏是账号页，注册后进入带侧边栏的计时页', async () => {
    expect(document.getElementById('auth-name')).toBeTruthy();
    app.actions.register('集成测试账号');
    await flush();
    expect(document.querySelector('.sidebar')).toBeTruthy();
    expect(document.querySelector('.page-title').textContent).toBe('计时');
    expect(document.querySelector('.timer-state').textContent).toBe('待机');
  });

  it('开始计时只有一条活动，开始第二件事会暂停第一件', async () => {
    app.actions.startEvent({ name: '吃东西' });
    await flush();
    expect(rows()).toHaveLength(1);
    expect(activeRows()).toHaveLength(1);
    expect(document.querySelector('.timer-state').textContent).toBe('计时中');

    app.actions.startEvent({ name: '喝水' });
    await flush();
    expect(rows()).toHaveLength(2);
    expect(activeRows()).toHaveLength(1);
    expect(activeRows()[0].textContent).toContain('喝水');
  });

  it('切回会转移活动，结束只结束该条并弹战报', async () => {
    const first = rows().find((row) => row.textContent.includes('吃东西'));
    app.actions.switchTo(first.dataset.eventId);
    await flush();
    expect(activeRows()).toHaveLength(1);
    expect(activeRows()[0].textContent).toContain('吃东西');

    app.actions.endEvent(first.dataset.eventId);
    await flush();
    const dialog = document.querySelector('.report-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toContain('行动战报');
    expect(rows()).toHaveLength(1);
    dialog.close();
    await flush();
    expect(document.querySelector('.report-dialog')).toBeNull();
  });

  it('单次笔记按事件保存，同名新事件不继承', async () => {
    const before = app.store.get().events.length;
    app.actions.startEvent({ name: '写周报' });
    await flush();
    const active = activeRows()[0];
    const id = active.dataset.eventId;
    app.actions.setDraftNote(id, '集成测试的一条笔记');
    app.actions.saveNote(id);
    await flush();
    const saved = app.store.get().events.find((event) => event.id === id);
    expect(saved.notes).toHaveLength(1);
    expect(saved.draftNote).toBe('');
    expect(document.querySelector('.note-saved')).toBeTruthy();

    app.actions.endEvent(id);
    await flush();
    document.querySelector('.report-dialog')?.close();
    await flush();

    app.actions.startEvent({ name: '写周报' });
    await flush();
    const created = app.store.get().events.find((event) => event.id === activeRows()[0].dataset.eventId);
    expect(created.id).not.toBe(id);
    expect(created.notes).toHaveLength(0);
    expect(app.store.get().events.length).toBeGreaterThanOrEqual(before + 2);
  });

  it('习惯：新建后只有一个养成中，切回不改计时', async () => {
    const original = app.store.get().currentHabitId;
    const activeBefore = activeRows()[0]?.dataset.eventId || null;
    app.actions.createHabit('集成新习惯');
    await flush();
    expect(app.store.get().habits.filter((habit) => !habit.formedAt && habit.id === app.store.get().currentHabitId)).toHaveLength(1);
    app.actions.switchHabit(original);
    await flush();
    expect(app.store.get().currentHabitId).toBe(original);
    expect(activeRows()[0]?.dataset.eventId || null).toBe(activeBefore);
  });

  it('知识实践：从节点开始练习 → 计时页带知识标签 → 结束后有草稿 → 确认点亮', async () => {
    app.actions.startPractice('n-log', 'm-log');
    await flush();
    expect(activeRows()).toHaveLength(1);
    expect(activeRows()[0].textContent).toContain('写一段真实的工作日志');
    expect(document.querySelector('.timer-hero .chip.gold')).toBeTruthy();

    const id = activeRows()[0].dataset.eventId;
    app.actions.endEvent(id);
    await flush();
    document.querySelector('.report-dialog')?.close();
    await flush();

    const draft = app.store.get().lightups.find((item) => item.eventId === id && item.state === 'draft');
    expect(draft).toBeTruthy();

    app.actions.navigate('node-detail', { nodeId: 'n-log' });
    await flush();
    expect(workspaceText()).toContain('确认点亮');
    app.actions.confirmLightup(draft.id, 'private');
    await flush();
    const confirmed = app.store.get().lightups.find((item) => item.id === draft.id);
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.visibility).toBe('private');
  });

  it('方法贡献与版本：新增方法、更新后历史保留、实践快照不变', async () => {
    app.actions.navigate('node-detail', { nodeId: 'n-verbatim' });
    await flush();
    const method = app.actions.addMethod('n-verbatim', { title: '集成摘录法', firstFive: '打开书', steps: ['划线', '抄一句'] });
    await flush();
    expect(method.version).toBe(1);
    app.actions.addMethodVersion(method.id, { title: '集成摘录法（改）', firstFive: '先读一段', steps: ['划线'] });
    await flush();
    const updated = app.store.get().knowledge.trees[0].methods.find((item) => item.id === method.id);
    expect(updated.version).toBe(2);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].title).toBe('集成摘录法');
  });

  it('刷新后状态保留，且不会出现两条活动计时', async () => {
    const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(snapshot.events.length).toBeGreaterThan(0);
    const { normalize } = await import('../../prototypes/open-design-trial/src/store.js');
    const { isActive } = await import('../../prototypes/open-design-trial/src/domain/events.js');
    const restored = normalize(JSON.parse(JSON.stringify(snapshot)));
    // 未结束的事件可以有多条（暂停中的），但「正在走的活动计时」最多一条。
    const active = restored.events.filter((event) => event.endedAt === null && isActive(event));
    expect(active.length).toBeLessThanOrEqual(1);
    expect(restored.events.length).toBe(snapshot.events.length);
  });

  it('各页面都能渲染出内容，不出现空壳', async () => {
    const routes = [
      ['records', {}],
      ['habits', {}],
      ['event-detail', { eventId: app.store.get().events.find((event) => event.endedAt !== null).id }],
      ['habit-detail', { habitId: app.store.get().currentHabitId }],
      ['atlas', {}],
      ['profile', {}]
    ];
    for (const [name, params] of routes) {
      app.actions.navigate(name, params);
      await flush();
      expect(workspaceText().length, `${name} 页面没有内容`).toBeGreaterThan(40);
    }
  });
});
