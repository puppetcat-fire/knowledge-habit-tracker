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

  it("publishes an explicit projection, preserves the tutorial version and withdraws from all public views", async () => {
    const privateApi = "/api/state/wants";
    const graph = "/api/state/demand-graph";
    const first = request.agent(app);
    const second = request.agent(app);
    await first.post("/api/register").send({ name: "graph-first", password: "test-password" }).expect(201);
    await second.post("/api/register").send({ name: "graph-second", password: "test-password" }).expect(201);
    const id = "3da3dd27-7d8c-4bc3-a258-4afce2519cd3";
    const tutorialId = "linear-equation-move-terms";
    const input = { id, title: "私人标题", budget: 863.77, details: "私人笔记", step: "私人材料",
      practice: "私人实践", practiceId: "private-event-id",
      link: "https://example.com/private", tutorialId };
    await first.post(privateApi).send(input).expect(201);
    await second.post(privateApi).send(input).expect(201);
    expect((await request(app).get(graph)).body.groups).toEqual([]);
    const publish = { title: "公开用途", intent: "considering", secondhand: "yes", specification: "规格 A",
      tutorialId, tutorialUse: "alternative", tutorialStep: "公开材料" };
    const url = privateApi + "/" + id + "/publication";
    const published = (await first.put(url).send(publish).expect(200)).body.want.publication;
    await second.put(url).send({ ...publish, specification: "规格 B", groupId: published.groupId }).expect(200);
    const open = await request(app).get(graph).query({ tutorial: tutorialId }).expect(200);
    expect(open.headers["cache-control"]).toBe("no-store");
    expect(open.body.groups).toHaveLength(1);
    expect(open.body.groups[0]).toMatchObject({ wanted: 2, considering: 2, resolved: 0 });
    expect(open.body.groups[0].publications).toEqual(expect.arrayContaining([
      expect.objectContaining({ specification: "规格 A", tutorialStep: "公开材料",
        tutorial: expect.objectContaining({ id: tutorialId, version: "seed-1" }) }),
      expect.objectContaining({ specification: "规格 B" })
    ]));
    for (const value of ["863.77", "私人标题", "私人笔记", "私人材料", "私人实践", "private-event-id", "example.com", "graph-first", id]) {
      expect(open.text).not.toContain(value);
    }
    await first.put(privateApi + "/" + id).send({ ...input, budget: 999, status: "resolved" }).expect(200);
    expect((await request(app).get(graph)).body.groups[0]).toMatchObject({ wanted: 1, considering: 1, resolved: 1 });
    await first.delete(url).expect(200);
    expect((await first.get(privateApi)).body.wants[0]).toMatchObject({
      budget: 999, details: "私人笔记", practice: { id: "private-event-id", title: "私人实践" }
    });
    expect((await request(app).get(graph).query({ publication: published.id })).body.groups).toEqual([]);
    expect((await request(app).get(graph)).body.groups[0]).toMatchObject({ wanted: 1, resolved: 0 });
    await second.delete(privateApi + "/" + id).expect(200);
    expect((await request(app).get(graph)).body.groups).toEqual([]);
  });

  it("serves the knowledge platform under /platform/", async () => {
    const response = await request(app).get("/platform/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("知识共建共享平台");
  });

  it("limits moderation to the designated account and keeps old links after a merge", async () => {
    const ordinary = request.agent(app);
    const registered = await ordinary.post("/api/register").send({ name: "graph-moderator", password: "test-password" }).expect(201);
    app = createApp({ dataDir: tempDir, demandModeratorId: registered.body.user.id, rateLimitEnabled: false }).app;
    const moderator = request.agent(app);
    await moderator.post("/api/login").send({ name: "graph-moderator", password: "test-password" }).expect(200);
    const privateApi = "/api/state/wants";
    const graph = "/api/state/demand-graph";
    const input = { title: "测试公开需求", intent: "want", secondhand: "unspecified" };
    const shares = [];
    for (const id of ["3da3dd27-7d8c-4bc3-a258-4afce2519cd3", "9da3dd27-7d8c-4bc3-a258-4afce2519cd3"]) {
      await moderator.post(privateApi).send({ ...input, id }).expect(201);
      const response = await moderator.put(privateApi + "/" + id + "/publication").send(input).expect(200);
      shares.push(response.body.want.publication);
    }
    const merge = { action: "merge", groupId: shares[0].groupId, into: shares[1].groupId };
    await request(app).post(graph + "/moderate").send(merge).expect(403);
    await moderator.post(graph + "/moderate").send(merge).expect(200);
    const merged = (await request(app).get(graph).query({ group: shares[0].groupId })).body.groups[0];
    expect(merged.id).toBe(shares[1].groupId);
    expect(merged.wanted).toBe(1);
    expect(merged.publications).toHaveLength(2);
    const split = await moderator.post(graph + "/moderate")
      .send({ action: "split", groupId: merged.id, publicationId: shares[0].id }).expect(200);
    const result = (await request(app).get(graph).query({ publication: shares[0].id })).body.groups[0];
    expect(result.id).toBe(split.body.groupId);
    expect(result.publications).toHaveLength(1);
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
