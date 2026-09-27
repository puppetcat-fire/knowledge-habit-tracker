const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../server");

const TREE_ID = "k9-math";
const ANCHOR_ID = "natural-numbers";

describe("personal nodes", () => {
  let tempDir;
  let app;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-habit-nodes-"));
    app = createApp({ dataDir: tempDir, allowedOrigins: [], rateLimitEnabled: false }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function register(name) {
    const agent = request.agent(app);
    const response = await agent.post("/api/register").send({ name, password: "secret-123" });
    expect(response.status).toBe(201);
    return { agent, id: response.body.user.id };
  }

  function createPrereqNode(agent, overrides = {}) {
    return agent.post("/api/nodes").send({
      title: "分数入门",
      goal: "会通分并比较分数大小",
      link: { type: "prereq", anchorId: ANCHOR_ID },
      ...overrides
    });
  }

  it("requires a session to list nodes", async () => {
    const response = await request(app).get("/api/nodes");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHENTICATED");
  });

  it("creates a personal prereq node and lists it with its edge", async () => {
    const owner = await register("nodeowner");

    const created = await createPrereqNode(owner.agent);
    expect(created.status).toBe(201);
    const node = created.body.node;
    expect(node.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(node.treeId).toBe(TREE_ID);
    expect(node.ownership).toBe("personal");
    expect(node.ownerId).toBe(owner.id);
    expect(node.estMinutes).toBe(10);
    expect(created.body.edge).toEqual({ from: ANCHOR_ID, to: node.id, type: "prereq" });

    const list = await owner.agent.get("/api/nodes");
    expect(list.status).toBe(200);
    const listed = list.body.nodes.find((candidate) => candidate.id === node.id);
    expect(listed).toBeTruthy();
    expect(listed.ownership).toBe("personal");
    expect(listed.ownerId).toBe(owner.id);
    expect(listed.treeId).toBe(TREE_ID);
    expect(list.body.edges).toContainEqual({ from: ANCHOR_ID, to: node.id, type: "prereq" });
  });

  it("lets only the owner update and delete the node", async () => {
    const owner = await register("nodeowner");
    const intruder = await register("intruder");

    const created = await createPrereqNode(owner.agent);
    const id = created.body.node.id;

    const foreignPatch = await intruder.agent.patch(`/api/nodes/${id}`).send({ title: "别人改的" });
    expect(foreignPatch.status).toBe(403);
    expect(foreignPatch.body.code).toBe("NOT_OWNER");

    const foreignDelete = await intruder.agent.delete(`/api/nodes/${id}`);
    expect(foreignDelete.status).toBe(403);
    expect(foreignDelete.body.code).toBe("NOT_OWNER");

    const ownerPatch = await owner.agent.patch(`/api/nodes/${id}`).send({ title: "新标题" });
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.node.title).toBe("新标题");
    expect(ownerPatch.body.node.id).toBe(id);
    expect(ownerPatch.body.node.ownerId).toBe(owner.id);

    const ownerDelete = await owner.agent.delete(`/api/nodes/${id}`);
    expect(ownerDelete.status).toBe(200);
    expect(ownerDelete.body.ok).toBe(true);

    const list = await owner.agent.get("/api/nodes");
    expect(list.body.nodes.find((candidate) => candidate.id === id)).toBeUndefined();
    expect(list.body.edges.find((edge) => edge.to === id || edge.from === id)).toBeUndefined();
  });

  it("accepts a record on a personal node while it exists", async () => {
    const owner = await register("nodeowner");

    const created = await createPrereqNode(owner.agent);
    const nodeId = created.body.node.id;

    const response = await owner.agent
      .post("/api/records")
      .send({ treeId: TREE_ID, nodeId, text: "今天练完了" });
    expect(response.status).toBe(201);
    expect(response.body.record.nodeId).toBe(nodeId);
  });

  it("rejects a record for an unknown node", async () => {
    const owner = await register("nodeowner");

    const response = await owner.agent
      .post("/api/records")
      .send({ treeId: TREE_ID, nodeId: "missing-node", text: "随便写点" });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("节点不在已知的知识树里。");
  });

  it("rejects invalid node payloads", async () => {
    const owner = await register("nodeowner");

    const emptyGoal = await owner.agent.post("/api/nodes").send({
      title: "标题",
      goal: "",
      link: { type: "prereq", anchorId: ANCHOR_ID }
    });
    expect(emptyGoal.status).toBe(400);
    expect(emptyGoal.body.message).toBe("写上这个节点要达成什么。");

    const badMinutes = await owner.agent.post("/api/nodes").send({
      title: "标题",
      goal: "目标",
      estMinutes: 3,
      link: { type: "prereq", anchorId: ANCHOR_ID }
    });
    expect(badMinutes.status).toBe(400);
    expect(badMinutes.body.message).toBe("建议时长是 5 到 15 分钟。");

    const badAnchor = await owner.agent.post("/api/nodes").send({
      title: "标题",
      goal: "目标",
      link: { type: "prereq", anchorId: "nope" }
    });
    expect(badAnchor.status).toBe(400);
    expect(badAnchor.body.message).toBe("先选一个已有节点，说明它挂在哪里。");
  });
});
