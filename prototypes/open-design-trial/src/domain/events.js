// 事件记录域：单活动计时、未结束列表、切回/结束、子任务、两类笔记、步骤模板。
// 全部是作用在 state 上的同步纯逻辑（不改全局、不读时钟以外的环境），便于单测。
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

let counter = 0;
export function newId(prefix = 'id') {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function unfinished(state) {
  return state.events.filter((event) => event.endedAt === null);
}

export function finished(state) {
  return state.events.filter((event) => event.endedAt !== null).sort((a, b) => b.endedAt - a.endedAt);
}

export function findEvent(state, id) {
  return state.events.find((event) => event.id === id) || null;
}

export function isActive(event) {
  const last = event.segments[event.segments.length - 1];
  return Boolean(last) && last.endedAt === null;
}

export function activeEvent(state) {
  return state.events.find((event) => event.endedAt === null && isActive(event)) || null;
}

export function durationOf(event, now = Date.now()) {
  return event.segments.reduce((total, segment) => total + Math.max(0, (segment.endedAt ?? now) - segment.startedAt), 0);
}

function closeOpenSegment(event, now) {
  const last = event.segments[event.segments.length - 1];
  if (last && last.endedAt === null) last.endedAt = Math.max(now, last.startedAt);
}

function pause(state, id, now) {
  const event = findEvent(state, id);
  if (event) closeOpenSegment(event, now);
}

function resume(state, id, now) {
  const event = findEvent(state, id);
  if (!event || event.endedAt !== null) return false;
  if (isActive(event)) return true;
  const last = event.segments[event.segments.length - 1];
  const startedAt = last && last.endedAt !== null ? Math.max(now, last.endedAt) : now;
  event.segments.push({ startedAt, endedAt: null });
  return true;
}

/** 同一时刻最多一条活动计时：把除 id 之外的活动条目都暂停。 */
export function isolateActive(state, id, now) {
  for (const event of state.events) {
    if (event.id !== id && event.endedAt === null && isActive(event)) closeOpenSegment(event, now);
  }
}

export function switchTo(state, id, now = Date.now()) {
  const event = findEvent(state, id);
  if (!event || event.endedAt !== null) return false;
  if (isActive(event)) {
    isolateActive(state, id, now);
    return true;
  }
  isolateActive(state, id, now);
  return resume(state, id, now);
}

/** 开始一件事：同名未结束记录直接切回，避免重复条目；否则新建并设为活动。 */
export function startEvent(state, { name, habitId = null, knowledge = null, now = Date.now() }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('事件名称不能为空');
  const existing = unfinished(state).find((event) => event.name === trimmed && event.habitId === habitId);
  if (existing) {
    switchTo(state, existing.id, now);
    return existing;
  }
  const event = {
    id: newId('event'),
    name: trimmed,
    habitId,
    knowledge,
    startedAt: now,
    endedAt: null,
    segments: [{ startedAt: now, endedAt: null }],
    notes: [],
    draftNote: '',
    parentId: null,
    parentStepId: null,
    stepDone: []
  };
  isolateActive(state, event.id, now);
  state.events.push(event);
  return event;
}

/** 结束任意一条：只结束它自己；结束活动条目后不替用户恢复或开始别的。 */
export function endEvent(state, id, now = Date.now()) {
  const event = findEvent(state, id);
  if (!event || event.endedAt !== null) return null;
  closeOpenSegment(event, now);
  event.endedAt = now;
  if (event.parentId && event.parentStepId) {
    const parent = findEvent(state, event.parentId);
    if (parent && !parent.stepDone.includes(event.parentStepId)) parent.stepDone.push(event.parentStepId);
  }
  return event;
}

export function renameEvent(state, id, name) {
  const event = findEvent(state, id);
  const trimmed = String(name || '').trim();
  if (!event || !trimmed) return false;
  event.name = trimmed;
  return true;
}

/** 显式暂停：闭合当前活动分段但不结束事件；之后可切回或结束。 */
export function pauseActive(state, now = Date.now()) {
  const active = activeEvent(state);
  if (!active) return null;
  pause(state, active.id, now);
  return active;
}

/* ---------- 单次笔记（按事件 id） ---------- */
export function setDraftNote(state, id, text) {
  const event = findEvent(state, id);
  if (!event) return false;
  event.draftNote = String(text ?? '');
  return true;
}

export function saveNote(state, id, now = Date.now()) {
  const event = findEvent(state, id);
  if (!event) return null;
  const text = String(event.draftNote || '').trim();
  if (!text) return null;
  const note = { id: newId('note'), text, at: now };
  event.notes.push(note);
  event.draftNote = '';
  return note;
}

export function removeNote(state, id, noteId) {
  const event = findEvent(state, id);
  if (!event) return false;
  const before = event.notes.length;
  event.notes = event.notes.filter((note) => note.id !== noteId);
  return event.notes.length !== before;
}

/* ---------- 重复笔记 / 步骤（按事件名称复用） ---------- */
export function repeatedNoteOf(state, name) {
  if (!state.noteTemplates) state.noteTemplates = {};
  return typeof state.noteTemplates[name] === 'string' ? state.noteTemplates[name] : '';
}

export function setRepeatedNote(state, name, text) {
  if (!state.noteTemplates) state.noteTemplates = {};
  state.noteTemplates[name] = String(text ?? '');
  return true;
}

export function stepsOf(state, name) {
  if (!Array.isArray(state.stepTemplates[name])) state.stepTemplates[name] = [];
  return state.stepTemplates[name];
}

export function addStep(state, name, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const step = { id: newId('step'), text: trimmed };
  stepsOf(state, name).push(step);
  return step;
}

export function renameStep(state, name, stepId, text) {
  const trimmed = String(text || '').trim();
  const step = stepsOf(state, name).find((item) => item.id === stepId);
  if (!step || !trimmed) return false;
  step.text = trimmed;
  return true;
}

export function removeStep(state, name, stepId) {
  const steps = stepsOf(state, name);
  const before = steps.length;
  state.stepTemplates[name] = steps.filter((step) => step.id !== stepId);
  return state.stepTemplates[name].length !== before;
}

export function toggleStep(state, id, stepId, done) {
  const event = findEvent(state, id);
  if (!event) return false;
  const has = event.stepDone.includes(stepId);
  if (done && !has) event.stepDone.push(stepId);
  if (!done && has) event.stepDone = event.stepDone.filter((item) => item !== stepId);
  return true;
}

/* ---------- 子任务 ---------- */
export function subtaskOf(state, parentId, stepId) {
  return unfinished(state).find((event) => event.parentId === parentId && event.parentStepId === stepId) || null;
}

/** 开始子任务：父事件暂停且保留，子任务成为唯一活动；已有未结束子任务则切回它。 */
export function startSubtask(state, parentId, stepId, now = Date.now()) {
  const parent = findEvent(state, parentId);
  if (!parent || parent.endedAt !== null) return null;
  const existing = subtaskOf(state, parentId, stepId);
  if (existing) {
    switchTo(state, existing.id, now);
    return existing;
  }
  const step = stepsOf(state, parent.name).find((item) => item.id === stepId);
  const child = startEvent(state, { name: step ? step.text : '子任务', now });
  child.parentId = parentId;
  child.parentStepId = stepId;
  isolateActive(state, child.id, now);
  return child;
}

/** 当前是否有一条活动计时属于该父事件下的某一步骤。 */
export function runningSubtasks(state) {
  const map = new Map();
  for (const event of unfinished(state)) {
    if (event.parentId) map.set(event.parentId + ':' + event.parentStepId, event);
  }
  return map;
}
