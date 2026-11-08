(function personalHome() {
  const container = document.getElementById("personal-home");
  if (!container) return;
  let data = null;
  let generation = 0;
  const escape = (value) => String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const context = () => window.KHTProfileContext;
  function showProfile(show) {
    const skipLink = document.querySelector(".skip-link");
    if (skipLink) { skipLink.href = show ? "#personal-home" : "#atlas-stage"; skipLink.textContent = show ? "跳到个人主页" : "跳到知识图谱"; }
    if (!show) document.title = "知识共建共享平台";
    container.classList.toggle("hidden", !show);
    document.getElementById("atlas-intro").classList.toggle("hidden", show);
    document.getElementById("atlas-stage").classList.toggle("hidden", show);
    document.getElementById("next-action").classList.toggle("hidden", show);
    document.getElementById("profile-entry").classList.toggle("active", show);
    if (!show && window.location.hash?.startsWith("#person/")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  async function open(id) {
    const user = context()?.getUser();
    if (!user) return;
    const request = ++generation;
    showProfile(true);
    container.innerHTML = '<p class="profile-loading" role="status">正在读取这个人的知识与实践…</p>';
    try {
      let result;
      if (context().localOnly) result = context().getLocal();
      else {
        const response = await fetch(`/api/profiles/${encodeURIComponent(id || user.id)}`, { credentials: "same-origin" });
        result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || "主页读取失败。");
      }
      if (request !== generation || context()?.getUser()?.id !== user.id) return;
      data = result;
      window.history.replaceState(null, "", `#person/${encodeURIComponent(data.user.id)}`);
      document.title = `${data.user.name} · 点亮个人主页`;
      render();
      if (data.own && !context().localOnly && window.KHTRuntime?.communityUrl === "/review/") {
        void loadCommunitySummary(request, user.id);
      }
    } catch (error) { if (request === generation && context()?.getUser()?.id === user.id) container.innerHTML = `<p class="report" role="alert">${escape(error.message)}</p><button class="ghost-button" data-action="profile-open" data-user-id="${escape(id || user.id)}">重试读取</button>`; }
  }
  async function loadCommunitySummary(request, ownerId) {
    let summary = null;
    try {
      const response = await fetch("/api/action-state/summary", { credentials: "same-origin", headers: { "X-Action-Account": ownerId } });
      const result = await response.json();
      if (response.ok && result.ok && result.ownerId === ownerId &&
          Number.isSafeInteger(result.summary?.events) && result.summary.events >= 0 &&
          Number.isFinite(result.summary?.recordedMs) && result.summary.recordedMs >= 0) summary = result.summary;
    } catch {}
    if (request !== generation || context()?.getUser()?.id !== ownerId || !data?.own) return;
    data.communitySummary = summary;
    renderCommunitySummary();
  }
  function renderCommunitySummary() {
    if (!data?.own || window.KHTRuntime?.communityUrl !== "/review/" || context()?.localOnly) return;
    const side = container.querySelector(".profile-side");
    if (!side) return;
    let section = side.querySelector("[data-community-summary]");
    if (!section) {
      section = document.createElement("section");
      section.className = "profile-section";
      section.dataset.communitySummary = "";
      section.innerHTML = '<p class="eyebrow">社区行动档案</p><p role="status"></p><a href="/review/">打开知识社区</a>';
      side.append(section);
    }
    const summary = data.communitySummary;
    section.querySelector('[role="status"]').textContent = summary
      ? `${summary.events} 条行动 · 已结束的计时片段共 ${Math.floor(summary.recordedMs / 1000)} 秒`
      : summary === null ? "社区行动摘要暂不可用。" : "正在读取社区行动摘要…";
  }
  function renderCommunityAuthorLink() {
    if (data.own || context()?.localOnly || window.KHTRuntime?.communityUrl !== "/review/") return;
    const side = container.querySelector(".profile-side");
    const link = document.createElement("a");
    link.className = "ghost-button";
    link.href = "/review/?author=" + encodeURIComponent(data.user.id);
    link.textContent = "查看作者的社区贡献";
    side?.append(link);
  }
  const targetButton = (treeId, nodeId, title) => `<button class="profile-node-link" data-action="profile-node" data-tree-id="${escape(treeId)}" data-node-id="${escape(nodeId)}">${escape(context().nodeTitle(treeId, nodeId) || title)} <span>↗</span></button>`;
  function practiceDetailLink(record) {
    if (context().localOnly || record.eventOnly || typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(record.id)) return "";
    const query = new URLSearchParams({ view: "practice-detail", record: record.id });
    return `<a class="profile-node-link" href="product.html?${escape(query.toString())}">查看实践详情</a>`;
  }
  function methodVersionLink(method) {
    if (![method.treeId, method.nodeId, method.id, method.version].every((part) => typeof part === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(part))) {
      return targetButton(method.treeId, method.nodeId, "查看方法与历史");
    }
    const hash = `#node/${method.treeId}/${method.nodeId}/tutorial/${method.id}/${method.version}`;
    return `<a class="profile-node-link" href="${hash}">打开此版本</a>`;
  }
  function render() {
    const { user, profile = {}, methods = [], records = [], nodes = [], holdings = [], stats = {}, own } = data;
    const initials = Array.from(user.name || "我").slice(0, 1).join("");
    const measuredSeconds = Math.floor((stats.measuredMs || 0) / 1000);
    const measuredValue = measuredSeconds < 60 ? measuredSeconds : Math.floor(measuredSeconds / 60);
    const measuredUnit = measuredSeconds < 60 ? "秒" : `分 ${measuredSeconds % 60} 秒`;
    const visibleNodes = new Map(nodes.map((node) => [node.id, node.title]));
    const home = `<div class="profile-hero"><div class="profile-avatar">${escape(initials)}<span></span></div><div><p class="eyebrow">个人主页</p><h2>${escape(user.name)}</h2><p class="profile-tagline">${escape(profile.tagline || "在知识的地图上，留下自己的足迹。")}</p><p class="profile-visibility">${own ? "这是你的主页，私人内容仅你可见" : "这里展示对你可见的公开贡献"}</p></div>${own ? '<button class="ghost-button profile-edit" data-action="profile-edit">编辑个人资料</button>' : ""}</div>
      <div class="profile-metrics"><div><strong>${own ? stats.events || 0 : records.length}</strong><span>${own ? "记录的事件" : "公开的实践"}</span></div><div><strong>${methods.length}</strong><span>贡献的方法</span></div><div><strong>${holdings.length}</strong><span>持有的节点</span></div>${own ? `<div><strong>${measuredValue}<small> ${measuredUnit}</small></strong><span>真实计时的投入</span></div>` : ""}</div>
      <div class="profile-columns"><div class="profile-main"><section class="profile-section"><div class="section-heading"><h3>实践的痕迹</h3><span>按时间留下的实践</span></div>${records.length ? records.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 40).map((record) => `<article class="profile-practice"><div class="timeline-dot"></div><time>${escape(new Date(record.createdAt).toLocaleDateString("zh-CN"))}</time><h4>${escape(record.text || "留下了一次图片实践")}</h4><p>${record.lightUp ? "自证点亮" : "一次实践"} · ${record.visibility === "private" ? "仅自己可见" : "公开分享"}${record.tutorialVersion ? ` · 方法版本 ${escape(record.tutorialVersion.slice(0, 8))}` : ""}</p>${targetButton(record.treeId, record.nodeId, visibleNodes.get(record.nodeId) || "前往知识节点")}${practiceDetailLink(record)}</article>`).join("") : '<div class="profile-empty"><span>○</span><h4>这里将留下你真正做过的事</h4><p>从一个五分钟行动开始。实践由你决定是否公开。</p><button class="ghost-button" data-action="atlas-home">去知识地图找一个起点 ↗</button></div>'}</section>
      <section class="profile-section"><div class="section-heading"><h3>留下的方法</h3><span>可以复用的经验</span></div>${methods.length ? methods.map((method) => `<article class="profile-method"><span class="method-symbol">✧</span><div><h4>${escape(method.title)}</h4><p>${escape(method.startAction || "一种可复用的方法")} · ${method.visibility === "private" ? "私人" : "公开"}</p>${methodVersionLink(method)}</div></article>`).join("") : '<p class="meta-note">暂时没有贡献方法。把一次做成的经验写成步骤，就能让另一个人从这里出发。</p>'}</section></div>
      <aside class="profile-side"><section class="profile-section"><p class="eyebrow">关于我</p><p class="profile-about">${escape(profile.about || "还没有写自我介绍。")}</p>${profile.focus ? `<div class="profile-focus"><span class="live-dot"></span><span>正在探索</span><strong>${escape(profile.focus)}</strong></div>` : ""}${own && stats.habit ? `<p class="meta-note">正在养成：${escape(stats.habit)}</p>` : ""}</section><section class="profile-section"><p class="eyebrow">知识的归属</p>${holdings.length ? holdings.map((item) => `<div class="holding-item"><span>${item.ownership === "group" ? "共同持有" : "个人持有"}</span>${targetButton(item.treeId, item.nodeId, item.title || visibleNodes.get(item.nodeId) || "已点亮的知识节点")}</div>`).join("") : '<p class="meta-note">暂无持有节点。公共节点的归属来自真实的自证实践。</p>'}<p class="ownership-note">共同持有连接每一个点亮者。持有记录不代表已产生可提现收益。</p></section></aside></div>`;
    container.innerHTML = home;
    if (!context().localOnly) {
      const [practiceHeading, methodHeading] = container.querySelectorAll(".profile-main .section-heading");
      const links = [
        [practiceHeading, { view: "practice", authorId: user.id }, "搜索这位作者的公开实践"],
        [methodHeading, { view: "tutorial-search", authorId: user.id }, "搜索这位作者的公开教程"],
        [methodHeading, { view: "discover", authorId: user.id }, "查看这位作者的公开需求"],
        [methodHeading, { view: "author-demand-answers", authorId: user.id }, "查看这位作者的公开需求回应"]
      ];
      if (own) links.unshift([practiceHeading, { view: "practice", scope: "mine" }, "搜索我的实践"]);
      for (const [heading, params, label] of links) {
        const link = document.createElement("a");
        link.className = "profile-node-link";
        link.href = "product.html?" + new URLSearchParams(params);
        link.textContent = label;
        heading.append(link);
      }
    }
    renderCommunitySummary();
    renderCommunityAuthorLink();
  }
  function edit() {
    if (!data?.own) return;
    const profile = data.profile || {};
    container.innerHTML = `<div class="profile-form"><p class="eyebrow">个人资料</p><h2>让别人认识做这些事的人</h2><label class="field"><span>一句话介绍</span><input id="profile-tagline" maxlength="120" value="${escape(profile.tagline)}" placeholder="你怎样介绍自己？"></label><label class="field"><span>关于我</span><textarea id="profile-about" rows="6" maxlength="1600">${escape(profile.about)}</textarea></label><label class="field"><span>正在探索</span><input id="profile-focus" maxlength="120" value="${escape(profile.focus)}" placeholder="目前想理解、想做的一件事"></label><label class="check-field"><input id="profile-public" type="checkbox"${profile.visibility === "public" ? " checked" : ""}>向平台上的其他人公开这些个人资料</label><p class="meta-note">这项选择只控制个人介绍。私人事件、方法和实践不会因此公开。</p><p id="profile-status" role="status"></p><div class="profile-form-actions"><button class="primary" data-action="profile-save">保存个人资料</button><button class="ghost-button" data-action="profile-cancel">返回主页</button></div></div>`;
  }
  async function save(button) {
    const ownerId = context()?.getUser()?.id;
    if (!data?.own || data.user.id !== ownerId) return;
    const request = generation;
    const current = () => request === generation && context()?.getUser()?.id === ownerId;
    const profile = { tagline: document.getElementById("profile-tagline").value, about: document.getElementById("profile-about").value, focus: document.getElementById("profile-focus").value, visibility: document.getElementById("profile-public").checked ? "public" : "private" };
    button.disabled = true;
    try {
      if (context().localOnly) { localStorage.setItem("knowledge-habit-profile", JSON.stringify(profile)); data.profile = profile; }
      else {
        const response = await fetch("/api/profile", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json", "If-Match": data.revision }, body: JSON.stringify(profile) });
        const result = await response.json();
        if (!current()) return;
        if (!response.ok || !result.ok) throw new Error(result.message || "保存失败，请保留输入重试。");
        data.profile = result.profile; data.revision = result.revision;
      }
      render();
    } catch (error) {
      const status = document.getElementById("profile-status");
      if (current() && status) status.textContent = error.message;
    }
    finally { button.disabled = false; }
  }
  document.getElementById("platform-root").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "profile-open") void open(button.dataset.userId);
    else if (action === "atlas-home") { generation++; showProfile(false); context().refreshMap(); }
    else if (action === "profile-edit") edit();
    else if (action === "profile-cancel") render();
    else if (action === "profile-save") void save(button);
    else if (action === "profile-node") { generation++; showProfile(false); context().openNode(button.dataset.treeId, button.dataset.nodeId); }
    else if (action === "tree-create" || action === "platform-create-open") { generation++; showProfile(false); }
  });
  const reset = () => { generation++; data = null; container.innerHTML = ""; container.classList.add("hidden"); document.getElementById("atlas-intro").classList.remove("hidden"); document.getElementById("atlas-stage").classList.remove("hidden"); document.getElementById("profile-entry").classList.remove("active"); };
  const readRoute = () => { const match = /^#person\/([A-Za-z0-9_-]{1,64})$/.exec(window.location.hash || ""); if (match && context()?.getUser()) void open(match[1]); };
  window.addEventListener("KHTProfileReset", reset);
  window.addEventListener("KHTProfileLogout", () => { showProfile(false); reset(); });
  window.addEventListener("KHTProfileReady", readRoute);
  window.addEventListener("KHTNodeRoute", () => {
    if (container.classList.contains("hidden")) return;
    generation++;
    showProfile(false);
  });
  window.addEventListener("hashchange", readRoute);
  document.getElementById("tree-select").addEventListener("change", () => { generation++; showProfile(false); });
  readRoute();
})();
