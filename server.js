const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000;

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const bugLogPath = path.join(dataDir, "bug-reports.jsonl");

app.use(express.json({ limit: "256kb" }));
app.use(express.static(rootDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.post("/api/bugs", (req, res) => {
  const { title, description, steps, expected, actual, severity, contact, page } = req.body || {};
  if (!title || !description) {
    res.status(400).json({ message: "标题与问题描述为必填" });
    return;
  }
  const report = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: String(title).slice(0, 100),
    description: String(description).slice(0, 1000),
    steps: steps ? String(steps).slice(0, 1000) : "",
    expected: expected ? String(expected).slice(0, 500) : "",
    actual: actual ? String(actual).slice(0, 500) : "",
    severity: severity === "high" || severity === "low" ? severity : "medium",
    contact: contact ? String(contact).slice(0, 100) : "",
    page: page ? String(page).slice(0, 50) : "",
    userAgent: req.get("user-agent") || "",
    ip: req.ip,
    createdAt: new Date().toISOString()
  };
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.appendFileSync(bugLogPath, `${JSON.stringify(report)}\n`, "utf8");
    res.json({ ok: true, bug: report });
  } catch {
    res.status(500).json({ message: "写入失败" });
  }
});

function startServer() {
  return app.listen(port, () => {
    console.log(`Knowledge Habit Tracker running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
