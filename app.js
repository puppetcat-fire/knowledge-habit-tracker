const storageKey = "knowledge-habit-tracker";

const defaultState = {
  habit: null,
  habitHistory: [],
  events: [],
  timer: {
    elapsedMs: 0,
    running: false,
    startedAt: null,
    predictedAction: "",
    selectedOption: "p1",
    selectedHabitId: null,
    selectedHabitName: "自定义"
  },
  settings: {
    hubConnected: false
  }
};

const state = loadState();

const habitEmpty = document.getElementById("habit-empty");
const habitActive = document.getElementById("habit-active");
const habitForm = document.getElementById("habit-form");
const habitNameInput = document.getElementById("habit-name");
const habitDaysInput = document.getElementById("habit-days");
const habitRecurringLogInput = document.getElementById("habit-recurring-log");
const habitTitle = document.getElementById("habit-title");
const habitMeta = document.getElementById("habit-meta");
const habitDaysProgress = document.getElementById("habit-days-progress");
const habitWeeklyStatus = document.getElementById("habit-weekly-status");
const completeHabitButton = document.getElementById("complete-habit");
const startTimerFromHabitButton = document.getElementById("start-timer-from-habit");
const editHabitButton = document.getElementById("edit-habit");
const deleteHabitButton = document.getElementById("delete-habit");
const habitHistoryList = document.getElementById("habit-history-list");

const hubToggle = document.getElementById("hub-connected");
const doneForm = document.getElementById("done-form");
const doneTitleInput = document.getElementById("done-title");
const doneLogInput = document.getElementById("done-log");
const doneList = document.getElementById("done-list");
const habitEventGroups = document.getElementById("habit-event-groups");
const battleReport = document.getElementById("battle-report");
const bugForm = document.getElementById("bug-form");
const bugTitleInput = document.getElementById("bug-title");
const bugDescriptionInput = document.getElementById("bug-description");
const bugStepsInput = document.getElementById("bug-steps");
const bugExpectedInput = document.getElementById("bug-expected");
const bugActualInput = document.getElementById("bug-actual");
const bugSeverityInput = document.getElementById("bug-severity");
const bugContactInput = document.getElementById("bug-contact");
const bugStatus = document.getElementById("bug-status");
const bugList = document.getElementById("bug-list");
const filterButtons = Array.from(document.querySelectorAll(".filter"));
const navButtons = Array.from(document.querySelectorAll(".nav-button"));
const pages = Array.from(document.querySelectorAll(".page"));
const timerDisplay = document.getElementById("timer-display");
const timerPredictionInput = document.getElementById("timer-prediction");
const timerPredictionDisplay = document.getElementById("timer-prediction-display");
const timerSuggestions = document.getElementById("timer-suggestions");
const timerRecurringLog = document.getElementById("timer-recurring-log");
const timerRecurringStatus = document.getElementById("timer-recurring-status");
const timerSingleLogInput = document.getElementById("timer-single-log");
const timerReport = document.getElementById("timer-report");
const habitReminder = document.getElementById("habit-reminder");
const habitPicker = document.getElementById("habit-picker");
const habitPickerToggle = document.getElementById("habit-picker-toggle");
const habitPickerSearch = document.getElementById("habit-picker-search");
const habitPickerList = document.getElementById("habit-picker-list");
const timerHabitLabel = document.getElementById("timer-habit-label");
const timerStartButton = document.getElementById("timer-start");
const timerResetButton = document.getElementById("timer-reset");
const timerFinishButton = document.getElementById("timer-finish");

let activeRange = "all";
let activePage = "timer";
let timerInterval = null;
let lastTimerPersist = 0;

hubToggle.checked = state.settings.hubConnected;

hubToggle.addEventListener("change", () => {
  state.settings.hubConnected = hubToggle.checked;
  saveState();
});

habitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.habit && state.habit.active) {
    return;
  }
  const name = habitNameInput.value.trim();
  const targetDays = Number(habitDaysInput.value);
  if (!name || Number.isNaN(targetDays) || targetDays < 60 || targetDays > 255) {
    return;
  }
  state.habit = {
    id: crypto.randomUUID(),
    name,
    startDate: new Date().toISOString(),
    targetDays,
    active: true,
    recurringLog: habitRecurringLogInput.value.trim(),
    completedAt: null
  };
  saveState();
  habitForm.reset();
  habitDaysInput.value = "60";
  render();
});

completeHabitButton.addEventListener("click", () => {
  if (!state.habit || !state.habit.active) {
    return;
  }
  const qualification = evaluateHabitQualification(state.habit, state.events);
  if (!qualification.isQualified) {
    return;
  }
  const completedAt = new Date().toISOString();
  const progressDays = countHabitDays(state.habit, state.events);
  const historyItem = {
    ...state.habit,
    completedAt,
    progressDays
  };
  state.habitHistory.unshift(historyItem);
  state.habit.active = false;
  state.habit.completedAt = completedAt;
  state.habit = null;
  saveState();
  render();
});

editHabitButton.addEventListener("click", () => {
  if (!state.habit || !state.habit.active) {
    return;
  }
  editHabitRecord(state.habit, "active");
});

deleteHabitButton.addEventListener("click", () => {
  if (!state.habit || !state.habit.active) {
    return;
  }
  if (!confirm(`删除习惯「${state.habit.name}」？`)) {
    return;
  }
  if (state.timer.selectedHabitId === state.habit.id) {
    state.timer.selectedHabitId = null;
    state.timer.selectedHabitName = "自定义";
  }
  state.habit = null;
  saveState();
  render();
});

doneForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.habit || !state.habit.active) {
    return;
  }
  const title = doneTitleInput.value.trim();
  if (!title) {
    return;
  }
  const singleLog = doneLogInput.value.trim();
  const createdAt = new Date();
  const lightUp = state.settings.hubConnected;
  const report = buildBattleReport(state.habit, title, createdAt, lightUp);
  const newEvent = {
    id: crypto.randomUUID(),
    habitId: state.habit.id,
    habitName: state.habit.name,
    title,
    createdAt: createdAt.toISOString(),
    lightUp,
    singleLog,
    report
  };
  state.events.unshift(newEvent);
  saveState();
  doneForm.reset();
  showReport(report);
  render();
});

if (bugForm) {
  bugForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: bugTitleInput.value.trim(),
      description: bugDescriptionInput.value.trim(),
      steps: bugStepsInput.value.trim(),
      expected: bugExpectedInput.value.trim(),
      actual: bugActualInput.value.trim(),
      severity: bugSeverityInput.value,
      contact: bugContactInput.value.trim(),
      page: activePage
    };
    if (!payload.title || !payload.description) {
      showBugStatus("请填写标题与问题描述", false);
      return;
    }
    const result = await submitBug(payload);
    if (result.ok) {
      bugForm.reset();
      showBugStatus("已提交到本地服务器", true);
      if (result.bug) {
        renderBugList([result.bug, ...getCachedBugs()].slice(0, 10));
        cacheBug(result.bug);
      }
    } else {
      showBugStatus(result.message || "提交失败，请稍后重试", false);
    }
  });
}

timerPredictionInput.addEventListener("input", () => {
  state.timer.selectedOption = "custom";
  state.timer.predictedAction = timerPredictionInput.value.trim();
  saveState();
  renderTimer();
});

timerRecurringLog.addEventListener("input", () => {
  if (!state.habit || !state.habit.active) {
    return;
  }
  state.habit.recurringLog = timerRecurringLog.value.trim();
  saveState();
  setRecurringStatus("已保存", true);
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeRange = button.dataset.range;
    renderDoneList();
  });
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActivePage(button.dataset.pageTarget);
  });
});

timerStartButton.addEventListener("click", () => {
  if (state.timer.running) {
    pauseTimer();
  } else {
    startTimer();
  }
});

timerResetButton.addEventListener("click", () => {
  resetTimer();
});

timerFinishButton.addEventListener("click", () => {
  finishTimer();
});

habitPickerToggle.addEventListener("click", () => {
  habitPicker.classList.toggle("hidden");
});

habitPickerSearch.addEventListener("input", () => {
  renderHabitPicker();
});

startTimerFromHabitButton.addEventListener("click", () => {
  if (!state.habit || !state.habit.active) {
    return;
  }
  timerPredictionInput.value = state.habit.name;
  state.timer.predictedAction = state.habit.name;
  state.timer.selectedOption = "p1";
  state.timer.selectedHabitId = state.habit.id;
  state.timer.selectedHabitName = state.habit.name;
  saveState();
  setActivePage("timer");
  startTimer();
});

render();
startTimerTicker();

function render() {
  renderHabit();
  renderHabitHistory();
  renderDoneList();
  renderHabitEventGroups();
  renderBugList(getCachedBugs());
  renderTimer();
  renderHabitReminder();
}

function renderHabit() {
  if (!state.habit || !state.habit.active) {
    habitEmpty.classList.remove("hidden");
    habitActive.classList.add("hidden");
    return;
  }

  habitEmpty.classList.add("hidden");
  habitActive.classList.remove("hidden");

  const habit = state.habit;
  habitTitle.textContent = habit.name;
  habitMeta.textContent = `开始于 ${formatDate(habit.startDate)} · 目标 ${habit.targetDays} 天`;

  const progressDays = countHabitDays(habit, state.events);
  habitDaysProgress.textContent = `${progressDays} / ${habit.targetDays}`;

  const qualification = evaluateHabitQualification(habit, state.events);
  habitWeeklyStatus.textContent = qualification.summary;
  completeHabitButton.disabled = !qualification.isQualified;
  renderHabitActiveDetail(habit, progressDays);
}

function renderHabitActiveDetail(habit, progressDays) {
  const container = habitActive.querySelector(".habit-detail");
  if (!container) {
    return;
  }
  const recurringLog = habit.recurringLog ? escapeHtml(habit.recurringLog) : "暂无";
  container.innerHTML = `
    <div class="habit-detail-row">
      <span>完成天数</span>
      <span>${progressDays} / ${habit.targetDays}</span>
    </div>
    <div class="habit-detail-row">
      <span>重复日志</span>
      <button class="expand-toggle" type="button">展开</button>
    </div>
    <div class="habit-log expand-body hidden">${recurringLog}</div>
  `;
  const toggle = container.querySelector(".expand-toggle");
  const body = container.querySelector(".expand-body");
  toggle.addEventListener("click", () => {
    body.classList.toggle("hidden");
  });
}

function renderHabitHistory() {
  if (!habitHistoryList) {
    return;
  }
  if (!state.habitHistory || state.habitHistory.length === 0) {
    habitHistoryList.innerHTML = `<div class="empty-state">暂无历史习惯</div>`;
    return;
  }
  habitHistoryList.innerHTML = state.habitHistory
    .map((habit) => {
      const endText = habit.completedAt ? formatDate(habit.completedAt) : "进行中";
      const progressText = habit.progressDays ? `${habit.progressDays} 天` : "0 天";
      const recurringLog = habit.recurringLog ? escapeHtml(habit.recurringLog) : "暂无";
      return `
        <div class="done-item" data-habit-id="${habit.id}">
          <h4>${escapeHtml(habit.name)}</h4>
          <div class="done-meta">开始 ${formatDate(habit.startDate)} · 结束 ${endText} · 目标 ${habit.targetDays} 天 · 完成 ${progressText}</div>
          <div class="habit-detail">
            <div class="habit-detail-row">
              <span>重复日志</span>
              <button class="expand-toggle" type="button">展开</button>
            </div>
            <div class="habit-log expand-body hidden">${recurringLog}</div>
          </div>
          <div class="item-actions">
            <button class="action-button" type="button" data-action="edit">编辑</button>
            <button class="action-button danger" type="button" data-action="delete">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
  Array.from(habitHistoryList.querySelectorAll(".expand-toggle")).forEach((button) => {
    button.addEventListener("click", () => {
      const body = button.closest(".habit-detail").querySelector(".expand-body");
      body.classList.toggle("hidden");
    });
  });
  Array.from(habitHistoryList.querySelectorAll(".action-button")).forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".done-item");
      const habitId = card?.dataset.habitId;
      if (!habitId) return;
      const habit = state.habitHistory.find((h) => h.id === habitId);
      if (!habit) return;
      const action = button.dataset.action;
      if (action === "edit") {
        editHabitRecord(habit, "history");
      } else if (action === "delete") {
        if (!confirm(`删除历史习惯「${habit.name}」？`)) return;
        state.habitHistory = state.habitHistory.filter((h) => h.id !== habitId);
        if (state.timer.selectedHabitId === habitId) {
          state.timer.selectedHabitId = null;
          state.timer.selectedHabitName = "自定义";
        }
        saveState();
        render();
      }
    });
  });
}

function renderDoneList() {
  const filtered = filterEvents(state.events, activeRange);
  if (filtered.length === 0) {
    doneList.innerHTML = `<div class="empty-state">暂无记录</div>`;
    return;
  }
  doneList.innerHTML = filtered
    .map((event) => {
      const lightUpLabel = event.lightUp ? "已点亮" : "本地记录";
      const durationText = event.durationMs ? ` · ${formatDuration(event.durationMs)}` : "";
      const sourceText = event.source === "timer" ? " · 计时" : "";
      const singleLog = event.singleLog ? escapeHtml(event.singleLog) : "";
      return `
        <div class="done-item" data-event-id="${event.id}">
          <h4>${escapeHtml(event.title)}</h4>
          <div class="done-meta">${formatDateTime(event.createdAt)} · ${lightUpLabel}${sourceText}${durationText}</div>
          ${singleLog ? `<div class="habit-detail"><div class="habit-detail-row"><span>单次日志</span><button class="expand-toggle" type="button">展开</button></div><div class="habit-log expand-body hidden">${singleLog}</div></div>` : ""}
          <div class="item-actions">
            <button class="action-button" type="button" data-action="edit">编辑</button>
            <button class="action-button danger" type="button" data-action="delete">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
  Array.from(doneList.querySelectorAll(".expand-toggle")).forEach((button) => {
    button.addEventListener("click", () => {
      const body = button.closest(".habit-detail").querySelector(".expand-body");
      body.classList.toggle("hidden");
    });
  });
  Array.from(doneList.querySelectorAll(".action-button")).forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".done-item");
      const eventId = card?.dataset.eventId;
      if (!eventId) return;
      const event = state.events.find((item) => item.id === eventId);
      if (!event) return;
      const action = button.dataset.action;
      if (action === "edit") {
        editEventRecord(event);
      } else if (action === "delete") {
        if (!confirm(`删除记录「${event.title}」？`)) return;
        state.events = state.events.filter((item) => item.id !== eventId);
        saveState();
        render();
      }
    });
  });
}

function renderHabitEventGroups() {
  if (!habitEventGroups) {
    return;
  }
  if (!state.events || state.events.length === 0) {
    habitEventGroups.innerHTML = `<div class="empty-state">暂无记录</div>`;
    return;
  }
  const groups = new Map();
  state.events.forEach((event) => {
    const key = event.habitId || `custom:${event.habitName || "自定义"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        habitId: event.habitId || null,
        habitName: event.habitName || null,
        events: []
      });
    }
    groups.get(key).events.push(event);
  });
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const timeA = new Date(a.events[0].createdAt).getTime();
    const timeB = new Date(b.events[0].createdAt).getTime();
    return timeB - timeA;
  });
  habitEventGroups.innerHTML = sortedGroups
    .map((group) => {
      const label = getHabitDisplayName(group.habitId, group.habitName);
      const latest = group.events[0];
      return `
        <div class="done-item">
          <div class="group-header">
            <h4>${escapeHtml(label)}</h4>
            <span class="group-meta">${group.events.length} 条</span>
          </div>
          <div class="done-meta">最近记录：${formatDateTime(latest.createdAt)}</div>
          <div class="habit-detail">
            <div class="habit-detail-row">
              <span>记录列表</span>
              <button class="expand-toggle" type="button">展开</button>
            </div>
            <div class="group-events expand-body hidden">
              ${group.events
                .map((event) => {
                  const lightUpLabel = event.lightUp ? "已点亮" : "本地记录";
                  const durationText = event.durationMs ? ` · ${formatDuration(event.durationMs)}` : "";
                  const sourceText = event.source === "timer" ? " · 计时" : "";
                  const singleLog = event.singleLog ? escapeHtml(event.singleLog) : "";
                  return `
                    <div class="group-event">
                      <div class="group-event-title">${escapeHtml(event.title)}</div>
                      <div class="done-meta">${formatDateTime(event.createdAt)} · ${lightUpLabel}${sourceText}${durationText}</div>
                      ${singleLog ? `<div class="done-meta">单次日志：${singleLog}</div>` : ""}
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
  Array.from(habitEventGroups.querySelectorAll(".expand-toggle")).forEach((button) => {
    button.addEventListener("click", () => {
      const body = button.closest(".habit-detail").querySelector(".expand-body");
      body.classList.toggle("hidden");
    });
  });
}

function showBugStatus(message, isSuccess) {
  if (!bugStatus) {
    return;
  }
  bugStatus.textContent = message;
  bugStatus.classList.remove("hidden");
  bugStatus.style.background = isSuccess ? "#f0f7ff" : "#fff2f2";
  bugStatus.style.borderColor = isSuccess ? "#cfe1ff" : "#f1c4c4";
  bugStatus.style.color = isSuccess ? "#2b6cff" : "#d74c4c";
}

function getCachedBugs() {
  const cached = localStorage.getItem("bug-reports");
  if (!cached) {
    return [];
  }
  try {
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cacheBug(bug) {
  const next = [bug, ...getCachedBugs()].slice(0, 20);
  localStorage.setItem("bug-reports", JSON.stringify(next));
}

function renderBugList(bugs) {
  if (!bugList) {
    return;
  }
  if (!bugs || bugs.length === 0) {
    bugList.innerHTML = `<div class="empty-state">暂无提交记录</div>`;
    return;
  }
  bugList.innerHTML = bugs
    .map((bug) => {
      const title = escapeHtml(bug.title || "未命名");
      const description = bug.description ? escapeHtml(bug.description) : "";
      const severity = bug.severity || "medium";
      const createdAt = bug.createdAt ? formatDateTime(bug.createdAt) : "刚刚";
      return `
        <div class="done-item">
          <div class="group-header">
            <h4>${title}</h4>
            <span class="group-meta">${severity}</span>
          </div>
          <div class="done-meta">${createdAt}</div>
          <div class="done-meta">${description}</div>
        </div>
      `;
    })
    .join("");
}

async function submitBug(payload) {
  try {
    const response = await fetch("/api/bugs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      return { ok: false, message: data?.message };
    }
    return { ok: true, bug: data?.bug };
  } catch {
    return { ok: false, message: "无法连接本地服务器" };
  }
}

function getHabitDisplayName(habitId, fallbackName) {
  if (habitId && state.habit && state.habit.id === habitId) {
    return state.habit.name;
  }
  if (habitId) {
    const historyHabit = state.habitHistory.find((habit) => habit.id === habitId);
    if (historyHabit) {
      return historyHabit.name;
    }
  }
  if (fallbackName) {
    return fallbackName;
  }
  return "自定义";
}

function showReport(report) {
  battleReport.textContent = report;
  battleReport.classList.remove("hidden");
  if (timerReport) {
    timerReport.textContent = report;
    timerReport.classList.remove("hidden");
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return structuredClone(defaultState);
    }
    const parsed = JSON.parse(raw);
    return {
      habit: parsed.habit || null,
      habitHistory: Array.isArray(parsed.habitHistory) ? parsed.habitHistory : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      timer: {
        elapsedMs: Number(parsed.timer?.elapsedMs) || 0,
        running: Boolean(parsed.timer?.running),
        startedAt: parsed.timer?.startedAt || null,
        predictedAction: parsed.timer?.predictedAction || "",
        selectedOption: parsed.timer?.selectedOption || "p1",
        selectedHabitId: parsed.timer?.selectedHabitId || null,
        selectedHabitName: parsed.timer?.selectedHabitName || "自定义"
      },
      settings: {
        hubConnected: Boolean(parsed.settings?.hubConnected)
      }
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function editHabitRecord(habit, source) {
  const nameInput = prompt("习惯名称", habit.name);
  if (nameInput === null) {
    return;
  }
  const name = nameInput.trim();
  if (!name) {
    return;
  }
  const daysInput = prompt("养成周期（天）", String(habit.targetDays));
  if (daysInput === null) {
    return;
  }
  const targetDays = Number(daysInput);
  if (Number.isNaN(targetDays) || targetDays < 60 || targetDays > 255) {
    alert("养成周期需在 60-255 天");
    return;
  }
  const recurringInput = prompt("重复日志", habit.recurringLog || "");
  if (recurringInput === null) {
    return;
  }
  habit.name = name;
  habit.targetDays = targetDays;
  habit.recurringLog = recurringInput.trim();
  if (state.timer.selectedHabitId === habit.id) {
    state.timer.selectedHabitName = habit.name;
  }
  if (source === "active") {
    state.habit = habit;
  }
  syncHabitNameToEvents(habit.id, habit.name);
  saveState();
  render();
}

function editEventRecord(event) {
  const titleInput = prompt("事件标题", event.title);
  if (titleInput === null) {
    return;
  }
  const title = titleInput.trim();
  if (!title) {
    return;
  }
  const logInput = prompt("单次日志", event.singleLog || "");
  if (logInput === null) {
    return;
  }
  event.title = title;
  event.singleLog = logInput.trim();
  const habit = resolveEventHabit(event) || { name: event.habitName || "习惯" };
  const createdAt = new Date(event.createdAt);
  if (event.source === "timer") {
    event.report = buildTimerReport(
      title,
      event.durationMs || 0,
      createdAt,
      event.lightUp,
      habit
    );
  } else {
    event.report = buildBattleReport(habit, title, createdAt, event.lightUp);
  }
  saveState();
  render();
}

function resolveEventHabit(event) {
  if (event.habitId) {
    const activeHabit = state.habit && state.habit.id === event.habitId ? state.habit : null;
    if (activeHabit) {
      return activeHabit;
    }
    const historyHabit = state.habitHistory.find((habit) => habit.id === event.habitId);
    if (historyHabit) {
      return historyHabit;
    }
    if (event.habitName) {
      return { id: event.habitId, name: event.habitName };
    }
  }
  if (event.habitName) {
    return { id: null, name: event.habitName };
  }
  return null;
}

function syncHabitNameToEvents(habitId, name) {
  state.events.forEach((event) => {
    if (event.habitId !== habitId) {
      return;
    }
    event.habitName = name;
    const createdAt = new Date(event.createdAt);
    if (event.source === "timer") {
      event.report = buildTimerReport(
        event.title,
        event.durationMs || 0,
        createdAt,
        event.lightUp,
        { id: habitId, name }
      );
    } else {
      event.report = buildBattleReport({ id: habitId, name }, event.title, createdAt, event.lightUp);
    }
  });
}

function buildBattleReport(habit, title, createdAt, lightUp) {
  const dateText = formatDateTime(createdAt.toISOString());
  const lightUpText = lightUp ? "已触发点亮" : "本地记录";
  return `战报：${dateText} 完成「${habit.name}」—— ${title}（${lightUpText}）`;
}

function buildTimerReport(action, durationMs, createdAt, lightUp, habit) {
  const dateText = formatDateTime(createdAt.toISOString());
  const lightUpText = lightUp ? "已触发点亮" : "本地记录";
  const habitText = habit ? ` · 习惯「${habit.name}」` : "";
  return `战报：${dateText} 专注计时 ${formatDuration(durationMs)}，行动「${action}」${habitText}（${lightUpText}）`;
}

function setActivePage(page) {
  activePage = page;
  pages.forEach((section) => {
    const isActive = section.dataset.page === activePage;
    section.classList.toggle("hidden", !isActive);
  });
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.pageTarget === activePage);
  });
}

function startTimer() {
  if (state.timer.running) {
    return;
  }
  const candidates = getPredictionCandidates();
  const predictedAction = resolveSelectedAction(candidates);
  ensureHabitSelection();
  timerPredictionInput.value = predictedAction;
  state.timer.predictedAction = predictedAction;
  state.timer.running = true;
  state.timer.startedAt = new Date().toISOString();
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
  state.timer.predictedAction = timerPredictionInput.value.trim();
  saveState();
  renderTimer();
}

function finishTimer() {
  const elapsedMs = getElapsedMs();
  if (elapsedMs === 0) {
    return;
  }
  const createdAt = new Date();
  const lightUp = state.settings.hubConnected;
  const candidates = getPredictionCandidates();
  const action = resolveSelectedAction(candidates);
  const habit = resolveSelectedHabit();
  const singleLog = timerSingleLogInput ? timerSingleLogInput.value.trim() : "";
  const report = buildTimerReport(action, elapsedMs, createdAt, lightUp, habit);
  const newEvent = {
    id: crypto.randomUUID(),
    habitId: habit && habit.id ? habit.id : null,
    habitName: habit ? habit.name : null,
    title: action,
    createdAt: createdAt.toISOString(),
    lightUp,
    report,
    source: "timer",
    durationMs: elapsedMs,
    singleLog
  };
  state.events.unshift(newEvent);
  showReport(report);
  state.timer.elapsedMs = 0;
  state.timer.running = false;
  state.timer.startedAt = null;
  state.timer.predictedAction = action;
  saveState();
  if (timerSingleLogInput) {
    timerSingleLogInput.value = "";
  }
  render();
}

function startTimerTicker() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  timerInterval = setInterval(() => {
    if (state.timer.running) {
      renderTimer();
      const now = Date.now();
      if (now - lastTimerPersist > 5000) {
        lastTimerPersist = now;
        saveState();
      }
    }
  }, 250);
  setActivePage(activePage);
}

function renderTimer() {
  const elapsedMs = getElapsedMs();
  timerDisplay.textContent = formatDuration(elapsedMs);
  timerStartButton.textContent = state.timer.running ? "暂停" : "开始";
  timerResetButton.disabled = elapsedMs === 0;
  timerFinishButton.disabled = elapsedMs === 0;
  const candidates = getPredictionCandidates();
  const prediction = resolveSelectedAction(candidates);
  timerPredictionDisplay.textContent = prediction ? `预测：${prediction}` : "未预测";
  renderSuggestions(candidates);
  renderHabitPicker();
  if (timerRecurringLog) {
    const recurring = state.habit && state.habit.active ? state.habit.recurringLog : "";
    timerRecurringLog.value = recurring ? recurring : "";
    if (state.habit && state.habit.active) {
      setRecurringStatus(recurring ? "已保存" : "未填写", Boolean(recurring));
    } else {
      setRecurringStatus("无习惯", false);
    }
  }
}

function renderHabitReminder() {
  if (!habitReminder) {
    return;
  }
  if (!state.habit || !state.habit.active) {
    habitReminder.classList.add("hidden");
    habitReminder.textContent = "";
    return;
  }
  const todayCount = countTodayHabitEvents(state.habit, state.events);
  const statusText = todayCount >= 1 ? "已完成 1/1" : "今日完成 0/1";
  habitReminder.textContent = `养成中「${state.habit.name}」${statusText}，别忘了完成哦`;
  habitReminder.classList.toggle("hidden", todayCount >= 1);
}

function renderHabitPicker() {
  if (!habitPicker || !habitPickerList || !timerHabitLabel) {
    return;
  }
  ensureHabitSelection();
  timerHabitLabel.textContent = state.timer.selectedHabitName || "自定义";
  const keyword = habitPickerSearch ? habitPickerSearch.value.trim() : "";
  const habits = getAvailableHabits();
  const items = [
    { id: null, name: "自定义", label: "自定义" },
    ...habits.map((habit) => ({
      id: habit.id,
      name: habit.name,
      label: habit.active ? `${habit.name} · 养成中` : habit.name
    }))
  ].filter((item) => {
    if (!keyword) {
      return true;
    }
    return item.name.includes(keyword) || item.label.includes(keyword);
  });
  habitPickerList.innerHTML = items
    .map((item) => {
      const isActive = item.id
        ? item.id === state.timer.selectedHabitId
        : state.timer.selectedHabitId === null && state.timer.selectedHabitName === "自定义";
      return `<button class="habit-picker-item${isActive ? " active" : ""}" type="button" data-habit-id="${item.id || ""}" data-habit-name="${escapeHtml(item.name)}">${escapeHtml(item.label)}</button>`;
    })
    .join("");
  Array.from(habitPickerList.querySelectorAll(".habit-picker-item")).forEach((button) => {
    button.addEventListener("click", () => {
      const habitId = button.dataset.habitId || null;
      const habitName = button.dataset.habitName || "自定义";
      state.timer.selectedHabitId = habitId;
      state.timer.selectedHabitName = habitName;
      saveState();
      renderHabitPicker();
    });
  });
}

function ensureHabitSelection() {
  const activeHabit = state.habit && state.habit.active ? state.habit : null;
  if (state.timer.selectedHabitId) {
    return;
  }
  if (activeHabit && state.timer.selectedHabitName === "自定义") {
    state.timer.selectedHabitId = activeHabit.id;
    state.timer.selectedHabitName = activeHabit.name;
  }
}

function resolveSelectedHabit() {
  if (state.timer.selectedHabitId) {
    const activeHabit = state.habit && state.habit.active ? state.habit : null;
    if (activeHabit && activeHabit.id === state.timer.selectedHabitId) {
      return activeHabit;
    }
    const historyHabit = state.habitHistory.find(
      (habit) => habit.id === state.timer.selectedHabitId
    );
    if (historyHabit) {
      return historyHabit;
    }
  }
  if (state.timer.selectedHabitName === "自定义") {
    return { id: null, name: "自定义" };
  }
  return null;
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

function countTodayHabitEvents(habit, events) {
  const now = new Date();
  const start = startOfDay(now).getTime();
  const end = endOfDay(now).getTime();
  return events.filter((event) => {
    if (event.habitId !== habit.id) {
      return false;
    }
    const time = new Date(event.createdAt).getTime();
    return time >= start && time <= end;
  }).length;
}

function setRecurringStatus(text, saved) {
  if (!timerRecurringStatus) {
    return;
  }
  timerRecurringStatus.textContent = text;
  timerRecurringStatus.classList.toggle("saved", saved);
}

function getElapsedMs() {
  if (!state.timer.running || !state.timer.startedAt) {
    return state.timer.elapsedMs;
  }
  return state.timer.elapsedMs + (Date.now() - new Date(state.timer.startedAt).getTime());
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function guessPrediction() {
  if (state.habit && state.habit.active) {
    return state.habit.name;
  }
  if (state.events.length > 0) {
    return state.events[0].title;
  }
  return "深度专注";
}

function getPredictionCandidates() {
  if (!state.habit || !state.habit.active) {
    return [];
  }
  const now = new Date();
  const anchors = [
    { date: addDays(now, -1), weight: 6 },
    { date: addDays(now, -7), weight: 5 },
    { date: addDays(now, -30), weight: 4 },
    { date: addDays(now, -365), weight: 3 }
  ];
  const scores = new Map();
  scores.set(state.habit.name, 3);
  anchors.forEach((anchor) => {
    const event = findNearestEventAtHour(anchor.date, state.habit.id);
    if (event) {
      scores.set(event.title, (scores.get(event.title) || 0) + anchor.weight);
    }
  });
  const lastEvent = state.events.find((event) => event.habitId === state.habit.id);
  if (lastEvent) {
    scores.set(lastEvent.title, (scores.get(lastEvent.title) || 0) + 2);
  }
  const sorted = Array.from(scores.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      const lastIndexA = state.events.findIndex((event) => event.title === a[0]);
      const lastIndexB = state.events.findIndex((event) => event.title === b[0]);
      return lastIndexA - lastIndexB;
    })
    .map(([title]) => title);
  return sorted.slice(0, 3);
}

function findNearestEventAtHour(targetDate, habitId) {
  const targetHour = targetDate.getHours();
  const targetDay = targetDate.getDate();
  const targetMonth = targetDate.getMonth();
  const targetYear = targetDate.getFullYear();
  let candidate = null;
  let bestDiff = Infinity;
  state.events.forEach((event) => {
    if (habitId && event.habitId !== habitId) {
      return;
    }
    const eventDate = new Date(event.createdAt);
    if (
      eventDate.getDate() === targetDay &&
      eventDate.getMonth() === targetMonth &&
      eventDate.getFullYear() === targetYear
    ) {
      const diff = Math.abs(eventDate.getHours() - targetHour);
      if (diff <= 1 && diff < bestDiff) {
        bestDiff = diff;
        candidate = event;
      }
    }
  });
  return candidate;
}

function renderSuggestions(candidates) {
  if (!timerSuggestions) {
    return;
  }
  const slots = ["p1", "p2", "p3"];
  const labels = ["预测1", "预测2", "预测3"];
  const items = slots.map((slot, index) => {
    const title = candidates[index] || "";
    const isActive = state.timer.selectedOption === slot;
    const disabled = !title;
    return `<button class="timer-suggestion${isActive ? " active" : ""}" type="button" data-slot="${slot}" data-title="${escapeHtml(title)}"${disabled ? " disabled" : ""}>${labels[index]}${title ? ` · ${escapeHtml(title)}` : ""}</button>`;
  });
  const customActive = state.timer.selectedOption === "custom";
  items.push(
    `<button class="timer-suggestion${customActive ? " active" : ""}" type="button" data-slot="custom">自定义</button>`
  );
  timerSuggestions.innerHTML = items.join("");
  Array.from(timerSuggestions.querySelectorAll(".timer-suggestion")).forEach((button) => {
    button.addEventListener("click", () => {
      const slot = button.dataset.slot || "custom";
      if (slot === "custom") {
        state.timer.selectedOption = "custom";
        saveState();
        renderTimer();
        timerPredictionInput.focus();
        return;
      }
      const title = button.dataset.title || "";
      if (!title) {
        return;
      }
      state.timer.selectedOption = slot;
      timerPredictionInput.value = title;
      state.timer.predictedAction = title;
      saveState();
      renderTimer();
    });
  });
}

function resolveSelectedAction(candidates) {
  const inputValue = timerPredictionInput.value.trim();
  if (state.timer.selectedOption === "custom") {
    return inputValue || state.timer.predictedAction || candidates[0] || guessPrediction();
  }
  if (state.timer.selectedOption === "p2" && candidates[1]) {
    return candidates[1];
  }
  if (state.timer.selectedOption === "p3" && candidates[2]) {
    return candidates[2];
  }
  if (state.timer.selectedOption === "p1" && candidates[0]) {
    return candidates[0];
  }
  if (candidates[0]) {
    state.timer.selectedOption = "p1";
    return candidates[0];
  }
  return inputValue || state.timer.predictedAction || guessPrediction();
}

function countHabitDays(habit, events) {
  const habitEvents = events.filter((event) => event.habitId === habit.id);
  const days = new Set();
  habitEvents.forEach((event) => {
    days.add(formatDate(event.createdAt));
  });
  return days.size;
}

function evaluateHabitQualification(habit, events) {
  const habitEvents = events.filter((event) => event.habitId === habit.id);
  const weekMap = new Map();
  habitEvents.forEach((event) => {
    const weekKey = getWeekKey(event.createdAt);
    weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + 1);
  });

  const lastFourWeeks = getRecentWeekKeys(4);
  const weeklyCounts = lastFourWeeks.map((key) => weekMap.get(key) || 0);
  const isQualified = weeklyCounts.length === 4 && weeklyCounts.every((count) => count >= 5);
  const summary = weeklyCounts
    .map((count, index) => `第${index + 1}周 ${count}/5`)
    .join(" · ");

  return {
    isQualified,
    summary: summary || "尚未开始统计"
  };
}

function filterEvents(events, range) {
  if (range === "all") {
    return events;
  }
  const now = new Date();
  let start;
  let end = now;
  if (range === "yesterday") {
    start = startOfDay(addDays(now, -1));
    end = endOfDay(addDays(now, -1));
  } else if (range === "week") {
    start = startOfDay(addDays(now, -7));
  } else if (range === "month") {
    start = startOfDay(addDays(now, -30));
  } else {
    start = new Date(0);
  }
  return events.filter((event) => {
    const time = new Date(event.createdAt).getTime();
    return time >= start.getTime() && time <= end.getTime();
  });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString("zh-CN");
}

function formatDateTime(value) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN");
}

function getWeekKey(value) {
  const date = new Date(value);
  const day = date.getDay() || 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function getRecentWeekKeys(count) {
  const keys = [];
  const now = new Date();
  const day = now.getDay() || 7;
  const currentMonday = new Date(now);
  currentMonday.setDate(now.getDate() - day + 1);
  currentMonday.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i += 1) {
    const date = new Date(currentMonday);
    date.setDate(currentMonday.getDate() - i * 7);
    keys.push(date.toISOString().slice(0, 10));
  }
  return keys;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
