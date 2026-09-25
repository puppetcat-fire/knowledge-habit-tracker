const { loadApp, getState, STORAGE_KEY } = require("./harness");

// events 必须正好 3 条：下面「提交一次表单后 events.length === 4」的算术写在断言里
const V2_WITH_EVENTS = {
  version: 2,
  habit: {
    id: "h1",
    name: "每天复盘 20 分钟",
    startDate: "2026-08-01T00:00:00.000Z",
    targetDays: 60,
    active: true,
    recurringLog: "",
    completedAt: null
  },
  events: [
    {
      id: "e1",
      habitId: "h1",
      habitName: "每天复盘 20 分钟",
      title: "整理笔记",
      createdAt: "2026-09-23T10:00:00.000Z",
      lightUp: false,
      singleLog: "",
      source: "manual",
      durationMs: null,
      report: ""
    },
    {
      id: "e2",
      habitId: "h1",
      habitName: "每天复盘 20 分钟",
      title: "复盘一段代码",
      createdAt: "2026-09-24T10:00:00.000Z",
      lightUp: false,
      singleLog: "卡在权限那一步",
      source: "timer",
      durationMs: 600000,
      report: ""
    },
    {
      id: "e3",
      habitId: null,
      habitName: null,
      title: "随手记一条",
      createdAt: "2026-09-24T21:00:00.000Z",
      lightUp: false,
      singleLog: "明天先做节点挂靠",
      source: "quick-note",
      durationMs: null,
      report: ""
    }
  ],
  timer: {
    elapsedMs: 0,
    running: false,
    startedAt: null,
    predictedAction: "",
    selectedOption: "custom",
    selectedHabitId: null,
    selectedHabitName: "自由记录"
  }
};

function submitDoneForm(title) {
  document.getElementById("done-title").value = title;
  document.getElementById("done-form").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true })
  );
}

async function importFile(payload) {
  const input = document.getElementById("backup-file");
  const file = new File([JSON.stringify(payload)], "b.json", { type: "application/json" });
  // jsdom 的 Blob 没有 text()/arrayBuffer()，补上 app.js 读到文件内容所需的那一个方法
  Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(payload)) });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("state migration to version 3", () => {
  it("keeps the v2 payload on disk at boot and only migrates on a real save", () => {
    loadApp({ seedState: V2_WITH_EVENTS });

    // 启动不写盘：正文仍是 v2 原文
    let stored = getState();
    expect(stored.version).toBe(2);
    expect(stored.events).toHaveLength(3);

    submitDoneForm("整理节点挂靠");

    stored = getState();
    expect(stored.version).toBe(3);
    expect(stored.events).toHaveLength(4);
    expect(stored.forest.lightups).toEqual([]);

    const untouched = stored.events.slice(1).map((event) => ({
      title: event.title,
      createdAt: event.createdAt,
      singleLog: event.singleLog,
      source: event.source
    }));
    expect(untouched).toEqual([
      { title: "整理笔记", createdAt: "2026-09-23T10:00:00.000Z", singleLog: "", source: "manual" },
      {
        title: "复盘一段代码",
        createdAt: "2026-09-24T10:00:00.000Z",
        singleLog: "卡在权限那一步",
        source: "timer"
      },
      {
        title: "随手记一条",
        createdAt: "2026-09-24T21:00:00.000Z",
        singleLog: "明天先做节点挂靠",
        source: "quick-note"
      }
    ]);

    expect(stored.habit.targetDays).toBe(60);
    expect(stored.timer.elapsedMs).toBe(0);
    expect(stored.events.slice(1).every((event) => event.nodeId === null && event.treeId === null)).toBe(true);
  });

  it("rejects a backup from a newer version without touching localStorage", async () => {
    loadApp({ seedState: V2_WITH_EVENTS });
    const before = localStorage.getItem(STORAGE_KEY);

    await importFile({ version: 9, habit: null, events: [], timer: {}, settings: {} });

    expect(document.getElementById("backup-status").textContent).toContain("来自更新的版本");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(getState().version).toBe(2);
  });

  it("imports a v2 backup and keeps habit, timer, and settings fields", async () => {
    loadApp();

    await importFile({
      ...V2_WITH_EVENTS,
      settings: { hubConnected: true, lastBackupAt: "2026-09-20T08:00:00.000Z" }
    });

    const stored = getState();
    expect(stored.version).toBe(3);
    expect(stored.habit.name).toBe("每天复盘 20 分钟");
    expect(stored.timer.selectedHabitName).toBe("自由记录");
    expect(stored.settings.hubConnected).toBe(true);
    expect(stored.settings.lastBackupAt).toBe("2026-09-20T08:00:00.000Z");
    expect(stored.forest).toEqual({
      activeTreeId: null,
      selectedNodeId: null,
      selectedNodeAt: null,
      lightups: []
    });
  });

  it("drops light-ups without a node and normalizes the rest", async () => {
    loadApp();

    await importFile({
      version: 3,
      forest: {
        selectedNodeId: "linear-equation",
        // 瞄准必须有时间戳，否则导入后的第一次 render 会按过期清理（§4.6.1）
        selectedNodeAt: new Date().toISOString(),
        lightups: [
          { nodeId: "   " },
          { treeId: "k9-math" },
          {
            nodeId: "linear-equation",
            treeId: "k9-math",
            status: "confirmed",
            verified: true,
            evidence: { type: "peer", detail: "讲了一遍" }
          },
          { nodeId: "combine-like-terms", status: "draft-ish" }
        ]
      }
    });

    const stored = getState();
    expect(stored.forest.selectedNodeId).toBe("linear-equation");
    expect(stored.forest.lightups).toHaveLength(2);

    const [confirmed, draft] = stored.forest.lightups;
    expect(confirmed.nodeId).toBe("linear-equation");
    expect(confirmed.treeId).toBe("k9-math");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.evidence.type).toBe("self");
    expect(confirmed.evidence.detail).toBe("讲了一遍");
    expect(confirmed.verified).toBe(false);

    expect(draft.nodeId).toBe("combine-like-terms");
    expect(draft.status).toBe("draft");
    expect(draft.treeId).toBeNull();
  });
});
