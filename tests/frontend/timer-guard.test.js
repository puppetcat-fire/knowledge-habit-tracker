const { loadApp, getState } = require("./harness");

function createHabit(name) {
  document.getElementById("habit-name").value = name;
  document.getElementById("habit-days").value = "60";
  document.getElementById("habit-form").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true })
  );
}

function startTimingFromTimerPage(action) {
  const input = document.getElementById("timer-prediction");
  input.value = action;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("timer-start").click();
}

describe("a running timing cannot be turned into the next timing", () => {
  it("does not repurpose the running timing when starting from a habit", () => {
    loadApp();
    createHabit("阅读");
    startTimingFromTimerPage("写代码");

    const startedAt = getState().timer.startedAt;
    expect(getState().timer.running).toBe(true);

    document.getElementById("start-timer-from-habit").click();

    const state = getState();
    expect(state.timer.running).toBe(true);
    expect(state.timer.startedAt).toBe(startedAt);
    expect(state.timer.predictedAction).toBe("写代码");
    expect(document.getElementById("timer-prediction").value).toBe("写代码");
    expect(document.getElementById("timer-prediction-display").textContent).toContain("写代码");
    expect(document.getElementById("timer-start").textContent).toBe("暂停");
    expect(document.getElementById("timer-report").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("timer-report").textContent).toContain("不能开始下一次计时");
  });

  it("does not start a second timing while one is already running", () => {
    loadApp();
    createHabit("阅读");
    startTimingFromTimerPage("写代码");

    const startedAt = getState().timer.startedAt;
    document.getElementById("start-timer-from-habit").click();
    document.getElementById("start-timer-from-habit").click();

    const state = getState();
    expect(state.timer.running).toBe(true);
    expect(state.timer.startedAt).toBe(startedAt);
    expect(state.timer.predictedAction).toBe("写代码");
  });

  it("still starts the next timing once the current one is finished", async () => {
    loadApp();
    createHabit("阅读");
    startTimingFromTimerPage("写代码");
    await new Promise((resolve) => setTimeout(resolve, 320));

    document.getElementById("timer-finish").click();
    expect(getState().timer.running).toBe(false);
    expect(getState().events).toHaveLength(1);
    expect(getState().events[0].title).toBe("写代码");

    document.getElementById("start-timer-from-habit").click();

    const state = getState();
    expect(state.timer.running).toBe(true);
    expect(state.timer.predictedAction).toBe("阅读");
    expect(document.getElementById("timer-report").classList.contains("hidden")).toBe(true);
  });

  it("starts a timing from the habit when nothing is running", () => {
    loadApp();
    createHabit("阅读");

    document.getElementById("start-timer-from-habit").click();

    const state = getState();
    expect(state.timer.running).toBe(true);
    expect(state.timer.predictedAction).toBe("阅读");
    expect(document.querySelector(".page[data-page='timer']").classList.contains("hidden")).toBe(false);
  });
});
