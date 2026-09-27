const express = require("express");
const nodeCrypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const SESSION_COOKIE = "kht_session";
const SCRYPT_KEYLEN = 64;
const STATE_VERSION_MAX = 3;
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
  ["/overlay.html", "overlay.html"],
  ["/overlay.js", "overlay.js"],
  ["/seed-trees/seed-trees.js", "seed-trees/seed-trees.js"]
]);

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

  PUBLIC_FILES.forEach((fileName, route) => {
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
      service: "knowledge-habit-tracker",
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
    return handleServerError(res, error);
  });

  return { app, config };
}

function buildConfig(overrides) {
  const dataDir = overrides.dataDir || process.env.DATA_DIR || path.join(ROOT_DIR, "data");
  return {
    port: Number(overrides.port || process.env.PORT || 3000),
    host: overrides.host || process.env.HOST || "127.0.0.1",
    trustProxy: overrides.trustProxy || process.env.TRUST_PROXY || false,
    dataDir,
    bugLogPath: overrides.bugLogPath || path.join(dataDir, "bug-reports.jsonl"),
    usersPath: overrides.usersPath || path.join(dataDir, "users.json"),
    sessionsPath: overrides.sessionsPath || path.join(dataDir, "sessions.json"),
    statesDir: overrides.statesDir || path.join(dataDir, "states"),
    bodyLimit: overrides.bodyLimit || "1mb",
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
  const { app, config } = createApp(overrides);
  return app.listen(config.port, config.host, () => {
    console.log(`Knowledge Habit Tracker running at http://${config.host}:${config.port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
