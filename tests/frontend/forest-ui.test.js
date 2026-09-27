const { loadApp, getState } = require("./harness");

const TREE_ID = "k9-math";
const NODE_ID = "linear-equation";

function enterPlatform() {
  document.getElementById("platform-entry").click();
}

function cardButton(action, nodeId = NODE_ID) {
  return document.querySelector(`#platform-feed [data-action='${action}'][data-node-id='${nodeId}']`);
}

describe("the knowledge platform is a separate content page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the daily navigation at four buttons", () => {
    loadApp();

    expect(document.querySelectorAll(".nav .nav-button")).toHaveLength(4);
  });

  it("shows one short card per seed node in the feed", () => {
    loadApp();
    enterPlatform();

    const cards = document.querySelectorAll("#platform-feed .platform-card");
    // 26 是种子数据本身的数量，只允许出现在断言种子数据的用例里
    expect(cards).toHaveLength(26);

    const feedText = document.getElementById("platform-feed").textContent;
    expect(feedText).toContain("一元一次方程");
    expect(feedText).toContain("移项合并法");
    expect(feedText).toContain("建议 12 分钟");
    // 没有方法的节点用一句占位，而不是空着
    expect(feedText).toContain("还没有方法");
  });

  it("keeps tutorial methods out of the feed and expands them only in the detail", () => {
    loadApp();
    enterPlatform();

    // 种子教程正文里有「过等号变号」，卡片流里不能出现
    expect(document.getElementById("platform-feed").innerHTML).not.toContain("过等号变号");

    cardButton("platform-view").click();

    const detail = document.getElementById("platform-detail");
    expect(detail.classList.contains("hidden")).toBe(false);
    expect(detail.textContent).toContain("移项合并法");
    expect(detail.textContent).toContain("解 3x + 5 = 20，并讲清每一步依据");
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

    cardButton("platform-do", "like-terms").click();

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

    cardButton("platform-do", "like-terms").click();

    expect(document.getElementById("timer-prediction").value).toBe("已经写好的一句话");
    expect(getState().forest.selectedNodeId).toBe("like-terms");
  });

  it("shows the aim line with the node, and 换一条 goes back to the platform", () => {
    loadApp();
    enterPlatform();
    cardButton("platform-do", "like-terms").click();

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
});
