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
    expect(homepage.text).toContain("渡鸦大人的工具站");

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
