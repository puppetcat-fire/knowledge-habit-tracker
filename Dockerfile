# humansneeds.com 只需要 Node 22+ 和 express，没有构建步骤。
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# 站点入口、两个应用、种子树和反馈接口
COPY server.js state-sync.js app.js index.html style.css platform.html platform.js platform.css overlay.html overlay.js ./
COPY site ./site
COPY seed-trees ./seed-trees

RUN mkdir -p /data && chown -R node:node /app /data

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
