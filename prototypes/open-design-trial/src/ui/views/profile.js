// 个人主页：账号、真实统计、实践时间线、知识足迹与演示数据管理。
// 只用真实存在的数据，不编造隐私、社交或能力评分。
import { el, button, fmtDate, fmtDuration, fmtTime, toast } from '../dom.js';
import { finished, durationOf } from '../../domain/events.js';
import { currentHabit } from '../../domain/habits.js';
import { node as findNode, methodOf } from '../../domain/knowledge.js';

const TIMELINE_LIMIT = 12;

export function renderProfile({ state, actions }) {
  const account = state.account;
  const events = finished(state);
  const totalMs = events.reduce((total, event) => total + durationOf(event), 0);
  const confirmed = state.lightups.filter((item) => item.state === 'confirmed');
  const drafts = state.lightups.filter((item) => item.state === 'draft');
  const litNodes = new Set(confirmed.map((item) => item.nodeId));
  const habit = currentHabit(state);

  return el('div', { class: 'page' }, [
    el('div', { class: 'page-head' }, [
      el('div', { class: 'profile-head' }, [
        el('div', { class: 'avatar', attrs: { 'aria-hidden': 'true' }, text: initialOf(account?.name) }),
        el('div', { class: 'stack tight' }, [
          el('h1', { class: 'page-title', text: account?.name || '演示账号' }),
          el('p', { class: 'page-sub', text: '本地试作账号 · 记录只存在这台机器的浏览器里' })
        ])
      ])
    ]),
    el('div', { class: 'page-body' }, [
      statsBlock(events.length, totalMs, litNodes.size, habit),
      el('div', { class: 'grid-side' }, [
        timelineCard(state, actions, events),
        footprintCard(state, actions, confirmed, drafts)
      ]),
      dataCard(state, actions),
      rulesCard()
    ])
  ]);
}

/* ---------- 免费、赞赏与收益：只说明规则和示例账目，不接支付 ---------- */
function rulesCard() {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack tight' }, [
        el('div', { class: 'card-title', text: '免费、赞赏与收益' }),
        el('div', { class: 'card-sub', text: '规则说明与示例账目；试作不接支付，也不伪造收入' })
      ])
    ]),
    el('ul', { class: 'stack tight' }, [
      el('li', { class: 'hint', text: '完整免费使用。养成没有付费门槛，不会解锁任何功能，也不弹强制付费墙。' }),
      el('li', { class: 'hint', text: '达成「同一习惯连续四周、每周至少五次」后，可以自愿赞赏 2–5 元，或把产品与公司理念推荐给别人。' }),
      el('li', { class: 'hint', text: '教程里需要的产品外链可带约 0.5% 的抽成（示例费率，不是已签渠道费率）。抽成的一半分给对应节点持有者，另一半归平台。' }),
      el('li', { class: 'hint', text: '公共节点属于全部点亮者，私人节点属于个人；抽成不影响推荐排序。' })
    ]),
    el('table', { class: 'rules-table' }, [
      el('caption', { text: '示例账目（不是真实收入，也不代表已结算）' }),
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '项目' }),
        el('th', { text: '金额' }),
        el('th', { text: '说明' })
      ])]),
      el('tbody', {}, [
        el('tr', {}, [el('td', { text: '有效订单' }), el('td', { class: 'num', text: '1,000.00 元' }), el('td', { text: '教程里外链带来的订单示例' })]),
        el('tr', {}, [el('td', { text: '抽成（0.5%）' }), el('td', { class: 'num', text: '5.00 元' }), el('td', { text: '候选费率' })]),
        el('tr', {}, [el('td', { text: '节点持有者池' }), el('td', { class: 'num', text: '2.50 元' }), el('td', { text: '公共节点归全部点亮者，私人节点归个人' })]),
        el('tr', {}, [el('td', { text: '平台' }), el('td', { class: 'num', text: '2.50 元' }), el('td', { text: '另一半' })])
      ])
    ]),
    el('p', {
      class: 'hint',
      text: '尚未确定：公共持有者池内部的分配权重、有效点亮口径、订单归因窗口、多节点归因、退款冲销、费率基数与舍入。这些不擅自决定，也不在试作里呈现为已结算。'
    })
  ]);
}

function initialOf(name) {
  const text = String(name || '演示').trim();
  if (!text) return '演';
  const first = Array.from(text)[0];
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
}

function statsBlock(eventCount, totalMs, litCount, habit) {
  return el('div', { class: 'stats' }, [
    stat('已完成事件', String(eventCount)),
    stat('实际总时长', fmtDuration(totalMs)),
    stat('已点亮节点', String(litCount)),
    stat('养成中习惯', habit ? habit.name : '无')
  ]);
}

function stat(label, value) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-num', text: value })
  ]);
}

function timelineCard(state, actions, events) {
  const recent = events.slice(0, TIMELINE_LIMIT);
  const sub = events.length > recent.length
    ? `最近 ${recent.length} 条已完成事件，共 ${events.length} 条`
    : `最近 ${recent.length} 条已完成事件`;
  const body = recent.length
    ? el('div', { class: 'timeline' }, recent.map((event) => timelineItem(state, actions, event)))
    : el('p', { class: 'empty', text: '还没有完成的事件。' });
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack tight' }, [
        el('div', { class: 'card-title', text: '实践时间线' }),
        el('div', { class: 'card-sub', text: sub })
      ]),
      el('div', { class: 'card-actions' }, [
        button('全部记录', { class: 'btn sm ghost', on: { click: () => actions.navigate('records') } })
      ])
    ]),
    body
  ]);
}

function timelineItem(state, actions, event) {
  const knowledge = event.knowledge || null;
  const target = knowledge ? findNode(state, knowledge.nodeId) : null;
  const body = el('div', { class: 'timeline-body' });
  body.append(el('div', { class: 'row tight' }, [
    el('span', { class: 'card-title', text: event.name }),
    el('span', { class: 'hint', text: fmtDuration(durationOf(event)) })
  ]));
  if (target) {
    body.append(el('div', { class: 'row tight' }, [
      button(target.name, {
        class: 'chip',
        attrs: { 'aria-label': `打开知识节点：${target.name}` },
        on: {
          click: () => actions.navigate('node-detail', {
            nodeId: target.id,
            methodId: knowledge.methodId || undefined
          })
        }
      })
    ]));
  }
  const notes = (event.notes || []).length;
  if (notes) body.append(el('p', { class: 'hint', text: `${notes} 条笔记` }));
  return el('div', { class: 'timeline-item' }, [
    el('time', { attrs: { datetime: new Date(event.endedAt).toISOString() } }, [
      fmtDate(event.endedAt),
      el('br'),
      fmtTime(event.endedAt)
    ]),
    body
  ]);
}

function footprintCard(state, actions, confirmed, drafts) {
  const sorted = confirmed
    .slice()
    .sort((a, b) => (b.confirmedAt ?? b.at) - (a.confirmedAt ?? a.at));
  const rows = [];
  for (const item of sorted) {
    const target = findNode(state, item.nodeId);
    if (!target) continue;
    const method = item.methodId ? methodOf(state, item.methodId) : null;
    rows.push(el('button', {
      class: 'candidate-item',
      type: 'button',
      attrs: { 'aria-label': `查看已点亮节点：${target.name}` },
      on: {
        click: () => actions.navigate('node-detail', {
          nodeId: target.id,
          methodId: item.methodId || undefined
        })
      }
    }, [
      el('span', { class: 'stack tight' }, [
        el('span', { class: 'cand-name', text: target.name }),
        el('span', {
          class: 'hint',
          text: [method ? method.title : '未记录方法', item.visibility === 'public' ? '公开' : '仅自己可见'].join(' · ')
        })
      ]),
      el('span', { class: 'chip gold plain small', text: '已点亮' }),
      el('span', { class: 'cand-time', text: fmtDate(item.confirmedAt ?? item.at) })
    ]));
  }

  const children = [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack tight' }, [
        el('div', { class: 'card-title', text: '知识足迹' }),
        el('div', { class: 'card-sub', text: `已确认点亮 ${rows.length} 个目标` })
      ])
    ])
  ];
  children.push(rows.length
    ? el('div', { class: 'candidate-list' }, rows)
    : el('p', { class: 'empty', text: '还没有确认过点亮。去知识图谱挑一个目标，做完一次实践后确认点亮。' }));

  if (drafts.length) {
    const draftNodes = drafts.map((item) => findNode(state, item.nodeId)).filter(Boolean);
    children.push(el('p', { class: 'hint', text: `另有 ${draftNodes.length} 条点亮草稿待确认；确认之后才会进入足迹。` }));
    children.push(el('div', { class: 'row tight' }, draftNodes.map((target) => button(`去确认：${target.name}`, {
      class: 'btn sm',
      on: { click: () => actions.navigate('node-detail', { nodeId: target.id }) }
    }))));
  }

  return el('div', { class: 'card' }, children);
}

function dataCard(state, actions) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack tight' }, [
        el('div', { class: 'card-title', text: '演示数据' }),
        el('div', { class: 'card-sub', text: '只存在这台机器的浏览器里，没有后端' })
      ])
    ]),
    el('p', {
      class: 'hint',
      text: '这是独立试作：记录、习惯、知识与点亮都是模拟数据，保存在本机浏览器的 localStorage 里。导出会下载当前状态的 JSON 文件。'
    }),
    el('p', { class: 'hint', text: '重置会清空当前浏览器里的演示数据，恢复到初始状态。' }),
    el('div', { class: 'row tight' }, [
      button('导出为 JSON', {
        class: 'btn',
        on: { click: () => exportState(state) }
      }),
      button('重置演示数据', { class: 'btn danger', on: { click: () => actions.resetAll() } })
    ])
  ]);
}

function exportState(state) {
  try {
    if (!state) throw new Error('没有可导出的状态');
    if (typeof Blob !== 'function' || !globalThis.URL || typeof URL.createObjectURL !== 'function') {
      throw new Error('不支持下载');
    }
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {
      href: url,
      attrs: { download: `dianliang-trial-${new Date().toISOString().slice(0, 10)}.json`, rel: 'noopener' }
    });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出当前演示数据');
  } catch {
    toast('这个浏览器不允许直接下载，导出没有完成');
  }
}
