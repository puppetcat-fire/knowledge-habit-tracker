const fs = require("fs");
const path = require("path");

function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf-8");
  document.documentElement.innerHTML = html;
  localStorage.clear();

  const uuid = () => `id-${Math.random().toString(16).slice(2, 10)}`;
  if (globalThis.crypto && typeof globalThis.crypto === "object") {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: uuid,
      configurable: true
    });
  } else {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: uuid },
      configurable: true
    });
  }

  global.alert = vi.fn();
  global.confirm = vi.fn(() => true);
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, bugs: [] })
    })
  );

  const appPath = path.join(__dirname, "../../app.js");
  delete require.cache[require.resolve(appPath)];
  require(appPath);
}

function getState() {
  return JSON.parse(localStorage.getItem("knowledge-habit-tracker"));
}

describe("habit and event CRUD", () => {
  beforeEach(() => {
    loadApp();
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
