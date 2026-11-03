// 事件记录页：范围筛选 + 按天分组的已完成事件；每条折叠展开时间段、步骤与本次笔记。
// 只读 state；筛选与跳转走 actions。
import { button, el, fmtDateTime, fmtDuration, fmtTimeSec } from '../dom.js';
import { filterByRange, groupByDay, dayLabel, summarize, duration, RANGES } from '../../domain/records.js';
import { node, methodOf } from '../../domain/knowledge.js';

export function renderRecords({ state, actions }) {
  const range = state.ui?.recordsRange || 'today';
  const date = state.ui?.recordsDate || '';
  const now = Date.now();
  const filtered = filterByRange(state.events, range, { now, date });
  const groups = groupByDay(filtered);
  const totals = summarize(filtered, now);
  const parsedDate = date ? new Date(`${date}T00:00:00`) : null;
  const validDate = Boolean(parsedDate) && !Number.isNaN(parsedDate.getTime());

  const page = el('div', { class: 'page' });
  page.append(el('header', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: '事件记录' }),
      el('p', {
        class: 'page-sub',
        text: '已完成的事件按天排列，最近的在前。展开一条，可以看到实际活动时间段、步骤完成情况和本次笔记。'
      })
    ])
  ]));

  const body = el('div', { class: 'page-body' });
  body.append(filtersCard(actions, range, date, validDate, parsedDate));
  body.append(resultsCard(state, actions, groups, totals, now));
  page.append(body);
  return page;
}

/* ---------- 筛选 ---------- */

function filtersCard(actions, range, date, validDate, parsedDate) {
  const seg = el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': '记录范围' } });
  for (const item of RANGES) {
    seg.append(el('button', {
      type: 'button',
      dataset: { range: item.id },
      attrs: { 'aria-pressed': range === item.id ? 'true' : 'false' },
      on: { click: () => actions.setRecordsRange(item.id) },
      text: item.label
    }));
  }

  const dateInput = el('input', {
    type: 'date',
    id: 'records-date',
    value: date,
    attrs: { 'aria-label': '按指定日期筛选记录' },
    on: {
      change: (event) => {
        const value = event.target.value;
        if (value) actions.setRecordsDate(value);
        else actions.setRecordsRange('today');
      }
    }
  });

  const hint = range === 'date'
    ? (validDate ? `指定日：${fmtDateOf(parsedDate)}（本地时区）。` : '还没有选择日期，暂时按今天显示。')
    : '范围按事件结束时间计算；「本周」从周一开始。';

  return el('section', { class: 'card' }, [
    el('div', { class: 'filters' }, [
      seg,
      el('div', { class: 'row tight' }, [
        el('label', { class: 'small muted', attrs: { for: 'records-date' }, text: '指定日期' }),
        dateInput
      ])
    ]),
    el('p', { class: 'hint', text: hint })
  ]);
}

function fmtDateOf(date) {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/* ---------- 结果 ---------- */

function resultsCard(state, actions, groups, totals, now) {
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '记录' }),
      el('span', {
        class: 'card-sub',
        text: `共 ${totals.count} 条 · 累计 ${fmtDuration(totals.totalMs)}`
      })
    ])
  ]);

  if (!groups.length) {
    card.append(el('p', {
      class: 'empty',
      text: '这个范围里还没有完成的记录。换一个范围，或者先去计时页记录一件事。'
    }));
    return card;
  }

  const stack = el('div', { class: 'stack' });
  for (const group of groups) {
    const day = el('div', { class: 'record-day' }, [
      el('h3', { text: `${dayLabel(group.key, now)} · ${group.items.length} 条` })
    ]);
    for (const event of group.items) day.append(recordItem(state, event, actions, now));
    stack.append(day);
  }
  card.append(stack);
  return card;
}

function recordItem(state, event, actions, now) {
  const habit = event.habitId ? state.habits.find((item) => item.id === event.habitId) : null;
  const knowledgeNode = event.knowledge && event.knowledge.nodeId ? node(state, event.knowledge.nodeId) : null;
  const tags = [];
  if (habit) tags.push(habit.name);
  if (knowledgeNode) tags.push(knowledgeNode.name);
  else if (event.knowledge) tags.push('知识实践');
  if (event.parentId) {
    const parent = state.events.find((item) => item.id === event.parentId);
    tags.push(parent ? `子任务·${parent.name}` : '子任务');
  }

  const item = el('details', { class: 'record-item' }, [
    el('summary', {}, [
      el('span', { class: 'rec-name', text: event.name }),
      el('span', { class: 'rec-tag', text: tags.length ? tags.join(' · ') : '未关联习惯与知识' }),
      el('span', { class: 'small muted', text: `${fmtTimeSec(event.startedAt)}–${fmtTimeSec(event.endedAt)}` }),
      el('span', { class: 'rec-dur', text: fmtDuration(duration(event, now)) })
    ])
  ]);

  const detail = el('div', { class: 'record-detail' });
  detail.append(el('p', { class: 'hint', text: '活动时间段（本地时区）' }));
  const segments = el('div', { class: 'segment-list' });
  for (const segment of event.segments) {
    const end = segment.endedAt ?? now;
    segments.append(el('div', {}, [
      el('span', { class: 'seg-time', text: `${fmtTimeSec(segment.startedAt)}–${fmtTimeSec(end)}` }),
      el('span', { class: 'muted small', text: ` ${fmtDuration(end - segment.startedAt)}` })
    ]));
  }
  detail.append(segments);

  const steps = eventStepRows(state, event);
  if (!steps.length) {
    detail.append(el('p', { class: 'hint', text: '这次记录没有步骤定义。' }));
  } else {
    const done = steps.filter((step) => step.done).length;
    const line = el('p', { class: 'small' });
    line.append(el('span', { class: 'muted', text: `步骤 ${done} / ${steps.length}：` }));
    steps.forEach((step, index) => {
      line.append(el('span', {
        class: step.done ? undefined : 'muted',
        text: `${step.text}（${step.done ? '已完成' : '未完成'}）${index < steps.length - 1 ? '、' : ''}`
      }));
    });
    detail.append(line);
  }

  if (!event.notes.length) {
    detail.append(el('p', { class: 'hint', text: '这次记录没有保存笔记。' }));
  } else {
    const notes = el('div', { class: 'notes' });
    for (const note of event.notes) {
      notes.append(el('div', { class: 'note-item' }, [
        el('span', { text: note.text }),
        el('time', { text: fmtDateTime(note.at), attrs: { datetime: new Date(note.at).toISOString() } })
      ]));
    }
    detail.append(notes);
  }

  detail.append(el('div', { class: 'row tight' }, [
    button('查看事件详情', {
      class: 'btn sm',
      on: { click: () => actions.navigate('event-detail', { eventId: event.id }) }
    })
  ]));

  item.append(detail);
  return item;
}

/**
 * 一次事件的步骤：优先用按事件名称复用的步骤模板（重复步骤），
 * 没有模板时退到事件关联方法里的步骤（知识实践），两者都按 event.stepDone 计算完成状态。
 */
function eventStepRows(state, event) {
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
