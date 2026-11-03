// 事件详情（三级）：一次记录的活动时间段、实际用时、步骤状态、只读单次笔记、关联知识/习惯。
// 只读 state；只提供返回链接，不做任何写操作。
import { el, fmtClock, fmtDate, fmtDateTime, fmtDuration, fmtTimeSec, link } from '../dom.js';
import { findEvent, durationOf } from '../../domain/events.js';
import { node as findNode, methodOf } from '../../domain/knowledge.js';
import { statusLabel } from '../../domain/habits.js';
import { hashFor } from '../../router.js';

export function renderEventDetail({ state, route }) {
  const event = findEvent(state, route?.params?.eventId);
  const page = el('div', { class: 'page' });

  if (!event) {
    page.append(pageHead('事件详情', '这条记录不存在或已被移除。', [
      link('返回事件记录', hashFor('records'), { class: 'btn ghost' })
    ]));
    page.append(el('p', {
      class: 'empty',
      text: '找不到这条事件记录。它可能已经被重置，或者链接里的编号不对。'
    }));
    return page;
  }

  const now = Date.now();
  const running = event.endedAt === null;
  const habit = event.habitId ? state.habits.find((item) => item.id === event.habitId) : null;
  const knowledge = event.knowledge && event.knowledge.nodeId ? event.knowledge : null;
  const knowledgeNode = knowledge ? findNode(state, knowledge.nodeId) : null;
  const method = knowledge && knowledge.methodId ? methodOf(state, knowledge.methodId) : null;
  const steps = stepRows(state, event);

  const subtitleParts = [`${fmtDateTime(event.startedAt)} 开始`];
  subtitleParts.push(running ? '进行中' : `${fmtTimeSec(event.endedAt)} 结束`);
  if (habit) subtitleParts.push(`习惯：${habit.name}`);

  page.append(pageHead(event.name, subtitleParts.join(' · '), [
    link('返回事件记录', hashFor('records'), { class: 'btn ghost' })
  ]));

  const body = el('div', { class: 'page-body' });
  body.append(overviewCard(state, event, running, now));
  body.append(el('div', { class: 'grid-2' }, [
    stepsCard(steps),
    notesCard(event)
  ]));
  body.append(el('div', { class: 'grid-2' }, [
    knowledgeCard(knowledge, knowledgeNode, method),
    habitCard(state, event, habit)
  ]));
  page.append(body);
  return page;
}

function pageHead(title, subtitle, actionNodes) {
  return el('header', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: title }),
      subtitle ? el('p', { class: 'page-sub', text: subtitle }) : null
    ]),
    el('div', { class: 'page-actions' }, actionNodes.filter(Boolean))
  ]);
}

/* ---------- 概览 ---------- */

function overviewCard(state, event, running, now) {
  const durationNode = running
    ? el('span', {
      attrs: { 'data-role': 'live-duration', 'data-event-id': event.id },
      text: fmtClock(durationOf(event, now))
    })
    : fmtDuration(durationOf(event, now));

  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '本次记录' }),
      el('span', { class: 'card-sub', text: running ? '进行中' : '已完成' })
    ]),
    el('div', { class: 'stats' }, [
      stat('实际用时', durationNode),
      stat('活动时间段', `${event.segments.length} 段`),
      stat('单次笔记', `${event.notes.length} 条`)
    ])
  ]);

  if (event.parentId) card.append(parentLine(state, event));

  if (event.segments.length) {
    card.append(el('p', { class: 'hint', text: '活动时间段（本地时区）' }));
    const list = el('div', { class: 'segment-list' });
    for (const segment of event.segments) {
      const end = segment.endedAt ?? now;
      list.append(el('div', {}, [
        el('span', {
          class: 'seg-time',
          text: `${fmtTimeSec(segment.startedAt)}–${fmtTimeSec(end)}${segment.endedAt === null ? '（进行中）' : ''}`
        }),
        el('span', { class: 'muted small', text: ` ${fmtDuration(end - segment.startedAt)}` })
      ]));
    }
    card.append(list);
  }

  return card;
}

function parentLine(state, event) {
  const parent = findEvent(state, event.parentId);
  if (!parent) {
    return el('p', { class: 'hint', text: '这是一次子任务记录；它所属的父事件已经不在记录里。' });
  }
  const stepText = parentStepText(state, parent, event.parentStepId);
  return el('p', { class: 'hint' }, [
    '这是 ',
    link(parent.name, hashFor('event-detail', { eventId: parent.id })),
    stepText ? ` 里的一步子任务（${stepText}）。` : ' 里的一步子任务。'
  ]);
}

function parentStepText(state, parent, stepId) {
  const template = parent.name ? state.stepTemplates[parent.name] : null;
  if (!Array.isArray(template)) return '';
  const step = template.find((item) => item.id === stepId);
  return step ? step.text : '';
}

function stat(label, value) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-num' }, [value])
  ]);
}

/* ---------- 步骤 ---------- */

function stepsCard(steps) {
  const done = steps.filter((step) => step.done).length;
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '步骤完成情况' }),
      el('span', { class: 'card-sub', text: steps.length ? `${done} / ${steps.length} 已完成` : '没有步骤' })
    ])
  ]);
  if (!steps.length) {
    card.append(el('p', { class: 'hint', text: '这次记录没有步骤定义。' }));
    return card;
  }
  const list = el('div', { class: 'steps' });
  for (const step of steps) {
    list.append(el('div', {
      class: 'step',
      dataset: { done: step.done ? 'true' : 'false' }
    }, [
      el('span', { class: 'step-text', text: step.text }),
      el('span', { class: 'small muted', text: step.done ? '已完成' : '未完成' })
    ]));
  }
  card.append(list);
  return card;
}

/* ---------- 单次笔记（只读） ---------- */

function notesCard(event) {
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '单次笔记' }),
      el('span', { class: 'card-sub', text: '只属于这一次记录' })
    ])
  ]);
  if (!event.notes.length) {
    card.append(el('p', { class: 'hint', text: '这次记录没有保存笔记。' }));
    return card;
  }
  const list = el('div', { class: 'notes' });
  for (const note of event.notes) {
    list.append(el('div', { class: 'note-item' }, [
      el('span', { text: note.text }),
      el('time', { text: fmtDateTime(note.at), attrs: { datetime: new Date(note.at).toISOString() } })
    ]));
  }
  card.append(list);
  return card;
}

/* ---------- 关联知识 / 关联习惯 ---------- */

function knowledgeCard(knowledge, knowledgeNode, method) {
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '关联知识' }),
      knowledgeNode ? el('span', { class: 'card-sub', text: '来自知识图谱' }) : null
    ])
  ]);
  if (!knowledge) {
    card.append(el('p', { class: 'hint', text: '这次记录没有关联知识节点。' }));
    return card;
  }
  if (!knowledgeNode) {
    card.append(el('p', { class: 'hint', text: '关联的节点已经不在当前知识图谱里。' }));
    return card;
  }

  card.append(link(knowledgeNode.name, hashFor('node-detail', {
    nodeId: knowledgeNode.id,
    methodId: knowledge.methodId || undefined
  })));
  const version = knowledge.methodVersion ?? (method ? method.version : null);
  // 方法标题用当时的快照：方法后来更新，也不改写这次实践用的是哪一版。
  const methodLabel = knowledge.methodTitle || (method ? method.title : null);
  card.append(el('p', {
    class: 'small muted',
    text: methodLabel
      ? `${methodLabel}${version === null ? '' : ` · 版本 v${version}`}`
      : '这次记录没有记录方法。'
  }));
  card.append(el('p', { class: 'hint', text: knowledgeNode.goal }));
  return card;
}

function habitCard(state, event, habit) {
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '关联习惯' })
    ])
  ]);
  if (!event.habitId) {
    card.append(el('p', { class: 'hint', text: '这次记录没有关联习惯。' }));
    return card;
  }
  if (!habit) {
    card.append(el('p', { class: 'hint', text: '关联的习惯已经不在习惯列表里。' }));
    return card;
  }
  card.append(link(habit.name, hashFor('habit-detail', { habitId: habit.id })));
  card.append(el('p', {
    class: 'small muted',
    text: `状态：${statusLabel(habit, state)} · 创建于 ${fmtDate(habit.createdAt)}`
  }));
  return card;
}

/**
 * 一次事件的步骤：优先用按事件名称复用的步骤模板（重复步骤），
 * 没有模板时退到事件关联方法里的步骤（知识实践），两者都按 event.stepDone 计算完成状态。
 */
function stepRows(state, event) {
  const template = event.name ? state.stepTemplates[event.name] : null;
  if (Array.isArray(template) && template.length) {
    return template.map((step) => ({ id: step.id, text: step.text, done: event.stepDone.includes(step.id) }));
  }
  const method = event.knowledge && event.knowledge.methodId ? methodOf(state, event.knowledge.methodId) : null;
  if (method && Array.isArray(method.steps) && method.steps.length) {
    return method.steps.map((step) => ({ id: step.id, text: step.text, done: event.stepDone.includes(step.id) }));
  }
  return [];
}
