(() => {
  const element = (id) => document.getElementById(id);
  const query = new URLSearchParams(window.location.search);
  const id = query.get("tutorial") || "";
  const version = query.get("version") || "";
  const material = query.get("material") || "";
  const status = element("product-status");
  element("product-community-link").hidden = window.KHTRuntime?.communityUrl !== "/review/";
  function loginRequired() {
    const login = element("product-login");
    const target = new URL("./", window.location.href);
    target.searchParams.set("returnTo", window.location.pathname + window.location.search + window.location.hash);
    login.querySelector("a").href = target.href;
    login.hidden = false;
    return new Error("请先登录。");
  }
  const money = (cents) => (cents / 100).toFixed(2);
  const wantUrl = (tutorial, hash, index) => `/api/product-wants/${tutorial}/${hash}/${index}`;

  async function readWants(url, isCurrent = () => true) {
    const response = await fetch(url);
    if (!isCurrent()) return null;
    if (response.status === 401) throw loginRequired();
    if (!response.ok) throw new Error("暂时无法读取想要清单。");
    return response.json();
  }

  async function updateWant(url, ownerId, action, budgetCents) {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Action-Account": ownerId },
      body: JSON.stringify({ action, budgetCents })
    });
    if (!response.ok) throw new Error((await response.json()).message || "预算操作失败，请刷新后重试。");
  }

  function demandAnswerSummary(item) {
    return " · " + (item.answerCount ?? 0) + " 条回应" + (item.hasAcceptedAnswer ? " · 已有采纳" : "") +
      (item.answersClosed ? " · 已暂停收集回应" : "");
  }

  function acceptedDemandLink(item, detailUrl) {
    const link = document.createElement("a");
    link.href = detailUrl + "#answer-" + encodeURIComponent(item.acceptedAnswerId);
    link.textContent = "查看已采纳的回应";
    return link;
  }

  async function setDemandBookmark(tree, node, demand, ownerId, saved) {
    const url = "/api/knowledge-demands/" + [tree, node, demand].map(encodeURIComponent).join("/") + "/bookmark";
    const response = await fetch(url, { method: "PUT", headers: {
      "Content-Type": "application/json", "X-Action-Account": ownerId
    }, body: JSON.stringify({ saved }) });
    if (!response.ok) throw new Error((await response.json()).message || "暂时无法修改收藏，请重试。");
  }

  async function showDemands(tree, node, product = null, demand = null) {
    const endpoint = `/api/knowledge-demands/${encodeURIComponent(tree)}/${encodeURIComponent(node)}`;
    const nodeQuery = new URLSearchParams({ view: "demands", tree, node });
    const section = element("demands");
    const form = element("demand-form");
    let demandAttempt;
    let canPublishDemand = false;
    const demandDraftKey = () => demand === null && ownerId
      ? "kht-demand-draft:" + JSON.stringify([ownerId, tree, node, product]) : null;
    const demandInput = () => ({
      title: form.elements.title.value, body: form.elements.body.value,
      visibility: form.elements.public.checked ? "public" : "private", product
    });
    function saveDemandDraft() {
      const key = demandDraftKey();
      if (!key) return;
      const input = demandInput();
      try {
        if (!input.title && !input.body) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify({ input, attempt: demandAttempt }));
      } catch { /* 当前浏览器可能无法读写本地存储或访问可选接口。 */ }
    }
    function restoreDemandDraft() {
      const key = demandDraftKey();
      if (!key) return;
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(key));
        const input = saved?.input;
        if (typeof input?.title !== "string" || input.title.length > 80 ||
            typeof input.body !== "string" || input.body.length > 2000) return;
        form.elements.title.value = input.title;
        form.elements.body.value = input.body;
        form.elements.public.checked = input.visibility === "public";
        if (saved.attempt?.signature === JSON.stringify(demandInput()) &&
            /^[A-Za-z0-9_-]{16,100}$/.test(saved.attempt.requestId || "")) demandAttempt = saved.attempt;
      } catch { /* 当前浏览器可能无法读写本地存储或访问可选接口。 */ }
    }
    form.oninput = saveDemandDraft;
    let focusDemandForm = demand === null && !product && window.location.hash === "#demand-form";
    const editForm = element("demand-edit-form");
    const editSubmit = editForm.querySelector("button");
    const editConflict = element("demand-edit-conflict");
    let editRevision;
    function clearDemandConflict() {
      editConflict.hidden = true;
      editConflict.querySelector("strong").textContent = "";
      editConflict.querySelector("p").textContent = "";
      editSubmit.textContent = "保存修改";
    }
    const linkForm = element("demand-link-form");
    const linkChoice = element("demand-link-choice");
    const linkSubmit = linkForm.querySelector("button");
    const list = element("demand-list");
    if (!product && demand === null) {
      const search = document.createElement("a");
      search.href = "?" + new URLSearchParams({ view: "discover", treeId: tree, nodeId: node });
      search.textContent = "搜索这个节点的需求";
      list.before(search);
    }
    const message = element("demand-status");
    const bookmark = element("demand-bookmark");
    const submit = form.querySelector("button");
    const back = demand === null ? null : document.createElement("a");
    const answerSection = element("demand-answers");
    const answerList = element("demand-answer-list");
    const answerPages = element("demand-answer-pages");
    const previousAnswers = element("demand-answer-previous");
    const nextAnswers = element("demand-answer-next");
    const answerOrder = element("demand-answer-order");
    const answerForm = element("demand-answer-form");
    const answerField = answerForm.elements.text;
    const answerSubmit = answerForm.querySelector("button");
    const answerStatus = element("demand-answer-status");
    const answerToggle = element("demand-answer-toggle");
    const answerLinkStatus = element("demand-answer-link-status");
    const answersUrl = endpoint + "/" + encodeURIComponent(demand) + "/answers";
    let answerAttempt;
    const answerDrafts = new Map();
    let demandRequest = 0;
    let ownsDemand = false;
    let answerAvailable = false;
    let answerQuestionRevision;
    let answerDraftRevision;
    let postingAnswer = false;
    let answerPage = 1;
    const draftKey = () => demand !== null && ownerId
      ? "kht-demand-answer-draft:" + JSON.stringify([ownerId, tree, node, demand]) : null;
    function saveAnswerDraft() {
      const key = draftKey();
      if (!key) return;
      try {
        if (!answerField.value.trim()) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify({
          text: answerField.value, revision: answerDraftRevision, attempt: answerAttempt
        }));
      } catch { /* 当前浏览器可能无法读写本地存储或访问可选接口。 */ }
    }
    function restoreAnswerDraft() {
      const key = draftKey();
      if (!key) return;
      try {
        const draft = JSON.parse(window.sessionStorage.getItem(key));
        if (typeof draft?.text !== "string" || draft.text.length > 2000) return;
        answerField.value = draft.text;
        answerDraftRevision = typeof draft.revision === "string" ? draft.revision : undefined;
        if (draft.attempt?.text === draft.text.trim() && /^[A-Za-z0-9_-]{16,100}$/.test(draft.attempt.requestId || "")) {
          answerAttempt = { text: draft.attempt.text, requestId: draft.attempt.requestId };
        }
      } catch { /* 当前浏览器可能无法读写本地存储或访问可选接口。 */ }
    }
    answerOrder.value = query.get("answerOrder") === "helpful" ? "helpful" : "original";
    const answerAnchor = () => /^#answer-([a-f0-9]{32})$/.exec(window.location.hash)?.[1];
    answerField.oninput = () => {
      answerDraftRevision = answerField.value.trim() ? answerDraftRevision || answerQuestionRevision : undefined;
      if (!answerField.value.trim()) answerAttempt = undefined;
      saveAnswerDraft();
    };
    let focusedAnswer = "";
    function locateAnswer() {
      const hash = window.location.hash;
      const anchor = demand !== null && answerAnchor();
      const id = anchor ? "answer-" + anchor : "";
      const row = id && element(id);
      answerLinkStatus.textContent = id && !row ? "链接指向的回应目前不可访问。" : "";
      const target = row ? hash + ":" + (row.dataset.revision || "") : "";
      if (row && focusedAnswer !== target) {
        row.focus();
        if (row.dataset.received) {
          void write(answersUrl + "/" + encodeURIComponent(row.dataset.received) + "/read", undefined, "POST", row.dataset.revision)
            .then(refreshDemandInboxCount).catch(() => {});
        }
      }
      focusedAnswer = target;
    }
    function refreshAnswerPage() {
      void refresh().catch((error) => { message.textContent = error.message; });
    }
    if (demand !== null) {
      window.addEventListener("hashchange", () => {
        const anchor = answerAnchor();
        if (anchor && !element("answer-" + anchor)) refreshAnswerPage();
        else locateAnswer();
      });
      function turnAnswers(direction) {
        if (previousAnswers.disabled) return;
        previousAnswers.disabled = nextAnswers.disabled = true;
        if (answerAnchor()) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        answerPage += direction;
        void refresh().catch((error) => { message.textContent = error.message; })
          .finally(() => { previousAnswers.disabled = nextAnswers.disabled = false; });
      }
      previousAnswers.onclick = () => turnAnswers(-1);
      nextAnswers.onclick = () => turnAnswers(1);
      answerOrder.onchange = () => {
        const params = new URLSearchParams(window.location.search);
        if (answerOrder.value === "helpful") params.set("answerOrder", "helpful");
        else params.delete("answerOrder");
        window.history.replaceState(window.history.state, "", "?" + params + window.location.hash);
        answerPage = 1;
        refreshAnswerPage();
      };
    }
    const isProduct = (item) => item && product && item.tutorial === product.tutorial &&
      item.version === product.version && item.material === product.material;
    let ownerId;
    async function write(url, body, method = "POST", revision) {
      const response = await fetch(url, { method, headers: {
        "Content-Type": "application/json", "X-Action-Account": ownerId, ...(revision ? { "If-Match": revision } : {})
      }, body: JSON.stringify(body) });
      if (!response.ok) {
        const error = await response.json();
        throw Object.assign(new Error(error.message || "无法保存需求，请刷新后重试。"), {
          code: error.code, current: error.current
        });
      }
      return response;
    }
    function renderAnswers(data, preserveDraft = false) {
      answerList.replaceChildren();
      answerAvailable = Boolean(data.canAnswer);
      answerQuestionRevision = data.questionRevision;
      const answersVisible = Boolean(data.answersVisible);
      const draftVisible = Boolean((answersVisible || preserveDraft) && answerField.value.trim());
      answerSection.hidden = !answersVisible && !draftVisible;
      answerForm.hidden = !answerAvailable && !draftVisible;
      element("demand-answer-closed").hidden = !answersVisible || answerAvailable;
      element("demand-answer-order-label").hidden = !answersVisible;
      answerToggle.hidden = !answersVisible || !data.items[0]?.own;
      answerToggle.textContent = answerAvailable ? "暂停收集回应" : "重新开放回应";
      answerToggle.onclick = async () => {
        answerToggle.disabled = true;
        try {
          await write(endpoint + "/" + encodeURIComponent(demand) + "/answering", { closed: answerAvailable }, "PUT");
          await refresh();
        } catch (error) { answerStatus.textContent = error.message; }
        finally { answerToggle.disabled = false; }
      };
      answerSubmit.disabled = !answerAvailable || postingAnswer;
      if (data.page) answerPage = data.page;
      previousAnswers.hidden = !answersVisible || answerPage <= 1;
      nextAnswers.hidden = !answersVisible || !data.hasNext;
      answerPages.hidden = previousAnswers.hidden && nextAnswers.hidden;
      for (const answer of data.answers || []) {
        const row = document.createElement("li");
        row.id = "answer-" + answer.id;
        row.tabIndex = -1;
        if (data.items[0]?.own && !answer.own) {
          row.dataset.received = answer.id;
          row.dataset.revision = answer.revision;
        }
        const author = document.createElement("a");
        author.href = "./#person/" + encodeURIComponent(answer.authorId);
        author.textContent = answer.authorName;
        const text = document.createElement("p");
        text.textContent = answer.text;
        const permalink = document.createElement("a");
        permalink.href = "#" + row.id;
        permalink.textContent = "这条回应的链接";
        row.append(author, text, permalink);
        if (answer.own) {
          row.append(" · " + answer.helpfulCount + " 人觉得有帮助");
        } else {
          const helpful = document.createElement("button");
          helpful.textContent = "有帮助 · " + answer.helpfulCount;
          helpful.setAttribute("aria-pressed", String(answer.helpful));
          helpful.onclick = async () => {
            helpful.disabled = true;
            try {
              await write(answersUrl + "/" + encodeURIComponent(answer.id) + "/helpful", { helpful: !answer.helpful }, "PUT", answer.revision);
              await refresh();
              answerStatus.textContent = answer.helpful ? "已取消有帮助标记。" : "已标记有帮助。";
            } catch (error) {
              let message = error.message;
              if (error.code === "ANSWER_REVISION_CHANGED") {
                try { await refresh(); } catch (refreshError) { message = refreshError.message; }
              }
              answerStatus.textContent = message;
              helpful.disabled = false;
            }
          };
          row.append(helpful);
        }
        if (answer.accepted) row.append("提问者已采纳");
        if (answer.questionUpdatedSincePosting) {
          const context = document.createElement("p");
          context.textContent = "当前问题与这条回应发布时不同。";
          row.append(context);
        }
        if (data.items[0]?.own) {
          const accept = document.createElement("button");
          accept.textContent = answer.accepted ? "取消采纳" : "采纳这条回应";
          accept.onclick = async () => {
            accept.disabled = true;
            try {
              await write(answersUrl + "/" + encodeURIComponent(answer.id) + "/acceptance", { accepted: !answer.accepted }, "PUT", answer.revision);
              await refresh();
              answerStatus.textContent = answer.accepted ? "已取消采纳。" : "已采纳回应。";
            } catch (error) {
              let message = error.message;
              if (error.code === "ANSWER_REVISION_CHANGED") {
                try { await refresh(); } catch (refreshError) { message = refreshError.message; }
              }
              answerStatus.textContent = message;
              accept.disabled = false;
            }
          };
          row.append(accept);
        }
        if (answer.own) {
          const edit = document.createElement("button");
          edit.textContent = "编辑回应";
          edit.onclick = () => {
            const draft = answerDrafts.get(answer.id) || { text: answer.text, revision: answer.revision };
            answerDrafts.set(answer.id, draft);
            const editor = document.createElement("form");
            const label = document.createElement("label");
            const field = document.createElement("textarea");
            field.value = draft.text;
            field.oninput = () => { draft.text = field.value; };
            field.maxLength = 2000;
            field.required = true;
            label.append("编辑回应正文", field);
            const save = document.createElement("button");
            const comparison = document.createElement("p");
            function renderComparison() {
              comparison.hidden = !draft.current;
              comparison.textContent = draft.current ? "另一窗口已保存：" + draft.current.text : "";
              save.textContent = draft.current ? "用我的草稿替换回应" : "保存回应";
            }
            renderComparison();
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "取消编辑";
            cancel.onclick = () => {
              answerDrafts.delete(answer.id);
              editor.remove();
              edit.disabled = withdraw.disabled = false;
              edit.focus();
            };
            editor.append(label, comparison, save, cancel);
            editor.onsubmit = async (event) => {
              event.preventDefault();
              if (save.disabled) return;
              save.disabled = cancel.disabled = field.disabled = true;
              try {
                await write(answersUrl + "/" + encodeURIComponent(answer.id), { text: field.value }, "PATCH", draft.current?.revision || draft.revision);
                answerDrafts.delete(answer.id);
                await refresh();
                answerStatus.textContent = "已保存回应修改。";
              } catch (error) {
                if (error.code === "ANSWER_EDIT_CONFLICT") {
                  draft.current = error.current;
                  renderComparison();
                }
                answerStatus.textContent = error.message;
              }
              finally { save.disabled = cancel.disabled = field.disabled = false; }
            };
            edit.disabled = withdraw.disabled = true;
            row.append(editor);
            field.focus();
          };
          const withdraw = document.createElement("button");
          withdraw.textContent = "撤回回应";
          withdraw.onclick = async () => {
            withdraw.disabled = true;
            try {
              await write(answersUrl + "/" + encodeURIComponent(answer.id) + "/withdraw");
              element(row.id)?.remove();
              locateAnswer();
              if (answerPage > 1 && !answerList.childElementCount) refreshAnswerPage();
              answerStatus.textContent = "已撤回回应。";
            } catch (error) {
              answerStatus.textContent = error.message;
              withdraw.disabled = false;
            }
          };
          row.append(edit, withdraw);
          if (answerDrafts.has(answer.id)) edit.click();
        }
        answerList.append(row);
      }
      locateAnswer();
    }
    answerForm.onsubmit = async (event) => {
      event.preventDefault();
      if (answerSubmit.disabled) return;
      const draft = answerField.value;
      const text = draft.trim();
      if (!text) return;
      if (answerAttempt?.text !== text) answerAttempt = { text, requestId: crypto.randomUUID() };
      saveAnswerDraft();
      postingAnswer = true;
      answerSubmit.disabled = true;
      try {
        const result = await write(answersUrl, answerAttempt, "POST", answerDraftRevision || answerQuestionRevision);
        const { id } = await result.json();
        answerAttempt = null;
        if (answerField.value === draft) {
          answerField.value = "";
          answerDraftRevision = undefined;
        }
        saveAnswerDraft();
        if (/^[a-f0-9]{32}$/.test(id)) {
          window.history.replaceState(window.history.state, "", "#answer-" + id);
        }
        await refresh();
        answerStatus.textContent = "回应已发布。";
      } catch (error) {
        if (error.code === "ANSWER_QUESTION_CHANGED" || error.code === "DEMAND_ANSWERS_CLOSED") {
          try {
            await refresh();
            if (error.code === "ANSWER_QUESTION_CHANGED") answerDraftRevision = answerQuestionRevision;
            saveAnswerDraft();
          } catch (refreshError) { message.textContent = refreshError.message; }
        }
        answerStatus.textContent = error.message;
      }
      finally {
        postingAnswer = false;
        answerSubmit.disabled = !answerAvailable;
      }
    };
    async function refresh() {
      const request = ++demandRequest;
      const params = new URLSearchParams();
      if (demand !== null) {
        params.set("demand", demand);
        params.set("answerPage", String(answerPage));
        params.set("answerOrder", answerOrder.value);
        const anchor = answerAnchor();
        if (anchor) params.set("answerAnchor", anchor);
      }
      const response = await fetch(demand === null ? endpoint : endpoint + "?" + params);
      if (request !== demandRequest) return;
      if (!response.ok) {
        bookmark.hidden = true;
        form.hidden = true;
        editForm.hidden = true;
        linkForm.hidden = true;
        list.replaceChildren();
        renderAnswers({}, response.status === 404);
        if (response.status === 401) throw loginRequired();
        throw new Error(demand === null ? "当前无法查看节点需求。" : "这条需求目前不可访问。");
      }
      const data = await response.json();
      if (request !== demandRequest) return;
      if (ownerId && ownerId !== data.ownerId) {
        bookmark.hidden = true;
        form.hidden = true;
        editForm.hidden = true;
        linkForm.hidden = true;
        list.replaceChildren();
        renderAnswers({});
        throw new Error("账号已变化，请刷新页面。");
      }
      const firstLoad = !ownerId;
      ownerId = data.ownerId;
      if (firstLoad && data.nodeAvailable) restoreDemandDraft();
      canPublishDemand = data.canPublishDemand === true;
      if (!canPublishDemand && form.elements.public.checked && !demandAttempt) {
        form.elements.public.checked = false;
        saveDemandDraft();
      }
      form.elements.public.disabled = !canPublishDemand || submit.disabled;
      element("demand-public-unavailable").hidden = canPublishDemand;
      bookmark.hidden = !data.answersVisible;
      bookmark.textContent = data.bookmarked ? "取消需求收藏" : "收藏需求";
      bookmark.onclick = async () => {
        bookmark.disabled = true;
        try {
          await setDemandBookmark(tree, node, demand, ownerId, !data.bookmarked);
          await refresh();
          message.textContent = data.bookmarked ? "已取消需求收藏。" : "已加入需求收藏。";
        } catch (error) { message.textContent = error.message; }
        finally { bookmark.disabled = false; }
      };
      if (firstLoad && data.answersVisible) restoreAnswerDraft();
      ownsDemand = demand !== null && data.items[0]?.own === true;
      renderAnswers(data);
      list.replaceChildren();
      const unlinked = product ? data.items.filter((item) => item.canLinkProduct) : [];
      const selected = linkChoice.value;
      linkChoice.replaceChildren(new Option("选择同一节点下的需求", ""));
      for (const item of unlinked) linkChoice.add(new Option(item.title, item.id));
      if (unlinked.some((item) => item.id === selected)) linkChoice.value = selected;
      linkForm.hidden = unlinked.length === 0;
      for (const item of data.items) {
        if (product && !isProduct(item.product)) continue;
        const row = document.createElement("li");
        const title = document.createElement(demand === null ? "a" : "strong");
        if (demand === null) title.href = "?" + new URLSearchParams([...nodeQuery, ["demand", item.id]]);
        const body = document.createElement("p");
        title.textContent = item.title;
        body.textContent = item.body;
        row.append(title, body);
        if (demand === null && item.visibility === "public") row.append(demandAnswerSummary(item));
        if (item.product && !product) {
          const link = document.createElement("a");
          link.href = "?" + new URLSearchParams(item.product);
          link.textContent = "查看关联商品和教程";
          row.append(link);
        }
        if (item.own) {
          const isPublic = item.visibility === "public";
          const action = isPublic ? "withdraw" : "publish";
          row.append(isPublic ? "（公开）" : "（私人）");
          const button = document.createElement("button");
          button.textContent = isPublic ? "撤回公开" : "公开需求";
          button.disabled = !editForm.hidden;
          button.onclick = async () => {
            button.disabled = true;
            try {
              await write(endpoint + "/" + item.id + "/" + action, undefined, "POST", isPublic ? undefined : item.revision);
              await refresh();
              message.textContent = isPublic ? "已撤回公开。" : "已公开需求。";
            } catch (error) {
              let failureMessage = error.message;
              if (error.code === "DEMAND_REVISION_CHANGED") {
                try { await refresh(); }
                catch (refreshError) { failureMessage = refreshError.message; }
              }
              message.textContent = failureMessage;
              button.disabled = false;
            }
          };
          row.append(button);
          if (demand !== null) {
            const edit = document.createElement("button");
            edit.textContent = "编辑需求";
            edit.onclick = () => {
              if (!editForm.hidden || button.disabled) return;
              button.disabled = true;
              editRevision = item.revision;
              clearDemandConflict();
              editForm.elements.title.value = item.title;
              editForm.elements.body.value = item.body;
              editForm.hidden = false;
              editForm.elements.title.focus();
            };
            editForm.onsubmit = async (event) => {
              event.preventDefault();
              if (editSubmit.disabled) return;
              const fields = new FormData(editForm);
              editSubmit.disabled = true;
              editForm.elements.title.readOnly = editForm.elements.body.readOnly = true;
              try {
                await write(endpoint + "/" + item.id, { title: fields.get("title"), body: fields.get("body") }, "PATCH", editRevision);
                clearDemandConflict();
                editForm.hidden = true;
                await refresh();
                message.textContent = "已保存需求修改。";
              } catch (error) {
                if (error.code === "DEMAND_EDIT_CONFLICT") {
                  const latest = error.current;
                  editRevision = latest.revision;
                  editConflict.querySelector("strong").textContent =
                    "另一窗口已保存" + (latest.visibility === "public" ? "（当前公开）" : "（当前私人）");
                  editConflict.querySelector("p").textContent = latest.title + "\n" + latest.body;
                  editConflict.hidden = false;
                  editSubmit.textContent = "用我的草稿替换需求";
                }
                message.textContent = error.message;
              }
              finally {
                editSubmit.disabled = false;
                editForm.elements.title.readOnly = editForm.elements.body.readOnly = false;
              }
            };
            element("demand-edit-cancel").onclick = () => {
              if (editSubmit.disabled) return;
              clearDemandConflict();
              editForm.hidden = true;
              button.disabled = false;
              edit.focus();
            };
            row.append(edit);
          }
        }
        list.append(row);
      }
      if (back) back.hidden = !data.nodeAvailable;
      message.textContent = !data.nodeAvailable ? "原知识节点目前不可访问。你仍可管理自己的需求。" :
        list.childElementCount ? "" : "还没有关联的需求。";
      form.hidden = demand !== null;
      if (!form.hidden && focusDemandForm) {
        focusDemandForm = false;
        form.elements.title.focus();
      }
    }
    linkForm.onsubmit = async (event) => {
      event.preventDefault();
      if (linkSubmit.disabled || !linkChoice.value) return;
      linkSubmit.disabled = true;
      try {
        await write(endpoint + "/" + encodeURIComponent(linkChoice.value) + "/product", product, "PUT");
        await refresh();
        message.textContent = "已关联此商品版本。";
      } catch (error) { message.textContent = error.message; }
      finally { linkSubmit.disabled = false; }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const payload = demandInput();
      const signature = JSON.stringify(payload);
      if (demandAttempt?.signature !== signature) demandAttempt = { signature, requestId: crypto.randomUUID() };
      saveDemandDraft();
      submit.disabled = true;
      form.elements.title.readOnly = form.elements.body.readOnly = true;
      form.elements.public.disabled = true;
      try {
        await write(endpoint, { ...payload, requestId: demandAttempt.requestId });
        demandAttempt = null;
        form.reset();
        saveDemandDraft();
        await refresh();
        message.textContent = "已保存需求。";
      } catch (error) {
        if (error.code === "DEMAND_PUBLIC_NODE_REQUIRED") {
          demandAttempt = null;
          canPublishDemand = false;
          form.elements.public.checked = false;
          element("demand-public-unavailable").hidden = false;
          saveDemandDraft();
        }
        message.textContent = error instanceof TypeError && demandAttempt
          ? "尚未收到保存结果。内容仍在这里，可以再次点击保存核对。"
          : error.message;
      }
      finally {
        submit.disabled = false;
        form.elements.title.readOnly = form.elements.body.readOnly = false;
        form.elements.public.disabled = !canPublishDemand;
      }
    };
    section.hidden = false;
    if (back) {
      back.hidden = true;
      back.href = "?" + nodeQuery;
      back.textContent = "查看同一节点的需求";
      list.before(back);
    }
    function refreshReaderDemand() {
      if (!ownsDemand) void refresh().catch((error) => { message.textContent = error.message; });
    }
    if (demand !== null) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshReaderDemand();
      });
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) refreshReaderDemand();
      });
    }
    try { await refresh(); } catch (error) { message.textContent = error.message; }
  }

  async function discover(view) {
    const practice = view === "practice";
    const tutorials = view === "tutorial-search";
    const label = practice ? "实践" : tutorials ? "教程" : "需求";
    element("product-title").textContent = practice ? "发现实践" : label + "搜索";
    status.hidden = true;
    const section = element("demand-search");
    const message = element("demand-search-status");
    const q = query.get("q") || "";
    const authoredContent = practice || tutorials;
    element("my-demand-answers-search-link").hidden = authoredContent;
    const authorId = query.get("authorId");
    const canFollow = (authoredContent || !authorId) && window.KHTRuntime?.communityUrl === "/review/";
    const canSearchMine = practice && !authorId && !query.get("nodeId");
    const scope = canFollow && query.get("scope") === "following" ? "following" :
      (canSearchMine || (view === "discover" && !authorId)) && query.get("scope") === "mine" ? "mine" : "public";
    if (practice && scope === "mine") element("product-title").textContent = "我的实践";
    const order = !tutorials && query.get("order") === "latest" ? "latest" : "relevance";
    const orderParams = tutorials ? {} : { order };
    const treeId = query.get("treeId") || "";
    const nodeId = query.get("nodeId") || "";
    const nodeScope = !tutorials && treeId && nodeId;
    const nodeParams = nodeScope ? { treeId, nodeId } : {};
    const askInNode = element("demand-node-ask");
    askInNode.hidden = true;
    if (nodeScope && !practice) {
      askInNode.href = "?" + new URLSearchParams({ view: "demands", tree: treeId, node: nodeId }) + "#demand-form";
    }
    const tutorialId = query.get("tutorialId");
    const tutorialVersion = query.get("tutorialVersion");
    const versionScope = practice && nodeScope && tutorialId && tutorialVersion;
    const versionParams = versionScope ? { tutorialId, tutorialVersion } : {};
    const authorParams = authorId ? { authorId } : {};
    const searchParams = { view, q, scope, ...orderParams };
    for (const name of ["treeId", "nodeId", "tutorialId", "tutorialVersion"]) {
      const field = section.querySelector(`[name=${name}]`);
      field.value = nodeParams[name] || versionParams[name] || "";
      field.disabled = !field.value;
    }
    if (nodeScope) {
      element("product-title").textContent = practice ? "这个节点的公开实践" : "这个节点的需求";
      element("practice-node-filter").hidden = false;
      element("practice-node-back").href = "./#node/" + [treeId, nodeId].map(encodeURIComponent).join("/");
      element("practice-node-clear").href = "?" + new URLSearchParams({ ...searchParams, ...authorParams });
    }
    const orderField = section.querySelector("[name=order]");
    const responseField = section.querySelector("[name=responseState]");
    const responseState = query.get("responseState");
    responseField.value = ["unanswered", "answered", "accepted"].includes(responseState) ? responseState : "all";
    responseField.disabled = authoredContent;
    responseField.closest("label").hidden = authoredContent;
    orderField.disabled = tutorials;
    orderField.closest("label").hidden = tutorials;
    orderField.value = order;
    const page = /^[1-9][0-9]{0,5}$/.test(query.get("page") || "") ? Number(query.get("page")) : 1;
    section.querySelector("[name=q]").value = q;
    section.querySelector("[name=view]").value = view;
    const authorField = section.querySelector("[name=authorId]");
    authorField.disabled = !authorId;
    authorField.value = authorId || "";
    if (authorId && /^[A-Za-z0-9_-]{1,64}$/.test(authorId)) {
      element("product-title").textContent = nodeScope ? "这位作者在该节点的公开" + label : "这位作者的公开" + label;
      element("practice-author-filter").hidden = false;
      element("practice-author-back").href = "./#person/" + encodeURIComponent(authorId);
      element("practice-author-clear").href = "?" + new URLSearchParams({ ...searchParams, ...nodeParams, ...versionParams });
    }
    if (versionScope) {
      element("product-title").textContent = authorId ? "这位作者使用该版本的公开实践" : "使用该版本的公开实践";
      element("practice-version-filter").hidden = false;
      element("practice-version-back").href = "./#node/" + [treeId, nodeId, "tutorial", tutorialId, tutorialVersion].map(encodeURIComponent).join("/");
      element("practice-version-clear").href = "?" + new URLSearchParams({ ...searchParams, ...authorParams, ...nodeParams });
    }
    const scopeField = section.querySelector("[name=scope]");
    if (authoredContent) {
      scopeField.replaceChildren(new Option("全部公开" + label, "public"));
      if (canFollow) scopeField.append(new Option("只看关注作者", "following"));
      if (canSearchMine) scopeField.append(new Option("我的实践", "mine"));
    } else if (canFollow) scopeField.append(new Option("只看关注作者", "following"));
    scopeField.value = scope;
    scopeField.disabled = (authoredContent && !canFollow && !canSearchMine) || (!authoredContent && Boolean(authorId));
    scopeField.closest("label").hidden = scopeField.disabled;
    const visibilityField = section.querySelector("[name=visibility]");
    const visibility = query.get("visibility");
    visibilityField.value = ["public", "private"].includes(visibility) ? visibility : "all";
    const updateVisibilityField = () => {
      visibilityField.disabled = !practice || scopeField.value !== "mine";
      visibilityField.closest("label").hidden = visibilityField.disabled;
    };
    scopeField.addEventListener("change", updateVisibilityField);
    updateVisibilityField();
    element("practice-follow-manage").hidden = scope !== "following";
    section.setAttribute("aria-label", "搜索" + label);
    element("demand-pages").setAttribute("aria-label", label + "搜索分页");
    section.hidden = false;
    message.textContent = `正在读取${label}…`;
    try {
      const endpoint = practice ? "/api/records" : tutorials ? "/api/tutorial-search" : "/api/knowledge-demands";
      const filters = { q, scope, ...orderParams, ...authorParams, ...nodeParams, ...versionParams,
        ...(!authoredContent ? { responseState: responseField.value } : {}),
        ...(practice && scope === "mine" ? { visibility: visibilityField.value } : {}) };
      const response = await fetch(endpoint + "?" + new URLSearchParams({ ...filters, page }));
      if (response.status === 401) throw loginRequired();
      const data = await response.json();
      if (nodeScope && !practice) askInNode.hidden = !data.nodeAvailable;
      if (!response.ok) throw new Error(data.message || "暂时无法读取结果，请刷新后重试。");
      if (practice && scope === "mine" && Number.isInteger(data.lastPage) && data.lastPage >= 1 && page > data.lastPage) {
        window.location.replace("?" + new URLSearchParams({ view, ...filters, page: data.lastPage }));
        return;
      }
      const list = element("demand-results");
      const items = practice ? data.records : data.items;
      for (const item of items) {
        if (practice) {
          list.append(practiceResult(item, false, scope === "mine"));
          continue;
        }
        const row = document.createElement("li");
        const link = document.createElement("a");
        if (tutorials) {
          const parts = [item.treeId, item.nodeId, "tutorial", item.id, item.version].map(encodeURIComponent);
          link.href = "./#node/" + parts.join("/");
          link.textContent = item.title;
          row.className = "practice-result";
          row.append(link, " · ");
          if (item.authorId) {
            const author = document.createElement("a");
            author.href = "./#person/" + encodeURIComponent(item.authorId);
            author.textContent = item.authorName;
            row.append(author);
          } else {
            row.append(item.authorName);
          }
          row.append(` · ${item.nodeTitle}`);
          if (item.startAction) {
            const action = document.createElement("p");
            action.textContent = item.startAction;
            row.append(action);
          }
          list.append(row);
          continue;
        }
        const detailUrl = "?" + new URLSearchParams({ view: "demands", tree: item.treeId, node: item.nodeId, demand: item.id });
        link.href = detailUrl +
          (item.matchedAnswerId ? "#answer-" + encodeURIComponent(item.matchedAnswerId) : "");
        link.textContent = item.title;
        row.append(link, ` · ${item.nodeTitle || "节点不可访问"}${scope === "mine" ? item.visibility === "public" ? " · 已设为公开" : " · 私人" : ""}`);
        if (item.visibility === "public") row.append(demandAnswerSummary(item));
        if (item.matchedAnswerId) row.append(" · 关键词出现在回应中");
        if (item.acceptedAnswerId && item.acceptedAnswerId !== item.matchedAnswerId) row.append(" · ", acceptedDemandLink(item, detailUrl));
        list.append(row);
      }
      const pages = element("demand-pages");
      for (const [enabled, destination, label] of [[page > 1, page - 1, "上一页"], [data.hasNext, page + 1, "下一页"]]) {
        if (!enabled) continue;
        const link = document.createElement("a");
        link.href = "?" + new URLSearchParams({ view, ...filters, page: destination });
        link.textContent = label;
        pages.append(link);
      }
      message.textContent = items.length ? "" : scope === "following" ? `没有符合条件的关注作者${label}。` :
        `没有找到符合条件的${practice && scope !== "mine" ? "公开实践" : label}。`;
    } catch (error) { message.textContent = error.message; }
  }

  function practiceResult(item, detail = false, showVisibility = false) {
    const row = document.createElement("li");
    row.className = "practice-result";
    const author = document.createElement("a");
    author.href = "./#person/" + encodeURIComponent(item.authorId);
    author.textContent = item.authorName;
    const body = document.createElement("p");
    body.textContent = item.text;
    row.append(author, body);
    const time = document.createElement("time");
    const date = new Date(item.createdAt);
    if (Number.isFinite(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleString("zh-CN");
      row.append(time);
    }
    if ((detail || showVisibility) && item.visibility === "private") row.append(" · 仅自己可见");
    else if (showVisibility) row.append(" · 公开分享");
    if (!detail) {
      const link = document.createElement("a");
      link.href = practiceDetailLink(item.id);
      link.textContent = "查看实践详情";
      if (showVisibility) link.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        try {
          sessionStorage.setItem("kht-practice-return", JSON.stringify({ recordId: item.id, search: window.location.search }));
        } catch { /* 当前浏览器可能无法读写本地存储或访问可选接口。 */ }
      });
      row.append(" · ", link);
    }
    for (const [index, picture] of (item.images || []).entries()) {
      const image = document.createElement("img");
      image.src = "/api/media/" + encodeURIComponent(picture.id);
      image.alt = `实践配图 ${index + 1}`;
      image.loading = "lazy";
      row.append(image);
    }
    const node = "./#node/" + encodeURIComponent(item.treeId) + "/" + encodeURIComponent(item.nodeId);
    const target = document.createElement("a");
    target.href = node;
    target.textContent = "查看知识节点";
    row.append(target);
    if (item.tutorialId && item.tutorialVersion) {
      const source = document.createElement("a");
      source.href = node + "/tutorial/" + encodeURIComponent(item.tutorialId) + "/" + encodeURIComponent(item.tutorialVersion);
      source.textContent = item.tutorialArchived ? "查看所用教程版本（已归档）" : "查看所用教程版本";
      row.append(" · ", source);
    } else if (item.tutorialUnavailable) {
      row.append(" · 原教程版本目前不可访问");
    }
    return row;
  }

  const practiceDetailLink = (record) => "?" + new URLSearchParams({ view: "practice-detail", record });
  const readPracticePage = (params) => {
    const page = params.get("page");
    return /^[1-9][0-9]{0,5}$/.test(page || "") ? Number(page) : 1;
  };
  const markPracticeMessageRead = (record, comment, ownerId) =>
    fetch("/api/records/" + encodeURIComponent(record) + "/discussion/" + encodeURIComponent(comment) + "/read",
      { method: "POST", headers: { "X-Action-Account": ownerId } });

  function renderPracticePagination(prefix, requestedPage, currentPage, hasNext, pageLink) {
    if (currentPage !== requestedPage) window.history.replaceState(window.history.state, "", pageLink(currentPage));
    const previous = element(prefix + "-previous");
    const next = element(prefix + "-next");
    previous.hidden = currentPage <= 1;
    next.hidden = !hasNext;
    previous.href = pageLink(Math.max(1, currentPage - 1));
    next.href = pageLink(currentPage + 1);
    element(prefix + "-pages").hidden = previous.hidden && next.hidden;
  }

  let practiceRepliesRequest = 0;
  async function showPracticeReplies() {
    const request = ++practiceRepliesRequest;
    element("product-title").textContent = "收到的留言与回复";
    status.textContent = "正在读取回复…";
    const section = element("practice-replies");
    const list = element("practice-reply-list");
    const scope = element("practice-reply-scope");
    const pages = element("practice-reply-pages");
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("scope") === "unread" ? "unread" : "all";
    const page = readPracticePage(params);
    const linkTo = (scope, page) => "?" + new URLSearchParams({ view: "practice-replies", scope, page });
    section.hidden = true;
    pages.hidden = true;
    list.replaceChildren();
    try {
      const response = await fetch("/api/practice-replies?" + new URLSearchParams({ scope: filter, page }));
      if (request !== practiceRepliesRequest) return;
      if (response.status === 401) throw loginRequired();
      if (!response.ok) throw new Error("暂时无法读取回复，请刷新后重试。");
      const { ownerId, replies, page: currentPage, hasNext } = await response.json();
      if (request !== practiceRepliesRequest) return;
      element("product-login").hidden = true;
      async function markReadAndRefresh(button, send) {
        button.disabled = true;
        try {
          const result = await send();
          if (!result.ok && ![401, 404, 409].includes(result.status)) throw new Error();
          await showPracticeReplies();
        } catch {
          if (request !== practiceRepliesRequest) return;
          status.textContent = "标记已读失败，请重试。";
          button.disabled = false;
        }
      }
      const readPage = element("practice-reply-read-page");
      const unreadIds = replies.filter((item) => item.unread).map((item) => item.id);
      readPage.hidden = unreadIds.length < 2;
      readPage.disabled = false;
      readPage.onclick = () => markReadAndRefresh(readPage, () => fetch("/api/practice-replies/read-page", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Action-Account": ownerId },
        body: JSON.stringify({ ids: unreadIds })
      }));
      for (const item of replies) {
        const row = document.createElement("li");
        row.className = "practice-result";
        const link = document.createElement("a");
        link.href = practiceDetailLink(item.recordId) + "#comment-" + encodeURIComponent(item.id);
        const kind = item.kind === "comment" ? "留言" : "回复";
        link.textContent = item.unread ? "查看未读" + kind : "查看" + kind;
        const text = document.createElement("p");
        text.textContent = item.text;
        row.append(item.authorName, text, link);
        if (item.unread) {
          const markRead = document.createElement("button");
          markRead.type = "button";
          markRead.textContent = "标为已读";
          markRead.onclick = () => markReadAndRefresh(markRead, () => markPracticeMessageRead(item.recordId, item.id, ownerId));
          row.append(markRead);
        }
        list.append(row);
      }
      renderPracticePagination("practice-reply", page, currentPage, hasNext, (page) => linkTo(filter, page));
      scope.value = filter;
      scope.onchange = () => { window.location.href = linkTo(scope.value, 1); };
      status.textContent = replies.length ? "" : filter === "unread" ? "没有未读留言或回复。" : "还没有收到留言或回复。";
      section.hidden = false;
    } catch (error) {
      if (request === practiceRepliesRequest) status.textContent = error.message;
    }
  }

  let myPracticeCommentsRequest = 0;
  async function showMyPracticeComments(successMessage = "") {
    const request = ++myPracticeCommentsRequest;
    element("product-title").textContent = "我的留言";
    const section = element("my-practice-comments");
    const list = element("my-practice-comment-list");
    const page = readPracticePage(new URLSearchParams(window.location.search));
    section.hidden = true;
    list.replaceChildren();
    status.textContent = "正在读取留言…";
    try {
      const response = await fetch("/api/practice-comments/mine?" + new URLSearchParams({ page }));
      if (request !== myPracticeCommentsRequest) return;
      if (response.status === 401) throw loginRequired();
      if (!response.ok) throw new Error("暂时无法读取留言，请刷新后重试。");
      const { ownerId, comments, page: currentPage, hasNext } = await response.json();
      if (request !== myPracticeCommentsRequest) return;
      element("product-login").hidden = true;
      for (const item of comments) {
        const row = document.createElement("li");
        row.className = "practice-result";
        const text = document.createElement("p");
        text.textContent = item.text;
        row.append(text);
        if (item.available) {
          const link = document.createElement("a");
          link.href = practiceDetailLink(item.recordId) + "#comment-" + encodeURIComponent(item.id);
          link.textContent = "查看这条留言";
          row.append(link);
        } else row.append(item.deleted ? "原实践已删除。" : "原实践目前不可访问。");
        const withdraw = document.createElement("button");
        withdraw.textContent = "撤回留言";
        withdraw.onclick = async () => {
          withdraw.disabled = true;
          try {
            const url = "/api/records/" + encodeURIComponent(item.recordId) + "/discussion/" + encodeURIComponent(item.id) + "/withdraw";
            const result = await fetch(url, { method: "POST", headers: { "X-Action-Account": ownerId } });
            if (result.status === 401 || result.status === 409) {
              await showMyPracticeComments();
              return;
            }
            if (!result.ok) throw new Error((await result.json()).message || "暂时无法撤回留言，请重试。");
            await showMyPracticeComments("已撤回留言。");
          } catch (error) {
            if (request === myPracticeCommentsRequest) status.textContent = error.message;
            withdraw.disabled = false;
          }
        };
        row.append(withdraw);
        list.append(row);
      }
      renderPracticePagination("my-practice-comment", page, currentPage, hasNext,
        (page) => "?" + new URLSearchParams({ view: "my-practice-comments", page }));
      section.hidden = false;
      status.textContent = comments.length ? successMessage : successMessage + "没有可管理的留言。";
    } catch (error) {
      if (request === myPracticeCommentsRequest) status.textContent = error.message;
    }
  }

  async function savePracticeBookmark(record, ownerId, saved) {
    const response = await fetch("/api/practice-bookmarks/" + encodeURIComponent(record), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Action-Account": ownerId },
      body: JSON.stringify({ saved })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "收藏操作失败，请刷新后重试。");
  }

  let practiceBookmarksRequest = 0;
  async function showPracticeBookmarks(afterRemoval = false) {
    const request = ++practiceBookmarksRequest;
    element("product-title").textContent = "实践收藏";
    element("practice-collection").hidden = false;
    const list = element("practice-bookmarks");
    const page = readPracticePage(new URLSearchParams(window.location.search));
    element("practice-bookmark-list-pages").hidden = true;
    list.hidden = true;
    list.replaceChildren();
    status.textContent = "正在读取收藏…";
    try {
      const response = await fetch("/api/practice-bookmarks?" + new URLSearchParams({ page }));
      if (request !== practiceBookmarksRequest) return;
      if (response.status === 401) throw loginRequired();
      if (!response.ok) throw new Error("暂时无法读取收藏，请刷新后重试。");
      const { ownerId, items, page: currentPage, hasNext } = await response.json();
      if (request !== practiceBookmarksRequest) return;
      element("product-login").hidden = true;
      for (const item of items) {
        const row = document.createElement("li");
        if (item.record) {
          const link = document.createElement("a");
          link.href = practiceDetailLink(item.recordId);
          link.textContent = item.record.text || "查看配图实践";
          row.append(link, " · " + item.record.authorName);
        } else row.append(item.missing ? "找不到这条实践。" : "这条实践目前不可访问。");
        const remove = document.createElement("button");
        remove.textContent = "取消收藏";
        remove.onclick = async () => {
          remove.disabled = true;
          try {
            await savePracticeBookmark(item.recordId, ownerId, false);
            await showPracticeBookmarks(true);
          } catch (error) {
            if (request === practiceBookmarksRequest) status.textContent = error.message;
            remove.disabled = false;
          }
        };
        row.append(remove);
        list.append(row);
      }
      renderPracticePagination("practice-bookmark-list", page, currentPage, hasNext,
        (page) => "?" + new URLSearchParams({ view: "practice-bookmarks", page }));
      list.hidden = false;
      status.textContent = items.length ? (afterRemoval ? "已取消收藏。" : "") : "还没有收藏实践。";
    } catch (error) {
      if (request === practiceBookmarksRequest) status.textContent = error.message;
    }
  }

  async function showPractice() {
    element("product-title").textContent = "实践详情";
    element("practice-detail").hidden = false;
    status.textContent = "正在读取实践…";
    const id = query.get("record") || "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      status.textContent = "这条实践目前不可访问。";
      return;
    }
    try {
      const response = await fetch("/api/records/" + encodeURIComponent(id));
      if (response.status === 401) throw loginRequired();
      if (response.status === 404) throw new Error("这条实践目前不可访问。");
      if (!response.ok) throw new Error("暂时无法读取实践，请刷新后重试。");
      const { record, ownerId, canBookmark, bookmarked, revision } = await response.json();
      const content = element("practice-detail-content");
      content.append(practiceResult(record, true));
      const refreshDiscussion = canBookmark ? showPracticeDiscussion(record.id, ownerId) : null;
      const panel = element("practice-detail");
      const bookmarkButton = element("practice-bookmark");
      let saved = bookmarked;
      let bookmarkChange = 0;
      let renderedRecord = JSON.stringify(record);
      let verification = 0;
      function renderBookmark() {
        bookmarkButton.textContent = saved ? "取消收藏" : "收藏实践";
        bookmarkButton.hidden = !canBookmark && !saved;
      }
      async function verifyPractice() {
        const request = ++verification;
        const bookmarkVersion = bookmarkChange;
        try {
          const latest = await fetch("/api/records/" + encodeURIComponent(id), { cache: "no-store" });
          if (latest.ok) {
            const data = await latest.json();
            if (request !== verification) return;
            const latestRecord = JSON.stringify(data.record);
            const editing = Boolean(revision && !element("practice-edit-form").hidden);
            if (editing && data.ownerId === ownerId && data.revision) {
              if (!data.canBookmark) {
                element("practice-discussion").hidden = true;
                element("practice-copy-link").hidden = true;
                element("practice-copy-fallback").hidden = true;
              }
              panel.hidden = false;
              status.hidden = true;
              return;
            }
            if (data.ownerId === ownerId && data.canBookmark === canBookmark &&
                (revision ? data.revision === revision && latestRecord === renderedRecord : !data.revision)) {
              if (latestRecord !== renderedRecord) {
                content.replaceChildren(practiceResult(data.record, true));
                renderedRecord = latestRecord;
              }
              if (!bookmarkButton.disabled && bookmarkVersion === bookmarkChange) {
                saved = data.bookmarked;
                renderBookmark();
              }
              await refreshDiscussion?.();
              if (request === verification) {
                panel.hidden = false;
                status.hidden = true;
              }
              return;
            }
          } else if (![401, 404].includes(latest.status)) throw new Error();
        } catch {
          if (request === verification && panel.hidden) {
            status.hidden = false;
            status.textContent = "暂时无法核对访问权限，请重新切回此页重试。";
          }
          return;
        }
        if (request !== verification) return;
        panel.hidden = true;
        window.location.reload();
      }
      window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        panel.hidden = true;
        void verifyPractice();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") {
          verification += 1;
          panel.hidden = true;
          return;
        }
        void verifyPractice();
      });
      if (revision) {
        const back = element("practice-mine-back");
        try {
          const previous = JSON.parse(sessionStorage.getItem("kht-practice-return"));
          sessionStorage.removeItem("kht-practice-return");
          const search = previous?.recordId === id ? previous.search : window.history.state?.practiceReturn;
          const params = new URLSearchParams(search);
          if (params.get("view") === "practice" && params.get("scope") === "mine") {
            back.href = "?" + params;
            window.history.replaceState({ ...window.history.state, practiceReturn: search }, "");
          }
        } catch { /* 当前浏览器可能无法读写本地存储或访问可选接口。 */ }
        back.hidden = false;
        enablePracticeEdit(record, ownerId, revision, content, verifyPractice);
      }
      if (canBookmark || bookmarked) {
        const message = element("practice-share-status");
        renderBookmark();
        bookmarkButton.onclick = async () => {
          bookmarkChange += 1;
          bookmarkButton.disabled = true;
          try {
            await savePracticeBookmark(record.id, ownerId, !saved);
            saved = !saved;
            renderBookmark();
            message.textContent = saved ? "已加入实践收藏。" : "已取消收藏。";
          } catch (error) { message.textContent = error.message; }
          finally {
            bookmarkChange += 1;
            bookmarkButton.disabled = false;
          }
        };
      }
      if (canBookmark) {
        const copy = element("practice-copy-link");
        const fallback = element("practice-copy-fallback");
        const message = element("practice-share-status");
        const link = new URL(window.location.pathname, window.location.origin);
        link.search = new URLSearchParams({ view: "practice-detail", record: record.id });
        copy.hidden = false;
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(link.href);
            fallback.hidden = true;
            message.textContent = "已复制实践链接。";
          } catch {
            const field = fallback.querySelector("input");
            field.value = link.href;
            fallback.hidden = false;
            field.select();
            message.textContent = "请手动复制链接。";
          }
        };
      }
      status.hidden = true;
    } catch (error) { status.textContent = error.message; }
  }

  function enablePracticeEdit(record, ownerId, revision, content, verifyPractice) {
    const edit = element("practice-edit");
    const visibility = element("practice-visibility");
    const form = element("practice-edit-form");
    const field = form.elements.text;
    const save = form.querySelector("button");
    const cancel = element("practice-edit-cancel");
    const message = element("practice-edit-status");
    const conflict = element("practice-edit-conflict");
    const currentText = conflict.querySelector("p");
    function clearConflict() {
      conflict.hidden = true;
      currentText.textContent = "";
      save.textContent = "保存正文";
    }
    const endpoint = "/api/records/" + encodeURIComponent(record.id);
    const initialVisibility = record.visibility;
    const nextVisibility = initialVisibility === "private" ? "public" : "private";
    const publishUnavailable = nextVisibility === "public" && record.tutorialArchived;
    visibility.textContent = nextVisibility === "public" ? "公开分享这次实践" : "撤回分享，保留私人记录";
    visibility.hidden = Boolean(publishUnavailable);
    visibility.onclick = async () => {
      visibility.disabled = true;
      edit.disabled = true;
      try {
        const response = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": revision, "X-Action-Account": ownerId },
          body: JSON.stringify({ visibility: nextVisibility })
        });
        const result = await response.json();
        if (result.code === "PRACTICE_REVISION_CHANGED") {
          if (result.current.visibility !== record.visibility) {
            window.location.reload();
            return;
          }
          record.text = result.current.text;
          revision = result.current.revision;
          content.replaceChildren(practiceResult(record, true));
          message.textContent = "正文已更新，请核对后再点公开分享。";
          visibility.disabled = false;
          edit.disabled = false;
          return;
        }
        if (!response.ok) throw new Error(result.message || "分享状态修改失败，请重试。");
        window.location.reload();
      } catch (error) {
        message.textContent = error.message;
        visibility.disabled = false;
        edit.disabled = false;
      }
    };
    edit.hidden = false;
    edit.onclick = () => {
      field.value = record.text;
      edit.hidden = true;
      visibility.hidden = true;
      form.hidden = false;
      field.focus();
    };
    cancel.onclick = () => {
      if (save.disabled) return;
      clearConflict();
      message.textContent = "";
      form.hidden = true;
      edit.hidden = false;
      visibility.hidden = Boolean(publishUnavailable);
      edit.focus();
      void verifyPractice();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const draft = field.value;
      save.disabled = true;
      cancel.disabled = true;
      try {
        const response = await fetch(endpoint + "/text", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": revision, "X-Action-Account": ownerId },
          body: JSON.stringify({ text: draft })
        });
        const result = await response.json();
        if (response.status === 409 && result.current?.revision) {
          const latest = result.current;
          const visibilityChanged = latest.visibility !== record.visibility;
          record.text = latest.text;
          record.visibility = latest.visibility;
          revision = latest.revision;
          content.replaceChildren(practiceResult(record, true));
          if (visibilityChanged) void verifyPractice();
          currentText.textContent = latest.text || "（正文为空）";
          conflict.hidden = false;
          save.textContent = "用我的草稿替换正文";
          message.textContent = visibilityChanged
            ? `另一窗口已将实践改为${latest.visibility === "private" ? "私密" : "公开"}。请核对后决定是否按当前可见范围保存草稿。`
            : "另一窗口已保存更新。你的草稿仍在，可对照后决定是否替换。";
          return;
        }
        if (!response.ok) throw new Error(result.message || "实践正文保存失败，请重试。");
        record.text = result.text;
        revision = result.revision;
        content.replaceChildren(practiceResult(record, true));
        clearConflict();
        if (field.value === draft) {
          if (record.visibility !== initialVisibility) {
            window.location.reload();
            return;
          }
          form.hidden = true;
          edit.hidden = false;
          visibility.hidden = Boolean(publishUnavailable);
          edit.focus();
        }
        message.textContent = "已保存实践正文。";
      } catch (error) { message.textContent = error.message; }
      finally { save.disabled = false; cancel.disabled = false; }
    };
  }

  function showPracticeDiscussion(recordId, ownerId) {
    const url = "/api/records/" + encodeURIComponent(recordId) + "/discussion";
    const section = element("practice-discussion");
    const list = element("practice-comments");
    const form = element("practice-comment-form");
    const field = form.elements.text;
    const submit = form.querySelector("button:not([type=button])");
    const message = element("practice-comment-status");
    const replyTarget = element("practice-reply-target");
    const cancelReply = element("practice-reply-cancel");
    const older = element("practice-comments-older");
    const newer = element("practice-comments-newer");
    let replyingTo = null;
    let replyUnavailable = false;
    let posting = false;
    let attempt;
    const commentFromHash = () => /^#comment-([a-f0-9]{32})$/.exec(window.location.hash)?.[1];
    function openLinkedComment() {
      const id = commentFromHash();
      if (id) void refresh({ around: id }, true).catch((error) => { message.textContent = error.message; });
    }
    function renderReplyTarget() {
      replyTarget.hidden = !replyingTo;
      replyTarget.querySelector("span").textContent = replyUnavailable
        ? "原留言已撤回，草稿仍在下方。"
        : replyingTo ? "回复 " + replyingTo.authorName : "";
      cancelReply.textContent = replyUnavailable ? "改为新留言" : "取消回复";
      cancelReply.disabled = posting;
      submit.textContent = replyingTo ? "发布回复" : "发布留言";
      submit.disabled = posting || replyUnavailable;
    }
    function selectReply(comment) {
      replyingTo = comment;
      replyUnavailable = false;
      renderReplyTarget();
    }
    cancelReply.onclick = () => {
      if (posting) return;
      selectReply(null);
      field.focus();
    };
    async function post(endpoint, body) {
      const response = await fetch(endpoint, { method: "POST", headers: {
        "Content-Type": "application/json", "X-Action-Account": ownerId
      }, body: JSON.stringify(body) });
      if ([401, 404, 409].includes(response.status)) await refresh();
      if (!response.ok) throw new Error((await response.json()).message || "留言操作失败，请重试。");
    }
    let generation = 0;
    let lastPage = {};
    async function refresh(page = {}, focusLinkedComment = false) {
      const request = ++generation;
      const params = new URLSearchParams(page);
      if (replyingTo) params.set("replyTarget", replyingTo.id);
      const response = await fetch(url + "?" + params);
      const data = await response.json();
      if (request !== generation) return;
      if (!response.ok || data.ownerId !== ownerId) {
        form.hidden = true;
        older.hidden = newer.hidden = true;
        list.replaceChildren();
        throw new Error(data.message || "账号已变化，请刷新页面。");
      }
      lastPage = page;
      if (replyingTo && params.get("replyTarget") === replyingTo.id) {
        replyUnavailable = !data.replyTargetAvailable;
        renderReplyTarget();
      }
      older.hidden = !data.older;
      newer.hidden = !data.newer;
      older.onclick = () => { void refresh({ before: data.older }).catch((error) => { message.textContent = error.message; }); };
      newer.onclick = () => { void refresh({ after: data.newer }).catch((error) => { message.textContent = error.message; }); };
      list.replaceChildren();
      for (const comment of data.comments) {
        const row = document.createElement("li");
        row.className = "practice-result";
        row.id = "comment-" + comment.id;
        const author = document.createElement("a");
        author.href = "./#person/" + encodeURIComponent(comment.authorId);
        author.textContent = comment.authorName;
        const text = document.createElement("p");
        text.textContent = comment.text;
        row.append(author);
        if (comment.replyTo?.authorName) {
          const source = document.createElement("a");
          source.href = "#comment-" + comment.replyTo.id;
          source.textContent = "回复 " + comment.replyTo.authorName;
          source.onclick = (event) => {
            if (window.location.hash !== source.hash || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            openLinkedComment();
          };
          row.append(" · ", source);
        } else if (comment.replyTo) row.append(" · 原留言已撤回");
        row.append(text);
        const reply = document.createElement("button");
        reply.textContent = "回复";
        reply.onclick = () => {
          if (posting) return;
          selectReply(comment);
          field.focus();
        };
        row.append(reply);
        if (comment.own) {
          const withdraw = document.createElement("button");
          withdraw.textContent = "撤回留言";
          withdraw.onclick = async () => {
            withdraw.disabled = true;
            try {
              await post(url + "/" + encodeURIComponent(comment.id) + "/withdraw");
              await refresh(lastPage);
              message.textContent = "已撤回留言。";
            } catch (error) { message.textContent = error.message; withdraw.disabled = false; }
          };
          row.append(withdraw);
        }
        list.append(row);
      }
      form.hidden = false;
      message.textContent = data.comments.length ? "" : "还没有留言。";
      if (focusLinkedComment) {
        const id = page.around;
        const target = element("comment-" + id);
        if (target) {
          target.tabIndex = -1;
          target.focus();
          if (data.comments.find((comment) => comment.id === id)?.received) {
            void markPracticeMessageRead(recordId, id, ownerId).catch(() => {});
          }
        } else message.textContent = "链接指向的回复目前不可访问。";
      }
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      const draft = field.value;
      const text = draft.trim();
      if (!text || submit.disabled) return;
      const parentId = replyingTo?.id || null;
      if (attempt?.text !== text || attempt?.parentId !== parentId) attempt = { text, parentId, requestId: crypto.randomUUID() };
      posting = true;
      renderReplyTarget();
      try {
        await post(url, attempt);
        attempt = null;
        if (field.value === draft) {
          field.value = "";
          selectReply(null);
        }
        await refresh();
        message.textContent = parentId ? "回复已发布。" : "留言已发布。";
      } catch (error) { message.textContent = error.message || "没有收到发布结果，可以重试。"; }
      finally {
        posting = false;
        renderReplyTarget();
      }
    };
    window.addEventListener("hashchange", openLinkedComment);
    section.hidden = false;
    if (commentFromHash()) openLinkedComment();
    else void refresh().catch((error) => { message.textContent = error.message; });
    return async () => {
      try {
        await refresh(lastPage);
      } catch (error) {
        list.replaceChildren();
        older.hidden = newer.hidden = true;
        message.textContent = error.message;
      }
    };
  }

  let wantsRequest = 0;
  async function showWants() {
    const request = ++wantsRequest;
    element("product-title").textContent = "我的想要";
    const list = element("want-list");
    list.hidden = true;
    list.replaceChildren();
    element("product-login").hidden = true;
    status.textContent = "";
    try {
      const data = await readWants("/api/product-wants", () => request === wantsRequest);
      if (request !== wantsRequest) return;
      const { items, ownerId } = data;
      for (const item of items) {
        const row = document.createElement("li");
        const product = document.createElement(item.productAvailable === false ? "span" : "a");
        if (item.productAvailable === false) product.textContent = item.label + "（关联商品暂不可访问）";
        else {
          product.href = "?" + new URLSearchParams({ tutorial: item.tutorial, version: item.version, material: item.material });
          product.textContent = item.label;
        }
        const visibility = document.createTextNode(item.visibility === "public" ? "，允许公开" : "，私人");
        row.append(product, ` · ¥${money(item.budgetCents)}`, visibility);
        if (item.visibility === "public") {
          const retract = document.createElement("button");
          retract.textContent = "撤回公开";
          retract.onclick = async () => {
            retract.disabled = true;
            try {
              await updateWant(wantUrl(item.tutorial, item.version, item.material), ownerId, "retract");
              await showWants();
            } catch (error) {
              if (request !== wantsRequest) return;
              status.textContent = error.message;
              retract.disabled = false;
            }
          };
          row.append(retract);
        }
        list.append(row);
      }
      list.hidden = false;
      status.textContent = items.length ? "" : "还没有收藏商品。可以从教程材料打开商品页并保存预算。";
    } catch (error) { if (request === wantsRequest) status.textContent = error.message; }
  }

  async function showProductWants() {
    const url = wantUrl(id, version, material);
    const form = element("want-form");
    const budget = element("want-budget");
    const publish = element("want-publish");
    const retract = element("want-retract");
    const message = element("want-status");
    let ownerId;
    let savedBudget;
    let busy = false;
    const refresh = async () => {
      const data = await readWants(url);
      if (ownerId && data.ownerId !== ownerId) {
        form.hidden = true;
        throw new Error("账号已变化，请刷新页面。");
      }
      ownerId = data.ownerId;
      savedBudget = data.own?.budgetCents;
      budget.value = data.own ? money(data.own.budgetCents) : "";
      publish.hidden = !data.canPublish || !data.own || data.own.visibility === "public";
      retract.hidden = data.own?.visibility !== "public";
      element("want-shared").textContent = data.shared.length ? "已公开预算：" + data.shared.map((item) => "¥" + money(item.budgetCents)).join("、") : "";
      form.hidden = false;
    };
    const change = async (action) => {
      if (busy) return;
      const raw = budget.value.trim();
      if (action === "save" && !/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) {
        message.textContent = "请输入金额，最多两位小数。";
        return;
      }
      busy = true;
      try {
        const amount = action === "save" ? Math.round(Number(raw) * 100) : action === "publish" ? savedBudget : undefined;
        await updateWant(url, ownerId, action, amount);
        await refresh();
        message.textContent = { save: "已保存为私人预算。", publish: "已公开已保存的预算。", retract: "已撤回公开。" }[action];
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; }
    };
    form.onsubmit = (event) => { event.preventDefault(); void change("save"); };
    publish.onclick = () => change("publish");
    retract.onclick = () => change("retract");
    try { await refresh(); } catch (error) { message.textContent = error.message; }
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(version) || !/^(?:[0-9]|1[01])$/.test(material)) {
      status.textContent = "商品链接缺少有效的教程或材料信息。";
      return;
    }
    try {
      const response = await fetch(`/api/tutorials/${id}/versions/${version}`, { credentials: "same-origin" });
      if (response.status === 401) throw loginRequired();
      if (response.status === 404) {
        status.textContent = "关联教程或版本目前不可访问。";
        return;
      }
      if (!response.ok) throw new Error("Could not load tutorial");
      const { tutorial } = await response.json();
      const resource = tutorial?.resources?.[Number(material)];
      if (!resource?.affiliate) {
        status.textContent = "这个版本没有对应的推广商品。";
        return;
      }
      const seller = new URL(resource.url);
      if (!["https:", "http:"].includes(seller.protocol) || seller.username || seller.password) throw new Error("Invalid seller link");

      element("product-title").textContent = resource.label;
      element("product-usage").textContent = resource.optional === false ? "教程所需材料" : "教程可选材料";
      element("seller-link").href = seller.href;
      element("source-title").textContent = tutorial.title;
      element("source-method").textContent = tutorial.method;
      element("source-link").href = `./#node/${encodeURIComponent(tutorial.treeId)}/${encodeURIComponent(tutorial.nodeId)}/tutorial/${id}/${version}`;
      element("product-content").hidden = false;
      status.hidden = true;
      void showProductWants();
      void showDemands(tutorial.treeId, tutorial.nodeId, { tutorial: id, version, material });
    } catch (error) {
      status.textContent = element("product-login").hidden ? "暂时无法读取商品信息，请刷新后重试。" : error.message;
    }
  }
  let myDemandAnswersRequest = 0;
  async function showMyDemandAnswers() {
    const request = ++myDemandAnswersRequest;
    const received = query.get("view") === "received-demand-answers";
    const authorView = query.get("view") === "author-demand-answers";
    const authorId = query.get("authorId") || "";
    element("product-title").textContent = authorView ? "作者的公开需求回应" : received ? "收到的需求回应" : "我的需求回应";
    const section = element("my-demand-answers");
    const exportLink = element("my-demand-answer-export");
    exportLink.hidden = true;
    const list = element("my-demand-answer-list");
    const filterLabel = element("received-demand-answer-filter");
    const unreadOnly = filterLabel.querySelector("input");
    const pages = element("received-demand-answer-pages");
    const scope = query.get("scope") === "unread" ? "unread" : "all";
    const page = /^[1-9][0-9]{0,5}$/.test(query.get("page") || "") ? query.get("page") : "1";
    filterLabel.hidden = true;
    pages.hidden = true;
    list.replaceChildren();
    section.hidden = false;
    status.textContent = "正在读取回应…";
    try {
      if (authorView && !/^[A-Za-z0-9_-]{1,64}$/.test(authorId)) throw new Error("找不到这位作者。");
      const path = authorView ? "author/" + encodeURIComponent(authorId) : received ? "received" : "mine";
      const endpoint = "/api/knowledge-demand-answers/" + path + "?" +
        new URLSearchParams(received ? { scope, page } : { page });
      const response = await fetch(endpoint);
      if (request !== myDemandAnswersRequest) return;
      if (response.status === 401) throw loginRequired();
      if (!response.ok) throw new Error("暂时无法读取回应，请刷新后重试。");
      const { ownerId, answers, page: currentPage, hasNext } = await response.json();
      if (request !== myDemandAnswersRequest) return;
      exportLink.hidden = received || authorView;
      for (const answer of answers) {
        const row = document.createElement("li");
        const text = document.createElement("p");
        text.textContent = answer.text;
        if (answer.title) {
          const link = document.createElement("a");
          link.href = "?" + new URLSearchParams({ view: "demands", tree: answer.treeId, node: answer.nodeId,
            demand: answer.demandId }) + "#answer-" + answer.id;
          link.textContent = answer.title;
          row.append(link);
          if (received) row.append(" · " + answer.authorName + (answer.unread ? " · 未读" : ""));
          if (answer.accepted) row.append(" · 提问者已采纳");
        } else row.append("原需求目前不可访问。");
        row.append(text);
        if (received || authorView) {
          list.append(row);
          continue;
        }
        const withdraw = document.createElement("button");
        withdraw.textContent = "撤回回应";
        withdraw.onclick = async () => {
          withdraw.disabled = true;
          try {
            const segments = [answer.treeId, answer.nodeId, answer.demandId].map(encodeURIComponent);
            const url = "/api/knowledge-demands/" + segments.join("/") + "/answers/" + encodeURIComponent(answer.id) + "/withdraw";
            const result = await fetch(url, { method: "POST", headers: { "X-Action-Account": ownerId } });
            if (result.status === 401 || result.status === 409) return void showMyDemandAnswers();
            if (!result.ok) throw new Error("暂时无法撤回回应，请重试。");
            await showMyDemandAnswers();
          } catch (error) {
            if (request === myDemandAnswersRequest) status.textContent = error.message;
            withdraw.disabled = false;
          }
        };
        row.append(withdraw);
        list.append(row);
      }
      const pageLink = (targetScope, targetPage) => "?" + new URLSearchParams({
        view: query.get("view"),
        ...(authorView ? { authorId } : {}),
        ...(received ? { scope: targetScope } : {}), page: targetPage
      });
      if (currentPage !== Number(page)) {
        query.set("page", String(currentPage));
        window.history.replaceState(window.history.state, "", pageLink(scope, currentPage));
      }
      if (received) {
        unreadOnly.checked = scope === "unread";
        unreadOnly.onchange = () => {
          window.location.assign(pageLink(unreadOnly.checked ? "unread" : "all", 1));
        };
        filterLabel.hidden = false;
        status.textContent = answers.length ? "" : scope === "unread" ? "没有未读需求回应。" : "还没有收到需求回应。";
      } else status.textContent = answers.length ? "" : authorView ? "这位作者还没有公开的需求回应。" : "还没有可管理的需求回应。";
      const previous = element("received-demand-answer-previous");
      const next = element("received-demand-answer-next");
      previous.hidden = currentPage <= 1;
      next.hidden = !hasNext;
      previous.href = pageLink(scope, currentPage - 1);
      next.href = pageLink(scope, currentPage + 1);
      pages.hidden = previous.hidden && next.hidden;
    } catch (error) {
      if (request === myDemandAnswersRequest) status.textContent = error.message;
    }
  }

  let demandBookmarksRequest = 0;
  async function showDemandBookmarks() {
    const request = ++demandBookmarksRequest;
    const section = element("demand-bookmarks");
    const list = element("demand-bookmark-list");
    const pages = element("demand-bookmark-pages");
    element("product-title").textContent = "需求收藏";
    section.hidden = false;
    list.replaceChildren();
    pages.hidden = true;
    status.textContent = "正在读取收藏…";
    const page = /^[1-9][0-9]{0,5}$/.test(query.get("page") || "") ? query.get("page") : "1";
    const pageLink = (number) => "?" + new URLSearchParams({ view: "demand-bookmarks", page: number });
    try {
      const response = await fetch("/api/knowledge-demand-bookmarks?" + new URLSearchParams({ page }));
      if (request !== demandBookmarksRequest) return;
      if (response.status === 401) throw loginRequired();
      if (!response.ok) throw new Error("暂时无法读取收藏，请刷新后重试。");
      const { items, ownerId, page: currentPage, hasNext } = await response.json();
      if (request !== demandBookmarksRequest) return;
      for (const item of items) {
        const row = document.createElement("li");
        if (item.title) {
          const link = document.createElement("a");
          link.href = "?" + new URLSearchParams({ view: "demands", tree: item.treeId, node: item.nodeId, demand: item.demandId });
          link.textContent = item.title;
          row.append(link, demandAnswerSummary(item));
          if (item.acceptedAnswerId) row.append(" · ", acceptedDemandLink(item, link.href));
        } else row.append("原需求目前不可访问。");
        const remove = document.createElement("button");
        remove.textContent = "取消需求收藏";
        remove.onclick = async () => {
          remove.disabled = true;
          try {
            await setDemandBookmark(item.treeId, item.nodeId, item.demandId, ownerId, false);
            await showDemandBookmarks();
          } catch (error) {
            if (request === demandBookmarksRequest) status.textContent = error.message;
            remove.disabled = false;
          }
        };
        row.append(remove);
        list.append(row);
      }
      if (currentPage !== Number(page)) {
        query.set("page", String(currentPage));
        window.history.replaceState(window.history.state, "", pageLink(currentPage));
      }
      const previous = element("demand-bookmark-previous");
      const next = element("demand-bookmark-next");
      previous.hidden = currentPage <= 1;
      next.hidden = !hasNext;
      previous.href = pageLink(currentPage - 1);
      next.href = pageLink(currentPage + 1);
      pages.hidden = previous.hidden && next.hidden;
      status.textContent = items.length ? "" : "还没有收藏需求。";
    } catch (error) {
      if (request === demandBookmarksRequest) status.textContent = error.message;
    }
  }

  function loadReturningView(render) {
    window.addEventListener("pageshow", (event) => { if (event.persisted) void render(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void render();
    });
    void render();
  }

  let demandInboxCountRequest = 0;
  async function refreshDemandInboxCount() {
    const request = ++demandInboxCountRequest;
    const links = document.querySelectorAll('a[href="?view=received-demand-answers"]');
    try {
      const response = await fetch("/api/knowledge-demand-answers/received?summary=1");
      const data = response.ok ? await response.json() : null;
      if (request !== demandInboxCountRequest) return;
      for (const link of links) {
        link.textContent = data?.unreadCount > 0 ? "收到的需求回应（" + data.unreadCount + " 条未读）" : "收到的需求回应";
      }
    } catch {
      if (request === demandInboxCountRequest) for (const link of links) link.textContent = "收到的需求回应";
    }
  }

  if (query.get("view") === "wants") loadReturningView(showWants);
  else if (["discover", "practice", "tutorial-search"].includes(query.get("view"))) {
    if (query.get("view") === "discover") loadReturningView(refreshDemandInboxCount);
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      element("demand-search").hidden = true;
      window.location.reload();
    });
    void discover(query.get("view"));
  }
  else if (query.get("view") === "practice-detail") void showPractice();
  else if (query.get("view") === "practice-bookmarks") loadReturningView(showPracticeBookmarks);
  else if (query.get("view") === "practice-replies") loadReturningView(showPracticeReplies);
  else if (query.get("view") === "my-practice-comments") loadReturningView(showMyPracticeComments);
  else if (query.get("view") === "demand-bookmarks") loadReturningView(showDemandBookmarks);
  else if (["my-demand-answers", "received-demand-answers", "author-demand-answers"].includes(query.get("view"))) loadReturningView(showMyDemandAnswers);
  else if (query.get("view") === "demands") {
    loadReturningView(refreshDemandInboxCount);
    const demand = query.get("demand");
    element("product-title").textContent = demand === null ? "节点需求" : "需求详情";
    status.hidden = true;
    void showDemands(query.get("tree") || "", query.get("node") || "", null, demand);
  }
  else void load();
})();
