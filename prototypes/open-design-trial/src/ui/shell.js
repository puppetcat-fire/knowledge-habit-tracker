// 统一外壳：多级侧边栏（可收缩为时钟）+ 工作区。导航只出现一次，页面正文不再堆导航按钮。
import { el, button, fmtClock } from './dom.js';
import { activeEvent, durationOf } from '../domain/events.js';
import { currentHabit, isFormed } from '../domain/habits.js';
import { groupOf, hashFor } from '../router.js';

const GROUPS = [
  {
    id: 'habit-record',
    icon: '◷',
    title: '习惯记录',
    defaultRoute: 'timer',
    items: [
      { name: 'timer', label: '计时' },
      { name: 'habits', label: '习惯', expandable: true },
      { name: 'records', label: '事件记录' }
    ]
  },
  {
    id: 'knowledge',
    icon: '◈',
    title: '知识平台',
    defaultRoute: 'atlas',
    items: [{ name: 'atlas', label: '知识图谱' }]
  },
  {
    id: 'profile',
    icon: '☉',
    title: '我的空间',
    defaultRoute: 'profile',
    items: [{ name: 'profile', label: '个人主页' }]
  }
];

function habitChildren(state) {
  const items = [];
  const current = currentHabit(state);
  if (current) items.push({ route: 'habit-detail', params: { habitId: current.id }, label: current.name, tag: '养成中' });
  for (const habit of state.habits.filter((item) => isFormed(item))) {
    items.push({ route: 'habit-detail', params: { habitId: habit.id }, label: habit.name, tag: '已养成' });
  }
  return items;
}

function navLink(route, params, label, { active, sub, tag } = {}) {
  const node = el('a', {
    class: 'nav-link' + (sub ? ' sub' : ''),
    href: hashFor(route, params),
    attrs: active ? { 'aria-current': 'page' } : {}
  }, [el('span', { class: 'nav-label', text: label })]);
  if (tag) node.append(el('span', { class: 'chip muted', text: tag }));
  return node;
}

function expandedNav(state, route, actions) {
  const nav = el('nav', { class: 'nav', attrs: { 'aria-label': '主导航' } });
  for (const group of GROUPS) {
    const collapsed = state.ui.collapsedGroups.includes(group.id);
    const groupNode = el('div', { class: 'nav-group', dataset: { open: collapsed ? 'false' : 'true' } });
    const groupButton = el('button', {
      class: 'nav-group-button',
      type: 'button',
      attrs: { 'aria-expanded': collapsed ? 'false' : 'true' },
      on: { click: () => actions.toggleGroup(group.id) }
    }, [
      el('span', { class: 'nav-icon', text: group.icon, attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'nav-label', text: group.title }),
      el('span', { class: 'caret', text: '▸', attrs: { 'aria-hidden': 'true' } })
    ]);
    groupNode.append(groupButton);

    const children = el('div', { class: 'nav-children' });
    for (const item of group.items) {
      const active = route.name === item.name || (item.name === 'habits' && route.name === 'habit-detail');
      children.append(navLink(item.name, {}, item.label, { active }));
      if (item.expandable) {
        for (const child of habitChildren(state)) {
          children.append(navLink(child.route, child.params, child.label, {
            active: route.name === 'habit-detail' && route.params.habitId === child.params.habitId,
            sub: true,
            tag: child.tag
          }));
        }
      }
    }
    groupNode.append(children);
    nav.append(groupNode);
  }
  return nav;
}

function collapsedNav() {
  const nav = el('nav', { class: 'nav', attrs: { 'aria-label': '主导航（收缩）' } });
  for (const group of GROUPS) {
    nav.append(el('a', {
      class: 'nav-link',
      href: hashFor(group.defaultRoute),
      attrs: { 'aria-label': group.title, title: group.title }
    }, [el('span', { class: 'nav-icon', text: group.icon, attrs: { 'aria-hidden': 'true' } })]));
  }
  return nav;
}

export function clockValue(state, now = Date.now()) {
  const active = activeEvent(state);
  return { text: fmtClock(active ? durationOf(active, now) : 0), active };
}

function clockButton(state, actions) {
  const { text, active } = clockValue(state);
  return el('button', {
    class: 'nav-clock',
    type: 'button',
    dataset: { running: active ? 'true' : 'false', role: 'clock' },
    attrs: { 'aria-label': active ? `当前计时：${active.name}，点击回到计时` : '当前空闲，点击打开计时' },
    on: { click: () => actions.navigate('timer') }
  }, [
    el('span', { class: 'clock-value num', text, dataset: { role: 'clock-value' } }),
    el('span', { class: 'clock-label', text: active ? active.name : '空闲', dataset: { role: 'clock-label' } })
  ]);
}

export function renderShell(state, route, actions, viewNode) {
  const collapsed = Boolean(state.ui.sidebarCollapsed);
  const shell = el('div', { class: 'shell', dataset: { collapsed: collapsed ? 'true' : 'false' } });

  const sidebar = el('aside', { class: 'sidebar', attrs: { 'aria-label': '侧边栏' } });
  sidebar.append(el('div', { class: 'sidebar-head' }, [
    el('span', { class: 'brand' }, [
      el('span', { class: 'brand-mark', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'brand-text', text: '点亮' })
    ]),
    button(collapsed ? '»' : '«', {
      class: 'sidebar-toggle',
      attrs: { 'aria-label': collapsed ? '展开侧边栏' : '收起侧边栏', 'aria-expanded': collapsed ? 'false' : 'true' },
      on: { click: () => actions.toggleSidebar() }
    })
  ]));
  sidebar.append(collapsed ? collapsedNav() : expandedNav(state, route, actions));

  const foot = el('div', { class: 'sidebar-foot' }, [clockButton(state, actions)]);
  if (state.account) {
    foot.append(el('div', { class: 'row tight muted small' }, [
      el('span', { text: state.account.name }),
      button('退出', { class: 'btn ghost sm', on: { click: () => actions.logout() } })
    ]));
  }
  sidebar.append(foot);
  shell.append(sidebar);

  const workspace = el('div', { class: 'workspace' });
  workspace.append(el('div', { class: 'mobile-bar' }, [
    button('☰', {
      class: 'btn icon',
      attrs: { 'aria-label': '打开导航', 'aria-expanded': 'false' },
      on: {
        click: () => {
          document.body.dataset.navOpen = 'true';
          const close = (event) => {
            if (event.type === 'keydown' && event.key !== 'Escape') return;
            document.body.dataset.navOpen = 'false';
            document.removeEventListener('keydown', close);
            document.removeEventListener('click', close);
          };
          setTimeout(() => {
            document.addEventListener('click', close, { once: true });
            document.addEventListener('keydown', close);
          }, 0);
        }
      }
    }),
    el('span', { class: 'brand' }, [
      el('span', { class: 'brand-mark', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'brand-text', text: '点亮' })
    ]),
    el('span', { class: 'clock-value num', text: clockValue(state).text, dataset: { role: 'clock-value' } })
  ]));
  workspace.append(el('main', { id: 'workspace', attrs: { tabindex: '-1' } }, [viewNode]));
  shell.append(workspace);
  void groupOf;
  return shell;
}
