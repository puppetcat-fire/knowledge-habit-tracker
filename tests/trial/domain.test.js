// 试作原型域逻辑单测：计时/子任务/笔记/步骤/习惯/记录/候选/知识/战报/归一化。
import { describe, it, expect, beforeEach } from 'vitest';
import * as events from '../../prototypes/open-design-trial/src/domain/events.js';
import * as habits from '../../prototypes/open-design-trial/src/domain/habits.js';
import * as records from '../../prototypes/open-design-trial/src/domain/records.js';
import * as knowledge from '../../prototypes/open-design-trial/src/domain/knowledge.js';
import { candidateList } from '../../prototypes/open-design-trial/src/domain/candidates.js';
import { buildReport } from '../../prototypes/open-design-trial/src/domain/report.js';
import { buildSeedState } from '../../prototypes/open-design-trial/src/seed.js';
import { normalize } from '../../prototypes/open-design-trial/src/store.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 2, 2, 9, 0, 0).getTime(); // 2026-03-02 周一 09:00

function emptyState(now = T0) {
  return normalize({
    version: 1,
    account: { id: 'acc-1', name: '测试' },
    currentHabitId: null,
    habits: [],
    stepTemplates: {},
    noteTemplates: {},
    events: [],
    knowledge: { trees: [{ id: 'tree', title: '树', nodes: [], methods: [] }] },
    lightups: [],
    ui: {}
  }, now);
}

function eventWithSegments(now = T0, segments) {
  const state = emptyState(now);
  const startedAt = segments[0].startedAt;
  state.events.push({
    id: 'e-1', name: '测试事件', habitId: null, knowledge: null, startedAt, endedAt: null,
    segments: segments.map((segment) => ({ ...segment })), notes: [], draftNote: '',
    parentId: null, parentStepId: null, stepDone: []
  });
  return state;
}

describe('事件计时：单活动与切回', () => {
  let state;
  beforeEach(() => { state = emptyState(); });

  it('开始一件事后成为唯一活动条目', () => {
    const event = events.startEvent(state, { name: '吃东西', now: T0 });
    expect(events.unfinished(state)).toHaveLength(1);
    expect(events.activeEvent(state)?.id).toBe(event.id);
    expect(event.segments).toHaveLength(1);
    expect(event.segments[0].endedAt).toBeNull();
  });

  it('开始第二件事会暂停第一件，未结束列表变成两条，活动仍只有一条', () => {
    const first = events.startEvent(state, { name: '吃东西', now: T0 });
    const second = events.startEvent(state, { name: '喝水', now: T0 + 5 * 60 * 1000 });
    expect(events.unfinished(state)).toHaveLength(2);
    expect(events.activeEvent(state)?.id).toBe(second.id);
    expect(events.durationOf(first, T0 + 10 * 60 * 1000)).toBe(5 * 60 * 1000);
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0].endedAt).toBe(T0 + 5 * 60 * 1000);
  });

  it('切回会暂停当前活动条目并继续累计所选条目', () => {
    const first = events.startEvent(state, { name: '吃东西', now: T0 });
    const second = events.startEvent(state, { name: '喝水', now: T0 + 5 * 60 * 1000 });
    events.switchTo(state, first.id, T0 + 8 * 60 * 1000);
    expect(events.activeEvent(state)?.id).toBe(first.id);
    expect(events.durationOf(second, T0 + 12 * 60 * 1000)).toBe(3 * 60 * 1000);
    expect(events.durationOf(first, T0 + 12 * 60 * 1000)).toBe(5 * 60 * 1000 + 4 * 60 * 1000);
    // 分段不重叠
    const [segmentA, segmentB] = first.segments;
    expect(segmentA.endedAt).toBeLessThanOrEqual(segmentB.startedAt);
  });

  it('结束任意一条只结束它自己，不自动恢复其他记录', () => {
    const first = events.startEvent(state, { name: '吃东西', now: T0 });
    const second = events.startEvent(state, { name: '喝水', now: T0 + 5 * 60 * 1000 });
    const ended = events.endEvent(state, second.id, T0 + 10 * 60 * 1000);
    expect(ended?.endedAt).toBe(T0 + 10 * 60 * 1000);
    expect(events.unfinished(state).map((event) => event.id)).toEqual([first.id]);
    expect(events.activeEvent(state)).toBeNull();
  });

  it('结束后同名再开始是新事件 id', () => {
    const first = events.startEvent(state, { name: '打游戏', now: T0 });
    events.endEvent(state, first.id, T0 + 10 * 60 * 1000);
    const second = events.startEvent(state, { name: '打游戏', now: T0 + 20 * 60 * 1000 });
    expect(second.id).not.toBe(first.id);
    expect(state.events).toHaveLength(2);
  });

  it('同名未结束记录再次开始是切回而不是新建', () => {
    const first = events.startEvent(state, { name: '喝水', now: T0 });
    events.startEvent(state, { name: '喝水', now: T0 + 60 * 1000 });
    expect(state.events).toHaveLength(1);
    expect(events.activeEvent(state)?.id).toBe(first.id);
  });

  it('显式暂停后没有活动条目，但记录仍未结束', () => {
    const event = events.startEvent(state, { name: '写周报', now: T0 });
    events.pauseActive(state, T0 + 5 * 60 * 1000);
    expect(events.activeEvent(state)).toBeNull();
    expect(events.unfinished(state)).toHaveLength(1);
    expect(events.durationOf(event, T0 + 30 * 60 * 1000)).toBe(5 * 60 * 1000);
  });
});

describe('笔记：单次与重复', () => {
  it('单次笔记按事件 id 保存，同名新事件不继承', () => {
    const state = emptyState();
    const first = events.startEvent(state, { name: '读一节', now: T0 });
    events.setDraftNote(state, first.id, '今天读到反馈回路');
    events.saveNote(state, first.id, T0 + 60_000);
    expect(first.notes).toHaveLength(1);
    expect(first.draftNote).toBe('');
    events.endEvent(state, first.id, T0 + 120_000);
    const second = events.startEvent(state, { name: '读一节', now: T0 + 180_000 });
    expect(second.notes).toHaveLength(0);
    expect(second.draftNote).toBe('');
  });

  it('空草稿不生成笔记', () => {
    const state = emptyState();
    const event = events.startEvent(state, { name: '读一节', now: T0 });
    events.setDraftNote(state, event.id, '   ');
    expect(events.saveNote(state, event.id, T0 + 1000)).toBeNull();
    expect(event.notes).toHaveLength(0);
  });

  it('切换未结束事件时各自草稿与已保存笔记互不影响', () => {
    const state = emptyState();
    const first = events.startEvent(state, { name: 'A', now: T0 });
    events.setDraftNote(state, first.id, 'A 的草稿');
    events.saveNote(state, first.id, T0 + 1000);
    events.setDraftNote(state, first.id, 'A 的新草稿');
    const second = events.startEvent(state, { name: 'B', now: T0 + 2000 });
    events.setDraftNote(state, second.id, 'B 的草稿');
    events.switchTo(state, first.id, T0 + 3000);
    expect(first.notes.map((note) => note.text)).toEqual(['A 的草稿']);
    expect(first.draftNote).toBe('A 的新草稿');
    expect(second.draftNote).toBe('B 的草稿');
    expect(second.notes).toHaveLength(0);
    expect(events.activeEvent(state)?.id).toBe(first.id);
  });

  it('重复笔记与步骤按事件名称复用，勾选按事件实例保存', () => {
    const state = emptyState();
    events.setRepeatedNote(state, '起床', '先喝水再刷牙');
    events.addStep(state, '起床', '喝水');
    events.addStep(state, '起床', '刷牙');
    expect(events.stepsOf(state, '起床')).toHaveLength(2);

    const first = events.startEvent(state, { name: '起床', now: T0 });
    const [water] = events.stepsOf(state, '起床');
    events.toggleStep(state, first.id, water.id, true);
    expect(first.stepDone).toEqual([water.id]);

    events.endEvent(state, first.id, T0 + 60_000);
    const second = events.startEvent(state, { name: '起床', now: T0 + 120_000 });
    expect(second.stepDone).toEqual([]);
    expect(events.repeatedNoteOf(state, '起床')).toBe('先喝水再刷牙');
  });
});

describe('子任务', () => {
  it('开始子任务会暂停父事件并让子任务成为唯一活动', () => {
    const state = emptyState();
    events.addStep(state, '起床', '喝水');
    const parent = events.startEvent(state, { name: '起床', now: T0 });
    const [water] = events.stepsOf(state, '起床');
    const child = events.startSubtask(state, parent.id, water.id, T0 + 3 * 60 * 1000);
    expect(child.parentId).toBe(parent.id);
    expect(events.activeEvent(state)?.id).toBe(child.id);
    expect(parent.endedAt).toBeNull();
    expect(events.durationOf(parent, T0 + 10 * 60 * 1000)).toBe(3 * 60 * 1000);
  });

  it('已有未结束子任务时切回而不是复制', () => {
    const state = emptyState();
    events.addStep(state, '起床', '喝水');
    const parent = events.startEvent(state, { name: '起床', now: T0 });
    const [water] = events.stepsOf(state, '起床');
    const child = events.startSubtask(state, parent.id, water.id, T0 + 1000);
    const again = events.startSubtask(state, parent.id, water.id, T0 + 2000);
    expect(again.id).toBe(child.id);
    expect(state.events.filter((event) => event.parentId === parent.id)).toHaveLength(1);
  });

  it('结束子任务勾上父事件该步骤，但不自动恢复父事件', () => {
    const state = emptyState();
    events.addStep(state, '起床', '喝水');
    const parent = events.startEvent(state, { name: '起床', now: T0 });
    const [water] = events.stepsOf(state, '起床');
    const child = events.startSubtask(state, parent.id, water.id, T0 + 1000);
    events.endEvent(state, child.id, T0 + 60_000);
    expect(parent.stepDone).toContain(water.id);
    expect(events.activeEvent(state)).toBeNull();
    expect(parent.endedAt).toBeNull();
  });
});

describe('归一化：刷新后不会出现两条活动计时', () => {
  it('多处开着的分段只保留最晚开始的那条', () => {
    const state = eventWithSegments(T0, [{ startedAt: T0, endedAt: null }]);
    state.events.push({
      id: 'e-2', name: '第二件', habitId: null, knowledge: null, startedAt: T0 + 1000, endedAt: null,
      segments: [{ startedAt: T0 + 1000, endedAt: null }], notes: [], draftNote: '', parentId: null, parentStepId: null, stepDone: []
    });
    const normalized = normalize(state, T0 + 60_000);
    const open = normalized.events.filter((event) => event.endedAt === null && events.isActive(event));
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe('e-2');
    expect(normalized.events[0].segments[0].endedAt).toBe(T0 + 1000);
  });

  it('已结束事件不会留下开着的时间段', () => {
    const state = eventWithSegments(T0, [{ startedAt: T0, endedAt: null }]);
    state.events[0].endedAt = T0 + 5000;
    const normalized = normalize(state, T0 + 60_000);
    expect(normalized.events[0].segments[0].endedAt).toBe(T0 + 5000);
  });

  it('补齐缺失字段，不因旧数据崩溃', () => {
    const normalized = normalize({ version: 1, events: [{ name: '旧事件' }] }, T0);
    expect(normalized.events[0].segments).toHaveLength(1);
    expect(normalized.events[0].notes).toEqual([]);
    expect(normalized.events[0].stepDone).toEqual([]);
    expect(normalized.noteTemplates).toEqual({});
  });
});

describe('习惯：唯一养成中与四周判定', () => {
  function habitState() {
    const state = emptyState();
    state.habits = [
      { id: 'h-1', name: '读书', createdAt: T0 - 30 * DAY, formedAt: null },
      { id: 'h-2', name: '散步', createdAt: T0 - 40 * DAY, formedAt: null }
    ];
    state.currentHabitId = 'h-1';
    return state;
  }

  function addHabitEvents(state, habitId, weekStart, count) {
    for (let index = 0; index < count; index += 1) {
      const endedAt = weekStart + (index % 7) * DAY + 9 * 60 * 60 * 1000;
      state.events.push({
        id: `e-${habitId}-${weekStart}-${index}`, name: '读书', habitId, knowledge: null,
        startedAt: endedAt - 20 * 60 * 1000, endedAt,
        segments: [{ startedAt: endedAt - 20 * 60 * 1000, endedAt }],
        notes: [], draftNote: '', parentId: null, parentStepId: null, stepDone: []
      });
    }
  }

  it('新建习惯成为唯一养成中，旧的变成暂停', () => {
    const state = habitState();
    const created = habits.createHabit(state, '写作', T0);
    expect(habits.currentHabit(state)?.id).toBe(created.id);
    expect(habits.habitStatus(state.habits[0], state)).toBe('paused');
    expect(habits.habitStatus(created, state)).toBe('active');
  });

  it('切换养成目标不改任何计时状态', () => {
    const state = habitState();
    events.startEvent(state, { name: '读书', habitId: 'h-1', now: T0 });
    habits.switchHabit(state, 'h-2', T0 + 1000);
    expect(habits.currentHabit(state)?.id).toBe('h-2');
    expect(events.activeEvent(state)?.name).toBe('读书');
  });

  it('连续四周每周五次判为养成，且按次数不按不同日期', () => {
    const state = habitState();
    const week = habits.startOfWeek(T0);
    for (let index = 0; index < 4; index += 1) addHabitEvents(state, 'h-1', week - index * 7 * DAY, 5);
    expect(habits.hasFormedRun(state, 'h-1', T0)).toBe(true);
    habits.refreshFormation(state, T0);
    expect(state.habits[0].formedAt).toBeTruthy();
    expect(habits.habitStatus(state.habits[0], state)).toBe('formed');
  });

  it('每周只有四次不算养成', () => {
    const state = habitState();
    const week = habits.startOfWeek(T0);
    for (let index = 0; index < 4; index += 1) addHabitEvents(state, 'h-1', week - index * 7 * DAY, 4);
    expect(habits.hasFormedRun(state, 'h-1', T0)).toBe(false);
  });

  it('中间断一周就不算连续四周', () => {
    const state = habitState();
    const week = habits.startOfWeek(T0);
    addHabitEvents(state, 'h-1', week, 5);
    addHabitEvents(state, 'h-1', week - 7 * DAY, 0);
    addHabitEvents(state, 'h-1', week - 14 * DAY, 5);
    addHabitEvents(state, 'h-1', week - 21 * DAY, 5);
    expect(habits.hasFormedRun(state, 'h-1', T0)).toBe(false);
  });

  it('已养成后不再作为养成目标被切换', () => {
    const state = habitState();
    state.habits[1].formedAt = T0 - DAY;
    expect(habits.switchHabit(state, 'h-2', T0)).toBe(false);
    expect(habits.currentHabit(state)?.id).toBe('h-1');
  });

  it('改名保持习惯 ID，并把步骤模板复制到新名称（旧名称保留给历史事件）', () => {
    const state = habitState();
    events.addStep(state, '读书', '打开书');
    events.setRepeatedNote(state, '读书', '先关手机');
    const ok = habits.renameHabit(state, 'h-1', '每天读书');
    expect(ok).toBe(true);
    expect(state.habits[0].id).toBe('h-1');
    expect(state.habits[0].name).toBe('每天读书');
    expect(events.stepsOf(state, '每天读书')).toHaveLength(1);
    expect(events.stepsOf(state, '读书')).toHaveLength(1);
    expect(events.repeatedNoteOf(state, '每天读书')).toBe('先关手机');
  });
});

describe('记录筛选与分组', () => {
  it('按今日/本周/本月/全部筛选，未来与未结束不进入', () => {
    const state = emptyState();
    const now = T0 + 10 * 60 * 60 * 1000;
    const add = (endedAt) => state.events.push({
      id: 'x' + endedAt, name: '事件', habitId: null, knowledge: null, startedAt: endedAt - 60_000, endedAt,
      segments: [{ startedAt: endedAt - 60_000, endedAt }], notes: [], draftNote: '', parentId: null, parentStepId: null, stepDone: []
    });
    add(T0 + 60_000);
    add(T0 - 2 * DAY);
    add(T0 - 20 * DAY);
    state.events.push({ id: 'open', name: '进行中', habitId: null, knowledge: null, startedAt: T0, endedAt: null, segments: [{ startedAt: T0, endedAt: null }], notes: [], draftNote: '', parentId: null, parentStepId: null, stepDone: [] });
    expect(records.filterByRange(state.events, 'today', { now })).toHaveLength(1);
    expect(records.filterByRange(state.events, 'all', { now })).toHaveLength(3);
    expect(records.filterByRange(state.events, 'week', { now }).length).toBeGreaterThanOrEqual(1);
    const groups = records.groupByDay(records.filterByRange(state.events, 'all', { now }));
    expect(groups.length).toBe(3);
  });
});

describe('候选与知识', () => {
  it('候选优先当前习惯，且不出现概率数字', () => {
    const state = buildSeedState(T0);
    const list = candidateList(state, T0);
    expect(list[0].source).toBe('habit');
    expect(list[0].name).toBe(habits.currentHabit(state)?.name);
    for (const item of list) expect(item.hint).not.toMatch(/\d+\s*%/);
  });

  it('点亮草稿不等于已点亮，确认后公开状态可区分', () => {
    const state = buildSeedState(T0);
    const draft = knowledge.ensureDraft(state, { nodeId: 'n-verbatim', eventId: 'x', now: T0 });
    expect(knowledge.litStatus(state, 'n-verbatim')).toBe('draft');
    knowledge.confirmLightup(state, draft.id, 'public');
    expect(knowledge.litStatus(state, 'n-verbatim')).toBe('confirmed');
    expect(draft.visibility).toBe('public');
  });

  it('建议的下一目标优先前置都点亮的节点', () => {
    const state = buildSeedState(T0);
    const suggestion = knowledge.suggestNext(state);
    expect(suggestion).toBeTruthy();
    const missing = suggestion.node.prereqs.filter((id) => knowledge.litStatus(state, id) !== 'confirmed');
    expect(suggestion.ready).toBe(missing.length === 0);
  });
});

describe('战报', () => {
  it('只用真实数据：时长、时间段数、步骤、笔记', () => {
    const state = emptyState();
    events.addStep(state, '写周报', '列三条');
    const event = events.startEvent(state, { name: '写周报', now: T0 });
    events.setDraftNote(state, event.id, '比从空白页开始快');
    events.saveNote(state, event.id, T0 + 60_000);
    events.endEvent(state, event.id, T0 + 10 * 60 * 1000);
    const report = buildReport(state, event, T0 + 20 * 60 * 1000);
    expect(report.durationMs).toBe(10 * 60 * 1000);
    expect(report.segmentCount).toBe(1);
    expect(report.notes).toHaveLength(1);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].done).toBe(false);
  });
});

describe('知识归属、方法贡献与版本', () => {
  it('节点归属缺省为公共，私人节点单独标记', () => {
    const state = buildSeedState(T0);
    expect(knowledge.ownershipOf(knowledge.node(state, 'n-read'))).toBe('public');
    expect(knowledge.ownershipOf(knowledge.node(state, 'n-log'))).toBe('private');
    expect(knowledge.ownershipOf(null)).toBe('public');
  });

  it('贡献方法默认私人、版本从 1 开始，步骤去掉空行', () => {
    const state = buildSeedState(T0);
    const before = knowledge.methodsOf(state, 'n-verbatim').length;
    const method = knowledge.addMethod(state, {
      nodeId: 'n-verbatim', title: '一句话摘录', firstFive: '打开书', steps: ['划线', '   ', '抄一句'], now: T0
    });
    expect(method.version).toBe(1);
    expect(method.visibility).toBe('private');
    expect(method.steps.map((step) => step.text)).toEqual(['划线', '抄一句']);
    expect(knowledge.methodsOf(state, 'n-verbatim')).toHaveLength(before + 1);
  });

  it('节点不存在或名称为空时不产生方法', () => {
    const state = buildSeedState(T0);
    expect(knowledge.addMethod(state, { nodeId: 'nope', title: 'x' })).toBeNull();
    expect(knowledge.addMethod(state, { nodeId: 'n-read', title: '   ' })).toBeNull();
  });

  it('更新方法归档旧版本并升版本号，历史可读', () => {
    const state = buildSeedState(T0);
    const method = knowledge.addMethod(state, { nodeId: 'n-verbatim', title: '摘录法', firstFive: '打开书', steps: ['划线'], now: T0 });
    const updated = knowledge.addMethodVersion(state, method.id, {
      title: '摘录法（改）', firstFive: '先读一段', steps: ['划线', '抄一句'], visibility: 'public'
    }, T0 + 1000);
    expect(updated.version).toBe(2);
    expect(updated.visibility).toBe('public');
    const history = knowledge.methodHistoryOf(updated);
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].title).toBe('摘录法');
    expect(knowledge.methodVersion(updated, 1).title).toBe('摘录法');
    expect(knowledge.methodVersion(updated, 2)).toBe(updated);
  });

  it('方法更新不改变过去事件的版本快照', () => {
    const state = buildSeedState(T0);
    const event = events.startEvent(state, {
      name: '读完一节并留下一句笔记',
      knowledge: { treeId: 'trial-tree', nodeId: 'n-read', methodId: 'm-read', methodVersion: 2, methodTitle: '一节阅读法' },
      now: T0
    });
    events.endEvent(state, event.id, T0 + 60_000);
    knowledge.addMethodVersion(state, 'm-read', { title: '一节阅读法（改）', firstFive: 'x', steps: ['y'] }, T0 + 120_000);
    expect(event.knowledge.methodVersion).toBe(2);
    expect(event.knowledge.methodTitle).toBe('一节阅读法');
    expect(knowledge.methodOf(state, 'm-read').version).toBe(3);
  });
});
