// 校验可编辑交互原型：数据格式、内嵌数据一致性、内联脚本语法、以及从起始屏能否点到每一屏。
// 用法：node scripts/check-prototype.js [原型目录]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.resolve(__dirname, '..', process.argv[2] || 'prototypes/interaction-review');
const projectFile = path.join(dir, 'project.json');
const htmlFile = path.join(dir, 'index.html');

// 与编辑器（skill/editable-prototype/assets/editor.html）和 server.cjs 相同的校验规则。
function validate(p) {
  const errors = [];
  if (!p || p.format !== 'editable-prototype/v1') errors.push('format 必须是 editable-prototype/v1');
  if (typeof p.id !== 'string' || !p.id) errors.push('id 缺失');
  if (typeof p.title !== 'string') errors.push('title 缺失');
  if (!Array.isArray(p.screens) || !p.screens.length || p.screens.length > 40) errors.push('screens 必须是 1-40 个页面');
  if (!Number.isFinite(p.width) || p.width < 240 || p.width > 1600) errors.push('width 超出 240-1600');
  if (!Number.isFinite(p.height) || p.height < 320 || p.height > 2400) errors.push('height 超出 320-2400');
  const ids = new Set();
  for (const s of p.screens) {
    if (typeof s.id !== 'string' || !s.id || ids.has(s.id)) errors.push(`页面 id 非法或重复：${String(s.id)}`);
    if (typeof s.name !== 'string') errors.push(`页面名称缺失：${String(s.id)}`);
    if (!Array.isArray(s.elements) || s.elements.length > 200) errors.push(`页面元素过多：${String(s.id)}`);
    ids.add(s.id);
    const elementIds = new Set();
    for (const e of s.elements) {
      if (typeof e.id !== 'string' || !e.id || elementIds.has(e.id)) errors.push(`元素 id 非法或重复：${String(e.id)}`);
      if (!['text', 'button', 'input', 'card'].includes(e.type)) errors.push(`元素类型非法：${String(e.id)}`);
      if (typeof e.text !== 'string' || e.text.length > 1000) errors.push(`元素文字非法：${String(e.id)}`);
      if (!['x', 'y', 'w', 'h'].every((k) => Number.isFinite(e[k]))) errors.push(`元素坐标非法：${String(e.id)}`);
      if (e.x < 0 || e.y < 0 || e.w < 20 || e.h < 20) errors.push(`元素小于最小尺寸：${String(e.id)}`);
      if (e.x + e.w > p.width || e.y + e.h > p.height) errors.push(`元素超出画布：${String(e.id)}`);
      if (e.target && typeof e.target !== 'string') errors.push(`跳转目标非法：${String(e.id)}`);
      elementIds.add(e.id);
    }
  }
  if (!ids.has(p.startScreen)) errors.push('startScreen 指向不存在的页面');
  for (const s of p.screens) {
    for (const e of s.elements) {
      if (e.target && !ids.has(e.target)) errors.push(`跳转指向不存在的页面：${s.id}/${e.id} -> ${e.target}`);
    }
  }
  return errors;
}

function walk(project, starts) {
  const seen = new Set(starts.filter((id) => project.screens.some((s) => s.id === id)));
  const queue = [...seen];
  while (queue.length) {
    const id = queue.shift();
    const screen = project.screens.find((s) => s.id === id);
    if (!screen) continue; // 悬空跳转由 validate() 报错，这里只保证不崩
    for (const e of screen.elements) {
      if (e.target && !seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return seen;
}

// 有些屏不是靠元素跳转到达，而是运行时脚本里 navigate('...') 进去的（例如历史记录里的「查看事件详情」）。
function dynamicEntries(html, project) {
  const ids = [...html.matchAll(/navigate\('([^']+)'\)/g)].map((m) => m[1]);
  return [...new Set(ids)].filter((id) => project.screens.some((s) => s.id === id));
}

// 批注（comments.json）：结构问题算错误，指向已删除页面/元素只算提醒。
function checkComments(file, project) {
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(file)) return { errors, warnings, list: null };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { errors: [`comments.json 不是合法 JSON：${error.message}`], warnings, list: [] };
  }
  const list = Array.isArray(payload) ? payload : payload && Array.isArray(payload.comments) ? payload.comments : null;
  if (!list) return { errors: ['comments.json 结构应为 {format, comments: []} 或数组'], warnings, list: [] };
  const screens = new Map(project.screens.map((s) => [s.id, s]));
  list.forEach((c, i) => {
    const at = `第 ${i + 1} 条批注`;
    if (!c || typeof c !== 'object') { errors.push(`${at} 不是对象`); return; }
    if (typeof c.text !== 'string' || !c.text.trim()) errors.push(`${at} 缺正文`);
    if (typeof c.resolved !== 'boolean') errors.push(`${at} 缺 resolved`);
    if (!Number.isFinite(Number(c.createdAt))) errors.push(`${at} 缺 createdAt`);
    const screen = screens.get(c.screenId);
    if (!screen) warnings.push(`${at} 指向不存在的页面 ${String(c.screenId)}`);
    else if (c.elementId && !screen.elements.some((e) => e.id === c.elementId)) warnings.push(`${at} 指向该页已不存在的元素 ${c.elementId}（页面「${screen.name}」）`);
  });
  return { errors, warnings, list };
}

// 内联脚本必须能解析：批注侧栏和编辑器都是内联脚本，插错一个字符整页就白屏。
function scriptErrors(html) {
  const errors = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let match;
  let index = 0;
  while ((match = pattern.exec(html))) {
    index += 1;
    if (/application\/json/.test(match[1])) continue;
    try {
      new vm.Script(match[2]);
    } catch (error) {
      errors.push(`第 ${index} 段内联脚本语法错误：${error.message}`);
    }
  }
  return errors;
}

function main() {
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const html = fs.readFileSync(htmlFile, 'utf8');
  const errors = validate(project);
  const inlineErrors = scriptErrors(html);

  const match = html.match(/<script id="prototype-data" type="application\/json">([\s\S]*?)<\/script>/);
  const embedded = match ? JSON.parse(match[1]) : null;
  const inSync = Boolean(embedded) && JSON.stringify(embedded) === JSON.stringify(project);

  const links = project.screens.reduce((n, s) => n + s.elements.filter((e) => e.target).length, 0);
  const dynamic = dynamicEntries(html, project);
  const staticOnly = walk(project, [project.startScreen]);
  const withRuntime = walk(project, [project.startScreen, ...dynamic]);
  const unreachable = project.screens.filter((s) => !withRuntime.has(s.id)).map((s) => s.id);
  const comments = checkComments(path.join(dir, 'comments.json'), project);

  console.log(`原型目录：${path.relative(process.cwd(), dir) || '.'}`);
  console.log(`页面 ${project.screens.length} 个，画布 ${project.width}x${project.height}，起始屏 ${project.startScreen}`);
  console.log(`数据校验：${errors.length ? 'FAIL' : 'PASS'}`);
  errors.forEach((e) => console.log(`  - ${e}`));
  console.log(`index.html 内嵌数据与 project.json 一致：${inSync ? 'PASS' : 'FAIL'}`);
  if (!match) console.log('  - 未找到 script#prototype-data');
  console.log(`index.html 内联脚本可解析：${inlineErrors.length ? 'FAIL' : 'PASS'}`);
  inlineErrors.forEach((e) => console.log(`  - ${e}`));
  console.log(`静态跳转边 ${links} 条，从 ${project.startScreen} 点得到 ${staticOnly.size}/${project.screens.length} 屏`);
  if (dynamic.length) console.log(`  运行时 navigate() 还会进：${dynamic.join(', ')}`);
  console.log(`算上运行时入口后覆盖 ${withRuntime.size}/${project.screens.length} 屏`);
  if (unreachable.length) console.log(`  既没有元素跳转也没有运行时入口的屏：${unreachable.join(', ')}`);
  if (comments.list === null) {
    console.log('批注：还没有 comments.json（在原型编辑器右上角「批注」里写第一条）');
  } else {
    const open = comments.list.filter((c) => !c.resolved).length;
    console.log(`批注：${comments.errors.length ? 'FAIL' : 'PASS'}（未处理 ${open} 条 / 共 ${comments.list.length} 条），用 npm run prototype:comments 读全文`);
    comments.errors.forEach((e) => console.log(`  - ${e}`));
    comments.warnings.forEach((w) => console.log(`  ~ ${w}`));
  }

  process.exit(errors.length === 0 && inSync && inlineErrors.length === 0 && comments.errors.length === 0 ? 0 : 1);
}

main();
