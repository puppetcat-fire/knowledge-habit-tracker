const express = require("express");
const nodeCrypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const SESSION_COOKIE = "kht_session";
const SCRYPT_KEYLEN = 64;
const STATE_VERSION_MAX = 3;
const HABIT_PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
  ["/overlay.html", "overlay.html"],
  ["/overlay.js", "overlay.js"],
  ["/seed-trees/seed-trees.js", "seed-trees/seed-trees.js"]
]);

const PLATFORM_PUBLIC_FILES = new Map([
  ["/", "platform.html"],
  ["/platform.html", "platform.html"],
  ["/platform.js", "platform.js"],
  ["/platform.css", "platform.css"],
  ["/seed-trees/seed-trees.js", "seed-trees/seed-trees.js"]
]);

const SERVICE_NAMES = {
  habit: "knowledge-habit-tracker",
  platform: "knowledge-platform"
};

const SEED_NODE_FILE = path.join(ROOT_DIR, "seed-trees", "k9-math.json");
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_RECORD = 4;
const RECORD_SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_ID_PATTERN = /^[0-9a-fA-F]+$/;

function createApp(overrides = {}) {
  const config = buildConfig(overrides);
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

  if (config.rateLimitEnabled) {
    app.use("/api/", createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax));
  }

  if (config.allowedOrigins.length > 0) {
    app.use("/api/", (req, res, next) => {
      const origin = req.get("origin");
      if (!origin || config.allowedOrigins.includes(origin)) {
        return next();
      }
      return res.status(403).json({
        ok: false,
        code: "ORIGIN_NOT_ALLOWED",
        message: "请求来源不在允许列表中。"
      });
    });
  }

  const publicFiles = config.surface === "platform" ? PLATFORM_PUBLIC_FILES : HABIT_PUBLIC_FILES;
  publicFiles.forEach((fileName, route) => {
    app.get(route, (req, res) => {
      if (fileName.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      } else {
        res.setHeader("Cache-Control", "public, max-age=300");
      }
      res.sendFile(path.join(ROOT_DIR, fileName));
    });
  });

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
      res.setHeader("Set-Cookie", sessionCookie(token));
      return res.status(201).json({ ok: true, user: { id: record.id, name: record.name } });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/login", (req, res) => {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
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
      res.setHeader("Set-Cookie", sessionCookie(token));
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
    res.setHeader("Set-Cookie", clearSessionCookie());
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
    try {
      const filePath = stateFilePath(config, user.id);
      if (!fs.existsSync(filePath)) {
        return res.json({ ok: true, state: null });
      }
      const raw = fs.readFileSync(filePath, "utf8");
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      return res.json({ ok: true, state: parsed });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.put("/api/state", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
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
      writeJsonFile(stateFilePath(config, user.id), body);
      return res.json({ ok: true });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.get("/api/records", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    const treeId = typeof req.query.treeId === "string" ? req.query.treeId : "";
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
    try {
      const records = readRecords(config)
        .filter((record) => (!treeId || record.treeId === treeId) && (!nodeId || record.nodeId === nodeId))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      return res.json({ ok: true, records });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.post("/api/records", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    const validation = validateRecordPayload(req.body);
    if (validation.ok === false) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION_ERROR",
        message: validation.message
      });
    }
    const payload = validation.value;
    try {
      const records = readRecords(config);
      if (payload.eventId) {
        const existing = records.find((record) => record.eventId === payload.eventId);
        if (existing) {
          return res.json({ ok: true, record: existing });
        }
      }
      const images = payload.images.map((image) => {
        const id = nodeCrypto.randomBytes(16).toString("hex");
        fs.mkdirSync(config.mediaDir, { recursive: true });
        fs.writeFileSync(path.join(config.mediaDir, id), image.buffer);
        return { id, mediaType: image.mediaType };
      });
      const record = {
        id: createId(),
        treeId: payload.treeId,
        nodeId: payload.nodeId,
        authorId: user.id,
        authorName: user.name,
        createdAt: new Date().toISOString(),
        text: payload.text,
        images,
        eventId: payload.eventId
      };
      records.unshift(record);
      writeJsonFile(config.recordsPath, records);
      return res.status(201).json({ ok: true, record });
    } catch (error) {
      return handleServerError(res, error);
    }
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
      records.splice(index, 1);
      writeJsonFile(config.recordsPath, records);
      return res.json({ ok: true });
    } catch (error) {
      return handleServerError(res, error);
    }
  });

  app.get("/api/media/:id", (req, res) => {
    const user = authenticate(config, req);
    if (!user) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
    }
    const id = req.params.id;
    if (!MEDIA_ID_PATTERN.test(id)) {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "没有找到这张图片。" });
    }
    try {
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
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.send(buffer);
    } catch (error) {
      return handleServerError(res, error);
    }
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

  return { app, config };
}

function buildConfig(overrides) {
  const dataDir = overrides.dataDir || process.env.DATA_DIR || path.join(ROOT_DIR, "data");
  return {
    surface: overrides.surface === "platform" ? "platform" : "habit",
    port: Number(overrides.port || process.env.PORT || 3000),
    platformPort: Number(overrides.platformPort || process.env.PLATFORM_PORT || 3001),
    host: overrides.host || process.env.HOST || "127.0.0.1",
    trustProxy: overrides.trustProxy || process.env.TRUST_PROXY || false,
    dataDir,
    bugLogPath: overrides.bugLogPath || path.join(dataDir, "bug-reports.jsonl"),
    usersPath: overrides.usersPath || path.join(dataDir, "users.json"),
    sessionsPath: overrides.sessionsPath || path.join(dataDir, "sessions.json"),
    statesDir: overrides.statesDir || path.join(dataDir, "states"),
    recordsPath: overrides.recordsPath || path.join(dataDir, "records.json"),
    mediaDir: overrides.mediaDir || path.join(dataDir, "media"),
    bodyLimit: overrides.bodyLimit || "8mb",
    allowedOrigins: normalizeOrigins(overrides.allowedOrigins || process.env.ALLOWED_ORIGINS || ""),
    rateLimitEnabled:
      overrides.rateLimitEnabled !== undefined
        ? Boolean(overrides.rateLimitEnabled)
        : process.env.ENABLE_RATE_LIMIT === "true",
    rateLimitWindowMs: Number(overrides.rateLimitWindowMs || process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    rateLimitMax: Number(overrides.rateLimitMax || process.env.RATE_LIMIT_MAX || 60)
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

function createRateLimiter(windowMs, maxRequests) {
  const bucket = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const history = bucket.get(key) || [];
    const recent = history.filter((timestamp) => now - timestamp < windowMs);
    recent.push(now);
    bucket.set(key, recent);
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
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

function readUsers(config) {
  const users = readJsonFile(config.usersPath, []);
  return Array.isArray(users) ? users : [];
}

function readSessions(config) {
  const sessions = readJsonFile(config.sessionsPath, {});
  return sessions && typeof sessions === "object" && !Array.isArray(sessions) ? sessions : {};
}

function readRecords(config) {
  const records = readJsonFile(config.recordsPath, []);
  return Array.isArray(records) ? records : [];
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
function validateRecordPayload(body) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const treeId = typeof payload.treeId === "string" ? payload.treeId : "";
  const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : "";
  if (!RECORD_SCOPE_PATTERN.test(treeId) || !RECORD_SCOPE_PATTERN.test(nodeId)) {
    return { ok: false, message: "树或节点标识不合法。" };
  }
  if (!getSeedNodeIds().has(nodeId)) {
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

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
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
