// 习惯域：多条定义，同一时间只有一条「养成中」；养成判定按「连续 4 个本地周，每周 ≥5 次」。
// 统计口径是事件完成次数，不额外要求五个不同日期（见 docs/requirement-flow-review.md 开放问题 1）。
import { finished } from './events.js';

const DAY = 24 * 60 * 60 * 1000;

export function startOfWeek(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0=周日
  const offset = (day + 6) % 7; // 周一为 0
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

export function habits(state) {
  return state.habits;
}

export function currentHabit(state) {
  return state.habits.find((habit) => habit.id === state.currentHabitId) || state.habits[0] || null;
}

export function isFormed(habit) {
  return Boolean(habit && habit.formedAt);
}

export function habitStatus(habit, state) {
  if (!habit) return 'none';
  if (isFormed(habit)) return 'formed';
  return habit.id === state.currentHabitId ? 'active' : 'paused';
}

export function statusLabel(habit, state) {
  const status = habitStatus(habit, state);
  if (status === 'formed') return '已养成';
  if (status === 'active') return '养成中';
  if (status === 'paused') return '暂停养成';
  return '未开始';
}

export function createHabit(state, name, now = Date.now()) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const habit = { id: 'habit-' + Math.random().toString(36).slice(2, 10), name: trimmed, createdAt: now, formedAt: null };
  state.habits.push(habit);
  state.currentHabitId = habit.id;
  return habit;
}

/** 切换养成目标：只改「当前」，不碰任何计时状态。 */
export function switchHabit(state, id, now = Date.now()) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return false;
  if (isFormed(habit)) return false; // 已养成的不再作为养成目标
  state.currentHabitId = id;
  refreshFormation(state, now);
  return true;
}

export function renameHabit(state, id, name) {
  const trimmed = String(name || '').trim();
  const habit = state.habits.find((item) => item.id === id);
  if (!habit || !trimmed) return false;
  const previous = habit.name;
  if (previous === trimmed) return false;
  habit.name = trimmed;
  // 重复笔记/步骤按事件名称复用：改名后复制一份到新名称，旧名称保留，
  // 这样历史事件展开时仍能按旧名称找回它当时的步骤。
  if (state.noteTemplates && typeof state.noteTemplates[previous] === 'string' && state.noteTemplates[trimmed] === undefined) {
    state.noteTemplates[trimmed] = state.noteTemplates[previous];
  }
  if (state.stepTemplates && Array.isArray(state.stepTemplates[previous]) && state.stepTemplates[trimmed] === undefined) {
    state.stepTemplates[trimmed] = state.stepTemplates[previous].map((step) => ({ ...step }));
  }
  return true;
}

export function countForHabit(state, habitId) {
  return finished(state).filter((event) => event.habitId === habitId).length;
}

function weekCounts(state, habitId) {
  const events = finished(state).filter((event) => event.habitId === habitId);
  const counts = new Map();
  for (const event of events) {
    const week = startOfWeek(event.endedAt);
    counts.set(week, (counts.get(week) || 0) + 1);
  }
  return counts;
}

/** 最近 4 个本地周（本周在最前）的完成次数，供界面展示。 */
export function recentWeeks(state, habitId, now = Date.now(), weeks = 4) {
  const counts = weekCounts(state, habitId);
  const current = startOfWeek(now);
  const result = [];
  for (let index = 0; index < weeks; index += 1) {
    const start = current - index * 7 * DAY;
    const label = index === 0 ? '本周' : index === 1 ? '上周' : labelOfIndex(index);
    result.push({ index, start, label, count: counts.get(start) || 0, done: (counts.get(start) || 0) >= 5 });
  }
  return result;
}

function labelOfIndex(index) {
  const names = ['本周', '上周', '两周前', '三周前', '四周前', '五周前'];
  return names[index] || `${index} 周前`;
}

/** 连续 4 个周都 ≥5 次才算养成；扫过整个历史，已达成的历史窗口不会失效。 */
export function hasFormedRun(state, habitId, now = Date.now()) {
  const counts = weekCounts(state, habitId);
  const current = startOfWeek(now);
  const firstEvent = finished(state).filter((event) => event.habitId === habitId).reduce((min, event) => (min === null || event.endedAt < min ? event.endedAt : min), null);
  const start = firstEvent === null ? current : Math.min(startOfWeek(firstEvent), current);
  let run = 0;
  for (let week = start; week <= current; week += 7 * DAY) {
    if ((counts.get(week) || 0) >= 5) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/** 把达成的习惯标记为已养成；不改动当前养成目标。 */
export function refreshFormation(state, now = Date.now()) {
  let changed = false;
  for (const habit of state.habits) {
    if (!habit.formedAt && hasFormedRun(state, habit.id, now)) {
      habit.formedAt = now;
      changed = true;
    }
  }
  return changed;
}

export function formed(current, state) {
  return state.habits.filter((habit) => isFormed(habit));
}

export function paused(current, state) {
  return state.habits.filter((habit) => !isFormed(habit) && habit.id !== state.currentHabitId);
}
