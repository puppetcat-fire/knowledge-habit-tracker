(function setupDemandGraph() {
  const endpoint = "/api/state/demand-graph";
  const filters = new URLSearchParams(location.search);
  const status = document.getElementById("graph-status");
  const results = document.getElementById("graph-results");
  const catalog = document.getElementById("graph-tutorials");
  const search = document.getElementById("graph-search");
  const tutorialUses = { choose: "选购判断", alternative: "替代办法", make: "自己做", use: "使用与练习" };
  let moderator = false;
  let allGroups = [];

  function element(tag, value) {
    const item = document.createElement(tag);
    if (value) item.textContent = value;
    return item;
  }

  function link(label, href) {
    const item = element("a", label);
    item.href = href;
    return item;
  }

  function tutorialLink(tutorial) {
    const params = new URLSearchParams({ tree: tutorial.treeId, node: tutorial.nodeId, tutorial: tutorial.id });
    return link("去教程平台", "/platform/#" + params);
  }

  async function read(url, options) {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (!response.ok) throw new Error("请求未完成，请刷新后重试。");
    return response.json();
  }

  async function moderate(body) {
    try {
      const { groupId } = await read(endpoint + "/moderate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      location.assign("/demand-graph/?group=" + encodeURIComponent(groupId));
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function moderatorButton(label, body) {
    const button = element("button", label);
    button.type = "button";
    button.className = "button ghost";
    button.addEventListener("click", () => { if (window.confirm(label + "？")) void moderate(body); });
    return button;
  }

  function renderPublication(item, group) {
    const row = element("li");
    row.append(element("h3", item.title));
    if (item.summary) row.append(element("p", item.summary));
    const detail = [
      item.specification && "规格 " + item.specification,
      item.wait && "能等 " + item.wait,
      item.secondhand === "yes" && "接受二手",
      item.secondhand === "no" && "仅考虑新品",
      item.status === "resolved" ? "已解决" : item.status === "paused" ? "暂不考虑"
        : item.intent === "considering" ? "条件合适会考虑购买" : "想要"
    ];
    row.append(element("p", detail.filter(Boolean).join(" · ")));
    if (item.tutorial) {
      const tutorial = item.tutorial;
      const disclosure = element("details");
      disclosure.append(element("summary", tutorialUses[item.tutorialUse] + " · " + tutorial.title + "（" + tutorial.version + "）"));
      if (item.tutorialStep) disclosure.append(element("p", item.tutorialStep));
      disclosure.append(element("p", tutorial.method), tutorialLink(tutorial));
      row.append(disclosure);
    }
    if (moderator && group.publications.length > 1) {
      row.append(moderatorButton("拆成独立需求", { action: "split", groupId: group.id, publicationId: item.id }));
    }
    return row;
  }

  function renderGroup(group) {
    const section = element("section");
    section.className = "graph-group";
    const heading = element("h2");
    heading.append(link(group.title, "/demand-graph/?group=" + encodeURIComponent(group.id)));
    section.append(heading, element("p", `${group.wanted} 人想要 · ${group.considering} 人有条件购买意向 · ${group.resolved} 人已解决`));
    const context = new URLSearchParams({ group: group.id, title: group.title });
    section.append(link("我也想要", "/wants/#" + context));
    const list = element("ul");
    list.className = "wants-list";
    for (const item of group.publications) list.append(renderPublication(item, group));
    section.append(list);
    const destinations = allGroups.filter((other) => other.id !== group.id);
    if (moderator && destinations.length) {
      const select = element("select");
      select.setAttribute("aria-label", "合并目标");
      for (const other of destinations) select.add(new Option(other.title, other.id));
      const button = element("button", "合并需求组");
      button.type = "button";
      button.className = "button ghost";
      button.addEventListener("click", () => {
        if (window.confirm("将本组公开需求合并到选中的组？")) {
          void moderate({ action: "merge", groupId: group.id, into: select.value });
        }
      });
      section.append(select, button);
    }
    return section;
  }

  async function load() {
    const query = filters.toString();
    const data = await read(endpoint + (query ? "?" + query : ""));
    const role = await read(endpoint + "/role").catch(() => ({ moderator: false }));
    moderator = role.moderator;
    if (moderator) allGroups = query ? (await read(endpoint)).groups : data.groups;
    status.textContent = data.groups.length ? `${data.groups.length} 组公开需求`
      : filters.has("publication") ? "这条公开需求已撤回或不存在。"
        : "这里还没有符合条件的公开需求。";
    results.replaceChildren(...data.groups.map(renderGroup));
    for (const tutorial of data.tutorials) {
      const item = element("li");
      item.append(link(tutorial.title + "的相关需求", "/demand-graph/?tutorial=" + encodeURIComponent(tutorial.id)),
        element("p", tutorial.method), tutorialLink(tutorial));
      catalog.append(item);
    }
  }

  search.elements.namedItem("q").value = filters.get("q") || "";
  void load().catch((error) => { status.textContent = error.message; });
})();
