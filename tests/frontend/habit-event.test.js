const { loadApp, getState } = require("./harness");

describe("habit and event CRUD", () => {
  beforeEach(() => {
    loadApp();
  });

  it("keeps planning folded but lets the current event be adjusted without stopping or resetting time", () => {
    const input = document.getElementById("timer-prediction");
    input.value = "阅读一节教程";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("habit-picker-toggle").click();
    document.getElementById("timer-start").click();

    for (const id of ["timer-action-choices", "timer-preparation-hint", "habit-picker"]) {
      expect(document.getElementById(id).classList.contains("hidden")).toBe(true);
    }
    expect(document.getElementById("timer-prediction-display").textContent).toBe("阅读一节教程");
    expect(getState().timer.running).toBe(true);

    loadApp({ seedState: getState() });
    expect(document.getElementById("timer-action-choices").classList.contains("hidden")).toBe(true);
    document.getElementById("timer-prediction-display").click();
    expect(document.getElementById("timer-action-choices").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("timer-prediction").value).toBe("阅读一节教程");
    expect(getState().timer.predictedAction).toBe("阅读一节教程");
    const startedAt = getState().timer.startedAt;
    document.getElementById("timer-prediction").value = "整理笔记";
    document.getElementById("timer-prediction").dispatchEvent(new Event("input", { bubbles: true }));
    expect(getState().timer.startedAt).toBe(startedAt);
    expect(getState().timer.running).toBe(true);
    expect(getState().events).toHaveLength(0);
    document.getElementById("timer-pause").click();
    expect(getState().timer.running).toBe(false);
    expect(getState().timer.predictedAction).toBe("整理笔记");
  });

  it("creates, edits, and deletes habit", () => {
    document.getElementById("habit-name").value = "阅读";
    document.getElementById("habit-days").value = "60";
    document.getElementById("habit-recurring-log").value = "固定时间复盘";
    document.getElementById("habit-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    let state = getState();
    expect(state.habit.name).toBe("阅读");

    document.getElementById("edit-habit").click();
    document.getElementById("modal-habit-name").value = "写作";
    document.getElementById("modal-habit-days").value = "90";
    document.getElementById("modal-habit-log").value = "先写提纲再落字";
    document.getElementById("modal-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    state = getState();
    expect(state.habit.name).toBe("写作");
    expect(state.habit.targetDays).toBe(90);
    expect(state.habit.recurringLog).toBe("先写提纲再落字");

    global.confirm.mockReturnValueOnce(true);
    document.getElementById("delete-habit").click();
    state = getState();
    expect(state.habit).toBeNull();
  });

  it("creates a second habit, keeps the running event attached, and switches back after reload", () => {
    const original = { id: "original", name: "阅读", active: true, targetDays: 60, startDate: new Date().toISOString() };
    loadApp({ seedState: { version: 3, habit: original } });
    document.getElementById("start-timer-from-habit").click();
    const startedAt = getState().timer.sessionStartedAt;
    document.getElementById("new-habit-toggle").click();
    document.getElementById("habit-name").value = "写作";
    document.getElementById("habit-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const changed = getState();
    expect(changed.habit.name).toBe("写作");
    expect(changed.habitHistory[0]).toMatchObject({ id: original.id, paused: true, active: false });
    expect(changed.timer.sessionStartedAt).toBe(startedAt);
    expect(changed.timer.practiceContext.habit.id).toBe(original.id);
    loadApp({ seedState: changed });
    const select = document.getElementById("habit-switch");
    select.value = original.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const switched = getState();
    expect(switched.habit).toMatchObject({ id: original.id, active: true, paused: false });
    expect(switched.habitHistory).toHaveLength(1);
    expect(switched.habitHistory[0]).toMatchObject({ id: changed.habit.id, paused: true, active: false });
    expect(switched.timer.sessionStartedAt).toBe(startedAt);
  });
  it("shows older records under the current name of a paused habit", () => {
    const habit = { id: "reading", name: "阅读复盘", paused: true, startDate: "2026-08-01T00:00:00" };
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `reading-${i}`, habitId: habit.id, habitName: "旧阅读名称", title: `阅读记录 ${i}`,
      source: "manual", createdAt: new Date(2026, 7, i + 1, 12).toISOString(),
      ...(i === 0 ? { singleLog: "<b>当时的单次笔记</b>", treeId: "k9-math", nodeId: "linear-equation", nodeSnapshot: { title: "当时的目标" }, tutorialSnapshot: { id: "reading-method", title: "当时的方法" } } : {})
    }));
    loadApp({ seedState: { version: 3, habitHistory: [habit], events } });
    document.querySelector("[data-record-tab-target='habits']").click();
    const group = document.querySelector("#habit-event-groups article");
    expect(group.querySelector("h4").textContent).toBe(habit.name);
    expect(group.querySelectorAll(":scope > .group-events .group-event")).toHaveLength(6);
    expect(group.querySelector("details").open).toBe(false);
    group.querySelector("summary").click();
    expect(group.querySelector("details").open).toBe(true);
    expect(group.querySelector("details").textContent).toContain("阅读记录 0");
    const recordDetails = group.querySelector(".group-event details");
    expect(recordDetails.open).toBe(false);
    recordDetails.querySelector("summary").click();
    expect(recordDetails.open).toBe(true);
    expect(recordDetails.textContent).toContain("<b>当时的单次笔记</b>");
    expect(recordDetails.textContent).toContain("当时的目标");
    expect(recordDetails.textContent).toContain("当时的方法");
    expect(recordDetails.querySelector("b")).toBeNull();
    expect(new URL(recordDetails.querySelector("a").href).hash).toBe("#node/k9-math/linear-equation");
    expect(getState().events.every(event => event.habitName === "旧阅读名称")).toBe(true);
  });
  it("archives a formed habit after four qualifying weeks even below the personal day target", () => {
    const habit = { id: "weekly", name: "阅读", active: true, targetDays: 60, startDate: "2026-08-01T00:00:00" };
    const events = [3, 10, 17, 24].flatMap(day => Array.from({ length: 5 }, (_, i) => ({
      id: `${day}-${i}`, habitId: habit.id, title: habit.name, source: "manual",
      createdAt: new Date(2026, 7, day, 12, i).toISOString()
    })));
    loadApp({ seedState: { version: 3, habit, events: events.slice(0, -1) } });
    expect(document.getElementById("complete-habit").disabled).toBe(true);
    loadApp({ seedState: { version: 3, habit, events } });
    expect(document.getElementById("habit-days-progress").textContent).toBe("4 / 60");
    expect(document.getElementById("complete-habit").disabled).toBe(false);
    document.getElementById("complete-habit").click();
    expect(getState().habit).toBeNull();
    expect(getState().habitHistory[0]).toMatchObject({ id: habit.id, progressDays: 4 });
  });
  it("creates, edits, and deletes event", () => {
    document.getElementById("habit-name").value = "刷牙";
    document.getElementById("habit-days").value = "60";
    document.getElementById("habit-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    document.getElementById("done-title").value = "完成刷牙";
    document.getElementById("done-log").value = "早上";
    document.getElementById("done-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    let state = getState();
    expect(state.events).toHaveLength(1);

    const editButton = document.querySelector("#done-list .action-button[data-action='edit']");
    editButton.click();
    document.getElementById("modal-event-title").value = "完成刷牙+";
    document.getElementById("modal-event-log").value = "晚上";
    document.getElementById("modal-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    state = getState();
    expect(state.events[0].title).toBe("完成刷牙+");
    expect(state.events[0].singleLog).toBe("晚上");

    const deleteButton = document.querySelector("#done-list .action-button[data-action='delete']");
    global.confirm.mockReturnValueOnce(true);
    deleteButton.click();

    state = getState();
    expect(state.events).toHaveLength(0);
  });

  it("creates a quick note from the timer page without finishing the timer", () => {
    document.getElementById("habit-name").value = "复盘";
    document.getElementById("habit-days").value = "60";
    document.getElementById("habit-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    document.getElementById("timer-prediction").value = "教程节点整理";
    document.getElementById("timer-prediction").dispatchEvent(
      new Event("input", { bubbles: true, cancelable: true })
    );
    document.getElementById("timer-single-log").value = "教主好菜，先记一下";
    document.getElementById("timer-quick-save").click();

    const state = getState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].title).toBe("教程节点整理");
    expect(state.events[0].singleLog).toBe("教主好菜，先记一下");
    expect(state.events[0].source).toBe("quick-note");
    expect(state.events[0].habitId).toBeNull();
    expect(document.getElementById("timer-single-log").value).toBe("");
    expect(document.getElementById("node-candidate-list").textContent).not.toContain("教程节点整理");
    expect(document.getElementById("habit-event-groups").textContent).not.toContain("教程节点整理");
    expect(document.getElementById("done-list").textContent).not.toContain("教程节点整理");

    document.querySelector("[data-record-tab-target='quick-notes']").click();
    expect(document.getElementById("quick-note-list").textContent).toContain("教程节点整理");
  });
});
