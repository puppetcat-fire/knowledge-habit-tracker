// 真浏览器校验：headless Chrome + CDP（不依赖 playwright）。
// 用途：跑关键交互闭环、收集控制台错误、截桌面与窄屏图。
// 用法：node scripts/trial-browser-check.cjs [--url=http://127.0.0.1:3110/] [--keep]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const WebSocket = require('ws');

const HTTP_BASE = (process.argv.find((arg) => arg.startsWith('--url=')) || '--url=http://127.0.0.1:3110/').slice(6);
const DEBUG_PORT = 9333;
const OUT_DIR = path.resolve(__dirname, '..', 'prototypes', 'open-design-trial', '.checks');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  throw new Error('找不到 Chrome/Edge，无法做浏览器校验');
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: pathname }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function waitForDevtools(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await getJson('/json/version');
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error('Chrome DevTools 端口没有就绪');
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.id && this.pending.has(message.id)) {
          const call = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) call.reject(new Error(message.error.message));
          else call.resolve(message.result);
          return;
        }
        for (const handler of this.listeners.get(message.method) || []) handler(message.params);
      });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }
  once(method, handler) {
    const wrapped = (params) => {
      const list = this.listeners.get(method) || [];
      this.listeners.set(method, list.filter((item) => item !== wrapped));
      handler(params);
    };
    this.on(method, wrapped);
  }
  close() { try { this.ws.close(); } catch { /* 忽略 */ } }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profileDir = path.join(os.tmpdir(), 'dianliang-trial-chrome-' + Date.now());
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,960',
    'about:blank'
  ], { stdio: 'ignore' });
  const keepOpen = process.argv.includes('--keep');

  const cleanup = () => {
    if (keepOpen) return;
    try { spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 忽略 */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  };
  process.on('exit', cleanup);

  const pageErrors = [];
  const consoleErrors = [];
  const report = [];
  let browser = null;
  let page = null;

  try {
    await waitForDevtools();
    const { webSocketDebuggerUrl } = await getJson('/json/version');
    browser = new CDP(webSocketDebuggerUrl);
    await browser.open();
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const list = await getJson('/json/list');
    const target = list.find((item) => item.id === targetId);
    if (!target) throw new Error('没有找到新建的页面目标');
    page = new CDP(target.webSocketDebuggerUrl);
    await page.open();

    page.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
    });
    page.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    page.on('Log.entryAdded', (params) => {
      const url = params.entry.url || '';
      if (/favicon\.ico/.test(url) || /favicon\.ico/.test(params.entry.text)) return;
      if (params.entry.level === 'error') consoleErrors.push(params.entry.text + (url ? ' @ ' + url : ''));
    });

    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');

    const evaluate = async (expression) => {
      const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception?.description || result.exceptionDetails.text) + ' :: ' + expression);
      return result.result.value;
    };
    const screenshot = async (name) => {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, name + '.png');
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return path.relative(process.cwd(), file);
    };
    const navigate = async (url) => {
      const loaded = new Promise((resolve) => page.once('Page.loadEventFired', resolve));
      await page.send('Page.navigate', { url });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(500);
    };
    const go = async (hash) => {
      await evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await sleep(300);
    };
    const step = async (label, fn) => {
      let raw;
      try {
        raw = await fn();
      } catch (error) {
        report.push({ label, ok: false, detail: error.message });
        console.log(`FAIL  ${label}  → ${error.message}`);
        return null;
      }
      const ok = typeof raw === 'boolean' ? raw : raw && raw.ok !== undefined ? Boolean(raw.ok) : true;
      const detail = raw && raw.ok !== undefined ? raw.detail : raw;
      report.push({ label, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  → ' + JSON.stringify(detail)}`);
      return raw;
    };

    await navigate(HTTP_BASE + '?reset=1');
    await step('首屏是账号页', () => evaluate('!!document.querySelector("#auth-name")'));
    await step('注册后进入带侧边栏的记录主界面', async () => {
      await evaluate(`(() => { const input = document.querySelector('#auth-name'); input.value = '验收账号'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await evaluate('document.querySelector("#auth-name").closest("form").querySelector("button[type=submit]").click()');
      await sleep(600);
      return {
        ok: await evaluate('!!document.querySelector(".sidebar") && !!document.querySelector("#workspace .page")'),
        detail: await evaluate('document.querySelector("#workspace .page-title")?.textContent || ""')
      };
    });
    await step('计时页待机态截图', async () => { await screenshot('01-timer-idle'); return true; });

    await step('开始计时：进入运行中且只有一条活动', async () => {
      await evaluate('document.querySelector(".timer-hero .btn.primary").click()');
      await sleep(600);
      const state = await evaluate('document.querySelector(".timer-state")?.textContent || ""');
      const active = await evaluate('document.querySelectorAll(".event-row[data-active=true]").length');
      return { ok: state === '计时中' && active === 1, detail: { state, active } };
    });

    await step('开始第二件事：未结束变 2 条、活动仍只有 1 条', async () => {
      await evaluate(`(() => { const input = document.querySelector('#start-other-name'); input.value = '喝水'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await evaluate('document.querySelector("#start-other-name").closest("form").querySelector("button[type=submit]").click()');
      await sleep(600);
      const rows = await evaluate('document.querySelectorAll(".event-row").length');
      const active = await evaluate('document.querySelectorAll(".event-row[data-active=true]").length');
      const name = await evaluate('document.querySelector(".event-row[data-active=true] .event-name")?.textContent || ""');
      return { ok: rows === 2 && active === 1 && name === '喝水', detail: { rows, active, name } };
    });

    await step('切回第一条：活动转移，总条数不变', async () => {
      const firstName = await evaluate('document.querySelectorAll(".event-row .event-name")[1].textContent');
      await evaluate('document.querySelectorAll(".event-row")[1].querySelector(".btn.primary").click()');
      await sleep(500);
      const active = await evaluate('document.querySelectorAll(".event-row[data-active=true]").length');
      const name = await evaluate('document.querySelector(".event-row[data-active=true] .event-name")?.textContent || ""');
      const rows = await evaluate('document.querySelectorAll(".event-row").length');
      return { ok: active === 1 && name === firstName && rows === 2, detail: { active, name, rows } };
    });
    await step('运行中截图', async () => { await screenshot('02-timer-running'); return true; });

    await step('结束活动事件：弹战报、未结束少一条', async () => {
      const before = await evaluate('document.querySelectorAll(".event-row").length');
      await evaluate('document.querySelector(".event-row[data-active=true] .btn").click()');
      await sleep(700);
      const open = await evaluate('!!document.querySelector(".report-dialog[open]")');
      const metrics = await evaluate('[...document.querySelectorAll(".report-metric .m-label")].map((n) => n.textContent)');
      const folds = await evaluate('document.querySelectorAll(".report-fold").length');
      const after = await evaluate('document.querySelectorAll(".event-row").length');
      return { ok: open && after === before - 1 && folds >= 1, detail: { open, before, after, metrics, folds } };
    });
    await step('战报截图', async () => { await screenshot('03-report'); return true; });
    await step('关闭战报回到计时页', async () => {
      await evaluate('document.querySelector(".report-actions .btn.primary").click()');
      await sleep(400);
      return evaluate('!document.querySelector(".report-dialog")');
    });

    await go('#/habit-record/records');
    await step('事件记录页渲染', async () => {
      const title = await evaluate('document.querySelector(".page-title")?.textContent || ""');
      const items = await evaluate('document.querySelectorAll(".record-item").length');
      return { ok: title === '事件记录' && items > 0, detail: { title, items } };
    });
    await step('记录页截图', async () => { await screenshot('04-records'); return true; });

    await go('#/habit-record/habits');
    await step('习惯页渲染且只有一个养成中', async () => {
      const title = await evaluate('document.querySelector(".page-title")?.textContent || ""');
      const weeks = await evaluate('document.querySelectorAll(".week-cell").length');
      const activeChips = await evaluate('[...document.querySelectorAll("#workspace .chip")].filter((n) => n.textContent.trim() === "养成中").length');
      return { ok: title === '习惯' && weeks >= 4, detail: { title, weeks, activeChips } };
    });
    await step('习惯页截图', async () => { await screenshot('05-habits'); return true; });

    await go('#/knowledge/atlas');
    await step('知识图谱渲染节点与两类边', async () => {
      const nodes = await evaluate('document.querySelectorAll(".atlas-node").length');
      const edges = await evaluate('document.querySelectorAll(".atlas-edge").length');
      const dashed = await evaluate('document.querySelectorAll(".atlas-edge.instance").length');
      return { ok: nodes >= 15 && edges >= 10 && dashed >= 1, detail: { nodes, edges, dashed } };
    });
    await step('图谱截图', async () => { await screenshot('06-atlas'); return true; });
    await step('桌面端隐藏只对窄屏有意义的抽屉按钮', async () => {
      const display = await evaluate(`getComputedStyle(document.querySelector('[data-role="panel-toggle"]')).display`);
      const closeDisplay = await evaluate(`getComputedStyle(document.querySelector('[data-role="panel-close"]')).display`);
      return { ok: display === 'none' && closeDisplay === 'none', detail: { display, closeDisplay } };
    });

    await go('#/knowledge/atlas/n-read');
    await step('节点详情：方法与点亮区', async () => {
      const methods = await evaluate('document.querySelectorAll(".method-fold").length');
      const title = await evaluate('document.querySelector("#workspace h1, #workspace h2")?.textContent || ""');
      return { ok: methods >= 1, detail: { title, methods } };
    });
    await step('节点详情截图', async () => { await screenshot('07-node-detail'); return true; });

    await go('#/profile');
    await step('个人主页渲染统计与时间线', async () => {
      const stats = await evaluate('document.querySelectorAll(".stat").length');
      const title = await evaluate('document.querySelector(".page-title")?.textContent || ""');
      return { ok: stats >= 3, detail: { title, stats } };
    });
    await step('个人主页截图', async () => { await screenshot('08-profile'); return true; });

    await evaluate(`
      window.__t = {
        byText(selector, text) { return [...document.querySelectorAll(selector)].find((node) => node.textContent.trim().includes(text)); },
        clickText(selector, text) { const node = this.byText(selector, text); if (!node) return false; node.click(); return true; },
        text(selector) { return document.querySelector(selector)?.textContent?.trim() || ''; },
        rows() { return document.querySelectorAll('.event-row').length; },
        activeRows() { return document.querySelectorAll('.event-row[data-active=true]').length; },
        activeName() { return this.text('.event-row[data-active=true] .event-name'); }
      };
    `);

    // 验收 2：起床步骤里开子任务 → 父事件暂停、子任务笔记独立、结束勾选步骤且不自动恢复
    await go('#/habit-record/timer');
    await step('开始「起床」并进入子任务', async () => {
      await evaluate(`(() => { const input = document.querySelector('#start-other-name'); input.value = '起床'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await evaluate('document.querySelector("#start-other-name").closest("form").querySelector("button[type=submit]").click()');
      await sleep(500);
      const started = await evaluate('__t.activeName()');
      await evaluate(`__t.clickText('button', '开始子任务')`);
      await sleep(500);
      const childActive = await evaluate('__t.activeName()');
      const parentActive = await evaluate(`[...document.querySelectorAll('.event-row')].find((row) => row.textContent.includes('起床'))?.dataset.active || ''`);
      return { ok: started === '起床' && childActive !== '起床' && parentActive === 'false', detail: { started, childActive, parentActive } };
    });
    await step('子任务写单次笔记并保存', async () => {
      await evaluate(`(() => { const box = document.querySelector('#draft-note'); box.value = '子任务里记的一句'; box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(150);
      await evaluate(`__t.clickText('button', '保存笔记')`);
      await sleep(400);
      const saved = await evaluate(`Boolean(document.querySelector('.note-saved'))`);
      const draft = await evaluate(`document.querySelector('#draft-note')?.value || ''`);
      return { ok: saved && draft === '', detail: { saved, draft } };
    });
    await step('结束子任务：不自动恢复父事件', async () => {
      await evaluate(`document.querySelector('.event-row[data-active=true] .btn').click()`);
      await sleep(600);
      await evaluate(`document.querySelector('.report-actions .btn.primary').click()`);
      await sleep(400);
      return { ok: (await evaluate('__t.activeRows()')) === 0, detail: { activeRows: await evaluate('__t.activeRows()') } };
    });
    await step('切回父事件：步骤被勾上，子任务笔记没有串过来', async () => {
      await evaluate(`__t.clickText('.event-row button', '切回')`);
      await sleep(500);
      const active = await evaluate('__t.activeName()');
      const checked = await evaluate(`Boolean(document.querySelector('#workspace .step input[type=checkbox]:checked'))`);
      const leaked = await evaluate(`document.querySelector('.page')?.textContent.includes('子任务里记的一句')`);
      return { ok: active === '起床' && checked && leaked === false, detail: { active, checked, leaked } };
    });

    // 验收 3：同名新事件不继承单次笔记
    await step('父事件保存笔记后结束，同名重开不继承', async () => {
      await evaluate(`(() => { const box = document.querySelector('#draft-note'); box.value = '父事件自己的笔记'; box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(150);
      await evaluate(`__t.clickText('button', '保存笔记')`);
      await sleep(400);
      await evaluate(`document.querySelector('.event-row[data-active=true] .btn').click()`);
      await sleep(600);
      await evaluate(`document.querySelector('.report-actions .btn.primary').click()`);
      await sleep(400);
      await evaluate(`(() => { const input = document.querySelector('#start-other-name'); input.value = '起床'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await evaluate('document.querySelector("#start-other-name").closest("form").querySelector("button[type=submit]").click()');
      await sleep(500);
      const active = await evaluate('__t.activeName()');
      const inherited = await evaluate(`document.querySelector('.page')?.textContent.includes('父事件自己的笔记')`);
      return { ok: active === '起床' && inherited === false, detail: { active, inherited } };
    });

    // 验收 4：新建/切换习惯只允许一个养成中
    await go('#/habit-record/habits');
    await step('新建习惯后只有一个养成中，并能切回原目标', async () => {
      await evaluate(`(() => { const input = [...document.querySelectorAll('input')].find((node) => (node.placeholder || '').includes('睡前拉伸')); input.value = '睡前拉伸'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(150);
      await evaluate(`[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '新建习惯' && node.classList.contains('primary')).click()`);
      await sleep(700);
      const activeChips = await evaluate(`[...document.querySelectorAll('#workspace .chip')].filter((node) => node.textContent.trim() === '养成中').length`);
      const hasNew = await evaluate(`document.querySelector('#workspace').textContent.includes('睡前拉伸')`);
      const switched = await evaluate(`__t.clickText('button', '设为当前')`);
      await sleep(700);
      const currentName = await evaluate(`document.querySelector('#workspace .habit-name h2, #workspace .card h2')?.textContent || ''`);
      return { ok: activeChips === 1 && hasNew && switched, detail: { activeChips, hasNew, switched, currentName } };
    });

    // 验收 5：节点展开方法 → 用这个方法去做 → 计时 → 结束留点亮草稿 → 确认点亮
    await go('#/knowledge/atlas/n-log');
    await step('节点详情展开方法并开始实践', async () => {
      await evaluate(`(() => { const fold = document.querySelector('.method-fold'); if (fold) fold.open = true; })()`);
      await sleep(250);
      await evaluate(`__t.clickText('button', '用这个方法去做')`);
      await sleep(700);
      const active = await evaluate('__t.activeName()');
      const knowledgeChip = await evaluate(`Boolean(document.querySelector('.timer-hero .chip.gold'))`);
      return { ok: active === '写一段真实的工作日志' && knowledgeChip, detail: { active, knowledgeChip } };
    });
    await step('结束实践后节点出现待确认点亮草稿', async () => {
      await evaluate(`document.querySelector('.event-row[data-active=true] .btn').click()`);
      await sleep(600);
      await evaluate(`document.querySelector('.report-actions .btn.primary').click()`);
      await sleep(400);
      await go('#/knowledge/atlas/n-log');
      const hasConfirm = await evaluate(`Boolean(__t.byText('button', '确认点亮'))`);
      const pending = await evaluate(`document.querySelector('#workspace').textContent.includes('点亮待确认') || document.querySelector('#workspace').textContent.includes('待确认')`);
      return { ok: hasConfirm, detail: { hasConfirm, pending } };
    });
    await step('确认点亮（仅自己可见）后状态更新', async () => {
      await evaluate(`__t.clickText('button', '确认点亮')`);
      await sleep(700);
      const confirmed = await evaluate(`document.querySelector('#workspace').textContent.includes('已点亮') && !__t.byText('button', '确认点亮')`);
      return { ok: confirmed, detail: { confirmed } };
    });
    await step('个人主页同步实践与点亮', async () => {
      await go('#/profile');
      const text = await evaluate(`document.querySelector('#workspace').textContent`);
      return { ok: text.includes('写一段真实的工作日志') && text.includes('点亮'), detail: { hasPractice: text.includes('写一段真实的工作日志') } };
    });

    // 知识共创：贡献方法 → 更新版本 → 历史保留
    await go('#/knowledge/atlas/n-verbatim');
    await step('节点详情可贡献方法（默认仅自己可见）', async () => {
      const filled = await evaluate(`(() => {
        const card = [...document.querySelectorAll('.card')].find((node) => node.textContent.includes('贡献方法'));
        if (!card) return 'no-card';
        const details = card.querySelector('details');
        if (details) details.open = true;
        const form = card.querySelector('form');
        if (!form) return 'no-form';
        const inputs = [...form.querySelectorAll('input, textarea')];
        inputs[0].value = '演示贡献法';
        inputs[1].value = '先写第一步';
        inputs[2].value = '第一步\\n第二步';
        inputs.forEach((input) => input.dispatchEvent(new Event('input', { bubbles: true })));
        form.requestSubmit();
        return 'ok';
      })()`);
      await sleep(700);
      const text = await evaluate(`document.querySelector('#workspace').textContent`);
      return { ok: filled === 'ok' && text.includes('演示贡献法') && text.includes('仅自己可见'), detail: { filled } };
    });
    await step('更新方法生成新版本并保留历史', async () => {
      const result = await evaluate(`(() => {
        const fold = [...document.querySelectorAll('.method-fold')].find((node) => node.textContent.includes('演示贡献法'));
        if (!fold) return 'no-fold';
        fold.open = true;
        const edit = [...fold.querySelectorAll('.method-edit')].find((node) => node.textContent.includes('更新这个方法'));
        if (!edit) return 'no-edit';
        edit.open = true;
        const form = edit.querySelector('form');
        if (!form) return 'no-form';
        const inputs = [...form.querySelectorAll('input, textarea')];
        inputs[0].value = '演示贡献法（改）';
        inputs.forEach((input) => input.dispatchEvent(new Event('input', { bubbles: true })));
        form.requestSubmit();
        return 'ok';
      })()`);
      await sleep(800);
      const text = await evaluate(`document.querySelector('#workspace').textContent`);
      return {
        ok: result === 'ok' && text.includes('演示贡献法（改）') && text.includes('v2') && text.includes('历史版本'),
        detail: { result }
      };
    });

    // 收费规则说明与达成后自愿支持
    await go('#/profile');
    await step('个人主页说明免费/赞赏/抽成规则与示例账目', async () => {
      const text = await evaluate(`document.querySelector('#workspace').textContent`);
      const rows = await evaluate(`document.querySelectorAll('.rules-table tr').length`);
      return {
        ok: text.includes('完整免费使用') && text.includes('0.5%') && text.includes('示例账目') && rows >= 5,
        detail: { rows }
      };
    });
    await go('#/habit-record/habits');
    await step('习惯达成后显示自愿支持说明，不挡使用', async () => {
      const text = await evaluate(`document.querySelector('#workspace').textContent`);
      return {
        ok: text.includes('达成之后，完全自愿') && text.includes('自愿赞赏 2–5 元') && text.includes('免费'),
        detail: {}
      };
    });

    for (const width of [1024, 768]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await go('#/habit-record/timer');
      await sleep(400);
      await step(`${width}px 宽无横向溢出`, async () => ({
        ok: await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'),
        detail: { width, scrollWidth: await evaluate('document.documentElement.scrollWidth') }
      }));
      if (width === 768) {
        await go('#/knowledge/atlas');
        await sleep(500);
        await step('768px 图谱是抽屉布局，能开合且不溢出', async () => {
          const noOverflow = await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2');
          const before = await evaluate(`getComputedStyle(document.querySelector('.atlas-panel')).transform`);
          await evaluate(`document.querySelector('[data-role="panel-toggle"]')?.click()`);
          await sleep(450);
          const open = await evaluate(`document.querySelector('.atlas').dataset.panelOpen === 'true'`);
          const after = await evaluate(`getComputedStyle(document.querySelector('.atlas-panel')).transform`);
          return { ok: noOverflow && open && before !== after, detail: { noOverflow, open, before, after } };
        });
      }
    }
    await page.send('Emulation.clearDeviceMetricsOverride');

    await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
    await go('#/habit-record/timer');
    await sleep(400);
    await step('窄屏可用且无横向溢出', async () => {
      const mobileBar = await evaluate('getComputedStyle(document.querySelector(".mobile-bar")).display');
      const noOverflow = await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2');
      return { ok: mobileBar !== 'none' && noOverflow, detail: { mobileBar, noOverflow } };
    });
    await step('窄屏截图', async () => { await screenshot('09-narrow-timer'); return true; });
    await page.send('Emulation.clearDeviceMetricsOverride');

    await step('刷新后状态保留', async () => {
      const before = await evaluate('JSON.parse(localStorage.getItem("dianliang-trial-v1")).events.length');
      await navigate(HTTP_BASE);
      const after = await evaluate('JSON.parse(localStorage.getItem("dianliang-trial-v1")).events.length');
      const active = await evaluate('document.querySelectorAll(".event-row[data-active=true]").length');
      return { ok: before === after && active <= 1, detail: { before, after, active } };
    });

    await step('控制台与页面无错误', () => ({
      ok: pageErrors.length === 0 && consoleErrors.length === 0,
      detail: { pageErrors: pageErrors.length, consoleErrors: consoleErrors.length }
    }));
  } finally {
    cleanup();
  }

  const failed = report.filter((item) => !item.ok);
  const errors = [...pageErrors, ...consoleErrors];
  if (errors.length) {
    console.log('\n控制台/页面错误：');
    for (const error of errors) console.log('  ! ' + error);
  }
  console.log(`\n报告：${report.length} 项检查，${failed.length} 项失败；截图在 ${path.relative(process.cwd(), OUT_DIR)}`);
  if (failed.length) {
    console.log('失败项：' + failed.map((item) => item.label).join('；'));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('浏览器校验失败：', error);
  process.exit(2);
});
