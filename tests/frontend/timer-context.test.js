const { loadApp, getState } = require("./harness");

describe("timer provenance and time awareness", () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it("shows the chosen tutorial's starting step before timing without replacing the reader's action", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
    const startAction = "先写下等式";
    loadApp({ seedState: {
      version: 3,
      timer: { predictedAction: "核对昨天的练习", selectedOption: "custom" },
      forest: { activeTreeId: "k9-math", selectedNodeId: "linear-equation", selectedNodeAt: new Date().toISOString(),
        selectedTutorial: { id: "method", title: "等式方法", version: "v1", startAction } }
    } });
    const aim = document.getElementById("node-aim-label");
    expect(aim.textContent).toContain(startAction);
    expect(document.getElementById("timer-prediction").value).toBe("核对昨天的练习");
    document.getElementById("timer-start").click();
    expect(aim.textContent).not.toContain(startAction);
    expect(getState().timer.practiceContext.tutorialSnapshot.startAction).toBe(startAction);
  });
  it("keeps the knowledge chosen at timer start even if its aim expires while working", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
    loadApp({ seedState: { version: 3, forest: { activeTreeId: "k9-math", selectedNodeId: "linear-equation", selectedNodeAt: new Date().toISOString(), lightups: [], selectedTutorial: { id: "method", version: "v1", title: "我的方法", method: "两边同时运算" } } } });
    document.getElementById("timer-start").click();
    expect(getState().timer.practiceContext.tutorialSnapshot.version).toBe("v1");
    vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
    document.getElementById("node-aim-clear").click();
    document.getElementById("timer-finish").click();
    const event = getState().events[0];
    expect(event.nodeId).toBe("linear-equation");
    expect(event.tutorialSnapshot.method).toBe("两边同时运算");
    expect(event.durationMs).toBe(9 * 60 * 60 * 1000);
  });
  it("keeps a long tutorial action and its source when editing only the recorded note", () => {
    const title = "W".repeat(230);
    const tutorialSnapshot = { id: "method", version: "v1", title: "等式方法", startAction: title };
    const createdAt = new Date().toISOString();
    const treeId = "k9-math";
    const nodeId = "linear-equation";
    loadApp({ seedState: {
      version: 3,
      events: [{ id: "long-tutorial-event", title, createdAt, source: "timer", treeId, nodeId, tutorialSnapshot }],
      forest: { activeTreeId: treeId, lightups: [{
        id: "draft-light", eventId: "long-tutorial-event", treeId, nodeId, createdAt, status: "draft",
        evidence: { type: "self", detail: "编辑前的笔记", timestamp: createdAt }, tutorialSnapshot
      }] }
    } });
    document.querySelector("#done-list [data-action='edit']").click();
    const titleInput = document.getElementById("modal-event-title");
    expect(titleInput.maxLength).toBe(title.length);
    expect(titleInput.value).toBe(title);
    document.getElementById("modal-event-log").value = "补记完成情况";
    document.getElementById("modal-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(getState().events[0]).toMatchObject({ title, singleLog: "补记完成情况", tutorialSnapshot });
    expect(getState().forest.lightups[0]).toMatchObject({
      status: "draft", tutorialSnapshot, evidence: { detail: "补记完成情况", timestamp: createdAt }
    });
  });
  it("keeps an existing timer attached to its original habit when the active habit changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
    const original = { id: "reading", name: "阅读", active: true, startDate: new Date().toISOString(), targetDays: 60 };
    loadApp({ seedState: { version: 3, habit: original } });
    document.getElementById("start-timer-from-habit").click();
    const started = getState();
    expect(started.timer.practiceContext.habit).toEqual({ id: original.id, name: original.name });
    const next = { ...original, id: "writing", name: "写作" };
    started.habit = next;
    started.habitHistory = [{ ...original, active: false }];
    started.timer.selectedHabitId = next.id;
    started.timer.selectedHabitName = next.name;
    loadApp({ seedState: started });
    const resume = document.getElementById("start-timer-from-habit");
    expect(resume.textContent).toBe("返回当前计时");
    resume.click();
    expect(getState().timer.predictedAction).toBe("阅读");
    vi.advanceTimersByTime(60000);
    document.getElementById("timer-finish").click();
    expect(getState().events[0]).toMatchObject({ title: "阅读", habitId: original.id, habitName: original.name });
    expect(getState().habit.id).toBe(next.id);
  });
  it("restores a half-written note with its paused timer", () => {
    loadApp({ seedState: { version: 3, timer: { elapsedMs: 180000, predictedAction: "写作", singleLog: "尚未写完的想法", running: false } } });
    expect(document.getElementById("timer-single-log").value).toBe("尚未写完的想法");
    document.getElementById("timer-finish").click();
    expect(getState().events[0].singleLog).toBe("尚未写完的想法");
    expect(getState().timer.singleLog).toBe("");
  });
  it("shows actual measured time and does not replace unmeasured records with estimates", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    loadApp({ seedState: { version: 3, events: [
      { id: "timed", title: "阅读", source: "timer", durationMs: 300000, createdAt: new Date().toISOString() },
      { id: "manual", title: "整理", source: "manual", createdAt: new Date().toISOString() }
    ] } });
    expect(document.getElementById("overview-time").textContent).toBe("00:05:00");
    expect(document.getElementById("day-view-list").textContent).toContain("1 条完成记录未计时");
  });
});
