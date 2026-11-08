const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../server");
const { commitTransaction, recoverTransactions, atomicJson } = require("../storage-transaction");

describe("complete account backup and recoverable restore", () => {
  let directory, app, alice, bob;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-archive-"));
    app = createApp({ dataDir: directory }).app;
    alice = request.agent(app); bob = request.agent(app);
    await alice.post("/api/register").send({ name: "alice", password: "secret-123" });
    await bob.post("/api/register").send({ name: "bob", password: "secret-123" });
  });

  it("rejects a restore after another window saves or changes the signed-in account", async () => {
    const original = { version: 3, events: [{ id: "first", title: "写作", createdAt: "2026-09-30T10:00:00Z" }] };
    const newer = { version: 3, events: [{ id: "second", title: "阅读", createdAt: "2026-09-30T11:00:00Z" }] };
    await alice.put("/api/state").send(original).expect(200);
    await bob.put("/api/state").send(original).expect(200);
    const { body: backup } = await alice.get("/api/account/export").expect(200);
    const { body: before } = await alice.get("/api/state").expect(200);
    const { body: saved } = await alice.put("/api/state").set("If-Match", before.revision).send(newer).expect(200);

    const restore = (agent, revision) => agent.post("/api/account/import")
      .set("X-Action-Account", backup.account.id).set("If-Match", revision).send(backup);
    expect((await restore(alice, before.revision).expect(409)).body.code).toBe("STATE_CONFLICT");
    expect((await restore(bob, before.revision).expect(409)).body.code).toBe("ACTION_ACCOUNT_CHANGED");
    expect((await alice.get("/api/state")).body.state).toEqual(newer);
    expect((await bob.get("/api/state")).body.state).toEqual(original);

    await restore(alice, saved.revision).expect(200);
    expect((await alice.get("/api/state")).body.state).toEqual(original);
  });

  it("protects a newly published practice from restore without treating another author's changes as conflicts", async () => {
    const practice = { treeId: "k9-math", nodeId: "linear-equation", text: "我的练习", visibility: "private" };
    const { body: { record } } = await alice.post("/api/records").send(practice).expect(201);
    const { body: backup } = await alice.get("/api/account/export").expect(200);
    const { body: snapshot } = await alice.get("/api/account/import-revision").expect(200);
    const restore = (revision) => alice.post("/api/account/import")
      .set("X-Action-Account", snapshot.ownerId).set("X-Knowledge-Revision", revision).send(backup);

    await bob.post("/api/records").send(practice).expect(201);
    expect((await alice.get("/api/account/import-revision")).body.revision).toBe(snapshot.revision);
    await alice.patch("/api/records/" + record.id).send({ visibility: "public" }).expect(200);
    expect((await restore(snapshot.revision).expect(409)).body.code).toBe("KNOWLEDGE_CONFLICT");
    expect((await alice.get("/api/records")).body.records.find((item) => item.id === record.id).visibility).toBe("public");

    const { body: refreshed } = await alice.get("/api/account/import-revision").expect(200);
    await restore(refreshed.revision).expect(200);
    expect((await alice.get("/api/records")).body.records.find((item) => item.id === record.id).visibility).toBe("private");
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  it("exports only the requesting account, then restores its state and versioned knowledge privately", async () => {
    await alice.put("/api/state").send({ version: 3, events: [{ id: "e1", title: "写作", createdAt: "2026-09-30T10:00:00Z" }] });
    await bob.put("/api/state").send({ version: 3, events: [{ id: "bob-e", title: "别人的记录", createdAt: "2026-09-30T10:00:00Z" }] });
    const method = await alice.post("/api/tutorials").send({ treeId: "k9-math", nodeId: "linear-equation", title: "版本方法", method: "先写出等式", visibility: "public" });
    await alice.post("/api/records").send({ treeId: "k9-math", nodeId: "linear-equation", text: "自己的练习", visibility: "public" });
    await bob.post("/api/records").send({ treeId: "k9-math", nodeId: "linear-equation", text: "别人的练习" });
    const backup = await alice.get("/api/account/export");
    expect(backup.status).toBe(200);
    expect(backup.body.records).toHaveLength(1);
    expect(backup.body.tutorials[0].versions[0].version).toBe(method.body.tutorial.version);
    expect(JSON.stringify(backup.body)).not.toContain("secret-123");
    await alice.put("/api/state").send({ version: 3, events: [] });
    const restored = await alice.post("/api/account/import").send(backup.body);
    expect(restored.status).toBe(200);
    expect((await alice.get("/api/state")).body.state.events[0].id).toBe("e1");
    expect((await bob.get("/api/state")).body.state.events[0].id).toBe("bob-e");
    expect((await bob.get("/api/tutorials")).body.tutorials).toHaveLength(0);
    expect((await bob.get("/api/records")).body.records).toHaveLength(1);
    expect((await alice.get("/api/records")).body.records).toHaveLength(2);
  });
  it("restores habit focus, timer provenance and a private image reference without exposing either account", async () => {
    const timestamp = "2026-09-30T10:00:00Z";
    const habit = { id: "reading", name: "阅读", active: true, startDate: timestamp };
    const paused = { id: "writing", name: "写作", active: false, paused: true, startDate: timestamp };
    const state = { version: 3, habit, habitHistory: [paused], events: [],
      timer: { sessionStartedAt: timestamp, elapsedMs: 1000, practiceContext: { habit: { id: paused.id, name: paused.name }, treeId: "k9-math", nodeId: "linear-equation" } } };
    expect((await alice.put("/api/state").send(state)).status).toBe(200);
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const saved = await alice.post("/api/records").send({ treeId: "k9-math", nodeId: "linear-equation", text: "自己的图片记录",
      visibility: "private", images: [{ mediaType: "image/png", dataUrl: image }] });
    expect(saved.status).toBe(201);
    const mediaUrl = "/api/media/" + saved.body.record.images[0].id;
    const backup = (await alice.get("/api/account/export")).body;
    expect((await alice.put("/api/state").send({ version: 3, events: [] })).status).toBe(200);
    expect((await alice.post("/api/account/import").send(backup)).status).toBe(200);
    expect((await alice.get("/api/state")).body.state).toEqual(state);
    expect((await bob.get(mediaUrl)).status).toBe(404);
    const { id, images } = backup.records[0];
    const bobArchive = (await bob.get("/api/account/export")).body;
    bobArchive.records.push({ id: id + "-copy", treeId: "k9-math", nodeId: "linear-equation", text: "从自己的备份恢复图片", createdAt: timestamp, images });
    expect((await bob.post("/api/account/import").send(bobArchive)).status).toBe(200);
    const restored = (await bob.get("/api/records")).body.records;
    expect(restored.map(record => record.id)).toEqual([id + "-copy"]);
    const restoredMedia = "/api/media/" + restored[0].images[0].id;
    expect(restoredMedia).not.toBe(mediaUrl);
    expect((await bob.get(restoredMedia)).status).toBe(200);
    expect((await bob.get(mediaUrl)).status).toBe(404);
    expect((await alice.get(mediaUrl)).status).toBe(200);
    images[0].id = images[0].id.toUpperCase();
    expect((await bob.post("/api/account/import").send(bobArchive)).status).toBe(200);
    expect((await bob.get("/api/records")).body.records[0].images[0].id).toBe(restored[0].images[0].id);
    const reader = request.agent(app);
    await reader.post("/api/register").send({ name: "image-reader", password: "secret-123" });
    expect((await bob.patch("/api/records/" + restored[0].id).send({ visibility: "public" })).status).toBe(200);
    expect((await reader.get(restoredMedia)).status).toBe(200);
    expect((await reader.get(mediaUrl)).status).toBe(404);
  });
  it("refuses an archive that collides with another owner's node without changing account state", async () => {
    const node = (await alice.post("/api/nodes").send({ title: "我的节点", goal: "完成目标", link: { type: "prereq", anchorId: "natural-numbers" } })).body.node;
    const backup = (await alice.get("/api/account/export")).body;
    const restored = await bob.post("/api/account/import").send(backup);
    expect(restored.status).toBe(409);
    expect((await alice.get("/api/nodes")).body.nodes[0].id).toBe(node.id);
    expect((await bob.get("/api/state")).body.state).toBeNull();
  });
  it("preserves someone else's later knowledge connections when restoring an older backup", async () => {
    const node = (await alice.post("/api/nodes").send({ title: "共同引用目标", goal: "试一次", visibility: "public", link: { type: "prereq", anchorId: "natural-numbers" } })).body.node;
    const backup = (await alice.get("/api/account/export")).body;
    const later = await bob.post("/api/nodes").send({ title: "后续目标", goal: "再试一次", visibility: "public", link: { type: "prereq", anchorId: node.id } });
    expect(later.status).toBe(201);
    expect((await alice.post("/api/account/import").send(backup)).status).toBe(200);
    const disk = JSON.parse(fs.readFileSync(path.join(directory, "custom-nodes.json"), "utf8"));
    expect(disk.edges).toContainEqual({ from: node.id, to: later.body.node.id, type: "prereq" });
  });

  it("keeps newer tutorial versions addressable when restoring an older backup", async () => {
    const { body: { tutorial: original } } = await alice.post("/api/tutorials")
      .send({ treeId: "k9-math", nodeId: "linear-equation", title: "解方程", method: "先写等式", visibility: "public",
        resources: [{ label: "方格本", url: "https://example.com/grid", affiliate: true }] }).expect(201);
    const url = "/api/tutorials/" + original.id;
    const { body: backup } = await alice.get("/api/account/export").expect(200);
    const { body: { tutorial: newer } } = await alice.patch(url).set("If-Match", original.version)
      .send({ method: "先写等式，再检验结果", resources: [{ label: "演算纸", url: "https://example.com/paper", affiliate: true }] }).expect(200);
    const { body: { record } } = await bob.post("/api/records").send({ treeId: original.treeId, nodeId: original.nodeId, text: "按修订版检验了结果",
      tutorialId: original.id, tutorialVersion: newer.version }).expect(201);
    const reader = request.agent(app);
    await reader.post("/api/register").send({ name: "reader", password: "secret-123" }).expect(201);
    const visibleRecord = async () => (await reader.get("/api/records").expect(200)).body.records.find((item) => item.id === record.id);
    expect(await visibleRecord()).toMatchObject({ tutorialId: original.id, tutorialVersion: newer.version });
    await alice.post("/api/account/import").send(backup).expect(200);

    const newerUrl = url + "/versions/" + newer.version;
    const { body: { tutorial: retained } } = await alice.get(newerUrl).expect(200);
    expect(retained.method).toBe(newer.method);
    expect(retained.resources[0].label).toBe("演算纸");
    await bob.get(newerUrl).expect(404);
    expect(await visibleRecord()).toMatchObject({ text: record.text, tutorialId: null, tutorialVersion: null, tutorialUnavailable: true });
    const profile = (await reader.get("/api/profiles/" + record.authorId).expect(200)).body;
    expect(profile.records.find((item) => item.id === record.id)).toMatchObject({ tutorialId: null, tutorialVersion: null, tutorialUnavailable: true });
    const restored = (await alice.get("/api/tutorials")).body.tutorials.find((item) => item.id === original.id);
    expect(restored.method).toBe(original.method);
    await alice.patch(url).set("If-Match", restored.version).send({ visibility: "public" }).expect(200);
    await bob.get(newerUrl).expect(200);
    expect(await visibleRecord()).toMatchObject({ tutorialId: original.id, tutorialVersion: newer.version });
    expect((await bob.get(url + "/versions/" + original.version).expect(200)).body.tutorial.resources[0].label).toBe("方格本");
    expect((await bob.get("/api/records")).body.records.some((item) => item.tutorialVersion === newer.version)).toBe(true);
  });

  it("only shares a reader's saved budget after explicit publication and lets them retract it", async () => {
    const { body: { node } } = await alice.post("/api/nodes").send({
      treeId: "k9-math", title: "方程练习", goal: "写出等式", visibility: "public",
      link: { type: "prereq", anchorId: "linear-equation" }
    }).expect(201);
    const { body: { tutorial } } = await alice.post("/api/tutorials").send({
      treeId: "k9-math", nodeId: node.id, title: "解方程", method: "写出等式", visibility: "public",
      resources: [{ label: "方格本", url: "https://example.com/grid", affiliate: true }]
    }).expect(201);
    const url = `/api/product-wants/${tutorial.id}/${tutorial.version}/0`;
    const { body: { ownerId } } = await bob.get(url).expect(200);
    const update = (action, budgetCents) => bob.put(url).set("X-Action-Account", ownerId).send({ action, budgetCents });
    await update("save", 2599).expect(200);
    expect((await bob.get("/api/product-wants")).body.items[0].visibility).toBe("private");
    expect((await alice.get(url)).body).toMatchObject({ own: null, shared: [] });
    await update("publish", 2500).expect(409);
    await alice.put(url).set("X-Action-Account", ownerId).send({ action: "publish", budgetCents: 2599 }).expect(409);
    await update("publish", 2599).expect(200);
    expect((await alice.get(url)).body.shared).toEqual([{ budgetCents: 2599 }]);
    const holders = `/api/holders?treeId=k9-math&nodeId=${node.id}`;
    await bob.get(holders).expect(200);
    await alice.patch("/api/nodes/" + node.id).send({ visibility: "private" }).expect(200);
    await bob.get(url).expect(404);
    await bob.get(holders).expect(404);
    expect((await alice.get(holders).expect(200)).body.holders.map((holder) => holder.name)).toEqual(["alice"]);
    expect((await alice.get(url).expect(200)).body).toMatchObject({ shared: [], canPublish: false });
    expect((await bob.get("/api/product-wants")).body.items[0]).toMatchObject({
      budgetCents: 2599, productAvailable: false
    });
    await update("retract").expect(200);
    await alice.patch("/api/nodes/" + node.id).send({ visibility: "public" }).expect(200);
    expect((await bob.get("/api/product-wants")).body.items[0]).toMatchObject({
      visibility: "private", productAvailable: true
    });
    expect((await alice.get(url)).body.shared).toEqual([]);
    await update("publish", 2599).expect(200);
    await alice.patch("/api/tutorials/" + tutorial.id).set("If-Match", tutorial.version).send({ visibility: "private" }).expect(200);
    await bob.get(url).expect(404);
    expect((await alice.get(url)).body.shared).toEqual([]);
    await update("retract").expect(200);
    expect((await bob.get("/api/product-wants")).body.items[0].visibility).toBe("private");
  });

  it("shares a product-linked demand at its original version and lets only its author withdraw it", async () => {
    const { body: { tutorial } } = await alice.post("/api/tutorials").send({
      treeId: "k9-math", nodeId: "linear-equation", title: "解方程", method: "写出等式", visibility: "public",
      resources: [{ label: "方格本", url: "https://example.com/grid", affiliate: true }]
    }).expect(201);
    const url = "/api/knowledge-demands/k9-math/linear-equation";
    const aliceOwner = (await alice.get(url)).body.ownerId;
    const bobOwner = (await bob.get(url)).body.ownerId;
    const product = { tutorial: tutorial.id, version: tutorial.version, material: "0" };
    const input = { title: "对齐手写等式", body: "需要每行都能对齐等号", product };
    await bob.post(url).set("X-Action-Account", bobOwner).send(input).expect(201);
    expect((await alice.get(url)).body.items).toEqual([]);
    const search = "/api/knowledge-demands";
    expect((await alice.get(search).query({ q: "等号" }).expect(200)).body.items).toEqual([]);
    expect((await bob.get(search).query({ q: "等号", scope: "mine" }).expect(200)).body.items).toHaveLength(1);
    const { body: { item } } = await bob.post(url).set("X-Action-Account", bobOwner)
      .send({ title: input.title, body: input.body, visibility: "public" }).expect(201);
    expect((await bob.get(url)).body.items.find((entry) => entry.id === item.id)).toMatchObject({ product: null, canLinkProduct: true });
    const link = url + "/" + item.id + "/product";
    const detail = url + "?demand=" + item.id;
    expect((await alice.get(search).query({ q: "手写 等号" }).expect(200)).body.items.map((entry) => entry.id)).toEqual([item.id]);
    expect((await alice.get(detail).expect(200)).body.items.map((entry) => entry.id)).toEqual([item.id]);
    await alice.put(link).set("X-Action-Account", aliceOwner).send(product).expect(404);
    await bob.put(link).set("X-Action-Account", bobOwner).send({ ...product, material: "1" }).expect(400);
    const { body: { item: linked } } = await bob.put(link).set("X-Action-Account", bobOwner).send(product).expect(200);
    expect(linked).toEqual({ ...item, product });
    await bob.put(link).set("X-Action-Account", bobOwner).send(product).expect(200);
    await bob.put(url + "/" + item.id + "/answering").set("X-Action-Account", bobOwner).send({ closed: true }).expect(200);
    const { body: backup } = await bob.get("/api/account/export").expect(200);
    const { body: before } = await bob.get("/api/account/import-revision").expect(200);
    expect(backup.knowledgeDemands.find((entry) => entry.id === item.id)).toMatchObject({ product, visibility: "public" });
    expect((await alice.get("/api/account/export")).body.knowledgeDemands).toEqual([]);
    await alice.post("/api/account/import").send(backup).expect(409);
    const tutorialUrl = "/api/tutorials/" + tutorial.id;
    const { body: { tutorial: newer } } = await alice.patch(tutorialUrl).set("If-Match", tutorial.version)
      .send({ resources: [{ label: "演算纸", url: "https://example.com/paper", affiliate: true }] }).expect(200);
    await bob.put(link).set("X-Action-Account", bobOwner).send({ ...product, version: newer.version }).expect(409);
    expect((await alice.get(url)).body.items[0].product).toEqual(product);
    await alice.patch(tutorialUrl).set("If-Match", newer.version).send({ visibility: "private" }).expect(200);
    expect((await bob.get(url)).body.items.find((entry) => entry.id === item.id).product).toBeNull();
    const withdraw = url + "/" + item.id + "/withdraw";
    await alice.post(withdraw).set("X-Action-Account", aliceOwner).expect(404);
    await bob.post(withdraw).set("X-Action-Account", bobOwner).expect(200);
    await alice.get(detail).expect(404);
    expect((await alice.get(search).query({ q: "等号" }).expect(200)).body.items).toEqual([]);
    expect((await bob.get(detail).expect(200)).body.items[0].visibility).toBe("private");
    expect((await alice.get(url)).body.items).toEqual([]);
    const restore = (revision) => bob.post("/api/account/import").set("X-Knowledge-Revision", revision).send(backup);
    expect((await restore(before.revision).expect(409)).body.code).toBe("KNOWLEDGE_CONFLICT");
    const { body: current } = await bob.get("/api/account/import-revision").expect(200);
    expect((await restore(current.revision).expect(200)).body.imported.knowledgeDemands).toBe(2);
    expect((await bob.get("/api/account/export")).body.knowledgeDemands.find((entry) => entry.id === item.id))
      .toMatchObject({ product, visibility: "private", answersClosed: true });
    expect((await alice.get(url)).body.items).toEqual([]);
    const publish = url + "/" + item.id + "/publish";
    await bob.post(publish).set("X-Action-Account", bobOwner).expect(409);
    await alice.get(detail).expect(404);
    const currentTutorial = (await alice.get("/api/tutorials")).body.tutorials.find((entry) => entry.id === tutorial.id);
    await alice.patch(tutorialUrl).set("If-Match", currentTutorial.version).send({ visibility: "public" }).expect(200);
    await alice.post(publish).set("X-Action-Account", aliceOwner).expect(404);
    const { revision: draftRevision } = (await bob.get(detail).expect(200)).body.items[0];
    await bob.patch(url + "/" + item.id).set("X-Action-Account", bobOwner).set("If-Match", draftRevision)
      .send({ title: input.title, body: "另一窗口修改的描述" }).expect(200);
    expect((await bob.post(publish).set("X-Action-Account", bobOwner).set("If-Match", draftRevision)
      .expect(409)).body.code).toBe("DEMAND_REVISION_CHANGED");
    await alice.get(detail).expect(404);
    const { revision: reviewedRevision } = (await bob.get(detail).expect(200)).body.items[0];
    await bob.post(publish).set("X-Action-Account", bobOwner).set("If-Match", reviewedRevision).expect(200);
    expect((await alice.get(detail).expect(200)).body.items[0]).toMatchObject({ id: item.id, product, visibility: "public" });
    const { revision } = (await bob.get(detail).expect(200)).body.items[0];
    const edit = (agent, owner, title) => agent.patch(url + "/" + item.id)
      .set("X-Action-Account", owner).set("If-Match", revision).send({ title, body: "补充对齐说明", visibility: "private", product: null });
    await edit(alice, aliceOwner, "他人改写").expect(404);
    await edit(bob, bobOwner, "改进手写对齐").expect(200);
    const editConflict = await edit(bob, bobOwner, "旧窗口草稿").expect(409);
    expect(editConflict.body).toMatchObject({ code: "DEMAND_EDIT_CONFLICT", current: {
      title: "改进手写对齐", body: "补充对齐说明", visibility: "public", revision: expect.any(String)
    } });
    const updated = (await alice.get(detail).expect(200)).body.items[0];
    expect(updated).toMatchObject({ title: "改进手写对齐", body: "补充对齐说明", product, visibility: "public" });
    expect(updated).not.toHaveProperty("revision");
  });

  it("lets the demand author manage their own text after losing access to the node", async () => {
    const { body: { node } } = await alice.post("/api/nodes").send({
      title: "只在节点里的标题", goal: "试一次", visibility: "public", link: { type: "prereq", anchorId: "natural-numbers" }
    }).expect(201);
    const url = `/api/knowledge-demands/${node.treeId}/${node.id}`;
    const { body: { ownerId } } = await bob.get(url).expect(200);
    const { body: { item } } = await bob.post(url).set("X-Action-Account", ownerId)
      .send({ title: "作者的需求", body: "节点之外仍属于作者的正文", visibility: "public" }).expect(201);
    const detail = url + "?demand=" + item.id;
    await alice.patch("/api/nodes/" + node.id).send({ visibility: "private" }).expect(200);
    const { body: ownerNode } = await alice.get(url).expect(200);
    expect(ownerNode).toMatchObject({ nodeAvailable: true, canPublishDemand: false });
    expect(ownerNode.items).toEqual([]);
    await alice.get(detail).expect(404);
    const privateNodeDemand = (visibility) => alice.post(url).set("X-Action-Account", ownerNode.ownerId)
      .send({ title: "私人节点里的问题", body: "需要自己整理", visibility });
    expect((await privateNodeDemand("public").expect(400)).body.code).toBe("DEMAND_PUBLIC_NODE_REQUIRED");
    expect((await privateNodeDemand("private").expect(201)).body.item.visibility).toBe("private");
    expect((await alice.get(url).expect(200)).body.items.map(({ title }) => title)).toEqual(["私人节点里的问题"]);
    await bob.get(url).expect(404);
    const { body: saved } = await bob.get(detail).expect(200);
    expect(saved.nodeAvailable).toBe(false);
    expect(saved.items[0]).toMatchObject({ id: item.id, body: item.body, product: null });
    const search = "/api/knowledge-demands";
    expect((await alice.get(search).expect(200)).body.items).toEqual([]);
    expect((await bob.get(search).query({ scope: "mine" }).expect(200)).body.items[0]).toMatchObject({ id: item.id, nodeTitle: null });
    await bob.patch(url + "/" + item.id).set("X-Action-Account", ownerId).set("If-Match", saved.items[0].revision)
      .send({ title: item.title, body: "更新后的原文" }).expect(200);
    await bob.post(url + "/" + item.id + "/withdraw").set("X-Action-Account", ownerId).expect(200);
    await bob.post(url + "/" + item.id + "/publish").set("X-Action-Account", ownerId).expect(409);
    await alice.delete("/api/nodes/" + node.id).expect(200);
    await alice.get(detail).expect(404);
    expect((await bob.get(detail).expect(200)).body.items[0]).toMatchObject({ body: "更新后的原文", visibility: "private" });
  });

  it("restores only the selected account's saved product budget and keeps it private", async () => {
    const { body: { tutorial } } = await alice.post("/api/tutorials").send({
      treeId: "k9-math", nodeId: "linear-equation", title: "解方程", method: "写出等式", visibility: "public",
      resources: [{ label: "方格本", url: "https://example.com/grid", affiliate: true }]
    }).expect(201);
    const url = `/api/product-wants/${tutorial.id}/${tutorial.version}/0`;
    const aliceOwner = (await alice.get(url)).body.ownerId;
    const bobOwner = (await bob.get(url)).body.ownerId;
    const write = (agent, owner, action, budgetCents) => agent.put(url)
      .set("X-Action-Account", owner).send({ action, budgetCents }).expect(200);
    await write(alice, aliceOwner, "save", 1200);
    await write(bob, bobOwner, "save", 2599);
    await write(bob, bobOwner, "publish", 2599);
    const { body: backup } = await bob.get("/api/account/export").expect(200);
    expect(backup.productWants).toEqual([expect.objectContaining({ ownerId: bobOwner, version: tutorial.version, budgetCents: 2599 })]);

    const { body: before } = await bob.get("/api/account/import-revision").expect(200);
    await write(bob, bobOwner, "save", 2800);
    const restore = (revision) => bob.post("/api/account/import").set("X-Knowledge-Revision", revision).send(backup);
    expect((await restore(before.revision).expect(409)).body.code).toBe("KNOWLEDGE_CONFLICT");
    const { body: current } = await bob.get("/api/account/import-revision").expect(200);
    expect((await restore(current.revision).expect(200)).body.imported.productWants).toBe(1);
    expect((await bob.get(url)).body.own).toMatchObject({ version: tutorial.version, budgetCents: 2599, visibility: "private" });
    expect((await alice.get(url)).body).toMatchObject({ own: { budgetCents: 1200 }, shared: [] });
  });
  it("exports and restores picture bytes while preserving media privacy", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await alice.post("/api/records").send({ treeId: "k9-math", nodeId: "linear-equation", text: "图片证据", visibility: "private", images: [{ mediaType: "image/png", dataUrl: `data:image/png;base64,${png}` }] });
    const archive = (await alice.get("/api/account/export")).body;
    const id = archive.records[0].images[0].id;
    expect(archive.records[0].images[0].dataUrl).toContain(png);
    expect((await bob.get(`/api/media/${id}`)).status).toBe(404);
    expect((await alice.post("/api/account/import").send(archive)).status).toBe(200);
    expect((await alice.get(`/api/media/${id}`)).status).toBe(200);
    expect((await request(app).get("/api/account/export")).status).toBe(401);
  });
  it("replays an interrupted multi-file restore before accepting later writes", () => {
    const entries = [{ filePath: path.join(directory, "a.json"), value: { a: 1 } }, { filePath: path.join(directory, "b.json"), value: { b: 2 } }];
    let writes = 0;
    expect(() => commitTransaction(directory, entries, (file, value) => { if (++writes === 2) throw new Error("disk interrupted"); atomicJson(file, value); })).toThrow("disk interrupted");
    expect(fs.existsSync(path.join(directory, "restore-journal.json"))).toBe(true);
    expect(recoverTransactions(directory)).toBe(true);
    expect(JSON.parse(fs.readFileSync(entries[1].filePath, "utf8"))).toEqual({ b: 2 });
    expect(fs.existsSync(path.join(directory, "restore-journal.json"))).toBe(false);
  });
  it("rejects restore paths outside the intended data directory before writing a journal", () => {
    expect(() => commitTransaction(directory, [{ filePath: path.join(directory, "..", "outside.json"), value: {} }])).toThrow("越出");
    expect(fs.existsSync(path.join(directory, "restore-journal.json"))).toBe(false);
  });
});
