const { loadApp, getState } = require("./harness");

const TREE_ID = "k9-math";
const NODE_ID = "linear-equation";

function enterPlatform() {
  document.getElementById("platform-entry").click();
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

describe("the knowledge platform is a separate content page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the daily navigation at four buttons", () => {
    loadApp();

    expect(document.querySelectorAll(".nav .nav-button")).toHaveLength(4);
  });

  it("lays the seed nodes out as a two-dimensional plane instead of an indented list", () => {
    loadApp();
    enterPlatform();

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
    // 实例在原理的右下方，节点方块互不重叠
    expect(top("chase-problem")).toBeGreaterThan(top("linear-equation"));
    expect(left("chase-problem")).toBeGreaterThan(left("linear-equation"));
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
    loadApp();
    enterPlatform();

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
    expect(document.getElementById("platform-detail").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("platform-feed").classList.contains("hidden")).toBe(false);
  });

  it("does 去做 aim the node, fill the prediction, and land on the timer page", () => {
    loadApp();
    enterPlatform();

    openNode("like-terms");
    detailDoButton().click();

    const state = getState();
    expect(state.forest.selectedNodeId).toBe("like-terms");
    expect(state.forest.activeTreeId).toBe(TREE_ID);
    expect(document.getElementById("timer-prediction").value).toBe("合并同类项");
    expect(document.getElementById("platform-shell").classList.contains("hidden")).toBe(true);
    expect(document.querySelector(".page[data-page='timer']").classList.contains("hidden")).toBe(false);
    expect(document.querySelector(".nav").classList.contains("hidden")).toBe(false);
  });

  it("keeps existing prediction text when 去做 runs", () => {
    loadApp();
    document.getElementById("timer-prediction").value = "已经写好的一句话";
    document.getElementById("timer-prediction").dispatchEvent(new Event("input", { bubbles: true }));
    enterPlatform();

    openNode("like-terms");
    detailDoButton().click();

    expect(document.getElementById("timer-prediction").value).toBe("已经写好的一句话");
    expect(getState().forest.selectedNodeId).toBe("like-terms");
  });

  it("shows the aim line with the node, and 换一条 goes back to the platform", () => {
    loadApp();
    enterPlatform();
    openNode("like-terms");
    detailDoButton().click();

    const line = document.getElementById("node-aim-line");
    expect(line.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("node-aim-label").textContent).toBe("这次对着：合并同类项 · 建议 10 分钟");

    document.getElementById("node-aim-change").click();

    expect(document.getElementById("platform-shell").classList.contains("hidden")).toBe(false);

    document.getElementById("platform-back").click();
    document.getElementById("node-aim-clear").click();

    expect(line.classList.contains("hidden")).toBe(true);
    expect(getState().forest.selectedNodeId).toBeNull();
  });

  it("opens the platform from the overview header card and returns to overview", () => {
    loadApp();
    document.querySelector(".nav-button[data-page-target='overview']").click();

    document.getElementById("overview-platform-entry").click();
    expect(document.getElementById("platform-shell").classList.contains("hidden")).toBe(false);

    document.getElementById("platform-back").click();
    expect(document.getElementById("platform-shell").classList.contains("hidden")).toBe(true);
    expect(document.querySelector(".page[data-page='overview']").classList.contains("hidden")).toBe(false);
  });

  it("hides the aim line and shows an empty feed when the seed bundle is missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    loadApp({ withSeedBundle: false });

    expect(document.getElementById("node-aim-line").classList.contains("hidden")).toBe(true);
    enterPlatform();
    expect(document.getElementById("platform-feed").textContent).toContain("还没有可浏览的内容");
  });

  it("draws a LOCAL_ONLY practice entry into the detail without hitting the server", () => {
    loadApp();
    enterPlatform();
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
