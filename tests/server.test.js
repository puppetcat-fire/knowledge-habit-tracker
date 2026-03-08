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

  it("serves the local sandbox app entry", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("<!DOCTYPE html>");
    expect(response.text).toContain("点亮习惯记录器");
  });

  it("does not expose repository files as static assets", async () => {
    const response = await request(app).get("/README.md");
    expect(response.status).toBe(404);
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

    const listResponse = await request(app).get("/api/bugs");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.bugs).toHaveLength(1);
    expect(listResponse.body.bugs[0].title).toBe("scriptalert(1)/script 本地问题");
    expect(listResponse.body.bugs[0].contact).toBeUndefined();
  });
});
