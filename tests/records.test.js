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

  it("rejects publication from a stale light-up draft until the owner reviews the updated note", async () => {
    const owner = await register("draft-owner");
    const reader = await register("draft-reader");
    const draft = { id: "draft-1", eventId: "event-1", treeId: TREE_ID, nodeId: NODE_ID, status: "draft", evidence: { detail: "只公开更新后的笔记" } };
    await owner.put("/api/state").send({ version: 3, forest: { lightups: [draft] } }).expect(200);
    const publish = (text) => owner.post("/api/records").set("X-Practice-Draft", draft.id)
      .set("Idempotency-Key", "confirm-lightup-draft-1")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, eventId: draft.eventId, text, visibility: "public", lightUp: true });
    expect((await publish("已经删掉的旧笔记").expect(409)).body.code).toBe("PRACTICE_DRAFT_CHANGED");
    expect((await reader.get("/api/records").query({ scope: "public" }).expect(200)).body.records).toEqual([]);
    const created = await publish(draft.evidence.detail).expect(201);
    expect((await publish(draft.evidence.detail).expect(200)).body.record.id).toBe(created.body.record.id);
    expect((await reader.get("/api/records").query({ scope: "public" }).expect(200)).body.records.map(record => record.text))
      .toEqual([draft.evidence.detail]);
  });

  it("removes newly uploaded images when the record write fails and permits an identical retry", async () => {
    const alice = await register("practice-rollback");
    const key = "practice-rollback-123456";
    const data = { treeId: TREE_ID, nodeId: NODE_ID, text: "带图实践",
      images: [{ mediaType: "image/png", dataUrl: "data:image/png;base64," + PNG_1X1 }] };
    const send = () => alice.post("/api/records").set("Idempotency-Key", key).send(data);
    const rename = fs.renameSync;
    const failWrite = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (destination === path.join(tempDir, "records.json")) throw new Error("Simulated record write failure");
      return rename(source, destination);
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await send()).status).toBe(500);
      expect(fs.readdirSync(path.join(tempDir, "media"))).toEqual([]);
      expect((await alice.get("/api/records").query({ treeId: TREE_ID })).body.records).toEqual([]);
    } finally {
      failWrite.mockRestore();
      errorLog.mockRestore();
    }
    const retried = await send();
    expect(retried.status).toBe(201);
    expect(fs.readdirSync(path.join(tempDir, "media"))).toEqual([retried.body.record.images[0].id]);
  });
  it("replays an acknowledged practice once per account without duplicating its images", async () => {
    const alice = await register("practice-alice");
    const bob = await register("practice-bob");
    const aliceId = (await alice.get("/api/me")).body.user.id;
    const key = "practice-request-123456";
    const data = { treeId: TREE_ID, nodeId: NODE_ID, text: "完成代回检验", visibility: "private",
      images: [{ mediaType: "image/png", dataUrl: "data:image/png;base64," + PNG_1X1 }] };
    const send = (agent) => agent.post("/api/records").set("Idempotency-Key", key).send(data);
    const first = await send(alice);
    expect(first.status).toBe(201);
    const retry = await send(alice);
    expect(retry.status).toBe(200);
    expect(retry.body.record).toEqual(first.body.record);
    expect((await alice.get("/api/records").query({ treeId: TREE_ID })).body.records).toHaveLength(1);
    expect((await bob.post("/api/records").set("Idempotency-Key", key).set("X-Action-Account", aliceId).send(data)).status).toBe(409);
    const other = await send(bob);
    expect(other.status).toBe(201);
    expect(other.body.record.id).not.toBe(first.body.record.id);
  });

  it("requires a session for records and media", async () => {
    expect((await request(app).get("/api/records")).status).toBe(401);
    expect((await request(app).post("/api/records").send({})).status).toBe(401);
    expect((await request(app).get("/api/media/deadbeef")).status).toBe(401);
  });

  it("distinguishes withdrawn sharing from deletion in the comment author's history", async () => {
    const author = await register("removed-author");
    const reader = await register("removed-commenter");
    const nodeOwner = await register("removed-node-owner");
    const { body: { node } } = await nodeOwner.post("/api/nodes").send({
      treeId: TREE_ID, title: "讨论挂靠节点", goal: "核对实践", visibility: "public",
      link: { type: "prereq", anchorId: NODE_ID }
    }).expect(201);
    const { body: { record } } = await author.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: node.id, text: "会删除的实践", visibility: "public" }).expect(201);
    const detail = "/api/records/" + record.id;
    const thread = detail + "/discussion";
    const { body: { ownerId } } = await reader.get(thread).expect(200);
    await reader.post(thread).set("X-Action-Account", ownerId)
      .send({ text: "我的留言", requestId: "deleted-practice-comment" }).expect(201);
    const mine = () => reader.get("/api/practice-comments/mine").expect(200);
    const [comment] = (await mine()).body.comments;
    const { body: { ownerId: authorId } } = await author.get(thread).expect(200);
    const { body: { ownerId: nodeOwnerId } } = await nodeOwner.get(thread).expect(200);
    const commentRead = thread + "/" + comment.id + "/read";
    expect((await author.get("/api/practice-replies").expect(200)).body.replies).toEqual([
      expect.objectContaining({ id: comment.id, kind: "comment", unread: true })
    ]);
    expect((await author.get(thread).expect(200)).body.comments[0].received).toBe(true);
    await nodeOwner.post(commentRead).set("X-Action-Account", nodeOwnerId).expect(404);
    await reader.post(commentRead).set("X-Action-Account", ownerId).expect(404);
    await author.post(commentRead).set("X-Action-Account", authorId).expect(200);
    expect((await author.get("/api/practice-replies").query({ scope: "unread" }).expect(200)).body.replies).toEqual([]);
    await author.post(thread).set("X-Action-Account", authorId)
      .send({ text: "作者回复", requestId: "deleted-practice-reply", parentId: comment.id }).expect(201);
    const inbox = () => reader.get("/api/practice-replies").expect(200);
    const unreadCount = async (agent) => (await agent.get("/api/practice-replies?summary=1").expect(200)).body.unreadCount;
    const [reply] = (await inbox()).body.replies;
    expect(reply).toMatchObject({ text: "作者回复", unread: true });
    expect(await unreadCount(reader)).toBe(1);
    expect(await unreadCount(nodeOwner)).toBe(0);
    const setNodeVisibility = (visibility) => nodeOwner.patch("/api/nodes/" + node.id).send({ visibility }).expect(200);
    await setNodeVisibility("private");
    await nodeOwner.get(thread).expect(404);
    await author.get(thread).expect(404);
    await reader.get(thread).expect(404);
    expect((await inbox()).body.replies).toEqual([]);
    expect(await unreadCount(reader)).toBe(0);
    await reader.post(thread + "/" + reply.id + "/read").set("X-Action-Account", ownerId).expect(404);
    await reader.post("/api/practice-replies/read-page").set("X-Action-Account", ownerId).send({ ids: [reply.id] }).expect(200);
    expect((await mine()).body.comments).toEqual([{ ...comment, available: false, deleted: false }]);
    await setNodeVisibility("public");
    expect((await inbox()).body.replies).toEqual([reply]);
    expect(await unreadCount(reader)).toBe(1);
    await reader.post(thread + "/" + reply.id + "/read").set("X-Action-Account", ownerId).expect(200);
    expect(await unreadCount(reader)).toBe(0);
    await author.patch(detail).send({ visibility: "private" }).expect(200);
    expect((await mine()).body.comments).toEqual([{ ...comment, available: false, deleted: false }]);
    await author.delete(detail).expect(200);
    expect((await mine()).body.comments).toEqual([{ ...comment, available: false, deleted: true }]);
    expect((await reader.get("/api/practice-replies").expect(200)).body.replies).toEqual([]);
    await reader.get(thread).expect(404);
    await reader.post(thread + "/" + comment.id + "/withdraw").set("X-Action-Account", ownerId).expect(200);
    expect((await mine()).body.comments).toEqual([]);
  });

  it("keeps discussion reachable when withdrawals empty a page behind a saved cursor", async () => {
    const author = await register("pagination-author");
    const reader = await register("pagination-reader");
    const { body: { record } } = await author.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "分页实践", visibility: "public" }).expect(201);
    const url = "/api/records/" + record.id + "/discussion";
    const { body: { ownerId } } = await author.get(url).expect(200);
    for (let index = 0; index < 22; index += 1) {
      await author.post(url).set("X-Action-Account", ownerId)
        .send({ text: "留言 " + index, requestId: "pagination-comment-" + index }).expect(201);
    }
    const { body: latest } = await reader.get(url).expect(200);
    const mine = (page) => author.get("/api/practice-comments/mine").query({ page }).expect(200);
    expect((await mine(1)).body).toMatchObject({ page: 1, hasNext: true, comments: expect.any(Array) });
    expect((await mine(2)).body.comments.map((item) => item.text)).toEqual(["留言 1", "留言 0"]);
    expect((await reader.get("/api/practice-comments/mine").query({ page: 2 }).expect(200)).body.comments).toEqual([]);
    const { body: oldest } = await reader.get(url).query({ before: latest.older }).expect(200);
    expect(oldest.comments.map(({ text }) => text)).toEqual(["留言 0", "留言 1"]);
    const withdraw = (id) => author.post(url + "/" + id + "/withdraw").set("X-Action-Account", ownerId).expect(200);
    for (const comment of latest.comments) await withdraw(comment.id);
    const { body: recoveredOldest } = await reader.get(url).query({ after: oldest.newer }).expect(200);
    expect(recoveredOldest).toMatchObject({ comments: oldest.comments, older: null, newer: null });

    await author.post(url).set("X-Action-Account", ownerId)
      .send({ text: "新留言", requestId: "pagination-comment-new" }).expect(201);
    for (const comment of oldest.comments) await withdraw(comment.id);
    expect((await mine(2)).body).toMatchObject({ page: 1, hasNext: false, comments: [expect.objectContaining({ text: "新留言" })] });
    const { body: recoveredLatest } = await reader.get(url).query({ before: latest.older }).expect(200);
    expect(recoveredLatest).toMatchObject({
      comments: [expect.objectContaining({ text: "新留言" })], older: null, newer: null
    });
  });

  it("filters received replies before paging and clamps an unread page that disappeared", async () => {
    const author = await register("reply-page-author");
    const reader = await register("reply-page-reader");
    const { body: { record } } = await author.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "回复分页实践", visibility: "public" }).expect(201);
    const thread = "/api/records/" + record.id + "/discussion";
    const account = async (agent) => (await agent.get(thread).expect(200)).body.ownerId;
    const readerId = await account(reader);
    const authorId = await account(author);
    await reader.post(thread).set("X-Action-Account", readerId)
      .send({ text: "请问怎么验证？", requestId: "inbox-pagination-question" }).expect(201);
    const [{ id: parentId }] = (await author.get(thread).expect(200)).body.comments;
    for (let index = 0; index < 21; index += 1) {
      await author.post(thread).set("X-Action-Account", authorId)
        .send({ text: "回复 " + index, requestId: "inbox-pagination-reply-" + index, parentId }).expect(201);
    }
    const inbox = async (scope, page) => (await reader.get("/api/practice-replies").query({ scope, page }).expect(200)).body;
    const first = await inbox("unread", 1);
    expect(first).toMatchObject({ page: 1, hasNext: true });
    expect(first.replies).toHaveLength(20);
    expect((await inbox("unread", 2)).replies.map((item) => item.text)).toEqual(["回复 0"]);
    await reader.post(thread + "/" + first.replies[0].id + "/read").set("X-Action-Account", readerId).expect(200);
    const clamped = await inbox("unread", 2);
    expect(clamped).toMatchObject({ page: 1, hasNext: false });
    expect(clamped.replies).toHaveLength(20);
    expect(clamped.replies.at(-1).text).toBe("回复 0");
    expect((await inbox("all", 1)).replies[0].unread).toBe(false);
    const batch = "/api/practice-replies/read-page";
    const ids = clamped.replies.slice(0, 2).map((item) => item.id);
    await author.post(batch).set("X-Action-Account", authorId).send({ ids }).expect(200);
    expect((await inbox("unread", 1)).replies).toHaveLength(20);
    await reader.post(batch).set("X-Action-Account", authorId).send({ ids }).expect(409);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await reader.post(batch).set("X-Action-Account", readerId).send({ ids }).expect(200);
    }
    expect((await inbox("unread", 1)).replies).toEqual(clamped.replies.slice(2));
  });

  it("isolates practice discussion by record visibility and lets only the commenter withdraw a message", async () => {
    const author = await register("discussion-author");
    const commenter = await register("discussion-commenter");
    const reader = await register("discussion-reader");
    const { body: { record } } = await author.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "完成等式检验", visibility: "public" }).expect(201);
    const url = "/api/records/" + record.id + "/discussion";
    const { body: { ownerId } } = await commenter.get(url).expect(200);
    const message = { text: "你是怎么检查符号的？", requestId: "practice-comment-1234" };
    const post = () => commenter.post(url).set("X-Action-Account", ownerId).send(message);
    await post().expect(201);
    await post().expect(200);
    const { body: { comments } } = await reader.get(url).expect(200);
    expect(comments).toEqual([expect.objectContaining({ text: message.text, own: false })]);
    const withdraw = url + "/" + comments[0].id + "/withdraw";
    const authorId = (await author.get(url)).body.ownerId;
    const reply = { text: "我把结果代回了等式。", requestId: "practice-reply-1234", parentId: comments[0].id };
    const respond = (data) => author.post(url).set("X-Action-Account", authorId).send(data);
    await respond({ ...reply, parentId: "unknown-parent" }).expect(409);
    await respond(reply).expect(201);
    expect((await reader.get(url).expect(200)).body.comments[1].replyTo)
      .toEqual({ id: comments[0].id, authorName: "discussion-commenter" });
    const inbox = "/api/practice-replies";
    const incoming = (await commenter.get(inbox).expect(200)).body.replies;
    expect(incoming).toEqual([expect.objectContaining({ recordId: record.id, text: reply.text, unread: true })]);
    expect((await reader.get(inbox).expect(200)).body.replies).toEqual([]);
    const detail = "/api/records/" + record.id;
    const { body: { revision } } = await author.get(detail).expect(200);
    const edit = (agent, account, text) => agent.patch(detail + "/text").set("X-Action-Account", account).set("If-Match", revision).send({ text });
    await edit(commenter, ownerId, "他人修改").expect(404);
    await edit(author, authorId, "补充了检验细节").expect(200);
    await edit(author, authorId, "旧窗口覆盖").expect(409);
    expect((await reader.get(detail).expect(200)).body.record).toMatchObject({ id: record.id, text: "补充了检验细节", visibility: "public" });
    await author.patch(detail).set("If-Match", revision).send({ visibility: "private" }).expect(200);
    await reader.get(detail).expect(404);
    await author.patch(detail).set("If-Match", revision).send({ visibility: "public" }).expect(409);
    const current = await author.get(detail).expect(200);
    expect(current.body.record.text).toBe("补充了检验细节");
    await author.patch(detail).set("If-Match", current.body.revision).send({ visibility: "public" }).expect(200);
    expect((await reader.get(detail).expect(200)).body.record).not.toHaveProperty("visibilityRevision");
    await author.patch(detail).send({ visibility: "private" }).expect(200);
    await author.patch(detail).set("If-Match", current.body.revision).send({ visibility: "public" }).expect(409);
    await reader.get(detail).expect(404);
    const latest = await author.get(detail).expect(200);
    await author.patch(detail).set("If-Match", latest.body.revision).send({ visibility: "public" }).expect(200);
    expect((await reader.get(url).expect(200)).body.comments).toHaveLength(2);
    const readUrl = url + "/" + incoming[0].id + "/read";
    await author.post(readUrl).set("X-Action-Account", authorId).expect(404);
    await commenter.post(readUrl).set("X-Action-Account", ownerId).expect(200);
    expect((await commenter.get(inbox).expect(200)).body.replies[0].unread).toBe(false);
    await author.patch(detail).send({ visibility: "private" }).expect(200);
    expect((await commenter.get(inbox).expect(200)).body.replies).toEqual([]);
    await commenter.get(url).expect(404);
    await commenter.post(readUrl).set("X-Action-Account", ownerId).expect(404);
    await author.patch(detail).send({ visibility: "public" }).expect(200);
    expect((await commenter.get(inbox).expect(200)).body.replies).toEqual([
      expect.objectContaining({ id: incoming[0].id, unread: false })
    ]);
    await author.post(withdraw).set("X-Action-Account", authorId).expect(404);
    await commenter.post(withdraw).set("X-Action-Account", ownerId).expect(200);
    const remaining = (await reader.get(url).expect(200)).body.comments;
    expect((await commenter.get(inbox).expect(200)).body.replies).toEqual([]);
    expect(remaining).toEqual([expect.objectContaining({ text: reply.text, replyTo: { id: comments[0].id, authorName: null } })]);
    await respond(reply).expect(200);
    await respond({ ...reply, requestId: "practice-reply-5678" }).expect(409);
    await post().expect(409);
    await author.patch("/api/records/" + record.id).send({ visibility: "private" }).expect(200);
    await reader.get(url).expect(404);
    await post().expect(404);
    const mine = "/api/practice-comments/mine";
    expect((await reader.get(mine).expect(200)).body.comments).toEqual([]);
    const saved = (await author.get(mine).expect(200)).body.comments;
    expect(saved).toEqual([expect.objectContaining({ id: incoming[0].id, text: reply.text, available: false })]);
    const withdrawReply = url + "/" + incoming[0].id + "/withdraw";
    await commenter.post(withdrawReply).set("X-Action-Account", ownerId).expect(404);
    await author.post(withdrawReply).set("X-Action-Account", authorId).expect(200);
    await author.patch("/api/records/" + record.id).send({ visibility: "public" }).expect(200);
    expect((await reader.get(url).expect(200)).body.comments).toEqual([]);
  });

  it("paginates discussion without losing an old reply target or skipping a withdrawn cursor", async () => {
    const author = await register("long-discussion");
    const { body: { record } } = await author.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "长讨论", visibility: "public" }).expect(201);
    const url = "/api/records/" + record.id + "/discussion";
    const { body: { ownerId } } = await author.get(url).expect(200);
    for (let index = 1; index <= 22; index++) {
      await author.post(url).set("X-Action-Account", ownerId)
        .send({ text: "留言 " + index, requestId: "long-discussion-" + index }).expect(201);
    }
    const { body: latest } = await author.get(url).expect(200);
    expect(latest.comments).toHaveLength(20);
    expect(latest.comments[0].text).toBe("留言 3");
    expect(latest.newer).toBeNull();
    await author.post(url + "/" + latest.older + "/withdraw").set("X-Action-Account", ownerId).expect(200);
    const { body: older } = await author.get(url).query({ before: latest.older }).expect(200);
    expect(older.comments.map((item) => item.text)).toEqual(["留言 1", "留言 2"]);
    const oldest = older.comments[0].id;
    const { body: anchored } = await author.get(url).query({ around: oldest }).expect(200);
    expect(anchored.comments[0].id).toBe(oldest);
    expect((await author.get(url).query({ replyTarget: oldest }).expect(200)).body.replyTargetAvailable).toBe(true);
  });

  it("acknowledges a saved practice after the source tutorial becomes private", async () => {
    const author = await register("practice-source-author");
    const reader = await register("practice-source-reader");
    const observer = await register("practice-source-observer");
    const readerId = (await reader.get("/api/me").expect(200)).body.user.id;
    const { body: { tutorial } } = await author.post("/api/tutorials")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, title: "原教程", method: "检查结果", visibility: "public" }).expect(201);
    const data = { treeId: TREE_ID, nodeId: NODE_ID, text: "已检查结果", tutorialId: tutorial.id,
      tutorialVersion: tutorial.version, eventId: "original-event", visibility: "public" };
    const key = "practice-source-retry-1234";
    const save = () => reader.post("/api/records").set("Idempotency-Key", key).send(data);
    const { body: { record } } = await save().expect(201);
    const detail = "/api/records/" + record.id;
    const before = await observer.get(detail).expect(200);
    expect(before.body.record.tutorialVersion).toBe(tutorial.version);
    const versionSearch = (version) => observer.get("/api/records")
      .query({ scope: "public", treeId: TREE_ID, nodeId: NODE_ID, tutorialId: tutorial.id, tutorialVersion: version }).expect(200);
    expect((await versionSearch(tutorial.version)).body.records.map((item) => item.id)).toEqual([record.id]);
    expect((await versionSearch("another-version")).body.records).toEqual([]);
    await author.patch("/api/tutorials/" + tutorial.id).set("If-Match", tutorial.version).send({ visibility: "private" }).expect(200);
    expect((await save().expect(200)).body.record.id).toBe(record.id);
    expect((await reader.post("/api/records").send(data).expect(200)).body.record.id).toBe(record.id);
    await reader.post("/api/records").set("Idempotency-Key", key).send({ ...data, nodeId: "like-terms" }).expect(409);
    await reader.post("/api/records").send({ ...data, eventId: "another-event" }).expect(400);
    const expected = { id: record.id, text: data.text, tutorialId: null, tutorialVersion: null, tutorialUnavailable: true };
    const list = await reader.get("/api/records").expect(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.body.records).toEqual([expect.objectContaining(expected)]);
    expect((await reader.get(detail).expect(200)).body.record).toMatchObject(expected);
    expect((await observer.get(detail).set("If-None-Match", before.headers.etag).expect(200)).body.record).toMatchObject(expected);
    expect((await versionSearch(tutorial.version)).body).toMatchObject({ records: [], hasNext: false });
    expect((await observer.get("/api/profiles/" + readerId).expect(200)).body.records).toEqual([expect.objectContaining(expected)]);
    expect((await author.get(detail).expect(200)).body.record.tutorialVersion).toBe(tutorial.version);
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

  it("ranks exact practice text above newer mentions while keeping private matches out", async () => {
    const author = await register("rank-author");
    const reader = await register("rank-reader");
    const add = async (text, visibility) => (await author.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text, visibility }).expect(201)).body.record.id;
    const exact = await add("核对 ＡＢ", "public");
    const phrase = await add("之后继续核对 AB 的结果", "public");
    const scattered = await add("先核对符号，再写 AB", "public");
    await add("核对 AB", "private");
    const filename = path.join(tempDir, "records.json");
    const records = JSON.parse(fs.readFileSync(filename, "utf8"));
    const chronological = [exact, phrase, scattered];
    records.forEach((record) => { record.createdAt = new Date(Date.UTC(2026, 0, chronological.indexOf(record.id) + 2)).toISOString(); });
    fs.writeFileSync(filename, JSON.stringify(records));
    for (const viewer of [author, reader]) {
      const { body } = await viewer.get("/api/records").query({ scope: "public", q: "核对   ab" }).expect(200);
      expect(body.records.map((record) => record.id)).toEqual([exact, phrase, scattered]);
      const latest = await viewer.get("/api/records").query({ scope: "public", q: "核对   ab", order: "latest" }).expect(200);
      expect(latest.body.records.map((record) => record.id)).toEqual([scattered, phrase, exact]);
    }
    await reader.get("/api/records").query({ scope: "public", order: "unknown" }).expect(400);
  });

  it("finds only publicly discoverable practices and removes them from search on withdrawal", async () => {
    const author = await register("search-author");
    const reader = await register("search-reader");
    const { body: { record } } = await author.post("/api/records").send({
      treeId: TREE_ID, nodeId: NODE_ID, text: "代回检验结果", visibility: "public", eventId: "private-event-reference"
    }).expect(201);
    await author.post("/api/records").send({ treeId: TREE_ID, nodeId: NODE_ID, text: "代回的私人笔记", visibility: "private" }).expect(201);
    const ownSearch = (agent, visibility = "all") => agent.get("/api/records").query({ scope: "mine", q: "代回", visibility }).expect(200);
    expect((await ownSearch(author)).body.records.map((item) => item.visibility).sort()).toEqual(["private", "public"]);
    expect((await ownSearch(reader)).body.records).toEqual([]);
    expect((await ownSearch(author, "private")).body.records.map((item) => item.text)).toEqual(["代回的私人笔记"]);
    expect((await ownSearch(author, "public")).body.records.map((item) => item.id)).toEqual([record.id]);
    expect((await ownSearch(reader, "private")).body.records).toEqual([]);
    const outside = await author.get("/api/records").query({ scope: "mine", q: "代回", visibility: "private", page: 2 }).expect(200);
    expect(outside.body).toMatchObject({ records: [], lastPage: 1, hasNext: false });
    const search = (agent, q) => agent.get("/api/records").query({ scope: "public", q }).expect(200);
    for (const agent of [author, reader]) {
      const { body } = await search(agent, "代回 search-author");
      expect(body.records.map((item) => item.id)).toEqual([record.id]);
      expect(body.records[0]).not.toHaveProperty("eventId");
    }
    const detail = "/api/records/" + record.id;
    const { body } = await reader.get(detail).expect(200);
    expect(body.record).toMatchObject({ id: record.id, text: "代回检验结果" });
    expect(body.record).not.toHaveProperty("eventId");
    const bookmark = "/api/practice-bookmarks/" + record.id;
    const save = (saved) => reader.put(bookmark).set("X-Action-Account", body.ownerId).send({ saved });
    await save(true).expect(200);
    await save(true).expect(200);
    expect((await reader.get(detail).expect(200)).body.bookmarked).toBe(true);
    expect((await author.get("/api/practice-bookmarks").expect(200)).body.items).toEqual([]);
    expect((await reader.get("/api/practice-bookmarks").expect(200)).body.items).toHaveLength(1);
    const { body: backup } = await reader.get("/api/account/export").expect(200);
    const { body: before } = await reader.get("/api/account/import-revision").expect(200);
    expect(backup.practiceBookmarks).toEqual([record.id]);
    expect(backup.records).toEqual([]);
    expect((await author.get("/api/account/export").expect(200)).body.practiceBookmarks).toEqual([]);
    await author.patch("/api/records/" + record.id).send({ visibility: "private" }).expect(200);
    await reader.get(detail).expect(404);
    expect((await author.get(detail).expect(200)).body.record.visibility).toBe("private");
    await request(app).get(detail).expect(401);
    expect((await reader.get("/api/practice-bookmarks").expect(200)).body.items).toEqual([{ recordId: record.id, record: null, missing: false }]);
    await save(true).expect(404);
    await save(false).expect(200);
    expect((await reader.get("/api/practice-bookmarks").expect(200)).body.items).toEqual([]);
    const restore = (revision) => reader.post("/api/account/import").set("X-Knowledge-Revision", revision).send(backup);
    expect((await restore(before.revision).expect(409)).body.code).toBe("KNOWLEDGE_CONFLICT");
    const { body: current } = await reader.get("/api/account/import-revision").expect(200);
    expect((await restore(current.revision).expect(200)).body.imported.practiceBookmarks).toBe(1);
    expect((await reader.get("/api/practice-bookmarks").expect(200)).body.items).toEqual([{ recordId: record.id, record: null, missing: false }]);
    await reader.get(detail).expect(404);
    expect((await search(reader, "代回")).body.records).toEqual([]);
    expect((await author.get("/api/records").expect(200)).body.records).toHaveLength(2);
    await author.delete(detail).expect(200);
    expect((await reader.get("/api/practice-bookmarks").expect(200)).body.items)
      .toEqual([{ recordId: record.id, record: null, missing: true }]);
    await save(false).expect(200);
    expect((await reader.get("/api/practice-bookmarks").expect(200)).body.items).toEqual([]);
  });

  it("uses the same account follow list for public practices and tutorials", async () => {
    app = createApp({ dataDir: tempDir, rateLimitEnabled: false, communityEnabled: true }).app;
    const writer = await register("follow-writer");
    const reader = await register("follow-reader");
    const peer = await register("follow-peer");
    const { body: { user: author } } = await writer.get("/api/me").expect(200);
    const { body: { user: viewer } } = await reader.get("/api/me").expect(200);
    const directory = path.join(tempDir, "action-states");
    fs.mkdirSync(directory);
    const { FORMAT, validateActionState } = require("../prototypes/open-design-trial/integration/action-state.cjs");
    const data = validateActionState({
      schema: 1, mode: "local-simulation", activeId: null, events: [], habitId: "habit", habits: [{ id: "habit", name: "阅读", formedAt: null }],
      templates: {}, settings: { followedAuthors: [{ ...author, followedAt: 1 }] }
    });
    fs.writeFileSync(path.join(directory, viewer.id + ".json"), JSON.stringify({ format: FORMAT, data }));
    for (const [agent, text, visibility] of [[writer, "关注作者的公开实践", "public"], [writer, "关注作者的私人实践", "private"], [peer, "其他作者的公开实践", "public"]]) {
      await agent.post("/api/records").send({ treeId: TREE_ID, nodeId: NODE_ID, text, visibility }).expect(201);
    }
    const search = (agent) => agent.get("/api/records").query({ scope: "following" }).expect(200);
    expect((await search(reader)).body.records.map((item) => item.text)).toEqual(["关注作者的公开实践"]);
    const byAuthor = await reader.get("/api/records").query({ scope: "public", authorId: author.id, q: "实践" }).expect(200);
    expect(byAuthor.body.records.map((item) => item.text)).toEqual(["关注作者的公开实践"]);
    const otherAuthor = (await peer.get("/api/me").expect(200)).body.user;
    expect((await reader.get("/api/records").query({ scope: "following", authorId: otherAuthor.id }).expect(200)).body.records).toEqual([]);
    await reader.get("/api/records").query({ scope: "public", authorId: [author.id, otherAuthor.id] }).expect(400);
    expect((await search(peer)).body.records).toEqual([]);
    for (const [agent, title, visibility] of [[writer, "关注作者的公开教程", "public"], [writer, "关注作者的私人教程", "private"], [peer, "其他作者的公开教程", "public"]]) {
      await agent.post("/api/tutorials").send({
        treeId: TREE_ID, nodeId: NODE_ID, title, visibility,
        method: "写出等式，分别对两侧做同一运算。", startAction: "先写下一道等式并标出未知数。"
      }).expect(201);
    }
    const tutorialSearch = (agent, filters) => agent.get("/api/tutorial-search").query({ q: "教程", ...filters }).expect(200);
    expect((await tutorialSearch(reader, { scope: "following" })).body.items.map((item) => item.title)).toEqual(["关注作者的公开教程"]);
    expect((await tutorialSearch(reader, { authorId: author.id })).body.items.map((item) => item.title)).toEqual(["关注作者的公开教程"]);
    expect((await tutorialSearch(reader, { scope: "following", authorId: otherAuthor.id })).body.items).toEqual([]);
    expect((await tutorialSearch(peer, { scope: "following" })).body.items).toEqual([]);
    await reader.get("/api/tutorial-search").query({ authorId: [author.id, otherAuthor.id] }).expect(400);
    const demands = "/api/knowledge-demands";
    for (const [agent, account, title, visibility] of [
      [writer, author.id, "关注作者的公开需求", "public"],
      [writer, author.id, "关注作者的私人需求", "private"],
      [peer, otherAuthor.id, "其他作者的公开需求", "public"]
    ]) {
      await agent.post(demands + "/" + TREE_ID + "/" + NODE_ID).set("X-Action-Account", account)
        .send({ title, body: "请分享一种做法", visibility }).expect(201);
    }
    const demandSearch = (agent, filters = {}) => agent.get(demands).query({ scope: "following", ...filters }).expect(200);
    expect((await demandSearch(reader, { q: "需求", responseState: "unanswered" })).body.items.map((item) => item.title))
      .toEqual(["关注作者的公开需求"]);
    expect((await demandSearch(peer)).body.items).toEqual([]);
    data.settings.followedAuthors = [];
    fs.writeFileSync(path.join(directory, viewer.id + ".json"), JSON.stringify({ format: FORMAT, data }));
    expect((await search(reader)).body.records).toEqual([]);
    expect((await tutorialSearch(reader, { scope: "following" })).body.items).toEqual([]);
    expect((await demandSearch(reader)).body.items).toEqual([]);
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
    expect(media.headers["cache-control"]).toBe("private, no-store");
    expect(media.body.length).toBeGreaterThan(0);
  });

  it("rechecks protected media after withdrawal and never caches an authorized or denied response", async () => {
    const alice = await register("media-author");
    const bob = await register("media-reader");
    const created = await alice.post("/api/records").send({ treeId: TREE_ID, nodeId: NODE_ID, text: "可撤回图片", visibility: "public", images: [{ mediaType: "image/png", dataUrl: `data:image/png;base64,${PNG_1X1}` }] });
    expect(created.status).toBe(201);
    const url = `/api/media/${created.body.record.images[0].id}`;
    const publicRead = await bob.get(url);
    expect(publicRead.status).toBe(200);
    expect(publicRead.headers["cache-control"]).toBe("private, no-store");
    expect((await alice.patch(`/api/records/${created.body.record.id}`).send({ visibility: "private" })).status).toBe(200);
    const denied = await bob.get(url).set("If-None-Match", publicRead.headers.etag);
    expect(denied.status).toBe(404);
    expect(denied.headers["cache-control"]).toBe("private, no-store");
    expect((await alice.get(url)).status).toBe(200);
    const anonymous = await request(app).get(url);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["cache-control"]).toBe("private, no-store");
    const filename = path.join(tempDir, "media", created.body.record.images[0].id);
    expect(fs.existsSync(filename)).toBe(true);
    await bob.delete(`/api/records/${created.body.record.id}`).expect(404);
    expect(fs.existsSync(filename)).toBe(true);
    await alice.delete(`/api/records/${created.body.record.id}`).expect(200);
    expect(fs.existsSync(filename)).toBe(false);
    await alice.get(url).expect(404);
  });

  it("removes a private target's public practice and media from a reader's existing links", async () => {
    const alice = await register("target-owner");
    const bob = await register("target-reader");
    const contributor = await register("target-contributor");
    const target = await alice.post("/api/nodes").send({
      treeId: TREE_ID, title: "带图的公开目标", goal: "记录一次练习", visibility: "public",
      link: { type: "prereq", anchorId: NODE_ID }
    });
    expect(target.status).toBe(201);
    const nodeId = target.body.node.id;
    const practice = await alice.post("/api/records").send({
      treeId: TREE_ID, nodeId, text: "目标实践证据", visibility: "public",
      images: [{ mediaType: "image/png", dataUrl: "data:image/png;base64," + PNG_1X1 }]
    });
    expect(practice.status).toBe(201);
    const contribution = await contributor.post("/api/records").send({
      treeId: TREE_ID, nodeId, text: "另一位作者的实践", visibility: "public",
      images: [{ mediaType: "image/png", dataUrl: "data:image/png;base64," + PNG_1X1 }]
    }).expect(201);
    const shared = contribution.body.record;
    const sharedDetail = "/api/records/" + shared.id;
    const sharedImage = "/api/media/" + shared.images[0].id;
    const sharedProfile = "/api/profiles/" + shared.authorId;
    await alice.get(sharedDetail).expect(200);
    await alice.get(sharedImage).expect(200);
    expect((await alice.get(sharedProfile).expect(200)).body.records).toHaveLength(1);
    const media = "/api/media/" + practice.body.record.images[0].id;
    const list = () => bob.get("/api/records").query({ treeId: TREE_ID, nodeId });
    const before = await list();
    expect(before.headers["cache-control"]).toBe("private, no-store");
    expect(before.body.records).toHaveLength(2);
    const originalImage = await bob.get(media);
    expect(originalImage.status).toBe(200);
    expect((await alice.patch("/api/nodes/" + nodeId).send({ visibility: "private" })).status).toBe(200);
    const after = await list().set("If-None-Match", before.headers.etag);
    expect(after.status).toBe(200);
    expect(after.body.records).toEqual([]);
    const nodes = await bob.get("/api/nodes");
    expect(nodes.headers["cache-control"]).toBe("private, no-store");
    expect(nodes.body.nodes.some(node => node.id === nodeId)).toBe(false);
    expect((await bob.get(media).set("If-None-Match", originalImage.headers.etag)).status).toBe(404);
    expect((await alice.get(media)).status).toBe(200);
    await alice.get(sharedDetail).expect(404);
    await alice.get(sharedImage).expect(404);
    await contributor.get(sharedDetail).expect(404);
    expect((await alice.get(sharedProfile).expect(200)).body.records).toEqual([]);
    expect((await alice.get("/api/records").query({ treeId: TREE_ID, nodeId }).expect(200)).body.records.map((record) => record.id))
      .toEqual([practice.body.record.id]);
    await alice.patch("/api/nodes/" + nodeId).send({ visibility: "public" }).expect(200);
    await contributor.get(sharedDetail).expect(200);
    await bob.get(sharedImage).expect(200);
  });
  it("keeps a withdrawn practice removable from the last page of its reader's bookmarks", async () => {
    const author = await register("bookmark-page-author");
    const reader = await register("bookmark-page-reader");
    const listing = "/api/practice-bookmarks";
    const getPage = (agent, page) => agent.get(listing).query({ page }).expect(200);
    const { body: { ownerId } } = await getPage(reader, 1);
    const save = (id, saved) => reader.put(listing + "/" + id).set("X-Action-Account", ownerId).send({ saved }).expect(200);
    let oldest;
    for (let index = 0; index < 21; index += 1) {
      const { body: { record } } = await author.post("/api/records").send({
        treeId: TREE_ID, nodeId: NODE_ID, text: "收藏实践 " + index, visibility: "public"
      }).expect(201);
      oldest ??= record;
      await save(record.id, true);
    }
    expect((await getPage(reader, 1)).body).toMatchObject({ page: 1, hasNext: true });
    expect((await getPage(reader, 2)).body.items.map((item) => item.recordId)).toEqual([oldest.id]);
    expect((await getPage(author, 2)).body.items).toEqual([]);
    await author.patch("/api/records/" + oldest.id).send({ visibility: "private" }).expect(200);
    expect((await getPage(reader, 2)).body.items).toEqual([{ recordId: oldest.id, record: null, missing: false }]);
    await save(oldest.id, false);
    const result = (await getPage(reader, 2)).body;
    expect(result).toMatchObject({ page: 1, hasNext: false });
    expect(result.items).toHaveLength(20);
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

    const bobRecord = await bob.post("/api/records")
      .send({ treeId: TREE_ID, nodeId: NODE_ID, text: "Bob 的实践", eventId: "evt-1" });
    expect(bobRecord.status).toBe(201);
    expect(bobRecord.body.record.id).not.toBe(first.body.record.id);
    expect((await alice.get(`/api/records?treeId=${TREE_ID}`)).body.records).toHaveLength(2);

    const foreign = await bob.delete(`/api/records/${first.body.record.id}`);
    expect(foreign.status).toBe(404);

    const removed = await alice.delete(`/api/records/${first.body.record.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.ok).toBe(true);

    expect((await alice.get(`/api/records?treeId=${TREE_ID}`)).body.records.map(record => record.id)).toEqual([bobRecord.body.record.id]);
  });

  it("refuses a non-hex media id", async () => {
    const alice = await register("alice");

    const traversal = await alice.get("/api/media/..%2f..%2fusers.json");
    expect([400, 404]).toContain(traversal.status);
  });
});
