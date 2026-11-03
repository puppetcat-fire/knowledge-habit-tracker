(function bootstrapApp() {
  const STORAGE_KEY = "knowledge-habit-tracker";
  const BUG_CACHE_KEY = "knowledge-habit-tracker-bugs";
  const CUSTOM_NODES_KEY = "knowledge-habit-custom-nodes";
  const CUSTOM_HABIT_NAME = "自由记录";
  const MAX_BUG_CACHE = 20;
  const TREE_FORMAT = "forest-tree/v1";
  const STATE_VERSION = 3;
  const AIM_TTL_MS = 8 * 60 * 60 * 1000;
  const AIM_NOTICE_TEXT = {
    expired: "上次对着的那条已经过期",
    dangling: "上次那条已经不在了"
  };

  // 本地/单文件模式：不连服务端，行为与今天的 localStorage 完全一致
  const LOCAL_ONLY = globalThis.__KHT_LOCAL_ONLY__ === true;

  const defaultState = {
    version: STATE_VERSION,
    habit: null,
    habitHistory: [],
    events: [],
    timer: {
      elapsedMs: 0,
      running: false,
      startedAt: null,
      predictedAction: "",
      selectedOption: "custom",
      selectedHabitId: null,
      selectedHabitName: CUSTOM_HABIT_NAME
    },
    settings: {
      hubConnected: false,
      lastBackupAt: null
    },
    forest: {
      activeTreeId: null,
      selectedNodeId: null,
      selectedNodeAt: null,
      lightups: []
    }
  };

  let state = null;
  let appBooted = false;
  let remoteSyncReady = false;
  let stateSync = null;
  let currentUser = null;
  const GUEST_KEY = "kht:guest";
  let guestMode = false;
  let activeRange = "all";
  let activePage = "timer";
  let activeRecordTab = "events";
  let timerInterval = null;
  let lastTimerPersist = 0;
  let currentBugList = getCachedBugs();
  let modalContext = null;
  let seedTrees = [];
  let nodeIndex = new Map();
  // 个人节点叠加层（本地模式读 localStorage，在线模式读 GET /api/nodes）
  let customNodeOverlay = { nodes: [], edges: [] };
  let lightUpByEventId = new Map();
  // 一次性提示（'expired' | 'dangling' | null）：模块级，不进 state、不参与导出
  let lastAimNotice = null;

  function bootApp() {
    // 启动顺序：state → 种子树（叠加个人节点）→ 索引 → 清理失效瞄准（只留提示）→ 首次 render()
    if (LOCAL_ONLY) {
      customNodeOverlay = loadLocalNodeOverlay();
    }
    seedTrees = mergeCustomNodes(loadSeedTrees(), customNodeOverlay);
    nodeIndex = buildNodeIndex(seedTrees);
    rebuildLightUpIndex();
    pruneStaleAim();
    bindEvents();
    // hub 开关已从 index.html 移除；settings.hubConnected 仅为兼容历史备份保留
    if (elements.hubToggle) {
      elements.hubToggle.checked = state.settings.hubConnected;
    }
    render();
    startTimerTicker();
  }

  const elements = {
    hubToggle: document.getElementById("hub-connected"),
    navButtons: Array.from(document.querySelectorAll(".nav-button")),
    pages: Array.from(document.querySelectorAll(".page")),
    overviewToday: document.getElementById("overview-today"),
    overviewStreak: document.getElementById("overview-streak"),
    overviewActiveHabit: document.getElementById("overview-active-habit"),
    overviewNodeCandidates: document.getElementById("overview-node-candidates"),
    overviewLitNodes: document.getElementById("overview-lit-nodes"),
    habitReminder: document.getElementById("habit-reminder"),
    habitForm: document.getElementById("habit-form"),
    habitEmpty: document.getElementById("habit-empty"),
    habitActive: document.getElementById("habit-active"),
    habitNameInput: document.getElementById("habit-name"),
    habitDaysInput: document.getElementById("habit-days"),
    habitRecurringLogInput: document.getElementById("habit-recurring-log"),
    habitTitle: document.getElementById("habit-title"),
    habitMeta: document.getElementById("habit-meta"),
    habitDaysProgress: document.getElementById("habit-days-progress"),
    habitWeeklyStatus: document.getElementById("habit-weekly-status"),
    habitRecurringPreview: document.getElementById("habit-recurring-preview"),
    startTimerFromHabitButton: document.getElementById("start-timer-from-habit"),
    editHabitButton: document.getElementById("edit-habit"),
    deleteHabitButton: document.getElementById("delete-habit"),
    completeHabitButton: document.getElementById("complete-habit"),
    habitHistoryList: document.getElementById("habit-history-list"),
    doneForm: document.getElementById("done-form"),
    doneTitleInput: document.getElementById("done-title"),
    doneLogInput: document.getElementById("done-log"),
    recordTabButtons: Array.from(document.querySelectorAll(".record-tab")),
    recordSections: Array.from(document.querySelectorAll(".record-section")),
    doneList: document.getElementById("done-list"),
    quickNoteList: document.getElementById("quick-note-list"),
    eventSearchInput: document.getElementById("event-search"),
    filterButtons: Array.from(document.querySelectorAll(".filter")),
    battleReport: document.getElementById("battle-report"),
    nodeCandidateList: document.getElementById("node-candidate-list"),
    habitEventGroups: document.getElementById("habit-event-groups"),
    dayViewList: document.getElementById("day-view-list"),
    weekViewList: document.getElementById("week-view-list"),
    monthViewList: document.getElementById("month-view-list"),
    timerPredictionInput: document.getElementById("timer-prediction"),
    timerPredictionDisplay: document.getElementById("timer-prediction-display"),
    timerSuggestions: document.getElementById("timer-suggestions"),
    timerDisplay: document.getElementById("timer-display"),
    timerStartButton: document.getElementById("timer-start"),
    timerResetButton: document.getElementById("timer-reset"),
    timerFinishButton: document.getElementById("timer-finish"),
    timerReport: document.getElementById("timer-report"),
    timerRecurringLog: document.getElementById("timer-recurring-log"),
    timerRecurringStatus: document.getElementById("timer-recurring-status"),
    timerSingleLogInput: document.getElementById("timer-single-log"),
    timerQuickSaveButton: document.getElementById("timer-quick-save"),
    habitPicker: document.getElementById("habit-picker"),
    habitPickerToggle: document.getElementById("habit-picker-toggle"),
    habitPickerSearch: document.getElementById("habit-picker-search"),
    habitPickerList: document.getElementById("habit-picker-list"),
    timerHabitLabel: document.getElementById("timer-habit-label"),
    nodeAimLine: document.getElementById("node-aim-line"),
    nodeAimLabel: document.getElementById("node-aim-label"),
    nodeAimClear: document.getElementById("node-aim-clear"),
    nodeAimNotice: document.getElementById("node-aim-notice"),
    backupExportButton: document.getElementById("backup-export"),
    backupFileInput: document.getElementById("backup-file"),
    backupStatus: document.getElementById("backup-status"),
    bugForm: document.getElementById("bug-form"),
    bugTitleInput: document.getElementById("bug-title"),
    bugDescriptionInput: document.getElementById("bug-description"),
    bugStepsInput: document.getElementById("bug-steps"),
    bugExpectedInput: document.getElementById("bug-expected"),
    bugActualInput: document.getElementById("bug-actual"),
    bugSeverityInput: document.getElementById("bug-severity"),
    bugContactInput: document.getElementById("bug-contact"),
    bugStatus: document.getElementById("bug-status"),
    bugList: document.getElementById("bug-list"),
    modalRoot: document.getElementById("modal-root"),
    modalForm: document.getElementById("modal-form"),
    modalTitle: document.getElementById("modal-title"),
    modalFields: document.getElementById("modal-fields"),
    modalClose: document.getElementById("modal-close"),
    modalCancel: document.getElementById("modal-cancel")
  };

  function bindEvents() {
    if (elements.hubToggle) {
      elements.hubToggle.addEventListener("change", () => {
        state.settings.hubConnected = elements.hubToggle.checked;
        saveState();
        renderDoneList();
      });
    }

    elements.navButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setActivePage(button.dataset.pageTarget || "timer");
      });
    });

    elements.habitForm.addEventListener("submit", (event) => {
      event.preventDefault();
      createHabit();
    });

    elements.startTimerFromHabitButton.addEventListener("click", () => {
      if (!state.habit || !state.habit.active) {
        return;
      }
      state.timer.selectedHabitId = state.habit.id;
      state.timer.selectedHabitName = state.habit.name;
      state.timer.selectedOption = "custom";
      state.timer.predictedAction = state.habit.name;
      elements.timerPredictionInput.value = state.habit.name;
      saveState();
      setActivePage("timer");
      startTimer();
    });

    elements.editHabitButton.addEventListener("click", () => {
      if (state.habit && state.habit.active) {
        openHabitModal(state.habit, "active");
      }
    });

    elements.deleteHabitButton.addEventListener("click", () => {
      if (!state.habit || !state.habit.active) {
        return;
      }
      const confirmed = window.confirm(`确定删除习惯“${state.habit.name}”吗？当前事件记录会保留。`);
      if (!confirmed) {
        return;
      }
      if (state.timer.selectedHabitId === state.habit.id) {
        state.timer.selectedHabitId = null;
        state.timer.selectedHabitName = CUSTOM_HABIT_NAME;
      }
      state.habit = null;
      saveState();
      render();
    });

    elements.completeHabitButton.addEventListener("click", () => {
      completeActiveHabit();
    });

    elements.doneForm.addEventListener("submit", (event) => {
      event.preventDefault();
      createManualEvent();
    });

    elements.recordTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activeRecordTab = button.dataset.recordTabTarget || "events";
        renderRecordTabs();
      });
    });

    elements.eventSearchInput.addEventListener("input", () => {
      renderDoneList();
    });

    elements.filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activeRange = button.dataset.range || "all";
        elements.filterButtons.forEach((item) => item.classList.toggle("active", item === button));
        renderDoneList();
      });
    });

    elements.timerPredictionInput.addEventListener("input", () => {
      state.timer.predictedAction = elements.timerPredictionInput.value.trim();
      state.timer.selectedOption = "custom";
      saveState();
      renderTimer();
    });

    elements.timerStartButton.addEventListener("click", () => {
      if (state.timer.running) {
        pauseTimer();
      } else {
        startTimer();
      }
    });

    elements.timerResetButton.addEventListener("click", () => {
      resetTimer();
    });

    elements.timerFinishButton.addEventListener("click", () => {
      finishTimer();
    });

    elements.timerQuickSaveButton.addEventListener("click", () => {
      createQuickNoteEvent();
    });

    elements.timerRecurringLog.addEventListener("input", () => {
      if (!state.habit || !state.habit.active) {
        setRecurringStatus("当前没有激活习惯", false);
        return;
      }
      state.habit.recurringLog = elements.timerRecurringLog.value.trim();
      saveState();
      renderHabit();
      setRecurringStatus("已自动保存", true);
    });

    elements.habitPickerToggle.addEventListener("click", () => {
      const hidden = elements.habitPicker.classList.toggle("hidden");
      elements.habitPickerToggle.setAttribute("aria-expanded", String(!hidden));
    });

    elements.habitPickerSearch.addEventListener("input", () => {
      renderHabitPicker();
    });

    elements.nodeAimClear.addEventListener("click", () => {
      setSelectedNode(null, null);
    });

    elements.timerSingleLogInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        createQuickNoteEvent();
      }
    });

    elements.doneList.addEventListener("click", handleRecordActions);
    elements.quickNoteList.addEventListener("click", handleRecordActions);
    elements.habitHistoryList.addEventListener("click", handleRecordActions);

    elements.backupExportButton.addEventListener("click", () => {
      exportBackup();
    });

    elements.backupFileInput.addEventListener("change", async (event) => {
      const input = /** @type {HTMLInputElement} */ (event.currentTarget);
      const file = input.files && input.files[0];
      if (!file) {
        return;
      }
      try {
        const text = await file.text();
        importBackup(text);
      } catch (error) {
        showMessage(elements.backupStatus, `导入失败：${getErrorMessage(error)}`, false);
      } finally {
        input.value = "";
      }
    });

    if (elements.bugForm) {
      elements.bugForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await submitBugReport();
      });
    }

    elements.modalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveModal();
    });

    elements.modalClose.addEventListener("click", closeModal);
    elements.modalCancel.addEventListener("click", closeModal);
    elements.modalRoot.addEventListener("click", (event) => {
      if (event.target === elements.modalRoot) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modalContext) {
        closeModal();
      }
    });
  }

  function handleRecordActions(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest("[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const source = button.dataset.source;
    const id = button.dataset.id;
    if (!action || !source || !id) {
      return;
    }

    if (source === "event") {
      const record = state.events.find((item) => item.id === id);
      if (!record) {
        return;
      }
      if (action === "edit") {
        openEventModal(record);
      } else if (action === "delete") {
        const confirmed = window.confirm(`确定删除记录“${record.title}”吗？`);
        if (!confirmed) {
          return;
        }
        state.events = state.events.filter((item) => item.id !== id);
        // 事件是个人数据，可物理删除；草稿只是"尚未声明的证据副本"，证据没了就该走。
        // 已 confirmed 的点亮是追加式声明，保留（见二期 §C3）。
        state.forest.lightups = state.forest.lightups.filter(
          (lightUp) => lightUp.eventId !== id || lightUp.status === "confirmed"
        );
        rebuildLightUpIndex();
        saveState();
        render();
      }
      return;
    }

    if (source === "history") {
      const habit = state.habitHistory.find((item) => item.id === id);
      if (!habit) {
        return;
      }
      if (action === "edit") {
        openHabitModal(habit, "history");
      } else if (action === "delete") {
        const confirmed = window.confirm(`确定删除历史习惯“${habit.name}”吗？`);
        if (!confirmed) {
          return;
        }
        state.habitHistory = state.habitHistory.filter((item) => item.id !== id);
        if (state.timer.selectedHabitId === id) {
          state.timer.selectedHabitId = null;
          state.timer.selectedHabitName = CUSTOM_HABIT_NAME;
        }
        saveState();
        render();
      }
    }
  }

  function createHabit() {
    if (state.habit && state.habit.active) {
      return;
    }
    const name = elements.habitNameInput.value.trim();
    const targetDays = Number(elements.habitDaysInput.value);
    if (!name) {
      return;
    }
    if (!Number.isInteger(targetDays) || targetDays < 21 || targetDays > 365) {
      window.alert("目标天数需要在 21 到 365 之间。");
      return;
    }

    state.habit = {
      id: createId(),
      name,
      startDate: new Date().toISOString(),
      targetDays,
      active: true,
      recurringLog: elements.habitRecurringLogInput.value.trim(),
      completedAt: null
    };

    if (!state.timer.selectedHabitId || state.timer.selectedHabitName === CUSTOM_HABIT_NAME) {
      state.timer.selectedHabitId = state.habit.id;
      state.timer.selectedHabitName = state.habit.name;
    }

    elements.habitForm.reset();
    elements.habitDaysInput.value = "60";
    saveState();
    render();
    showMessage(
      elements.backupStatus,
      "已创建习惯。建议在形成第一批事件后导出一次 JSON 备份。",
      true
    );
  }

  function completeActiveHabit() {
    if (!state.habit || !state.habit.active) {
      return;
    }
    const progressDays = countHabitDays(state.habit, state.events);
    if (progressDays < state.habit.targetDays) {
      window.alert(`当前仅完成 ${progressDays}/${state.habit.targetDays} 天，暂不建议结束。`);
      return;
    }
    const completedAt = new Date().toISOString();
    state.habitHistory.unshift({
      ...state.habit,
      active: false,
      completedAt,
      progressDays
    });
    if (state.timer.selectedHabitId === state.habit.id) {
      state.timer.selectedHabitId = null;
      state.timer.selectedHabitName = CUSTOM_HABIT_NAME;
    }
    state.habit = null;
    saveState();
    render();
  }

  function createManualEvent() {
    const title = elements.doneTitleInput.value.trim();
    if (!title) {
      return;
    }
    const habit = resolveSelectedHabitForManualRecord();
    const createdAt = new Date();
    const singleLog = elements.doneLogInput.value.trim();
    const aimNode = resolveAimNode();
    const aimTree = aimNode ? getActiveTree() : null;
    // 旧字段：v3 起不再写 true，点亮由 state.forest.lightups 表达
    const lightUp = false;
    const newEvent = {
      id: createId(),
      habitId: habit ? habit.id : null,
      habitName: habit ? habit.name : null,
      title,
      createdAt: createdAt.toISOString(),
      lightUp,
      singleLog,
      source: "manual",
      durationMs: null,
      report: buildManualReport(habit, title, createdAt, lightUp, singleLog),
      nodeId: aimNode ? aimNode.id : null,
      treeId: aimTree ? aimTree.tree.id : null
    };
    state.events.unshift(newEvent);
    if (aimNode) {
      createLightUpDraft(newEvent);
    }
    elements.doneForm.reset();
    saveState();
    render();
    showMessage(elements.battleReport, newEvent.report, true);
  }

  function createQuickNoteEvent() {
    const singleLog = elements.timerSingleLogInput.value.trim();
    if (!singleLog) {
      return;
    }
    const createdAt = new Date();
    const action = resolveQuickNoteTitle(singleLog);
    // 旧字段：v3 起不再写 true，点亮由 state.forest.lightups 表达
    const lightUp = false;
    const newEvent = {
      id: createId(),
      habitId: null,
      habitName: null,
      title: action,
      createdAt: createdAt.toISOString(),
      lightUp,
      singleLog,
      source: "quick-note",
      durationMs: null,
      report: buildQuickNoteReport(action, singleLog, createdAt, lightUp),
      nodeId: null,
      treeId: null
    };
    state.events.unshift(newEvent);
    elements.timerSingleLogInput.value = "";
    saveState();
    render();
    showMessage(elements.timerReport, newEvent.report, true);
  }

  function resolveSelectedHabitForManualRecord() {
    if (state.habit && state.habit.active) {
      return state.habit;
    }
    if (state.timer.selectedHabitId) {
      return getHabitById(state.timer.selectedHabitId);
    }
    return null;
  }

  function startTimer() {
    if (state.timer.running) {
      return;
    }
    ensureHabitSelection();
    const candidates = getPredictionCandidates();
    const action = resolveSelectedAction(candidates);
    state.timer.predictedAction = action;
    elements.timerPredictionInput.value = action;
    state.timer.startedAt = new Date().toISOString();
    state.timer.running = true;
    saveState();
    renderTimer();
  }

  function pauseTimer() {
    if (!state.timer.running) {
      return;
    }
    state.timer.elapsedMs = getElapsedMs();
    state.timer.running = false;
    state.timer.startedAt = null;
    saveState();
    renderTimer();
  }

  function resetTimer() {
    state.timer.elapsedMs = 0;
    state.timer.running = false;
    state.timer.startedAt = null;
    state.timer.predictedAction = elements.timerPredictionInput.value.trim();
    saveState();
    renderTimer();
  }

  function finishTimer() {
    const elapsedMs = getElapsedMs();
    if (elapsedMs <= 0) {
      return;
    }

    const candidates = getPredictionCandidates();
    const action = resolveSelectedAction(candidates);
    const habit = resolveSelectedHabit();
    const createdAt = new Date();
    const aimNode = resolveAimNode();
    const aimTree = aimNode ? getActiveTree() : null;
    // 旧字段：v3 起不再写 true，点亮由 state.forest.lightups 表达
    const lightUp = false;
    const singleLog = elements.timerSingleLogInput.value.trim();
    const newEvent = {
      id: createId(),
      habitId: habit ? habit.id : null,
      habitName: habit ? habit.name : null,
      title: action,
      createdAt: createdAt.toISOString(),
      lightUp,
      singleLog,
      source: "timer",
      durationMs: elapsedMs,
      report: buildTimerReport(action, elapsedMs, createdAt, lightUp, habit, singleLog),
      nodeId: aimNode ? aimNode.id : null,
      treeId: aimTree ? aimTree.tree.id : null
    };

    state.events.unshift(newEvent);
    if (aimNode) {
      createLightUpDraft(newEvent);
    }
    state.timer.elapsedMs = 0;
    state.timer.running = false;
    state.timer.startedAt = null;
    state.timer.predictedAction = action;
    elements.timerSingleLogInput.value = "";
    saveState();
    render();
    showMessage(elements.timerReport, newEvent.report, true);
  }

  function startTimerTicker() {
    if (timerInterval) {
      window.clearInterval(timerInterval);
    }
    timerInterval = window.setInterval(() => {
      if (!state.timer.running) {
        return;
      }
      renderTimer();
      const now = Date.now();
      if (now - lastTimerPersist > 5000) {
        lastTimerPersist = now;
        saveState();
      }
    }, 250);
  }

  function render() {
    renderOverview();
    renderHabit();
    renderHabitHistory();
    renderDoneList();
    renderQuickNoteList();
    renderNodeCandidates();
    renderHabitEventGroups();
    renderPeriodViews();
    renderRecordTabs();
    renderTimer();
    renderHabitReminder();
    renderBugList(currentBugList);
    renderBackupStatus();
    setActivePage(activePage);
  }

  function renderOverview() {
    const todayCount = countEventsOnDate(state.events, new Date());
    const streak = countDailyStreak(state.events);
    const nodeCandidates = buildNodeCandidates(state.events);
    const litNodeIds = new Set(
      state.forest.lightups
        .filter((lightUp) => lightUp.status === "confirmed")
        .map((lightUp) => lightUp.nodeId)
    );
    elements.overviewToday.textContent = `${todayCount} 次`;
    elements.overviewStreak.textContent = `${streak} 天`;
    elements.overviewActiveHabit.textContent = state.habit && state.habit.active ? state.habit.name : "未设置";
    elements.overviewNodeCandidates.textContent = `${nodeCandidates.length} 个`;
    elements.overviewLitNodes.textContent = `${litNodeIds.size} / ${nodeIndex.size}`;
  }

  function renderHabit() {
    const hasActiveHabit = Boolean(state.habit && state.habit.active);
    elements.habitEmpty.classList.toggle("hidden", hasActiveHabit);
    elements.habitActive.classList.toggle("hidden", !hasActiveHabit);
    if (!hasActiveHabit) {
      return;
    }

    const habit = state.habit;
    const progressDays = countHabitDays(habit, state.events);
    const consistency = buildConsistencySummary(habit, state.events);
    elements.habitTitle.textContent = habit.name;
    elements.habitMeta.textContent = `开始于 ${formatDate(habit.startDate)}，目标 ${habit.targetDays} 天。`;
    elements.habitDaysProgress.textContent = `${progressDays} / ${habit.targetDays}`;
    elements.habitWeeklyStatus.textContent = consistency;
    elements.habitRecurringPreview.textContent = habit.recurringLog || "暂无";
    elements.completeHabitButton.disabled = progressDays < habit.targetDays;
  }

  function renderHabitHistory() {
    if (!state.habitHistory.length) {
      elements.habitHistoryList.innerHTML = createEmptyCard("还没有结束过习惯。");
      return;
    }
    elements.habitHistoryList.innerHTML = state.habitHistory
      .map((habit) => {
        const progressDays = habit.progressDays || countHabitDays(habit, state.events);
        return `
          <article class="done-item">
            <h4>${escapeHtml(habit.name)}</h4>
            <div class="done-meta">开始 ${formatDate(habit.startDate)} · 结束 ${habit.completedAt ? formatDate(habit.completedAt) : "未结束"} · 完成 ${progressDays}/${habit.targetDays} 天</div>
            <div class="habit-log">${escapeHtml(habit.recurringLog || "暂无重复日志")}</div>
            <div class="item-actions">
              <button class="action-button" type="button" data-action="edit" data-source="history" data-id="${habit.id}">编辑</button>
              <button class="action-button danger" type="button" data-action="delete" data-source="history" data-id="${habit.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderRecordTabs() {
    elements.recordTabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.recordTabTarget === activeRecordTab);
    });
    elements.recordSections.forEach((section) => {
      section.classList.toggle("hidden", section.dataset.recordTab !== activeRecordTab);
    });
  }

  function renderDoneList() {
    const formalEvents = state.events.filter((event) => event.source !== "quick-note");
    const filtered = filterEvents(formalEvents, activeRange, elements.eventSearchInput.value.trim());
    if (!filtered.length) {
      elements.doneList.innerHTML = createEmptyCard("当前筛选条件下还没有事件。");
      return;
    }
    elements.doneList.innerHTML = filtered
      .map((event) => {
        const habitText = event.habitName ? ` · 习惯 ${escapeHtml(event.habitName)}` : "";
        const log = event.singleLog ? `<div class="habit-log">${escapeHtml(event.singleLog)}</div>` : "";
        const durationText = event.durationMs ? ` · ${formatDuration(event.durationMs)}` : "";
        const sourceText =
          event.source === "timer"
            ? "计时"
            : event.source === "quick-note"
              ? "随手记"
              : "手动";
        const lightUpText = escapeHtml(resolveEventLightUpBadge(event));
        return `
          <article class="done-item">
            <h4>${escapeHtml(event.title)}</h4>
            <div class="done-meta">${formatDateTime(event.createdAt)} · ${sourceText}${durationText}${habitText} · ${lightUpText}</div>
            ${log}
            <div class="item-actions">
              <button class="action-button" type="button" data-action="edit" data-source="event" data-id="${event.id}">编辑</button>
              <button class="action-button danger" type="button" data-action="delete" data-source="event" data-id="${event.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderQuickNoteList() {
    const quickNotes = state.events.filter((event) => event.source === "quick-note");
    if (!quickNotes.length) {
      elements.quickNoteList.innerHTML = createEmptyCard("还没有随手记。");
      return;
    }
    elements.quickNoteList.innerHTML = quickNotes
      .map((event) => {
        return `
          <article class="done-item">
            <h4>${escapeHtml(event.title)}</h4>
            <div class="done-meta">${formatDateTime(event.createdAt)} · 随手记 · ${escapeHtml(resolveEventLightUpBadge(event))}</div>
            <div class="habit-log">${escapeHtml(event.singleLog || "")}</div>
            <div class="item-actions">
              <button class="action-button" type="button" data-action="edit" data-source="event" data-id="${event.id}">编辑</button>
              <button class="action-button danger" type="button" data-action="delete" data-source="event" data-id="${event.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderNodeCandidates() {
    const candidates = buildNodeCandidates(state.events);
    if (!candidates.length) {
      elements.nodeCandidateList.innerHTML = createEmptyCard("当同一个动作重复出现时，这里会自动浮出节点候选。");
      return;
    }
    elements.nodeCandidateList.innerHTML = candidates
      .map((candidate) => {
        const habitText = candidate.habitName ? ` · ${escapeHtml(candidate.habitName)}` : "";
        return `
          <article class="done-item">
            <h4>${escapeHtml(candidate.title)}</h4>
            <div class="done-meta">重复 ${candidate.count} 次${habitText} · 最近一次 ${formatDateTime(candidate.lastCreatedAt)}</div>
            <div class="habit-log">${escapeHtml(candidate.summary)}</div>
          </article>
        `;
      })
      .join("");
  }

  function renderHabitEventGroups() {
    const groups = buildHabitGroups(state.events);
    if (!groups.length) {
      elements.habitEventGroups.innerHTML = createEmptyCard("还没有按习惯归档的事件链。");
      return;
    }
    elements.habitEventGroups.innerHTML = groups
      .map((group) => {
        const eventsHtml = group.events
          .slice(0, 6)
          .map((event) => {
            const durationText = event.durationMs ? ` · ${formatDuration(event.durationMs)}` : "";
            return `
              <div class="group-event">
                <div class="group-event-title">${escapeHtml(event.title)}</div>
                <div class="done-meta">${formatDateTime(event.createdAt)}${durationText}</div>
              </div>
            `;
          })
          .join("");
        return `
          <article class="done-item">
            <div class="group-header">
              <h4>${escapeHtml(group.label)}</h4>
              <span class="meta-note">${group.events.length} 条事件</span>
            </div>
            <div class="group-events">${eventsHtml}</div>
          </article>
        `;
      })
      .join("");
  }

  function renderPeriodViews() {
    renderPeriodList(elements.dayViewList, buildPeriodGroups(state.events, "day"), "今天还没有任何记录。");
    renderPeriodList(elements.weekViewList, buildPeriodGroups(state.events, "week"), "最近还没有周视角记录。");
    renderPeriodList(elements.monthViewList, buildPeriodGroups(state.events, "month"), "最近还没有月视角记录。");
  }

  function renderPeriodList(container, groups, emptyMessage) {
    if (!groups.length) {
      container.innerHTML = createEmptyCard(emptyMessage);
      return;
    }
    container.innerHTML = groups
      .map((group) => {
        return `
          <article class="done-item">
            <h4>${escapeHtml(group.label)}</h4>
            <div class="done-meta">共 ${group.total} 条 · 正式事件 ${group.formalCount} 条 · 随手记 ${group.quickNoteCount} 条</div>
            <div class="habit-log">${escapeHtml(group.summary)}</div>
          </article>
        `;
      })
      .join("");
  }

  function renderTimer() {
    const elapsedMs = getElapsedMs();
    elements.timerDisplay.textContent = formatDuration(elapsedMs);
    elements.timerStartButton.textContent = state.timer.running ? "暂停" : "开始";
    elements.timerResetButton.disabled = elapsedMs <= 0;
    elements.timerFinishButton.disabled = elapsedMs <= 0;
    const candidates = getPredictionCandidates();
    const prediction = resolveSelectedAction(candidates);
    elements.timerPredictionDisplay.textContent = prediction ? `当前动作：${prediction}` : "尚未选择动作";
    renderSuggestions(candidates);
    renderHabitPicker();
    elements.timerRecurringLog.value = state.habit && state.habit.active ? state.habit.recurringLog || "" : "";
    if (state.habit && state.habit.active) {
      setRecurringStatus(state.habit.recurringLog ? "已挂靠到当前习惯" : "建议写下固定步骤", Boolean(state.habit.recurringLog));
    } else {
      setRecurringStatus("当前没有激活习惯", false);
    }
    renderAimLine();
  }

  function renderSuggestions(candidates) {
    const slots = ["p1", "p2", "p3"];
    elements.timerSuggestions.innerHTML = slots
      .map((slot, index) => {
        const title = candidates[index];
        const isActive = state.timer.selectedOption === slot;
        const disabled = !title;
        return `
          <button
            class="timer-suggestion${isActive ? " active" : ""}"
            type="button"
            data-slot="${slot}"
            data-title="${escapeAttribute(title || "")}"
            ${disabled ? "disabled" : ""}
          >
            ${title ? escapeHtml(title) : `候选 ${index + 1}`}
          </button>
        `;
      })
      .concat(
        `<button class="timer-suggestion${state.timer.selectedOption === "custom" ? " active" : ""}" type="button" data-slot="custom">自定义</button>`
      )
      .join("");

    Array.from(elements.timerSuggestions.querySelectorAll(".timer-suggestion")).forEach((button) => {
      button.addEventListener("click", () => {
        const slot = button.dataset.slot || "custom";
        if (slot === "custom") {
          state.timer.selectedOption = "custom";
          saveState();
          renderTimer();
          elements.timerPredictionInput.focus();
          return;
        }
        const title = button.dataset.title || "";
        if (!title) {
          return;
        }
        state.timer.selectedOption = slot;
        state.timer.predictedAction = title;
        elements.timerPredictionInput.value = title;
        saveState();
        renderTimer();
      });
    });
  }

  function renderHabitReminder() {
    if (!state.habit || !state.habit.active) {
      elements.habitReminder.classList.add("hidden");
      elements.habitReminder.textContent = "";
      return;
    }
    const todayCount = countHabitEventsOnDate(state.habit.id, state.events, new Date());
    elements.habitReminder.classList.remove("hidden");
    elements.habitReminder.textContent =
      todayCount > 0
        ? `今日已完成 ${todayCount} 次`
        : `今日尚未完成“${state.habit.name}”，适合先做一次最小动作`;
  }

  function renderHabitPicker() {
    ensureHabitSelection();
    const keyword = elements.habitPickerSearch.value.trim().toLowerCase();
    const habits = getAvailableHabits().filter((habit) => {
      if (!keyword) {
        return true;
      }
      return habit.name.toLowerCase().includes(keyword);
    });

    const items = [{ id: "", name: CUSTOM_HABIT_NAME, label: CUSTOM_HABIT_NAME }].concat(
      habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        label: habit.active ? `${habit.name} · 当前养成中` : `${habit.name} · 历史习惯`
      }))
    );

    elements.timerHabitLabel.textContent = state.timer.selectedHabitName || CUSTOM_HABIT_NAME;
    elements.habitPickerList.innerHTML = items
      .map((item) => {
        const isActive = item.id
          ? item.id === state.timer.selectedHabitId
          : state.timer.selectedHabitId === null && state.timer.selectedHabitName === CUSTOM_HABIT_NAME;
        return `
          <button
            class="habit-picker-item${isActive ? " active" : ""}"
            type="button"
            data-habit-id="${escapeAttribute(item.id)}"
            data-habit-name="${escapeAttribute(item.name)}"
          >
            ${escapeHtml(item.label)}
          </button>
        `;
      })
      .join("");

    Array.from(elements.habitPickerList.querySelectorAll(".habit-picker-item")).forEach((button) => {
      button.addEventListener("click", () => {
        const habitId = button.dataset.habitId || null;
        const habitName = button.dataset.habitName || CUSTOM_HABIT_NAME;
        state.timer.selectedHabitId = habitId;
        state.timer.selectedHabitName = habitName;
        saveState();
        renderHabitPicker();
      });
    });
  }

  // 计时页只剩一行瞄准提示：无瞄准（且无失效提示）时整行 hidden
  function renderAimLine() {
    // 先清理、再消费一次性提示；已清理过时 prune 会早退，不会误伤提示
    pruneStaleAim();
    if (lastAimNotice) {
      elements.nodeAimNotice.textContent = AIM_NOTICE_TEXT[lastAimNotice];
      elements.nodeAimNotice.classList.remove("hidden");
      lastAimNotice = null;
    }
    const node = resolveAimNode();
    const noticeShown = !elements.nodeAimNotice.classList.contains("hidden");
    if (!node && !noticeShown) {
      elements.nodeAimLabel.textContent = "";
      elements.nodeAimLine.classList.add("hidden");
      return;
    }
    elements.nodeAimLine.classList.remove("hidden");
    if (node) {
      const overMinutes = getElapsedMs() > Number(node.estMinutes) * 60000;
      elements.nodeAimLabel.textContent = `这次对着：${nodeTitle(node)} · 建议 ${node.estMinutes} 分钟${overMinutes ? " · 已超过建议时长" : ""}`;
    } else {
      elements.nodeAimLabel.textContent = "";
    }
  }

  function renderBackupStatus() {
    if (!state.settings.lastBackupAt) {
      showMessage(
        elements.backupStatus,
        "还没有导出过备份。建议在形成第一轮稳定事件之后先导出一份 JSON。",
        true
      );
      return;
    }
    showMessage(
      elements.backupStatus,
      `最近一次备份时间：${formatDateTime(state.settings.lastBackupAt)}。部署前请再导出一份。`,
      true
    );
  }

  function renderBugList(bugs) {
    if (!elements.bugList) {
      return;
    }
    if (!bugs.length) {
      elements.bugList.innerHTML = createEmptyCard("还没有反馈记录。");
      return;
    }
    elements.bugList.innerHTML = bugs
      .map((bug) => {
        return `
          <article class="done-item">
            <h4>${escapeHtml(bug.title)}</h4>
            <div class="done-meta">${formatDateTime(bug.createdAt)} · 严重级别 ${escapeHtml(resolveSeverityLabel(bug.severity))}${bug.page ? ` · 页面 ${escapeHtml(bug.page)}` : ""}</div>
          </article>
        `;
      })
      .join("");
  }

  function setActivePage(page) {
    activePage = page;
    elements.pages.forEach((section) => {
      section.classList.toggle("hidden", section.dataset.page !== page);
    });
    elements.navButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.pageTarget === page);
    });
    if (page === "bug") {
      void loadRemoteBugs();
    }
  }

  function openHabitModal(habit, source) {
    modalContext = { type: "habit", id: habit.id, source };
    elements.modalTitle.textContent = "编辑习惯";
    elements.modalFields.innerHTML = `
      <label class="field">
        <span>习惯名称</span>
        <input id="modal-habit-name" type="text" maxlength="40" value="${escapeAttribute(habit.name)}" />
      </label>
      <label class="field">
        <span>目标天数</span>
        <input id="modal-habit-days" type="number" min="21" max="365" value="${habit.targetDays}" />
      </label>
      <label class="field">
        <span>重复日志</span>
        <textarea id="modal-habit-log" rows="5" maxlength="400">${escapeHtml(habit.recurringLog || "")}</textarea>
      </label>
    `;
    openModal();
  }

  function openEventModal(record) {
    modalContext = { type: "event", id: record.id };
    elements.modalTitle.textContent = "编辑事件";
    elements.modalFields.innerHTML = `
      <label class="field">
        <span>事件标题</span>
        <input id="modal-event-title" type="text" maxlength="80" value="${escapeAttribute(record.title)}" />
      </label>
      <label class="field">
        <span>单次日志</span>
        <textarea id="modal-event-log" rows="5" maxlength="400">${escapeHtml(record.singleLog || "")}</textarea>
      </label>
    `;
    openModal();
  }

  function openModal() {
    elements.modalRoot.classList.remove("hidden");
    elements.modalRoot.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modalContext = null;
    elements.modalFields.innerHTML = "";
    elements.modalRoot.classList.add("hidden");
    elements.modalRoot.setAttribute("aria-hidden", "true");
  }

  function saveModal() {
    if (!modalContext) {
      return;
    }

    if (modalContext.type === "habit") {
      const nameInput = /** @type {HTMLInputElement | null} */ (document.getElementById("modal-habit-name"));
      const daysInput = /** @type {HTMLInputElement | null} */ (document.getElementById("modal-habit-days"));
      const logInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("modal-habit-log"));
      const name = nameInput ? nameInput.value.trim() : "";
      const targetDays = daysInput ? Number(daysInput.value) : Number.NaN;
      const recurringLog = logInput ? logInput.value.trim() : "";

      if (!name) {
        window.alert("习惯名称不能为空。");
        return;
      }
      if (!Number.isInteger(targetDays) || targetDays < 21 || targetDays > 365) {
        window.alert("目标天数需要在 21 到 365 之间。");
        return;
      }

      const record =
        modalContext.source === "active"
          ? state.habit
          : state.habitHistory.find((item) => item.id === modalContext.id);
      if (!record) {
        closeModal();
        return;
      }

      record.name = name;
      record.targetDays = targetDays;
      record.recurringLog = recurringLog;
      if (state.timer.selectedHabitId === record.id) {
        state.timer.selectedHabitName = record.name;
      }
      syncHabitNameToEvents(record.id, record.name);
      saveState();
      render();
      closeModal();
      return;
    }

    if (modalContext.type === "event") {
      const titleInput = /** @type {HTMLInputElement | null} */ (document.getElementById("modal-event-title"));
      const logInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("modal-event-log"));
      const title = titleInput ? titleInput.value.trim() : "";
      if (!title) {
        window.alert("事件标题不能为空。");
        return;
      }
      const record = state.events.find((item) => item.id === modalContext.id);
      if (!record) {
        closeModal();
        return;
      }
      record.title = title;
      record.singleLog = logInput ? logInput.value.trim() : "";
      record.report = rebuildReport(record);
      saveState();
      render();
      closeModal();
    }
  }

  async function submitBugReport() {
    const payload = {
      title: elements.bugTitleInput.value.trim(),
      description: elements.bugDescriptionInput.value.trim(),
      steps: elements.bugStepsInput.value.trim(),
      expected: elements.bugExpectedInput.value.trim(),
      actual: elements.bugActualInput.value.trim(),
      severity: elements.bugSeverityInput.value,
      contact: elements.bugContactInput.value.trim(),
      page: activePage
    };
    if (!payload.title || !payload.description) {
      showMessage(elements.bugStatus, "标题和问题描述是必填项。", false);
      return;
    }
    const result = await submitBug(payload);
    if (!result.ok) {
      showMessage(elements.bugStatus, result.message || "提交失败，请稍后重试。", false);
      if (result.issueUrl) {
        appendIssueLink(elements.bugStatus, result.issueUrl);
      }
      return;
    }
    elements.bugForm.reset();
    showMessage(elements.bugStatus, result.message || "问题反馈已提交。", true);
    if (result.bug) {
      currentBugList = mergeBugLists([result.bug], currentBugList);
      cacheBugs(currentBugList);
      renderBugList(currentBugList);
    }
  }

  async function submitBug(payload) {
    try {
      const response = await window.fetch("/api/bugs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        return {
          ok: false,
          message: data.message || "提交失败。",
          issueUrl: buildIssueUrl(payload)
        };
      }
      return { ok: true, bug: data.bug || null, message: data.message || "已提交。" };
    } catch {
      return {
        ok: false,
        message: "连不上本地服务。反馈内容可以带到 GitHub issue 里继续提交。",
        issueUrl: buildIssueUrl(payload)
      };
    }
  }

  function buildIssueUrl(payload) {
    const body = [
      payload.description,
      "",
      payload.steps ? `复现步骤：${payload.steps}` : "",
      payload.expected ? `期望结果：${payload.expected}` : "",
      payload.actual ? `实际结果：${payload.actual}` : "",
      `严重级别：${payload.severity}`,
      `联系方式：${payload.contact || "未填写"}`,
      `来源页面：${payload.page || "unknown"}`,
      "",
      "---",
      "（由习惯记录器的反馈面板生成）"
    ]
      .filter((line) => line !== "")
      .join("\n")
      .slice(0, 6000);
    const params = new URLSearchParams({
      title: payload.title,
      body,
      labels: "feedback"
    });
    return `https://github.com/puppetcat-fire/knowledge-habit-tracker/issues/new?${params.toString()}`;
  }

  function appendIssueLink(container, url) {
    if (!container) {
      return;
    }
    const previous = container.querySelector(".issue-fallback-link");
    if (previous) {
      previous.remove();
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "issue-fallback-link";
    link.textContent = "在 GitHub 上提交这条反馈";
    container.appendChild(link);
  }

  async function loadRemoteBugs() {
    try {
      const response = await window.fetch("/api/bugs");
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      currentBugList = mergeBugLists(data.bugs || [], getCachedBugs());
      cacheBugs(currentBugList);
      renderBugList(currentBugList);
    } catch {
      currentBugList = getCachedBugs();
      renderBugList(currentBugList);
    }
  }

  function exportBackup() {
    const payload = {
      app: "knowledge-habit-tracker",
      version: defaultState.version,
      exportedAt: new Date().toISOString(),
      state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `knowledge-habit-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    state.settings.lastBackupAt = new Date().toISOString();
    saveState();
    renderBackupStatus();
  }

  function importBackup(text) {
    const parsed = JSON.parse(text);
    const incoming = parsed && parsed.state ? parsed.state : parsed;
    const incomingVersion = Number(incoming && incoming.version) || 1;
    if (incomingVersion > STATE_VERSION) {
      throw new Error(
        `备份来自更新的版本（v${incomingVersion}），当前只支持到 v${STATE_VERSION}。请先升级页面。`
      );
    }
    state = normalizeState(incoming);
    rebuildLightUpIndex();
    saveState();
    render();
    showMessage(elements.backupStatus, "备份已导入，当前页面状态已经刷新。", true);
  }

  function ensureHabitSelection() {
    if (state.timer.selectedHabitId) {
      return;
    }
    if (state.habit && state.habit.active) {
      state.timer.selectedHabitId = state.habit.id;
      state.timer.selectedHabitName = state.habit.name;
    } else {
      state.timer.selectedHabitName = CUSTOM_HABIT_NAME;
    }
  }

  function resolveSelectedHabit() {
    if (!state.timer.selectedHabitId) {
      return state.timer.selectedHabitName === CUSTOM_HABIT_NAME
        ? { id: null, name: CUSTOM_HABIT_NAME }
        : null;
    }
    return getHabitById(state.timer.selectedHabitId);
  }

  function getAvailableHabits() {
    const habits = [];
    if (state.habit && state.habit.active) {
      habits.push({ ...state.habit, active: true });
    }
    state.habitHistory.forEach((habit) => {
      habits.push({ ...habit, active: false });
    });
    return habits;
  }

  function getHabitById(id) {
    if (state.habit && state.habit.id === id) {
      return state.habit;
    }
    return state.habitHistory.find((habit) => habit.id === id) || null;
  }

  function getPredictionCandidates() {
    const titles = new Map();
    const candidateEvents = state.events.filter((event) => event.source !== "quick-note");
    if (state.habit && state.habit.active) {
      titles.set(state.habit.name, 4);
      candidateEvents
        .filter((event) => event.habitId === state.habit.id)
        .slice(0, 10)
        .forEach((event, index) => {
          titles.set(event.title, (titles.get(event.title) || 0) + Math.max(1, 5 - index));
        });
    } else {
      candidateEvents.slice(0, 6).forEach((event, index) => {
        titles.set(event.title, (titles.get(event.title) || 0) + Math.max(1, 4 - index));
      });
    }
    return Array.from(titles.entries())
      .sort((left, right) => right[1] - left[1])
      .map((entry) => entry[0])
      .slice(0, 3);
  }

  function resolveSelectedAction(candidates) {
    const typedValue = elements.timerPredictionInput.value.trim();
    if (state.timer.selectedOption === "custom") {
      return typedValue || state.timer.predictedAction || candidates[0] || guessPrediction();
    }
    if (state.timer.selectedOption === "p2" && candidates[1]) {
      return candidates[1];
    }
    if (state.timer.selectedOption === "p3" && candidates[2]) {
      return candidates[2];
    }
    if (candidates[0]) {
      if (state.timer.selectedOption !== "p1") {
        state.timer.selectedOption = "p1";
      }
      return candidates[0];
    }
    return typedValue || state.timer.predictedAction || guessPrediction();
  }

  function guessPrediction() {
    if (state.habit && state.habit.active) {
      return state.habit.name;
    }
    if (state.events.length) {
      return state.events[0].title;
    }
    return "做一件最小但完整的事";
  }

  function resolveQuickNoteTitle(singleLog) {
    const typedAction = elements.timerPredictionInput.value.trim();
    if (typedAction) {
      return typedAction;
    }
    const candidates = getPredictionCandidates();
    if (candidates[0]) {
      return candidates[0];
    }
    const compact = singleLog.replace(/\s+/g, " ").trim();
    if (compact.length <= 18) {
      return compact;
    }
    return `${compact.slice(0, 18)}...`;
  }

  function syncHabitNameToEvents(habitId, name) {
    state.events.forEach((event) => {
      if (event.habitId === habitId) {
        event.habitName = name;
        event.report = rebuildReport(event);
      }
    });
  }

  function rebuildReport(event) {
    const createdAt = new Date(event.createdAt);
    const habit = event.habitId ? getHabitById(event.habitId) || { id: event.habitId, name: event.habitName } : null;
    if (event.source === "timer") {
      return buildTimerReport(
        event.title,
        event.durationMs || 0,
        createdAt,
        Boolean(event.lightUp),
        habit,
        event.singleLog || ""
      );
    }
    if (event.source === "quick-note") {
      return buildQuickNoteReport(
        event.title,
        event.singleLog || "",
        createdAt,
        Boolean(event.lightUp)
      );
    }
    return buildManualReport(habit, event.title, createdAt, Boolean(event.lightUp), event.singleLog || "");
  }

  function buildManualReport(habit, title, createdAt, lightUp, singleLog) {
    const segments = [
      `${formatDateTime(createdAt.toISOString())} 完成了“${title}”`,
      habit && habit.name ? `挂靠习惯：${habit.name}` : null,
      lightUp ? "已标记为点亮事件" : "仅保存在本地",
      singleLog ? `单次备注：${singleLog}` : null
    ].filter(Boolean);
    return segments.join(" · ");
  }

  function buildTimerReport(action, durationMs, createdAt, lightUp, habit, singleLog) {
    const segments = [
      `${formatDateTime(createdAt.toISOString())} 专注 ${formatDuration(durationMs)}`,
      `动作：${action}`,
      habit && habit.name ? `挂靠习惯：${habit.name}` : null,
      lightUp ? "已标记为点亮事件" : "仅保存在本地",
      singleLog ? `单次备注：${singleLog}` : null
    ].filter(Boolean);
    return segments.join(" · ");
  }

  function buildQuickNoteReport(action, singleLog, createdAt, lightUp) {
    const segments = [
      `${formatDateTime(createdAt.toISOString())} 记录了一条随手记`,
      `标题：${action}`,
      lightUp ? "已标记为点亮事件" : "仅保存在本地",
      `内容：${singleLog}`
    ].filter(Boolean);
    return segments.join(" · ");
  }

  function buildConsistencySummary(habit, events) {
    const weeklyCounts = getLastFourWeekCounts(habit.id, events);
    if (!weeklyCounts.some((count) => count > 0)) {
      return "最近四周暂无稳定记录";
    }
    return weeklyCounts.map((count, index) => `W${index + 1}: ${count}`).join(" · ");
  }

  function getLastFourWeekCounts(habitId, events) {
    const weekKeys = getRecentWeekKeys(4);
    return weekKeys.map((weekKey) => {
      return events.filter((event) => event.habitId === habitId && getWeekKey(event.createdAt) === weekKey).length;
    });
  }

  function buildNodeCandidates(events) {
    const groups = new Map();
    events
      .filter((event) => event.source !== "quick-note")
      .forEach((event) => {
      const key = `${event.habitId || "free"}::${event.title}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: event.title,
          habitName: event.habitName || "",
          count: 0,
          lastCreatedAt: event.createdAt,
          logs: []
        });
      }
      const group = groups.get(key);
      group.count += 1;
      if (new Date(event.createdAt).getTime() > new Date(group.lastCreatedAt).getTime()) {
        group.lastCreatedAt = event.createdAt;
      }
      if (event.singleLog) {
        group.logs.push(event.singleLog);
      }
      });
    return Array.from(groups.values())
      .filter((candidate) => candidate.count >= 2)
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return new Date(right.lastCreatedAt).getTime() - new Date(left.lastCreatedAt).getTime();
      })
      .slice(0, 8)
      .map((candidate) => ({
        ...candidate,
        summary: candidate.logs[0] || "重复动作已经足够多，适合抽成教程节点。"
      }));
  }

  function buildHabitGroups(events) {
    const groups = new Map();
    events
      .filter((event) => event.source !== "quick-note")
      .forEach((event) => {
      const key = event.habitId || `free:${event.habitName || CUSTOM_HABIT_NAME}`;
      if (!groups.has(key)) {
        groups.set(key, {
          label: event.habitName || CUSTOM_HABIT_NAME,
          events: []
        });
      }
      groups.get(key).events.push(event);
      });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        events: group.events.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      }))
      .sort((left, right) => new Date(right.events[0].createdAt).getTime() - new Date(left.events[0].createdAt).getTime());
  }

  function buildPeriodGroups(events, mode) {
    const groups = new Map();
    events.forEach((event) => {
      const key = getPeriodKey(event.createdAt, mode);
      if (!groups.has(key)) {
        groups.set(key, {
          label: formatPeriodLabel(event.createdAt, mode),
          total: 0,
          formalCount: 0,
          quickNoteCount: 0,
          titles: []
        });
      }
      const group = groups.get(key);
      group.total += 1;
      if (event.source === "quick-note") {
        group.quickNoteCount += 1;
      } else {
        group.formalCount += 1;
      }
      if (group.titles.length < 4) {
        group.titles.push(event.title);
      }
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      summary: group.titles.join(" · ")
    }));
  }

  function countHabitDays(habit, events) {
    const keys = new Set();
    events.forEach((event) => {
      if (event.habitId === habit.id) {
        keys.add(getDayKey(event.createdAt));
      }
    });
    return keys.size;
  }

  function countHabitEventsOnDate(habitId, events, date) {
    const dayKey = getDayKey(date.toISOString());
    return events.filter((event) => event.habitId === habitId && getDayKey(event.createdAt) === dayKey).length;
  }

  function countEventsOnDate(events, date) {
    const dayKey = getDayKey(date.toISOString());
    return events.filter((event) => getDayKey(event.createdAt) === dayKey).length;
  }

  function countDailyStreak(events) {
    if (!events.length) {
      return 0;
    }
    const dayKeys = Array.from(new Set(events.map((event) => getDayKey(event.createdAt)))).sort().reverse();
    let streak = 0;
    let cursor = startOfDay(new Date());

    for (const dayKey of dayKeys) {
      const cursorKey = getDayKey(cursor.toISOString());
      if (dayKey === cursorKey) {
        streak += 1;
        cursor = addDays(cursor, -1);
        continue;
      }
      if (streak === 0) {
        cursor = addDays(cursor, -1);
        if (dayKey === getDayKey(cursor.toISOString())) {
          streak += 1;
          cursor = addDays(cursor, -1);
          continue;
        }
      }
      break;
    }
    return streak;
  }

  function filterEvents(events, range, keyword) {
    const normalizedKeyword = keyword.toLowerCase();
    return events.filter((event) => {
      if (!matchesRange(event, range)) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      const haystack = [event.title, event.singleLog, event.habitName].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
  }

  function matchesRange(event, range) {
    if (range === "all") {
      return true;
    }
    const eventTime = new Date(event.createdAt).getTime();
    const now = new Date();
    if (range === "today") {
      return eventTime >= startOfDay(now).getTime();
    }
    if (range === "week") {
      return eventTime >= addDays(startOfDay(now), -6).getTime();
    }
    if (range === "month") {
      return eventTime >= addDays(startOfDay(now), -29).getTime();
    }
    return true;
  }

  function setRecurringStatus(text, saved) {
    elements.timerRecurringStatus.textContent = text;
    elements.timerRecurringStatus.style.color = saved ? "var(--primary-strong)" : "";
  }

  function showMessage(element, message, success) {
    if (!element) {
      return;
    }
    element.classList.remove("hidden");
    element.textContent = message;
    element.classList.toggle("soft-report", Boolean(success));
  }

  function getElapsedMs() {
    if (!state.timer.running || !state.timer.startedAt) {
      return state.timer.elapsedMs;
    }
    return state.timer.elapsedMs + (Date.now() - new Date(state.timer.startedAt).getTime());
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return cloneDefaultState();
      }
      return normalizeState(JSON.parse(raw));
    } catch {
      return cloneDefaultState();
    }
  }

  function loadSeedTrees() {
    const bundled = window.FOREST_SEED_TREES;
    const list = Array.isArray(bundled)
      ? bundled
      : bundled && typeof bundled === "object" ? Object.values(bundled) : [];
    const trees = list.filter(
      (tree) => tree && tree.format === TREE_FORMAT && tree.tree && typeof tree.tree.id === "string"
    );
    if (!trees.length) {
      console.warn("[forest] 未加载到种子树：请确认 seed-trees/seed-trees.js 与 index.html 一起分发。");
    }
    return trees;
  }

  function buildNodeIndex(trees) {
    const index = new Map();
    trees.forEach((tree) => {
      (Array.isArray(tree.nodes) ? tree.nodes : []).forEach((node) => {
        if (node && typeof node.id === "string" && node.id) {
          index.set(`${tree.tree.id}::${node.id}`, node);
        }
      });
    });
    return index;
  }

  // 个人节点独立存储：形状坏了就当空叠加层，绝不让种子树启动失败
  function normalizeNodeOverlay(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      nodes: Array.isArray(source.nodes) ? source.nodes.filter((node) => node && typeof node === "object") : [],
      edges: Array.isArray(source.edges) ? source.edges.filter((edge) => edge && typeof edge === "object") : []
    };
  }

  function loadLocalNodeOverlay() {
    try {
      const raw = window.localStorage.getItem(CUSTOM_NODES_KEY);
      return raw ? normalizeNodeOverlay(JSON.parse(raw)) : { nodes: [], edges: [] };
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  async function loadRemoteNodeOverlay() {
    try {
      const response = await window.fetch("/api/nodes", { credentials: "same-origin" });
      if (!response.ok) {
        return { nodes: [], edges: [] };
      }
      return normalizeNodeOverlay(await readJsonResponse(response));
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  // 返回新树对象，不动种子数组：nodeIndex 合并后，个人节点才不算悬空
  function mergeCustomNodes(trees, overlay) {
    const nodes = overlay && Array.isArray(overlay.nodes) ? overlay.nodes : [];
    const edges = overlay && Array.isArray(overlay.edges) ? overlay.edges : [];
    return trees.map((tree) => {
      const treeId = tree.tree.id;
      const extraNodes = nodes.filter((node) => node.treeId === treeId);
      const extraIds = new Set(extraNodes.map((node) => node.id));
      const extraEdges = edges.filter((edge) => extraIds.has(edge.from) || extraIds.has(edge.to));
      return {
        ...tree,
        nodes: (Array.isArray(tree.nodes) ? tree.nodes : []).concat(extraNodes),
        edges: (Array.isArray(tree.edges) ? tree.edges : []).concat(extraEdges)
      };
    });
  }

  function nodeTitle(node) {
    return node && typeof node.title === "string" && node.title ? node.title : node && node.id ? node.id : "";
  }

  function getActiveTree() {
    return seedTrees.find((tree) => tree.tree.id === state.forest.activeTreeId) || seedTrees[0] || null;
  }

  function getNodeById(treeId, nodeId) {
    if (!treeId || !nodeId) {
      return null;
    }
    return nodeIndex.get(`${treeId}::${nodeId}`) || null;
  }

  function resolveNodeTitle(treeId, nodeId) {
    return nodeTitle(getNodeById(treeId, nodeId)) || nodeId;
  }

  // lightups 只有这一份内存索引：凡是改动 state.forest.lightups 的路径都必须重建，
  // 否则事件徽标会读到旧索引（新建草稿与级联清理两条路径都在重建）。
  function rebuildLightUpIndex() {
    lightUpByEventId = new Map();
    state.forest.lightups.forEach((lightUp) => {
      if (lightUp && typeof lightUp.eventId === "string" && lightUp.eventId) {
        lightUpByEventId.set(lightUp.eventId, lightUp);
      }
    });
  }

  function findLightUpByEventId(id) {
    return lightUpByEventId.get(id) || null;
  }

  // 「点亮」只有一个真相来源：state.forest.lightups。event.lightUp 是 v2 遗留布尔，
  // v3 起恒为 false，只用于给老数据一个诚实的旧标签。
  function resolveEventLightUpBadge(event) {
    const own = findLightUpByEventId(event.id);
    if (own && own.status === "confirmed") {
      return `已发出 · ${resolveNodeTitle(own.treeId, own.nodeId)}`;
    }
    if (own) {
      return `待发出 · ${resolveNodeTitle(own.treeId, own.nodeId)}`;
    }
    if (event.lightUp) {
      return "旧标记（未确认）";
    }
    return "本地记录";
  }

  // 唯一的瞄准写入者：nodeId 为 null 即清除瞄准
  function setSelectedNode(treeId, nodeId) {
    if (!nodeId) {
      state.forest.selectedNodeId = null;
      state.forest.selectedNodeAt = null;
    } else {
      state.forest.selectedNodeId = nodeId;
      state.forest.selectedNodeAt = new Date().toISOString();
      if (treeId) {
        state.forest.activeTreeId = treeId;
      }
    }
    clearAimNotice();
    saveState();
    // 选节点是高频动作：只重渲染瞄准行与计时读数，不跑全量 render()
    renderAimLine();
    renderTimer();
  }

  function clearAimNotice() {
    if (!elements.nodeAimNotice) {
      return;
    }
    elements.nodeAimNotice.textContent = "";
    elements.nodeAimNotice.classList.add("hidden");
  }

  // 纯查询：不写状态、不打日志；UI 只读它的返回值
  function resolveAimNode() {
    const { selectedNodeId, selectedNodeAt } = state.forest;
    if (!selectedNodeId) {
      return null;
    }
    const stamp = selectedNodeAt ? new Date(selectedNodeAt).getTime() : 0;
    if (!stamp || Date.now() - stamp > AIM_TTL_MS) {
      return null;
    }
    const tree = getActiveTree();
    return tree ? getNodeById(tree.tree.id, selectedNodeId) : null;
  }

  // 唯一的「清理 + 告知」点：启动后与每次 renderAimLine() 时调用。
  // 悬空判定独立于 TTL，否则「时间戳很旧的悬空 id」会被当成自然超时静默清掉。
  function pruneStaleAim() {
    const { selectedNodeId, selectedNodeAt } = state.forest;
    if (!selectedNodeId) {
      return null;
    }
    const stamp = selectedNodeAt ? new Date(selectedNodeAt).getTime() : 0;
    // 与 resolveAimNode() 同一条过期规则：没有时间戳（或时间戳无法解析）即视为过期
    const expired = !stamp || Date.now() - stamp > AIM_TTL_MS;
    const tree = getActiveTree();
    const treeId = tree ? tree.tree.id : null;
    const dangling = nodeIndex.size > 0 && !nodeIndex.has(`${treeId}::${selectedNodeId}`);
    if (!expired && !dangling) {
      return null;
    }
    if (dangling) {
      console.warn("[forest] 节点不在已加载的树中，已清除瞄准", treeId, selectedNodeId);
    }
    state.forest.selectedNodeId = null;
    state.forest.selectedNodeAt = null;
    lastAimNotice = dangling ? "dangling" : "expired";
    saveState();
    return lastAimNotice;
  }

  // 追加草稿；同一 eventId 已有则返回既有记录。成功后消费瞄准（一次选择最多产出一条草稿）。
  // 节点无效时静默返回 null、不改状态：调用方只在 resolveAimNode() 有值时进来。
  function createLightUpDraft(event) {
    const existing = findLightUpByEventId(event.id);
    if (existing) {
      return existing;
    }
    const node = resolveAimNode();
    if (!node) {
      return null;
    }
    const tree = getActiveTree();
    const lightUp = normalizeLightUp({
      id: createId(),
      treeId: tree ? tree.tree.id : null,
      nodeId: node.id,
      status: "draft",
      evidence: {
        type: "self",
        detail: event.singleLog || event.title,
        timestamp: event.createdAt
      },
      eventId: event.id,
      habitId: event.habitId,
      createdAt: event.createdAt
    });
    state.forest.lightups.unshift(lightUp);
    rebuildLightUpIndex();
    state.forest.selectedNodeId = null;
    state.forest.selectedNodeAt = null;
    return lightUp;
  }

  function normalizeState(raw) {
    const candidate = raw && typeof raw === "object" ? raw : {};
    const timer = candidate.timer && typeof candidate.timer === "object" ? candidate.timer : {};
    const settings = candidate.settings && typeof candidate.settings === "object" ? candidate.settings : {};
    return {
      version: STATE_VERSION,
      habit: normalizeHabit(candidate.habit, true),
      habitHistory: Array.isArray(candidate.habitHistory)
        ? candidate.habitHistory.map((habit) => normalizeHabit(habit, false)).filter(Boolean)
        : [],
      events: Array.isArray(candidate.events) ? candidate.events.map(normalizeEvent).filter(Boolean) : [],
      timer: {
        elapsedMs: Number(timer.elapsedMs) > 0 ? Number(timer.elapsedMs) : 0,
        running: Boolean(timer.running),
        startedAt: typeof timer.startedAt === "string" ? timer.startedAt : null,
        predictedAction: typeof timer.predictedAction === "string" ? timer.predictedAction : "",
        selectedOption: ["p1", "p2", "p3", "custom"].includes(timer.selectedOption)
          ? timer.selectedOption
          : "custom",
        selectedHabitId: typeof timer.selectedHabitId === "string" && timer.selectedHabitId ? timer.selectedHabitId : null,
        selectedHabitName:
          typeof timer.selectedHabitName === "string" && timer.selectedHabitName
            ? timer.selectedHabitName
            : CUSTOM_HABIT_NAME
      },
      settings: {
        hubConnected: Boolean(settings.hubConnected),
        lastBackupAt: typeof settings.lastBackupAt === "string" ? settings.lastBackupAt : null
      },
      forest: normalizeForest(candidate.forest)
    };
  }

  function normalizeForest(raw) {
    const forest = raw && typeof raw === "object" ? raw : {};
    return {
      activeTreeId: typeof forest.activeTreeId === "string" && forest.activeTreeId ? forest.activeTreeId : null,
      selectedNodeId:
        typeof forest.selectedNodeId === "string" && forest.selectedNodeId ? forest.selectedNodeId : null,
      selectedNodeAt: typeof forest.selectedNodeAt === "string" ? forest.selectedNodeAt : null,
      lightups: Array.isArray(forest.lightups) ? forest.lightups.map(normalizeLightUp).filter(Boolean) : []
    };
  }

  function normalizeLightUp(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    if (typeof raw.nodeId !== "string" || !raw.nodeId.trim()) {
      return null;
    }
    const evidence = raw.evidence && typeof raw.evidence === "object" ? raw.evidence : {};
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
      treeId: typeof raw.treeId === "string" && raw.treeId ? raw.treeId : null,
      nodeId: raw.nodeId.trim(),
      tutorialId: typeof raw.tutorialId === "string" && raw.tutorialId ? raw.tutorialId : null,
      status: raw.status === "confirmed" ? "confirmed" : "draft",
      evidence: {
        type: "self",
        detail: typeof evidence.detail === "string" ? evidence.detail : "",
        timestamp: typeof evidence.timestamp === "string" ? evidence.timestamp : new Date().toISOString()
      },
      eventId: typeof raw.eventId === "string" && raw.eventId ? raw.eventId : null,
      habitId: typeof raw.habitId === "string" && raw.habitId ? raw.habitId : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      confirmedAt: typeof raw.confirmedAt === "string" ? raw.confirmedAt : null,
      verified: false
    };
  }

  function normalizeHabit(rawHabit, active) {
    if (!rawHabit || typeof rawHabit !== "object") {
      return null;
    }
    if (typeof rawHabit.name !== "string" || !rawHabit.name.trim()) {
      return null;
    }
    return {
      id: typeof rawHabit.id === "string" && rawHabit.id ? rawHabit.id : createId(),
      name: rawHabit.name.trim(),
      startDate: typeof rawHabit.startDate === "string" ? rawHabit.startDate : new Date().toISOString(),
      targetDays: clampNumber(rawHabit.targetDays, 21, 365, 60),
      active,
      recurringLog: typeof rawHabit.recurringLog === "string" ? rawHabit.recurringLog : "",
      completedAt: typeof rawHabit.completedAt === "string" ? rawHabit.completedAt : null,
      progressDays: Number(rawHabit.progressDays) > 0 ? Number(rawHabit.progressDays) : undefined
    };
  }

  function normalizeEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") {
      return null;
    }
    if (typeof rawEvent.title !== "string" || !rawEvent.title.trim()) {
      return null;
    }
    return {
      id: typeof rawEvent.id === "string" && rawEvent.id ? rawEvent.id : createId(),
      habitId: typeof rawEvent.habitId === "string" && rawEvent.habitId ? rawEvent.habitId : null,
      habitName: typeof rawEvent.habitName === "string" && rawEvent.habitName ? rawEvent.habitName : null,
      title: rawEvent.title.trim(),
      nodeId: typeof rawEvent.nodeId === "string" && rawEvent.nodeId ? rawEvent.nodeId : null,
      treeId: typeof rawEvent.treeId === "string" && rawEvent.treeId ? rawEvent.treeId : null,
      createdAt: typeof rawEvent.createdAt === "string" ? rawEvent.createdAt : new Date().toISOString(),
      lightUp: Boolean(rawEvent.lightUp),
      singleLog: typeof rawEvent.singleLog === "string" ? rawEvent.singleLog : "",
      source:
        rawEvent.source === "timer"
          ? "timer"
          : rawEvent.source === "quick-note"
            ? "quick-note"
            : "manual",
      durationMs: Number(rawEvent.durationMs) > 0 ? Number(rawEvent.durationMs) : null,
      report: typeof rawEvent.report === "string" ? rawEvent.report : ""
    };
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      if (!stateSync) window.alert("浏览器空间不足，记录尚未保存，请导出备份并保持页面打开。");
    }
    if (!LOCAL_ONLY && remoteSyncReady) {
      scheduleRemoteSave();
    }
  }

  function scheduleRemoteSave() {
    stateSync.queue(state);
  }

  function getCachedBugs() {
    try {
      const raw = window.localStorage.getItem(BUG_CACHE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function cacheBugs(bugs) {
    window.localStorage.setItem(BUG_CACHE_KEY, JSON.stringify(bugs.slice(0, MAX_BUG_CACHE)));
  }

  function mergeBugLists(primary, secondary) {
    const map = new Map();
    primary.concat(secondary).forEach((bug) => {
      if (!bug || !bug.id || map.has(bug.id)) {
        return;
      }
      map.set(bug.id, bug);
    });
    return Array.from(map.values())
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, MAX_BUG_CACHE);
  }

  function createEmptyCard(message) {
    return `<article class="done-item"><div class="done-meta">${escapeHtml(message)}</div></article>`;
  }

  function resolveSeverityLabel(severity) {
    if (severity === "high") {
      return "高";
    }
    if (severity === "low") {
      return "低";
    }
    return "中";
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `id-${Math.random().toString(16).slice(2, 10)}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  function getDayKey(value) {
    return formatDate(value);
  }

  function getWeekKey(value) {
    const date = new Date(value);
    const day = date.getDay() || 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 10);
  }

  function getMonthKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function getPeriodKey(value, mode) {
    if (mode === "day") {
      return new Date(value).toISOString().slice(0, 10);
    }
    if (mode === "week") {
      return getWeekKey(value);
    }
    return getMonthKey(value);
  }

  function getRecentWeekKeys(count) {
    const keys = [];
    let cursor = new Date();
    for (let index = 0; index < count; index += 1) {
      keys.push(getWeekKey(cursor.toISOString()));
      cursor = addDays(cursor, -7);
    }
    return keys;
  }

  function formatDate(value) {
    return new Date(value).toLocaleDateString("zh-CN");
  }

  function formatPeriodLabel(value, mode) {
    const date = new Date(value);
    if (mode === "day") {
      return formatDate(value);
    }
    if (mode === "week") {
      return `${formatDate(getWeekKey(value))} 所在周`;
    }
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
  }

  function formatDateTime(value) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function getErrorMessage(error) {
    if (error instanceof Error) {
      return error.message;
    }
    return "未知错误";
  }

  function showApp() {
    const gate = document.getElementById("account-gate");
    if (gate) {
      gate.classList.add("hidden");
    }
    const shell = document.querySelector(".app-shell");
    if (shell) {
      shell.classList.remove("hidden");
    }
  }

  function showGate() {
    const gate = document.getElementById("account-gate");
    if (gate) {
      gate.classList.remove("hidden");
    }
    const shell = document.querySelector(".app-shell");
    if (shell) {
      shell.classList.add("hidden");
    }
  }

  function readJsonResponse(response) {
    return response.json().catch(() => null);
  }

  function fallbackToLocal() {
    state = loadState();
    showApp();
    bootApp();
    appBooted = true;
  }

  // 游客模式：不建账号，直接用本机存档。注册/登录后由 enterApp() 接管并同步。
  function enterGuest() {
    guestMode = true;
    try {
      localStorage.setItem(GUEST_KEY, "1");
    } catch {}
    state = loadState();
    showApp();
    if (!appBooted) {
      bootApp();
      appBooted = true;
    }
    syncGuestChrome();
  }

  function syncGuestChrome() {
    const logout = document.getElementById("account-logout");
    if (logout) {
      logout.textContent = guestMode ? "登录 / 注册" : "退出";
    }
  }

  async function enterApp() {
    remoteSyncReady = false;
    stateSync = new window.KHTStateSync(currentUser.id);
    const nextState = await stateSync.load();
    state = nextState ? normalizeState(nextState) : cloneDefaultState();
    customNodeOverlay = await loadRemoteNodeOverlay();
    showApp();
    if (!appBooted) {
      bootApp();
      appBooted = true;
    } else {
      seedTrees = mergeCustomNodes(loadSeedTrees(), customNodeOverlay);
      nodeIndex = buildNodeIndex(seedTrees);
      rebuildLightUpIndex();
      pruneStaleAim();
      render();
    }
    // 启动加载本身不写服务端，等用户第一次改动再同步
    remoteSyncReady = true;
    if (stateSync.pending) void stateSync.flush();
  }

  function returnToGate() {
    remoteSyncReady = false;
    const passwordInput = document.getElementById("account-password");
    if (passwordInput) {
      passwordInput.value = "";
    }
    showGate();
  }

  async function resolveInitialSession() {
    let response;
    try {
      response = await window.fetch("/api/me", { credentials: "same-origin" });
    } catch {
      if (window.location.protocol === "file:") {
        fallbackToLocal();
      } else {
        const errorBox = document.getElementById("account-error");
        errorBox.textContent = "本机服务连接中断。请恢复服务后登录，账号记录不会被空白状态覆盖。";
        errorBox.classList.remove("hidden");
      }
      return;
    }
    if (response.status === 404) {
      if (window.location.protocol === "file:") fallbackToLocal();
      return;
    }
    if (!response.ok) {
      // 401 等：留在门口等用户登录
      return;
    }
    const data = await readJsonResponse(response);
    if (!data || !data.user) {
      return;
    }
    currentUser = data.user;
    try {
      await enterApp();
    } catch {
      showGate();
    }
  }

  function setupAccountGate() {
    const form = document.getElementById("account-form");
    const gate = document.getElementById("account-gate");
    if (!gate || !form) {
      fallbackToLocal();
      return;
    }
    const nameInput = document.getElementById("account-name");
    const passwordInput = document.getElementById("account-password");
    const submitButton = document.getElementById("account-submit");
    const errorBox = document.getElementById("account-error");
    const registerButton = document.getElementById("account-mode-register");
    const loginButton = document.getElementById("account-mode-login");
    const logoutButton = document.getElementById("account-logout");
    const guestButton = document.getElementById("account-guest");
    let mode = "register";
    let busy = false;

    function showError(message) {
      if (!errorBox) {
        return;
      }
      errorBox.textContent = message || "";
      errorBox.classList.toggle("hidden", !message);
    }

    function setMode(next) {
      mode = next;
      registerButton.classList.toggle("active", mode === "register");
      loginButton.classList.toggle("active", mode === "login");
      passwordInput.setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
      submitButton.textContent = mode === "register" ? "注册并进入" : "登录";
      showError("");
    }

    registerButton.addEventListener("click", () => setMode("register"));
    loginButton.addEventListener("click", () => setMode("login"));

    if (guestButton) {
      guestButton.addEventListener("click", () => enterGuest());
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) {
        return;
      }
      busy = true;
      submitButton.disabled = true;
      showError("");
      try {
        const response = await window.fetch(mode === "register" ? "/api/register" : "/api/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameInput.value.trim(), password: passwordInput.value })
        });
        const data = await readJsonResponse(response);
        if (!response.ok || !data || !data.ok || !data.user) {
          const fallbackMessage = mode === "register" ? "注册失败，请稍后再试。" : "登录失败，请稍后再试。";
          showError((data && data.message) || fallbackMessage);
          return;
        }
        passwordInput.value = "";
        currentUser = data.user;
        guestMode = false;
        try {
          localStorage.removeItem(GUEST_KEY);
        } catch {}
        syncGuestChrome();
        await enterApp();
      } catch (error) {
        showError(error.message || "连接失败，请稍后再试。");
      } finally {
        busy = false;
        submitButton.disabled = false;
      }
    });

    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        if (guestMode) {
          guestMode = false;
          try {
            localStorage.removeItem(GUEST_KEY);
          } catch {}
          syncGuestChrome();
          returnToGate();
          return;
        }
        if (stateSync && !(await stateSync.flush())) return;
        try {
          const response = await window.fetch("/api/logout", { method: "POST", credentials: "same-origin" });
          if (!response.ok) throw new Error("退出失败");
        } catch {
          if (stateSync) stateSync.show("退出失败，请重试。已保存的记录不受影响。", true);
          return;
        }
        returnToGate();
      });
    }

    setMode("register");
    let resumingGuest = false;
    try {
      resumingGuest = localStorage.getItem(GUEST_KEY) === "1";
    } catch {}
    if (resumingGuest) {
      enterGuest();
      return;
    }
    resolveInitialSession();
  }

  if (LOCAL_ONLY) {
    state = loadState();
    showApp();
    bootApp();
    appBooted = true;
  } else {
    showGate();
    setupAccountGate();
  }
})();
