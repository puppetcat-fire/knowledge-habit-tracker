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
  global.prompt = vi.fn();
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
    document.getElementById("habit-recurring-log").value = "固定时间";
    document.getElementById("habit-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    let state = getState();
    expect(state.habit.name).toBe("阅读");

    global.prompt
      .mockReturnValueOnce("写作")
      .mockReturnValueOnce("90")
      .mockReturnValueOnce("改日志");
    document.getElementById("edit-habit").click();
    state = getState();
    expect(state.habit.name).toBe("写作");
    expect(state.habit.targetDays).toBe(90);
    expect(state.habit.recurringLog).toBe("改日志");

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
    expect(state.events.length).toBe(1);
    const editButton = document.querySelector(
      "#done-list .action-button[data-action='edit']"
    );
    global.prompt.mockReturnValueOnce("完成刷牙+").mockReturnValueOnce("晚上");
    editButton.click();
    state = getState();
    expect(state.events[0].title).toBe("完成刷牙+");
    expect(state.events[0].singleLog).toBe("晚上");

    const deleteButton = document.querySelector(
      "#done-list .action-button[data-action='delete']"
    );
    global.confirm.mockReturnValueOnce(true);
    deleteButton.click();
    state = getState();
    expect(state.events.length).toBe(0);
  });
});
