// 轻量 DOM 与格式化工具。视图全部用 createElement 组装，不拼 innerHTML 字符串。
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { class: className, text, style, attrs = {}, on = {}, dataset = {}, ...rest } = props;
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (typeof style === 'string') node.style.cssText = style;
  else if (style && typeof style === 'object') Object.assign(node.style, style);
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined) node.dataset[key] = String(value);
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const [type, handler] of Object.entries(on)) node.addEventListener(type, handler);
  for (const [key, value] of Object.entries(rest)) {
    if (value !== null && value !== undefined) node[key] = value;
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, props = {}) {
  return el('button', { type: 'button', ...props, text: label });
}

export function link(label, href, props = {}) {
  return el('a', { href, ...props, text: label });
}

export function slot(tag = 'div', props = {}, children = []) {
  return el(tag, props, children);
}

/* ---------- 时间格式 ---------- */
export function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`;
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒` : `${minutes} 分`;
  return `${seconds} 秒`;
}

export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function fmtTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 精确到秒：战报与活动时间段用这个，短会话才看得出差别。 */
export function fmtTimeSec(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export function fmtDate(timestamp) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function fmtDateTime(timestamp) {
  return `${fmtDate(timestamp)} ${fmtTime(timestamp)}`;
}

export function fmtRange(segments) {
  return segments
    .map((segment) => `${fmtTime(segment.startedAt)}–${fmtTime(segment.endedAt ?? Date.now())}`)
    .join('，');
}

export function plural(count, unit) {
  return `${count} ${unit}`;
}

/* ---------- 焦点保持：整页重绘后把焦点和光标位置还给同一个输入框 ---------- */
export function preserveFocus(render) {
  const active = document.activeElement;
  const id = active && active.id ? active.id : null;
  const start = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const end = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  render();
  if (!id) return;
  const next = document.getElementById(id);
  if (!next || typeof next.focus !== 'function') return;
  next.focus();
  if (start !== null && typeof next.setSelectionRange === 'function' && next.value !== undefined) {
    try {
      next.setSelectionRange(start, end ?? start);
    } catch {
      /* 某些输入类型不支持 selection，忽略 */
    }
  }
}

/* ---------- 轻提示 ---------- */
let toastNode = null;
let toastTimer = null;
export function toast(text) {
  if (!toastNode) {
    toastNode = el('div', { class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(toastNode);
  }
  toastNode.textContent = text;
  toastNode.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastNode) toastNode.dataset.show = 'false';
  }, 2600);
}

export function clearToast() {
  if (toastNode) {
    toastNode.remove();
    toastNode = null;
  }
}
