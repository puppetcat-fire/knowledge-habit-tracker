const { loadApp } = require("./harness");

const TREE_ID = "k9-math";
const CUSTOM_NODE_ID = "n-custom";

// 最小合法 v3 状态：瞄准落在个人节点上，而该节点不在种子树里
function seedState() {
  return {
    version: 3,
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
    forest: {
      activeTreeId: TREE_ID,
      selectedNodeId: CUSTOM_NODE_ID,
      selectedNodeAt: new Date().toISOString(),
      lightups: []
    }
  };
}

const CUSTOM_NODES = {
  nodes: [
    {
      id: CUSTOM_NODE_ID,
      treeId: TREE_ID,
      title: "我的除法",
      goal: "会除",
      estMinutes: 10,
      ownership: "personal",
      ownerId: "local",
      ownerName: "我"
    }
  ],
  edges: [{ from: "natural-numbers", to: CUSTOM_NODE_ID, type: "prereq" }]
};

describe("personal nodes merged into the habit page tree", () => {
  it("keeps an aim on a merged personal node instead of pruning it as dangling", () => {
    loadApp({ seedState: seedState(), customNodes: CUSTOM_NODES });

    expect(document.getElementById("node-aim-label").textContent).toContain("我的除法");
    expect(document.getElementById("node-aim-notice").textContent).not.toContain("上次那条已经不在了");
  });
});
