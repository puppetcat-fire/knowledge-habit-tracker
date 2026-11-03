// 读取原型批注，按 Markdown 打印，供人或 agent 直接照批注改原型。
// 用法：node scripts/read-prototype-comments.js [原型目录] [--json] [--open-only]
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const dirArg = args.find((a) => !a.startsWith('--'));
const dir = path.resolve(__dirname, '..', dirArg || 'prototypes/interaction-review');

function readComments() {
  const file = path.join(dir, 'comments.json');
  if (!fs.existsSync(file)) return { file, payload: null, comments: [] };
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const comments = Array.isArray(payload) ? payload : Array.isArray(payload.comments) ? payload.comments : [];
  return { file, payload, comments };
}

function readProject() {
  const file = path.join(dir, 'project.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const { file, comments } = readComments();
  const project = readProject();
  const screenName = (id) => {
    const screen = project && project.screens ? project.screens.find((s) => s.id === id) : null;
    return screen ? screen.name : id || '未知页面';
  };
  const elementLabel = (c) => c.elementText || (c.elementId ? c.elementId : '整页');
  const stamp = (c) => new Date(Number(c.createdAt) || 0).toLocaleString('zh-CN');

  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify({ dir: path.relative(process.cwd(), dir), comments }, null, 2) + '\n');
    return 0;
  }

  const open = comments.filter((c) => !c.resolved);
  const done = comments.filter((c) => c.resolved);
  if (!comments.length) {
    console.log(`没有批注：${path.relative(process.cwd(), file) || file} 不存在或为空。`);
    console.log('在原型编辑器里点右上角「批注」写一条，保存后这里就能读到。');
    return 0;
  }

  const line = (c) => `- **[${screenName(c.screenId)} · ${elementLabel(c)}]** ${c.text.replace(/\n+/g, ' ')}  <sub>${stamp(c)}${c.elementId ? ' · 元素 ' + c.elementId : ' · 整页'}</sub>`;
  const out = [];
  out.push(`# 交互原型批注 · ${(project && project.title) || '未命名原型'}`);
  out.push('');
  out.push(`来源：\`${path.relative(process.cwd(), file)}\`，未处理 ${open.length} 条，已处理 ${done.length} 条。`);
  if (flags.has('--open-only')) {
    out.push('', `## 待处理（${open.length}）`);
    out.push(open.length ? open.map(line).join('\n') : '（无）');
  } else {
    out.push('', `## 待处理（${open.length}）`);
    out.push(open.length ? open.map(line).join('\n') : '（无）');
    out.push('', `## 已处理（${done.length}）`);
    out.push(done.length ? done.map(line).join('\n') : '（无）');
  }
  console.log(out.join('\n'));
  return 0;
}

process.exit(main());
