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
    expect(response.text).toContain("记录我想要的东西");
    expect(response.text).toContain('href="/habit/"');
    expect(response.text).toContain('href="/platform/"');
  });

  it("serves the tools shelf and the perler tool from the repository", async () => {
    const index = await request(app).get("/tools/");
    expect(index.status).toBe(200);
    expect(index.text).toContain("小工具");
    expect(index.text).toContain('href="/tools/perler-beads/"');

    const perler = await request(app).get("/tools/perler-beads/");
    expect(perler.status).toBe(200);
    expect(perler.text).toContain("拼豆");
  });

  it("keeps wants private and supports idempotent creation, editing and deletion", async () => {
    const endpoint = "/api/state/wants";
    const page = await request(app).get("/wants/");
    expect(page.text).toContain("我的想要");
    expect((await request(app).get(endpoint)).status).toBe(401);

    const first = request.agent(app);
    const second = request.agent(app);
    await first.post("/api/register").send({ name: "first-user", password: "test-password" }).expect(201);
    await second.post("/api/register").send({ name: "second-user", password: "test-password" }).expect(201);
    const input = {
      id: "3da3dd27-7d8c-4bc3-a258-4afce2519cd3",
      title: "电子鼓", budget: 800, details: "出租屋练习", source: "练习教程"
    };
    await first.post(endpoint).send({ ...input, link: "javascript:alert(1)" }).expect(400);
    await first.post(endpoint).send(input).expect(201);
    await first.post(endpoint).send(input).expect(200);
    expect((await first.get(endpoint)).body.wants).toHaveLength(1);
    expect((await second.get(endpoint)).body.wants).toEqual([]);
    const url = endpoint + "/" + input.id;
    await second.put(url).send({ ...input, status: "resolved" }).expect(404);
    await second.delete(url).expect(200);
    const edited = await first.put(url).send({ ...input, source: "changed", status: "resolved" }).expect(200);
    expect(edited.body.want).toMatchObject({ source: "练习教程", status: "resolved" });
    await first.delete(url).expect(200);
    expect((await first.get(endpoint)).body.wants).toEqual([]);
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
