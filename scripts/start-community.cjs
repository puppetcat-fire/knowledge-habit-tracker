const path = require("node:path");
const { createAuthenticatedActionApp } = require("../prototypes/community-review/integration/authenticated-app.cjs");

const port = Number(process.env.PORT || 3105);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../data/community-local"));
const discussionModeratorIds = (process.env.DIANLIANG_DISCUSSION_MODERATOR_IDS || "")
  .split(",").map(id => id.trim()).filter(Boolean);
const { app } = createAuthenticatedActionApp({
  dataDir,
  reviewDirectory: path.join(dataDir, "review-assets"),
  port,
  host,
  discussionModeratorIds
});

app.listen(port, host, () => {
  const origin = `http://${host.includes(":") ? "[" + host + "]" : host}:${port}`;
  console.log(`站点首页 ${origin}/`);
  console.log(`习惯记录 ${origin}/habit/`);
  console.log(`知识平台 ${origin}/platform/`);
  console.log(`知识社区 ${origin}/review/`);
});
