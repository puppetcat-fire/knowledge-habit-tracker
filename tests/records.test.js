const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../server");

const TREE_ID = "k9-math";
const NODE_ID = "linear-equation";
// 1×1 透明 PNG：内容与 mediaType 一致，解码后远小于 2MB
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("records", () => {
  let tempDir;
  let app;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-habit-records-"));
    app = createApp({ dataDir: tempDir, allowedOrigins: [], rateLimitEnabled: false }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function register(name) {
    const agent = request.agent(app);
    const response = await agent.post("/api/register").send({ name, password: "secret-123" });
    expect(response.status).toBe(201);
    return agent;
  }

  it("requires a session for records and media", async () => {
    expect((await request(app).get("/api/records")).status).toBe(401);
    expect((await request(app).post("/api/records").send({})).status).toBe(401);
    expect((await request(app).get("/api/media/deadbeef")).status).toBe(401);
  });

  it("stores a text record and lists it newest first", async () => {
    const alice = await register("alice");

    const first = await alice.post("/api/records").send({ treeId: TREE_ID, nodeId: NODE_ID, text: "第一条" });
    expect(first.status).toBe(201);
    expect(first.body.record.nodeId).toBe(NODE_ID);
    expect(first.body.record.authorName).toBe("alice");
    expect(first.body.record.images).toEqual([]);
    expect(first.body.record.eventId).toBeNull();

    await alice.post("/api/records").send({ treeId: TREE_ID, nodeId: "like-terms", text: "第二条" });

    const list = await alice.get(`/api/records?treeId=${TREE_ID}`);
    expect(list.status).toBe(200);
    expect(list.body.records).toHaveLength(2);
    expect(list.body.records[0].text).toBe("第二条");

    const byNode = await alice.get(`/api/records?treeId=${TREE_ID}&nodeId=${NODE_ID}`);
    expect(byNode.body.records).toHaveLength(1);
  });

  it("stores a 1x1 png dataUrl and serves it back to another account", async () => {
    const alice = await register("alice");
    const bob = await register("bob");

    const created = await alice.post("/api/records").send({
      treeId: TREE_ID,
      nodeId: NODE_ID,
      text: "",
      images: [{ mediaType: "image/png", dataUrl: `data:image/png;base64,${PNG_1X1}` }]
    });

    expect(created.status).toBe(201);
    expect(created.body.record.text).toBe("");
    expect(created.body.record.images).toHaveLength(1);
    expect(created.body.record.images[0].mediaType).toBe("image/png");
    const mediaId = created.body.record.images[0].id;
    expect(mediaId).toMatch(/^[0-9a-f]+$/);

    // 两个账号共享同一批打卡
    const list = await bob.get(`/api/records?treeId=${TREE_ID}`);
    expect(list.body.records).toHaveLength(1);
    expect(list.body.records[0].authorName).toBe("alice");

    const media = await bob.get(`/api/media/${mediaId}`);
    expect(media.status).toBe(200);
    expect(media.headers["content-type"]).toContain("image/png");
    expect(media.body.length).toBeGreaterThan(0);
  });

  it("rejects empty records and invalid images", async () => {
    const alice = await register("alice");

    const empty = await alice.post("/api/records").send({ treeId: TREE_ID, nodeId: NODE_ID, text: "   " });
    expect(empty.status).toBe(400);

    const badType = await alice.post("/api/records").send({
      treeId: TREE_ID,
      nodeId: NODE_ID,
      text: "",
      images: [{ mediaType: "image/bmp", dataUrl: "data:image/bmp;base64,AAAA" }]
    });
    expect(badType.status).toBe(400);

    const mismatched = await alice.post("/api/records").send({
      treeId: TREE_ID,
      nodeId: NODE_ID,
      text: "",
      images: [{ mediaType: "image/png", dataUrl: "data:image/png;base64,QUJDRA==" }]
    });
    expect(mismatched.status).toBe(400);
  });

  it("rejects an unknown node or a malformed scope", async () => {
    const alice = await register("alice");

    const unknown = await alice.post("/api/records").send({ treeId: TREE_ID, nodeId: "not-a-node", text: "x" });
    expect(unknown.status).toBe(400);

    const badScope = await alice.post("/api/records").send({ treeId: "bad/id", nodeId: NODE_ID, text: "x" });
    expect(badScope.status).toBe(400);
  });

  it("deduplicates by eventId and only lets the author delete", async () => {
    const alice = await register("alice");
    const bob = await register("bob");

    const first = await alice
      .post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "同一次", eventId: "evt-1" });
    expect(first.status).toBe(201);

    const again = await alice
      .post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "同一次", eventId: "evt-1" });
    expect(again.status).toBe(200);
    expect(again.body.record.id).toBe(first.body.record.id);

    expect((await alice.get(`/api/records?treeId=${TREE_ID}`)).body.records).toHaveLength(1);

    const foreign = await bob.delete(`/api/records/${first.body.record.id}`);
    expect(foreign.status).toBe(404);

    const removed = await alice.delete(`/api/records/${first.body.record.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.ok).toBe(true);

    expect((await alice.get(`/api/records?treeId=${TREE_ID}`)).body.records).toHaveLength(0);
  });

  it("refuses a non-hex media id", async () => {
    const alice = await register("alice");

    const traversal = await alice.get("/api/media/..%2f..%2fusers.json");
    expect([400, 404]).toContain(traversal.status);
  });
});
