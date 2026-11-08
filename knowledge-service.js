const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");

const PRODUCT_WANTS_FILE = "product-wants.json";
const KNOWLEDGE_DEMANDS_FILE = "knowledge-demands.json";
const DEMAND_BOOKMARKS_FILE = "knowledge-demand-bookmarks.json";
const validMaterialIndex = (value) => typeof value === "string" && /^(?:[0-9]|1[01])$/.test(value);
const validBudget = (value) => Number.isSafeInteger(value) && value > 0 && value <= 100000000;

function readProductWants(readJsonFile, file) {
  const items = readJsonFile(file, []);
  if (!Array.isArray(items)) throw new Error("想要清单格式损坏");
  return items;
}

function readKnowledgeDemands(readJsonFile, file) {
  const items = readJsonFile(file, []);
  if (!Array.isArray(items)) throw new Error("需求列表格式损坏");
  return items;
}

function contentVersion(value) {
  return nodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function tutorialInput(body) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const method = typeof input.method === "string" ? input.method.trim() : "";
  const startAction = typeof input.startAction === "string" ? input.startAction.trim() : "";
  if (!title || title.length > 80 || !method || method.length > 8000 || startAction.length > 240) {
    throw new Error("请填写方法标题和具体步骤；标题最多 80 字，步骤最多 8000 字，五分钟起步最多 240 字。");
  }
  const resources = Array.isArray(input.resources) ? input.resources : [];
  if (resources.length > 12) throw new Error("一个方法最多关联 12 项材料。");
  const normalized = resources.map((resource) => {
    const label = typeof resource.label === "string" ? resource.label.trim() : "";
    const url = new URL(resource.url);
    if (!label || label.length > 80 || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2000) {
      throw new Error("材料需要名称和合法的 HTTP/HTTPS 链接，链接不得包含登录凭据。");
    }
    return { label, url: url.href, affiliate: resource.affiliate === true, optional: resource.optional !== false };
  });
  return { title, method, startAction, resources: normalized, visibility: input.visibility === "public" ? "public" : "private" };
}

function installKnowledgeService(app, config, hooks) {
  const { authenticate, readJsonFile, writeJsonFile, readCustomNodes, readRecords } = hooks;
  const file = path.join(config.dataDir, "tutorials.json");
  const wantsFile = path.join(config.dataDir, PRODUCT_WANTS_FILE);
  const demandsFile = path.join(config.dataDir, KNOWLEDGE_DEMANDS_FILE);
  const answersFile = path.join(config.dataDir, "knowledge-demand-answers.json");
  const demandBookmarksFile = path.join(config.dataDir, DEMAND_BOOKMARKS_FILE);
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-trees", "k9-math.json"), "utf8"));
  const read = () => {
    const data = readJsonFile(file, []);
    if (!Array.isArray(data)) throw new Error("方法数据格式损坏，保留原文件并停止写入。");
    return data;
  };
  function nodeFor(treeId, nodeId, user) {
    if (treeId === seed.tree.id) {
      const node = seed.nodes.find((item) => item.id === nodeId);
      if (node) return node;
    }
    const custom = readCustomNodes(config);
    const tree = custom.trees.find((item) => item.id === treeId);
    if (tree && tree.visibility === "private" && (!user.id || tree.ownerId !== user.id)) return null;
    const node = custom.nodes.find((item) => item.treeId === treeId && item.id === nodeId &&
      (item.visibility !== "private" || Boolean(user.id && item.ownerId === user.id)));
    return node && tree && tree.visibility === "private" ? { ...node, visibility: "private" } : node;
  }
  const accessible = (tutorial, user) => {
    const own = tutorial.authorId === user.id;
    return (own || tutorial.visibility === "public") &&
      nodeFor(tutorial.treeId, tutorial.nodeId, own ? user : { id: null });
  };
  const followedAuthorIds = (user) => new Set(require("./prototypes/community-review/integration/action-state.cjs")
    .readFollowedAuthors(config.dataDir, user.id).map((item) => item.id));
  function route(method, url, callback) {
    app[method](url, (req, res) => {
      if (method === "get") res.setHeader("Cache-Control", "private, no-store");
      try {
        const user = authenticate(config, req);
        if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
        return callback(req, res, user);
      } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: "知识资料读取或保存失败，原文件已保留，请重试。" });
      }
    });
  }

  route("get", "/api/tutorials", (req, res, user) => {
    const tutorials = read().filter((item) => !item.archived && accessible(item, user) && (!req.query.treeId || item.treeId === req.query.treeId) && (!req.query.nodeId || item.nodeId === req.query.nodeId));
    return res.json({ ok: true, tutorials: tutorials.map(({ versions, ...item }) => { void versions; return item; }) });
  });

  route("get", "/api/tutorial-search", (req, res, user) => {
    const { q = "", page = "1", scope = "public", authorId } = req.query;
    if (scope !== "public" && scope !== "following") return res.status(400).json({ ok: false, message: "搜索范围无效。" });
    if (scope === "following" && !config.communityEnabled) return res.status(404).json({ ok: false, message: "当前站点未启用社区关注。" });
    if (authorId !== undefined && (typeof authorId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(authorId))) {
      return res.status(400).json({ ok: false, message: "作者标识无效。" });
    }
    if (typeof q !== "string" || q.length > 80 || typeof page !== "string" || !/^[1-9][0-9]{0,5}$/.test(page)) {
      return res.status(400).json({ ok: false, message: "请输入最多 80 字的搜索词。" });
    }
    const followed = scope === "following" ? followedAuthorIds(user) : null;
    const terms = q.normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const candidates = read().filter((item) => item.visibility === "public" && !item.archived)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id))
      .concat(seed.tutorials.map((item) => ({ ...item, treeId: seed.tree.id, authorName: "种子方法", version: item.version || "seed-1" })));
    const exactTitles = [];
    const matchingTitles = [];
    const otherMatches = [];
    const phrase = terms.join(" ");
    const nodes = new Map();
    for (const item of candidates) {
      if ((authorId && item.authorId !== authorId) || (followed && !followed.has(item.authorId))) continue;
      const key = `${item.treeId}:${item.nodeId}`;
      if (!nodes.has(key)) nodes.set(key, nodeFor(item.treeId, item.nodeId, { id: null }));
      const node = nodes.get(key);
      if (!node) continue;
      const searchable = [item.title, item.method, item.startAction, item.authorName, node.title, node.goal].join("\n").normalize("NFKC").toLowerCase();
      if (!terms.every((term) => searchable.includes(term))) continue;
      const { id, treeId, nodeId, title, version, authorId: resultAuthorId, authorName, startAction } = item;
      const normalizedTitle = title.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
      const result = { id, treeId, nodeId, title, version, authorId: resultAuthorId, authorName, startAction, nodeTitle: node.title };
      if (phrase && normalizedTitle === phrase) exactTitles.push(result);
      else if (phrase && terms.every((term) => normalizedTitle.includes(term))) matchingTitles.push(result);
      else otherMatches.push(result);
    }
    const matches = exactTitles.concat(matchingTitles, otherMatches);
    const offset = (Number(page) - 1) * 20;
    return res.json({ ok: true, items: matches.slice(offset, offset + 20), hasNext: matches.length > offset + 20 });
  });

  route("post", "/api/tutorials", (req, res, user) => {
    const node = nodeFor(req.body.treeId, req.body.nodeId, user);
    if (!node) return res.status(404).json({ ok: false, message: "没有找到可访问的目标节点。" });
    let content;
    try { content = tutorialInput(req.body); } catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
    if (node.visibility === "private" && content.visibility === "public") return res.status(400).json({ ok: false, message: "私人节点上的方法只能先保存在自己这里。" });
    const now = new Date().toISOString();
    const tutorial = { id: `t${nodeCrypto.randomBytes(12).toString("hex")}`, treeId: req.body.treeId, nodeId: req.body.nodeId, authorId: user.id, authorName: user.name, ...content, version: contentVersion(content), createdAt: now, updatedAt: now, versions: [] };
    tutorial.versions.push({ ...content, version: tutorial.version, createdAt: now });
    const data = read();
    data.push(tutorial);
    writeJsonFile(file, data);
    return res.status(201).json({ ok: true, tutorial });
  });

  route("patch", "/api/tutorials/:id", (req, res, user) => {
    const data = read();
    const tutorial = data.find((item) => item.id === req.params.id && item.authorId === user.id && !item.archived);
    if (!tutorial) return res.status(404).json({ ok: false, message: "没有找到你可以编辑的方法。" });
    if (req.get("If-Match") !== tutorial.version) return res.status(409).json({ ok: false, code: "TUTORIAL_CONFLICT", message: "方法已在另一窗口更新。请复制当前文字，再重新打开方法。" });
    let content;
    try { content = tutorialInput({ ...tutorial, ...req.body }); } catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
    const node = nodeFor(tutorial.treeId, tutorial.nodeId, user);
    if (!node || (node.visibility === "private" && content.visibility === "public")) return res.status(400).json({ ok: false, message: "私人节点上的方法不能公开。" });
    const version = contentVersion(content);
    if (version !== tutorial.version) {
      tutorial.versions.push({ ...content, version, createdAt: new Date().toISOString() });
      Object.assign(tutorial, content, { version, updatedAt: new Date().toISOString() });
      writeJsonFile(file, data);
    }
    return res.json({ ok: true, tutorial });
  });

  function tutorialVersion(id, hash, user, tutorials) {
    const seeded = seed.tutorials.find((item) => item.id === id && (item.version || "seed-1") === hash);
    if (seeded) return { ...seeded, treeId: seed.tree.id, authorName: "种子方法" };
    const tutorial = (tutorials ?? read()).find((item) => item.id === id && accessible(item, user));
    const version = tutorial && tutorial.versions.find((item) => item.version === hash && (tutorial.authorId === user.id || item.visibility === "public"));
    return version && { ...version, id: tutorial.id, treeId: tutorial.treeId, nodeId: tutorial.nodeId, authorName: tutorial.authorName,
      ...(tutorial.archived ? { archived: true } : {}) };
  }
  route("get", "/api/tutorials/:id/versions/:version", (req, res, user) => {
    const version = tutorialVersion(req.params.id, req.params.version, user);
    if (!version) return res.status(404).json({ ok: false, message: "没有找到可以查看的版本。" });
    return res.json({ ok: true, tutorial: version });
  });

  const readDemands = () => readKnowledgeDemands(readJsonFile, demandsFile);
  const answerScope = ({ treeId, nodeId }, id) => JSON.stringify([treeId, nodeId, id]);
  function answerSummaries(items) {
    const summaries = new Map(items.filter((item) => item.visibility === "public" &&
      nodeFor(item.treeId, item.nodeId, { id: null })).map((item) =>
      [answerScope(item, item.id), { answerCount: 0, hasAcceptedAnswer: false }]));
    if (!summaries.size) return summaries;
    for (const answer of readJsonFile(answersFile, [])) {
      const summary = summaries.get(answerScope(answer, answer.demandId));
      if (!summary || answer.withdrawn) continue;
      summary.answerCount += 1;
      if (answer.accepted === true) {
        summary.hasAcceptedAnswer = true;
        summary.acceptedAnswerId = answer.id;
      }
    }
    return summaries;
  }
  const emptyAnswerSummary = { answerCount: 0, hasAcceptedAnswer: false };
  function publicOwnedDemands(user) {
    return new Map(readDemands().filter((item) => item.ownerId === user.id && item.visibility === "public" &&
      nodeFor(item.treeId, item.nodeId, { id: null })).map((item) => [answerScope(item, item.id), item]));
  }
  const validAnswerPage = (page) => page === undefined || (typeof page === "string" && /^[1-9][0-9]{0,5}$/.test(page));
  const answerPageSize = 20;
  function paginateAnswers(answers, page) {
    if (page === undefined) return { answers };
    const currentPage = Math.min(Number(page), Math.max(1, Math.ceil(answers.length / answerPageSize)));
    const offset = (currentPage - 1) * answerPageSize;
    return { answers: answers.slice(offset, offset + answerPageSize), page: currentPage, hasNext: answers.length > offset + answerPageSize };
  }
  route("get", "/api/knowledge-demand-answers/received", (req, res, user) => {
    const { page, scope = "all" } = req.query;
    if (!["all", "unread"].includes(scope) || !validAnswerPage(page)) {
      return res.status(400).json({ ok: false, message: "回应分页参数无效。" });
    }
    const demands = publicOwnedDemands(user);
    const answers = [];
    const summaryOnly = req.query.summary === "1";
    let unreadCount = 0;
    for (const answer of readJsonFile(answersFile, []).slice().reverse()) {
      const demand = demands.get(answerScope(answer, answer.demandId));
      if (!demand || answer.withdrawn || answer.authorId === user.id) continue;
      if (!answer.readAt) unreadCount += 1;
      if (summaryOnly || (scope === "unread" && answer.readAt)) continue;
      const { id, treeId, nodeId, demandId, authorName, text, readAt } = answer;
      answers.push({ id, treeId, nodeId, demandId, authorName, text, title: demand.title, unread: !readAt });
    }
    if (summaryOnly) return res.json({ ok: true, unreadCount });
    return res.json({ ok: true, ...paginateAnswers(answers, page) });
  });
  function listAuthoredAnswers(req, res, user) {
    const { page } = req.query;
    if (!validAnswerPage(page)) return res.status(400).json({ ok: false, message: "回应分页参数无效。" });
    const authorId = req.params.author;
    if (authorId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(authorId)) return res.status(404).json({ ok: false });
    const exporting = !authorId && req.query.export === "1";
    const publicDemands = new Map(readDemands().filter((item) => item.visibility === "public")
      .map((item) => [answerScope(item, item.id), item]));
    const available = new Map();
    function visibleDemand(answer) {
      const key = answerScope(answer, answer.demandId);
      if (!available.has(key)) {
        const demand = publicDemands.get(key);
        available.set(key, demand && nodeFor(answer.treeId, answer.nodeId, { id: null }) ? demand : null);
      }
      return available.get(key);
    }
    const authored = readJsonFile(answersFile, []).filter((answer) => answer.authorId === (authorId || user.id) &&
      !answer.withdrawn && (!authorId || visibleDemand(answer))).reverse();
    const { answers, ...pagination } = paginateAnswers(authored, exporting ? undefined : page);
    const items = answers.map((answer) => {
      const { id, treeId, nodeId, demandId, text, accepted } = answer;
      const demand = visibleDemand(answer);
      return { id, treeId, nodeId, demandId, text, title: demand?.title ?? null, accepted: Boolean(demand) && accepted === true };
    });
    if (exporting) {
      res.setHeader("Content-Disposition", "attachment; filename=knowledge-demand-answers.json");
      return res.json({ format: "kht-demand-answers-export/v1", exportedAt: new Date().toISOString(), answers: items });
    }
    return res.json({ ok: true, ...(!authorId ? { ownerId: user.id } : {}), answers: items, ...pagination });
  }
  route("get", "/api/knowledge-demand-answers/mine", listAuthoredAnswers);
  route("get", "/api/knowledge-demand-answers/author/:author", listAuthoredAnswers);
  route("get", "/api/knowledge-demands", (req, res, user) => {
    const { q = "", scope = "public", page = "1", responseState = "all", order = "relevance", authorId, treeId, nodeId } = req.query;
    if (typeof q !== "string" || q.length > 80 || !["public", "mine", "following"].includes(scope) ||
      typeof page !== "string" || !/^[1-9][0-9]{0,5}$/.test(page)) {
      return res.status(400).json({ ok: false, message: "请输入最多 80 字的搜索词。" });
    }
    if (scope === "following" && !config.communityEnabled) return res.status(404).json({ ok: false, message: "当前站点未启用社区关注。" });
    if (!["all", "unanswered", "answered", "accepted"].includes(responseState) || !["relevance", "latest"].includes(order)) {
      return res.status(400).json({ ok: false, message: "请选择有效的回应状态和排序。" });
    }
    if ((treeId !== undefined || nodeId !== undefined) &&
        ![treeId, nodeId].every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      return res.status(400).json({ ok: false, message: "请选择完整的知识节点。" });
    }
    if (authorId !== undefined && (scope === "mine" || typeof authorId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(authorId))) {
      return res.status(400).json({ ok: false, message: "作者筛选只适用于公开需求。" });
    }
    const normalizedQuery = q.normalize("NFKC").trim().toLowerCase();
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const nodes = new Map();
    const followed = scope === "following" ? followedAuthorIds(user) : null;
    const matchingAnswers = new Map();
    const matchedThroughAnswer = new Map();
    const relevance = new Map();
    const matches = (value) => {
      const text = value.normalize("NFKC").toLowerCase();
      return terms.every((term) => text.includes(term));
    };
    if (terms.length) {
      for (const answer of readJsonFile(answersFile, [])) {
        if (answer.withdrawn || !matches(answer.text)) continue;
        const key = answerScope(answer, answer.demandId);
        if (!matchingAnswers.has(key) || answer.accepted) matchingAnswers.set(key, answer.id);
      }
    }
    const matching = readDemands().filter((item) => {
      if (treeId && (item.treeId !== treeId || item.nodeId !== nodeId)) return false;
      if (scope === "mine" ? item.ownerId !== user.id : item.visibility !== "public") return false;
      if (authorId && item.ownerId !== authorId) return false;
      if (followed && !followed.has(item.ownerId)) return false;
      const questionMatches = matches(`${item.title}\n${item.body}`);
      const answerKey = answerScope(item, item.id);
      const answerId = item.visibility === "public" && matchingAnswers.get(answerKey);
      if (!questionMatches && !answerId) return false;
      const key = `${item.treeId}:${item.nodeId}`;
      if (!nodes.has(key)) nodes.set(key, nodeFor(item.treeId, item.nodeId, scope === "mine" ? user : { id: null }));
      if (!questionMatches) {
        const publicNode = scope === "mine" ? nodeFor(item.treeId, item.nodeId, { id: null }) : nodes.get(key);
        if (!publicNode) return false;
        matchedThroughAnswer.set(answerKey, answerId);
      }
      if (terms.length && order === "relevance") {
        const title = item.title.normalize("NFKC").trim().toLowerCase();
        const rank = title === normalizedQuery ? 3 : matches(title) ? 2 : questionMatches ? 1 : 0;
        relevance.set(item, rank);
      }
      return scope === "mine" || Boolean(nodes.get(key));
    }).sort((left, right) => (relevance.get(right) ?? 0) - (relevance.get(left) ?? 0) ||
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const offset = (Number(page) - 1) * 20;
    const filteredSummaries = responseState === "all" ? null : answerSummaries(matching);
    const filtered = filteredSummaries ? matching.filter((item) => {
      const summary = filteredSummaries.get(answerScope(item, item.id));
      if (!summary) return false;
      if (responseState === "unanswered") return !item.answersClosed && summary.answerCount === 0;
      if (responseState === "accepted") return summary.hasAcceptedAnswer;
      return summary.answerCount > 0 && !summary.hasAcceptedAnswer;
    }) : matching;
    const pageItems = filtered.slice(offset, offset + 20);
    const summaries = filteredSummaries || answerSummaries(pageItems);
    const items = pageItems.map(({ id, treeId, nodeId, title, createdAt, visibility, answersClosed }) => ({
      id, treeId, nodeId, title, createdAt, visibility, nodeTitle: nodes.get(`${treeId}:${nodeId}`)?.title || null,
      answersClosed: answersClosed === true,
      ...(matchedThroughAnswer.has(answerScope({ treeId, nodeId }, id)) ?
        { matchedAnswerId: matchedThroughAnswer.get(answerScope({ treeId, nodeId }, id)) } : {}),
      ...(summaries.get(answerScope({ treeId, nodeId }, id)) || emptyAnswerSummary)
    }));
    return res.json({ ok: true, items, hasNext: filtered.length > offset + 20,
      ...(treeId ? { nodeAvailable: Boolean(nodeFor(treeId, nodeId, user)) } : {}) });
  });
  const demandPath = "/api/knowledge-demands/:treeId/:nodeId";
  const readDemandBookmarks = () => readJsonFile(demandBookmarksFile, []);
  route("get", "/api/knowledge-demand-bookmarks", (req, res, user) => {
    const { page = "1" } = req.query;
    if (!validAnswerPage(page)) return res.status(400).json({ ok: false, message: "收藏分页参数无效。" });
    const records = new Map(readDemands().filter((item) => item.visibility === "public")
      .map((item) => [answerScope(item, item.id), item]));
    const own = readDemandBookmarks().filter((entry) => entry.ownerId === user.id).reverse();
    const { answers: bookmarks, ...pagination } = paginateAnswers(own, page);
    const summaries = answerSummaries(bookmarks.map((bookmark) =>
      records.get(answerScope(bookmark, bookmark.demandId))).filter(Boolean));
    const items = bookmarks.map(({ treeId, nodeId, demandId }) => {
      const key = answerScope({ treeId, nodeId }, demandId);
      const summary = summaries.get(key);
      const demand = records.get(key);
      return summary ? { treeId, nodeId, demandId, title: demand.title, answersClosed: demand.answersClosed === true, ...summary }
        : { treeId, nodeId, demandId, title: null };
    });
    return res.json({ ok: true, ownerId: user.id, items, ...pagination });
  });
  route("put", demandPath + "/:id/bookmark", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { saved } = req.body || {};
    if (typeof saved !== "boolean") return res.status(400).json({ ok: false, message: "请选择是否收藏。" });
    const { id, treeId, nodeId } = req.params;
    const key = answerScope({ treeId, nodeId }, id);
    if (saved && (!readDemands().some((item) => item.visibility === "public" && answerScope(item, item.id) === key) ||
        !nodeFor(treeId, nodeId, { id: null }))) {
      return res.status(404).json({ ok: false, message: "这条需求目前不可收藏。" });
    }
    const items = readDemandBookmarks();
    const index = items.findIndex((entry) => entry.ownerId === user.id && answerScope(entry, entry.demandId) === key);
    if (saved && index < 0) {
      items.push({ treeId, nodeId, demandId: id, ownerId: user.id });
      writeJsonFile(demandBookmarksFile, items);
    } else if (!saved && index >= 0) {
      items.splice(index, 1);
      writeJsonFile(demandBookmarksFile, items);
    }
    return res.json({ ok: true, saved });
  });
  const questionRevision = ({ title, body }) => contentVersion({ title, body });
  function demandText(input) {
    const { title, body } = input || {};
    if (typeof title !== "string" || !title.trim() || title.length > 80 ||
      typeof body !== "string" || !body.trim() || body.length > 2000) return null;
    return { title: title.trim(), body: body.trim() };
  }
  function demandProduct(product, treeId, nodeId, viewer) {
    const { tutorial, version, material } = product || {};
    if (!validMaterialIndex(material)) return null;
    const source = tutorialVersion(tutorial, version, viewer);
    if (!source || source.treeId !== treeId || source.nodeId !== nodeId || !source.resources?.[Number(material)]?.affiliate) return null;
    return { tutorial, version, material };
  }
  route("get", demandPath, (req, res, user) => {
    const { treeId, nodeId } = req.params;
    const nodeAvailable = Boolean(nodeFor(treeId, nodeId, user));
    const canPublishDemand = Boolean(nodeAvailable && nodeFor(treeId, nodeId, { id: null }));
    const requested = req.query.demand;
    const { answerPage, answerAnchor, answerOrder = "original" } = req.query;
    if (!["original", "helpful"].includes(answerOrder) || !validAnswerPage(answerPage) ||
        (answerAnchor !== undefined && (typeof answerAnchor !== "string" || !/^[a-f0-9]{32}$/.test(answerAnchor)))) {
      return res.status(400).json({ ok: false, message: "回应分页参数无效。" });
    }
    if (requested !== undefined && (typeof requested !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requested))) {
      return res.status(404).json({ ok: false });
    }
    if (!nodeAvailable && requested === undefined) return res.status(404).json({ ok: false });
    const items = readDemands().filter((item) => item.treeId === treeId && item.nodeId === nodeId &&
      (requested === undefined || item.id === requested) &&
      (item.ownerId === user.id || (canPublishDemand && item.visibility === "public"))).map((item) => {
      const own = item.ownerId === user.id;
      const { submissionFingerprint, ...visibleItem } = item;
      void submissionFingerprint;
      return { ...visibleItem, product: demandProduct(item.product, treeId, nodeId, user), own,
        ...(own ? { canLinkProduct: !item.product, revision: contentVersion(item) } : {}) };
    });
    if (requested !== undefined && !items.length) return res.status(404).json({ ok: false });
    const publicDemand = requested !== undefined && items[0]?.visibility === "public" && canPublishDemand;
    const currentQuestionRevision = publicDemand ? questionRevision(items[0]) : null;
    const answers = publicDemand ? readJsonFile(answersFile, [])
      .filter((answer) => answer.demandId === requested && answer.treeId === treeId && answer.nodeId === nodeId && !answer.withdrawn)
      .map(({ id, authorId, authorName, text, accepted, helpfulBy = [], questionRevision: publishedAgainst }) => ({
        id, authorId, authorName, text, own: authorId === user.id, accepted: accepted === true,
        revision: contentVersion(text),
        helpfulCount: helpfulBy.length, helpful: helpfulBy.includes(user.id),
        questionUpdatedSincePosting: Boolean(publishedAgainst && publishedAgainst !== currentQuestionRevision)
      })).sort((left, right) => Number(right.accepted) - Number(left.accepted) ||
        (answerOrder === "helpful" ? right.helpfulCount - left.helpfulCount : 0)) : [];
    if (requested === undefined) {
      const summaries = answerSummaries(items);
      for (const item of items) Object.assign(item, summaries.get(answerScope(item, item.id)) || emptyAnswerSummary);
    } else {
      Object.assign(items[0], { answerCount: answers.length, hasAcceptedAnswer: answers[0]?.accepted === true });
    }
    const anchorIndex = answerAnchor === undefined ? -1 : answers.findIndex(({ id }) => id === answerAnchor);
    const page = anchorIndex < 0 ? answerPage : Math.floor(anchorIndex / answerPageSize) + 1;
    const bookmarked = Boolean(publicDemand && readDemandBookmarks().some((entry) => entry.ownerId === user.id &&
      entry.treeId === treeId && entry.nodeId === nodeId && entry.demandId === requested));
    return res.json({ ok: true, ownerId: user.id, nodeAvailable, canPublishDemand, items, bookmarked, answersVisible: Boolean(publicDemand),
      canAnswer: Boolean(publicDemand && !items[0].answersClosed), ...paginateAnswers(answers, page),
      questionRevision: currentQuestionRevision });
  });

  route("post", demandPath + "/:id/answers", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId } = req.params;
    const demand = readDemands().find((item) => item.id === id && item.treeId === treeId && item.nodeId === nodeId);
    if (demand?.visibility !== "public" || !nodeFor(treeId, nodeId, { id: null })) {
      return res.status(404).json({ ok: false, message: "这条需求目前不可回应。草稿仍在输入框中。" });
    }
    const { text, requestId } = req.body || {};
    if (typeof text !== "string" || !text.trim() || text.length > 2000 ||
        typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
      return res.status(400).json({ ok: false, message: "请填写回应，最多 2000 字。" });
    }
    const answerId = nodeCrypto.createHash("sha256").update(JSON.stringify([treeId, nodeId, id, user.id, requestId])).digest("hex").slice(0, 32);
    const answers = readJsonFile(answersFile, []);
    const existing = answers.find((answer) => answer.id === answerId);
    const normalizedText = text.trim();
    const submissionRevision = contentVersion(normalizedText);
    if (existing) return !existing.withdrawn && (existing.submissionRevision || contentVersion(existing.text)) === submissionRevision
      ? res.json({ ok: true, id: existing.id })
      : res.status(409).json({ ok: false, message: "这次提交已处理，请刷新后重试。" });
    if (demand.answersClosed) {
      return res.status(409).json({ ok: false, code: "DEMAND_ANSWERS_CLOSED", message: "提问者已暂停收集回应。草稿仍在输入框中。" });
    }
    const expected = req.get("If-Match");
    const revision = questionRevision(demand);
    if (expected !== undefined && expected !== revision) {
      return res.status(409).json({ ok: false, code: "ANSWER_QUESTION_CHANGED", message: "问题已更新，请核对后再发布回应。草稿仍在输入框中。" });
    }
    answers.push({ id: answerId, demandId: id, treeId, nodeId, authorId: user.id, authorName: user.name,
      text: normalizedText, submissionRevision, questionRevision: revision });
    writeJsonFile(answersFile, answers);
    return res.status(201).json({ ok: true, id: answerId });
  });

  route("put", demandPath + "/:id/answering", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { closed } = req.body || {};
    if (typeof closed !== "boolean") return res.status(400).json({ ok: false, message: "请选择是否暂停收集回应。" });
    const { id, treeId, nodeId } = req.params;
    const items = readDemands();
    const item = items.find((entry) => entry.id === id && entry.treeId === treeId && entry.nodeId === nodeId && entry.ownerId === user.id);
    if (!item || item.visibility !== "public" || !nodeFor(treeId, nodeId, { id: null })) {
      return res.status(404).json({ ok: false, message: "找不到你可以管理的公开需求。" });
    }
    if (Boolean(item.answersClosed) !== closed) {
      if (closed) item.answersClosed = true;
      else delete item.answersClosed;
      writeJsonFile(demandsFile, items);
    }
    return res.json({ ok: true });
  });

  route("patch", demandPath + "/:id/answers/:answer", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId, answer } = req.params;
    const demand = readDemands().find((item) => item.id === id && item.treeId === treeId && item.nodeId === nodeId);
    if (demand?.visibility !== "public" || !nodeFor(treeId, nodeId, { id: null })) {
      return res.status(404).json({ ok: false, message: "这条需求目前不可访问。你的修改仍在输入框中。" });
    }
    const answers = readJsonFile(answersFile, []);
    const item = answers.find((entry) => entry.id === answer && entry.demandId === id && entry.treeId === treeId &&
      entry.nodeId === nodeId && entry.authorId === user.id && !entry.withdrawn);
    if (!item) return res.status(404).json({ ok: false, message: "找不到你可以编辑的回应。" });
    const revision = contentVersion(item.text);
    if (req.get("If-Match") !== revision) {
      return res.status(409).json({
        ok: false, code: "ANSWER_EDIT_CONFLICT", message: "回应已在另一窗口更新。请核对新版后再保存。",
        current: { text: item.text, revision }
      });
    }
    const { text } = req.body || {};
    if (typeof text !== "string" || !text.trim() || text.length > 2000) {
      return res.status(400).json({ ok: false, message: "请填写回应，最多 2000 字。" });
    }
    if (text.trim() !== item.text) {
      item.submissionRevision ||= revision;
      item.text = text.trim();
      delete item.accepted;
      delete item.readAt;
      delete item.helpfulBy;
      writeJsonFile(answersFile, answers);
    }
    return res.json({ ok: true });
  });

  route("post", demandPath + "/:id/answers/:answer/withdraw", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId, answer } = req.params;
    const answers = readJsonFile(answersFile, []);
    const item = answers.find((entry) => entry.id === answer && entry.demandId === id && entry.treeId === treeId &&
      entry.nodeId === nodeId && entry.authorId === user.id);
    if (!item) return res.status(404).json({ ok: false, message: "找不到你可以撤回的回应。" });
    if (!item.withdrawn) {
      item.withdrawn = true;
      delete item.text;
      delete item.submissionRevision;
      delete item.accepted;
      delete item.helpfulBy;
      writeJsonFile(answersFile, answers);
    }
    return res.json({ ok: true });
  });

  route("post", demandPath + "/:id/answers/:answer/read", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false });
    const { id, treeId, nodeId, answer } = req.params;
    if (!publicOwnedDemands(user).has(answerScope({ treeId, nodeId }, id))) return res.status(404).json({ ok: false });
    const answers = readJsonFile(answersFile, []);
    const item = answers.find((entry) => entry.id === answer && entry.demandId === id && entry.treeId === treeId &&
      entry.nodeId === nodeId && entry.authorId !== user.id && !entry.withdrawn);
    if (!item) return res.status(404).json({ ok: false });
    const expected = req.get("If-Match");
    if (expected !== undefined && expected !== contentVersion(item.text)) return res.status(409).json({ ok: false });
    if (!item.readAt) {
      item.readAt = new Date().toISOString();
      writeJsonFile(answersFile, answers);
    }
    return res.json({ ok: true });
  });

  route("put", demandPath + "/:id/answers/:answer/helpful", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId, answer } = req.params;
    const { helpful } = req.body || {};
    if (typeof helpful !== "boolean") return res.status(400).json({ ok: false, message: "请选择是否有帮助。" });
    const demand = readDemands().find((item) => item.id === id && item.treeId === treeId && item.nodeId === nodeId);
    if (demand?.visibility !== "public" || !nodeFor(treeId, nodeId, { id: null })) {
      return res.status(404).json({ ok: false, message: "这条需求目前不可访问。" });
    }
    const answers = readJsonFile(answersFile, []);
    const item = answers.find((entry) => entry.id === answer && entry.demandId === id && entry.treeId === treeId &&
      entry.nodeId === nodeId && !entry.withdrawn);
    if (!item) return res.status(404).json({ ok: false, message: "这条回应目前不可访问。" });
    if (item.authorId === user.id) return res.status(403).json({ ok: false, message: "不能给自己的回应标记有帮助。" });
    if (req.get("If-Match") !== contentVersion(item.text)) {
      return res.status(409).json({ ok: false, code: "ANSWER_REVISION_CHANGED", message: "回应已更新，请核对后再标记。" });
    }
    const voters = new Set(item.helpfulBy || []);
    if (voters.has(user.id) !== helpful) {
      if (helpful) voters.add(user.id);
      else voters.delete(user.id);
      item.helpfulBy = [...voters];
      writeJsonFile(answersFile, answers);
    }
    return res.json({ ok: true, helpful, helpfulCount: voters.size });
  });

  route("put", demandPath + "/:id/answers/:answer/acceptance", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId, answer } = req.params;
    const { accepted } = req.body || {};
    if (typeof accepted !== "boolean") return res.status(400).json({ ok: false, message: "请选择是否采纳这条回应。" });
    const demand = readDemands().find((item) => item.id === id && item.treeId === treeId && item.nodeId === nodeId);
    if (demand?.ownerId !== user.id || demand.visibility !== "public" || !nodeFor(treeId, nodeId, { id: null })) {
      return res.status(404).json({ ok: false, message: "找不到你可以管理的公开需求。" });
    }
    const answers = readJsonFile(answersFile, []);
    const belongsToDemand = (item) => item.demandId === id && item.treeId === treeId && item.nodeId === nodeId;
    const target = answers.find((item) => belongsToDemand(item) && item.id === answer && !item.withdrawn);
    if (!target) return res.status(404).json({ ok: false, message: "这条回应目前不可采纳。" });
    const expected = req.get("If-Match");
    if (accepted && expected !== undefined && expected !== contentVersion(target.text)) {
      return res.status(409).json({ ok: false, code: "ANSWER_REVISION_CHANGED", message: "回应已更新，请核对后再采纳。" });
    }
    if (accepted) {
      for (const item of answers.filter(belongsToDemand)) delete item.accepted;
      target.accepted = true;
    } else delete target.accepted;
    writeJsonFile(answersFile, answers);
    return res.json({ ok: true });
  });
  route("post", demandPath, (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { treeId, nodeId } = req.params;
    const { visibility, product, requestId } = req.body || {};
    const text = demandText(req.body);
    if (!text) {
      return res.status(400).json({ ok: false, message: "请填写需求标题和描述。" });
    }
    const publish = visibility === "public";
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId))) {
      return res.status(400).json({ ok: false, message: "需求提交标识无效。" });
    }
    const id = requestId ? contentVersion([user.id, treeId, nodeId, requestId]).slice(0, 32) : nodeCrypto.randomBytes(16).toString("hex");
    const fingerprint = requestId ? contentVersion([text, publish, product ? [product.tutorial, product.version, product.material] : null]) : null;
    const items = readDemands();
    const existing = requestId && items.find((item) => item.id === id);
    if (existing) {
      const { submissionFingerprint, ...item } = existing;
      if (item.ownerId === user.id && item.treeId === treeId && item.nodeId === nodeId && submissionFingerprint === fingerprint) {
        return res.json({ ok: true, item });
      }
      return res.status(409).json({ ok: false, message: "这次需求提交已处理，请核对后再保存。" });
    }
    const node = nodeFor(treeId, nodeId, user);
    if (!node) return res.status(404).json({ ok: false, message: "找不到可访问的目标节点。" });
    if (publish && node.visibility === "private") return res.status(400).json({
      ok: false, code: "DEMAND_PUBLIC_NODE_REQUIRED", message: "私人节点上的需求只能保存为私人。"
    });
    const reference = demandProduct(product, treeId, nodeId, publish ? { id: null } : user);
    if (product && !reference) return res.status(400).json({ ok: false, message: "这个商品版本无法关联到当前需求。" });
    const item = { id, treeId, nodeId, ownerId: user.id, ...text,
      visibility: publish ? "public" : "private", product: reference, createdAt: new Date().toISOString() };
    items.push(fingerprint ? { ...item, submissionFingerprint: fingerprint } : item);
    writeJsonFile(demandsFile, items);
    return res.status(201).json({ ok: true, item });
  });
  route("patch", demandPath + "/:id", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId } = req.params;
    const items = readDemands();
    const item = items.find((entry) => entry.id === id && entry.treeId === treeId && entry.nodeId === nodeId && entry.ownerId === user.id);
    if (!item) return res.status(404).json({ ok: false, message: "找不到你可以编辑的需求。" });
    const revision = contentVersion(item);
    if (req.get("If-Match") !== revision) {
      return res.status(409).json({
        ok: false, code: "DEMAND_EDIT_CONFLICT", message: "需求已在另一窗口更新，请对照新版后再保存。",
        current: { title: item.title, body: item.body, visibility: item.visibility, revision }
      });
    }
    const text = demandText(req.body);
    if (!text) return res.status(400).json({ ok: false, message: "请填写需求标题和描述。" });
    Object.assign(item, text);
    writeJsonFile(demandsFile, items);
    return res.json({ ok: true });
  });
  route("put", demandPath + "/:id/product", (req, res, user) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { id, treeId, nodeId } = req.params;
    const items = readDemands();
    const item = items.find((entry) => entry.id === id && entry.treeId === treeId && entry.nodeId === nodeId && entry.ownerId === user.id);
    if (!item || !nodeFor(treeId, nodeId, user)) return res.status(404).json({ ok: false, message: "找不到可以关联的需求。" });
    const reference = demandProduct(req.body, treeId, nodeId, item.visibility === "public" ? { id: null } : user);
    if (!reference) return res.status(400).json({ ok: false, message: "这个商品版本无法关联到当前需求。" });
    if (item.product) {
      const matches = Object.keys(reference).every((key) => reference[key] === item.product[key]);
      if (!matches) return res.status(409).json({ ok: false, message: "这条需求已关联商品，原关联已保留。" });
      return res.json({ ok: true, item });
    }
    item.product = reference;
    writeJsonFile(demandsFile, items);
    return res.json({ ok: true, item });
  });
  for (const action of ["publish", "withdraw"]) {
    route("post", demandPath + "/:id/" + action, (req, res, user) => {
      if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
      const { id, treeId, nodeId } = req.params;
      const items = readDemands();
      const item = items.find((entry) => entry.id === id && entry.treeId === treeId && entry.nodeId === nodeId && entry.ownerId === user.id);
      if (!item) return res.status(404).json({ ok: false, message: "找不到你可以管理的需求。" });
      if (action === "publish") {
        const expected = req.get("If-Match");
        if (item.visibility !== "public" && expected !== undefined && expected !== contentVersion(item)) {
          return res.status(409).json({ ok: false, code: "DEMAND_REVISION_CHANGED", message: "需求已更新，请核对后再公开。" });
        }
        const visitor = { id: null };
        if (!nodeFor(treeId, nodeId, visitor)) return res.status(409).json({ ok: false, message: "请先公开对应知识树和节点，再公开需求。" });
        if (item.product && !demandProduct(item.product, treeId, nodeId, visitor)) {
          return res.status(409).json({ ok: false, message: "关联的商品或教程版本目前不可公开访问，需求仍保留在原有状态。" });
        }
      }
      const visibility = action === "publish" ? "public" : "private";
      if (item.visibility !== visibility) {
        item.visibility = visibility;
        writeJsonFile(demandsFile, items);
      }
      return res.json({ ok: true });
    });
  }

  const readWants = () => readProductWants(readJsonFile, wantsFile);
  route("get", "/api/product-wants", (_req, res, user) => {
    const wants = readWants().filter((item) => item.ownerId === user.id);
    const tutorials = wants.length ? read() : [];
    const items = wants.map((item) => {
      const source = tutorialVersion(item.tutorial, item.version, user, tutorials);
      return { ...item, productAvailable: source?.resources?.[Number(item.material)]?.affiliate === true };
    });
    return res.json({ ok: true, ownerId: user.id, items });
  });

  const productWantsPath = "/api/product-wants/:id/:version/:material";
  function productWant(method, handler) {
    route(method, productWantsPath, (req, res, user) => {
      const { id, version, material } = req.params;
      if (!validMaterialIndex(material)) return res.status(404).json({ ok: false });
      const items = readWants();
      const matches = (item) => item.tutorial === id && item.version === version && item.material === material;
      const own = items.find((item) => matches(item) && item.ownerId === user.id);
      const publicProduct = tutorialVersion(id, version, { id: null })?.resources?.[Number(material)]?.affiliate === true;
      const product = tutorialVersion(id, version, user)?.resources?.[Number(material)];
      return handler({ req, res, user, items, matches, own, publicProduct, product });
    });
  }
  productWant("get", ({ res, user, items, matches, own, publicProduct, product }) => {
    if (!product?.affiliate) return res.status(404).json({ ok: false });
    const shared = publicProduct ? items.filter((item) => matches(item) && item.visibility === "public")
      .map(({ budgetCents }) => ({ budgetCents })) : [];
    return res.json({ ok: true, ownerId: user.id, own: own || null, shared, canPublish: publicProduct });
  });
  productWant("put", ({ req, res, user, items, own, publicProduct, product }) => {
    if (req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    const { action, budgetCents } = req.body || {};
    if (action === "retract" && own) {
      own.visibility = "private";
    } else if (!product?.affiliate) {
      return res.status(404).json({ ok: false, message: "关联商品目前不可访问。" });
    } else if (action === "save" && validBudget(budgetCents)) {
      const { id: tutorial, version, material } = req.params;
      if (own) Object.assign(own, { budgetCents, visibility: "private" });
      else items.push({ tutorial, version, material, ownerId: user.id, label: product.label, budgetCents, visibility: "private" });
    } else if (action === "publish" && own && publicProduct) {
      if (own.budgetCents !== budgetCents) return res.status(409).json({ ok: false, message: "预算已更新，请刷新并核对金额后再公开。" });
      own.visibility = "public";
    } else {
      return res.status(400).json({ ok: false, message: "请输入有效预算。只有可公开访问商品的已保存预算可以公开。" });
    }
    writeJsonFile(wantsFile, items);
    return res.json({ ok: true });
  });

  route("delete", "/api/tutorials/:id", (req, res, user) => {
    const account = req.get("X-Action-Account");
    if (account !== undefined && account !== user.id) {
      return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
    }
    const data = read();
    const tutorial = data.find((item) => item.id === req.params.id && item.authorId === user.id);
    if (!tutorial) return res.status(404).json({ ok: false, message: "没有找到你可以归档的方法。" });
    const version = req.get("If-Match");
    if (version !== undefined && version !== tutorial.version) {
      return res.status(409).json({ ok: false, code: "TUTORIAL_CONFLICT", message: "方法已有新版，请刷新并核对后再归档。" });
    }
    if (tutorial.archived) return res.json({ ok: true });
    tutorial.archived = true;
    writeJsonFile(file, data);
    return res.json({ ok: true }); // 归档后旧版本仍可供实践来源追溯。
  });

  route("get", "/api/holders", (req, res, user) => {
    const treeId = req.query.treeId;
    const nodeId = req.query.nodeId;
    const node = nodeFor(treeId, nodeId, user);
    if (!node) return res.status(404).json({ ok: false, message: "没有找到节点。" });
    const holders = node.ownership === "personal" ? [{ id: node.ownerId, name: node.ownerName }] : Array.from(new Map(readRecords(config).filter((record) => record.treeId === treeId && record.nodeId === nodeId && record.visibility !== "private" && record.lightUp === true).map((record) => [record.authorId, { id: record.authorId, name: record.authorName }])).values());
    return res.json({ ok: true, ownership: node.ownership || "group", holders, holderShareBps: 5000, settlement: "unconfigured" });
  });
}

module.exports = { installKnowledgeService, tutorialInput, contentVersion, PRODUCT_WANTS_FILE, readProductWants,
  KNOWLEDGE_DEMANDS_FILE, DEMAND_BOOKMARKS_FILE, readKnowledgeDemands, validMaterialIndex, validBudget };
