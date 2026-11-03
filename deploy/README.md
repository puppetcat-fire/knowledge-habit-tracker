# 部署 humansneeds.com

站点没有构建步骤：一个 Node 进程 + 一个反向代理。下面是最短路径。

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

## 6. INeedThis

`puppetcat-fire/humansneeds` 是独立的 Next.js 应用，建议放在 `needs.humansneeds.com`，
单独的 DNS 记录、单独的证书、单独的 SQLite 数据卷。它和本仓不共用 `data/`。
首页的入口在 `site/index.html` 的 `03 · 需要` 卡片。

## 备份

需要备份的是 `DATA_DIR`（默认 `/var/lib/humansneeds`）：

- `users.json`、`sessions.json`：账号与会话
- `states/`、`records.json`、`custom-nodes.json`、`media/`：账号数据和图片
- `bug-reports.jsonl`：反馈日志

`data/` 不要放进 Nginx 的静态目录，也不要在仓库里提交。
