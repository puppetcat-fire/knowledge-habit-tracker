const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../server");

describe("services", () => {
  let tempDir;
  let habitApp;
  let platformApp;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-services-"));
    habitApp = createApp({ dataDir: tempDir, rateLimitEnabled: false }).app;
    platformApp = createApp({ surface: "platform", dataDir: tempDir, rateLimitEnabled: false }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps the habit surface on its own whitelist", async () => {
    const root = await request(habitApp).get("/habit/");
    expect(root.status).toBe(200);
    expect(root.text).toContain("点亮习惯记录器");

    expect((await request(habitApp).get("/platform.js")).status).toBe(404);
    expect((await request(habitApp).get("/platform.css")).status).toBe(404);
    expect((await request(habitApp).get("/product-rules.js")).status).toBe(200);
  });

  it("keeps the platform surface on its own whitelist", async () => {
    const root = await request(platformApp).get("/");
    expect(root.status).toBe(200);
    expect(root.text).toContain("知识共建共享平台");

    expect((await request(platformApp).get("/app.js")).status).toBe(404);
    expect((await request(platformApp).get("/style.css")).status).toBe(404);
    expect((await request(platformApp).get("/seed-trees/seed-trees.js")).status).toBe(200);
    expect((await request(platformApp).get("/seed-trees/k9-math.json")).status).toBe(404);
    expect((await request(platformApp).get("/product-rules.js")).status).toBe(200);
  });

  it("serves knowledge pages and their assets under the habit origin", async () => {
    const visitor = request.agent(habitApp);
    const home = await visitor.get("/").expect(200);
    expect(home.text).toContain('href="/habit/"');
    expect(home.text).toContain('href="/platform/"');
    expect((await visitor.get("/habit?view=timer")).headers.location).toBe("/habit/?view=timer");
    expect((await visitor.get("/platform?view=atlas")).headers.location).toBe("/platform/?view=atlas");
    expect((await visitor.get("/habit/app.js")).status).toBe(200);
    expect((await visitor.get("/platform/platform.js")).status).toBe(200);
    expect((await visitor.get("/platform/product.html")).text).toContain("关联教程");
    expect((await visitor.get("/platform/product.js")).status).toBe(200);
    expect((await visitor.get("/platform/")).text).toContain("知识共建共享平台");
    expect((await visitor.get("/knowledge")).headers.location).toBe("/knowledge/");
    expect((await visitor.get("/knowledge/")).text).toContain("知识共建共享平台");
    expect((await visitor.get("/knowledge/platform.js")).status).toBe(200);
    expect((await visitor.get("/knowledge/personal-home.js")).status).toBe(200);
    expect((await visitor.get("/knowledge/seed-trees/seed-trees.js")).status).toBe(200);
    expect((await visitor.get("/knowledge/app.js")).status).toBe(404);
    for (const endpoint of ["/runtime-config.js", "/habit/runtime-config.js", "/platform/runtime-config.js", "/knowledge/runtime-config.js"]) {
      const runtime = await visitor.get(endpoint);
      expect(runtime.status).toBe(200);
      expect(runtime.text).toContain('"habitUrl":"/habit/","platformUrl":"/platform/"');
      expect(runtime.text).not.toContain("communityUrl");
    }
    expect((await visitor.post("/api/register").send({ name: "同源读者", password: "secret-123" })).status).toBe(201);
    expect((await visitor.get("/api/me")).body.user.name).toBe("同源读者");
  });

  it("shares accounts, sessions and state through one data directory", async () => {
    const register = await request(habitApp).post("/api/register").send({ name: "共享用户", password: "secret-123" });
    expect(register.status).toBe(201);
    const cookie = (register.headers["set-cookie"] || []).map((item) => item.split(";")[0]).join("; ");

    const me = await request(platformApp).get("/api/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe("共享用户");

    const payload = { version: 3, marker: "shared" };
    const put = await request(habitApp).put("/api/state").set("Cookie", cookie).send(payload);
    expect(put.status).toBe(200);

    const state = await request(platformApp).get("/api/state").set("Cookie", cookie);
    expect(state.status).toBe(200);
    expect(state.body.state).toEqual(payload);
  });
});
