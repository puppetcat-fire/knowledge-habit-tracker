const path = require("node:path");
const { createHash } = require("node:crypto");
const INBOX_PAGE_SIZE = 20;
const validPage = (value) => typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value);

function pageOf(items, page) {
  const lastPage = Math.max(1, Math.ceil(items.length / INBOX_PAGE_SIZE));
  const currentPage = Math.min(Number(page), lastPage);
  return { items: items.slice((currentPage - 1) * INBOX_PAGE_SIZE, currentPage * INBOX_PAGE_SIZE),
    page: currentPage, hasNext: currentPage < lastPage };
}

function installPracticeDiscussion(app, config, hooks) {
  const { authenticate, readJsonFile, writeJsonFile, readRecords, discoverablePractice } = hooks;
  const file = path.join(config.dataDir, "practice-discussion.json");
  const endpoint = "/api/records/:id/discussion";

  function isRecipient(comment, userId, record, parent) {
    if (comment.withdrawn || comment.authorId === userId) return false;
    if (!comment.parentId) return record?.authorId === userId;
    return parent?.authorId === userId && parent.recordId === comment.recordId && !parent.withdrawn;
  }

  function route(method, url, handler, requiresPublic = true) {
    app[method](url, (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      const user = authenticate(config, req);
      if (!user) return res.status(401).json({ ok: false, message: "请先登录。" });
      if (method !== "get" && req.get("X-Action-Account") !== user.id) {
        return res.status(409).json({ ok: false, message: "账号已变化，请刷新页面。" });
      }
      try {
        const needsRecord = requiresPublic && req.params.id;
        const record = needsRecord ? readRecords(config).find((item) => item.id === req.params.id) : null;
        if (needsRecord && !discoverablePractice(record)) {
          return res.status(404).json({ ok: false, message: "这条实践的讨论目前不可访问。" });
        }
        const items = readJsonFile(file, []);
        if (!Array.isArray(items)) throw new Error("实践讨论文件格式损坏。");
        return handler(req, res, user, items, record);
      } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: "暂时无法读取或保存留言，请重试。" });
      }
    });
  }

  route("get", "/api/practice-comments/mine", (req, res, user, items) => {
    const { page = "1" } = req.query;
    if (!validPage(page)) return res.status(400).json({ ok: false, message: "留言页码无效。" });
    const { items: pageItems, ...pagination } = pageOf(items.filter((item) => item.authorId === user.id && !item.withdrawn).reverse(), page);
    const records = new Map(readRecords(config).map((record) => [record.id, record]));
    const availability = new Map();
    const comments = pageItems
      .map(({ id, recordId, text, createdAt }) => {
        if (!availability.has(recordId)) availability.set(recordId, Boolean(discoverablePractice(records.get(recordId))));
        return { id, recordId, text, createdAt, available: availability.get(recordId), deleted: !records.has(recordId) };
      });
    return res.json({ ok: true, ownerId: user.id, comments, ...pagination });
  });

  route("get", "/api/practice-replies", (req, res, user, items) => {
    const { scope = "all", page = "1" } = req.query;
    if (!["all", "unread"].includes(scope) || !validPage(page)) {
      return res.status(400).json({ ok: false, message: "回复筛选或页码无效。" });
    }
    const parents = new Map(items.filter((item) => item.authorId === user.id && !item.withdrawn).map((item) => [item.id, item]));
    const records = new Map(readRecords(config).map((record) => [record.id, record]));
    const available = new Map();
    const replies = [];
    const summaryOnly = req.query.summary === "1";
    let unreadCount = 0;
    for (const item of items.slice().reverse()) {
      if (!isRecipient(item, user.id, records.get(item.recordId), parents.get(item.parentId))) continue;
      if (!available.has(item.recordId)) available.set(item.recordId, discoverablePractice(records.get(item.recordId)));
      if (!available.get(item.recordId)) continue;
      if (!item.readAt) unreadCount += 1;
      if (summaryOnly || (scope === "unread" && item.readAt)) continue;
      const { id, recordId, authorName, text, createdAt, readAt } = item;
      replies.push({ id, recordId, authorName, text, createdAt, unread: !readAt, kind: item.parentId ? "reply" : "comment" });
    }
    if (summaryOnly) return res.json({ ok: true, ownerId: user.id, unreadCount });
    const { items: pageItems, ...pagination } = pageOf(replies, page);
    return res.json({ ok: true, ownerId: user.id, replies: pageItems, ...pagination });
  });

  route("post", "/api/practice-replies/read-page", (req, res, user, items) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > INBOX_PAGE_SIZE ||
        ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))) {
      return res.status(400).json({ ok: false, message: "请选择本页的未读消息。" });
    }
    const comments = new Map(items.map((item) => [item.id, item]));
    const records = new Map(readRecords(config).map((record) => [record.id, record]));
    const readAt = new Date().toISOString();
    let changed = false;
    for (const id of new Set(ids)) {
      const comment = comments.get(id);
      if (!comment || comment.readAt) continue;
      const record = records.get(comment.recordId);
      if (!isRecipient(comment, user.id, record, comments.get(comment.parentId)) || !discoverablePractice(record)) continue;
      comment.readAt = readAt;
      changed = true;
    }
    if (changed) writeJsonFile(file, items);
    return res.json({ ok: true });
  });

  route("post", endpoint + "/:comment/read", (req, res, user, items, record) => {
    const reply = items.find((item) => item.recordId === req.params.id && item.id === req.params.comment && !item.withdrawn);
    const parent = reply?.parentId && items.find((item) => item.id === reply.parentId);
    if (!reply || !isRecipient(reply, user.id, record, parent)) return res.status(404).json({ ok: false });
    if (!reply.readAt) {
      reply.readAt = new Date().toISOString();
      writeJsonFile(file, items);
    }
    return res.json({ ok: true });
  });

  route("get", endpoint, (req, res, user, items, record) => {
    const { before, after, around, replyTarget } = req.query;
    if ([before, after, around, replyTarget].some((id) => id !== undefined && (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))) ||
      [before, after, around].filter(Boolean).length > 1) return res.status(400).json({ ok: false, message: "留言分页参数无效。" });
    const thread = items.filter((item) => item.recordId === req.params.id);
    const visible = thread.filter((item) => !item.withdrawn);
    const sources = new Map(visible.map((item) => [item.id, item]));
    const order = new Map(thread.map((item, index) => [item.id, index]));
    const cursor = order.get(before || after);
    const anchor = visible.findIndex((item) => item.id === around);
    const limit = 20;
    let start = Math.max(0, visible.length - limit);
    let end = visible.length;
    if (before && cursor !== undefined) {
      end = visible.filter((item) => order.get(item.id) < cursor).length;
      start = Math.max(0, end - limit);
    } else if (after && cursor !== undefined) {
      start = visible.filter((item) => order.get(item.id) <= cursor).length;
      end = start + limit;
    } else if (anchor >= 0) {
      start = Math.min(start, Math.max(0, anchor - Math.floor(limit / 2)));
      end = start + limit;
    }
    if (end === 0) {
      // All comments before a saved cursor may have been withdrawn.
      end = Math.min(limit, visible.length);
    } else if (start === visible.length) {
      start = Math.max(0, visible.length - limit);
      end = visible.length;
    }
    const comments = visible.slice(start, end).map(({ id, authorId, authorName, text, createdAt, parentId }) => {
      const parent = sources.get(parentId);
      return { id, authorId, authorName, text, createdAt, own: authorId === user.id,
        received: isRecipient({ authorId, parentId, recordId: record.id }, user.id, record, parent),
        replyTo: parentId ? { id: parentId, authorName: parent?.authorName || null } : null };
    });
    return res.json({ ok: true, ownerId: user.id, comments, older: start > 0 ? comments[0]?.id : null,
      newer: end < visible.length ? comments.at(-1)?.id : null, replyTargetAvailable: sources.has(replyTarget) });
  });

  route("post", endpoint, (req, res, user, items) => {
    const { text, requestId, parentId = null } = req.body || {};
    if (typeof text !== "string" || !text.trim() || text.length > 1000 ||
      typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
      return res.status(400).json({ ok: false, message: "请输入 1 到 1000 字的留言。" });
    }
    const recordId = req.params.id;
    const id = createHash("sha256").update(JSON.stringify([recordId, user.id, requestId])).digest("hex").slice(0, 32);
    const previous = items.find((item) => item.id === id);
    if (previous) {
      if (previous.withdrawn || previous.text !== text.trim() || (previous.parentId || null) !== parentId) {
        return res.status(409).json({ ok: false, message: "这次提交已处理，请刷新讨论后重试。" });
      }
      return res.json({ ok: true });
    }
    if (parentId !== null && !items.some((item) => item.id === parentId && item.recordId === recordId && !item.withdrawn)) {
      return res.status(409).json({ ok: false, message: "原留言目前不可回复。草稿仍可作为新留言发布。" });
    }
    items.push({ id, recordId, parentId, authorId: user.id, authorName: user.name, text: text.trim(), createdAt: new Date().toISOString() });
    writeJsonFile(file, items);
    return res.status(201).json({ ok: true });
  });

  route("post", endpoint + "/:comment/withdraw", (req, res, user, items) => {
    const comment = items.find((item) => item.recordId === req.params.id && item.id === req.params.comment && item.authorId === user.id);
    if (!comment) return res.status(404).json({ ok: false, message: "找不到你可以撤回的留言。" });
    if (!comment.withdrawn) {
      comment.withdrawn = true;
      delete comment.text;
      writeJsonFile(file, items);
    }
    return res.json({ ok: true });
  }, false);
}

module.exports = { installPracticeDiscussion };
