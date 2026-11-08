const express = require("express");
const nodeCrypto = require("node:crypto");
const fs = require("fs");
const path = require("path");
const { installKnowledgeService } = require("./knowledge-service");
const { installArchiveService } = require("./archive-service");
const { installProfileService } = require("./profile-service");
const { installPracticeDiscussion } = require("./practice-discussion");
const { recoverTransactions } = require("./storage-transaction");

const ROOT_DIR = __dirname;
const SESSION_COOKIE = "kht_session";
const SCRYPT_KEYLEN = 64;
const STATE_VERSION_MAX = 3;
const HABIT_PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/state-sync.js", "state-sync.js"],
  ["/product-rules.js", "product-rules.js"],
  ["/account-backup.js", "account-backup.js"],
  ["/style.css", "style.css"],
  ["/overlay.html", "overlay.html"],
  ["/overlay.js", "overlay.js"],
  ["/seed-trees/seed-trees.js", "seed-trees/seed-trees.js"]
]);

const PLATFORM_PUBLIC_FILES = new Map([
  ["/", "platform.html"],
  ["/platform.html", "platform.html"],
  ["/platform.js", "platform.js"],
  ["/personal-home.js", "personal-home.js"],
  ["/state-sync.js", "state-sync.js"],
  ["/product-rules.js", "product-rules.js"],
  ["/account-backup.js", "account-backup.js"],
  ["/platform.css", "platform.css"],
  ["/product.html", "product.html"],
  ["/product.js", "product.js"],
  ["/seed-trees/seed-trees.js", "seed-trees/seed-trees.js"]
]);

const SERVICE_NAMES = {
  habit: "knowledge-habit-tracker",
  platform: "knowledge-platform"
};

const SEED_NODE_FILE = path.join(ROOT_DIR, "seed-trees", "k9-math.json");
const CUSTOM_NODE_TREE_ID = "k9-math";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_RECORD = 4;
const RECORD_SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_ID_PATTERN = /^[0-9a-fA-F]+$/;

function createApp(overrides = {}) {
  const config = buildConfig(overrides);
  if (config.rateLimitEnabled) validateRateLimitConfig(config.rateLimitWindowMs, config.rateLimitMax);
  recoverTransactions(config.dataDir);
  const app = express();

  app.disable("x-powered-by");

  if (config.trustProxy) {
    app.set("trust proxy", config.trustProxy);
  }

  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:;");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
  });

  app.use(express.json({ limit: config.bodyLimit }));
  app.use("/api/", (req, res, next) => {
    try { recoverTransactions(config.dataDir); return next(); }
    catch (error) { return handleServerError(res, error); }
  });

  // 不依赖 CORS 来保护写操作；同源或明确配置的来源才可提交浏览器请求。
  app.use("/api/", (req, res, next) => {
    const origin = req.get("origin");
    if (!origin || origin === `${req.protocol}://${req.get("host")}` || config.allowedOrigins.includes(origin)) return next();
    return res.status(403).json({ ok: false, code: "ORIGIN_NOT_ALLOWED", message: "请求来源不在允许列表中。" });
  });
  const authLimiter = createRateLimiter(15 * 60 * 1000, 30);
  app.use("/api/login", authLimiter);
  app.use("/api/register", authLimiter);

  const limitApiRequest = config.rateLimitEnabled
    ? createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax)
    : (_req, _res, next) => next();
  app.use("/api/", limitApiRequest);

  function servePublicFiles(files, prefix = "") {
    files.forEach((fileName, route) => app.get(prefix + route, (_req, res) => {
      // 本地试用期间每次刷新都要看到最新资源，因此所有静态文件都不缓存
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(ROOT_DIR, fileName));
    }));
  }
  if (config.surface === "habit") {
    servePublicFiles(new Map([["/", "site-home.html"]]));
    for (const [prefix, files] of [["/habit", HABIT_PUBLIC_FILES], ["/platform", PLATFORM_PUBLIC_FILES], ["/knowledge", PLATFORM_PUBLIC_FILES]]) {
      app.get(new RegExp(`^${prefix}$`), (req, res) => {
        const query = req.originalUrl.slice(prefix.length);
        res.redirect(prefix + "/" + query);
      });
      servePublicFiles(files, prefix);
    }
    servePublicFiles(new Map([...HABIT_PUBLIC_FILES].filter(([route]) => route !== "/")));
  } else {
    servePublicFiles(PLATFORM_PUBLIC_FILES);
  }

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: SERVICE_NAMES[config.surface],
      time: new Date().toISOString(),
      host: config.host,
      rateLimitEnabled: config.rateLimitEnabled,
      allowedOrigins: config.allowedOrigins
    });
  });

  function serveRuntimeConfig(res, sameOrigin) {
    const localHost = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
    const habitUrl = config.habitUrl || (sameOrigin ? "/habit/" : `http://${localHost}:${config.port}/habit/`);
    const platformUrl = config.platformUrl || (sameOrigin ? "/platform/" : `http://${localHost}:${config.platformPort}/`);
    const runtime = { habitUrl, platformUrl, ...(sameOrigin && config.communityEnabled ? { communityUrl: "/review/" } : {}) };
    res.type("application/javascript").set("Cache-Control", "no-store").send(`window.KHTRuntime = ${JSON.stringify(runtime).replace(/</g, "\\u003c")};`);
  }
  app.get("/runtime-config.js", (_req, res) => serveRuntimeConfig(res, config.surface === "habit"));
  if (config.surface === "habit") {
    app.get(["/habit/runtime-config.js", "/platform/runtime-config.js", "/knowledge/runtime-config.js"], (_req, res) => serveRuntimeConfig(res, true));
  }

  app.get("/api/bugs", (req, res) => {
    try {
      const bugs = readBugReports(config.bugLogPath).map((bug) => ({
        id: bug.id,
        title: bug.title,
        severity: bug.severity,
        page: bug.page,
        createdAt: bug.createdAt
      }));
      res.json({ ok: true, bugs });
    } catch (error) {
      handleServerError(res, error);
    }
  });

  app.post("/api/bugs", (req, res) => {
    const validation = validateBugPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: validation.message
      });
    }

    const payload = validation.value;
    const report = {
      id: createId(),
      title: payload.title,
      description: payload.description,
      steps: payload.steps,
      expected: payload.expected,
      actual: payload.actual,
      severity: payload.severity,
      contact: payload.contact,
      page: payload.page,
      userAgent: req.get("user-agent") || "",
      ip: req.ip,
      createdAt: new Date().toISOString()
    };

    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.appendFileSync(config.bugLogPath, `${JSON.stringify(report)}\n`, "utf8");
      return res.json({
        ok: true,
        bug: {
          id: report.id,
          title: report.title,
          severity: report.severity,
          page: report.page,
          createdAt: report.createdAt
        },
        message: "问题反馈已写入本地日志。"
      });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/register", (req, res) => {
    const validation = validateCredentials(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: validation.message
      });
    }

    const { name, password } = validation.value;
    try {
      const users = readUsers(config);
      if (users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({
          ok: false,
          code: "NAME_TAKEN",
          message: "这个名字已经被注册了，换一个吧。"
        });
      }
      const record = {
        id: createUserId(),
        name,
        salt: nodeCrypto.randomBytes(16).toString("hex"),
        hash: ""
      };
      record.hash = nodeCrypto.scryptSync(password, record.salt, SCRYPT_KEYLEN).toString("hex");
      users.push(record);
      writeJsonFile(config.usersPath, users);
      const token = createSession(config, record.id);
      res.setHeader("Set-Cookie", sessionCookie(token, config));
      return res.status(201).json({ ok: true, user: { id: record.id, name: record.name } });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/login", (req, res) => {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!name || name.length > 24 || password.length < 8 || password.length > 72) return res.status(401).json({ ok: false, code: "INVALID_LOGIN", message: "名字或密码不对。" });
    try {
      const user = readUsers(config).find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (!user || !verifyPassword(password, user)) {
        return res.status(401).json({
          ok: false,
          code: "INVALID_LOGIN",
          message: "名字或密码不对。"
        });
      }
      const token = createSession(config, user.id);
      res.setHeader("Set-Cookie", sessionCookie(token, config));
      return res.json({ ok: true, user: { id: user.id, name: user.name } });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/logout", (req, res) => {
    try {
      const token = parseCookies(req.get("cookie"))[SESSION_COOKIE];
      if (token) {
        const sessions = readSessions(config);
        if (sessions[token]) {
          delete sessions[token];
          writeJsonFile(config.sessionsPath, sessions);
        }
      }
    } catch (error) {
      return handleServerError(res, error);
    }
    res.setHeader("Set-Cookie", clearSessionCookie(config));
    return res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    return res.json({ ok: true, user: { id: user.id, name: user.name } });
  });

  app.get("/api/state", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    if (req.get("X-Action-Account") && req.get("X-Action-Account") !== user.id) {
      return res.status(409).json({ ok: false, code: "ACTION_ACCOUNT_CHANGED", message: "账号已变化，请刷新页面。" });
    }
    try {
      const state = readAccountState(config, user.id);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, state, revision: stateRevision(state) });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.put("/api/state", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    if (req.get("X-Action-Account") && req.get("X-Action-Account") !== user.id) {
      return res.status(409).json({ ok: false, code: "ACTION_ACCOUNT_CHANGED", message: "账号已变化，请刷新页面。" });
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "状态必须是一个对象。"
      });
    }
    if (typeof body.version !== "number" || !Number.isFinite(body.version)) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "状态缺少合法的 version。"
      });
    }
    if (body.version > STATE_VERSION_MAX) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "状态来自更新的版本，请升级后再同步。"
      });
    }
    try {
      const current = readAccountState(config, user.id);
      const currentRevision = stateRevision(current);
      const revision = stateRevision(body);
      const expected = req.get("If-Match");
      if (revision === currentRevision) return res.json({ ok: true, revision });
      if (expected && expected !== currentRevision) {
        return res.status(409).json({
          ok: false, code: "STATE_CONFLICT",
          message: "另一窗口已更新账号记录。请先导出未保存记录，再读取已保存版本。"
        });
      }
      writeJsonFile(stateFilePath(config, user.id), body);
      return res.json({ ok: true, revision });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.get("/api/records", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    const treeId = typeof req.query.treeId === "string" ? req.query.treeId : "";
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
    const following = req.query.scope === "following";
    const mine = req.query.scope === "mine";
    const discovery = req.query.scope === "public" || following;
    const searching = discovery || mine;
    if (following && !config.communityEnabled) return res.status(404).json({ ok: false, message: "当前站点未启用社区关注。" });
    const { q = "", page = "1", authorId, order = "relevance" } = req.query;
    const { visibility = "all" } = req.query;
    if (mine && !["all", "public", "private"].includes(visibility)) {
      return res.status(400).json({ ok: false, message: "请选择有效的可见范围。" });
    }
    const { tutorialId, tutorialVersion } = req.query;
    const byTutorial = discovery && (tutorialId !== undefined || tutorialVersion !== undefined);
    if (byTutorial && (![tutorialId, tutorialVersion].every((value) => typeof value === "string" && RECORD_SCOPE_PATTERN.test(value)) || !treeId || !nodeId)) {
      return res.status(400).json({ ok: false, message: "请选择一个节点和完整的教程版本。" });
    }
    if (searching && order !== "relevance" && order !== "latest") {
      return res.status(400).json({ ok: false, message: "搜索排序无效。" });
    }
    if (discovery && authorId !== undefined && (typeof authorId !== "string" || !RECORD_SCOPE_PATTERN.test(authorId))) {
      return res.status(400).json({ ok: false, message: "作者标识无效。" });
    }
    if (searching && (typeof q !== "string" || q.length > 80 || typeof page !== "string" || !/^[1-9][0-9]{0,5}$/.test(page))) {
      return res.status(400).json({ ok: false, message: "请输入最多 80 字的搜索词。" });
    }
    try {
      const followed = following ? new Set(require("./prototypes/open-design-trial/integration/action-state.cjs")
        .readFollowedAuthors(config.dataDir, user.id).map((item) => item.id)) : null;
      const terms = searching ? q.normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
      const phrase = order === "relevance" ? terms.join(" ") : "";
      const relevance = new Map();
      const accessible = new Map();
      const records = readRecords(config)
        .filter((record) => (!treeId || record.treeId === treeId) && (!nodeId || record.nodeId === nodeId))
        .filter((record) => {
          if (mine && record.authorId !== user.id) return false;
          if (mine && visibility !== "all" && (record.visibility === "private" ? "private" : "public") !== visibility) return false;
          if (byTutorial && (record.tutorialId !== tutorialId || record.tutorialVersion !== tutorialVersion)) return false;
          if (discovery && authorId && record.authorId !== authorId) return false;
          if (followed && !followed.has(record.authorId)) return false;
          if (record.visibility === "private" && (discovery || record.authorId !== user.id)) return false;
          if (searching) {
            const text = `${record.text}\n${record.authorName}`.normalize("NFKC").toLowerCase();
            if (!terms.every((term) => text.includes(term))) return false;
            if (phrase) {
              const body = (record.text || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
              relevance.set(record.id, body === phrase ? 2 : body.includes(phrase) ? 1 : 0);
            }
          }
          const viewer = discovery || record.authorId !== user.id ? { id: null } : user;
          const key = JSON.stringify([record.treeId, record.nodeId, viewer.id]);
          if (!accessible.has(key)) accessible.set(key, canAccessNode(config, record.treeId, record.nodeId, viewer));
          return accessible.get(key);
        })
        .sort((left, right) => (relevance.get(right.id) || 0) - (relevance.get(left.id) || 0) ||
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || right.id.localeCompare(left.id));
      if (searching) {
        const offset = (Number(page) - 1) * 20;
        const matches = byTutorial ? presentRecords(config, records, { id: null }).filter((record) => !record.tutorialUnavailable) : records;
        const pageRecords = matches.slice(offset, offset + 20);
        const visible = byTutorial ? pageRecords : presentRecords(config, pageRecords, mine ? user : { id: null });
        const items = visible.map(({ eventId, sourceSnapshot, sourceFingerprint, ...item }) => {
          void eventId; void sourceSnapshot; void sourceFingerprint;
          return item;
        });
        return res.json({ ok: true, records: items, hasNext: matches.length > offset + 20,
          ...(mine ? { lastPage: Math.max(1, Math.ceil(matches.length / 20)) } : {}) });
      }
      return res.json({ ok: true, records: presentRecords(config, records, user) });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  const practiceBookmarksFile = path.join(config.dataDir, "practice-bookmarks.json");
  function readPracticeBookmarks() {
    const bookmarks = readJsonFile(practiceBookmarksFile, []);
    if (!Array.isArray(bookmarks)) throw new Error("实践收藏数据格式损坏。");
    return bookmarks;
  }
  function discoverablePractice(record) {
    return record && record.visibility !== "private" && canAccessNode(config, record.treeId, record.nodeId, { id: null });
  }
  function canViewPractice(record, viewer) {
    if (record?.authorId === viewer.id) return canAccessNode(config, record.treeId, record.nodeId, viewer);
    return discoverablePractice(record);
  }
  installPracticeDiscussion(app, config, { authenticate, readJsonFile, writeJsonFile, readRecords, discoverablePractice });

  app.get("/api/practice-bookmarks", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const viewer = authenticate(config, req);
    if (!viewer) return res.status(401).json({ ok: false });
    const { page = "1" } = req.query;
    if (typeof page !== "string" || !/^[1-9][0-9]{0,5}$/.test(page)) {
      return res.status(400).json({ ok: false, message: "收藏页码无效。" });
    }
    try {
      const bookmarks = readPracticeBookmarks().filter((item) => item.ownerId === viewer.id);
      const limit = 20;
      const lastPage = Math.max(1, Math.ceil(bookmarks.length / limit));
      const currentPage = Math.min(Number(page), lastPage);
      const records = new Map(readRecords(config).map((record) => [record.id, record]));
      const items = bookmarks.slice((currentPage - 1) * limit, currentPage * limit).map(({ recordId }) => {
        const record = records.get(recordId);
        return {
          recordId,
          record: discoverablePractice(record) ? { text: record.text, authorName: record.authorName } : null,
          missing: !record
        };
      });
      return res.json({ ok: true, ownerId: viewer.id, items, page: currentPage, hasNext: currentPage < lastPage });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.put("/api/practice-bookmarks/:id", (req, res) => {
    const viewer = authenticate(config, req);
    if (!viewer) return res.status(401).json({ ok: false });
    if (req.get("X-Action-Account") !== viewer.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { saved } = req.body || {};
    if (typeof saved !== "boolean" || !RECORD_SCOPE_PATTERN.test(req.params.id)) return res.status(400).json({ ok: false });
    try {
      const recordId = req.params.id;
      if (saved && !discoverablePractice(readRecords(config).find((item) => item.id === recordId))) {
        return res.status(404).json({ ok: false, message: "这条实践目前不可收藏。" });
      }
      const items = readPracticeBookmarks();
      const index = items.findIndex((item) => item.ownerId === viewer.id && item.recordId === recordId);
      if (saved && index < 0) {
        items.unshift({ ownerId: viewer.id, recordId });
        writeJsonFile(practiceBookmarksFile, items);
      } else if (!saved && index >= 0) {
        items.splice(index, 1);
        writeJsonFile(practiceBookmarksFile, items);
      }
      return res.json({ ok: true, saved });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.get("/api/records/:id", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const viewer = authenticate(config, req);
    if (!viewer) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    try {
      const record = readRecords(config).find((item) => item.id === req.params.id);
      if (!canViewPractice(record, viewer)) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND" });
      }
      const [{ eventId, ...item }] = presentRecords(config, [record], viewer);
      void eventId;
      return res.json({ ok: true, record: item, ownerId: viewer.id, canBookmark: Boolean(discoverablePractice(record)),
        revision: record.authorId === viewer.id ? stateRevision(record) : null,
        bookmarked: readPracticeBookmarks().some((bookmark) => bookmark.ownerId === viewer.id && bookmark.recordId === record.id) });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/records", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    if (req.get("X-Action-Account") && req.get("X-Action-Account") !== user.id) {
      return res.status(409).json({ ok: false, code: "ACTION_ACCOUNT_CHANGED", message: "账号已变化，请重新打开记录表单。" });
    }
    const requestKey = req.get("Idempotency-Key");
    if (requestKey !== undefined && !/^[A-Za-z0-9_-]{16,100}$/.test(requestKey)) {
      return res.status(400).json({ ok: false, code: "INVALID_RECORD_REQUEST_KEY" });
    }
    const pendingImages = [];
    try {
      const records = readRecords(config);
      const requestRecordId = requestKey ? "practice-" + nodeCrypto.createHash("sha256").update(JSON.stringify([user.id, requestKey])).digest("hex").slice(0, 32) : null;
      const replay = requestRecordId && records.find((record) => record.id === requestRecordId && record.authorId === user.id);
      if (replay) {
        if (replay.treeId !== req.body?.treeId || replay.nodeId !== req.body?.nodeId) return res.status(409).json({ ok: false, code: "RECORD_REQUEST_TARGET_CHANGED" });
        return res.json({ ok: true, record: replay });
      }
      const draftId = req.get("X-Practice-Draft");
      if (draftId !== undefined) {
        const state = readAccountState(config, user.id);
        const lightups = Array.isArray(state?.forest?.lightups) ? state.forest.lightups : [];
        const events = Array.isArray(state?.events) ? state.events : [];
        const draft = lightups.find((item) => item?.id === draftId &&
          (item.status === "draft" || (item.status === "confirmed" && item.visibility === "private")));
        const event = events.find((item) => item && item.id === draft?.eventId);
        const source = draft?.tutorialSnapshot || event?.tutorialSnapshot;
        if (!draft || draft.treeId !== req.body?.treeId || draft.nodeId !== req.body?.nodeId ||
            draft.eventId !== req.body?.eventId || (draft.evidence?.detail || "完成了这次实践") !== req.body?.text ||
            (draft.tutorialId || source?.id || null) !== (req.body?.tutorialId || null) ||
            (source?.version || null) !== (req.body?.tutorialVersion || null)) {
          return res.status(409).json({ ok: false, code: "PRACTICE_DRAFT_CHANGED", message: "草稿已在另一页面修改或移除，请刷新并核对最新内容后再确认。" });
        }
      }
      const existing = typeof req.body?.eventId === "string" && req.body.eventId && records.find((record) =>
        record.authorId === user.id && record.eventId === req.body.eventId && record.treeId === req.body.treeId && record.nodeId === req.body.nodeId);
      if (existing) return res.json({ ok: true, record: existing });
      const validation = validateRecordPayload(req.body, config);
      if (validation.ok === false) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: validation.message
        });
      }
      const payload = validation.value;
      if (!canAccessNode(config, payload.treeId, payload.nodeId, user)) return res.status(404).json({ ok: false, message: "没有找到可访问的节点。" });
      const customScope = readCustomNodes(config);
      const scopedNode = customScope.nodes.find((node) => node.id === payload.nodeId && node.treeId === payload.treeId);
      const scopedTree = customScope.trees.find((tree) => tree.id === payload.treeId);
      const privateScope = (scopedNode && scopedNode.visibility === "private") || (scopedTree && scopedTree.visibility === "private");
      if (privateScope && req.body.visibility === "public") return res.status(400).json({ ok: false, message: "先公开展示知识树和节点，再分享这次实践。" });
      const visibility = privateScope || req.body.visibility === "private" ? "private" : "public";
      if (req.body.tutorialId) {
        const seed = JSON.parse(fs.readFileSync(SEED_NODE_FILE, "utf8"));
        const seedMethod = payload.treeId === seed.tree.id && seed.tutorials.find((tutorial) => tutorial.id === req.body.tutorialId && tutorial.nodeId === payload.nodeId);
        const customMethods = readJsonFile(path.join(config.dataDir, "tutorials.json"), []);
        const customMethod = Array.isArray(customMethods) && customMethods.find((tutorial) => tutorial.id === req.body.tutorialId && tutorial.treeId === payload.treeId && tutorial.nodeId === payload.nodeId && (tutorial.visibility === "public" || tutorial.authorId === user.id));
        const validVersion = seedMethod ? req.body.tutorialVersion === (seedMethod.version || "seed-1") : customMethod && customMethod.versions.some((version) => version.version === req.body.tutorialVersion && (version.visibility === "public" || customMethod.authorId === user.id));
        if (!validVersion) return res.status(400).json({ ok: false, message: "所用方法或版本与这个节点不匹配。" });
        if (!seedMethod && customMethod.archived && visibility === "public") {
          return res.status(409).json({ ok: false, code: "TUTORIAL_ARCHIVED", message: "这份教程已归档。本次实践可以私人保存。" });
        }
      }
      const images = payload.images.map((image) => {
        const id = nodeCrypto.randomBytes(16).toString("hex");
        fs.mkdirSync(config.mediaDir, { recursive: true });
        const filename = path.join(config.mediaDir, id);
        const file = fs.openSync(filename, "wx");
        pendingImages.push(filename);
        try {
          fs.writeFileSync(file, image.buffer);
        } finally {
          fs.closeSync(file);
        }
        return { id, mediaType: image.mediaType };
      });
      const record = {
        id: requestRecordId || createId(),
        treeId: payload.treeId,
        nodeId: payload.nodeId,
        authorId: user.id,
        authorName: user.name,
        createdAt: new Date().toISOString(),
        text: payload.text,
        images,
        eventId: payload.eventId,
        visibility,
        lightUp: req.body.lightUp === true,
        tutorialId: typeof req.body.tutorialId === "string" ? req.body.tutorialId.slice(0, 64) : null,
        tutorialVersion: typeof req.body.tutorialVersion === "string" ? req.body.tutorialVersion.slice(0, 64) : null
      };
      records.unshift(record);
      writeJsonFile(config.recordsPath, records);
      pendingImages.length = 0;
      return res.status(201).json({ ok: true, record });
    } catch (error) {
      for (const filename of pendingImages) {
        try { fs.unlinkSync(filename); }
        catch (cleanupError) { if (cleanupError.code !== "ENOENT") console.error(cleanupError); }
      }
      return handleServerError(res, error);
    }
  });

  app.patch("/api/records/:id/text", (req, res) => {
    const user = authenticate(config, req);
    if (!user) return res.status(401).json({ ok: false });
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    try {
      const records = readRecords(config);
      const record = records.find((item) => item.id === req.params.id && item.authorId === user.id);
      if (!record || !canAccessNode(config, record.treeId, record.nodeId, user)) {
        return res.status(404).json({ ok: false, message: "找不到你可以编辑的实践。" });
      }
      if (req.get("If-Match") !== stateRevision(record)) {
        return res.status(409).json({
          ok: false,
          message: "实践已在另一窗口更新。请复制草稿，刷新后再编辑。",
          current: { text: record.text, visibility: record.visibility, revision: stateRevision(record) }
        });
      }
      const text = req.body?.text;
      if (typeof text !== "string" || text.trim().length > 400 || (!text.trim() && !record.images.length)) {
        return res.status(400).json({ ok: false, message: "请写下实践内容，最多 400 字。有配图时可以留空。" });
      }
      record.text = text.trim();
      writeJsonFile(config.recordsPath, records);
      return res.json({ ok: true, text: record.text, revision: stateRevision(record) });
    } catch (error) { return handleServerError(res, error); }
  });

  app.patch("/api/records/:id", (req, res) => {
    const user = authenticate(config, req);
    if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    if (req.get("X-Action-Account") && req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, code: "ACTION_ACCOUNT_CHANGED" });
    if (!["private", "public"].includes(req.body.visibility)) return res.status(400).json({ ok: false, message: "选择私人保存或公开分享。" });
    try {
      const records = readRecords(config);
      const record = records.find((item) => item.id === req.params.id && item.authorId === user.id);
      if (!record) return res.status(404).json({ ok: false, message: "没有找到自己的记录。" });
      if (!canAccessNode(config, record.treeId, record.nodeId, user)) return res.status(404).json({ ok: false, message: "目标节点不可访问。" });
      const expected = req.get("If-Match");
      if (req.body.visibility === "public" && expected !== undefined && expected !== stateRevision(record)) {
        return res.status(409).json({
          ok: false,
          code: "PRACTICE_REVISION_CHANGED",
          message: "实践已在另一页面更新，请刷新并核对后再公开。",
          current: { text: record.text, visibility: record.visibility, revision: stateRevision(record) }
        });
      }
      const data = readCustomNodes(config);
      const node = data.nodes.find((item) => item.id === record.nodeId && item.treeId === record.treeId);
      const tree = data.trees.find((item) => item.id === record.treeId);
      if (req.body.visibility === "public" && ((node && node.visibility === "private") || (tree && tree.visibility === "private"))) return res.status(400).json({ ok: false, message: "先公开展示知识树和节点，再分享这次实践。" });
      if (req.body.visibility === "public" && record.visibility === "private" && record.tutorialId) {
        const tutorials = readJsonFile(path.join(config.dataDir, "tutorials.json"), []);
        if (tutorials.some((tutorial) => tutorial.id === record.tutorialId && tutorial.archived)) {
          return res.status(409).json({ ok: false, code: "TUTORIAL_ARCHIVED", message: "这份教程已归档。本次实践可以私人保存。" });
        }
      }
      if (record.visibility !== req.body.visibility) {
        record.visibility = req.body.visibility;
        record.visibilityRevision = nodeCrypto.randomUUID();
        writeJsonFile(config.recordsPath, records);
      }
      return res.json({ ok: true, record });
    } catch (error) { return handleServerError(res, error); }
  });

  app.delete("/api/records/:id", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    try {
      const records = readRecords(config);
      const index = records.findIndex((record) => record.id === req.params.id);
      if (index < 0 || records[index].authorId !== user.id) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有找到这条记录。" });
      }
      const [removed] = records.splice(index, 1);
      writeJsonFile(config.recordsPath, records);
      const remainingImages = new Set(records.flatMap((record) => record.images.map((image) => image.id.toLowerCase())));
      for (const { id } of removed.images) {
        if (!MEDIA_ID_PATTERN.test(id) || remainingImages.has(id.toLowerCase())) continue;
        try { fs.unlinkSync(path.join(config.mediaDir, id)); }
        catch (error) { if (error.code !== "ENOENT") console.error(error); }
      }
      return res.json({ ok: true });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.get("/api/media/:id", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    const id = req.params.id;
    if (!MEDIA_ID_PATTERN.test(id)) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有找到这张图片。" });
    }
    try {
      const visibleReference = readRecords(config).some((item) =>
        item.images.some((image) => image.id === id) &&
        canViewPractice(item, user));
      if (!visibleReference) return res.status(404).json({ ok: false, code: "NOT_FOUND" });
      const filePath = path.join(config.mediaDir, id);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有找到这张图片。" });
      }
      const buffer = fs.readFileSync(filePath);
      const mediaType = detectImageType(buffer);
      if (!mediaType) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有找到这张图片。" });
      }
      res.setHeader("Content-Type", mediaType);
      return res.send(buffer);
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.get("/api/nodes", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    try {
      const data = readCustomNodes(config);
      const nodes = data.nodes.filter((node) => canAccessNode(config, node.treeId, node.id, user));
      const visible = new Set(nodes.map((node) => node.id));
      getSeedNodeIds().forEach((id) => visible.add(id));
      return res.json({ ok: true, nodes, edges: data.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)), trees: data.trees.filter((tree) => tree.visibility === "public" || tree.ownerId === user.id) });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/nodes", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    const validation = validateNodePayload(req.body, config);
    if (validation.ok === false) {
      return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: validation.message });
    }
    const value = validation.value;
    if (!canAccessNode(config, value.treeId, value.anchorId, user)) return res.status(404).json({ ok: false, message: "没有找到可访问的挂靠节点。" });
    const now = new Date().toISOString();
    const id = createNodeId();
    const node = {
      id,
      treeId: value.treeId,
      title: value.title,
      goal: value.goal,
      estMinutes: value.estMinutes,
      ownership: "personal",
      visibility: req.body.visibility === "public" ? "public" : "private",
      ownerId: user.id,
      ownerName: user.name,
      createdAt: now,
      updatedAt: now
    };
    const edge =
      value.linkType === "prereq"
        ? { from: value.anchorId, to: id, type: "prereq" }
        : { from: id, to: value.anchorId, type: "instance-of" };
    try {
      const data = readCustomNodes(config);
      data.nodes.push(node);
      data.edges.push(edge);
      writeCustomNodes(config, data);
      return res.status(201).json({ ok: true, node, edge });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.patch("/api/nodes/:id", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    try {
      const data = readCustomNodes(config);
      const node = data.nodes.find((candidate) => candidate && candidate.id === req.params.id);
      if (!node) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有这个节点。" });
      }
      if (node.ownerId !== user.id) {
        return res.status(403).json({ ok: false, code: "NOT_OWNER", message: "只有建立它的人可以改。" });
      }
      const validation = validateNodePatch(req.body);
      if (validation.ok === false) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: validation.message });
      }
      Object.assign(node, validation.value);
      node.updatedAt = new Date().toISOString();
      writeCustomNodes(config, data);
      return res.json({ ok: true, node });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.delete("/api/nodes/:id", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    try {
      const data = readCustomNodes(config);
      const index = data.nodes.findIndex((candidate) => candidate && candidate.id === req.params.id);
      if (index < 0) {
        return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有这个节点。" });
      }
      if (data.nodes[index].ownerId !== user.id) {
        return res.status(403).json({ ok: false, code: "NOT_OWNER", message: "只有建立它的人可以改。" });
      }
      data.nodes.splice(index, 1);
      data.edges = data.edges.filter((edge) => edge && edge.from !== req.params.id && edge.to !== req.params.id);
      writeCustomNodes(config, data);
      return res.json({ ok: true });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  installKnowledgeService(app, config, { authenticate, readJsonFile, writeJsonFile, readCustomNodes, readRecords });
  installArchiveService(app, config, { authenticate, readJsonFile, readAccountState, readCustomNodes, readRecords, normalizeImages,
    stateRevision, practiceBookmarksFile, readPracticeBookmarks });
  installProfileService(app, config, { authenticate, readUsers, readJsonFile, writeJsonFile, readRecords, readCustomNodes, readAccountState, canAccessNode, canViewPractice, presentRecords });

  app.post("/api/trees", (req, res) => {
    const user = authenticate(config, req);
    if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const goal = typeof req.body.goal === "string" ? req.body.goal.trim() : "";
    if (!name || name.length > 40 || !goal || goal.length > 200) return res.status(400).json({ ok: false, message: "填写知识树的名字和第一个目标，分别最多 40 字和 200 字。" });
    const visibility = req.body.visibility === "public" ? "public" : "private";
    try {
      const data = readCustomNodes(config);
      const tree = { id: `tree-${nodeCrypto.randomBytes(8).toString("hex")}`, name, domain: name, ownerId: user.id, ownerName: user.name, visibility, createdAt: new Date().toISOString() };
      const node = { id: createNodeId(), treeId: tree.id, title: name, goal, estMinutes: 5, verifyHint: "尝试完成这个目标，并留下你自己的实践说明。", ownership: "personal", ownerId: user.id, ownerName: user.name, visibility, createdAt: tree.createdAt, updatedAt: tree.createdAt };
      data.trees.push(tree);
      data.nodes.push(node);
      writeCustomNodes(config, data); // 树和起始目标在同一文件中原子保存。
      return res.status(201).json({ ok: true, tree, node });
    } catch (error) { return handleServerError(res, error); }
  });

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      code: "NOT_FOUND",
      message: `未找到路径 ${req.path}`
    });
  });

  app.use((error, req, res, next) => {
    void req;
    void next;
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_JSON",
        message: "请求体不是合法 JSON。"
      });
    }
    if (error && error.type === "entity.too.large") {
      return res.status(413).json({
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        message: "请求体太大。"
      });
    }
    return handleServerError(res, error);
  });

  return { app, config, limitApiRequest, resolveSession: (req) => {
    recoverTransactions(config.dataDir);
    const user = authenticate(config, req);
    return user ? { id: user.id, name: user.name } : null;
  } };
}

function buildConfig(overrides) {
  const dataDir = overrides.dataDir || process.env.DATA_DIR || path.join(ROOT_DIR, "data");
  return {
    surface: overrides.surface === "platform" ? "platform" : "habit",
    port: Number(overrides.port || process.env.PORT || 3000),
    platformPort: Number(overrides.platformPort || process.env.PLATFORM_PORT || 3001),
    habitUrl: overrides.habitUrl || process.env.HABIT_URL || "",
    platformUrl: overrides.platformUrl || process.env.PLATFORM_URL || "",
    communityEnabled: overrides.communityEnabled === true,
    host: overrides.host || process.env.HOST || "127.0.0.1",
    trustProxy: overrides.trustProxy !== undefined ? overrides.trustProxy : process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY && process.env.TRUST_PROXY !== "false" ? process.env.TRUST_PROXY : false,
    secureCookies: overrides.secureCookies !== undefined ? Boolean(overrides.secureCookies) : process.env.SECURE_COOKIES === "true",
    sessionMaxAgeMs: Number(overrides.sessionMaxAgeMs || 30 * 24 * 60 * 60 * 1000),
    dataDir,
    bugLogPath: overrides.bugLogPath || path.join(dataDir, "bug-reports.jsonl"),
    usersPath: overrides.usersPath || path.join(dataDir, "users.json"),
    sessionsPath: overrides.sessionsPath || path.join(dataDir, "sessions.json"),
    statesDir: overrides.statesDir || path.join(dataDir, "states"),
    recordsPath: overrides.recordsPath || path.join(dataDir, "records.json"),
    customNodesPath: overrides.customNodesPath || path.join(dataDir, "custom-nodes.json"),
    mediaDir: overrides.mediaDir || path.join(dataDir, "media"),
    bodyLimit: overrides.bodyLimit || process.env.BODY_LIMIT || "32mb",
    allowedOrigins: normalizeOrigins(overrides.allowedOrigins || process.env.ALLOWED_ORIGINS || ""),
    rateLimitEnabled:
      overrides.rateLimitEnabled !== undefined
        ? Boolean(overrides.rateLimitEnabled)
        : process.env.ENABLE_RATE_LIMIT === "true",
    rateLimitWindowMs: Number(overrides.rateLimitWindowMs !== undefined ? overrides.rateLimitWindowMs : process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    rateLimitMax: Number(overrides.rateLimitMax !== undefined ? overrides.rateLimitMax : process.env.RATE_LIMIT_MAX || 60)
  };
}

function normalizeOrigins(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateRateLimitConfig(windowMs, maxRequests) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("限流窗口必须是有效的正毫秒数。");
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new RangeError("限流请求次数必须是有效的正整数。");
}

function createRateLimiter(windowMs, maxRequests) {
  validateRateLimitConfig(windowMs, maxRequests);
  const bucket = new Map();
  const counted = new WeakSet();
  let lastSweep = Date.now();
  return (req, res, next) => {
    if (counted.has(req)) return next();
    counted.add(req);
    const now = Date.now();
    if (now - lastSweep >= Math.min(windowMs, 60000)) {
      for (const [address, times] of bucket) {
        if (now - times[times.length - 1] >= windowMs) bucket.delete(address);
      }
      lastSweep = now;
    }
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const history = bucket.get(key) || [];
    const recent = history.filter((timestamp) => now - timestamp < windowMs);
    recent.push(now);
    // Only the newest max + 1 timestamps can affect a later allow/deny decision.
    // Keep them ordered by time, including when the wall clock moves backwards.
    recent.sort((a, b) => a - b);
    bucket.set(key, recent.slice(-(maxRequests + 1)));
    if (recent.length > maxRequests) {
      return res.status(429).json({
        ok: false,
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后再试。"
      });
    }
    return next();
  };
}

function validateCredentials(body) {
  const payload = body && typeof body === "object" ? body : {};
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(name)) {
    return { ok: false, message: "名字需为 2–24 个字符，只能包含字母、数字、中文、下划线或短横。" };
  }
  if (password.length < 8 || password.length > 72) {
    return { ok: false, message: "密码长度需为 8–72 个字符。" };
  }
  return { ok: true, value: { name, password } };
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${nodeCrypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readAccountState(config, userId) {
  const state = readJsonFile(stateFilePath(config, userId), null);
  if (state !== null && (typeof state !== "object" || Array.isArray(state))) {
    throw new Error("账号记录格式损坏，保留原文件并停止写入。");
  }
  return state;
}

function stateRevision(state) {
  return nodeCrypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function readUsers(config) {
  const users = readJsonFile(config.usersPath, []);
  if (!Array.isArray(users)) throw new Error("账号数据格式损坏，停止写入。");
  return users;
}

function readSessions(config) {
  const sessions = readJsonFile(config.sessionsPath, {});
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) throw new Error("会话数据格式损坏，停止写入。");
  return sessions;
}

function presentRecords(config, records, viewer) {
  const hasSources = records.some((record) => record.tutorialId && record.tutorialVersion);
  const seed = hasSources ? JSON.parse(fs.readFileSync(SEED_NODE_FILE, "utf8")) : null;
  const custom = hasSources ? readJsonFile(path.join(config.dataDir, "tutorials.json"), []) : [];
  if (!Array.isArray(custom)) throw new Error("方法资料格式损坏。");
  const methods = new Map(custom.map((item) => [item.id, item]));
  return records.map((record) => {
    // 社区保存的来源快照是完整的实践凭据。其他读者通过版本接口核对来源。
    const { sourceSnapshot, sourceFingerprint, visibilityRevision, ...publicFields } = record;
    void sourceSnapshot;
    void sourceFingerprint;
    void visibilityRevision;
    const disclosed = record.authorId === viewer.id ? record : publicFields;
    if (!record.tutorialId || !record.tutorialVersion) return disclosed;
    const { treeId, nodeId, tutorialId, tutorialVersion } = record;
    const seeded = treeId === seed.tree.id && seed.tutorials.some((item) =>
      item.id === tutorialId && item.nodeId === nodeId && (item.version || "seed-1") === tutorialVersion);
    const method = methods.get(tutorialId);
    const ownMethod = method?.authorId === viewer.id;
    const visible = method && method.treeId === treeId && method.nodeId === nodeId && (ownMethod || method.visibility === "public") &&
      method.versions?.some((item) => item.version === tutorialVersion && (ownMethod || item.visibility === "public"));
    if (seeded) return disclosed;
    if (!visible) return { ...disclosed, tutorialId: null, tutorialVersion: null, tutorialUnavailable: true };
    return method.archived ? { ...disclosed, tutorialArchived: true } : disclosed;
  });
}

function readRecords(config) {
  const records = readJsonFile(config.recordsPath, []);
  if (!Array.isArray(records)) throw new Error("实践记录格式损坏，停止写入。");
  return records;
}

function readCustomNodes(config) {
  const data = readJsonFile(config.customNodesPath, { nodes: [], edges: [] });
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("节点数据格式损坏，停止写入。");
  const nodes = data && Array.isArray(data.nodes) ? data.nodes : [];
  const edges = data && Array.isArray(data.edges) ? data.edges : [];
  return { nodes, edges, trees: Array.isArray(data.trees) ? data.trees : [] };
}

function writeCustomNodes(config, data) {
  writeJsonFile(config.customNodesPath, data);
}

function hasCustomNode(config, treeId, nodeId) {
  return readCustomNodes(config).nodes.some((node) => node && node.id === nodeId && node.treeId === treeId);
}

function canAccessNode(config, treeId, nodeId, user) {
  if (treeId === CUSTOM_NODE_TREE_ID && getSeedNodeIds().has(nodeId)) return true;
  const data = readCustomNodes(config);
  const tree = data.trees.find((item) => item.id === treeId);
  if (tree && tree.visibility === "private" && tree.ownerId !== user.id) return false;
  return data.nodes.some((node) => node.id === nodeId && node.treeId === treeId && (node.visibility !== "private" || node.ownerId === user.id));
}

function createNodeId() {
  return `n${nodeCrypto.randomBytes(8).toString("hex")}`;
}

/**
 * @returns {{ ok: true, value: { treeId: string, title: string, goal: string, estMinutes: number, linkType: string, anchorId: string } } | { ok: false, message: string }}
 */
function validateNodePayload(body, config) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const treeId = typeof payload.treeId === "string" ? payload.treeId : CUSTOM_NODE_TREE_ID;
  if (treeId !== CUSTOM_NODE_TREE_ID && !readCustomNodes(config).trees.some((tree) => tree.id === treeId)) return { ok: false, message: "知识树不存在。" };
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (Array.from(title).length < 1 || Array.from(title).length > 40) {
    return { ok: false, message: "写上节点名字。" };
  }
  const goal = typeof payload.goal === "string" ? payload.goal.trim() : "";
  if (Array.from(goal).length < 1 || Array.from(goal).length > 200) {
    return { ok: false, message: "写上这个节点要达成什么。" };
  }
  const estMinutes = payload.estMinutes === undefined ? 10 : payload.estMinutes;
  if (!Number.isInteger(estMinutes) || estMinutes < 5 || estMinutes > 15) {
    return { ok: false, message: "建议时长是 5 到 15 分钟。" };
  }
  const link = payload.link && typeof payload.link === "object" && !Array.isArray(payload.link) ? payload.link : {};
  const linkType = link.type;
  const anchorId = typeof link.anchorId === "string" ? link.anchorId : "";
  if (
    (linkType !== "prereq" && linkType !== "instance-of") ||
    !RECORD_SCOPE_PATTERN.test(anchorId) ||
    (!(treeId === CUSTOM_NODE_TREE_ID && getSeedNodeIds().has(anchorId)) && !hasCustomNode(config, treeId, anchorId))
  ) {
    return { ok: false, message: "先选一个已有节点，说明它挂在哪里。" };
  }
  return { ok: true, value: { treeId, title, goal, estMinutes, linkType, anchorId } };
}

/**
 * @returns {{ ok: true, value: { title?: string, goal?: string, estMinutes?: number } } | { ok: false, message: string }}
 */
function validateNodePatch(body) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const value = {};
  if (payload.title !== undefined) {
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (Array.from(title).length < 1 || Array.from(title).length > 40) {
      return { ok: false, message: "写上节点名字。" };
    }
    value.title = title;
  }
  if (payload.goal !== undefined) {
    const goal = typeof payload.goal === "string" ? payload.goal.trim() : "";
    if (Array.from(goal).length < 1 || Array.from(goal).length > 200) {
      return { ok: false, message: "写上这个节点要达成什么。" };
    }
    value.goal = goal;
  }
  if (payload.estMinutes !== undefined) {
    const estMinutes = payload.estMinutes;
    if (!Number.isInteger(estMinutes) || estMinutes < 5 || estMinutes > 15) {
      return { ok: false, message: "建议时长是 5 到 15 分钟。" };
    }
    value.estMinutes = estMinutes;
  }
  if (payload.visibility !== undefined) {
    if (!["private", "public"].includes(payload.visibility)) return { ok: false, message: "可见性必须是私人或公开。" };
    value.visibility = payload.visibility;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, message: "没有要修改的内容。" };
  }
  return { ok: true, value };
}

let seedNodeIdsCache = null;

// 节点标识以仓库种子树为准（k9-math.json 是唯一被接受的知识树）
function getSeedNodeIds() {
  if (seedNodeIdsCache) {
    return seedNodeIdsCache;
  }
  let ids = new Set();
  try {
    const tree = JSON.parse(fs.readFileSync(SEED_NODE_FILE, "utf8"));
    ids = new Set((Array.isArray(tree.nodes) ? tree.nodes : []).map((node) => node && node.id).filter(Boolean));
  } catch {
    ids = new Set();
  }
  seedNodeIdsCache = ids;
  return seedNodeIdsCache;
}

/**
 * @returns {{ ok: true, value: { treeId: string, nodeId: string, text: string, images: Array<{ mediaType: string, buffer: Buffer }>, eventId: string | null } } | { ok: false, message: string }}
 */
function validateRecordPayload(body, config) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const treeId = typeof payload.treeId === "string" ? payload.treeId : "";
  const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : "";
  if (!RECORD_SCOPE_PATTERN.test(treeId) || !RECORD_SCOPE_PATTERN.test(nodeId)) {
    return { ok: false, message: "树或节点标识不合法。" };
  }
  if (!(treeId === CUSTOM_NODE_TREE_ID && getSeedNodeIds().has(nodeId)) && !hasCustomNode(config, treeId, nodeId)) {
    return { ok: false, message: "节点不在已知的知识树里。" };
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const images = normalizeImages(payload.images);
  if (images.ok === false) {
    return { ok: false, message: images.message };
  }
  if (!text && images.value.length === 0) {
    return { ok: false, message: "写点文字或选一张图片。" };
  }
  const eventId = typeof payload.eventId === "string" && payload.eventId ? payload.eventId : null;
  return { ok: true, value: { treeId, nodeId, text, images: images.value, eventId } };
}

/**
 * @returns {{ ok: true, value: Array<{ mediaType: string, buffer: Buffer }> } | { ok: false, message: string }}
 */
function normalizeImages(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: "图片必须是数组。" };
  }
  if (raw.length > MAX_IMAGES_PER_RECORD) {
    return { ok: false, message: `一次最多 ${MAX_IMAGES_PER_RECORD} 张图片。` };
  }
  const value = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "图片格式不合法。" };
    }
    const mediaType = typeof item.mediaType === "string" ? item.mediaType : "";
    const dataUrl = typeof item.dataUrl === "string" ? item.dataUrl : "";
    if (!IMAGE_TYPES.has(mediaType)) {
      return { ok: false, message: "只支持 JPEG、PNG、WebP、GIF 图片。" };
    }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || parsed.mediaType !== mediaType) {
      return { ok: false, message: "图片数据不合法。" };
    }
    if (parsed.buffer.length === 0 || parsed.buffer.length > MAX_IMAGE_BYTES) {
      return { ok: false, message: "单张图片不能超过 2MB。" };
    }
    if (detectImageType(parsed.buffer) !== mediaType) {
      return { ok: false, message: "图片内容与声明的类型不符。" };
    }
    value.push({ mediaType, buffer: parsed.buffer });
  }
  return { ok: true, value };
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mediaType: match[1], buffer: Buffer.from(match[2], "base64") };
}

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function stateFilePath(config, userId) {
  return path.join(config.statesDir, `${userId}.json`);
}

function createUserId() {
  return nodeCrypto.randomBytes(12).toString("hex");
}

function createSession(config, userId) {
  const sessions = readSessions(config);
  Object.keys(sessions).forEach((key) => {
    const createdAt = Date.parse(sessions[key].createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > config.sessionMaxAgeMs) delete sessions[key];
  });
  const token = nodeCrypto.randomBytes(32).toString("hex");
  sessions[token] = { userId, createdAt: new Date().toISOString() };
  writeJsonFile(config.sessionsPath, sessions);
  return token;
}

function authenticate(config, req) {
  const token = parseCookies(req.get("cookie"))[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  const session = readSessions(config)[token];
  if (!session || typeof session.userId !== "string") {
    return null;
  }
  const createdAt = Date.parse(session.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > config.sessionMaxAgeMs) return null;
  return readUsers(config).find((user) => user.id === session.userId) || null;
}

function verifyPassword(password, user) {
  if (!user || typeof user.salt !== "string" || typeof user.hash !== "string") {
    return false;
  }
  const expected = Buffer.from(user.hash, "hex");
  const actual = nodeCrypto.scryptSync(password, user.salt, SCRYPT_KEYLEN);
  if (expected.length !== actual.length) {
    return false;
  }
  return nodeCrypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== "string" || !header) {
    return cookies;
  }
  header.split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) {
      return;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) {
      return;
    }
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });
  return cookies;
}

function sessionCookie(token, config) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(config.sessionMaxAgeMs / 1000)}${config.secureCookies ? "; Secure" : ""}`;
}

function clearSessionCookie(config) {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${config.secureCookies ? "; Secure" : ""}`;
}

function validateBugPayload(body) {
  const payload = body && typeof body === "object" ? body : {};
  const title = cleanText(payload.title, 100);
  const description = cleanText(payload.description, 1000);
  if (!title) {
    return { ok: false, message: "标题不能为空。" };
  }
  if (!description) {
    return { ok: false, message: "问题描述不能为空。" };
  }
  return {
    ok: true,
    value: {
      title,
      description,
      steps: cleanText(payload.steps, 1000),
      expected: cleanText(payload.expected, 500),
      actual: cleanText(payload.actual, 500),
      severity: normalizeSeverity(payload.severity),
      contact: cleanText(payload.contact, 100),
      page: cleanText(payload.page, 50)
    }
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  const safeText = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return safeText
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSeverity(value) {
  if (value === "low" || value === "high") {
    return value;
  }
  return "medium";
}

function readBugReports(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 50);
}

function handleServerError(res, error) {
  if (error) {
    console.error(error);
  }
  return res.status(500).json({
    ok: false,
    code: "INTERNAL_ERROR",
    message: "服务端处理失败。"
  });
}

function createId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function startServer(overrides = {}) {
  const habit = createApp({ ...overrides, surface: "habit" });
  const platform = createApp({ ...overrides, surface: "platform" });
  const habitServer = habit.app.listen(habit.config.port, habit.config.host, () => {
    console.log(`习惯记录 http://${habit.config.host}:${habit.config.port}`);
  });
  const platformServer = platform.app.listen(platform.config.platformPort, platform.config.host, () => {
    console.log(`知识共建共享平台 http://${platform.config.host}:${platform.config.platformPort}`);
  });
  return { habit: habitServer, platform: platformServer };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
