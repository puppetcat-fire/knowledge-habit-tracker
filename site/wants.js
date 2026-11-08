(function setupWants() {
  const endpoint = "/api/state/wants";
  const status = document.getElementById("wants-status");
  const account = document.getElementById("wants-account");
  const workspace = document.getElementById("wants-workspace");
  const form = document.getElementById("wants-form");
  const list = document.getElementById("wants-list");
  const empty = document.getElementById("wants-empty");
  const sourceLabel = document.getElementById("wants-source");
  const cancel = document.getElementById("wants-cancel");
  const context = new URLSearchParams(window.location.hash.slice(1));
  const source = context.get("source") || "";
  const dialog = document.getElementById("wants-publish");
  const publicForm = document.getElementById("wants-public-form");
  const publicStatus = document.getElementById("wants-public-status");
  let publishing = null;
  const labels = { open: "还想要", resolved: "已解决", paused: "暂不考虑" };
  let items = [];
  let editing = null;
  let draftId = window.crypto.randomUUID();
  let busy = false;

  async function api(url, method = "GET", body) {
    const response = await window.fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || "请求失败，请稍后重试。");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    try {
      await task();
    } catch (error) {
      if (error.status === 401 && !workspace.hidden) showAccount();
      status.textContent = error.status === 401 && workspace.hidden
        ? "请登录，或检查名字与密码。"
        : error.message || "连接失败，请稍后重试。";
    } finally {
      busy = false;
    }
  }

  function showAccount() {
    dialog.close();
    workspace.hidden = true;
    account.hidden = false;
    items = [];
    render();
    fill(null);
  }

  function fill(want) {
    editing = want;
    if (!want) draftId = window.crypto.randomUUID();
    for (const name of ["title", "details", "link", "budget", "step"]) {
      form.elements.namedItem(name).value = want?.[name] ?? (name === "title" && !want ? context.get("title") || "" : "");
    }
    form.elements.namedItem("status").value = want?.status || "open";
    const label = want ? want.tutorial?.title || want.source : source;
    document.getElementById("wants-step").hidden = !(want?.tutorial || (!want && context.get("tutorial")));
    sourceLabel.textContent = label ? "来自教程 " + label : "";
    sourceLabel.hidden = !label;
    cancel.hidden = !want;
    document.getElementById("wants-form-title").textContent = want ? "编辑需求" : "记录一件想要的东西";
  }

  async function openPublication(want) {
    const { groups, tutorials } = await api("/api/state/demand-graph");
    publishing = want;
    const previous = want.publication;
    publicForm.reset();
    publicStatus.textContent = "";
    for (const name of ["title", "summary", "specification", "wait", "secondhand", "intent", "tutorialUse", "tutorialStep"]) {
      const value = previous?.[name] ?? (name === "title" ? want.title : undefined);
      if (value !== undefined) publicForm.elements.namedItem(name).value = value;
    }
    const groupSelect = document.getElementById("wants-public-groups");
    groupSelect.replaceChildren(new Option(previous ? "保持原分组" : "创建独立需求", ""));
    const matching = groups.filter((group) => group.title.includes(want.title) || want.title.includes(group.title));
    for (const group of [...matching, ...groups.filter((group) => !matching.includes(group))]) {
      groupSelect.add(new Option(group.title, group.id));
    }
    if (!previous && groups.some((group) => group.id === context.get("group"))) groupSelect.value = context.get("group");
    const tutorialSelect = document.getElementById("wants-public-tutorials");
    tutorialSelect.replaceChildren(new Option("暂不关联", ""));
    for (const tutorial of tutorials) tutorialSelect.add(new Option(tutorial.title, tutorial.id));
    const legacyId = /（([^）]+)）$/.exec(want.source || "")?.[1];
    const selected = previous ? previous.tutorial : want.tutorial || tutorials.find((item) => item.id === legacyId);
    if (selected && !tutorials.some((item) => item.id === selected.id)) {
      tutorialSelect.add(new Option(selected.title + "（历史版本）", selected.id));
    }
    tutorialSelect.value = selected?.id || "";
    dialog.showModal();
  }

  function replaceWant(want) {
    items = items.map((item) => item.id === want.id ? want : item);
    if (editing?.id === want.id) editing = want;
    render();
  }

  function render() {
    list.replaceChildren();
    empty.hidden = items.length > 0;
    for (const want of items) {
      const row = document.createElement("li");
      const title = document.createElement("h3");
      title.textContent = want.title;
      const detail = document.createElement("p");
      detail.textContent = [labels[want.status], want.budget === null ? "" : "预算 ¥" + want.budget, want.details, want.source].filter(Boolean).join(" · ");
      row.append(title, detail);
      if (want.step) {
        const step = document.createElement("p");
        step.textContent = "教程步骤或材料 " + want.step;
        row.append(step);
      }
      if (want.publication) {
        const publicLink = document.createElement("a");
        publicLink.href = "/demand-graph/?publication=" + encodeURIComponent(want.publication.id);
        publicLink.textContent = "查看公开需求";
        row.append(publicLink);
      }
      if (want.link) {
        const link = document.createElement("a");
        link.href = want.link;
        link.textContent = "查看商品";
        link.rel = "noreferrer";
        row.append(link);
      }
      const actions = document.createElement("div");
      actions.className = "wants-actions";
      const publicationActions = [[want.publication ? "编辑公开内容" : "公开需求", () => run(() => openPublication(want))]];
      if (want.publication) publicationActions.push(["撤回公开", () => run(async () => {
        if (!window.confirm("撤回后，公开图谱将移除这条内容。继续？")) return;
        const result = await api(endpoint + "/" + want.id + "/publication", "DELETE");
        replaceWant(result.want);
        status.textContent = "已撤回，私人记录仍然保留。";
      })]);
      for (const [label, action] of [["编辑", () => {
        if (busy) return;
        fill(want);
        form.elements.namedItem("title").focus();
      }], ["删除", () => run(async () => {
        if (!window.confirm("删除这条需求？")) return;
        await api(endpoint + "/" + want.id, "DELETE");
        items = items.filter((item) => item.id !== want.id);
        if (editing?.id === want.id) fill(null);
        render();
        status.textContent = "已删除需求。";
      })], ...publicationActions]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button ghost";
        button.textContent = label;
        button.addEventListener("click", action);
        actions.append(button);
      }
      row.append(actions);
      list.append(row);
    }
  }

  async function load() {
    try {
      items = (await api(endpoint)).wants;
    } catch (error) {
      if (error.status !== 401) throw error;
      showAccount();
      status.textContent = "登录后记录或查看自己的需求。";
      return;
    }
    account.hidden = true;
    workspace.hidden = false;
    status.textContent = "";
    render();
  }

  account.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = new FormData(account);
    const mode = event.submitter?.value === "register" ? "register" : "login";
    void run(async () => {
      await api("/api/" + mode, "POST", { name: fields.get("name"), password: fields.get("password") });
      account.reset();
      await load();
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const joining = !editing && context.has("group");
      const fields = Object.fromEntries(new FormData(form));
      const budget = fields.budget === "" ? null : Number(fields.budget);
      const url = editing ? endpoint + "/" + editing.id : endpoint;
      const { want } = await api(url, editing ? "PUT" : "POST", {
        ...fields, budget, id: editing?.id || draftId, source, tutorialId: context.get("tutorial")
      });
      items = editing ? items.map((item) => item.id === want.id ? want : item)
        : [want, ...items.filter((item) => item.id !== want.id)];
      fill(null);
      render();
      status.textContent = "已保存需求。";
      if (joining) await openPublication(want);
    });
  });
  publicForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      try {
        const result = await api(endpoint + "/" + publishing.id + "/publication", "PUT",
          Object.fromEntries(new FormData(publicForm)));
        replaceWant(result.want);
        dialog.close();
        status.textContent = "已公开需求。";
      } catch (error) {
        publicStatus.textContent = error.message;
      }
    });
  });
  document.getElementById("wants-public-cancel").addEventListener("click", () => { if (!busy) dialog.close(); });
  cancel.addEventListener("click", () => { if (!busy) fill(null); });
  document.getElementById("wants-logout").addEventListener("click", () => run(async () => {
    await api("/api/logout", "POST");
    showAccount();
    status.textContent = "已退出账号。";
  }));
  fill(null);
  void run(load);
})();
