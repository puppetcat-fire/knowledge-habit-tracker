const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../server");

describe("account", () => {
  let tempDir;
  let app;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-habit-account-"));
    app = createApp({
      dataDir: tempDir,
      allowedOrigins: [],
      rateLimitEnabled: false
    }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers a user, returns the public profile and sets a session cookie", async () => {
    const response = await request(app).post("/api/register").send({ name: "小林", password: "secret-123" });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.user.name).toBe("小林");
    expect(response.body.user.id).toBeTruthy();

    const cookie = (response.headers["set-cookie"] || []).join(";");
    expect(cookie).toContain("kht_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });

  it("rejects a name that is already taken, ignoring case", async () => {
    await request(app).post("/api/register").send({ name: "Alice", password: "secret-123" });

    const response = await request(app).post("/api/register").send({ name: "alice", password: "secret-456" });

    expect(response.status).toBe(409);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("NAME_TAKEN");
  });

  it("rejects an invalid registration payload", async () => {
    const response = await request(app).post("/api/register").send({ name: "a", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a wrong password without revealing which field failed", async () => {
    await request(app).post("/api/register").send({ name: "bob", password: "secret-123" });

    const response = await request(app).post("/api/login").send({ name: "bob", password: "wrong-pass" });

    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("INVALID_LOGIN");
    expect(response.body.message).toBe("名字或密码不对。");
  });

  it("requires a session for me and state", async () => {
    const me = await request(app).get("/api/me");
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("UNAUTHENTICATED");

    const state = await request(app).get("/api/state");
    expect(state.status).toBe(401);
    expect(state.body.code).toBe("UNAUTHENTICATED");
  });

  it("round-trips state for a logged-in user and starts from null", async () => {
    const agent = request.agent(app);
    await agent.post("/api/register").send({ name: "carol", password: "secret-123" });

    const me = await agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe("carol");

    const initial = await agent.get("/api/state");
    expect(initial.status).toBe(200);
    expect(initial.body.state).toBeNull();

    const payload = { version: 3, habit: null, habitHistory: [], events: [], note: "hello" };
    const put = await agent.put("/api/state").send(payload);
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);

    const read = await agent.get("/api/state");
    expect(read.status).toBe(200);
    expect(read.body.state).toEqual(payload);
  });

  it("keeps each user's state private", async () => {
    const alice = request.agent(app);
    await alice.post("/api/register").send({ name: "alice", password: "secret-123" });
    expect((await alice.put("/api/state").send({ version: 3, marker: "alice" })).status).toBe(200);

    const bob = request.agent(app);
    await bob.post("/api/register").send({ name: "bob", password: "secret-123" });

    const bobState = await bob.get("/api/state");
    expect(bobState.status).toBe(200);
    expect(bobState.body.state).toBeNull();

    const aliceState = await alice.get("/api/state");
    expect(aliceState.body.state.marker).toBe("alice");
  });

  it("rejects a state written by a newer version", async () => {
    const agent = request.agent(app);
    await agent.post("/api/register").send({ name: "dave", password: "secret-123" });

    const response = await agent.put("/api/state").send({ version: 4 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("更新的版本");
  });

  it("clears the cookie on logout", async () => {
    const agent = request.agent(app);
    await agent.post("/api/register").send({ name: "erin", password: "secret-123" });

    const response = await agent.post("/api/logout");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect((response.headers["set-cookie"] || []).join(";")).toContain("Max-Age=0");

    const me = await agent.get("/api/me");
    expect(me.status).toBe(401);
  });

  it("never returns or stores plaintext passwords", async () => {
    const password = "super-secret-123";
    const response = await request(app).post("/api/register").send({ name: "frank", password });

    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(JSON.stringify(response.body)).not.toContain("salt");
    expect(JSON.stringify(response.body)).not.toContain("hash");

    const usersRaw = fs.readFileSync(path.join(tempDir, "users.json"), "utf8");
    expect(usersRaw).not.toContain(password);
    expect(usersRaw).toContain("\"salt\"");
    expect(usersRaw).toContain("\"hash\"");
  });
});
