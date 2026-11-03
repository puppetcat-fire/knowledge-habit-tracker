// 习惯详情（三级）：状态与进度、按事件名称复用的步骤定义、这条习惯的实践历史。
// 只读 state；步骤增删改、切换当前习惯走 actions。
import { button, el, fmtDate, fmtDateTime, fmtDuration, fmtTimeSec, link, toast } from '../dom.js';
import { finished, durationOf } from '../../domain/events.js';
import { currentHabit, isFormed, statusLabel, recentWeeks, countForHabit } from '../../domain/habits.js';
import { hashFor } from '../../router.js';

export function renderHabitDetail({ state, route, actions }) {
  const habit = state.habits.find((item) => item.id === route?.params?.habitId) || null;
  const page = el('div', { class: 'page' });

  if (!habit) {
    page.append(pageHead('习惯详情', '这条习惯不存在或已被移除。', [
      link('返回习惯', hashFor('habits'), { class: 'btn ghost' })
    ]));
    page.append(el('p', {
      class: 'empty',
      text: '找不到这条习惯。它可能已经被重置，或者链接里的编号不对。'
    }));
    return page;
  }

  const formed = isFormed(habit);
  const isCurrent = habit.id === state.currentHabitId;
  const count = countForHabit(state, habit.id);

  const subtitleParts = [statusLabel(habit, state), `创建于 ${fmtDateTime(habit.createdAt)}`];
  if (formed) subtitleParts.push(`养成于 ${fmtDateTime(habit.formedAt)}`);
  subtitleParts.push(`累计完成 ${count} 次`);

  const headerActions = [];
  if (!formed && !isCurrent) {
    headerActions.push(button('设为当前养成目标', {
      class: 'btn primary',
      on: { click: () => actions.switchHabit(habit.id) }
    }));
  }
  headerActions.push(link('返回习惯', hashFor('habits'), { class: 'btn ghost' }));

  page.append(pageHead(habit.name, subtitleParts.join(' · '), headerActions));

  const body = el('div', { class: 'page-body' });
  body.append(progressCard(state, habit));
  body.append(stepsCard(state, habit, actions));
  body.append(historyCard(state, habit));
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

/* ---------- 养成进度 ---------- */

function progressCard(state, habit) {
  const weeks = recentWeeks(state, habit.id);
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '养成进度' }),
      el('span', { class: 'card-sub', text: '最近四个本地周 · 每周阈值 5 次' })
    ]),
    weekGrid(weeks),
    el('p', { class: 'hint', text: progressHint(state, habit, weeks) })
  ]);
  return card;
}

function weekGrid(weeks) {
  const grid = el('div', { class: 'week-grid', attrs: { role: 'group', 'aria-label': '最近四个自然周的完成次数' } });
  for (const week of weeks) {
    const status = week.done ? '已达成' : week.index === 0 ? '进行中' : '未达成';
    const detail = week.done ? '已达成' : `还差 ${Math.max(0, 5 - week.count)} 次`;
    grid.append(el('div', {
      class: 'week-cell',
      dataset: { done: week.done ? 'true' : 'false', current: week.index === 0 ? 'true' : 'false' },
      attrs: { 'aria-label': `${week.label}：完成 ${week.count} 次，阈值 5 次，${status}` }
    }, [
      el('span', { class: 'wk-label', text: week.label }),
      el('span', { class: 'wk-count', text: `${week.count} / 5` }),
      el('span', { class: 'small muted', text: week.index === 0 ? status : detail })
    ]));
  }
  return grid;
}

function progressHint(state, habit, weeks) {
  if (isFormed(habit)) {
    return '已养成：保留名称、养成时间与实践记录，不再作为当前养成目标。';
  }
  if (habit.id === state.currentHabitId) {
    const week = weeks[0];
    return week.done
      ? '本周已经达成 5 次，保持就好。'
      : `本周完成 ${week.count} 次，还差 ${Math.max(0, 5 - week.count)} 次达到 5 次；判定看连续四周。`;
  }
  const current = currentHabit(state);
  return `当前养成目标是「${current ? current.name : '无'}」。设为当前只改目标，不会开始、暂停或结束任何计时。`;
}

/* ---------- 重复步骤（按事件名称复用） ---------- */

function stepsCard(state, habit, actions) {
  const steps = Array.isArray(state.stepTemplates[habit.name]) ? state.stepTemplates[habit.name] : [];
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '重复说明与步骤' }),
      el('span', { class: 'card-sub', text: `按事件名称「${habit.name}」复用` })
    ]),
    el('p', {
      class: 'hint',
      text: '每次开始同名事件，都会从这些步骤重新开始；单次笔记不属于这里。改名后，旧名称下的步骤模板不会自动迁移。'
    })
  ]);

  if (!steps.length) {
    card.append(el('p', { class: 'hint', text: '还没有步骤。加一条，下次开始同名事件时就会带上它。' }));
  } else {
    const list = el('div', { class: 'steps' });
    for (const step of steps) list.append(stepRow(habit, step, actions));
    card.append(list);
  }
  card.append(addStepForm(habit, actions));
  return card;
}

function stepRow(habit, step, actions) {
  const input = el('input', {
    type: 'text',
    id: `step-${step.id}`,
    value: step.text,
    attrs: { maxlength: '80', 'aria-label': `步骤内容：${step.text}` }
  });
  return el('form', {
    class: 'step',
    on: {
      submit: (event) => {
        event.preventDefault();
        const next = input.value.trim();
        if (!next) {
          toast('步骤内容不能为空');
          input.focus();
          return;
        }
        if (next === step.text) {
          toast('步骤没有变化');
          return;
        }
        actions.renameStep(habit.name, step.id, next);
      }
    }
  }, [
    input,
    el('div', { class: 'step-actions' }, [
      button('保存', { class: 'btn sm ghost', type: 'submit' }),
      button('删除', {
        class: 'btn sm danger',
        attrs: { 'aria-label': `删除步骤：${step.text}` },
        on: { click: () => actions.removeStep(habit.name, step.id) }
      })
    ])
  ]);
}

function addStepForm(habit, actions) {
  const input = el('input', {
    type: 'text',
    id: 'habit-new-step',
    attrs: { maxlength: '80', placeholder: '新的步骤，例如：打开要读的那一页', 'aria-label': '新的步骤内容' }
  });
  return el('form', {
    class: 'row tight',
    on: {
      submit: (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) {
          toast('先写步骤内容');
          input.focus();
          return;
        }
        actions.addStep(habit.name, text);
      }
    }
  }, [
    input,
    button('添加步骤', { class: 'btn', type: 'submit' })
  ]);
}

/* ---------- 实践历史 ---------- */

function historyCard(state, habit) {
  const events = finished(state).filter((event) => event.habitId === habit.id);
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '实践历史' }),
      el('span', {
        class: 'card-sub',
        text: events.length ? `共 ${events.length} 次 · 最近的在前` : '还没有完成的事件'
      })
    ])
  ]);

  if (!events.length) {
    card.append(el('p', {
      class: 'empty',
      text: '这条习惯还没有完成的事件记录。开始一次同名事件并结束后，记录会出现在这里。'
    }));
    return card;
  }

  const list = el('div', { class: 'timeline' });
  for (const event of events) {
    list.append(el('div', { class: 'timeline-item' }, [
      el('time', {
        text: fmtDate(event.endedAt),
        attrs: { datetime: new Date(event.endedAt).toISOString() }
      }),
      el('div', { class: 'timeline-body' }, [
        link(event.name, hashFor('event-detail', { eventId: event.id })),
        el('span', {
          class: 'small muted',
          text: `${fmtTimeSec(event.startedAt)}–${fmtTimeSec(event.endedAt)} · ${fmtDuration(durationOf(event))}`
        })
      ])
    ]));
  }
  card.append(list);
  return card;
}
