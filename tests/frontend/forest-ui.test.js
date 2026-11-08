const { loadPlatform, getState } = require("./platform-harness");

const TREE_ID = "k9-math";
const NODE_ID = "linear-equation";
const HABIT_ORIGIN = "/habit";

let restoreLocation = null;

// jsdom 的 location.assign 是不可重定义的实例属性，直接换掉整个 window.location 来避免真的跳转
function stubLocationAssign() {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const assign = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { assign } });
  restoreLocation = () => Object.defineProperty(window, "location", original);
  return assign;
}

function habitState(overrides = {}) {
  return {
    version: 3,
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
      selectedHabitName: "自由记录"
    },
    settings: { hubConnected: false, lastBackupAt: null },
    forest: { activeTreeId: null, selectedNodeId: null, selectedNodeAt: null, lightups: [] },
    ...overrides
  };
}

function nodeRow(nodeId = NODE_ID) {
  return document.querySelector(`#platform-feed [data-action='platform-view'][data-node-id='${nodeId}']`);
}

function openNode(nodeId = NODE_ID) {
  nodeRow(nodeId).click();
}

function detailDoButton() {
  return document.querySelector("#platform-detail-body [data-action='platform-do']");
}

describe("the knowledge platform is a standalone dark page", () => {
  it("shows an unavailable target for a deep link absent from the current account", () => {
    history.replaceState(null, "", "#node/k9-math/private-other-account");
    try {
      loadPlatform();
      expect(document.getElementById("platform-detail-body").textContent).toContain("找不到这个节点");
      expect(getState()?.forest?.selectedNodeId ?? null).toBeNull();
    } finally {
      history.replaceState(null, "", location.pathname);
    }
  });
  it("opens a historical record's linked node without changing the selected practice target", () => {
    history.replaceState(null, "", "#node/k9-math/linear-equation");
    try {
      loadPlatform();
      expect(document.getElementById("platform-detail").classList.contains("hidden")).toBe(false);
      expect(document.getElementById("platform-detail-body").textContent).toContain("一元一次方程");
      expect(getState()?.forest?.selectedNodeId ?? null).toBeNull();
      document.getElementById("platform-detail-back").click();
      expect(location.hash).toBe("");
    } finally {
      history.replaceState(null, "", location.pathname);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (restoreLocation) {
      restoreLocation();
      restoreLocation = null;
    }
  });

  it("uses its own dark shell: no habit nav, a link back to the habit page, and its own login copy", () => {
    loadPlatform();

    expect(document.querySelectorAll(".nav-button")).toHaveLength(0);
    expect(document.querySelector(".platform-shell")).toBeNull();

    const link = document.querySelector(".platform-bar a[href='/habit/']");
    expect(link).not.toBeNull();
    expect(link.textContent).toContain("习惯记录");
    expect(document.querySelector(".platform-title").textContent).toContain("知识共建共享平台");

    expect(document.querySelector("#account-gate h1").textContent).toBe("知识共建共享平台");
    expect(document.querySelector(".account-lead").textContent).toBe("节点上挂的是人真正做过的一次。");

    expect(document.body.textContent).not.toContain("专注计时");
    expect(document.body.textContent).not.toContain("反馈与安全");
  });

  it("lays the seed nodes out as a two-dimensional plane instead of an indented list", () => {
    loadPlatform();

    const feed = document.getElementById("platform-feed");
    expect(feed.querySelector(".tree-plane")).not.toBeNull();
    // 26 是种子数据本身的数量，只允许出现在断言种子数据的用例里
    expect(document.querySelectorAll("#platform-feed .tree-node")).toHaveLength(26);

    const feedText = feed.textContent;
    expect(feedText).toContain("自然数");
    expect(feedText).toContain("一元一次方程");
    // 每行右侧给出打卡次数
    expect(feedText).toContain("次打卡");
    // 图例标出两类边的方向
    expect(feedText).toContain("前置 → 后置");
    expect(feedText).toContain("实例 → 原理");

    // 24 条 prereq 边决定列，3 条 instance-of 边把实例挂在原理右下角
    expect(document.querySelectorAll("#platform-feed .tree-edge-prereq")).toHaveLength(24);
    expect(document.querySelectorAll("#platform-feed .tree-edge-instance")).toHaveLength(3);

    const left = (nodeId) => Number.parseFloat(nodeRow(nodeId).style.left);
    const top = (nodeId) => Number.parseFloat(nodeRow(nodeId).style.top);

    // 前置在左，后置在右
    expect(left("natural-numbers")).toBeLessThan(left("integers"));
    // 实例在原理的右下方
    expect(top("chase-problem")).toBeGreaterThan(top("linear-equation"));
    expect(left("chase-problem")).toBeGreaterThan(left("linear-equation"));

    // 任意两节点满足 x 间隔 ≥140 或 y 间隔 ≥64
    const boxes = Array.from(document.querySelectorAll("#platform-feed .tree-node")).map((node) => ({
      x: Number.parseFloat(node.style.left),
      y: Number.parseFloat(node.style.top)
    }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const separated = a.x + 140 <= b.x || b.x + 140 <= a.x || a.y + 64 <= b.y || b.y + 64 <= a.y;
        expect(separated).toBe(true);
      }
    }
  });

  it("keeps tutorial methods out of the tree and expands them only in the detail", () => {
    loadPlatform();

    // 种子教程正文里有「过等号变号」，树里不能出现，教程标题也不进树
    const feed = document.getElementById("platform-feed");
    expect(feed.innerHTML).not.toContain("过等号变号");
    expect(feed.textContent).not.toContain("移项合并法");

    openNode();

    const detail = document.getElementById("platform-detail");
    expect(detail.classList.contains("hidden")).toBe(false);
    expect(detail.textContent).toContain("移项合并法");
    expect(detail.textContent).toContain("会解 ax + b = c 型方程");
    expect(detail.textContent).not.toContain("过等号变号");

    detail.querySelector(".tutorial-toggle").click();

    expect(detail.textContent).toContain("过等号变号");
    // 展开只存在内存里，不写 state（启动不写盘，展开也不写）
    expect(getState()).toBeNull();

    document.getElementById("platform-detail-back").click();
    expect(detail.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("platform-feed").classList.contains("hidden")).toBe(false);
  });

  it("does 去做 aim the node and hand off to the habit service", () => {
    const assign = stubLocationAssign();
    loadPlatform();

    openNode("like-terms");
    detailDoButton().click();

    const state = getState();
    expect(state.forest.selectedNodeId).toBe("like-terms");
    expect(state.forest.activeTreeId).toBe(TREE_ID);
    expect(typeof state.forest.selectedNodeAt).toBe("string");
    expect(state.timer.predictedAction).toBe("合并同类项");
    // 写出的对象被 app.js 的 normalizeState 接住：缺的字段都补上了
    expect(state.version).toBe(3);
    expect(state.habit).toBeNull();
    expect(Array.isArray(state.events)).toBe(true);
    expect(Array.isArray(state.habitHistory)).toBe(true);
    expect(state.settings).toBeTruthy();
    expect(assign).toHaveBeenCalledWith(HABIT_ORIGIN + "/");
  });

  it("keeps an existing prediction when 去做 runs", () => {
    const assign = stubLocationAssign();
    const seedState = habitState();
    seedState.timer.predictedAction = "已经写好的一句话";
    loadPlatform({ seedState });

    openNode("like-terms");
    detailDoButton().click();

    expect(getState().timer.predictedAction).toBe("已经写好的一句话");
    expect(getState().forest.selectedNodeId).toBe("like-terms");
    expect(assign).toHaveBeenCalledWith(HABIT_ORIGIN + "/");
  });

  it("confirms a draft light-up from the node detail, idempotently", () => {
    loadPlatform({
      seedState: habitState({
        forest: {
          activeTreeId: TREE_ID,
          selectedNodeId: null,
          selectedNodeAt: null,
          lightups: [
            {
              id: "l-draft",
              treeId: TREE_ID,
              nodeId: NODE_ID,
              status: "draft",
              eventId: null,
              evidence: { type: "self", detail: "我推了一遍移项", timestamp: "2026-09-24T10:00:00.000Z" },
              createdAt: "2026-09-24T10:00:00.000Z"
            }
          ]
        }
      })
    });

    openNode();

    const confirmButton = document.querySelector("#platform-detail-body [data-action='platform-confirm']");
    expect(confirmButton).not.toBeNull();
    confirmButton.click();

    let state = getState();
    expect(state.forest.lightups).toHaveLength(1);
    expect(state.forest.lightups[0].status).toBe("confirmed");
    const firstConfirmedAt = state.forest.lightups[0].confirmedAt;
    expect(firstConfirmedAt).toBeTruthy();

    // 已确认的按钮不再出现；直接派发一次确认，验证幂等
    const probe = document.createElement("button");
    probe.setAttribute("data-action", "platform-confirm");
    probe.setAttribute("data-id", "l-draft");
    document.getElementById("platform-detail-body").appendChild(probe);
    probe.click();

    state = getState();
    expect(state.forest.lightups).toHaveLength(1);
    expect(state.forest.lightups[0].status).toBe("confirmed");
    expect(state.forest.lightups[0].confirmedAt).toBe(firstConfirmedAt);
  });

  it("shows an empty feed with one warning when the seed bundle is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    loadPlatform({ withSeedBundle: false });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(document.getElementById("platform-feed").textContent).toContain("还没有可浏览的内容");
  });

  it("draws a LOCAL_ONLY practice entry into the detail without hitting the server", () => {
    loadPlatform();
    openNode();

    const textarea = document.getElementById("practice-text");
    textarea.value = "今天自己推了一遍移项";
    document.querySelector("#platform-detail-body [data-action='platform-submit']").click();

    const detail = document.getElementById("platform-detail");
    expect(detail.textContent).toContain("今天自己推了一遍移项");
    expect(detail.textContent).toContain("我");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById("platform-feed").textContent).toContain("1 次打卡");
  });
});
