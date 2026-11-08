const { loadApp, getState } = require("./harness");

function edit(id, value) {
  document.getElementById(id).value = value;
  document.getElementById(id).dispatchEvent(new Event("input", { bubbles: true }));
}

describe("original PRD timer workflow", () => {
  afterEach(() => vi.useRealTimers());

  it("starts without setup, adjusts a prediction using keyboard, and preserves elapsed time and notes after reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T09:00:00"));
    loadApp({ seedState: { events: [
      { id: "a", title: "阅读", source: "timer", createdAt: "2026-10-02T09:00:00", durationMs: 60000 },
      { id: "b", title: "写作", source: "timer", createdAt: "2026-10-01T13:00:00", durationMs: 60000 },
      { id: "c", title: "复盘", source: "timer", createdAt: "2026-09-29T18:00:00", durationMs: 60000 }
    ] } });
    document.getElementById("timer-start").click();
    expect(getState().timer.predictedAction).toBe("阅读");
    const startedAt = getState().timer.startedAt;
    vi.advanceTimersByTime(20000);
    document.getElementById("timer-prediction-display").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(getState().timer.predictedAction).toBe("写作");
    expect(getState().timer.startedAt).toBe(startedAt);
    edit("timer-single-log", "本次笔记");
    loadApp({ seedState: getState() });
    expect(document.getElementById("timer-display").textContent).toBe("00:00:20");
    expect(document.getElementById("timer-single-log").value).toBe("本次笔记");
    document.getElementById("timer-finish").click();
    const record = getState().events[0];
    expect(record.title).toBe("写作");
    expect(record.durationMs).toBe(20000);
    expect(record.startedAt).toBe(startedAt);
    expect(record.endedAt).toBe(new Date("2026-10-03T09:00:20").toISOString());
    expect(record.singleLog).toBe("本次笔记");
    expect(document.getElementById("timer-report").textContent).toContain("这件事的历史记录");
  });

  it("searches and selects past events, with reusable steps stored by event rather than only by active habit", () => {
    loadApp({ seedState: { events: [{ id: "x", title: "整理资料", createdAt: new Date().toISOString() }] } });
    document.getElementById("timer-prediction-display").click();
    edit("timer-history-search", "资料");
    expect(document.getElementById("timer-event-search-results").textContent).toContain("整理资料");
    document.querySelector("#timer-event-search-results button").click();
    edit("timer-recurring-log", "先检查来源，再分类");
    expect(getState().settings.actionLogs["整理资料"]).toBe("先检查来源，再分类");
    edit("timer-prediction", "写作");
    expect(document.getElementById("timer-recurring-log").value).toBe("");
    loadApp({ seedState: getState() });
    edit("timer-prediction", "整理资料");
    expect(document.getElementById("timer-recurring-log").value).toBe("先检查来源，再分类");
  });

  it("decays old records and excludes quick notes and future events from predictions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T09:00:00"));
    loadApp({ seedState: { events: [
      ...Array.from({ length: 30 }, (_, index) => ({ id: `old-${index}`, title: "旧工作", createdAt: "2020-10-03T09:00:00" })),
      { id: "recent", title: "新工作", createdAt: "2026-10-02T09:00:00" },
      { id: "future", title: "未来", createdAt: "2030-10-03T09:00:00" },
      { id: "note", title: "随手记", source: "quick-note", createdAt: "2026-10-03T08:59:00" }
    ] } });
    document.getElementById("timer-start").click();
    expect(getState().timer.predictedAction).toBe("新工作");
    expect(getState().timer.predictionCandidates).not.toContain("未来");
    expect(getState().timer.predictionCandidates).not.toContain("随手记");
  });

  it("records unnamed activity without setup and excludes paused time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T09:00:00"));
    loadApp();
    document.getElementById("timer-start").click();
    const startedAt = getState().timer.sessionStartedAt;
    vi.advanceTimersByTime(10000);
    document.getElementById("timer-pause").click();
    vi.advanceTimersByTime(30000);
    document.getElementById("timer-start").click();
    vi.advanceTimersByTime(10000);
    document.getElementById("timer-finish").click();
    expect(getState().events[0].title).toBe("未命名事件");
    expect(getState().events[0].durationMs).toBe(20000);
    expect(getState().events[0].startedAt).toBe(startedAt);
    expect(document.getElementById("timer-report").textContent).not.toContain("单次备注");
  });

  it("does not force free activity into the active habit and respects explicit habit selection", () => {
    loadApp({ seedState: { habit: { id: "habit", name: "阅读", active: true }, events: [] } });
    edit("timer-prediction", "整理资料");
    document.getElementById("timer-start").click();
    expect(getState().timer.selectedHabitId).toBeNull();
    document.getElementById("timer-prediction-display").click();
    document.getElementById("habit-picker-toggle").click();
    document.querySelector("[data-habit-id='habit']").click();
    edit("timer-prediction", "阅读笔记");
    expect(getState().timer.selectedHabitId).toBe("habit");
    expect(getState().timer.running).toBe(true);
  });
});
