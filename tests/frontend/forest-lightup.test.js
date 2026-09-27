const { loadApp, getState } = require("./harness");

const TREE_ID = "k9-math";
const NODE_ID = "linear-equation";

// finishTimer() 要求 elapsedMs > 0，否则在早退分支返回
function seedState(overrides = {}) {
  return {
    version: 3,
    timer: {
      elapsedMs: 60000,
      running: false,
      startedAt: null,
      predictedAction: "整理一元一次方程",
      selectedOption: "custom",
      selectedHabitId: null,
      selectedHabitName: "自由记录"
    },
    forest: { activeTreeId: null, selectedNodeId: null, selectedNodeAt: null, lightups: [] },
    ...overrides
  };
}

// 瞄准是树上节点详情里的「去做」：进入平台、点节点、再点详情里的「去做」，自动落到计时页
function aim(nodeId = NODE_ID) {
  document.getElementById("platform-entry").click();
  document.querySelector(`#platform-feed [data-action='platform-view'][data-node-id='${nodeId}']`).click();
  document.querySelector("#platform-detail-body [data-action='platform-do']").click();
}

function finishTimer() {
  document.getElementById("timer-finish").click();
}

function submitManualRecord(title, log) {
  document.getElementById("done-title").value = title;
  document.getElementById("done-log").value = log;
  document.getElementById("done-form").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true })
  );
}

function openMine() {
  document.getElementById("platform-entry").click();
  document.querySelector(".platform-tab[data-platform-tab='mine']").click();
}

function confirmFirstLightUp() {
  document.querySelector("#platform-mine [data-action='platform-confirm']").click();
}

describe("light-up drafts from aimed events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches the aimed node to a finished timer and keeps a draft", () => {
    loadApp({ seedState: seedState() });

    aim();
    finishTimer();

    const state = getState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].source).toBe("timer");
    expect(state.events[0].nodeId).toBe(NODE_ID);
    expect(state.events[0].treeId).toBe(TREE_ID);

    expect(state.forest.lightups).toHaveLength(1);
    const draft = state.forest.lightups[0];
    expect(draft.status).toBe("draft");
    expect(draft.eventId).toBe(state.events[0].id);
    expect(draft.nodeId).toBe(NODE_ID);
    expect(draft.treeId).toBe(TREE_ID);
    expect(draft.evidence.type).toBe("self");

    // 瞄准是一次性的：产出一条草稿后就清空
    expect(state.forest.selectedNodeId).toBeNull();
    expect(state.forest.selectedNodeAt).toBeNull();
    expect(document.getElementById("done-list").textContent).toContain("待发出 · 一元一次方程");
  });

  it("attaches the aimed node to a manual record and clears the aim line", () => {
    loadApp({ seedState: seedState() });

    aim();
    submitManualRecord("解三道一元一次方程", "卡在系数化那一步");

    const state = getState();
    expect(state.events[0].source).toBe("manual");
    expect(state.events[0].nodeId).toBe(NODE_ID);
    expect(state.events[0].treeId).toBe(TREE_ID);
    expect(state.forest.lightups).toHaveLength(1);
    expect(state.forest.lightups[0].eventId).toBe(state.events[0].id);
    expect(state.forest.lightups[0].evidence.detail).toBe("卡在系数化那一步");
    expect(state.forest.selectedNodeId).toBeNull();
    expect(document.getElementById("node-aim-line").classList.contains("hidden")).toBe(true);
  });

  it("lets a quick note leave the aim alone and produce no draft", () => {
    loadApp({ seedState: seedState() });

    aim();
    document.getElementById("timer-single-log").value = "随手记一条，不挂节点";
    document.getElementById("timer-quick-save").click();

    const state = getState();
    expect(state.events[0].source).toBe("quick-note");
    expect(state.events[0].nodeId).toBeNull();
    expect(state.forest.lightups).toHaveLength(0);
    expect(state.forest.selectedNodeId).toBe(NODE_ID);
    expect(state.forest.selectedNodeAt).not.toBeNull();
  });

  it("keeps a finished timer unattached when nothing is aimed", () => {
    loadApp({ seedState: seedState() });

    finishTimer();

    const state = getState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].nodeId).toBeNull();
    expect(state.events[0].treeId).toBeNull();
    expect(state.forest.lightups).toHaveLength(0);
  });

  it("clears the aim from #node-aim-clear without leaving a record", () => {
    loadApp({ seedState: seedState() });

    aim();
    expect(getState().forest.selectedNodeId).toBe(NODE_ID);

    document.getElementById("node-aim-clear").click();

    const state = getState();
    expect(state.forest.selectedNodeId).toBeNull();
    expect(state.forest.selectedNodeAt).toBeNull();
    expect(state.forest.lightups).toHaveLength(0);
    expect(document.getElementById("node-aim-line").classList.contains("hidden")).toBe(true);
  });

  it("treats an aim older than 8 hours as expired and clears it without warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();

    loadApp({
      seedState: seedState({
        forest: {
          activeTreeId: TREE_ID,
          selectedNodeId: NODE_ID,
          selectedNodeAt: nineHoursAgo,
          lightups: []
        }
      })
    });

    const notice = document.getElementById("node-aim-notice");
    expect(notice.classList.contains("hidden")).toBe(false);
    expect(notice.textContent).toBe("上次对着的那条已经过期");
    expect(getState().forest.selectedNodeId).toBeNull();
    // 自然超时不打日志，这是刻意的日志契约
    expect(warnSpy).not.toHaveBeenCalled();

    finishTimer();

    const state = getState();
    expect(state.events[0].nodeId).toBeNull();
    expect(state.forest.lightups).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(notice.textContent).toBe("上次对着的那条已经过期");
  });

  it("clears a dangling aim with one warning and shows the dangling notice", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    loadApp({
      seedState: seedState({
        forest: {
          activeTreeId: TREE_ID,
          selectedNodeId: "not-a-node",
          selectedNodeAt: new Date().toISOString(),
          lightups: []
        }
      })
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[forest]");
    expect(warnSpy.mock.calls[0]).toContain("not-a-node");

    const notice = document.getElementById("node-aim-notice");
    expect(notice.textContent).toBe("上次那条已经不在了");
    expect(getState().forest.selectedNodeId).toBeNull();

    finishTimer();

    expect(getState().events[0].nodeId).toBeNull();
    expect(getState().forest.lightups).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a missing timestamp as expired even when the node exists", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    loadApp({
      seedState: seedState({
        forest: { activeTreeId: TREE_ID, selectedNodeId: NODE_ID, selectedNodeAt: null, lightups: [] }
      })
    });

    const notice = document.getElementById("node-aim-notice");
    expect(notice.textContent).toBe("上次对着的那条已经过期");
    expect(getState().forest.selectedNodeId).toBeNull();
    // 节点还在，属于自然超时：不打日志
    expect(warnSpy).not.toHaveBeenCalled();

    finishTimer();

    expect(getState().events[0].nodeId).toBeNull();
    expect(getState().forest.lightups).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns for a missing node even when the timestamp is old", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();

    loadApp({
      seedState: seedState({
        forest: {
          activeTreeId: TREE_ID,
          selectedNodeId: "not-a-node",
          selectedNodeAt: nineHoursAgo,
          lightups: []
        }
      })
    });

    // 悬空优先于过期：过期也成立时仍按悬空报，并打唯一一条 warn
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toContain("not-a-node");
    expect(document.getElementById("node-aim-notice").textContent).toBe("上次那条已经不在了");
    expect(getState().forest.selectedNodeId).toBeNull();
  });

  it("decides the event badge from lightups first, then the legacy flag", () => {
    loadApp({
      seedState: {
        version: 3,
        events: [
          {
            id: "e-old",
            habitId: null,
            habitName: null,
            title: "旧版点亮事件",
            createdAt: "2026-09-22T10:00:00.000Z",
            lightUp: true,
            singleLog: "",
            source: "manual",
            durationMs: null,
            report: ""
          },
          {
            id: "e-draft",
            habitId: null,
            habitName: null,
            title: "带草稿的事件",
            createdAt: "2026-09-23T10:00:00.000Z",
            lightUp: false,
            singleLog: "讲了移项",
            source: "timer",
            durationMs: 600000,
            report: ""
          },
          {
            id: "e-plain",
            habitId: null,
            habitName: null,
            title: "普通事件",
            createdAt: "2026-09-24T10:00:00.000Z",
            lightUp: false,
            singleLog: "",
            source: "manual",
            durationMs: null,
            report: ""
          },
          {
            id: "e-quick",
            habitId: null,
            habitName: null,
            title: "随手记一条",
            createdAt: "2026-09-24T21:00:00.000Z",
            lightUp: true,
            singleLog: "明天先做节点挂靠",
            source: "quick-note",
            durationMs: null,
            report: ""
          }
        ],
        forest: {
          lightups: [
            {
              id: "l1",
              treeId: TREE_ID,
              nodeId: NODE_ID,
              status: "draft",
              eventId: "e-draft",
              evidence: { type: "self", detail: "讲了移项", timestamp: "2026-09-23T10:00:00.000Z" }
            }
          ]
        }
      }
    });

    const doneText = document.getElementById("done-list").textContent;
    expect(doneText).toContain("旧标记（未确认）");
    expect(doneText).toContain("待发出 · 一元一次方程");
    // 找不到点亮的事件不硬写状态词
    expect(doneText).toContain("本地记录");

    document.querySelector("[data-record-tab-target='quick-notes']").click();
    expect(document.getElementById("quick-note-list").textContent).toContain("旧标记（未确认）");
  });
});

describe("confirm and delete local light-ups", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confirms a draft from 我的 and flips the badge", () => {
    loadApp({ seedState: seedState() });

    aim();
    finishTimer();
    openMine();

    expect(document.getElementById("platform-mine").textContent).toContain("待发出 · 一元一次方程");

    confirmFirstLightUp();

    const state = getState();
    expect(state.forest.lightups).toHaveLength(1);
    expect(state.forest.lightups[0].status).toBe("confirmed");
    expect(state.forest.lightups[0].confirmedAt).toBeTruthy();

    // 状态词：已发出 > 待发出
    expect(document.getElementById("platform-mine").textContent).toContain("已发出 · 一元一次方程");
    expect(document.getElementById("done-list").textContent).toContain("已发出 · 一元一次方程");

    // 概览计数：分子 1，分母从已加载节点索引派生（不硬编码节点数）
    const rowCount = document.querySelectorAll("#platform-feed .node-row").length;
    expect(document.getElementById("overview-lit-nodes").textContent).toBe(`1 / ${rowCount}`);
  });

  it("shows the node's own light-up as a practice record in the detail", () => {
    loadApp({ seedState: seedState() });

    aim();
    document.getElementById("timer-single-log").value = "自己讲了一遍移项";
    finishTimer();

    document.getElementById("platform-entry").click();
    document.querySelector(`#platform-feed [data-action='platform-view'][data-node-id='${NODE_ID}']`).click();

    const detail = document.getElementById("platform-detail");
    expect(detail.textContent).toContain("打卡记录");
    expect(detail.textContent).toContain("自己讲了一遍移项");
    expect(detail.textContent).toContain("我");
  });

  it("keeps confirmedAt when the same light-up is confirmed again", () => {
    loadApp({ seedState: seedState() });

    aim();
    finishTimer();
    openMine();

    confirmFirstLightUp();
    const id = getState().forest.lightups[0].id;
    const firstConfirmedAt = getState().forest.lightups[0].confirmedAt;

    // 已发出的记录不再显示「发出」；直接派发一次确认，验证函数幂等
    const probe = document.createElement("button");
    probe.setAttribute("data-action", "platform-confirm");
    probe.setAttribute("data-id", id);
    document.getElementById("platform-mine").appendChild(probe);
    probe.click();

    const state = getState();
    expect(state.forest.lightups).toHaveLength(1);
    expect(state.forest.lightups[0].status).toBe("confirmed");
    expect(state.forest.lightups[0].confirmedAt).toBe(firstConfirmedAt);
  });

  it("removes a light-up from 我的 without touching the event", () => {
    loadApp({ seedState: seedState() });

    aim();
    finishTimer();
    openMine();

    document.querySelector("#platform-mine [data-action='platform-delete']").click();

    const state = getState();
    expect(state.forest.lightups).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(document.getElementById("platform-mine").textContent).toContain("还没有发出过");
    expect(document.getElementById("done-list").textContent).toContain("本地记录");
  });

  it("cascade-deletes only draft light-ups when their event is deleted", () => {
    loadApp({
      seedState: {
        version: 3,
        events: [
          {
            id: "e-a",
            habitId: null,
            habitName: null,
            title: "带草稿的事件",
            createdAt: "2026-09-23T10:00:00.000Z",
            lightUp: false,
            singleLog: "讲了移项",
            source: "timer",
            durationMs: 600000,
            report: ""
          },
          {
            id: "e-b",
            habitId: null,
            habitName: null,
            title: "带已确认点亮的事件",
            createdAt: "2026-09-24T10:00:00.000Z",
            lightUp: false,
            singleLog: "合并了同类项",
            source: "manual",
            durationMs: null,
            report: ""
          }
        ],
        forest: {
          lightups: [
            {
              id: "l-draft",
              treeId: TREE_ID,
              nodeId: NODE_ID,
              status: "draft",
              eventId: "e-a",
              evidence: { type: "self", detail: "讲了移项", timestamp: "2026-09-23T10:00:00.000Z" }
            },
            {
              id: "l-confirmed",
              treeId: TREE_ID,
              nodeId: "like-terms",
              status: "confirmed",
              confirmedAt: "2026-09-24T11:00:00.000Z",
              eventId: "e-b",
              evidence: { type: "self", detail: "合并了同类项", timestamp: "2026-09-24T10:00:00.000Z" }
            }
          ]
        }
      }
    });

    // 草稿是"尚未声明的证据副本"：事件没了，草稿跟着走
    document.querySelector("#done-list [data-action='delete'][data-id='e-a']").click();

    let state = getState();
    expect(state.forest.lightups.map((item) => item.id)).toEqual(["l-confirmed"]);

    // 已确认的点亮是追加式声明：删掉它所属的事件也保留
    document.querySelector("#done-list [data-action='delete'][data-id='e-b']").click();

    state = getState();
    expect(state.events).toHaveLength(0);
    expect(state.forest.lightups.map((item) => item.id)).toEqual(["l-confirmed"]);

    openMine();
    expect(document.getElementById("platform-mine").textContent).toContain("已发出 · 合并同类项");
  });
});
