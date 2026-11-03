// 状态容器：单一 state + localStorage 持久化 + 订阅重绘。所有写入都过 normalize，保证「最多一条活动计时」。
import { buildSeedState } from './seed.js';
import { refreshFormation } from './domain/habits.js';

export const STORAGE_KEY = 'dianliang-trial-v1';

export function freshState(now = Date.now()) {
  return normalize(buildSeedState(now), now);
}

export function normalize(state, now = Date.now()) {
  if (!state || typeof state !== 'object') return freshState(now);
  state.version = 1;
  state.habits = Array.isArray(state.habits) ? state.habits : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.lightups = Array.isArray(state.lightups) ? state.lightups : [];
  state.stepTemplates = state.stepTemplates && typeof state.stepTemplates === 'object' ? state.stepTemplates : {};
  state.noteTemplates = state.noteTemplates && typeof state.noteTemplates === 'object' ? state.noteTemplates : {};
  state.knowledge = state.knowledge && Array.isArray(state.knowledge.trees) ? state.knowledge : { trees: [] };
  state.ui = state.ui && typeof state.ui === 'object' ? state.ui : {};
  if (!Array.isArray(state.ui.collapsedGroups)) state.ui.collapsedGroups = [];
  if (typeof state.ui.sidebarCollapsed !== 'boolean') state.ui.sidebarCollapsed = false;
  if (!state.ui.recordsRange) state.ui.recordsRange = 'today';
  if (typeof state.ui.recordsDate !== 'string') state.ui.recordsDate = '';
  if (state.currentHabitId && !state.habits.some((habit) => habit.id === state.currentHabitId)) state.currentHabitId = null;
  if (!state.currentHabitId && state.habits.length) {
    state.currentHabitId = state.habits.find((habit) => !habit.formedAt)?.id || state.habits[0].id;
  }

  for (const event of state.events) {
    if (!Array.isArray(event.segments) || !event.segments.length) {
      event.segments = [{ startedAt: event.startedAt ?? now, endedAt: event.endedAt ?? null }];
    }
    if (!Array.isArray(event.notes)) event.notes = [];
    if (!Array.isArray(event.stepDone)) event.stepDone = [];
    if (typeof event.draftNote !== 'string') event.draftNote = '';
    if (event.parentId === undefined) event.parentId = null;
    if (event.parentStepId === undefined) event.parentStepId = null;
    if (event.endedAt !== null && event.endedAt !== undefined) {
      for (const segment of event.segments) {
        if (segment.endedAt === null) segment.endedAt = event.endedAt;
      }
    }
    // 同一事件内分段不重叠：后一段开始时间不早于前一段结束时间
    for (let index = 1; index < event.segments.length; index += 1) {
      const previous = event.segments[index - 1];
      const current = event.segments[index];
      if (previous.endedAt !== null && current.startedAt < previous.endedAt) current.startedAt = previous.endedAt;
    }
  }

  // 全局只允许一条活动计时：保留开始时间最晚的那段，其它在下一段开始处闭合
  const open = [];
  for (const event of state.events) {
    if (event.endedAt !== null) continue;
    const index = event.segments.findIndex((segment) => segment.endedAt === null);
    if (index >= 0) open.push({ event, index });
  }
  open.sort((a, b) => a.event.segments[a.index].startedAt - b.event.segments[b.index].startedAt);
  for (let index = 0; index < open.length - 1; index += 1) {
    const current = open[index];
    const nextStart = open[index + 1].event.segments[open[index + 1].index].startedAt;
    const segment = current.event.segments[current.index];
    segment.endedAt = Math.max(segment.startedAt, nextStart);
  }

  return state;
}

export function loadState(now = Date.now()) {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return freshState(now);
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return freshState(now);
    if (!Array.isArray(parsed.habits) || !Array.isArray(parsed.events)) return freshState(now);
    return normalize(parsed, now);
  } catch {
    return freshState(now);
  }
}

export function saveState(state) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function createStore({ now = () => Date.now(), storageKey = STORAGE_KEY } = {}) {
  let state = loadState(now());
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) listener(state);
  }

  return {
    key: storageKey,
    get: () => state,
    /** 结构性变更：归一化 → 落盘 → 重绘 */
    commit(mutator) {
      mutator(state);
      normalize(state, now());
      refreshFormation(state, now());
      saveState(state);
      notify();
      return state;
    },
    /** 输入框等高频变更：只改数据与落盘，不重绘（避免打断输入） */
    silent(mutator) {
      mutator(state);
      saveState(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = freshState(now());
      saveState(state);
      notify();
      return state;
    }
  };
}
