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
    const root = await request(habitApp).get("/");
    expect(root.status).toBe(200);
    expect(root.text).toContain("点亮习惯记录器");

    expect((await request(habitApp).get("/platform.js")).status).toBe(404);
    expect((await request(habitApp).get("/platform.css")).status).toBe(404);
  });

  it("keeps the platform surface on its own whitelist", async () => {
    const root = await request(platformApp).get("/");
    expect(root.status).toBe(200);
    expect(root.text).toContain("知识共建共享平台");

    expect((await request(platformApp).get("/app.js")).status).toBe(404);
    expect((await request(platformApp).get("/style.css")).status).toBe(404);
    expect((await request(platformApp).get("/seed-trees/seed-trees.js")).status).toBe(200);
    expect((await request(platformApp).get("/seed-trees/k9-math.json")).status).toBe(404);
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
