const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../server");

describe("knowledge contributions and privacy", () => {
  let directory, app, alice, bob, aliceId;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-product-"));
    app = createApp({ dataDir: directory, rateLimitEnabled: false }).app;
    alice = request.agent(app); bob = request.agent(app);
    const registration = await alice.post("/api/register").send({ name: "alice", password: "secret-123" });
    aliceId = registration.body.user.id;
    await bob.post("/api/register").send({ name: "bob", password: "secret-123" });
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  const content = (extra = {}) => ({ treeId: "k9-math", nodeId: "linear-equation", title: "移项实践", method: "写出等式，分别对两侧做同一运算。", startAction: "先写下一道等式并标出未知数。", ...extra });

  it("lets readers answer public demands and keeps withdrawal under the answer author's control", async () => {
    const node = "/api/knowledge-demands/k9-math/linear-equation";
    const bobId = (await bob.get(node).expect(200)).body.ownerId;
    const { body: { item } } = await alice.post(node).set("X-Action-Account", aliceId)
      .send({ title: "怎样检验等式", body: "想了解你的做法", visibility: "public" }).expect(201);
    const detail = node + "?demand=" + item.id;
    const bookmark = node + "/" + item.id + "/bookmark";
    const save = (saved) => bob.put(bookmark).set("X-Action-Account", bobId).send({ saved });
    const bookmarks = "/api/knowledge-demand-bookmarks";
    await save(true).expect(200);
    await save(true).expect(200);
    expect((await bob.get(detail).expect(200)).body.bookmarked).toBe(true);
    expect((await alice.get(bookmarks).expect(200)).body.items).toEqual([]);
    expect((await bob.get(bookmarks).expect(200)).body.items)
      .toEqual([{ demandId: item.id, treeId: item.treeId, nodeId: item.nodeId, title: item.title,
        answerCount: 0, hasAcceptedAnswer: false, answersClosed: false }]);
    const { body: archive } = await bob.get("/api/account/export").expect(200);
    expect(archive.demandBookmarks).toEqual([{ demandId: item.id, treeId: item.treeId, nodeId: item.nodeId }]);
    expect((await alice.get("/api/account/export").expect(200)).body.demandBookmarks).toEqual([]);
    const importRevision = async () => (await bob.get("/api/account/import-revision").expect(200)).body.revision;
    const beforeBookmarkRemoval = await importRevision();
    const search = "/api/knowledge-demands";
    const filtered = async (responseState) => (await bob.get(search).query({ responseState }).expect(200)).body.items.map(({ id }) => id);
    expect(await filtered("unanswered")).toEqual([item.id]);
    const answers = node + "/" + item.id + "/answers";
    const respond = () => bob.post(answers).set("X-Action-Account", bobId)
      .send({ text: "我把结果代回等式。", requestId: "answer-retry-example" });
    const beforeEdit = (await bob.get(detail).expect(200)).body.questionRevision;
    const { revision: ownerRevision } = (await alice.get(detail).expect(200)).body.items[0];
    await alice.patch(node + "/" + item.id).set("X-Action-Account", aliceId).set("If-Match", ownerRevision)
      .send({ title: item.title, body: "想了解如何检验含分数的等式。" }).expect(200);
    expect((await respond().set("If-Match", beforeEdit).expect(409)).body.code).toBe("ANSWER_QUESTION_CHANGED");
    const reviewed = (await bob.get(detail).expect(200)).body;
    expect(reviewed.answers).toEqual([]);
    const answering = node + "/" + item.id + "/answering";
    const setClosed = (agent, account, closed) => agent.put(answering).set("X-Action-Account", account).send({ closed });
    await setClosed(bob, bobId, true).expect(404);
    await setClosed(alice, aliceId, true).expect(200);
    expect(await filtered("unanswered")).toEqual([]);
    expect((await respond().expect(409)).body.code).toBe("DEMAND_ANSWERS_CLOSED");
    await setClosed(alice, aliceId, false).expect(200);
    await respond().set("If-Match", reviewed.questionRevision).expect(201);
    await setClosed(alice, aliceId, true).expect(200);
    expect((await bob.get(detail).expect(200)).body).toMatchObject({
      canAnswer: false, answersVisible: true, answers: [expect.objectContaining({ text: "我把结果代回等式。" })]
    });
    expect((await bob.get(bookmarks).expect(200)).body.items[0])
      .toMatchObject({ answerCount: 1, hasAcceptedAnswer: false, answersClosed: true });
    await respond().expect(200);
    await setClosed(alice, aliceId, false).expect(200);
    expect((await bob.get(detail).expect(200)).body.answers[0].questionUpdatedSincePosting).toBe(false);
    const { revision: updatedOwnerRevision } = (await alice.get(detail).expect(200)).body.items[0];
    await alice.patch(node + "/" + item.id).set("X-Action-Account", aliceId).set("If-Match", updatedOwnerRevision)
      .send({ title: item.title, body: "也想了解如何检查负号。" }).expect(200);
    const ownerView = (await alice.get(detail).expect(200)).body;
    expect(ownerView.answers).toEqual([expect.objectContaining({ text: "我把结果代回等式。", own: false })]);
    expect(ownerView.answers[0].questionUpdatedSincePosting).toBe(true);
    expect((await bob.get(detail).expect(200)).body.answers[0].questionUpdatedSincePosting).toBe(true);
    expect(ownerView.items[0].answerCount).toBe(1);
    expect(await filtered("unanswered")).toEqual([]);
    expect(await filtered("answered")).toEqual([item.id]);
    expect((await bob.get(search).expect(200)).body.items[0].answerCount).toBe(1);
    expect((await alice.get(node).expect(200)).body.items[0].answerCount).toBe(1);
    const [answer] = (await bob.get(detail).expect(200)).body.answers;
    expect(answer.own).toBe(true);
    const authorAnswers = "/api/knowledge-demand-answers/author/" + bobId;
    expect((await alice.get(authorAnswers).query({ page: 1 }).expect(200)).body.answers)
      .toEqual([expect.objectContaining({ id: answer.id, title: item.title })]);
    const helpful = (agent, account, value, revision = answer.revision) =>
      agent.put(answers + "/" + answer.id + "/helpful").set("X-Action-Account", account).set("If-Match", revision)
        .send({ helpful: value });
    await helpful(bob, bobId, true).expect(403);
    expect((await helpful(alice, aliceId, true).expect(200)).body.helpfulCount).toBe(1);
    expect((await helpful(alice, aliceId, true).expect(200)).body.helpfulCount).toBe(1);
    expect((await helpful(alice, aliceId, false).expect(200)).body.helpfulCount).toBe(0);
    await helpful(alice, aliceId, true).expect(200);
    expect((await bob.get(detail).expect(200)).body.answers[0]).toMatchObject({ helpfulCount: 1, helpful: false });
    expect((await alice.get(detail).expect(200)).body.answers[0]).not.toHaveProperty("helpfulBy");
    const searchAnswer = (agent, q, scope = "public") => agent.get(search).query({ q, scope }).expect(200)
      .then(({ body }) => body.items);
    expect(await searchAnswer(bob, "代回等式")).toEqual([expect.objectContaining({ id: item.id, matchedAnswerId: answer.id })]);
    const received = "/api/knowledge-demand-answers/received";
    const unread = async (agent) => (await agent.get(received).query({ summary: "1" }).expect(200)).body;
    expect((await bob.get(received).expect(200)).body.answers).toEqual([]);
    expect(await unread(bob)).toEqual({ ok: true, unreadCount: 0 });
    expect(await unread(alice)).toEqual({ ok: true, unreadCount: 1 });
    expect((await alice.get(received).expect(200)).body.answers)
      .toEqual([expect.objectContaining({ id: answer.id, unread: true })]);
    const read = answers + "/" + answer.id + "/read";
    await bob.post(read).set("X-Action-Account", bobId).expect(404);
    await alice.post(read).set("X-Action-Account", aliceId).expect(200);
    expect(await unread(alice)).toEqual({ ok: true, unreadCount: 0 });
    expect((await alice.get(received).expect(200)).body.answers[0].unread).toBe(false);
    const accept = (agent, account, answerId, accepted) => agent.put(answers + "/" + answerId + "/acceptance")
      .set("X-Action-Account", account).send({ accepted });
    await accept(bob, bobId, answer.id, true).expect(404);
    await accept(alice, aliceId, answer.id, true).expect(200);
    expect((await bob.get(detail).expect(200)).body.answers[0].accepted).toBe(true);
    const mine = "/api/knowledge-demand-answers/mine";
    expect((await alice.get(mine).expect(200)).body.answers).toEqual([]);
    expect((await bob.get(mine).expect(200)).body.answers)
      .toEqual([expect.objectContaining({ id: answer.id, title: item.title, accepted: true })]);
    expect((await bob.get(search).expect(200)).body.items[0].hasAcceptedAnswer).toBe(true);
    expect((await bob.get(bookmarks).expect(200)).body.items[0])
      .toMatchObject({ hasAcceptedAnswer: true, acceptedAnswerId: answer.id });
    expect(await filtered("accepted")).toEqual([item.id]);
    expect(await filtered("answered")).toEqual([]);
    expect((await alice.get(node).expect(200)).body.items[0].hasAcceptedAnswer).toBe(true);
    await accept(alice, aliceId, answer.id, false).expect(200);
    expect((await bob.get(detail).expect(200)).body.answers[0].accepted).toBe(false);
    expect((await bob.get(search).expect(200)).body.items[0].hasAcceptedAnswer).toBe(false);
    expect((await bob.get(bookmarks).expect(200)).body.items[0]).not.toHaveProperty("acceptedAnswerId");
    await bob.post(answers).set("X-Action-Account", bobId)
      .send({ text: "也可以画图检验。", requestId: "answer-second-example" }).expect(201);
    const second = (await bob.get(detail).expect(200)).body.answers[1];
    await alice.put(answers + "/" + second.id + "/helpful").set("X-Action-Account", aliceId)
      .set("If-Match", second.revision).send({ helpful: true }).expect(200);
    const ranked = () => bob.get(detail).query({ answerOrder: "helpful" }).expect(200)
      .then(({ body }) => body.answers.map(({ id }) => id));
    await helpful(alice, aliceId, false).expect(200);
    expect(await ranked()).toEqual([second.id, answer.id]);
    await accept(alice, aliceId, second.id, true).expect(200);
    expect((await bob.get(detail).expect(200)).body.answers.map(({ id, accepted }) => [id, accepted]))
      .toEqual([[second.id, true], [answer.id, false]]);
    await accept(alice, aliceId, answer.id, true).expect(200);
    expect(await ranked()).toEqual([answer.id, second.id]);
    expect((await bob.get(detail).expect(200)).body.answers.map(({ id, accepted }) => [id, accepted]))
      .toEqual([[answer.id, true], [second.id, false]]);
    const edit = (agent, account) => agent.patch(answers + "/" + answer.id)
      .set("X-Action-Account", account).set("If-Match", answer.revision).send({ text: "先化简，再代回等式。" });
    await edit(alice, aliceId).expect(404);
    await edit(bob, bobId).expect(200);
    expect((await respond().set("If-Match", beforeEdit).expect(200)).body.id).toBe(answer.id);
    await bob.post(answers).set("X-Action-Account", bobId)
      .send({ text: "先化简，再代回等式。", requestId: "answer-retry-example" }).expect(409);
    await helpful(alice, aliceId, true).expect(409);
    expect((await alice.get(detail).expect(200)).body.answers.find(({ id }) => id === answer.id))
      .toMatchObject({ helpfulCount: 0, helpful: false });
    expect((await alice.get(received).expect(200)).body.answers.find(({ id }) => id === answer.id).unread).toBe(true);
    await alice.post(read).set("X-Action-Account", aliceId).set("If-Match", answer.revision).expect(409);
    const revised = (await alice.get(detail).expect(200)).body.answers.find(({ id }) => id === answer.id);
    await alice.post(read).set("X-Action-Account", aliceId).set("If-Match", revised.revision).expect(200);
    expect((await alice.get(received).expect(200)).body.answers.find(({ id }) => id === answer.id).unread).toBe(false);
    const conflict = await edit(bob, bobId).expect(409);
    expect(conflict.body).toMatchObject({ code: "ANSWER_EDIT_CONFLICT", current: {
      text: "先化简，再代回等式。", revision: expect.any(String)
    } });
    expect((await alice.get(detail).expect(200)).body.answers[0])
      .toMatchObject({ text: "先化简，再代回等式。", accepted: false });
    expect((await alice.get(detail).expect(200)).body.answers).toHaveLength(2);
    await accept(alice, aliceId, answer.id, true).set("If-Match", answer.revision).expect(409);
    await bob.post(answers + "/" + second.id + "/withdraw").set("X-Action-Account", bobId).expect(200);
    const withdraw = answers + "/" + answer.id + "/withdraw";
    await alice.post(withdraw).set("X-Action-Account", aliceId).expect(404);
    await alice.post(node + "/" + item.id + "/withdraw").set("X-Action-Account", aliceId).expect(200);
    await bob.get(detail).expect(404);
    expect((await bob.get(bookmarks).expect(200)).body.items[0])
      .toEqual({ demandId: item.id, treeId: item.treeId, nodeId: item.nodeId, title: null });
    await save(true).expect(404);
    await save(false).expect(200);
    expect((await bob.get(bookmarks).expect(200)).body.items).toEqual([]);
    const restore = (revision) => bob.post("/api/account/import").set("X-Knowledge-Revision", revision).send(archive);
    expect((await restore(beforeBookmarkRemoval).expect(409)).body.code).toBe("KNOWLEDGE_CONFLICT");
    expect((await restore(await importRevision()).expect(200)).body.imported.demandBookmarks).toBe(1);
    expect((await bob.get(bookmarks).expect(200)).body.items[0].title).toBeNull();
    expect((await alice.get(bookmarks).expect(200)).body.items).toEqual([]);
    expect((await alice.get(authorAnswers).query({ export: "1" }).expect(200)).body.answers).toEqual([]);
    expect(await searchAnswer(alice, "先化简", "mine")).toEqual([]);
    expect((await alice.get(received).expect(200)).body.answers).toEqual([]);
    expect(await unread(alice)).toEqual({ ok: true, unreadCount: 0 });
    expect((await bob.get(mine).expect(200)).body.answers)
      .toEqual([expect.objectContaining({ id: answer.id, text: "先化简，再代回等式。", title: null, accepted: false })]);
    const exported = await bob.get(mine).query({ export: "1" }).expect(200);
    expect(exported.headers["content-disposition"]).toContain("attachment");
    expect(exported.headers["cache-control"]).toBe("private, no-store");
    expect(exported.body).toMatchObject({ format: "kht-demand-answers-export/v1", answers: [
      expect.objectContaining({ id: answer.id, text: "先化简，再代回等式。", title: null })
    ] });
    expect((await alice.get(mine).query({ export: "1" }).expect(200)).body.answers).toEqual([]);
    await respond().expect(404);
    expect((await alice.get(detail).expect(200)).body).toMatchObject({ canAnswer: false, answers: [] });
    expect((await alice.get(search).query({ scope: "mine" }).expect(200)).body.items[0])
      .toMatchObject({ answerCount: 0, hasAcceptedAnswer: false });
    await bob.post(withdraw).set("X-Action-Account", bobId).expect(200);
    expect((await bob.get(mine).expect(200)).body.answers).toEqual([]);
    await alice.post(node + "/" + item.id + "/publish").set("X-Action-Account", aliceId).expect(200);
    expect(await searchAnswer(bob, "先化简")).toEqual([]);
    expect((await bob.get(detail).expect(200)).body.answers).toEqual([]);
    await accept(alice, aliceId, answer.id, true).expect(404);
    expect((await bob.get(search).expect(200)).body.items[0]).toMatchObject({ answerCount: 0, hasAcceptedAnswer: false });
    expect(await filtered("unanswered")).toEqual([item.id]);
  });

  it("filters unread demand replies before paginating and recovers an emptied last page", async () => {
    const node = "/api/knowledge-demands/k9-math/linear-equation";
    const bobId = (await bob.get(node).expect(200)).body.ownerId;
    const { body: { item } } = await alice.post(node).set("X-Action-Account", aliceId)
      .send({ title: "分页需求", body: "请分享做法", visibility: "public" }).expect(201);
    const answers = node + "/" + item.id + "/answers";
    for (let index = 0; index < 21; index += 1) {
      await bob.post(answers).set("X-Action-Account", bobId)
        .send({ text: "回应 " + index, requestId: "pagination-answer-" + index }).expect(201);
    }
    const inbox = (page, scope = "all") => alice.get("/api/knowledge-demand-answers/received")
      .query({ page, scope }).expect(200).then(({ body }) => body);
    const first = await inbox(1);
    expect(first.answers).toHaveLength(20);
    expect(first.hasNext).toBe(true);
    const second = await inbox(2);
    expect(second.answers.map(({ text }) => text)).toEqual(["回应 0"]);
    const detail = (params) => bob.get(node).query({ demand: item.id, ...params }).expect(200).then(({ body }) => body);
    const firstDetail = await detail({ answerPage: 1 });
    expect(firstDetail.answers).toHaveLength(20);
    expect(firstDetail.items[0].answerCount).toBe(21);
    const newest = first.answers[0];
    expect(await detail({ answerPage: 1, answerAnchor: newest.id })).toMatchObject({
      page: 2, hasNext: false, answers: [expect.objectContaining({ id: newest.id })]
    });
    const mine = (agent, page) => agent.get("/api/knowledge-demand-answers/mine").query({ page }).expect(200).then(({ body }) => body);
    expect((await mine(bob, 1)).answers).toHaveLength(20);
    expect(await mine(alice, 2)).toMatchObject({ answers: [], page: 1, hasNext: false });
    expect((await mine(bob, 2)).answers.map(({ id }) => id)).toEqual([second.answers[0].id]);
    expect((await bob.get("/api/knowledge-demand-answers/mine").query({ export: "1", page: 2 }).expect(200)).body.answers)
      .toHaveLength(21);
    for (const { id } of first.answers) {
      await alice.post(answers + "/" + id + "/read").set("X-Action-Account", aliceId).expect(200);
    }
    expect(await inbox(1, "unread")).toMatchObject({ answers: second.answers, page: 1, hasNext: false });
    await bob.post(answers + "/" + second.answers[0].id + "/withdraw").set("X-Action-Account", bobId).expect(200);
    const remaining = await mine(bob, 2);
    expect(remaining).toMatchObject({ page: 1, hasNext: false });
    expect(remaining.answers).toHaveLength(20);
    expect(await inbox(2)).toMatchObject({ answers: expect.any(Array), page: 1, hasNext: false });
    expect(await inbox(1, "unread")).toMatchObject({ answers: [], hasNext: false });
  });

  it("filters an author's demands to their public contributions", async () => {
    const node = "/api/knowledge-demands/k9-math/linear-equation";
    const bobId = (await bob.get(node).expect(200)).body.ownerId;
    const create = (agent, account, title, visibility) => agent.post(node).set("X-Action-Account", account)
      .send({ title, body: "同一个节点的练习", visibility }).expect(201).then(({ body }) => body.item);
    const shown = await create(alice, aliceId, "作者公开提问", "public");
    await create(alice, aliceId, "作者私人草稿", "private");
    await create(bob, bobId, "其他作者公开提问", "public");
    const { body: { item: otherNode } } = await alice.post("/api/knowledge-demands/k9-math/like-terms")
      .set("X-Action-Account", aliceId).send({ title: "另一节点的公开提问", body: "同一个关键词", visibility: "public" }).expect(201);
    const search = (agent, query = {}) => agent.get("/api/knowledge-demands").query({ authorId: aliceId, ...query });
    for (const agent of [alice, bob]) {
      expect((await search(agent).expect(200)).body.items.map(({ id }) => id).sort()).toEqual([shown.id, otherNode.id].sort());
      expect((await search(agent, { treeId: "k9-math", nodeId: "linear-equation", responseState: "unanswered" })
        .expect(200)).body.items.map(({ id }) => id)).toEqual([shown.id]);
    }
    expect((await search(bob, { q: "私人草稿" }).expect(200)).body.items).toEqual([]);
    await search(alice, { scope: "mine" }).expect(400);
    await search(bob, { treeId: "k9-math" }).expect(400);
    await alice.post(node + "/" + shown.id + "/withdraw").set("X-Action-Account", aliceId).expect(200);
    expect((await search(bob, { treeId: "k9-math", nodeId: "linear-equation" }).expect(200)).body.items).toEqual([]);
  });

  it("ranks direct demand matches above matches found only in responses", async () => {
    const node = "/api/knowledge-demands/k9-math/linear-equation";
    const bobId = (await bob.get(node).expect(200)).body.ownerId;
    const ask = (title, body) => alice.post(node).set("X-Action-Account", aliceId)
      .send({ title, body, visibility: "public" }).expect(201).then(({ body: result }) => result.item.id);
    const exact = await ask("代回检验", "怎样操作？");
    const partial = await ask("代回检验的步骤", "请举个例子");
    const bodyMatch = await ask("怎样检查结果", "想学代回检验");
    const answerMatch = await ask("怎么做练习", "想核对结果");
    await bob.post(node + "/" + answerMatch + "/answers").set("X-Action-Account", bobId)
      .send({ text: "可以做一次代回检验。", requestId: "rank-answer-example" }).expect(201);
    const search = (order) => bob.get("/api/knowledge-demands").query({ q: "代回检验", order }).expect(200);
    const ranked = (await search("relevance")).body.items;
    expect(ranked.map(({ id }) => id)).toEqual([exact, partial, bodyMatch, answerMatch]);
    expect(ranked[3]).toHaveProperty("matchedAnswerId");
    expect((await search("latest")).body.items.map(({ id }) => id)).toContain(answerMatch);
  });

  it("acknowledges a retried demand save without duplicating or overwriting subsequent edits", async () => {
    const node = "/api/knowledge-demands/k9-math/linear-equation";
    const input = { title: "第一次提交", body: "原来的问题", visibility: "public", requestId: "demand-retry-example" };
    const create = (payload) => alice.post(node).set("X-Action-Account", aliceId).send(payload);
    const { body: { item } } = await create(input).expect(201);
    const detail = node + "?demand=" + item.id;
    const { revision } = (await alice.get(detail).expect(200)).body.items[0];
    await alice.patch(node + "/" + item.id).set("X-Action-Account", aliceId).set("If-Match", revision)
      .send({ title: input.title, body: "另一窗口已更新的问题" }).expect(200);
    expect((await create(input).expect(200)).body.item.id).toBe(item.id);
    await create({ ...input, body: "不同的请求内容" }).expect(409);
    const visible = (await bob.get(node).expect(200)).body.items;
    expect(visible).toHaveLength(1);
    expect(visible[0].body).toBe("另一窗口已更新的问题");
    expect(visible[0]).not.toHaveProperty("submissionFingerprint");
  });

  it("keeps a contribution private until its author explicitly publishes it", async () => {
    const created = await alice.post("/api/tutorials").send(content());
    expect(created.status).toBe(201);
    expect(created.body.tutorial.authorId).toBe(aliceId);
    expect(created.body.tutorial.visibility).toBe("private");
    expect((await bob.get("/api/tutorials")).body.tutorials).toHaveLength(0);
    const tutorial = created.body.tutorial;
    const published = await alice.patch(`/api/tutorials/${tutorial.id}`).set("If-Match", tutorial.version).send({ visibility: "public" });
    expect(published.status).toBe(200);
    expect((await bob.get("/api/tutorials")).body.tutorials).toHaveLength(1);
    expect((await bob.get(`/api/tutorials/${tutorial.id}/versions/${tutorial.version}`)).status).toBe(404); // 私人旧版本不随发布暴露。
  });

  it("retains published immutable versions, rejects a stale edit, and restricts author edits", async () => {
    const old = (await alice.post("/api/tutorials").send(content({ visibility: "public" }))).body.tutorial;
    const edited = await alice.patch(`/api/tutorials/${old.id}`).set("If-Match", old.version).send({ method: "先验算，再写每一步依据。" });
    expect(edited.status).toBe(200);
    expect(edited.body.tutorial.version).not.toBe(old.version);
    const stale = await alice.patch(`/api/tutorials/${old.id}`).set("If-Match", old.version).send({ title: "过期窗口" });
    expect(stale.status).toBe(409);
    expect((await bob.patch(`/api/tutorials/${old.id}`).set("If-Match", edited.body.tutorial.version).send({ title: "越权" })).status).toBe(404);
    const historic = await bob.get(`/api/tutorials/${old.id}/versions/${old.version}`);
    expect(historic.body.tutorial.method).toBe(old.method);
    const practice = { treeId: old.treeId, nodeId: old.nodeId, tutorialId: old.id, tutorialVersion: old.version, text: "补记当时的练习" };
    const existing = await bob.post("/api/records").send({ ...practice, visibility: "public" }).expect(201);
    const practiceUrl = `/api/records/${existing.body.record.id}`;
    expect((await alice.get(practiceUrl).expect(200)).body.record).not.toHaveProperty("tutorialArchived");
    await bob.delete(`/api/tutorials/${old.id}`).expect(404);
    await alice.delete(`/api/tutorials/${old.id}`).set("If-Match", old.version).expect(409);
    expect((await bob.get("/api/tutorials")).body.tutorials[0].version).toBe(edited.body.tutorial.version);
    await alice.delete(`/api/tutorials/${old.id}`).set("If-Match", edited.body.tutorial.version)
      .set("X-Action-Account", aliceId).expect(200);
    expect((await bob.get("/api/tutorials")).body.tutorials).toHaveLength(0);
    expect((await bob.get("/api/tutorial-search").query({ authorId: aliceId }).expect(200)).body.items).toEqual([]);
    expect((await bob.get(`/api/profiles/${aliceId}`).expect(200)).body.methods).toEqual([]);
    const archivedVersion = await bob.get(`/api/tutorials/${old.id}/versions/${old.version}`).expect(200);
    expect(archivedVersion.body.tutorial).toMatchObject({ archived: true, version: old.version, method: old.method });
    expect((await alice.get(practiceUrl).expect(200)).body.record)
      .toMatchObject({ tutorialId: old.id, tutorialVersion: old.version, tutorialArchived: true });
    for (const viewer of [alice, bob]) {
      const rejected = await viewer.post("/api/records").send({ ...practice, visibility: "public" }).expect(409);
      expect(rejected.body.code).toBe("TUTORIAL_ARCHIVED");
    }
    const saved = await bob.post("/api/records").send({ ...practice, visibility: "private" }).expect(201);
    expect(saved.body.record).toMatchObject({ visibility: "private", tutorialId: old.id, tutorialVersion: old.version });
    await bob.patch(`/api/records/${saved.body.record.id}`).send({ visibility: "public" }).expect(409);
    await alice.get(`/api/records/${saved.body.record.id}`).expect(404);
  });

  it("rechecks an old public method link after the author makes the tutorial private", async () => {
    const method = (await alice.post("/api/tutorials").send(content({ visibility: "public" }))).body.tutorial;
    const url = `/api/tutorials/${method.id}/versions/${method.version}`;
    const previous = await bob.get(url);
    expect(previous.status).toBe(200);
    expect(previous.headers["cache-control"]).toBe("private, no-store");
    expect((await alice.patch(`/api/tutorials/${method.id}`).set("If-Match", method.version).send({ visibility: "private" })).status).toBe(200);
    const denied = await bob.get(url).set("If-None-Match", previous.headers.etag);
    expect(denied.status).toBe(404);
    expect(denied.headers["cache-control"]).toBe("private, no-store");
    expect(denied.body.tutorial).toBeUndefined();
    expect((await alice.get(url)).body.tutorial.method).toBe(method.method);
  });

  it("withdraws another author's tutorial and version links when the node becomes private", async () => {
    const reader = request.agent(app);
    await reader.post("/api/register").send({ name: "tutorial-reader", password: "secret-123" }).expect(201);
    const { body: { node } } = await alice.post("/api/nodes").send({
      treeId: "k9-math", title: "教程挂靠节点", goal: "写出等式", visibility: "public",
      link: { type: "prereq", anchorId: "linear-equation" }
    }).expect(201);
    const { body: { tutorial } } = await bob.post("/api/tutorials")
      .send(content({ nodeId: node.id, visibility: "public" })).expect(201);
    const { body: { tutorial: revised } } = await bob.patch(`/api/tutorials/${tutorial.id}`)
      .set("If-Match", tutorial.version).send({ method: "先写等式，再检查等号两侧。" }).expect(200);
    const list = (agent) => agent.get("/api/tutorials").query({ treeId: tutorial.treeId, nodeId: node.id }).expect(200);
    const profile = () => alice.get(`/api/profiles/${tutorial.authorId}`).expect(200);
    const versions = [tutorial, revised].map(({ id, version }) => `/api/tutorials/${id}/versions/${version}`);
    const original = await alice.get(versions[0]).expect(200);
    await reader.get(versions[1]).expect(200);
    expect((await list(alice)).body.tutorials).toHaveLength(1);
    expect((await profile()).body.methods).toHaveLength(1);

    const setVisibility = (visibility) => alice.patch(`/api/nodes/${node.id}`).send({ visibility }).expect(200);
    await setVisibility("private");
    await alice.get(versions[0]).set("If-None-Match", original.headers.etag).expect(404);
    await reader.get(versions[1]).expect(404);
    await bob.get(versions[1]).expect(404);
    expect((await list(alice)).body.tutorials).toEqual([]);
    expect((await profile()).body.methods).toEqual([]);

    await setVisibility("public");
    await alice.get(versions[0]).expect(200);
    await reader.get(versions[1]).expect(200);
  });

  it("searches current public versions and seed methods without returning private drafts", async () => {
    const { body: { tutorial } } = await alice.post("/api/tutorials")
      .send(content({ title: "独特系数校验", method: "先记录替换步骤", visibility: "public" })).expect(201);
    await alice.post("/api/tutorials").send(content({ title: "独特系数校验的私人草稿" })).expect(201);
    const search = (agent, q) => agent.get("/api/tutorial-search").query({ q }).expect(200);
    for (const viewer of [alice, bob]) {
      const { items } = (await search(viewer, "系数 替换")).body;
      expect(items).toEqual([expect.objectContaining({ id: tutorial.id, version: tutorial.version })]);
      expect(items[0]).not.toHaveProperty("method");
    }
    const partial = (await alice.post("/api/tutorials")
      .send(content({ title: "独特系数校验补充", visibility: "public" })).expect(201)).body.tutorial;
    const bodyMatch = (await alice.post("/api/tutorials")
      .send(content({ title: "另一个方法", method: "本文也提到独特系数校验。", visibility: "public" })).expect(201)).body.tutorial;
    expect((await search(bob, "独特系数校验")).body.items.map((item) => item.id)).toEqual([tutorial.id, partial.id, bodyMatch.id]);
    const { items: seeds } = (await search(bob, "过等号变号")).body;
    expect(seeds[0]).toMatchObject({ authorName: "种子方法", treeId: "k9-math" });
    await bob.get(`/api/tutorials/${seeds[0].id}/versions/${seeds[0].version}`).expect(200);
    await alice.patch(`/api/tutorials/${tutorial.id}`).set("If-Match", tutorial.version).send({ visibility: "private" }).expect(200);
    expect((await search(bob, "独特系数校验")).body.items.map((item) => item.id)).toEqual([partial.id, bodyMatch.id]);
  });
  it("rejects unknown scope and executable or credential-bearing material links", async () => {
    expect((await alice.post("/api/tutorials").send(content({ treeId: "other" }))).status).toBe(404);
    for (const url of ["javascript:alert(1)", "https://secret:pass@example.com/", "not-a-url"]) {
      expect((await alice.post("/api/tutorials").send(content({ resources: [{ label: "资料", url }] }))).status).toBe(400);
    }
    expect((await request(app).get("/api/tutorials")).status).toBe(401);
  });

  it("keeps a new personal node and its evidence hidden from another account", async () => {
    const created = await alice.post("/api/nodes").send({ title: "私人练习", goal: "做完自己的练习", link: { type: "prereq", anchorId: "natural-numbers" } });
    const id = created.body.node.id;
    expect(created.body.node.visibility).toBe("private");
    expect((await bob.get("/api/nodes")).body.nodes).toHaveLength(0);
    const evidence = await alice.post("/api/records").send({ treeId: "k9-math", nodeId: id, text: "个人证据" });
    expect(evidence.status).toBe(201);
    expect((await bob.get("/api/records")).body.records).toHaveLength(0);
    expect((await bob.post("/api/records").send({ treeId: "k9-math", nodeId: id, text: "越权" })).status).toBe(404);
    expect((await alice.post("/api/tutorials").send(content({ nodeId: id, visibility: "public" }))).status).toBe(400);
    expect((await bob.post("/api/nodes").send({ title: "偷偷挂靠", goal: "未知目标", link: { type: "prereq", anchorId: id } })).status).toBe(404);
    expect((await alice.get(`/api/holders?treeId=k9-math&nodeId=${id}`)).body.holders[0].id).toBe(aliceId);
  });

  it("does not conflate same event ids from different accounts", async () => {
    const payload = { treeId: "k9-math", nodeId: "linear-equation", text: "一次实践", eventId: "same-event" };
    const first = await alice.post("/api/records").send(payload);
    const second = await bob.post("/api/records").send(payload);
    expect(second.status).toBe(201);
    expect(second.body.record.id).not.toBe(first.body.record.id);
    expect(second.body.record.authorName).toBe("bob");
    expect((await alice.post("/api/records").send({ ...payload, treeId: "fake-tree" })).status).toBe(400);
  });

  it("defines public node holders by public self-confirmed practice, deduplicated by person", async () => {
    const payload = { treeId: "k9-math", nodeId: "linear-equation", text: "完成", lightUp: true };
    await alice.post("/api/records").send({ ...payload, eventId: "one" });
    await alice.post("/api/records").send({ ...payload, eventId: "two" });
    await bob.post("/api/records").send({ ...payload, visibility: "private" });
    let holders = await bob.get("/api/holders?treeId=k9-math&nodeId=linear-equation");
    expect(holders.body.holders).toEqual([{ id: aliceId, name: "alice" }]);
    await bob.post("/api/records").send(payload);
    holders = await alice.get("/api/holders?treeId=k9-math&nodeId=linear-equation");
    expect(holders.body.holders).toHaveLength(2);
    expect(holders.body.holderShareBps).toBe(5000);
    expect(holders.body.settlement).toBe("unconfigured");
  });

  it("validates that evidence refers to a real accessible method version on the same node", async () => {
    const tutorial = (await alice.post("/api/tutorials").send(content({ visibility: "public" }))).body.tutorial;
    const payload = { treeId: "k9-math", nodeId: "linear-equation", text: "完成", tutorialId: tutorial.id, tutorialVersion: tutorial.version };
    expect((await bob.post("/api/records").send(payload)).status).toBe(201);
    expect((await bob.post("/api/records").send({ ...payload, tutorialVersion: "unknown" })).status).toBe(400);
    expect((await bob.post("/api/records").send({ ...payload, nodeId: "natural-numbers" })).status).toBe(400);
  });

  it("uses configured links, secure cookies and rejects a foreign browser origin", async () => {
    const configured = createApp({ dataDir: directory, platformUrl: "https://knowledge.example:4311/", secureCookies: true }).app;
    expect((await request(configured).get("/runtime-config.js")).text).toContain("4311");
    const login = await request(configured).post("/api/login").send({ name: "alice", password: "secret-123" });
    expect(login.headers["set-cookie"].join(";")).toContain("Secure");
    expect((await request(app).post("/api/login").set("Origin", "https://foreign.example").send({ name: "alice", password: "secret-123" })).status).toBe(403);
  });

  it("creates a personal knowledge tree and permits only its owner to use its private targets", async () => {
    const created = await alice.post("/api/trees").send({ name: "把想法做出来", goal: "写下一个可以验证的小目标" });
    expect(created.status).toBe(201);
    const { tree, node } = created.body;
    const child = await alice.post("/api/nodes").send({ treeId: tree.id, title: "做一次验证", goal: "记录观察结果", link: { type: "prereq", anchorId: node.id } });
    expect(child.status).toBe(201);
    expect(child.body.node.treeId).toBe(tree.id);
    expect((await bob.get("/api/nodes")).body.trees).toHaveLength(0);
    expect((await bob.get("/api/nodes")).body.nodes).toHaveLength(0);
    expect((await alice.post("/api/tutorials").send({ ...content(), treeId: tree.id, nodeId: child.body.node.id })).status).toBe(201);
    await alice.patch(`/api/nodes/${node.id}`).send({ visibility: "public" });
    expect((await bob.get("/api/nodes")).body.nodes).toHaveLength(0); // 树的私人边界仍然生效。
  });

  it("withdraws a public practice without deleting the author's evidence or leaving its media visible", async () => {
    const record = (await alice.post("/api/records").send({ treeId: "k9-math", nodeId: "linear-equation", text: "已完成", lightUp: true })).body.record;
    expect((await bob.get("/api/records")).body.records).toHaveLength(1);
    expect((await bob.patch(`/api/records/${record.id}`).send({ visibility: "private" })).status).toBe(404);
    expect((await alice.patch(`/api/records/${record.id}`).send({ visibility: "private" })).status).toBe(200);
    expect((await bob.get("/api/records")).body.records).toHaveLength(0);
    expect((await alice.get("/api/records")).body.records[0].text).toBe("已完成");
    expect((await bob.get("/api/holders?treeId=k9-math&nodeId=linear-equation")).body.holders).toHaveLength(0);
  });

  it("prevents explicitly publishing practice inside a private tree and keeps legacy submissions private", async () => {
    const { tree, node } = (await alice.post("/api/trees").send({ name: "私人树", goal: "完成一个目标" })).body;
    const payload = { treeId: tree.id, nodeId: node.id, text: "私人实践" };
    expect((await alice.post("/api/records").send({ ...payload, visibility: "public" })).status).toBe(400);
    const saved = await alice.post("/api/records").send(payload);
    expect(saved.status).toBe(201);
    expect(saved.body.record.visibility).toBe("private");
    expect((await bob.get("/api/records")).body.records).toEqual([]);
  });
});
