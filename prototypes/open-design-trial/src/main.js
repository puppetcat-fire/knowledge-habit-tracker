// 引导：状态容器 + 路由 + 动作层 + 重绘循环。视图只读 state、只调 actions。
import { createStore, STORAGE_KEY } from './store.js';
import { parseHash, navigate } from './router.js';
import { preserveFocus, toast } from './ui/dom.js';
import { renderShell } from './ui/shell.js';
import { openReport } from './ui/report-dialog.js';
import * as eventDomain from './domain/events.js';
import * as habitDomain from './domain/habits.js';
import * as knowledgeDomain from './domain/knowledge.js';
import { refreshFormation } from './domain/habits.js';

import { renderAuth } from './ui/views/auth.js';
import { renderTimer } from './ui/views/timer.js';
import { renderHabits } from './ui/views/habits.js';
import { renderHabitDetail } from './ui/views/habit-detail.js';
import { renderRecords } from './ui/views/records.js';
import { renderEventDetail } from './ui/views/event-detail.js';
import { renderAtlas } from './ui/views/atlas.js';
import { renderNodeDetail } from './ui/views/node-detail.js';
import { renderProfile } from './ui/views/profile.js';

if (new URLSearchParams(location.search).has('reset')) {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 隐私模式下可能不可用 */ }
}

const store = createStore();
let route = parseHash(location.hash);

const VIEWS = {
  timer: renderTimer,
  habits: renderHabits,
  'habit-detail': renderHabitDetail,
  records: renderRecords,
  'event-detail': renderEventDetail,
  atlas: renderAtlas,
  'node-detail': renderNodeDetail,
  profile: renderProfile
};

const TITLES = {
  timer: '计时',
  habits: '习惯',
  'habit-detail': '习惯详情',
  records: '事件记录',
  'event-detail': '事件详情',
  atlas: '知识图谱',
  'node-detail': '节点详情',
  profile: '个人主页'
};

const actions = {
  navigate(name, params) {
    document.body.dataset.navOpen = 'false';
    navigate(name, params);
  },
  setUi(patch) {
    store.commit((state) => Object.assign(state.ui, patch));
  },
  rerender() {
    render();
  },
  toggleGroup(groupId) {
    store.commit((state) => {
      const list = state.ui.collapsedGroups;
      state.ui.collapsedGroups = list.includes(groupId) ? list.filter((id) => id !== groupId) : [...list, groupId];
    });
  },
  toggleSidebar() {
    store.commit((state) => { state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed; });
  },

  /* ---------- 计时 ---------- */
  startEvent({ name, habitId = null, knowledge = null }) {
    if (!String(name || '').trim()) {
      toast('先写要做什么，或点一个候选');
      return null;
    }
    let created = null;
    store.commit((state) => {
      created = eventDomain.startEvent(state, { name, habitId, knowledge });
    });
    return created;
  },
  switchTo(eventId) {
    store.commit((state) => { eventDomain.switchTo(state, eventId); });
  },
  pauseActive() {
    let paused = null;
    store.commit((state) => { paused = eventDomain.pauseActive(state); });
    toast(paused ? '已暂停，未结束的记录还在列表里' : '当前没有在走的计时');
  },
  setRepeatedNote(name, text) {
    store.silent((state) => { eventDomain.setRepeatedNote(state, name, text); });
  },
  saveRepeatedNote(name, text) {
    store.commit((state) => { eventDomain.setRepeatedNote(state, name, text); });
    toast('重复笔记已保存，下次同名事件会带上');
  },
  endEvent(eventId) {
    let ended = null;
    store.commit((state) => {
      const event = eventDomain.findEvent(state, eventId);
      ended = eventDomain.endEvent(state, eventId);
      if (ended && event && event.knowledge && event.knowledge.nodeId) {
        knowledgeDomain.ensureDraft(state, {
          nodeId: event.knowledge.nodeId,
          methodId: event.knowledge.methodId,
          eventId: event.id
        });
      }
    });
    if (ended) openReport(store.get(), ended, actions);
  },
  renameEvent(eventId, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      toast('名称不能为空');
      return;
    }
    store.commit((state) => { eventDomain.renameEvent(state, eventId, trimmed); });
    toast('已改正这条记录的名称');
  },
  setDraftNote(eventId, text) {
    store.silent((state) => { eventDomain.setDraftNote(state, eventId, text); });
  },
  saveNote(eventId) {
    let saved = null;
    store.commit((state) => { saved = eventDomain.saveNote(state, eventId); });
    toast(saved ? '笔记已保存到本次记录' : '先写一句再保存');
  },
  removeNote(eventId, noteId) {
    store.commit((state) => { eventDomain.removeNote(state, eventId, noteId); });
  },
  addStep(name, text) {
    let step = null;
    store.commit((state) => { step = eventDomain.addStep(state, name, text); });
    if (!step) toast('步骤内容不能为空');
  },
  renameStep(name, stepId, text) {
    store.commit((state) => { eventDomain.renameStep(state, name, stepId, text); });
  },
  removeStep(name, stepId) {
    store.commit((state) => { eventDomain.removeStep(state, name, stepId); });
  },
  toggleStep(eventId, stepId, done) {
    store.commit((state) => { eventDomain.toggleStep(state, eventId, stepId, done); });
  },
  startSubtask(parentId, stepId) {
    store.commit((state) => { eventDomain.startSubtask(state, parentId, stepId); });
  },

  /* ---------- 习惯 ---------- */
  createHabit(name) {
    let habit = null;
    store.commit((state) => { habit = habitDomain.createHabit(state, name); });
    if (habit) toast(`已新建习惯「${habit.name}」，现在只有它在养成中`);
    else toast('习惯名称不能为空');
    return habit;
  },
  switchHabit(habitId) {
    let ok = false;
    store.commit((state) => { ok = habitDomain.switchHabit(state, habitId); });
    if (ok) toast('已切换养成目标；计时状态没有改变');
    else toast('已养成的习惯不再作为养成目标');
  },
  renameHabit(habitId, name) {
    let ok = false;
    store.commit((state) => { ok = habitDomain.renameHabit(state, habitId, name); });
    if (ok) toast('名称已改，习惯 ID 与历史记录不变');
  },

  /* ---------- 知识 ---------- */
  confirmLightup(lightupId, visibility = 'private') {
    store.commit((state) => { knowledgeDomain.confirmLightup(state, lightupId, visibility); });
    toast(visibility === 'public' ? '已确认点亮并公开' : '已确认点亮（仅自己可见）');
  },
  removeLightup(lightupId) {
    store.commit((state) => { knowledgeDomain.removeLightup(state, lightupId); });
  },
  startPractice(nodeId, methodId) {
    const state = store.get();
    const node = knowledgeDomain.node(state, nodeId);
    if (!node) return;
    const method = knowledgeDomain.methodOf(state, methodId) || knowledgeDomain.methodsOf(state, nodeId)[0] || null;
    store.commit((current) => {
      eventDomain.startEvent(current, {
        name: node.name,
        knowledge: {
          treeId: knowledgeDomain.tree(current).id,
          nodeId,
          methodId: method ? method.id : null,
          methodVersion: method ? method.version : null,
          methodTitle: method ? method.title : null
        }
      });
    });
    actions.navigate('timer');
  },
  addMethod(nodeId, payload) {
    let method = null;
    store.commit((state) => { method = knowledgeDomain.addMethod(state, { nodeId, ...payload }); });
    if (method) toast(`已添加方法「${method.title}」，默认仅自己可见`);
    else toast('方法名称不能为空');
    return method;
  },
  addMethodVersion(methodId, payload) {
    let method = null;
    store.commit((state) => { method = knowledgeDomain.addMethodVersion(state, methodId, payload); });
    if (method) toast(`已更新为 v${method.version}，旧版本保留在历史里`);
    else toast('没有找到这个方法');
    return method;
  },

  /* ---------- 记录筛选 ---------- */
  setRecordsRange(range) {
    store.commit((state) => { state.ui.recordsRange = range; });
  },
  setRecordsDate(date) {
    store.commit((state) => { state.ui.recordsRange = 'date'; state.ui.recordsDate = date; });
  },

  /* ---------- 账号 ---------- */
  register(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      toast('先填名字');
      return;
    }
    store.commit((state) => {
      state.account = { id: 'acc-' + Math.random().toString(36).slice(2, 10), name: trimmed, createdAt: Date.now() };
      refreshFormation(state, Date.now());
    });
    actions.navigate('timer');
  },
  login(name) {
    actions.register(name);
  },
  logout() {
    store.commit((state) => { state.account = null; });
  },
  resetAll() {
    store.reset();
    toast('已重置为演示数据');
    actions.navigate('timer');
  }
};

function renderView(currentRoute, state) {
  const view = VIEWS[currentRoute.name] || renderTimer;
  return view({ state, route: currentRoute, actions });
}

function render() {
  const state = store.get();
  const app = document.getElementById('app');
  if (!app) return;
  const loggedIn = Boolean(state.account);
  const content = loggedIn
    ? renderShell(state, route, actions, renderView(route, state))
    : renderAuth({ state, route, actions });
  preserveFocus(() => app.replaceChildren(content));
  document.title = loggedIn ? `${TITLES[route.name] || '点亮'} · 点亮试作` : '点亮 · 试作';
}

function formatTick(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function tick() {
  const state = store.get();
  const active = eventDomain.activeEvent(state);
  document.querySelectorAll('[data-role="clock-value"]').forEach((node) => {
    node.textContent = formatTick(active ? eventDomain.durationOf(active, Date.now()) : 0);
  });
  document.querySelectorAll('[data-role="clock-label"]').forEach((node) => {
    node.textContent = active ? active.name : '空闲';
  });
  document.querySelectorAll('[data-role="live-duration"]').forEach((node) => {
    const id = node.getAttribute('data-event-id');
    const event = state.events.find((item) => item.id === id);
    if (event) node.textContent = formatTick(eventDomain.durationOf(event, Date.now()));
  });
}

window.addEventListener('hashchange', () => {
  route = parseHash(location.hash);
  render();
});

store.subscribe(() => {
  route = parseHash(location.hash);
  render();
});

setInterval(tick, 1000);
render();

// 测试与调试入口（jsdom 集成测试也用它）
globalThis.__trial = { store, actions, getRoute: () => route, render };
