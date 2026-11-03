// 计时页：待机 / 运行中 / 多级切换是同一页的状态，不是三个导航页。
// 规则：同一时刻只有一条活动计时；开始另一件事=暂停当前；结束只结束该条；笔记跟随活动事件。
import { el, button, link, fmtDuration, fmtClock, fmtTime, toast } from '../dom.js';
import * as events from '../../domain/events.js';
import * as habits from '../../domain/habits.js';
import { candidateList } from '../../domain/candidates.js';
import { node as findNode, methodOf } from '../../domain/knowledge.js';
import { filterByRange, summarize } from '../../domain/records.js';

let pickerOpen = false;
let pickerQuery = '';
let pending = null;
let newEventName = '';
let newStepName = '';

function chip(text, extra = 'plain') {
  return el('span', { class: `chip ${extra}`, text });
}

function habitName(state, habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  return habit ? habit.name : null;
}

function historyNames(state) {
  const counts = new Map();
  for (const event of events.finished(state)) counts.set(event.name, (counts.get(event.name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function knowledgeChip(state, knowledge) {
  if (!knowledge || !knowledge.nodeId) return null;
  const node = findNode(state, knowledge.nodeId);
  if (!node) return null;
  const method = knowledge.methodId ? methodOf(state, knowledge.methodId) : null;
  return el('a', {
    class: 'chip gold',
    href: `#/knowledge/atlas/${node.id}`,
    attrs: { title: '查看这条记录关联的知识节点' }
  }, [el('span', { text: `${node.name}${method ? ` · ${method.title} v${method.version}` : ''}` })]);
}

/* ---------- 事件选择下拉（搜索；待机时选候选，计时中改名=纠正本条） ---------- */
function pickerPanel(state, actions, mode) {
  const active = events.activeEvent(state);
  const names = historyNames(state).filter((item) => !pickerQuery || item.name.includes(pickerQuery));
  const list = el('div', { class: 'event-picker-list' });
  for (const item of names.slice(0, 12)) {
    list.append(el('button', {
      class: 'event-picker-item',
      type: 'button',
      on: {
        click: () => {
          pickerOpen = false;
          pickerQuery = '';
          if (mode === 'rename') {
            if (active) actions.renameEvent(active.id, item.name);
          } else {
            pending = { name: item.name, habitId: null, knowledge: null, hint: '从历史里选的' };
            actions.rerender();
          }
        }
      }
    }, [el('span', { text: item.name }), el('span', { class: 'meta', text: `做过 ${item.count} 次` })]));
  }
  if (!names.length) list.append(el('p', { class: 'hint', text: '没有匹配的历史事件。带「+」的按钮可以直接用输入的名称。' }));

  const submit = () => {
    const value = pickerQuery.trim();
    if (!value) {
      toast('先写一个名称');
      return;
    }
    pickerOpen = false;
    pickerQuery = '';
    if (mode === 'rename') {
      if (active) actions.renameEvent(active.id, value);
    } else {
      pending = { name: value, habitId: null, knowledge: null, hint: '你自己写的' };
      actions.rerender();
    }
  };

  return el('div', { class: 'event-picker-panel' }, [
    el('input', {
      type: 'search',
      id: 'event-picker-search',
      value: pickerQuery,
      attrs: { placeholder: mode === 'rename' ? '搜索并改成正确的事件名' : '搜索做过的事，或直接输入新的', 'aria-label': '搜索事件' },
      on: {
        input: (event) => {
          pickerQuery = event.target.value;
          actions.rerender();
        },
        keydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }
      }
    }),
    list,
    el('div', { class: 'row tight' }, [
      button(mode === 'rename' ? '改正为这个名字' : '选这个名字', { class: 'btn sm primary', on: { click: submit } }),
      button('取消', {
        class: 'btn sm ghost',
        on: {
          click: () => {
            pickerOpen = false;
            pickerQuery = '';
            actions.rerender();
          }
        }
      })
    ])
  ]);
}

function pickerTrigger(label, state, actions, mode) {
  return el('div', { class: 'event-picker' }, [
    button(`${label} ▾`, {
      class: 'btn',
      attrs: { 'aria-expanded': pickerOpen ? 'true' : 'false', 'aria-haspopup': 'dialog' },
      on: {
        click: () => {
          pickerOpen = !pickerOpen;
          pickerQuery = '';
          actions.rerender();
        }
      }
    }),
    pickerOpen ? pickerPanel(state, actions, mode) : null
  ]);
}

/* ---------- 待机 ---------- */
function idleHero(state, actions) {
  const candidates = candidateList(state);
  if (!pending) pending = candidates[0] || null;
  const chosen = pending || candidates[0] || null;

  const hero = el('section', { class: 'timer-hero', attrs: { 'aria-label': '计时（待机）' } }, [
    el('div', { class: 'timer-main' }, [
      el('p', { class: 'timer-state', text: '待机' }),
      el('p', { class: 'timer-digits idle num', text: '00:00:00' }),
      el('div', { class: 'timer-event' }, [
        el('span', { class: 'event-name', text: chosen ? chosen.name : '先写一件要做的事' }),
        chosen && chosen.hint ? chip(chosen.hint, 'muted') : null,
        chosen && chosen.knowledge ? knowledgeChip(state, chosen.knowledge) : null
      ])
    ]),
    el('div', { class: 'timer-actions' }, [
      button('开始计时', {
        class: 'btn primary lg',
        attrs: { 'aria-label': chosen ? `开始计时：${chosen.name}` : '开始计时' },
        disabled: !chosen,
        on: {
          click: () => {
            if (!chosen) return;
            actions.startEvent({ name: chosen.name, habitId: chosen.habitId, knowledge: chosen.knowledge });
          }
        }
      }),
      pickerTrigger('改选事件', state, actions, 'select')
    ])
  ]);

  const candidateRows = el('div', { class: 'candidate-list' });
  for (const item of candidates) {
    if (chosen && item.name === chosen.name) continue;
    candidateRows.append(el('button', {
      class: 'candidate-item',
      type: 'button',
      on: {
        click: () => {
          pending = item;
          actions.rerender();
        }
      }
    }, [
      el('span', { class: 'cand-name', text: item.name }),
      chip(item.hint, 'muted'),
      el('span', { class: 'cand-time', text: item.source === 'knowledge' ? '来自知识路径' : item.source === 'habit' ? '当前习惯' : '历史记录' })
    ]));
  }

  const candidateCard = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('h2', { class: 'card-title', text: '最可能做的一件事' }),
        el('p', { class: 'card-sub', text: '按历史与知识路径排序，不显示虚构概率；点「开始计时」才算开始。' })
      ])
    ]),
    candidateRows,
    el('p', { class: 'hint', text: '候选排序只是建议，你可以改选或直接写一个名字。' })
  ]);

  return [hero, candidateCard];
}

/* ---------- 运行中 ---------- */
function runningHero(state, actions, active) {
  const parent = active.parentId ? events.findEvent(state, active.parentId) : null;
  const habit = active.habitId ? habitName(state, active.habitId) : null;
  return el('section', { class: 'timer-hero', attrs: { 'aria-label': '计时（运行中）' } }, [
    el('div', { class: 'timer-main' }, [
      el('p', { class: 'timer-state', text: active.parentId ? '子任务计时中' : '计时中' }),
      el('p', {
        class: 'timer-digits num',
        dataset: { role: 'live-duration', eventId: active.id },
        text: fmtClock(events.durationOf(active))
      }),
      el('div', { class: 'timer-event' }, [
        el('span', { class: 'event-name', text: active.name }),
        habit && habit !== active.name ? chip(`习惯：${habit}`, 'plain') : habit ? chip('习惯实践', 'plain') : null,
        active.parentId ? chip('子任务', 'plain') : null,
        active.knowledge ? knowledgeChip(state, active.knowledge) : null
      ]),
      parent
        ? el('p', { class: 'hint', text: `属于「${parent.name}」的步骤子任务。结束时会把父事件的这一步勾上，但不会自动结束父事件。` })
        : el('p', { class: 'hint', text: '改正名称只改这一条，不会新建记录；要开始另一件事用下面的「开始另一件事」。' })
    ]),
    el('div', { class: 'timer-actions' }, [
      button('结束', { class: 'btn primary lg', on: { click: () => actions.endEvent(active.id) } }),
      pickerTrigger('改正名称', state, actions, 'rename'),
      button('暂停', {
        class: 'btn ghost sm',
        attrs: { title: '暂停但不结束；记录会留在未结束列表里' },
        on: { click: () => actions.pauseActive() }
      })
    ])
  ]);
}

/* ---------- 未结束列表 ---------- */
function unfinishedCard(state, actions, active) {
  const rows = events.unfinished(state).slice().sort((a, b) => {
    if (active && a.id === active.id) return -1;
    if (active && b.id === active.id) return 1;
    return b.startedAt - a.startedAt;
  });

  const stack = el('div', { class: 'event-stack' });
  for (const event of rows) {
    const isActive = Boolean(active && active.id === event.id);
    const actionsCell = el('div', { class: 'event-actions' });
    if (isActive) {
      actionsCell.append(button('结束', { class: 'btn sm', on: { click: () => actions.endEvent(event.id) } }));
    } else {
      actionsCell.append(
        button('切回', { class: 'btn sm primary', on: { click: () => actions.switchTo(event.id) } }),
        button('结束', { class: 'btn sm ghost', attrs: { 'aria-label': `结束：${event.name}` }, on: { click: () => actions.endEvent(event.id) } })
      );
    }
    stack.append(el('div', { class: 'event-row', dataset: { active: isActive ? 'true' : 'false', eventId: event.id } }, [
      el('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }),
      el('div', { class: 'event-body' }, [
        el('span', { class: 'event-name', text: event.name }),
        el('span', { class: 'event-meta', text: `${isActive ? '正在计时' : '已暂停'} · 开始于 ${fmtTime(event.startedAt)}${event.parentId ? ' · 子任务' : ''}` })
      ]),
      el('span', { class: 'event-time num', dataset: { role: 'live-duration', eventId: event.id }, text: fmtClock(events.durationOf(event)) }),
      actionsCell
    ]));
  }

  const form = el('form', {
    class: 'row tight',
    on: {
      submit: (event) => {
        event.preventDefault();
        const name = newEventName.trim();
        if (!name) {
          toast('写一个要开始的名称');
          return;
        }
        actions.startEvent({ name });
        newEventName = '';
      }
    }
  }, [
    el('input', {
      type: 'text',
      id: 'start-other-name',
      value: newEventName,
      attrs: { placeholder: '开始另一件事（会暂停当前这条）', 'aria-label': '开始另一件事的名称' },
      on: { input: (event) => { newEventName = event.target.value; } }
    }),
    button('开始', { class: 'btn primary', type: 'submit' })
  ]);

  return el('section', { class: 'card flush' }, [
    el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('h2', { class: 'card-title', text: `未结束的 ${rows.length} 条` }),
        el('p', { class: 'card-sub', text: '同一时间只有一条在走。切回会暂停当前这条，结束只结束本条。' })
      ])
    ]),
    rows.length ? stack : el('p', { class: 'empty', text: '现在没有未结束的记录。' }),
    el('div', { style: 'padding: var(--s3) var(--s4) var(--s4)' }, [form])
  ]);
}

/* ---------- 单次笔记 ---------- */
function noteCard(state, actions, active) {
  const saved = el('div', { class: 'stack tight' }, active.notes.slice().reverse().map((note) => el('div', { class: 'note-item' }, [
    el('div', { text: note.text }),
    el('time', { text: fmtTime(note.at) })
  ])));

  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('h2', { class: 'card-title', text: '本次记录' }),
        el('p', { class: 'card-sub', text: '单次笔记只属于这一次记录，同名的新一次不会继承。' })
      ])
    ]),
    el('div', { class: 'note-editor' }, [
      el('textarea', {
        id: 'draft-note',
        rows: 3,
        value: active.draftNote,
        attrs: { placeholder: '这次记录的感受或体会，保存后成为本次的一条单次笔记', 'aria-label': '单次笔记草稿' },
        on: {
          input: (event) => actions.setDraftNote(active.id, event.target.value),
          keydown: (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              actions.saveNote(active.id);
            }
          }
        }
      }),
      el('div', { class: 'row tight' }, [
        // 输入走的是「不重绘」路径，按钮的 disabled 状态不会随输入更新，所以这里常可点；
        // 空内容由 actions.saveNote 统一拦下并提示。
        button('保存笔记', { class: 'btn', on: { click: () => actions.saveNote(active.id) } }),
        el('span', { class: 'hint', text: 'Ctrl/⌘ + Enter 也可以保存' })
      ])
    ]),
    active.notes.length
      ? el('details', { class: 'note-saved' }, [
          el('summary', { text: `已保存的单次笔记（${active.notes.length} 条）` }),
          saved
        ])
      : el('p', { class: 'hint', text: '还没有保存的笔记。保存后会收进折叠的已保存笔记。' })
  ]);
}

/* ---------- 重复笔记与步骤 ---------- */
function templateCard(state, actions, active) {
  const steps = events.stepsOf(state, active.name);
  const list = el('div', { class: 'steps' });

  for (const step of steps) {
    const done = active.stepDone.includes(step.id);
    const child = events.subtaskOf(state, active.id, step.id);
    list.append(el('div', { class: 'step', dataset: { done: done ? 'true' : 'false' } }, [
      el('input', {
        type: 'checkbox',
        class: 'step-check',
        checked: done,
        attrs: { 'aria-label': `步骤：${step.text}` },
        on: { change: (event) => actions.toggleStep(active.id, step.id, event.target.checked) }
      }),
      el('input', {
        type: 'text',
        class: 'step-text',
        id: `step-${step.id}`,
        value: step.text,
        attrs: { 'aria-label': `编辑步骤：${step.text}` },
        on: { change: (event) => actions.renameStep(active.name, step.id, event.target.value) }
      }),
      child ? el('span', { class: 'step-child', text: child.id === (events.activeEvent(state) || {}).id ? '子任务进行中' : '子任务已暂停' }) : null,
      el('div', { class: 'step-actions' }, [
        button(child ? '切回子任务' : '开始子任务', {
          class: 'btn sm ghost',
          on: {
            click: () => {
              const current = events.subtaskOf(state, active.id, step.id);
              if (current) actions.switchTo(current.id);
              else actions.startSubtask(active.id, step.id);
            }
          }
        }),
        button('×', {
          class: 'btn sm ghost',
          attrs: { 'aria-label': `删除步骤：${step.text}` },
          on: { click: () => actions.removeStep(active.name, step.id) }
        })
      ])
    ]));
  }

  const add = el('form', {
    class: 'row tight',
    on: {
      submit: (event) => {
        event.preventDefault();
        const text = newStepName.trim();
        if (!text) return;
        actions.addStep(active.name, text);
        newStepName = '';
      }
    }
  }, [
    el('input', {
      type: 'text',
      id: 'new-step',
      value: newStepName,
      attrs: { placeholder: '加一个步骤，例如「喝一杯水」', 'aria-label': '新步骤' },
      on: { input: (event) => { newStepName = event.target.value; } }
    }),
    button('添加', { class: 'btn sm', type: 'submit' })
  ]);

  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('h2', { class: 'card-title', text: '重复笔记与步骤' }),
        el('p', { class: 'card-sub', text: '按事件名称复用；勾选状态只属于本次记录，新一次会重新开始。' })
      ])
    ]),
    el('textarea', {
      id: 'repeated-note',
      rows: 2,
      value: events.repeatedNoteOf(state, active.name),
      attrs: { placeholder: '这类事情每次都要提醒自己的话（按名称复用）', 'aria-label': '重复笔记' },
      on: {
        input: (event) => actions.setRepeatedNote(active.name, event.target.value),
        change: (event) => actions.saveRepeatedNote(active.name, event.target.value)
      }
    }),
    steps.length ? list : el('p', { class: 'hint', text: '还没有步骤。可以加「喝水、刷牙」这样能逐项勾的动作。' }),
    add
  ]);
}

function knowledgeCard(state, active) {
  const node = active.knowledge && active.knowledge.nodeId ? findNode(state, active.knowledge.nodeId) : null;
  const method = active.knowledge && active.knowledge.methodId ? methodOf(state, active.knowledge.methodId) : null;
  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', {}, [
        el('h2', { class: 'card-title', text: '关联知识' }),
        el('p', { class: 'card-sub', text: node ? '这条记录固定了当时使用的方法版本，方法以后更新也不改变它。' : '这次记录没有关联知识节点。' })
      ])
    ]),
    node ? link(node.name, `#/knowledge/atlas/${node.id}`, { class: 'practice-link' }) : null,
    method ? el('p', { class: 'hint', text: `${method.title} · 版本 v${method.version}` }) : null,
    node
      ? el('p', { class: 'hint', text: '结束时只会留下点亮草稿，是否点亮由你自己确认。' })
      : link('去知识图谱找一个目标', '#/knowledge/atlas', { class: 'btn sm' })
  ]);
}

/* ---------- 页面 ---------- */
export function renderTimer({ state, actions }) {
  const active = events.activeEvent(state);
  const today = summarize(filterByRange(state.events, 'today'));
  const habit = habits.currentHabit(state);

  const page = el('div', { class: 'page' }, []);
  page.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { class: 'page-title', text: '计时' }),
      el('p', {
        class: 'page-sub',
        text: `今天已完成 ${today.count} 次 · 累计 ${fmtDuration(today.totalMs)}${habit ? ` · 当前习惯「${habit.name}」` : ''}`
      })
    ]),
    el('div', { class: 'page-actions' }, [
      link('事件记录', '#/habit-record/records', { class: 'btn sm ghost' }),
      link('知识图谱', '#/knowledge/atlas', { class: 'btn sm ghost' })
    ])
  ]));

  const body = el('div', { class: 'page-body' });
  if (active) {
    body.append(runningHero(state, actions, active));
    body.append(el('div', { class: 'grid-side' }, [
      el('div', { class: 'stack' }, [unfinishedCard(state, actions, active), noteCard(state, actions, active)]),
      el('div', { class: 'stack' }, [templateCard(state, actions, active), knowledgeCard(state, active)])
    ]));
  } else {
    const [hero, candidateCard] = idleHero(state, actions);
    body.append(hero);
    if (events.unfinished(state).length) body.append(unfinishedCard(state, actions, null));
    body.append(el('div', { class: 'grid-side' }, [
      el('div', { class: 'stack' }, [candidateCard]),
      el('div', { class: 'stack' }, [el('section', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { class: 'card-title', text: '说明' })]),
        el('p', { class: 'hint', text: '待机、计时中、结束战报都是同一页的状态，不是三个导航页。计时是正向累计，不设倒计时截止线。' }),
        el('p', { class: 'hint', text: '候选按历史与知识路径排序；没有证据时不显示虚构的概率数字。' })
      ])])
    ]));
  }
  page.append(body);
  return page;
}
