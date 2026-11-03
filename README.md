# humansneeds.com

渡鸦大人（[puppetcat-fire](https://github.com/puppetcat-fire)）的个人工具站。

这里不只是一个习惯记录器：根路径是门面页，把做过的工具收在一起；两个应用挂在子路径下，共用同一套服务、账号和数据目录。INeedThis 是隔壁的独立站点，域名指向 `needs.humansneeds.com`。

| 路径 | 是什么 | 代码 |
| --- | --- | --- |
| `/` | 个人主页：工具导航、关于、反馈 | `site/` |
| `/habit/` | 点亮 · 习惯记录器 | `index.html`、`app.js`、`style.css` |
| `/platform/` | 知识共建共享平台 | `platform.html`、`platform.js`、`platform.css` |
| `/api/*` | 账号、状态、记录、节点、反馈 | `server.js` |
| `/health` | 健康检查 | `server.js` |
| 旧地址 `/index.html`、`/platform.html`、`:3001` | 301 到新路径 | `server.js` |

## 快速开始

```bash
npm install
npm start
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。

默认只监听 `127.0.0.1`，账号、习惯、记录和反馈日志都写在本机的 `data/` 里。

> 安装时如果 `electron` 的 postinstall 因为缓存目录权限失败，用 `npm install --ignore-scripts` 即可；只有 `npm run desktop` 需要 electron 的二进制。

## 加一个新工具

首页的卡片是静态 HTML，改 `site/index.html` 就够了：

1. 复制一张 `<a class="tool-card" href="...">`，改 `tool-kicker`、标题、描述和链接；
2. 站内工具用 `/xxx/`，站外工具加 `rel="noopener" target="_blank"`；
3. 还没上线的用 `<div class="tool-card is-soon">`，不要留空链接；
4. 如果是新的 Node 应用，在 `server.js` 的 `PUBLIC_FILES` 里加白名单，只放会发出去的文件。

新增的站内工具如果也要走 `data/`，直接复用 `/api/*` 和 `state-sync.js` 即可。

## 反馈是怎么走的

反馈有两个入口，落点不同：

- 首页 `/` 的反馈表单、习惯页的「反馈与安全」页
- 两者都先 `POST /api/bugs`，写进 `data/bug-reports.jsonl`（只有本机/服务器看得到）
- 如果服务没起、或者是纯静态托管，页面会给出一个已经填好内容的 GitHub Issue 链接（仓库 `puppetcat-fire/knowledge-habit-tracker`，标签 `feedback`），也可以一键复制反馈内容

看最近的反馈：

```bash
curl http://127.0.0.1:3000/api/bugs
```

`/api/bugs` 只返回标题、级别、页面和时间，不返回联系方式、IP 和 User-Agent。

## 数据边界

### 留在浏览器里的

- 激活习惯、历史习惯、事件记录、计时器状态
- 点亮草稿与已确认的点亮
- 备份导出文件

### 留在 `data/` 里的

- 账号与会话（`users.json`、`sessions.json`）
- 按账号保存的状态（`states/`）、记录（`records.json`）、个人节点（`custom-nodes.json`）、图片（`media/`）
- 反馈日志（`bug-reports.jsonl`）

`data/` 不在静态白名单里，不会被当成静态资源发出去。习惯记录器本身仍然可以在纯 `file://` 下当作本地沙箱用，但首页和知识平台需要本机服务。

### 离线分发

拷贝文件离线用时，要一并带上 `seed-trees/`，否则森林功能区会整体隐藏，只保留一期的记录能力。

## 部署到 humansneeds.com

站点没有构建步骤，一个 Node 进程就够：

```bash
HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/humansneeds node server.js
```

前面放 Nginx 做 HTTPS，只开 80/443，Node 只监听本机。示例：

- [`deploy/nginx.conf.example`](deploy/nginx.conf.example)：443 反代、www 跳转、HSTS、10MB 请求体
- [`deploy/humansneeds.service`](deploy/humansneeds.service)：systemd 单元
- [`Dockerfile`](Dockerfile)：`docker build -t humansneeds . && docker run -p 127.0.0.1:3000:3000 -v humansneeds-data:/data humansneeds`

公网部署时至少要设：

```bash
HOST=127.0.0.1
ALLOWED_ORIGINS=https://humansneeds.com,https://www.humansneeds.com
ENABLE_RATE_LIMIT=true
TRUST_PROXY=true   # 在 Nginx 后面
COOKIE_SECURE=true # 上 HTTPS 之后
```

`ALLOWED_ORIGINS` 只影响 `/api/*` 的写请求。别把 `data/` 挂成静态目录，也别把 `server.js`、测试和文档放进静态白名单。

### INeedThis 放在哪里

INeedThis（[puppetcat-fire/humansneeds](https://github.com/puppetcat-fire/humansneeds)）是独立的 Next.js 应用，有自己的 SQLite 和写冷却，不和本站共用数据。推荐部署在子域名 `needs.humansneeds.com`，首页里已经指向这个地址；换地址只改 `site/index.html` 里那一张卡片的 `href`。

## 开发检查

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` 会跑服务端、前端 jsdom 和试作原型的测试。`npm run check` 是三件一起跑。

浏览器校验（原型试作那一套）需要一个 Chrome 或 Edge 的本地可执行文件；`scripts/trial-browser-check.cjs` 目前只探测 Windows 路径，Linux 上跑之前要补一条路径。

## 其它入口

### 可编辑交互原型

```bash
npm run prototype           # http://127.0.0.1:3102/
npm run prototype:check     # 校验原型数据和跳转
npm run prototype:comments  # 读回批注
```

### 按交互契约重做的试作

```bash
npm run trial        # http://127.0.0.1:3110/（?reset=1 重置）
npm run trial:test
npm run trial:check
```

需求与取舍见 [`docs/requirement-flow-review.md`](docs/requirement-flow-review.md)。

### 桌面悬浮计时窗

```bash
npm run desktop
```

主窗口加载 `/habit/`，悬浮窗加载 `/habit/overlay.html`，共用同一份本地状态。浏览器和 Electron 的 `localStorage` 不互通，迁移时先导出 JSON。

### Android 常驻小计时条

[`android-overlay`](android-overlay/README.md) 是一个单独的原生 MVP，用 Android Studio 直接打开。

## 待办

- 拼豆图纸页：上线后把首页 `04 · 手作` 那张卡片换成真实链接
- INeedThis 子域名 `needs.humansneeds.com` 的证书和反代
- 知识共建平台的身份、权限和审核流
- 节点候选升级成可编辑的教程节点

## 许可

MIT，见 [LICENSE](LICENSE)。
