const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { commitTransaction } = require("./storage-transaction");
const { tutorialInput, contentVersion, PRODUCT_WANTS_FILE, readProductWants, KNOWLEDGE_DEMANDS_FILE,
  readKnowledgeDemands, DEMAND_BOOKMARKS_FILE, validMaterialIndex, validBudget } = require("./knowledge-service");
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function installArchiveService(app, config, hooks) {
  const { authenticate, readJsonFile, readAccountState, readCustomNodes, readRecords, stateRevision,
    practiceBookmarksFile, readPracticeBookmarks } = hooks;
  const tutorialFile = path.join(config.dataDir, "tutorials.json");
  const profilesPath = path.join(config.dataDir, "profiles.json");
  const wantsFile = path.join(config.dataDir, PRODUCT_WANTS_FILE);
  const readWants = () => readProductWants(readJsonFile, wantsFile);
  const demandsFile = path.join(config.dataDir, KNOWLEDGE_DEMANDS_FILE);
  const readDemands = () => readKnowledgeDemands(readJsonFile, demandsFile);
  const demandBookmarksFile = path.join(config.dataDir, DEMAND_BOOKMARKS_FILE);
  const readDemandBookmarks = () => readJsonFile(demandBookmarksFile, []);
  const demandBookmarkKey = ({ treeId, nodeId, demandId }) => JSON.stringify([treeId, nodeId, demandId]);
  function knowledgeRevision(userId) {
    const custom = readCustomNodes(config);
    const nodes = custom.nodes.filter((item) => item.ownerId === userId);
    const nodeIds = new Set(nodes.map((item) => item.id));
    const snapshot = [
      nodes,
      custom.trees.filter((item) => item.ownerId === userId),
      custom.edges.filter((edge) => nodeIds.has(edge.from) || nodeIds.has(edge.to)),
      readJsonFile(tutorialFile, []).filter((item) => item.authorId === userId),
      readRecords(config).filter((item) => item.authorId === userId),
      readJsonFile(profilesPath, []).find((item) => item.id === userId) || null,
      readWants().filter((item) => item.ownerId === userId),
      readDemands().filter((item) => item.ownerId === userId),
      readPracticeBookmarks().filter((item) => item.ownerId === userId),
      readDemandBookmarks().filter((item) => item.ownerId === userId)
    ];
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }

  app.get("/api/account/import-revision", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const user = authenticate(config, req);
      if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
      return res.json({ ok: true, ownerId: user.id, revision: knowledgeRevision(user.id) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, message: "暂时无法核对知识数据版本。" });
    }
  });
  app.get("/api/account/export", (req, res) => {
    try {
      const user = authenticate(config, req);
      if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
      const custom = readCustomNodes(config);
      const nodes = custom.nodes.filter((node) => node.ownerId === user.id);
      const ownIds = new Set(nodes.map((node) => node.id));
      const methods = readJsonFile(tutorialFile, []);
      if (!Array.isArray(methods)) throw new Error("方法数据格式损坏。");
      const records = readRecords(config).filter((record) => record.authorId === user.id).map((record) => ({ ...record, images: record.images.map((image) => {
        if (!/^[0-9a-f]+$/i.test(image.id)) throw new Error("图片标识损坏，停止导出。");
        return { ...image, dataUrl: `data:${image.mediaType};base64,${fs.readFileSync(path.join(config.mediaDir, image.id)).toString("base64")}` };
      }) }));
      const profiles = readJsonFile(path.join(config.dataDir, "profiles.json"), []);
      if (!Array.isArray(profiles)) throw new Error("个人资料文件损坏。");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", "attachment; filename=knowledge-account-backup.json");
      return res.json({ format: "kht-account-archive/v1", exportedAt: new Date().toISOString(), account: { id: user.id, name: user.name }, profile: profiles.find((item) => item.id === user.id) || null, state: readAccountState(config, user.id), nodes, edges: custom.edges.filter((edge) => ownIds.has(edge.from) || ownIds.has(edge.to)), trees: custom.trees.filter((tree) => tree.ownerId === user.id), tutorials: methods.filter((tutorial) => tutorial.authorId === user.id), records, productWants: readWants().filter((item) => item.ownerId === user.id), knowledgeDemands: readDemands().filter((item) => item.ownerId === user.id),
        practiceBookmarks: readPracticeBookmarks().filter((item) => item.ownerId === user.id).map((item) => item.recordId),
        demandBookmarks: readDemandBookmarks().filter((item) => item.ownerId === user.id)
          .map(({ treeId, nodeId, demandId }) => ({ treeId, nodeId, demandId })) });
    } catch (error) { console.error(error); return res.status(500).json({ ok: false, message: "完整备份导出失败，原数据已保留，请重试。" }); }
  });

  app.post("/api/account/import", (req, res) => {
    try {
      const user = authenticate(config, req);
      if (!user) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED" });
      if (req.get("X-Action-Account") && req.get("X-Action-Account") !== user.id) return res.status(409).json({ ok: false, code: "ACTION_ACCOUNT_CHANGED", message: "账号已变化，请在当前账号重新选择备份。" });
      const expected = req.get("If-Match");
      if (expected && expected !== stateRevision(readAccountState(config, user.id))) {
        return res.status(409).json({ ok: false, code: "STATE_CONFLICT", message: "另一窗口已保存新的账号记录。请先重新读取账号状态，再确认恢复。" });
      }
      const expectedKnowledge = req.get("X-Knowledge-Revision");
      if (expectedKnowledge && expectedKnowledge !== knowledgeRevision(user.id)) {
        return res.status(409).json({ ok: false, code: "KNOWLEDGE_CONFLICT", message: "选择备份后，当前账号的知识内容、需求、个人资料、收藏或想要清单有更新。请先查看更新，再重新选择备份。" });
      }
      const archive = req.body;
      if (!archive || archive.format !== "kht-account-archive/v1" || !["nodes", "edges", "trees", "tutorials", "records"].every((key) => Array.isArray(archive[key]))) return res.status(400).json({ ok: false, message: "请选择完整的账户备份，普通习惯 JSON 仍从习惯页导入。" });
      if (["nodes", "trees", "tutorials", "records"].some((key) => archive[key].some((item) => !item || !ID.test(item.id)) || new Set(archive[key].map((item) => item.id)).size !== archive[key].length)) return res.status(400).json({ ok: false, message: "备份内容标识不合法或重复，当前账户未改变。" });
      const state = archive.state === undefined ? null : JSON.parse(JSON.stringify(archive.state));
      const profile = archive.profile;
      if (profile && Object.entries({ tagline: 120, about: 1600, focus: 120 }).some(([key, limit]) => typeof profile[key] !== "string" || profile[key].length > limit)) return res.status(400).json({ ok: false, message: "个人资料格式不合法。" });
      if (state !== null && (!state || !Number.isInteger(state.version) || state.version < 1 || state.version > 3 || (state.events !== undefined && (!Array.isArray(state.events) || state.events.length > 100000 || state.events.some((event) => !event || typeof event.title !== "string" || !Number.isFinite(Date.parse(event.createdAt))))))) return res.status(400).json({ ok: false, message: "备份里的事件或版本不合法，请检查文件；当前账户未改变。" });
      const custom = readCustomNodes(config);
      const methods = readJsonFile(tutorialFile, []);
      const records = readRecords(config);
      if (!Array.isArray(methods)) throw new Error("方法数据格式损坏。");
      const collision = (incoming, existing, ownerKey) => incoming.some((item) => !item || !ID.test(item.id) || existing.some((old) => old.id === item.id && old[ownerKey] !== user.id));
      if (collision(archive.nodes, custom.nodes, "ownerId") || collision(archive.trees, custom.trees, "ownerId") || collision(archive.tutorials, methods, "authorId") || collision(archive.records, records, "authorId")) return res.status(409).json({ ok: false, message: "备份标识与另一账户的内容冲突，已停止导入；不会覆盖别人。" });
      const trees = archive.trees.map((tree) => {
        if (typeof tree.name !== "string" || !tree.name.trim() || tree.name.length > 40 || tree.id === "k9-math") throw new Error("知识树格式不合法。");
        return { ...tree, ownerId: user.id, ownerName: user.name, visibility: "private" };
      });
      const knownTrees = new Set(["k9-math", ...custom.trees.filter((tree) => tree.visibility === "public" || tree.ownerId === user.id).map((tree) => tree.id), ...trees.map((tree) => tree.id)]);
      const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-trees", "k9-math.json"), "utf8"));
      const nodes = archive.nodes.map((node) => {
        if (seed.nodes.some((item) => item.id === node.id) || !knownTrees.has(node.treeId) || typeof node.title !== "string" || !node.title || node.title.length > 40 || typeof node.goal !== "string" || !node.goal || node.goal.length > 200 || !Number.isInteger(node.estMinutes) || node.estMinutes < 5 || node.estMinutes > 15) throw new Error("备份里的节点格式不合法。");
        return { ...node, ownership: "personal", ownerId: user.id, ownerName: user.name, visibility: "private" };
      });
      const nodeIds = new Set([...seed.nodes.map((node) => node.id), ...custom.nodes.map((node) => node.id), ...nodes.map((node) => node.id)]);
      const ownNodeIds = new Set(nodes.map((node) => node.id));
      const edges = archive.edges.map((edge) => {
        if (!edge || !ID.test(edge.from) || !ID.test(edge.to) || !["prereq", "instance-of"].includes(edge.type) || (!ownNodeIds.has(edge.from) && !ownNodeIds.has(edge.to))) throw new Error("边类型或归属不合法。");
        return { from: edge.from, to: edge.to, type: edge.type };
      });
      const versionAliases = new Map();
      const existingTutorials = new Map(methods.filter((item) => item.authorId === user.id).map((item) => [item.id, item]));
      const tutorials = archive.tutorials.map((tutorial) => {
        if (!knownTrees.has(tutorial.treeId) || !nodeIds.has(tutorial.nodeId) || !Array.isArray(tutorial.versions)) throw new Error("方法缺少目标或版本历史。");
        const existing = existingTutorials.get(tutorial.id);
        if (existing && (existing.treeId !== tutorial.treeId || existing.nodeId !== tutorial.nodeId)) throw new Error("同一方法的知识目标与当前记录不一致。");
        const content = tutorialInput({ ...tutorial, visibility: "private" });
        const versions = new Map(tutorial.versions.map((version) => {
          const normalized = tutorialInput(version);
          const hash = contentVersion(normalized);
          if (hash !== version.version && archive.mode !== "local") throw new Error("方法历史版本校验失败。");
          versionAliases.set(`${tutorial.id}::${version.version}`, hash);
          return [hash, { ...normalized, version: hash, createdAt: version.createdAt }];
        }));
        for (const item of existing?.versions || []) versions.set(item.version, item);
        const version = contentVersion(content);
        if (!versions.has(version)) versions.set(version, { ...content, version, createdAt: new Date().toISOString() });
        return { ...tutorial, ...content, version, versions: [...versions.values()], authorId: user.id, authorName: user.name };
      });
      const remapSnapshot = (snapshot) => {
        if (snapshot && versionAliases.has(`${snapshot.id}::${snapshot.version}`)) snapshot.version = versionAliases.get(`${snapshot.id}::${snapshot.version}`);
      };
      const restoredWants = new Map();
      if (archive.productWants !== undefined) {
        if (!Array.isArray(archive.productWants)) throw new Error("备份里的想要清单格式不合法。");
        for (const item of archive.productWants) {
          if (!item || typeof item.tutorial !== "string" || !ID.test(item.tutorial) || typeof item.version !== "string" || !ID.test(item.version) ||
            !validMaterialIndex(item.material) || !validBudget(item.budgetCents) || typeof item.label !== "string" || !item.label.trim() || item.label.length > 80) {
            throw new Error("备份里的商品或预算格式不合法。");
          }
          const version = versionAliases.get(`${item.tutorial}::${item.version}`) || item.version;
          const key = `${item.tutorial}:${version}:${item.material}`;
          if (restoredWants.has(key)) throw new Error("备份里有重复的商品预算。");
          restoredWants.set(key, { tutorial: item.tutorial, version, material: item.material, label: item.label, budgetCents: item.budgetCents, ownerId: user.id, visibility: "private" });
        }
      }
      const nextWants = restoredWants.size ? readWants().filter((item) =>
        item.ownerId !== user.id || !restoredWants.has(`${item.tutorial}:${item.version}:${item.material}`)
      ).concat([...restoredWants.values()]) : null;
      const restoredDemands = new Map();
      const validId = (value) => typeof value === "string" && ID.test(value);
      const demandBookmarks = archive.demandBookmarks === undefined ? [] : archive.demandBookmarks;
      if (!Array.isArray(demandBookmarks) ||
          !demandBookmarks.every((item) => item && [item.treeId, item.nodeId, item.demandId].every(validId)) ||
          new Set(demandBookmarks.map(demandBookmarkKey)).size !== demandBookmarks.length) {
        throw new Error("备份里的需求收藏格式不合法或标识重复。");
      }
      const restoredDemandBookmarks = new Set(demandBookmarks.map(demandBookmarkKey));
      const nextDemandBookmarks = demandBookmarks.length ? readDemandBookmarks()
        .filter((item) => item.ownerId !== user.id || !restoredDemandBookmarks.has(demandBookmarkKey(item)))
        .concat(demandBookmarks.map(({ treeId, nodeId, demandId }) => ({ ownerId: user.id, treeId, nodeId, demandId }))) : null;
      const bookmarkIds = archive.practiceBookmarks === undefined ? [] : archive.practiceBookmarks;
      if (!Array.isArray(bookmarkIds) || !bookmarkIds.every(validId) || new Set(bookmarkIds).size !== bookmarkIds.length) {
        throw new Error("备份里的实践收藏格式不合法或标识重复。");
      }
      const restoredBookmarkIds = new Set(bookmarkIds);
      const nextBookmarks = bookmarkIds.length ? bookmarkIds.map((recordId) => ({ ownerId: user.id, recordId })).concat(
        readPracticeBookmarks().filter((item) => item.ownerId !== user.id || !restoredBookmarkIds.has(item.recordId))
      ) : null;
      if (archive.knowledgeDemands !== undefined) {
        if (!Array.isArray(archive.knowledgeDemands)) throw new Error("备份里的需求列表格式不合法。");
        for (const item of archive.knowledgeDemands) {
          if (!item || !validId(item.id) || !validId(item.treeId) || !validId(item.nodeId) ||
            typeof item.title !== "string" || !item.title.trim() || item.title.length > 80 ||
            typeof item.body !== "string" || !item.body.trim() || item.body.length > 2000 ||
            typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) || restoredDemands.has(item.id)) {
            throw new Error("备份里的需求格式不合法或标识重复。");
          }
          let product = null;
          if (item.product != null) {
            const { tutorial, version, material } = item.product;
            if (!validId(tutorial) || !validId(version) || !validMaterialIndex(material)) throw new Error("备份里的需求商品引用不合法。");
            product = { tutorial, version: versionAliases.get(`${tutorial}::${version}`) || version, material };
          }
          restoredDemands.set(item.id, { id: item.id, treeId: item.treeId, nodeId: item.nodeId, title: item.title,
            body: item.body, createdAt: item.createdAt, product, ownerId: user.id, visibility: "private",
            ...(item.answersClosed === true ? { answersClosed: true } : {}) });
        }
      }
      const demands = restoredDemands.size ? readDemands() : [];
      if (demands.some((item) => restoredDemands.has(item.id) && item.ownerId !== user.id)) {
        return res.status(409).json({ ok: false, message: "备份需求标识与另一账号冲突，已停止恢复。" });
      }
      if (state) {
        (state.events || []).forEach((event) => remapSnapshot(event.tutorialSnapshot));
        if (state.forest) {
          remapSnapshot(state.forest.selectedTutorial);
          (state.forest.lightups || []).forEach((item) => remapSnapshot(item.tutorialSnapshot));
        }
        if (state.timer && state.timer.practiceContext) remapSnapshot(state.timer.practiceContext.tutorialSnapshot);
      }
      const media = new Map();
      const foreignImageIds = new Set(records.filter(record => record.authorId !== user.id)
        .flatMap(record => record.images.map(image => image.id.toLowerCase())));
      const restoredRecords = archive.records.map((record) => {
        if (!ID.test(record.treeId) || !ID.test(record.nodeId) || typeof record.text !== "string" || !Array.isArray(record.images) || record.images.length > 4) throw new Error("实践记录格式不合法。");
        const imageResult = hooks.normalizeImages(record.images);
        if (!imageResult.ok) throw new Error(imageResult.message);
        const images = imageResult.value.map((image, index) => {
          const original = record.images[index];
          if (!/^[0-9a-f]{32}$/i.test(original.id)) throw new Error("图片标识不合法。");
          const originalId = original.id.toLowerCase();
          const originalPath = path.join(config.mediaDir, original.id);
          if (fs.existsSync(originalPath) && !fs.readFileSync(originalPath).equals(image.buffer)) throw new Error("图片标识冲突，停止恢复。");
          const id = foreignImageIds.has(originalId)
            ? createHash("sha256").update(JSON.stringify(["restored-image", user.id, originalId])).digest("hex").slice(0, 32)
            : originalId;
          const filePath = path.join(config.mediaDir, id);
          const previous = media.get(filePath) || (fs.existsSync(filePath) ? fs.readFileSync(filePath) : null);
          if (foreignImageIds.has(id) || (previous && !previous.equals(image.buffer))) throw new Error("图片标识冲突，停止恢复。");
          media.set(filePath, image.buffer);
          return { id, mediaType: image.mediaType };
        });
        return { ...record, tutorialVersion: versionAliases.get(`${record.tutorialId}::${record.tutorialVersion}`) || record.tutorialVersion, authorId: user.id, authorName: user.name, images, visibility: "private" };
      });
      // 所有验证先完成；媒体只追加，不覆盖已有文件。主数据用可重放事务恢复。
      fs.mkdirSync(config.mediaDir, { recursive: true });
      for (const [filePath, buffer] of media) {
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer, { flag: "wx" });
      }
      const merge = (existing, incoming) => existing.filter((item) => !incoming.some((next) => next.id === item.id)).concat(incoming);
      // 恢复自己节点时不能删除其他使用者后来添加的连接。
      const edgeMap = new Map(custom.edges.concat(edges).map((edge) => [`${edge.type}:${edge.from}:${edge.to}`, edge]));
      const nextCustom = { nodes: merge(custom.nodes, nodes), trees: merge(custom.trees, trees), edges: [...edgeMap.values()] };
      const profiles = readJsonFile(profilesPath, []);
      if (!Array.isArray(profiles)) throw new Error("个人资料文件损坏。");
      commitTransaction(config.dataDir, [
        { filePath: path.join(config.statesDir, `${user.id}.json`), value: state },
        { filePath: config.customNodesPath, value: nextCustom },
        { filePath: tutorialFile, value: merge(methods, tutorials) },
        { filePath: config.recordsPath, value: merge(records, restoredRecords) },
        ...(nextWants ? [{ filePath: wantsFile, value: nextWants }] : []),
        ...(restoredDemands.size ? [{ filePath: demandsFile, value: demands.filter((item) => !restoredDemands.has(item.id)).concat([...restoredDemands.values()]) }] : []),
        ...(nextBookmarks ? [{ filePath: practiceBookmarksFile, value: nextBookmarks }] : []),
        ...(nextDemandBookmarks ? [{ filePath: demandBookmarksFile, value: nextDemandBookmarks }] : []),
        ...(profile ? [{ filePath: profilesPath, value: profiles.filter((item) => item.id !== user.id).concat({ id: user.id, tagline: profile.tagline, about: profile.about, focus: profile.focus, visibility: "private", updatedAt: new Date().toISOString() }) }] : [])
      ]);
      return res.json({ ok: true, imported: { events: state && Array.isArray(state.events) ? state.events.length : 0, nodes: nodes.length, tutorials: tutorials.length, records: restoredRecords.length, productWants: restoredWants.size, knowledgeDemands: restoredDemands.size, practiceBookmarks: bookmarkIds.length, demandBookmarks: demandBookmarks.length }, message: "账户内容已恢复。导入的节点、方法、实践记录、需求和商品预算先作为私人内容保存，不会自动重新发布。" });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ ok: false, message: `恢复未完成：${error.message}。请保留备份和数据目录后重试。` });
    }
  });
}
module.exports = { installArchiveService };
