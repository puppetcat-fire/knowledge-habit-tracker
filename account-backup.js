(function accountBackup(root) {
  let incoming = null;
  let incomingOwner = null;
  let incomingKnowledgeRevision = null;
  let busy = false;
  const exportButton = document.getElementById("account-backup-export");
  const fileInput = document.getElementById("account-backup-file");
  const confirmButton = document.getElementById("account-backup-confirm");
  const status = document.getElementById("account-backup-status");
  if (!exportButton || !fileInput || !confirmButton || !status) return;
  const show = (message) => { status.textContent = message; status.classList.remove("hidden"); };
  const keys = ["knowledge-habit-tracker", "knowledge-habit-custom-nodes", "knowledge-habit-tutorials", "knowledge-habit-practice-records", "knowledge-habit-profile"];
  const journalKey = "knowledge-habit-restore-journal";
  // localStorage 没有多键事务。未完成恢复在刷新时回滚到恢复前的完整版本。
  try {
    const journal = JSON.parse(localStorage.getItem(journalKey) || "null");
    if (journal && Array.isArray(journal.before) && [4, 5].includes(journal.before.length)) {
      keys.slice(0, journal.before.length).forEach((key, index) => journal.before[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, journal.before[index]));
      localStorage.removeItem(journalKey);
      root.location.reload();
      return;
    }
  } catch { show("上次恢复未完成。请导出当前内容并保留原备份，检查浏览器存储空间后重试。"); }
  function restoreLocal(archive) {
    if (archive.productWants?.length || archive.knowledgeDemands?.length || archive.practiceBookmarks?.length || archive.demandBookmarks?.length) throw new Error("此备份含有账号知识数据，请登录后恢复完整账号备份。");
    if (!archive.state || !Number.isInteger(archive.state.version) || archive.state.version < 1 || archive.state.version > 3 || !Array.isArray(archive.state.events) || archive.state.events.some((event) => !event || typeof event.title !== "string" || !Number.isFinite(Date.parse(event.createdAt)))) throw new Error("备份里的习惯状态或事件格式不合法。");
    const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
    for (const name of ["nodes", "trees", "tutorials", "records"]) {
      if (archive[name].some((item) => !item || !validId(item.id)) || new Set(archive[name].map((item) => item.id)).size !== archive[name].length) throw new Error("备份标识不合法或重复，当前内容没有改变。");
    }
    if (archive.nodes.some((node) => !validId(node.treeId) || typeof node.title !== "string" || typeof node.goal !== "string" || !Number.isInteger(node.estMinutes) || node.estMinutes < 5 || node.estMinutes > 15) || archive.edges.some((edge) => !edge || !validId(edge.from) || !validId(edge.to) || !["prereq", "instance-of"].includes(edge.type)) || archive.trees.some((tree) => typeof tree.name !== "string") || archive.tutorials.some((method) => typeof method.title !== "string" || typeof method.method !== "string" || !Array.isArray(method.versions)) || archive.records.some((record) => typeof record.text !== "string" || !Array.isArray(record.images))) throw new Error("备份内容不完整，当前内容没有改变。");
    const privateItems = (items) => items.map((item) => ({ ...item, visibility: "private" }));
    const profile = archive.profile === undefined ? JSON.parse(localStorage.getItem("knowledge-habit-profile") || "null") : archive.profile;
    if (profile && Object.entries({ tagline: 120, about: 1600, focus: 120 }).some(([key, limit]) => typeof profile[key] !== "string" || profile[key].length > limit)) throw new Error("个人资料格式不合法，当前内容没有改变。");
    const values = [archive.state, { nodes: privateItems(archive.nodes), trees: privateItems(archive.trees), edges: archive.edges }, privateItems(archive.tutorials), privateItems(archive.records), profile ? { ...profile, visibility: "private" } : null].map((value) => JSON.stringify(value));
    const before = keys.map((key) => localStorage.getItem(key));
    localStorage.setItem(journalKey, JSON.stringify({ before }));
    try {
      keys.forEach((key, index) => localStorage.setItem(key, values[index]));
      localStorage.removeItem(journalKey);
    } catch {
      keys.forEach((key, index) => before[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, before[index]));
      localStorage.removeItem(journalKey);
      throw new Error("浏览器没有足够空间恢复，已保留原内容。请保留备份后重试。");
    }
  }
  function download(value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `点亮-完整账户备份-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exportButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true; exportButton.disabled = true;
    try {
      const context = root.KHTBackupContext;
      if (!context || !(await context.flush())) throw new Error("还有尚未保存的记录，请先重试保存或导出未保存记录。");
      if (context.localOnly) {
        const overlay = JSON.parse(localStorage.getItem("knowledge-habit-custom-nodes") || "{}");
        download({ format: "kht-account-archive/v1", mode: "local", exportedAt: new Date().toISOString(), profile: JSON.parse(localStorage.getItem("knowledge-habit-profile") || "null"), state: JSON.parse(localStorage.getItem("knowledge-habit-tracker") || "null"), nodes: overlay.nodes || [], edges: overlay.edges || [], trees: overlay.trees || [], tutorials: JSON.parse(localStorage.getItem("knowledge-habit-tutorials") || "[]"), records: JSON.parse(localStorage.getItem("knowledge-habit-practice-records") || "[]") });
      } else {
        const response = await fetch("/api/account/export", { credentials: "same-origin" });
        const data = await response.json();
        if (!response.ok || data.format !== "kht-account-archive/v1") throw new Error(data.message || "备份导出失败，请重试。");
        download(data);
      }
      show("完整备份已导出。文件包含私人记录与图片，请保存到自己的安全位置。");
    } catch (error) { show(error.message || "备份失败，原数据没有改变。"); }
    finally { busy = false; exportButton.disabled = false; }
  });
  fileInput.addEventListener("change", async () => {
    incoming = null; incomingOwner = null; incomingKnowledgeRevision = null; confirmButton.hidden = true;
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const context = root.KHTBackupContext;
    const owner = context?.ownerId;
    const isCurrent = () => fileInput.files?.[0] === file && root.KHTBackupContext?.ownerId === owner;
    try {
      const data = JSON.parse(await file.text());
      if (!isCurrent()) return;
      if (data.format !== "kht-account-archive/v1" || !["nodes", "trees", "edges", "tutorials", "records"].every((key) => Array.isArray(data[key]))) throw new Error("请选择完整账户备份；普通习惯备份仍从原来的习惯导入入口恢复。");
      if (context && !context.localOnly) {
        const response = await fetch("/api/account/import-revision", { credentials: "same-origin" });
        const snapshot = await response.json();
        if (!isCurrent()) return;
        if (!response.ok || !snapshot.revision) throw new Error(snapshot.message || "暂时无法核对知识数据版本。");
        if (snapshot.ownerId !== owner) throw new Error("账号已变化，请在当前账号重新选择备份。");
        incomingKnowledgeRevision = snapshot.revision;
      }
      incoming = data;
      incomingOwner = owner;
      const wantsCount = Array.isArray(data.productWants) ? `、${data.productWants.length} 条商品预算` : "";
      const demandsCount = Array.isArray(data.knowledgeDemands) ? `、${data.knowledgeDemands.length} 条需求` : "";
      const bookmarkCount = Array.isArray(data.practiceBookmarks) ? `、${data.practiceBookmarks.length} 条实践收藏` : "";
      const demandBookmarkCount = Array.isArray(data.demandBookmarks) ? `、${data.demandBookmarks.length} 条需求收藏` : "";
      show(`待恢复：${data.state && Array.isArray(data.state.events) ? data.state.events.length : 0} 条事件、${data.trees.length} 棵树、${data.nodes.length} 个节点、${data.tutorials.length} 份方法、${data.records.length} 条实践${wantsCount}${demandsCount}${bookmarkCount}${demandBookmarkCount}。确认后替换习惯状态，同标识内容恢复为备份版本；其他账号不变，分享先恢复为私人。`);
      confirmButton.hidden = false;
    } catch (error) { if (isCurrent()) show(error.message); }
  });
  confirmButton.addEventListener("click", async () => {
    if (!incoming || busy) return;
    busy = true; confirmButton.disabled = true;
    try {
      const context = root.KHTBackupContext;
      const archive = incoming, owner = incomingOwner, knowledgeRevision = incomingKnowledgeRevision;
      if (context && !context.localOnly && (!owner || context.ownerId !== owner)) throw new Error("账号已变化，请在当前账号重新选择备份。");
      if (!context || !(await context.flush())) throw new Error("请先保存或导出当前未保存记录，再恢复备份。");
      if (incoming !== archive || (!context.localOnly && context.ownerId !== owner)) throw new Error("备份或账号已变化，请重新确认恢复。");
      if (context.localOnly) {
        restoreLocal(incoming);
        root.location.reload();
        return;
      }
      const revision = context.revision;
      if (!revision) throw new Error("当前账号版本无法核对，请重新读取后再恢复。");
      const response = await fetch("/api/account/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "If-Match": revision, "X-Action-Account": owner, "X-Knowledge-Revision": knowledgeRevision }, body: JSON.stringify(archive) });
      const data = await response.json();
      if (context.ownerId !== owner || incoming !== archive) return;
      if (data.code === "KNOWLEDGE_CONFLICT") {
        incoming = null;
        confirmButton.hidden = true;
        fileInput.value = "";
      }
      if (!response.ok || !data.ok) throw new Error(data.message || "恢复失败，请保留文件重试。");
      show(data.message); incoming = null; confirmButton.hidden = true;
      root.location.reload();
    } catch (error) { show(error.message || "恢复失败，请保留备份重试。"); }
    finally { busy = false; confirmButton.disabled = false; }
  });
})(window);
