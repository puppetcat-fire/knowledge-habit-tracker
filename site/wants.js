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
  const source = new URLSearchParams(window.location.hash.slice(1)).get("source") || "";
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
    workspace.hidden = true;
    account.hidden = false;
    items = [];
    render();
    fill(null);
  }

  function fill(want) {
    editing = want;
    if (!want) draftId = window.crypto.randomUUID();
    for (const name of ["title", "details", "link", "budget"]) {
      form.elements.namedItem(name).value = want?.[name] ?? "";
    }
    form.elements.namedItem("status").value = want?.status || "open";
    const label = want ? want.source : source;
    sourceLabel.textContent = label ? "来自教程 " + label : "";
    sourceLabel.hidden = !label;
    cancel.hidden = !want;
    document.getElementById("wants-form-title").textContent = want ? "编辑需求" : "记录一件想要的东西";
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
      if (want.link) {
        const link = document.createElement("a");
        link.href = want.link;
        link.textContent = "查看商品";
        link.rel = "noreferrer";
        row.append(link);
      }
      const actions = document.createElement("div");
      actions.className = "wants-actions";
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
      })]]) {
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
      const fields = Object.fromEntries(new FormData(form));
      const budget = fields.budget === "" ? null : Number(fields.budget);
      const url = editing ? endpoint + "/" + editing.id : endpoint;
      const { want } = await api(url, editing ? "PUT" : "POST", {
        ...fields, budget, id: editing?.id || draftId, source
      });
      items = editing ? items.map((item) => item.id === want.id ? want : item)
        : [want, ...items.filter((item) => item.id !== want.id)];
      fill(null);
      render();
      status.textContent = "已保存需求。";
    });
  });
  cancel.addEventListener("click", () => { if (!busy) fill(null); });
  document.getElementById("wants-logout").addEventListener("click", () => run(async () => {
    await api("/api/logout", "POST");
    showAccount();
    status.textContent = "已退出账号。";
  }));
  fill(null);
  void run(load);
})();
