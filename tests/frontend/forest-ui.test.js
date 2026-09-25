const { loadApp, getState } = require("./harness");

const TREE_ID = "k9-math";
const NODE_ID = "linear-equation";

function pickNode(nodeId = NODE_ID) {
  const item = document.querySelector(`#node-picker-list [data-node-id='${nodeId}']`);
  item.click();
}

describe("aim a seed-tree node from the timer page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders every seed-tree node in #node-picker", () => {
    loadApp();

    // 26 是种子数据本身的数量，只允许出现在断言种子数据的用例里
    const items = document.querySelectorAll("#node-picker-list .habit-picker-item");
    expect(items).toHaveLength(26);

    const pickerText = document.getElementById("node-picker").textContent;
    expect(pickerText).toContain("一元一次方程");
    expect(pickerText).toContain("不挂节点（自由记录）");
  });

  it("shows goal, verify hint, suggested minutes, and prereq on #node-card", () => {
    loadApp();

    pickNode();

    const card = document.getElementById("node-card");
    expect(card.classList.contains("hidden")).toBe(false);
    expect(card.textContent).toContain("会解 ax + b = c 型方程");
    expect(card.textContent).toContain("解 3x + 5 = 20，并讲清每一步依据");
    expect(card.textContent).toContain("建议 12 分钟");
    expect(card.textContent).toContain("推荐前置：合并同类项");
  });

  it("keeps tutorial methods out of the DOM until expanded", () => {
    loadApp();

    pickNode();

    const tutorials = document.getElementById("node-card-tutorials");
    expect(tutorials.textContent).toContain("移项合并法");
    expect(tutorials.textContent).not.toContain("过等号变号");

    tutorials.querySelector(".tutorial-toggle").click();

    expect(tutorials.textContent).toContain("过等号变号");
  });

  it("keeps #done-node-select and the active picker item on the same node", () => {
    loadApp();

    pickNode();

    expect(getState().forest.selectedNodeId).toBe(NODE_ID);
    expect(document.getElementById("done-node-select").value).toBe(NODE_ID);
    expect(document.querySelector("#node-picker-list .habit-picker-item.active").dataset.nodeId).toBe(NODE_ID);
  });

  it("aims the node chosen in #done-node-select", () => {
    loadApp();

    const select = document.getElementById("done-node-select");
    select.value = "like-terms";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(getState().forest.selectedNodeId).toBe("like-terms");
    expect(document.querySelector("#node-picker-list .habit-picker-item.active").dataset.nodeId).toBe("like-terms");
    expect(getState().forest.activeTreeId).toBe(TREE_ID);
  });

  it("hides the forest controls when the seed bundle is missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    loadApp({ withSeedBundle: false });

    expect(document.getElementById("node-picker").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("node-card").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("node-aim-field").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("done-node-field").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("done-node-select").options).toHaveLength(1);
    expect(document.getElementById("done-node-select").value).toBe("");
  });
});
