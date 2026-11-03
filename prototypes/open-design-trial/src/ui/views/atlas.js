// 知识图谱：深蓝阅读空间里的目标节点与两类关系边（前置实线 / 实例虚线）。
// 只读 state，写只通过 actions；SVG 用命名空间逐个创建，不拼 innerHTML 字符串。
import { el, button } from '../dom.js';
import {
  tree,
  nodes,
  node as findNode,
  edges,
  litStatus,
  suggestNext
} from '../../domain/knowledge.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_RADIUS = 26;
// 草稿环的颜色与 tokens.css 的 --light 一致：SVG 展示属性里不能写 CSS 变量。
const DRAFT_RING_COLOR = '#ebd6a9';
const AREA_LABELS = { base: '基础', method: '方法', practice: '实践', principle: '原理' };
const AREA_ORDER = ['base', 'method', 'practice', 'principle'];

export function areaLabel(area) {
  return AREA_LABELS[area] || '其他';
}

export function litStatusLabel(status) {
  if (status === 'confirmed') return '已点亮';
  if (status === 'draft') return '点亮待确认';
  return '未点亮';
}

/** 建深蓝空间骨架：左侧舞台（图谱）+ 右侧面板，窄屏下面板是抽屉（CSS 处理）。 */
export function knowledgeLayout({ state, actions, selectedId = null, panelOpen = false, title = '知识图谱', subtitle = '' }) {
  const atlas = el('div', { class: 'atlas', dataset: { panelOpen: panelOpen ? 'true' : 'false' } });
  const panel = el('aside', {
    class: 'atlas-panel',
    id: 'atlas-panel',
    attrs: { 'aria-label': `${title}面板` }
  });
  const toggle = button('节点面板', {
    class: 'btn sm',
    dataset: { role: 'panel-toggle' },
    attrs: {
      title: '窄屏下打开节点面板抽屉',
      'aria-controls': 'atlas-panel',
      'aria-expanded': panelOpen ? 'true' : 'false'
    }
  });
  const setPanelOpen = (open) => {
    const next = Boolean(open);
    atlas.dataset.panelOpen = next ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => setPanelOpen(atlas.dataset.panelOpen !== 'true'));

  atlas.append(buildStage({ state, actions, selectedId, title, subtitle, toggle }), panel);
  return {
    page: el('div', { class: 'page page--atlas' }, [atlas]),
    atlas,
    panel,
    setPanelOpen
  };
}

export function renderAtlas({ state, route, actions }) {
  const graph = tree(state);
  const layout = knowledgeLayout({
    state,
    actions,
    selectedId: route.params?.nodeId || null,
    panelOpen: false,
    title: '知识图谱',
    subtitle: graph.subtitle || ''
  });
  renderOverviewPanel(layout.panel, { state, route, actions, setPanelOpen: layout.setPanelOpen });
  return layout.page;
}

/* ---------- 舞台：SVG 图谱 ---------- */

function buildStage({ state, actions, selectedId, title, subtitle, toggle }) {
  const items = nodes(state);
  const methodsCount = (tree(state).methods || []).length;
  const centers = new Map(items.map((item) => [item.id, { x: item.x, y: item.y }]));
  const edgeList = edges(state);
  const linked = new Map(items.map((item) => [item.id, new Set()]));
  for (const edge of edgeList) {
    if (linked.has(edge.from) && linked.has(edge.to)) {
      linked.get(edge.from).add(edge.to);
      linked.get(edge.to).add(edge.from);
    }
  }
  const confirmedCount = items.filter((item) => litStatus(state, item.id) === 'confirmed').length;

  const svg = svgNode('svg', {
    class: 'atlas-canvas',
    viewBox: '0 0 1100 780',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'group',
    'aria-label': `${title}：${items.length} 个目标节点，${edgeList.length} 条关系`
  });
  const edgeLayer = svgNode('g');
  const nodeLayer = svgNode('g');
  svg.append(edgeLayer, nodeLayer);

  const edgeRefs = drawEdges(edgeLayer, edgeList, centers);
  const nodeRefs = [];

  // 悬停/聚焦时只留下和它相连的节点与边，其余压暗；节点详情页把选中节点固定为高亮中心。
  function applyHighlight(activeId) {
    const near = activeId ? linked.get(activeId) : null;
    for (const entry of nodeRefs) {
      const visible = !activeId || entry.id === activeId || (near && near.has(entry.id));
      entry.el.setAttribute('opacity', visible ? '1' : '0.22');
    }
    for (const entry of edgeRefs) {
      const connected = !activeId || entry.from === activeId || entry.to === activeId;
      entry.el.setAttribute('opacity', connected ? '1' : '0.14');
    }
  }

  for (const item of items) {
    const center = centers.get(item.id);
    const status = litStatus(state, item.id);
    const group = svgNode('a', {
      class: 'atlas-node',
      href: `#/knowledge/atlas/${item.id}`,
      tabindex: '0',
      dataset: {
        lit: status === 'confirmed' ? 'true' : 'false',
        area: item.area,
        selected: item.id === selectedId ? 'true' : 'false'
      },
      attrs: { 'aria-label': `打开节点：${item.name}，${litStatusLabel(status)}` }
    });

    group.append(svgNode('circle', { cx: center.x, cy: center.y, r: NODE_RADIUS }));

    // 草稿态：已实践但还没确认点亮，用金色虚线圈标出来（确认后才变成实心金色）。
    if (status === 'draft') {
      const radius = NODE_RADIUS + 6;
      group.append(svgNode('path', {
        d: `M ${center.x - radius} ${center.y} A ${radius} ${radius} 0 1 1 ${center.x + radius} ${center.y} A ${radius} ${radius} 0 1 1 ${center.x - radius} ${center.y}`,
        fill: 'none',
        stroke: DRAFT_RING_COLOR,
        'stroke-width': '1.6',
        'stroke-dasharray': '3 5',
        'stroke-opacity': '0.9'
      }));
    }

    const label = svgNode('text', { x: center.x, y: center.y + NODE_RADIUS + 20, 'text-anchor': 'middle' });
    labelLines(item.name).forEach((line, index) => {
      label.append(svgNode('tspan', { x: center.x, dy: index === 0 ? 0 : 16 }, [line]));
    });
    group.append(label);

    const go = (event) => {
      event.preventDefault();
      actions.navigate('node-detail', { nodeId: item.id });
    };
    group.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      go(event);
    });
    group.addEventListener('keydown', (event) => {
      if (event.key === ' ') go(event);
    });
    group.addEventListener('mouseenter', () => applyHighlight(item.id));
    group.addEventListener('mouseleave', () => applyHighlight(selectedId));
    group.addEventListener('focus', () => applyHighlight(item.id));
    group.addEventListener('blur', () => applyHighlight(selectedId));

    nodeRefs.push({ id: item.id, el: group });
    nodeLayer.append(group);
  }

  applyHighlight(selectedId);

  const toolbar = el('div', { class: 'atlas-toolbar' }, [
    el('div', { class: 'atlas-title' }, [
      el('span', { text: title }),
      subtitle ? el('small', { text: subtitle }) : null
    ]),
    el('div', { class: 'row tight' }, [
      el('span', { class: 'chip plain small', text: `${items.length} 个目标` }),
      el('span', { class: 'chip plain small', text: `${methodsCount} 个方法` }),
      el('span', { class: 'chip gold plain small', text: `已点亮 ${confirmedCount}` })
    ]),
    toggle
  ]);

  return el('div', { class: 'atlas-stage' }, [
    svg,
    toolbar,
    el('div', { class: 'atlas-hint', text: '点节点进入详情 · Tab 逐个聚焦' })
  ]);
}

/** 两类边分开画：前置推荐（实线）与实例（虚线）。同一对节点有两类关系时弯向两侧。 */
function drawEdges(layer, edgeList, centers) {
  const pairCount = new Map();
  for (const edge of edgeList) {
    const key = `${edge.from}|${edge.to}`;
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }
  const refs = [];
  for (const edge of edgeList) {
    const from = centers.get(edge.from);
    const to = centers.get(edge.to);
    if (!from || !to) continue;
    const doubled = (pairCount.get(`${edge.from}|${edge.to}`) || 0) > 1;
    const bend = doubled
      ? (edge.kind === 'prereq' ? 1 : -1) * 34
      : (edge.kind === 'prereq' ? 12 : -12);
    const path = svgNode('path', {
      class: `atlas-edge ${edge.kind}`,
      d: curvePath(from, to, bend),
      'data-from': edge.from,
      'data-to': edge.to,
      'stroke-opacity': '0.9'
    });
    layer.append(path);
    refs.push({ from: edge.from, to: edge.to, el: path });
  }
  return refs;
}

function curvePath(from, to, bend) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const startX = from.x + ux * (NODE_RADIUS + 8);
  const startY = from.y + uy * (NODE_RADIUS + 8);
  const endX = to.x - ux * (NODE_RADIUS + 10);
  const endY = to.y - uy * (NODE_RADIUS + 10);
  const controlX = (startX + endX) / 2 - uy * bend;
  const controlY = (startY + endY) / 2 + ux * bend;
  return `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

/* ---------- 右侧面板：图例、下一个目标、全部节点 ---------- */

function renderOverviewPanel(panel, { state, route, actions, setPanelOpen }) {
  const graph = tree(state);
  const items = nodes(state);
  const confirmed = items.filter((item) => litStatus(state, item.id) === 'confirmed').length;
  const drafts = items.filter((item) => litStatus(state, item.id) === 'draft').length;

  panel.append(el('div', { class: 'card-head' }, [
    el('h2', { text: '知识空间' }),
    el('div', { class: 'card-actions' }, [
      button('收起', {
        class: 'btn sm ghost',
        dataset: { role: 'panel-close' },
        attrs: { title: '窄屏下收起节点面板', 'aria-label': '收起节点面板' },
        on: { click: () => setPanelOpen(false) }
      })
    ])
  ]));
  panel.append(el('p', { class: 'hint', text: graph.title }));
  panel.append(legendBlock());
  panel.append(el('div', { class: 'row tight' }, [
    el('span', { class: 'chip gold plain small', text: `已点亮 ${confirmed}` }),
    drafts ? el('span', { class: 'chip muted plain small', text: `草稿 ${drafts}` }) : null,
    el('span', { class: 'chip plain small', text: `未点亮 ${items.length - confirmed - drafts}` })
  ]));

  const focusId = route.params?.nodeId || null;
  const focusNode = focusId ? findNode(state, focusId) : null;
  if (focusNode) panel.append(focusCard(actions, focusNode, litStatus(state, focusNode.id)));
  else panel.append(suggestionCard(state, actions));

  panel.append(el('p', { class: 'card-title', text: '全部节点' }));
  for (const area of AREA_ORDER) {
    const group = items.filter((item) => item.area === area);
    if (!group.length) continue;
    panel.append(el('div', { class: 'stack tight' }, [
      el('p', { class: 'hint', text: `${areaLabel(area)} · ${group.length} 个` }),
      el('div', { class: 'candidate-list' }, group.map((item) => nodeRow(state, actions, item)))
    ]));
  }
}

function legendBlock() {
  return el('div', { class: 'atlas-legend', attrs: { 'aria-label': '图谱图例' } }, [
    el('span', { class: 'legend-item' }, [
      el('span', { class: 'legend-swatch', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: '推荐前置' })
    ]),
    el('span', { class: 'legend-item' }, [
      el('span', { class: 'legend-swatch dashed', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: '实例' })
    ]),
    el('span', { class: 'legend-item' }, [
      el('span', { class: 'legend-dot', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: '已点亮' })
    ])
  ]);
}

function nodeRow(state, actions, item) {
  const status = litStatus(state, item.id);
  const children = [el('span', { class: 'cand-name', text: item.name })];
  if (status === 'confirmed') children.push(el('span', { class: 'chip gold plain small', text: '已点亮' }));
  if (status === 'draft') children.push(el('span', { class: 'chip muted plain small', text: '草稿' }));
  children.push(el('span', { class: 'cand-time', text: `${item.estMinutes} 分钟` }));
  return el('button', {
    class: 'candidate-item',
    type: 'button',
    attrs: { 'aria-label': `查看节点：${item.name}，${litStatusLabel(status)}` },
    on: { click: () => actions.navigate('node-detail', { nodeId: item.id }) }
  }, children);
}

function suggestionCard(state, actions) {
  const card = el('div', { class: 'card' });
  const suggestion = suggestNext(state);
  if (!suggestion) {
    card.append(el('p', { class: 'hint', text: '带方法的目标都已点亮。可以在下面挑一个节点继续看。' }));
    return card;
  }
  const { node: target, method, ready, missing } = suggestion;
  card.append(el('p', { class: 'hint', text: '下一个可开始的目标' }));
  card.append(el('div', { class: 'card-title', text: target.name }));
  card.append(el('p', { class: 'hint', text: target.goal }));
  card.append(el('div', { class: 'row tight' }, [
    el('span', { class: 'chip plain small', text: `${target.estMinutes} 分钟` }),
    el('span', { class: 'chip plain small', text: areaLabel(target.area) }),
    method ? el('span', { class: 'chip plain small', text: method.title }) : null
  ]));
  if (ready) {
    card.append(el('p', { class: 'hint', text: '前置都已点亮，可以直接开始。' }));
  } else {
    const names = missing.map((id) => findNode(state, id)?.name).filter(Boolean).join('、');
    card.append(el('p', { class: 'hint', text: names ? `前置还没点亮：${names}` : '还有前置没有点亮。' }));
  }
  const actionRow = el('div', { class: 'row tight' }, [
    button('查看节点详情', {
      class: 'btn sm',
      on: {
        click: () => actions.navigate('node-detail', {
          nodeId: target.id,
          methodId: method ? method.id : undefined
        })
      }
    })
  ]);
  if (ready && method) {
    actionRow.append(button('开始实践', {
      class: 'btn primary sm',
      on: { click: () => actions.startPractice(target.id, method.id) }
    }));
  }
  card.append(actionRow);
  return card;
}

function focusCard(actions, target, status) {
  return el('div', { class: 'card' }, [
    el('p', { class: 'hint', text: '当前节点' }),
    el('div', { class: 'card-title', text: target.name }),
    el('p', { class: 'hint', text: target.goal }),
    el('div', { class: 'row tight' }, [
      el('span', { class: `chip plain small${status === 'confirmed' ? ' gold' : ''}`, text: litStatusLabel(status) })
    ]),
    el('div', { class: 'row tight' }, [
      button('查看节点详情', {
        class: 'btn primary sm',
        on: { click: () => actions.navigate('node-detail', { nodeId: target.id }) }
      })
    ])
  ]);
}

/* ---------- 手工 SVG 与标签折行 ---------- */

function svgNode(tag, props = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  const { class: className, text, attrs = {}, on = {}, dataset = {}, ...rest } = props;
  if (className) element.setAttribute('class', className);
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined) element.setAttribute(`data-${key}`, String(value));
  }
  // SVG 的 cx/cy/d/viewBox 等没有对应的 DOM 属性，一律按属性名写入。
  for (const [key, value] of Object.entries({ ...rest, ...attrs })) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const [type, handler] of Object.entries(on)) element.addEventListener(type, handler);
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** 节点名称折成一到两行（SVG 不会自动换行），优先在标点处断开。 */
function labelLines(name, maxPerLine = 8) {
  const chars = Array.from(String(name || ''));
  if (chars.length <= maxPerLine) return [chars.join('')];
  if (chars.length <= maxPerLine * 2) {
    const middle = Math.ceil(chars.length / 2);
    for (let offset = 0; offset <= 3; offset += 1) {
      for (const pivot of [middle + offset, middle - offset]) {
        if (pivot > 0 && pivot < chars.length && /[，、；\s]/.test(chars[pivot - 1])) {
          return [chars.slice(0, pivot).join('').trim(), chars.slice(pivot).join('').trim()];
        }
      }
    }
    return [chars.slice(0, middle).join(''), chars.slice(middle).join('')];
  }
  const lines = [];
  for (let index = 0; index < chars.length; index += maxPerLine) {
    lines.push(chars.slice(index, index + maxPerLine).join(''));
  }
  return lines;
}
