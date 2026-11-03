(function bootstrapSite() {
  "use strict";

  const REPO = "puppetcat-fire/knowledge-habit-tracker";
  const DRAFT_KEY = "humansneeds-feedback-draft";
  const MAX_ISSUE_BODY = 6000;

  const TYPE_LABELS = {
    bug: "有问题",
    idea: "想要一个功能",
    other: "其他"
  };

  const PAGE_LABELS = {
    site: "首页",
    habit: "点亮 · 习惯记录器",
    platform: "知识共建共享平台",
    needs: "INeedThis · 需求图谱",
    other: "其他"
  };

  const form = document.getElementById("feedback-form");
  const result = document.getElementById("feedback-result");
  const resultText = document.getElementById("feedback-result-text");
  const fallback = document.getElementById("feedback-fallback");
  const issueLink = document.getElementById("feedback-issue-link");
  const copyButton = document.getElementById("feedback-copy");
  const submitButton = document.getElementById("feedback-submit");
  const health = document.getElementById("feedback-health");
  const healthText = document.getElementById("feedback-health-text");

  const fields = {
    type: document.getElementById("feedback-type"),
    page: document.getElementById("feedback-page"),
    title: document.getElementById("feedback-title"),
    description: document.getElementById("feedback-description"),
    contact: document.getElementById("feedback-contact")
  };

  let lastPayload = null;

  document.getElementById("footer-year").textContent = String(new Date().getFullYear());

  restoreDraft();
  checkHealth();
  bindForm();
  bindCopy();

  function bindForm() {
    if (!form) {
      return;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitFeedback();
    });
    form.addEventListener("input", saveDraft);
    form.addEventListener("change", saveDraft);
  }

  async function submitFeedback() {
    const payload = readPayload();
    if (!payload) {
      return;
    }

    lastPayload = payload;
    setBusy(true);
    hideResult();

    const remote = await postBug(payload);
    setBusy(false);

    if (remote.ok) {
      showResult("ok", "收到了，已经写进这个站点的反馈日志。谢谢你把问题说清楚。");
      form.reset();
      clearDraft();
      return;
    }

    showResult(
      "error",
      `没能写进站点日志：${remote.message}。你可以直接去 GitHub 提 issue，内容已经替你填好。`
    );
    showFallback(payload);
    checkHealth();
  }

  function readPayload() {
    const title = fields.title.value.trim();
    const description = fields.description.value.trim();
    if (!title || !description) {
      showResult("error", "标题和描述都要填一下，不然我不知道你说的是哪件事。");
      (title ? fields.description : fields.title).focus();
      return null;
    }

    const type = TYPE_LABELS[fields.type.value] ? fields.type.value : "bug";
    const page = PAGE_LABELS[fields.page.value] ? fields.page.value : "site";
    const detailLines = [description, "", `页面：${PAGE_LABELS[page]}`];

    return {
      title: `[${TYPE_LABELS[type]}] ${title}`.slice(0, 100),
      description: detailLines.join("\n").slice(0, 1000),
      severity: type === "bug" ? "medium" : "low",
      page,
      contact: fields.contact.value.trim(),
      type
    };
  }

  async function postBug(payload) {
    try {
      const response = await window.fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, message: data.message || `服务返回 ${response.status}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: "连不上这个站点的服务" };
    }
  }

  function showResult(state, message) {
    if (!result || !resultText) {
      return;
    }
    result.hidden = false;
    result.classList.toggle("is-ok", state === "ok");
    result.classList.toggle("is-error", state === "error");
    resultText.textContent = message;
    if (state !== "error") {
      if (fallback) {
        fallback.hidden = true;
      }
    }
  }

  function hideResult() {
    if (!result) {
      return;
    }
    result.hidden = true;
    result.classList.remove("is-ok", "is-error");
  }

  function showFallback(payload) {
    if (!fallback) {
      return;
    }
    fallback.hidden = false;
    if (issueLink) {
      issueLink.href = buildIssueUrl(payload);
    }
  }

  function buildIssueUrl(payload) {
    const body = [
      payload.description,
      "",
      `- 类型：${TYPE_LABELS[payload.type] || payload.type}`,
      `- 联系方式：${payload.contact || "未填写"}`,
      `- 来源：${window.location.origin}${window.location.pathname}`,
      "",
      "---",
      "（由 humansneeds.com 反馈表单生成）"
    ]
      .join("\n")
      .slice(0, MAX_ISSUE_BODY);

    const params = new URLSearchParams({
      title: payload.title,
      body,
      labels: "feedback"
    });
    return `https://github.com/${REPO}/issues/new?${params.toString()}`;
  }

  function bindCopy() {
    if (!copyButton) {
      return;
    }
    copyButton.addEventListener("click", async () => {
      if (!lastPayload) {
        return;
      }
      const text = `${lastPayload.title}\n\n${lastPayload.description}\n\n联系方式：${lastPayload.contact || "未填写"}`;
      const copied = await copyText(text);
      copyButton.textContent = copied ? "已复制" : "复制失败，请手动选中";
      window.setTimeout(() => {
        copyButton.textContent = "复制反馈内容";
      }, 2200);
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 落到下面的 execCommand 兜底
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }

  async function checkHealth() {
    if (!health || !healthText) {
      return;
    }
    health.dataset.state = "checking";
    healthText.textContent = "正在检查服务状态…";
    try {
      const response = await window.fetch("/health", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error("health failed");
      }
      const data = await response.json();
      if (data && data.status === "ok") {
        health.dataset.state = "online";
        healthText.textContent = "反馈通道在线：提交会写进服务端日志";
        return;
      }
      throw new Error("bad payload");
    } catch {
      health.dataset.state = "offline";
      healthText.textContent = "静态模式：提交会改走 GitHub Issue";
    }
  }

  function setBusy(busy) {
    if (!submitButton) {
      return;
    }
    submitButton.disabled = busy;
    submitButton.textContent = busy ? "正在提交…" : "提交反馈";
  }

  function saveDraft() {
    try {
      const draft = {
        type: fields.type.value,
        page: fields.page.value,
        title: fields.title.value,
        description: fields.description.value,
        contact: fields.contact.value
      };
      if (!draft.title && !draft.description && !draft.contact) {
        window.localStorage.removeItem(DRAFT_KEY);
        return;
      }
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // 隐私模式下 localStorage 会抛错，草稿功能静默失效即可
    }
  }

  function restoreDraft() {
    if (!form) {
      return;
    }
    let draft = null;
    try {
      draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
    } catch {
      draft = null;
    }
    if (!draft || typeof draft !== "object") {
      return;
    }
    if (TYPE_LABELS[draft.type]) {
      fields.type.value = draft.type;
    }
    if (PAGE_LABELS[draft.page]) {
      fields.page.value = draft.page;
    }
    fields.title.value = typeof draft.title === "string" ? draft.title.slice(0, 100) : "";
    fields.description.value =
      typeof draft.description === "string" ? draft.description.slice(0, 1000) : "";
    fields.contact.value = typeof draft.contact === "string" ? draft.contact.slice(0, 100) : "";
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // 忽略
    }
  }
})();
