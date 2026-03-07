const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "localhost"; // 关键安全设置：默认localhost

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const bugLogPath = path.join(dataDir, "bug-reports.jsonl");

// ==================== 基本安全措施 ====================

// 1. 永远只绑定到指定主机（默认localhost）
console.log(`🔒 安全提示: 服务绑定到 ${host}`);
if (host === "0.0.0.0") {
  console.log("⚠️  警告: 服务对网络可见，请确保在可信网络环境中");
}

// 2. 基本的安全HTTP头
app.use((req, res, next) => {
  // 防止点击劫持
  res.setHeader("X-Frame-Options", "DENY");
  // 禁止MIME类型嗅探
  res.setHeader("X-Content-Type-Options", "nosniff");
  // 基本的CSP
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  next();
});

// 3. 增强的输入验证函数
const validateAndSanitize = (input, maxLength, fieldName) => {
  if (input === undefined || input === null) return "";
  
  const str = String(input);
  
  // 长度限制
  if (str.length > maxLength) {
    console.warn(`输入过长: ${fieldName} (${str.length} > ${maxLength})`);
  }
  
  // 移除危险字符（保留中文、英文、数字、基本标点）
  const sanitized = str
    .slice(0, maxLength)
    .replace(/[<>]/g, "") // 移除尖括号防止XSS
    .replace(/javascript:/gi, "") // 移除javascript:协议
    .replace(/data:/gi, ""); // 移除data:协议
  
  return sanitized;
};

// ==================== 应用中间件 ====================
app.use(express.json({ limit: "256kb" }));
app.use(express.static(rootDir));

// ==================== 路由处理 ====================

app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

// 安全增强的Bug报告API
app.post("/api/bugs", (req, res) => {
  const { title, description, steps, expected, actual, severity, contact, page } = req.body || {};
  
  // 验证必填字段
  if (!title || !description) {
    return res.status(400).json({ 
      message: "标题与问题描述为必填项",
      code: "VALIDATION_ERROR" 
    });
  }
  
  // 清理所有输入
  const report = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: validateAndSanitize(title, 100, "title"),
    description: validateAndSanitize(description, 1000, "description"),
    steps: steps ? validateAndSanitize(steps, 1000, "steps") : "",
    expected: expected ? validateAndSanitize(expected, 500, "expected") : "",
    actual: actual ? validateAndSanitize(actual, 500, "actual") : "",
    severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
    contact: contact ? validateAndSanitize(contact, 100, "contact") : "",
    page: page ? validateAndSanitize(page, 50, "page") : "",
    userAgent: req.get("user-agent") || "",
    ip: req.ip,
    createdAt: new Date().toISOString(),
  };
  
  // 验证清理后的数据
  if (!report.title.trim() || !report.description.trim()) {
    return res.status(400).json({ 
      message: "输入数据无效",
      code: "INVALID_INPUT" 
    });
  }
  
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.appendFileSync(bugLogPath, `${JSON.stringify(report)}\n`, "utf8");
    
    // 响应中只返回必要信息，隐藏敏感数据
    res.json({ 
      ok: true, 
      bug: {
        id: report.id,
        title: report.title,
        createdAt: report.createdAt,
      },
      message: "报告提交成功" 
    });
  } catch (error) {
    console.error("写入失败:", error);
    res.status(500).json({ 
      message: "服务器内部错误",
      code: "INTERNAL_ERROR" 
    });
  }
});

// 获取Bug报告（只返回公开信息）
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
    console.error("读取失败:", error);
    res.status(500).json({ 
      message: "服务器内部错误",
      code: "INTERNAL_ERROR" 
    });
  }
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    error: "未找到",
    message: `路径 ${req.path} 不存在`
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error("错误:", err);
  res.status(500).json({
    error: "服务器错误",
    message: "请稍后重试"
  });
});

// ==================== 服务器启动 ====================
function startServer() {
  const server = app.listen(port, host, () => {
    console.log(`📝 知识习惯跟踪器运行在 http://${host}:${port}`);
    console.log(`🔐 安全模式: ${host === "localhost" ? "仅本地访问" : "网络可访问"}`);
    console.log(`💡 提示: 设置 HOST=localhost 可限制为仅本机访问`);
  });
  
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };