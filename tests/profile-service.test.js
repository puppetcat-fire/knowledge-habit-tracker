const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../server");

describe("personal home and privacy", () => {
  let directory, app, alice, bob, id;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "kht-profile-"));
    app = createApp({ dataDir: directory }).app;
    alice = request.agent(app); bob = request.agent(app);
    id = (await alice.post("/api/register").send({ name: "alice", password: "secret-123" })).body.user.id;
    await bob.post("/api/register").send({ name: "bob", password: "secret-123" });
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  it("does not leak private biography, methods, practices, habits or event time", async () => {
    const home = (await alice.get(`/api/profiles/${id}`)).body;
    await alice.patch("/api/profile").set("If-Match", home.revision).send({ tagline: "私人的介绍", about: "私人的经历", focus: "私人的目标", visibility: "private" });
    await alice.put("/api/state").send({ version: 3, habit: { active: true, name: "私人习惯" }, events: [{ id: "e", title: "私人事件", createdAt: "2026-10-01T00:00:00Z", durationMs: 300000, treeId: "k9-math", nodeId: "linear-equation" }] });
    await alice.post("/api/tutorials").send({ treeId: "k9-math", nodeId: "linear-equation", title: "私人方法", method: "步骤" });
    const other = (await bob.get(`/api/profiles/${id}`)).body;
    expect(other.methods).toEqual([]); expect(other.records).toEqual([]);
    expect(other.stats.events).toBeUndefined(); expect(other.stats.measuredMs).toBeUndefined();
    expect(JSON.stringify(other)).not.toContain("私人的介绍"); expect(JSON.stringify(other)).not.toContain("私人习惯");
    const own = (await alice.get(`/api/profiles/${id}`)).body;
    expect(own.stats.measuredMs).toBe(300000); expect(own.records[0].text).toContain("私人事件");
  });
  it("rejects a stale profile form sent with a different account's session", async () => {
    const aliceHome = (await alice.get(`/api/profiles/${id}`)).body;
    const bobId = (await bob.get("/api/me")).body.user.id;
    const bobHome = (await bob.get(`/api/profiles/${bobId}`)).body;
    expect(aliceHome.revision).not.toBe(bobHome.revision);
    const draft = { tagline: "只属于 Alice 的草稿", visibility: "private" };
    expect((await bob.patch("/api/profile").set("If-Match", aliceHome.revision).send(draft)).status).toBe(409);
    expect((await bob.get(`/api/profiles/${bobId}`)).body.profile.tagline).toBe("");
    expect((await alice.patch("/api/profile").set("If-Match", aliceHome.revision).send(draft)).status).toBe(200);
  });
  it("shows real public contributions and rejects stale biography edits", async () => {
    const home = (await alice.get(`/api/profiles/${id}`)).body;
    const body = { tagline: "一起探索", about: "我做过的事", focus: "学习", visibility: "public" };
    expect((await alice.patch("/api/profile").set("If-Match", home.revision).send(body)).status).toBe(200);
    expect((await alice.patch("/api/profile").set("If-Match", home.revision).send(body)).status).toBe(409);
    const practice = await alice.post("/api/records").send({ treeId: "k9-math", nodeId: "linear-equation", text: "自己解出一道题", lightUp: true, visibility: "public" });
    const other = (await bob.get(`/api/profiles/${id}`)).body;
    expect(other.profile.tagline).toBe("一起探索"); expect(other.records).toHaveLength(1);
    expect(other.holdings).toEqual([{ treeId: "k9-math", nodeId: "linear-equation", ownership: "group" }]);
    const recordUrl = `/api/records/${practice.body.record.id}`;
    expect((await bob.patch(recordUrl).send({ visibility: "private" })).status).toBe(404);
    expect((await alice.patch(recordUrl).send({ visibility: "private" })).status).toBe(200);
    const withdrawn = (await bob.get(`/api/profiles/${id}`)).body;
    expect(withdrawn.records).toEqual([]);
    expect(withdrawn.holdings).toEqual([]);
    expect((await alice.get(`/api/profiles/${id}`)).body.records[0].visibility).toBe("private");
    expect(JSON.stringify(other)).not.toContain('"hash"'); expect(JSON.stringify(other)).not.toContain('"salt"');
    const archive = (await alice.get("/api/account/export")).body;
    expect(archive.profile.tagline).toBe("一起探索");
    expect((await alice.post("/api/account/import").send(archive)).status).toBe(200);
    expect((await bob.get(`/api/profiles/${id}`)).body.profile.tagline).toBe("");
  });
});
