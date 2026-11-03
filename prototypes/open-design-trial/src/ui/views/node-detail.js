// 节点详情：目标、关系、方法（默认折叠）、点亮确认与实践历史。
// 左侧保留知识图谱作为位置上下文（当前节点高亮），右侧是可滚动的详情面板。
import { el, button, fmtDate, fmtDateTime, fmtDuration, fmtTime, toast } from '../dom.js';
import {
  node as findNode,
  methodsOf,
  methodOf,
  methodHistoryOf,
  ownershipOf,
  prereqsOf,
  dependentsOf,
  nodes,
  lightupsOf,
  litStatus,
  practiceEvents
} from '../../domain/knowledge.js';
import { durationOf } from '../../domain/events.js';
import { knowledgeLayout, areaLabel, litStatusLabel } from './atlas.js';

export function renderNodeDetail({ state, route, actions }) {
  const nodeId = route.params?.nodeId || '';
  const target = findNode(state, nodeId);
  const layout = knowledgeLayout({
    state,
    actions,
    selectedId: target ? nodeId : null,
    panelOpen: true,
    title: '知识图谱',
    subtitle: target ? '左侧是它在知识空间里的位置' : '没有找到节点'
  });
  const { panel, setPanelOpen } = layout;

  panel.append(el('div', { class: 'row spread' }, [
    button('← 知识图谱', { class: 'btn sm', on: { click: () => actions.navigate('atlas') } }),
    button('收起', {
      class: 'btn sm ghost',
      attrs: { title: '窄屏下收起详情面板', 'aria-label': '收起节点详情面板' },
      on: { click: () => setPanelOpen(false) }
    })
  ]));

  if (!target) {
    panel.append(el('h2', { text: '找不到这个节点' }));
    panel.append(el('p', { class: 'hint', text: '节点可能已经被移除。回到知识图谱重新选一个目标。' }));
    panel.append(el('div', { class: 'row tight' }, [
      button('返回知识图谱', { class: 'btn primary sm', on: { click: () => actions.navigate('atlas') } })
    ]));
    return layout.page;
  }

  const status = litStatus(state, nodeId);
  const methods = methodsOf(state, nodeId);

  panel.append(el('h2', { text: target.name }));
  panel.append(el('div', { class: 'row tight' }, [statusChip(status)]));

  panel.append(goalCard(target, methods.length));
  panel.append(relationsCard(state, actions, target));
  panel.append(card('方法', methods.length
    ? methods.map((method) => methodFold(actions, nodeId, method, route.params?.methodId))
    : el('p', { class: 'hint', text: '这个节点还没有方法。可以先在计时页手动开始一次实践。' })));
  panel.append(contributeCard(state, actions, nodeId));
  panel.append(lightupCard(state, actions, nodeId));
  panel.append(historyCard(state, actions, nodeId));

  return layout.page;
}

function statusChip(status) {
  if (status === 'confirmed') return el('span', { class: 'chip gold plain small', text: litStatusLabel(status) });
  if (status === 'draft') return el('span', { class: 'chip muted plain small', text: litStatusLabel(status) });
  return el('span', { class: 'chip plain small', text: litStatusLabel(status) });
}

function card(title, children) {
  const list = [el('p', { class: 'card-title', text: title })];
  for (const child of [].concat(children)) if (child) list.push(child);
  return el('div', { class: 'card' }, list);
}

function goalCard(target, methodCount) {
  const ownership = ownershipOf(target);
  return card('目标', [
    el('p', { text: target.goal }),
    el('div', { class: 'row tight' }, [
      el('span', { class: 'chip plain small', text: `${target.estMinutes} 分钟` }),
      el('span', { class: 'chip plain small', text: areaLabel(target.area) }),
      el('span', { class: 'chip plain small', text: `${methodCount} 个方法` }),
      el('span', {
        class: 'chip plain small',
        text: ownership === 'public' ? '公共节点 · 属于全部点亮者' : '私人节点 · 只属于你'
      })
    ])
  ]);
}

function relationsCard(state, actions, target) {
  const instances = (target.examples || []).map((id) => findNode(state, id)).filter(Boolean);
  const parents = nodes(state).filter((item) => (item.examples || []).includes(target.id));
  return card('关系', [
    relationGroup(actions, state, '前置推荐', prereqsOf(state, target.id), '没有前置推荐，可以从这个目标开始。'),
    relationGroup(actions, state, '推荐给', dependentsOf(state, target.id), '还没有目标把它列为前置。'),
    relationGroup(actions, state, '实例', instances, '还没有实例。'),
    parents.length ? relationGroup(actions, state, '所属原理', parents, '') : null
  ]);
}

function relationGroup(actions, state, label, list, emptyText) {
  const children = [el('p', { class: 'hint', text: label })];
  if (list.length) {
    children.push(el('div', { class: 'row tight' }, list.map((item) => {
      const status = litStatus(state, item.id);
      return button(item.name, {
        class: `chip plain${status === 'confirmed' ? ' gold' : ''}`,
        attrs: { 'aria-label': `打开节点：${item.name}，${litStatusLabel(status)}` },
        on: { click: () => actions.navigate('node-detail', { nodeId: item.id }) }
      });
    })));
  } else {
    children.push(el('p', { class: 'hint', text: emptyText }));
  }
  return el('div', { class: 'stack tight' }, children);
}

function methodFold(actions, nodeId, method, openMethodId) {
  const history = methodHistoryOf(method);
  return el('details', { class: 'method-fold', open: method.id === openMethodId }, [
    el('summary', {}, [
      el('span', { text: method.title }),
      el('span', { class: 'chip muted plain small', text: `v${method.version}` })
    ]),
    el('div', { class: 'method-body' }, [
      el('div', { class: 'method-meta' }, [
        el('span', { text: `版本 v${method.version}` }),
        el('span', { text: method.visibility === 'public' ? '公开方法' : '仅自己可见' }),
        el('span', { text: `更新于 ${fmtDate(method.updatedAt)}` })
      ]),
      el('p', { class: 'practice-link', text: `前五分钟起步：${method.firstFive}` }),
      el('ol', {}, method.steps.map((step) => el('li', { text: step.text }))),
      el('div', { class: 'row tight' }, [
        button('用这个方法去做', {
          class: 'btn primary sm',
          on: { click: () => actions.startPractice(nodeId, method.id) }
        })
      ]),
      el('details', { class: 'method-edit' }, [
        el('summary', { text: '更新这个方法（生成新版本，历史保留）' }),
        methodForm({
          titleValue: method.title,
          firstFiveValue: method.firstFive,
          stepsValue: method.steps.map((step) => step.text).join('\n'),
          visibilityValue: method.visibility,
          submitLabel: '保存为新版本',
          onSubmit: (payload) => actions.addMethodVersion(method.id, payload)
        })
      ]),
      history.length
        ? el('details', { class: 'method-edit' }, [
            el('summary', { text: `历史版本（${history.length} 个）` }),
            el('div', { class: 'stack tight' }, history.slice().reverse().map((item) => el('div', { class: 'method-meta' }, [
              el('span', { text: `v${item.version}` }),
              el('span', { text: item.title }),
              el('span', { text: `更新于 ${fmtDate(item.updatedAt)}` }),
              el('span', { text: `${item.steps.length} 步` })
            ])))
          ])
        : null
    ])
  ]);
}

function methodForm({ titleValue = '', firstFiveValue = '', stepsValue = '', visibilityValue = 'private', submitLabel, onSubmit }) {
  const title = el('input', { type: 'text', value: titleValue, attrs: { placeholder: '方法名称', 'aria-label': '方法名称', maxlength: '80' } });
  const firstFive = el('textarea', { rows: 2, value: firstFiveValue, attrs: { placeholder: '前五分钟起步：先做哪一步', 'aria-label': '前五分钟起步' } });
  const steps = el('textarea', { rows: 4, value: stepsValue, attrs: { placeholder: '每行一个步骤', 'aria-label': '方法步骤，每行一个' } });
  const visibility = el('select', { attrs: { 'aria-label': '可见性' } }, [
    el('option', { value: 'private', text: '仅自己可见（默认）' }),
    el('option', { value: 'public', text: '公开给所有点亮者' })
  ]);
  visibility.value = visibilityValue;
  return el('form', {
    class: 'stack tight',
    on: {
      submit: (event) => {
        event.preventDefault();
        const name = title.value.trim();
        if (!name) {
          toast('先写方法名称');
          title.focus();
          return;
        }
        onSubmit({ title: name, firstFive: firstFive.value, steps: steps.value.split('\n'), visibility: visibility.value });
      }
    }
  }, [
    el('label', { class: 'field' }, [el('span', { text: '方法名称' }), title]),
    el('label', { class: 'field' }, [el('span', { text: '前五分钟起步' }), firstFive]),
    el('label', { class: 'field' }, [el('span', { text: '步骤（每行一个）' }), steps]),
    el('label', { class: 'field' }, [el('span', { text: '可见性' }), visibility]),
    el('div', { class: 'row tight' }, [
      button(submitLabel, { class: 'btn primary sm', type: 'submit' }),
      el('span', { class: 'hint', text: '默认只自己可见；公开是显式选择。贡献与版本不接评分，也不影响推荐排序。' })
    ])
  ]);
}

function contributeCard(state, actions, nodeId) {
  return card('贡献方法', el('details', { class: 'method-edit' }, [
    el('summary', { text: '写一个方法（默认仅自己可见）' }),
    methodForm({ submitLabel: '提交方法', onSubmit: (payload) => actions.addMethod(nodeId, payload) })
  ]));
}

function lightupCard(state, actions, nodeId) {
  const lightups = lightupsOf(state, nodeId);
  const confirmed = lightups.filter((item) => item.state === 'confirmed');
  const drafts = lightups.filter((item) => item.state === 'draft');
  const children = [];
  for (const item of confirmed) {
    const method = item.methodId ? methodOf(state, item.methodId) : null;
    const row = el('div', { class: 'row tight' }, [
      el('span', { class: 'chip gold plain small', text: '已点亮' }),
      el('span', {
        class: 'hint',
        text: `${fmtDateTime(item.confirmedAt ?? item.at)} · ${item.visibility === 'public' ? '公开' : '仅自己可见'}${method ? ` · ${method.title}` : ''}`
      })
    ]);
    if (item.eventId) {
      row.append(button('查看当时的记录', {
        class: 'btn sm ghost',
        on: { click: () => actions.navigate('event-detail', { eventId: item.eventId }) }
      }));
    }
    children.push(row);
  }
  for (const draft of drafts) children.push(draftBlock(state, actions, draft));
  if (!confirmed.length && !drafts.length) {
    children.push(el('p', {
      class: 'hint',
      text: '还没有点亮。用方法做完一次实践并结束后，这里会出现待确认的草稿。'
    }));
  }
  return card('点亮', children);
}

function draftBlock(state, actions, draft) {
  const practice = draft.eventId ? state.events.find((item) => item.id === draft.eventId) : null;
  const when = practice && practice.endedAt
    ? `有一次实践在 ${fmtDateTime(practice.endedAt)} 结束，点亮需要你自己确认。`
    : `这条点亮草稿创建于 ${fmtDateTime(draft.at)}，确认后才会算作点亮。`;
  return el('div', { class: 'stack tight' }, [
    el('p', { class: 'hint', text: when }),
    el('div', { class: 'row tight' }, [
      button('确认点亮（仅自己可见）', {
        class: 'btn gold sm',
        on: { click: () => actions.confirmLightup(draft.id, 'private') }
      }),
      button('确认并公开', {
        class: 'btn sm',
        on: { click: () => actions.confirmLightup(draft.id, 'public') }
      }),
      button('撤回', {
        class: 'btn ghost sm',
        attrs: { 'aria-label': '撤回这条点亮草稿' },
        on: { click: () => actions.removeLightup(draft.id) }
      })
    ]),
    el('p', { class: 'hint', text: '默认只自己可见；公开是显式动作，计时结束不会自动确认点亮。' })
  ]);
}

function historyCard(state, actions, nodeId) {
  const history = practiceEvents(state, nodeId);
  if (!history.length) {
    return card('实践历史', el('p', { class: 'hint', text: '这个节点还没有实践记录。开始一次之后，这里会出现历史。' }));
  }
  return card(`实践历史（${history.length} 次）`, el('div', { class: 'timeline' }, history.map((event) => historyItem(state, actions, event))));
}

function historyItem(state, actions, event) {
  const knowledge = event.knowledge || {};
  const method = knowledge.methodId ? methodOf(state, knowledge.methodId) : null;
  // 方法标题按当时的快照显示：方法后来更新，也不改写过去这次实践用的是哪一版。
  const methodLabel = knowledge.methodTitle || (method ? method.title : '');
  const meta = [fmtDuration(durationOf(event))];
  if (methodLabel) meta.push(`${methodLabel}${knowledge.methodVersion ? ` v${knowledge.methodVersion}` : ''}`);
  const notes = (event.notes || []).length;
  if (notes) meta.push(`${notes} 条笔记`);
  return el('div', { class: 'timeline-item' }, [
    el('time', { attrs: { datetime: new Date(event.endedAt).toISOString() } }, [
      fmtDate(event.endedAt),
      el('br'),
      fmtTime(event.endedAt)
    ]),
    el('div', { class: 'timeline-body' }, [
      el('div', { class: 'row tight' }, [
        el('span', { class: 'card-title', text: event.name }),
        el('span', { class: 'hint', text: meta.join(' · ') })
      ]),
      el('div', { class: 'row tight' }, [
        button('查看记录', {
          class: 'btn sm ghost',
          on: { click: () => actions.navigate('event-detail', { eventId: event.id }) }
        })
      ])
    ])
  ]);
}
