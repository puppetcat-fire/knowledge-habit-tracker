# 安全说明

## 当前安全边界

这个项目按两层边界设计：

1. 习惯管理层：纯本地沙箱运行
2. 本机服务层：只负责静态页面和本机反馈日志

这意味着习惯、事件、计时和备份默认不会离开浏览器本地环境。

## 已做的安全收敛

- 静态资源改为显式白名单，只暴露：
  - `/`
  - `/index.html`
  - `/app.js`
  - `/style.css`
- 不再把整个项目根目录作为静态目录暴露
- 增加基础安全响应头：
  - `Content-Security-Policy`
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `Cross-Origin-Opener-Policy`
- Bug 反馈接口增加输入清洗和长度限制
- Bug 列表接口不返回联系方式、IP、User-Agent
- 默认监听 `127.0.0.1`
- 可选来源校验和速率限制

## 环境变量

可用环境变量：

- `PORT`
- `HOST`
- `DATA_DIR`
- `ALLOWED_ORIGINS`
- `ENABLE_RATE_LIMIT`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `TRUST_PROXY`

## 本地开发建议

- 默认使用 `HOST=127.0.0.1`
- 不要把 `data` 目录加入静态托管
- 养成导出 JSON 备份的习惯

## 阿里云部署建议

如果以后要部署到阿里云：

- Node 服务仍然尽量只监听本机或内网
- 用 Nginx 做 HTTPS 和反向代理
- 防火墙只开放 80/443
- `ALLOWED_ORIGINS` 只填你的正式域名
- `data` 目录放到单独可备份的位置
- 习惯管理数据继续保留在前端本地，不要与公开知识平台共库

## 还没做，但后续值得考虑

- 如果知识共建平台要接入多人协作，必须单独设计身份体系
- 如果要跨设备同步习惯数据，必须先设计授权和加密
- 如果 Bug 日志会被多人访问，需要再做权限控制和审计
