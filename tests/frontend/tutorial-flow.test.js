const { loadPlatform, getState } = require("./platform-harness");
const { loadApp, getState: habitState } = require("./harness");

function openNode() {
  document.querySelector("#platform-feed [data-node-id='linear-equation']").click();
}
function contribute() {
  document.querySelector("[data-action='tutorial-create']").click();
  document.getElementById("tutorial-title").value = "我的等式方法";
  document.getElementById("tutorial-method").value = "两侧同时减去常数，再同时除以系数。";
  document.getElementById("tutorial-start").value = "先在纸上写下 3x + 5 = 20。";
  document.querySelector("[data-action='tutorial-save']").click();
}

describe("method-to-practice evidence chain", () => {
  it("saves a private method, retains practice text when expanding, and offers it for action", () => {
    loadPlatform(); openNode(); contribute();
    const tutorials = JSON.parse(localStorage.getItem("knowledge-habit-tutorials"));
    expect(tutorials).toHaveLength(1);
    expect(tutorials[0].visibility).toBe("private");
    const recordText = document.getElementById("practice-text");
    recordText.value = "还没提交的实践说明";
    const card = Array.from(document.querySelectorAll("[data-tutorial-card]")).find((item) => item.dataset.tutorialCard === tutorials[0].id);
    card.querySelector(".tutorial-toggle").click();
    expect(document.getElementById("practice-text")).toBe(recordText);
    expect(recordText.value).toBe("还没提交的实践说明");
    expect(document.querySelector(`[data-action='tutorial-use'][data-id='${tutorials[0].id}']`)).not.toBeNull();
  });

  it("hands off the chosen method and freezes its version in a finished timer event", () => {
    loadPlatform(); openNode(); contribute();
    const tutorial = JSON.parse(localStorage.getItem("knowledge-habit-tutorials"))[0];
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { assign: vi.fn() } });
    let transferred;
    try {
      document.querySelector(`[data-tutorial-card='${tutorial.id}'] .tutorial-toggle`).click();
      document.querySelector(`[data-action='tutorial-use'][data-id='${tutorial.id}']`).click();
      transferred = getState();
      expect(transferred.forest.selectedTutorial.version).toBe(tutorial.version);
      expect(transferred.timer.predictedAction).toBe(tutorial.startAction);
    } finally { Object.defineProperty(window, "location", originalLocation); }
    transferred.timer.elapsedMs = 300000;
    loadApp({ seedState: transferred });
    document.getElementById("timer-finish").click();
    const stored = habitState();
    expect(stored.events[0].tutorialSnapshot.method).toBe(tutorial.method);
    expect(stored.forest.lightups[0].tutorialId).toBe(tutorial.id);
    expect(stored.forest.selectedTutorial).toBeNull();
    loadApp({ seedState: stored });
    expect(habitState()).toEqual(stored); // 启动不改写已有来源快照。
    const link = document.querySelector(".event-method a");
    expect(new URL(link.href).hash).toBe(`#node/k9-math/linear-equation/tutorial/${tutorial.id}/${tutorial.version}`);
    document.getElementById("done-title").value = "另一件事";
    document.getElementById("done-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(habitState().events.find((event) => event.id === stored.events[0].id).tutorialSnapshot.version).toBe(tutorial.version);
  });

  it("persists a local private practice instead of keeping it only in memory", () => {
    loadPlatform(); openNode();
    document.getElementById("practice-text").value = "自己先试过一次";
    document.querySelector("[data-action='platform-submit']").click();
    const records = JSON.parse(localStorage.getItem("knowledge-habit-practice-records"));
    expect(records[0].visibility).toBe("private");
    expect(records[0].lightUp).toBe(false);
  });

  it("shows a private confirmation for archived tutorial evidence recovered from the event", () => {
    const tutorialSnapshot = { id: "archived-method", title: "已归档的方法", version: "archive-v1", method: "保留当时的做法。", archived: true };
    const timestamp = "2026-09-24T10:00:00.000Z";
    loadPlatform({ seedState: {
      ...habitState(),
      events: [{ id: "archive-event", title: "一次私人练习", tutorialSnapshot }],
      forest: { activeTreeId: "k9-math", lightups: [{
        id: "archive-draft", treeId: "k9-math", nodeId: "linear-equation", status: "draft", eventId: "archive-event",
        evidence: { type: "self", detail: "一次私人练习", timestamp }, createdAt: timestamp
      }] }
    } });
    openNode();
    const confirm = document.querySelector("[data-action='platform-confirm']");
    expect(confirm.textContent).toBe("自证点亮，私人保存");
    confirm.click();
    const detail = document.getElementById("platform-detail-body");
    expect(detail.textContent).toContain("仅自己可见");
    expect(detail.textContent).toContain("archive-");
    expect(detail.textContent).toContain(tutorialSnapshot.method);
  });

  it("keeps practices on a private node private and omits the publish action", () => {
    loadPlatform({ customNodes: { nodes: [{
      id: "private-practice-node", treeId: "k9-math", title: "私人目标",
      visibility: "private", ownership: "personal", ownerId: "local"
    }], edges: [] } });
    document.querySelector("#platform-feed [data-node-id='private-practice-node']").click();
    const publicInput = document.getElementById("practice-public");
    expect(publicInput.disabled).toBe(true);
    document.getElementById("practice-text").value = "私人实践内容";
    publicInput.checked = true;
    document.querySelector("[data-action='platform-submit']").click();
    expect(localStorage.getItem("knowledge-habit-practice-records")).toBeNull();
    publicInput.checked = false;
    document.querySelector("[data-action='platform-submit']").click();
    expect(JSON.parse(localStorage.getItem("knowledge-habit-practice-records"))[0].visibility).toBe("private");
    expect(document.querySelector("[data-action='record-visibility']")).toBeNull();
  });
});
