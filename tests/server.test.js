const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../server");

describe("server", () => {
  let tempDir;
  let app;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-habit-tracker-"));
    app = createApp({
      dataDir: tempDir,
      allowedOrigins: [],
      rateLimitEnabled: false
    }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves the personal site at the root", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("<!DOCTYPE html>");
    expect(response.text).toContain("渡鸦大人的工具站");
    expect(response.text).toContain('href="/habit/"');
    expect(response.text).toContain('href="/platform/"');
  });

  it("serves the habit tracker under /habit/", async () => {
    const response = await request(app).get("/habit/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("点亮习惯记录器");
    expect(response.text).toContain('src="app.js"');
  });

  it("serves the knowledge platform under /platform/", async () => {
    const response = await request(app).get("/platform/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("知识共建共享平台");
  });

  it("redirects the old bookmarks instead of breaking them", async () => {
    const legacyHabit = await request(app).get("/index.html");
    expect(legacyHabit.status).toBe(301);
    expect(legacyHabit.headers.location).toBe("/habit/");

    const legacyPlatform = await request(app).get("/platform.html");
    expect(legacyPlatform.status).toBe(301);
    expect(legacyPlatform.headers.location).toBe("/platform/");

    const noSlash = await request(app).get("/habit");
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.location).toBe("/habit/");
  });

  it("does not expose repository files as static assets", async () => {
    const paths = ["/README.md", "/site/index.html", "/server.js", "/package.json", "/data/bug-reports.jsonl"];
    for (const filePath of paths) {
      const response = await request(app).get(filePath);
      expect(response.status).toBe(404);
    }
  });

  it("serves the generated seed tree bundle where the apps expect it", async () => {
    const habitBundle = await request(app).get("/habit/seed-trees/seed-trees.js");
    expect(habitBundle.status).toBe(200);
    expect(habitBundle.headers["content-type"]).toContain("javascript");

    const platformBundle = await request(app).get("/platform/seed-trees/seed-trees.js");
    expect(platformBundle.status).toBe(200);
  });

  it("does not expose the seed tree json source", async () => {
    const response = await request(app).get("/habit/seed-trees/k9-math.json");
    expect(response.status).toBe(404);
  });

  it("returns a readable 404 page for missing pages", async () => {
    const response = await request(app).get("/nope").set("Accept", "text/html");
    expect(response.status).toBe(404);
    expect(response.text).toContain("回到首页");
  });

  it("keeps the api 404 as json", async () => {
    const response = await request(app).get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });

  it("marks the session cookie Secure when the deployment asks for it", async () => {
    const secureApp = createApp({ dataDir: tempDir, cookieSecure: true, rateLimitEnabled: false }).app;
    const response = await request(secureApp)
      .post("/api/register")
      .send({ name: "安全用户", password: "secret-123" });

    expect(response.status).toBe(201);
    const cookie = (response.headers["set-cookie"] || []).join("; ");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("stores bug reports after validation and hides private fields from listing", async () => {
    const createResponse = await request(app).post("/api/bugs").send({
      title: "<script>alert(1)</script> 本地问题",
      description: "页面切换后没有提示",
      contact: "me@example.com",
      severity: "high",
      page: "bug"
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.ok).toBe(true);
    expect(createResponse.body.bug.title).toBe("scriptalert(1)/script 本地问题");

    // A report from another address must not be listed back to this one.
    fs.appendFileSync(
      path.join(tempDir, "bug-reports.jsonl"),
      `${JSON.stringify({
        id: "someone-else",
        title: "别人的反馈",
        severity: "low",
        page: "site",
        ip: "203.0.113.9",
        createdAt: new Date().toISOString()
      })}\n`,
      "utf8"
    );

    const listResponse = await request(app).get("/api/bugs");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.bugs).toHaveLength(1);
    expect(listResponse.body.bugs[0].title).toBe("scriptalert(1)/script 本地问题");
    expect(listResponse.body.bugs[0].contact).toBeUndefined();
  });
});
