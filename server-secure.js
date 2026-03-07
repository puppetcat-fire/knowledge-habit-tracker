const express = require("express");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "localhost"; // 默认只监听localhost
const enableCors = process.env.ENABLE_CORS === "true";
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:8082";
const apiKey = process.env.API_KEY; // 可选API密钥
const enableRateLimit = process.env.ENABLE_RATE_LIMIT === "true";

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const bugLogPath = path.join(dataDir, "bug-reports.jsonl");

// ==================== 安全中间件 ====================

// 1. 安全HTTP头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // 允许内联样式
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false, // 本地开发可能需要关闭
}));

// 2. CORS配置（可选）
if (enableCors) {
  const cors = require("cors");
  app.use(cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    credentials: false,
  }));
}

// 3. 速率限制（可选）
if (enableRateLimit) {
  const rateLimit = require("express-rate-limit");
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 每个IP最多100次请求
    standardHeaders: true,
    legacyHeaders: false,
    message: "请求过于频繁，请稍后再试",
  });
  app.use("/api/", limiter);
}

// 4. API密钥验证（可选）
if (apiKey) {
  app.use("/api/*", (req, res, next) => {
    const requestApiKey = req.headers["x-api-key"];
    if (requestApiKey !== apiKey) {
      return res.status(401).json({ 
        error: "未授权访问",
        message: "请提供有效的API密钥" 
      });
    }
    next();
  });
}

// ==================== 应用中间件 ====================
app.use(express.json({ limit: "256kb" }));
app.use(express.static(rootDir));

// ==================== 路由处理 ====================

app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

// 健康检查端点
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "knowledge-habit-tracker",
    version: "1.0.0",
    security: {
      corsEnabled: enableCors,
      apiKeyEnabled: !!apiKey,
      rateLimitEnabled: enableRateLimit,
      host: host,
    },
  });
});

// Bug报告API（增强安全版）
app.post("/api/bugs", (req, res) => {
  const { title, description, steps, expected, actual, severity, contact, page } = req.body || {};
  
  // 增强输入验证
  if (!title || !description) {
    return res.status(400).json({ 
      message: "标题与问题描述为必填项",
      code: "VALIDATION_ERROR" 
    });
  }
  
  // 更严格的输入清理
  const cleanInput = (str, maxLength) => {
    if (typeof str !== "string") return "";
    // 移除危险字符但保留中文和基本标点
    return str
      .replace(/[<>]/g, "") // 移除尖括号防止XSS
      .slice(0, maxLength)
      .trim();
  };
  
  const report = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: cleanInput(title, 100),
    description: cleanInput(description, 1000),
    steps: steps ? cleanInput(steps, 1000) : "",
    expected: expected ? cleanInput(expected, 500) : "",
    actual: actual ? cleanInput(actual, 500) : "",
    severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
    contact: contact ? cleanInput(contact, 100) : "",
    page: page ? cleanInput(page, 50) : "",
    userAgent: req.get("user-agent") || "",
    ip: req.ip,
    createdAt: new Date().toISOString(),
  };
  
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.appendFileSync(bugLogPath, `${JSON.stringify(report)}\n`, "utf8");
    res.json({ 
      ok: true, 
      bug: {
        id: report.id,
        title: report.title,
        createdAt: report.createdAt,
      },
      message: "Bug报告已提交成功" 
    });
  } catch (error) {
    console.error("写入Bug报告失败:", error);
    res.status(500).json({ 
      message: "服务器内部错误",
      code: "INTERNAL_ERROR" 
    });
  }
});

// 获取Bug报告列表（只返回基本信息）
app.get("/api/bugs", (req, res) => {
  try {
    if (!fs.existsSync(bugLogPath)) {
      return res.json({ bugs: [] });
    }
    
    const data = fs.readFileSync(bugLogPath, "utf8");
    const bugs = data
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        try {
          const bug = JSON.parse(line);
          // 只返回公开信息，隐藏敏感数据
          return {
            id: bug.id,
            title: bug.title,
            severity: bug.severity,
            page: bug.page,
            createdAt: bug.createdAt,
          };
        } catch {
          return null;
        }
      })
      .filter(bug => bug !== null);
    
    res.json({ bugs });
  } catch (error) {
    console.error("读取Bug报告失败:", error);
    res.status(500).json({ 
      message: "服务器内部错误",
      code: "INTERNAL_ERROR" 
    });
  }
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: "未找到资源",
    message: `请求的路径 ${req.path} 不存在`,
    code: "NOT_FOUND"
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error("服务器错误:", err);
  res.status(500).json({
    error: "服务器内部错误",
    message: "发生未知错误，请稍后重试",
    code: "SERVER_ERROR"
  });
});

// ==================== 服务器启动 ====================
function startServer() {
  const server = app.listen(port, host, () => {
    console.log(`🔒 安全版知识习惯跟踪器运行在 http://${host}:${port}`);
    console.log(`📊 健康检查: http://${host}:${port}/health`);
    console.log(`🔐 安全配置:`);
    console.log(`   - 主机: ${host} (${host === "localhost" ? "仅本地访问" : "网络可访问"})`);
    console.log(`   - CORS: ${enableCors ? `启用，来源: ${corsOrigin}` : "禁用"}`);
    console.log(`   - API密钥: ${apiKey ? "已启用" : "未启用"}`);
    console.log(`   - 速率限制: ${enableRateLimit ? "已启用" : "未启用"}`);
  });
  
  // 优雅关闭
  process.on("SIGTERM", () => {
    console.log("收到SIGTERM信号，正在关闭服务器...");
    server.close(() => {
      console.log("服务器已关闭");
      process.exit(0);
    });
  });
  
  return server;
}

if (require.main === module) {
  // 检查依赖
  try {
    require("helmet");
  } catch (error) {
    console.error("❌ 缺少安全依赖，请运行: npm install helmet cors express-rate-limit");
    console.error("或者使用原版 server.js");
    process.exit(1);
  }
  
  startServer();
}

module.exports = { app, startServer };