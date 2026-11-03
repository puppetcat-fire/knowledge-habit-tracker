# 安全说明

## 当前安全边界

humansneeds.com 是一个 Node 进程 + 三个页面区域：

1. 个人主页 `/`：纯静态，只有反馈表单会写服务端
2. 习惯记录器 `/habit/`：可以先在浏览器里当本地沙箱用；连上本机服务后，账号、习惯、事件和点亮写在这台机器的 `data/` 里
3. 知识共建共享平台 `/platform/`：节点和记录同样走 `/api/*`

三个页面共用同一个来源、同一个会话 Cookie 和同一份 `data/`。习惯数据不会自动上传到任何第三方。

## 已做的安全收敛

- 静态资源是显式白名单，只暴露：
  - `/`、`/site.css`、`/site.js`、`/favicon.svg`、`/robots.txt`、`/sitemap.xml`
  - `/habit/` 下的 `index.html`、`app.js`、`state-sync.js`、`style.css`、`overlay.html`、`overlay.js`
  - `/platform/` 下的 `platform.html`、`platform.js`、`state-sync.js`、`platform.css`
  - 两个应用各自的 `seed-trees/seed-trees.js`
- 仓库根目录不再作为静态目录：`server.js`、测试、文档、`data/` 都拿不到
- 安全响应头：`Content-Security-Policy`（无内联脚本）、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Cross-Origin-Opener-Policy`、`Permissions-Policy`
- 反馈接口做输入清洗和长度限制；列表接口不返回联系方式、IP、User-Agent
- 默认监听 `127.0.0.1`
- 可选来源校验（`ALLOWED_ORIGINS`）和 `/api/*` 速率限制
- 账号密码用 `scrypt` 加盐保存

## 环境变量

- `PORT`、`HOST`、`DATA_DIR`
- `ALLOWED_ORIGINS`
- `ENABLE_RATE_LIMIT`、`RATE_LIMIT_WINDOW_MS`、`RATE_LIMIT_MAX`
- `TRUST_PROXY`、`COOKIE_SECURE`
- `LEGACY_PLATFORM_PORT`（可选：给旧 3001 书签起一个只做 301 的监听）

## 本地开发建议

- 默认使用 `HOST=127.0.0.1`
- 不要把 `data/` 加进静态白名单，也不要让 Nginx 直接 alias 它
- 养成导出 JSON 备份的习惯

## 公网部署建议

- Node 只监听 `127.0.0.1:3000`，公网只开 80/443
- 用 Nginx/Caddy 做 HTTPS 和反向代理，示例见 [`deploy/nginx.conf.example`](deploy/nginx.conf.example)
- `ALLOWED_ORIGINS` 只填正式域名
- 打开 `ENABLE_RATE_LIMIT`，设置 `TRUST_PROXY=true` 以拿到真实客户端 IP，上 HTTPS 后设 `COOKIE_SECURE=true`
- 反馈日志放到独立磁盘或定时快照（`DATA_DIR=/var/lib/humansneeds`）
- 习惯数据继续保留在浏览器/本机，不要和公开知识平台共库

## 还没做，但后续值得考虑

- 知识共建平台要多人协作，必须单独设计身份体系、权限和审核
- 如果要跨设备同步习惯数据，先设计授权和加密，而不是直接上传
- 如果反馈日志要给多人看，需要再做权限控制和审计
- 首页的反馈兜底会把内容带到 GitHub Issue，提交前请提示用户不要写敏感信息
