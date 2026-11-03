// 账号（模拟）：不校验、不保存密码，只在本机记录名字。真实登录不在试作范围。
import { el, button, toast } from '../dom.js';

export function renderAuth({ state, actions }) {
  const tab = state.ui?.authTab === 'register' ? 'register' : 'login';
  const nameInput = el('input', {
    type: 'text',
    id: 'auth-name',
    value: '',
    attrs: { placeholder: '你的名字', autocomplete: 'username', maxlength: '40' }
  });
  const passwordInput = el('input', {
    type: 'password',
    id: 'auth-password',
    value: '',
    attrs: { placeholder: '任意密码（试作不保存、不校验）', autocomplete: 'current-password' }
  });

  const form = el('form', {
    class: 'stack',
    on: {
      submit: (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) {
          toast('先填名字');
          nameInput.focus();
          return;
        }
        if (tab === 'register') actions.register(name);
        else actions.login(name);
      }
    }
  }, [
    el('label', { class: 'field' }, [el('span', { text: '名字' }), nameInput]),
    el('label', { class: 'field' }, [el('span', { text: '密码' }), passwordInput]),
    el('p', { class: 'auth-note', text: '这是独立试作：账号只存在这台机器的浏览器里，密码不保存，也不连接任何后端。' }),
    button(tab === 'register' ? '注册并进入' : '登录并进入', { class: 'btn primary wide', type: 'submit' }),
    button('用演示账号直接进入', {
      class: 'btn ghost wide',
      type: 'button',
      on: { click: () => actions.register('演示账号') }
    })
  ]);

  const card = el('div', { class: 'card auth-card' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'brand-text', text: '点亮' })
    ]),
    el('div', { class: 'stack tight' }, [
      el('h1', { text: '把想做的事变成能开始的事' }),
      el('p', { class: 'muted small', text: '记录正在做的事和做完的事，剩下的交给记录本身。' })
    ]),
    el('div', { class: 'auth-tabs', attrs: { role: 'tablist', 'aria-label': '账号操作' } }, [
      tabButton('登录', tab === 'login', () => actions.setUi({ authTab: 'login' })),
      tabButton('注册', tab === 'register', () => actions.setUi({ authTab: 'register' }))
    ]),
    form,
    el('p', { class: 'auth-note', text: '试作说明：页面里的记录、习惯与知识都是模拟数据，不会读写真实账号或事件。' })
  ]);

  return el('div', { class: 'auth' }, [card]);
}

function tabButton(label, active, onClick) {
  return el('button', {
    class: 'chip' + (active ? ' active' : ''),
    type: 'button',
    attrs: { role: 'tab', 'aria-selected': active ? 'true' : 'false' },
    on: { click: onClick },
    text: label
  });
}
