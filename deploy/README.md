# 部署 humansneeds.com

站点没有构建步骤：一个 Node 进程 + 一个反向代理。

## 线上实际配置

`humansneeds.com` 现在跑在下面这套配置上，从零部署时可以参考后面几节的通用示例，但以这里为准：

| 项 | 值 |
| --- | --- |
| 代码目录 | `/opt/humansneeds-site`（git 检出，跟随 `origin/master`） |
| 服务 | `humansneeds-site.service`，`node server.js`，监听 `127.0.0.1:3100` |
| 数据目录 | `/var/lib/humansneeds-site`（`DATA_DIR`） |
| 环境变量 | 写在 systemd unit 里：`HOST`、`PORT`、`DATA_DIR`、`ALLOWED_ORIGINS`、`TRUST_PROXY=loopback`、`COOKIE_SECURE`、`ENABLE_RATE_LIMIT` |
| 反向代理 | `/etc/nginx/sites-enabled/humansneeds`，`/`、`/habit/`、`/platform/` → `127.0.0.1:3100` |

## 自动部署（合并即上线）

服务器上有个 systemd timer 盯着 `origin/master`：

- `humansneeds-site-deploy.timer` 每 60 秒触发一次 `humansneeds-site-deploy.service`
- 发现新提交：`git reset --hard origin/master` → `package-lock.json` 变了才 `npm ci --omit=dev` → 重启 `humansneeds-site` → 自检 `/health`、`/`、`/habit/`、`/platform/`
- 自检失败会自动回滚到上一个提交并重启
- 手工触发一次：`systemctl start humansneeds-site-deploy.service`
- 看日志：`journalctl -u humansneeds-site-deploy -n 50`

所以 **PR 合并进 `master` 就是上线**，通常一分钟内生效，不需要登服务器。要回滚就在 GitHub 上 revert 那个 PR，不要在服务器上直接 `git reset` 抵着来——下一轮拉取会把它同步回去。

脚本在 `/usr/local/bin/humansneeds-site-deploy`，unit 文件在 `/etc/systemd/system/humansneeds-site-deploy.{service,timer}`。

合入知识与备份功能前，若线上 Nginx 用路径白名单区分主站与独立订单服务，需要把下列新主站 API 加入原有转发到 `3100` 的规则，并先通过 `nginx -t`。旧的订单、测试、拼豆接口及 `/needs/` 保持原有路由。

```text
/api/account
/api/holders
/api/knowledge-demand-answers
/api/knowledge-demand-bookmarks
/api/knowledge-demands
/api/practice-bookmarks
/api/practice-comments
/api/practice-replies
/api/product-wants
/api/profile
/api/profiles
/api/trees
/api/tutorial-search
/api/tutorials
```

上面的每个路径都包括其子路径。上线前以测试账号验收教程版本、备份导出和恢复、实践留言，以及既有私人需求和反馈隔离。可选的 `/review/` 由本地社区验收启动入口提供。

## 1. 机器上放代码

```bash
sudo useradd --system --home /opt/humansneeds --shell /usr/sbin/nologin humansneeds
sudo mkdir -p /opt/humansneeds /var/lib/humansneeds
sudo chown -R humansneeds:humansneeds /opt/humansneeds /var/lib/humansneeds
sudo -u humansneeds git clone https://github.com/puppetcat-fire/knowledge-habit-tracker.git /opt/humansneeds
cd /opt/humansneeds && sudo -u humansneeds npm ci --omit=dev
```

## 2. 环境变量

```bash
sudo tee /etc/humansneeds.env >/dev/null <<'EOF'
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/humansneeds
ALLOWED_ORIGINS=https://humansneeds.com,https://www.humansneeds.com
ENABLE_RATE_LIMIT=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=60
TRUST_PROXY=true
COOKIE_SECURE=true
EOF
```

## 3. systemd

```bash
sudo cp deploy/humansneeds.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now humansneeds
curl -s http://127.0.0.1:3000/health
```

## 4. Nginx + 证书

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/humansneeds.conf
sudo ln -s /etc/nginx/sites-available/humansneeds.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d humansneeds.com -d www.humansneeds.com
```

DNS 需要两条 A/AAAA 记录：`@` 和 `www` 都指向这台机器。

## 5. Docker（替代方案）

```bash
docker build -t humansneeds .
docker run -d --name humansneeds \
  -p 127.0.0.1:3000:3000 \
  -v humansneeds-data:/data \
  -e ALLOWED_ORIGINS=https://humansneeds.com,https://www.humansneeds.com \
  -e TRUST_PROXY=true \
  -e COOKIE_SECURE=true \
  humansneeds
```

## 6. INeedThis（/needs/）

`puppetcat-fire/humansneeds` 是独立的 Next.js 应用，挂在本站同域的 `/needs/` 下：

- 那个应用设 `basePath: "/needs"`，单独跑在 `127.0.0.1:3200`
- Nginx 的 `/needs/` location 反代到 3200（示例里已经写好）
- 它有自己的 SQLite 和写冷却，不读写本站的 `data/`
- 首页入口在 `site/index.html` 的 `03 · 需要` 卡片

如果以后改成子域名，把这一段 location 换成单独的 server 块即可。

## 备份

需要备份的是 `DATA_DIR`（默认 `/var/lib/humansneeds`）：

- `users.json`、`sessions.json`：账号与会话
- `states/`、`records.json`、`custom-nodes.json`、`media/`：账号数据和图片
- `bug-reports.jsonl`：反馈日志

`data/` 不要放进 Nginx 的静态目录，也不要在仓库里提交。
