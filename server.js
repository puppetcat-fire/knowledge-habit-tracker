const express = require("express");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
  ["/overlay.html", "overlay.html"],
  ["/overlay.js", "overlay.js"]
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
    bodyLimit: overrides.bodyLimit || "256kb",
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
