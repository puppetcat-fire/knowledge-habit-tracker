const path = require("node:path");
const nodeCrypto = require("node:crypto");

function installProfileService(app, config, hooks) {
  const { authenticate, readUsers, readJsonFile, writeJsonFile, readRecords, readCustomNodes, readAccountState, canAccessNode, canViewPractice, presentRecords } = hooks;
  const file = path.join(config.dataDir, "profiles.json");
  const read = () => { const data = readJsonFile(file, []); if (!Array.isArray(data)) throw new Error("个人资料文件损坏，停止写入。"); return data; };
  const revision = (userId, profile) => nodeCrypto.createHash("sha256").update(JSON.stringify([userId, profile])).digest("hex");
  app.get("/api/profiles/:id", (req, res) => {
    try {
      const viewer = authenticate(config, req);
      if (!viewer) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
      const user = readUsers(config).find((item) => item.id === req.params.id);
      if (!user) return res.status(404).json({ ok: false, message: "没有找到这个人。" });
      const own = user.id === viewer.id;
      const stored = read().find((item) => item.id === user.id) || null;
      const profile = stored && (own || stored.visibility === "public") ? stored : { id: user.id, tagline: "", about: "", focus: "", visibility: "private" };
      const visible = (item) => (own || item.visibility === "public") && canAccessNode(config, item.treeId, item.nodeId, own ? viewer : { id: null });
      const tutorialsData = readJsonFile(path.join(config.dataDir, "tutorials.json"), []);
      if (!Array.isArray(tutorialsData)) throw new Error("方法资料格式损坏。");
      const methods = tutorialsData.filter((item) => item.authorId === user.id && !item.archived && visible(item)).map(({ versions, ...item }) => { void versions; return item; });
      const records = readRecords(config).filter((item) => item.authorId === user.id && canViewPractice(item, viewer));
      const custom = readCustomNodes(config);
      const nodes = custom.nodes.filter((item) => item.ownerId === user.id && (own || item.visibility !== "private") && canAccessNode(config, item.treeId, item.id, viewer));
      const accountState = own ? readAccountState(config, user.id) : null;
      const events = accountState && Array.isArray(accountState.events) ? accountState.events : [];
      if (own) events.filter((event) => event.treeId && event.nodeId && !records.some((record) => record.eventId === event.id) && canAccessNode(config, event.treeId, event.nodeId, viewer)).forEach((event) => records.push({ id: `event-${event.id}`, eventOnly: true, eventId: event.id, treeId: event.treeId, nodeId: event.nodeId, text: [event.title, event.singleLog].filter(Boolean).join("\n"), images: [], createdAt: event.createdAt, visibility: "private", tutorialId: event.tutorialSnapshot?.id || null, tutorialVersion: event.tutorialSnapshot?.version || null, lightUp: Boolean(accountState.forest?.lightups?.some((item) => item.eventId === event.id && item.status === "confirmed")) }));
      const personal = nodes.map((node) => ({ treeId: node.treeId, nodeId: node.id, title: node.title, ownership: "personal" }));
      const shared = records.filter((record) => record.lightUp && record.visibility !== "private").filter((record) => !custom.nodes.some((node) => node.id === record.nodeId && node.ownership === "personal")).map((record) => ({ treeId: record.treeId, nodeId: record.nodeId, ownership: "group" }));
      const holdings = [...new Map(personal.concat(shared).map((item) => [`${item.treeId}:${item.nodeId}`, item])).values()];
      res.set("Cache-Control", "no-store");
      return res.json({ ok: true, user: { id: user.id, name: user.name }, own, profile, revision: own ? revision(user.id, stored) : null, methods, records: presentRecords(config, records, viewer), nodes, holdings, stats: { methods: methods.length, practices: records.length, holdings: holdings.length, ...(own ? { events: events.length, measuredMs: events.reduce((sum, event) => sum + (Number.isFinite(event.durationMs) && event.durationMs > 0 ? event.durationMs : 0), 0), habit: accountState?.habit?.active ? accountState.habit.name : null } : {}) } });
    } catch (error) { console.error(error); return res.status(500).json({ ok: false, message: "个人主页读取失败，原资料已保留。" }); }
  });
  app.patch("/api/profile", (req, res) => {
    try {
      const user = authenticate(config, req);
      if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
      const data = read();
      const old = data.find((item) => item.id === user.id) || null;
      if (req.get("If-Match") !== revision(user.id, old)) return res.status(409).json({ ok: false, message: "账号或个人资料已变化，请重新打开主页后再修改。" });
      const body = req.body || {};
      if (Object.entries({ tagline: 120, about: 1600, focus: 120 }).some(([key, limit]) => body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > limit)) || !["private", "public"].includes(body.visibility)) return res.status(400).json({ ok: false, message: "请检查个人资料长度与公开设置。" });
      const profile = { id: user.id, tagline: (body.tagline || "").trim(), about: (body.about || "").trim(), focus: (body.focus || "").trim(), visibility: body.visibility, updatedAt: new Date().toISOString() };
      writeJsonFile(file, data.filter((item) => item.id !== user.id).concat(profile));
      return res.json({ ok: true, profile, revision: revision(user.id, profile) });
    } catch (error) { console.error(error); return res.status(500).json({ ok: false, message: "个人资料保存失败，请保留输入重试。" }); }
  });
}
module.exports = { installProfileService };
