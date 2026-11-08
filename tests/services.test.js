const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../server");

describe("services", () => {
  let tempDir;
  let app;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-services-"));
    app = createApp({ dataDir: tempDir, rateLimitEnabled: false }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps each surface on its own path prefix", async () => {
    const homepage = await request(app).get("/");
    expect(homepage.status).toBe(200);
    expect(homepage.text).toContain("记录我想要的东西");
    expect(homepage.text).toContain('href="/demand-graph/"');

    expect((await request(app).get("/habit/")).text).toContain("点亮习惯记录器");
    expect((await request(app).get("/platform/")).text).toContain("知识共建共享平台");

    // 应用文件只在各自前缀下存在，根路径不暴露
    expect((await request(app).get("/app.js")).status).toBe(404);
    expect((await request(app).get("/platform.js")).status).toBe(404);
    expect((await request(app).get("/habit/platform.js")).status).toBe(404);
    expect((await request(app).get("/platform/app.js")).status).toBe(404);
  });

  it("keeps the whitelist narrow enough to hide source and data", async () => {
    const blocked = [
      "/server.js",
      "/docs/first-increment-design.md",
      "/tests/server.test.js",
      "/site/index.html",
      "/seed-trees/"
    ];
    for (const route of blocked) {
      const response = await request(app).get(route);
      expect(response.status).toBe(404);
    }
  });

  it("serves the integrated account, knowledge and community assets on the same origin", async () => {
    const visitor = request.agent(app);
    expect((await visitor.get("/habit?view=timer")).headers.location).toBe("/habit/?view=timer");
    expect((await visitor.get("/platform?view=atlas")).headers.location).toBe("/platform/?view=atlas");
    await visitor.get("/habit/account-backup.js").expect(200);
    await visitor.get("/platform/personal-home.js").expect(200);
    const product = await visitor.get("/platform/product.html").expect(200);
    expect(product.text).toContain("关联教程");
    await visitor.get("/platform/product.js").expect(200);
    for (const route of ["/habit/runtime-config.js", "/platform/runtime-config.js"]) {
      expect((await visitor.get(route).expect(200)).text).toContain('"habitUrl":"/habit/","platformUrl":"/platform/"');
    }
    await visitor.post("/api/register").send({ name: "同源读者", password: "secret-123" }).expect(201);
    await visitor.get("/api/tutorials").expect(200);
    await visitor.get("/api/account/export").expect(200);
    await visitor.get("/api/state/wants").expect(200);
  });

  it("shares accounts, sessions and state through one data directory", async () => {
    const register = await request(app).post("/api/register").send({ name: "共享用户", password: "secret-123" });
    expect(register.status).toBe(201);
    const cookie = (register.headers["set-cookie"] || []).map((item) => item.split(";")[0]).join("; ");

    const me = await request(app).get("/api/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe("共享用户");

    const payload = { version: 3, marker: "shared" };
    const put = await request(app).put("/api/state").set("Cookie", cookie).send(payload);
    expect(put.status).toBe(200);

    const state = await request(app).get("/api/state").set("Cookie", cookie);
    expect(state.status).toBe(200);
    expect(state.body.state).toEqual(payload);
  });
});
