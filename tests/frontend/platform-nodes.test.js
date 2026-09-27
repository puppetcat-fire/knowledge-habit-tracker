const { loadPlatform } = require("./platform-harness");

const TREE_ID = "k9-math";
const CUSTOM_NODES_KEY = "knowledge-habit-custom-nodes";

function treeNodeByTitle(title) {
  return Array.from(document.querySelectorAll("#platform-feed .tree-node")).find((node) =>
    node.textContent.includes(title)
  );
}

function openNode(nodeId) {
  document
    .querySelector(`#platform-feed [data-action='platform-view'][data-node-id='${nodeId}']`)
    .click();
}

function createForm() {
  document.getElementById("node-create-title").value = "小数除法";
  document.getElementById("node-create-goal").value = "会算小数除法";
  document.getElementById("node-create-minutes").value = "10";
  document.getElementById("node-create-anchor").value = "natural-numbers";
}

describe("the platform can create, own, and edit nodes", () => {
  it("opens a create composer from the header button", () => {
    loadPlatform();

    const create = document.getElementById("node-create");
    expect(create.textContent).toBe("新建节点");
    expect(document.getElementById("platform-detail").classList.contains("hidden")).toBe(true);

    create.click();

    expect(document.getElementById("node-create-title")).not.toBeNull();
    expect(document.getElementById("platform-detail").classList.contains("hidden")).toBe(false);
    // 建节点时树仍然可见
    expect(document.getElementById("platform-feed").querySelector(".tree-plane")).not.toBeNull();
  });

  it("puts a personal node on the tree and lets its owner rename it", () => {
    loadPlatform();

    document.getElementById("node-create").click();
    createForm();
    document.querySelector("[data-action='platform-create-submit']").click();

    expect(treeNodeByTitle("小数除法")).not.toBeUndefined();

    const overlay = JSON.parse(localStorage.getItem(CUSTOM_NODES_KEY));
    const created = overlay.nodes.find((node) => node.title === "小数除法");
    expect(created.treeId).toBe(TREE_ID);
    expect(created.ownership).toBe("personal");
    expect(created.ownerId).toBe("local");
    expect(overlay.edges).toContainEqual({ from: "natural-numbers", to: created.id, type: "prereq" });

    treeNodeByTitle("小数除法").click();
    expect(document.getElementById("node-ownership").textContent).toBe("我的");
    expect(document.getElementById("node-edit")).not.toBeNull();

    document.getElementById("node-edit").click();
    document.getElementById("node-edit-title").value = "小数除法练习";
    document.querySelector("[data-action='platform-edit-save']").click();

    expect(treeNodeByTitle("小数除法练习")).not.toBeUndefined();
  });

  it("shows another person's node without offering edit", () => {
    loadPlatform({
      customNodes: {
        nodes: [
          {
            id: "n-other",
            treeId: TREE_ID,
            title: "别人的节点",
            goal: "不属于我",
            estMinutes: 10,
            ownership: "personal",
            ownerId: "someone",
            ownerName: "阿禾"
          }
        ],
        edges: [{ from: "natural-numbers", to: "n-other", type: "prereq" }]
      }
    });

    openNode("n-other");

    expect(document.getElementById("node-ownership").textContent).toBe("阿禾 的");
    expect(document.getElementById("node-edit")).toBeNull();
  });

  it("treats a group node as 共有 with no edit", () => {
    loadPlatform();

    openNode("natural-numbers");

    expect(document.getElementById("node-ownership").textContent).toBe("共有");
    expect(document.getElementById("node-edit")).toBeNull();
  });

  it("keeps the create composer errors for empty title, empty goal, and out-of-range minutes", () => {
    loadPlatform();

    document.getElementById("node-create").click();
    const submit = () => document.querySelector("[data-action='platform-create-submit']").click();
    const error = () => document.getElementById("node-create-error").textContent;

    submit();
    expect(error()).toBe("写上节点名字。");

    document.getElementById("node-create-title").value = "小数除法";
    submit();
    expect(error()).toBe("写上这个节点要达成什么。");

    document.getElementById("node-create-goal").value = "会算小数除法";
    document.getElementById("node-create-minutes").value = "30";
    submit();
    expect(error()).toBe("建议时长是 5 到 15 分钟。");
  });
});
