// 习惯页：唯一「养成中」+ 最近四个本地周的进度 + 已养成 / 暂停列表。
// 只读 state；新建、改名、切换全部走 actions。
import { button, el, fmtDate, fmtDuration, fmtTimeSec, link, toast } from '../dom.js';
import { finished, durationOf } from '../../domain/events.js';
import { currentHabit, isFormed, recentWeeks, countForHabit } from '../../domain/habits.js';
import { hashFor } from '../../router.js';

const RULE_HINT = '养成判定：连续 4 个本地周、每周至少 5 次已完成记录。按次数统计，不额外要求落在不同日期。';

export function renderHabits({ state, actions }) {
  const candidate = currentHabit(state);
  const activeHabit = candidate && !isFormed(candidate) ? candidate : null;

  const page = el('div', { class: 'page' });
  page.append(el('header', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: '习惯' }),
      el('p', { class: 'page-sub', text: '同一时间只有一条习惯在养成中。切换只改目标，不会开始、暂停或结束任何计时。' })
    ]),
    el('div', { class: 'page-actions' }, [
      button('新建习惯', { class: 'btn', on: { click: focusNewHabitInput } })
    ])
  ]));

  page.append(el('div', { class: 'page-body' }, [
    renderCurrent(state, actions, activeHabit),
    renderNewHabit(actions),
    renderFormed(state),
    renderSupport(state),
    renderPaused(state, actions)
  ]));
  return page;
}

function focusNewHabitInput() {
  const input = document.getElementById('habit-new-name');
  if (!input) return;
  input.focus();
  if (typeof input.scrollIntoView === 'function') input.scrollIntoView({ block: 'center' });
}

/* ---------- 当前养成中 ---------- */

function renderCurrent(state, actions, habit) {
  const card = el('section', { class: 'card habit-current' });
  if (!habit) {
    card.append(el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '当前养成' })
    ]));
    card.append(el('p', {
      class: 'empty',
      text: '现在没有养成中的习惯。可以在下面新建一条，或从「暂停养成」里把一条设为当前。'
    }));
    return card;
  }

  const count = countForHabit(state, habit.id);
  card.append(el('div', { class: 'card-head' }, [
    el('div', { class: 'habit-name' }, [
      el('h2', { text: habit.name }),
      el('span', { class: 'chip gold', text: '养成中' })
    ]),
    el('div', { class: 'card-actions' }, [
      link('查看详情', hashFor('habit-detail', { habitId: habit.id }), { class: 'btn sm ghost' })
    ])
  ]));
  card.append(el('p', { class: 'hint', text: `${fmtDate(habit.createdAt)} 开始 · 累计完成 ${count} 次。` }));
  card.append(weekGrid(state, habit.id));
  card.append(el('p', { class: 'hint', text: RULE_HINT }));
  card.append(el('hr', { class: 'divider' }));
  card.append(renameForm(habit, actions));
  return card;
}

function weekGrid(state, habitId) {
  const weeks = recentWeeks(state, habitId);
  const grid = el('div', { class: 'week-grid', attrs: { role: 'group', 'aria-label': '最近四个自然周的完成次数' } });
  for (const week of weeks) {
    const status = week.done ? '已达成' : week.index === 0 ? '进行中' : '未达成';
    const detail = week.done ? '已达成' : `还差 ${Math.max(0, 5 - week.count)} 次`;
    const cell = el('div', {
      class: 'week-cell',
      dataset: { done: week.done ? 'true' : 'false', current: week.index === 0 ? 'true' : 'false' },
      attrs: { 'aria-label': `${week.label}：完成 ${week.count} 次，阈值 5 次，${status}` }
    }, [
      el('span', { class: 'wk-label', text: week.label }),
      el('span', { class: 'wk-count', text: `${week.count} / 5` }),
      el('span', { class: 'small muted', text: week.index === 0 ? status : detail })
    ]);
    grid.append(cell);
  }
  return grid;
}

function renameForm(habit, actions) {
  const input = el('input', {
    type: 'text',
    id: 'habit-rename',
    value: habit.name,
    attrs: { maxlength: '40' }
  });
  return el('form', {
    class: 'stack tight',
    on: {
      submit: (event) => {
        event.preventDefault();
        const next = input.value.trim();
        if (!next) {
          toast('习惯名称不能为空');
          input.focus();
          return;
        }
        if (next === habit.name) {
          toast('名称没有变化');
          return;
        }
        actions.renameHabit(habit.id, next);
      }
    }
  }, [
    el('label', { class: 'field' }, [el('span', { text: '习惯名称' }), input]),
    el('div', { class: 'row tight' }, [
      button('保存名称', { class: 'btn', type: 'submit' }),
      el('span', { class: 'hint', text: '改名只改称呼与显示，习惯 ID 和历史记录不变。' })
    ])
  ]);
}

/* ---------- 新建 ---------- */

function renderNewHabit(actions) {
  const input = el('input', {
    type: 'text',
    id: 'habit-new-name',
    attrs: { maxlength: '40', placeholder: '例如：睡前拉伸' }
  });
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '新建习惯' }),
      el('span', { class: 'card-sub', text: '新建后它成为唯一在养成中的习惯' })
    ]),
    el('form', {
      class: 'stack tight',
      on: {
        submit: (event) => {
          event.preventDefault();
          const name = input.value.trim();
          if (!name) {
            toast('先给习惯起个名字');
            input.focus();
            return;
          }
          actions.createHabit(name);
        }
      }
    }, [
      el('label', { class: 'field' }, [el('span', { text: '习惯名称' }), input]),
      el('div', { class: 'row tight' }, [
        button('新建习惯', { class: 'btn primary', type: 'submit' }),
        el('span', { class: 'hint', text: '旧习惯的进度与记录都保留。' })
      ])
    ])
  ]);
}

/* ---------- 达成后的自愿支持（提示，不挡使用、不接支付） ---------- */
function renderSupport(state) {
  const formed = state.habits.filter((habit) => isFormed(habit));
  if (!formed.length) return null;
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('h2', { class: 'card-title', text: '达成之后，完全自愿' }),
        el('p', { class: 'card-sub', text: `已经养成：${formed.map((habit) => habit.name).join('、')}。` })
      ])
    ]),
    el('p', { class: 'hint', text: '产品完整免费使用，养成不是付费门槛，也不会解锁任何功能。如果它确实帮到了你，可以：' }),
    el('ul', { class: 'stack tight' }, [
      el('li', { class: 'hint', text: '自愿赞赏 2–5 元（试作不接支付，这里只说明规则）；' }),
      el('li', { class: 'hint', text: '或把产品与公司的理念推荐给需要的人。' })
    ]),
    el('p', { class: 'hint', text: '达成不会改变推荐排序，也不会自动公开任何私人记录。' })
  ]);
}

/* ---------- 已养成 ---------- */

function renderFormed(state) {
  const list = state.habits.filter(isFormed);
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '已养成' }),
      el('span', {
        class: 'card-sub',
        text: list.length ? `共 ${list.length} 条 · 展开可看历史事件` : '连续四周达标后，习惯会留在这里'
      })
    ])
  ]);
  if (!list.length) {
    card.append(el('p', { class: 'hint', text: '还没有已养成的习惯。' }));
    return card;
  }

  const stack = el('div', { class: 'stack tight' });
  for (const habit of list) {
    const count = countForHabit(state, habit.id);
    const item = el('details', { class: 'record-item' }, [
      el('summary', {}, [
        el('span', { class: 'rec-name', text: habit.name }),
        el('span', { class: 'rec-tag', text: '已养成' }),
        el('span', { class: 'rec-tag', text: `${fmtDate(habit.formedAt)} 养成` }),
        el('span', { class: 'rec-dur', text: `${count} 次` })
      ])
    ]);
    const detail = el('div', { class: 'record-detail' }, [historyRows(state, habit.id)]);
    detail.append(el('div', { class: 'row tight' }, [
      link('查看习惯详情', hashFor('habit-detail', { habitId: habit.id }), { class: 'btn sm ghost' })
    ]));
    item.append(detail);
    stack.append(item);
  }
  card.append(stack);
  return card;
}

function historyRows(state, habitId) {
  const events = finished(state).filter((event) => event.habitId === habitId);
  if (!events.length) return el('p', { class: 'hint', text: '这条习惯还没有完成过的事件。' });
  const list = el('div', { class: 'timeline' });
  for (const event of events) {
    list.append(el('div', { class: 'timeline-item' }, [
      el('time', { text: fmtDate(event.endedAt), attrs: { datetime: new Date(event.endedAt).toISOString() } }),
      el('div', { class: 'timeline-body' }, [
        link(event.name, hashFor('event-detail', { eventId: event.id })),
        el('span', {
          class: 'small muted',
          text: `${fmtTimeSec(event.startedAt)}–${fmtTimeSec(event.endedAt)} · ${fmtDuration(durationOf(event))}`
        })
      ])
    ]));
  }
  return list;
}

/* ---------- 暂停养成 ---------- */

function renderPaused(state, actions) {
  const list = state.habits.filter((habit) => !isFormed(habit) && habit.id !== state.currentHabitId);
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: '暂停养成' }),
      el('span', { class: 'card-sub', text: list.length ? `共 ${list.length} 条 · 切换只改当前目标` : '没有暂停中的习惯' })
    ])
  ]);
  if (!list.length) {
    card.append(el('p', { class: 'hint', text: '没有暂停中的习惯。' }));
    return card;
  }

  const rows = el('div', { class: 'habit-list' });
  for (const habit of list) {
    rows.append(el('div', { class: 'habit-item' }, [
      el('div', {}, [
        link(habit.name, hashFor('habit-detail', { habitId: habit.id }), { class: 'hi-name' }),
        el('div', {
          class: 'hi-meta',
          text: `创建于 ${fmtDate(habit.createdAt)} · 已完成 ${countForHabit(state, habit.id)} 次`
        })
      ]),
      el('span', { class: 'chip muted', text: '暂停养成' }),
      button('设为当前', {
        class: 'btn sm',
        attrs: { 'aria-label': `把「${habit.name}」设为当前养成目标` },
        on: { click: () => actions.switchHabit(habit.id) }
      })
    ]));
  }
  card.append(rows);
  return card;
}
