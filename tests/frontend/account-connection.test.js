const fs = require("node:fs");
const path = require("node:path");

describe.each([["习惯页", "index.html", "app.js"], ["知识页", "platform.html", "platform.js"]])("%s account connection", (_name, html, script) => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, "../..", html), "utf8");
    globalThis.__KHT_LOCAL_ONLY__ = false;
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false }) });
    global.confirm = vi.fn(() => true);
    const filePath = path.join(__dirname, "../..", script);
    delete require.cache[require.resolve(filePath)];
    require(filePath);
  });
  afterEach(() => { globalThis.__KHT_LOCAL_ONLY__ = true; vi.restoreAllMocks(); });
  it.skipIf(script !== "platform.js")("keeps the previous private node hidden while a new account loads its own graph", async () => {
    require("../../seed-trees/seed-trees.js");
    require("../../product-rules.js");
    const previousSync = window.KHTStateSync;
    window.KHTStateSync = class {
      async load() { return null; }
      async flush() { return true; }
    };
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    const hash = "#node/alice-tree/private-alice";
    let account, releaseOverlay, releaseRecords, releasePractice, releaseInbox, savedPractice, practiceReads = 0;
    const practiceKeys = [];
    window.fetch.mockImplementation(async (url, options) => {
      if (url === "/api/register") {
        account = JSON.parse(options.body).name;
        return json({ ok: true, user: { id: account, name: account } });
      }
      if (url === "/api/tutorials") return json({ tutorials: [] });
      if (url === "/api/practice-replies?summary=1") {
        if (account === "bob") return json({ ownerId: "bob", unreadCount: 2 });
        return new Promise(resolve => { releaseInbox = () => resolve(json({ ownerId: "alice", unreadCount: 9 })); });
      }
      if (url === "/api/nodes" && account === "bob") return new Promise(resolve => { releaseOverlay = resolve; });
      if (url === "/api/nodes") return json({
        nodes: [{ id: "private-alice", treeId: "alice-tree", title: "Alice 私人目标", visibility: "private", ownership: "personal", ownerId: "alice" }],
        edges: [], trees: [{ id: "alice-tree", name: "Alice 私人树", ownerId: "alice", visibility: "private" }]
      });
      if (url === "/api/records?treeId=alice-tree") {
        if (++practiceReads === 1) return { ok: false, status: 503 };
        if (practiceReads === 4) return json({ records: [savedPractice] });
        return new Promise(resolve => {
          releaseRecords = () => resolve(json({
            records: [
              { id: "alice-record", treeId: "alice-tree", nodeId: "private-alice", authorId: "alice", text: "Alice 的实践记录", createdAt: "2026-08-01T00:00:00Z" },
              { id: "different-node-record", treeId: "alice-tree", nodeId: "other-node", authorId: "alice", eventId: "shared-event", text: "另一个节点的实践", createdAt: "2026-08-01T00:00:00Z" }
            ]
          }));
        });
      }
      if (url === "/api/records" && options?.method === "POST") {
        practiceKeys.push(options.headers["Idempotency-Key"]);
        if (practiceKeys.length === 1) throw new TypeError("Receipt lost");
        return new Promise(resolve => {
          releasePractice = () => {
            savedPractice = { ...JSON.parse(options.body), id: "saved-practice", authorId: "alice", eventId: "shared-event", createdAt: "2026-08-01T00:00:00Z" };
            resolve(json({ ok: true, record: savedPractice }));
          };
        });
      }
      return json({ ok: true, records: [] });
    });
    const login = (name) => {
      document.getElementById("account-name").value = name;
      document.getElementById("account-password").value = "test-password";
      document.getElementById("account-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };
    try {
      history.replaceState(null, "", hash);
      login("alice");
      const detail = document.getElementById("platform-detail-body");
      await vi.waitFor(() => expect(detail.textContent).toContain("Alice 私人目标"));
      await vi.waitFor(() => expect(detail.textContent).toContain("实践记录暂时无法读取"));
      expect(detail.textContent).not.toContain("还没有人在这里打过卡");
      detail.querySelector('[data-action="platform-records-retry"]').click();
      await vi.waitFor(() => expect(releaseRecords).toBeTypeOf("function"));
      detail.querySelector("#practice-text").value = "正在写的实践草稿";
      releaseRecords();
      await vi.waitFor(() => expect(detail.textContent).toContain("Alice 的实践记录"));
      expect(detail.querySelector("#practice-text").value).toBe("正在写的实践草稿");
      expect(window.fetch.mock.calls.filter(([url]) => url.startsWith("/api/records?")).map(([url]) => url)).toEqual(["/api/records?treeId=alice-tree", "/api/records?treeId=alice-tree"]);
      window.dispatchEvent(new Event("hashchange"));
      await vi.waitFor(() => expect(practiceReads).toBe(3));
      detail.querySelector("#practice-text").value = "正在写的实践草稿";
      const submitPractice = () => detail.querySelector('[data-action="platform-submit"]').click();
      submitPractice();
      await vi.waitFor(() => expect(detail.querySelector("#practice-status").textContent).toContain("没有收到保存结果"));
      expect(detail.querySelector("#practice-text").value).toBe("正在写的实践草稿");
      submitPractice();
      await vi.waitFor(() => expect(releasePractice).toBeTypeOf("function"));
      detail.querySelector("#practice-text").value = "等待回执时写的下一条";
      releasePractice();
      await vi.waitFor(() => expect(detail.querySelector(".record-list").textContent).toContain("正在写的实践草稿"));
      expect(detail.querySelector("#practice-text").value).toBe("等待回执时写的下一条");
      expect(detail.querySelector("#practice-status").textContent).toContain("当前输入已保留");
      expect(practiceKeys).toHaveLength(2);
      expect(practiceKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
      expect(practiceKeys[1]).toBe(practiceKeys[0]);
      releaseRecords();
      await vi.waitFor(() => expect(practiceReads).toBe(4));
      await vi.waitFor(() => expect(detail.querySelector(".record-list").textContent).not.toContain("正在读取实践记录"));
      expect(detail.querySelector(".record-list").textContent).toContain("正在写的实践草稿");
      expect(detail.querySelector("#practice-text").value).toBe("等待回执时写的下一条");
      await vi.waitFor(() => expect(releaseInbox).toBeTypeOf("function"));
      document.getElementById("account-logout").click();
      const root = document.getElementById("platform-root");
      await vi.waitFor(() => expect(root.classList.contains("hidden")).toBe(true));
      history.replaceState(null, "", hash);
      login("bob");
      await vi.waitFor(() => expect(releaseOverlay).toBeTypeOf("function"));
      window.dispatchEvent(new Event("hashchange"));
      expect(root.classList.contains("hidden")).toBe(true);
      expect(detail.textContent).not.toContain("Alice 私人目标");
      releaseOverlay(json({ nodes: [], edges: [] }));
      await vi.waitFor(() => expect(detail.textContent).toContain("找不到这个节点"));
      const inbox = document.getElementById("platform-practice-replies");
      await vi.waitFor(() => expect(inbox.textContent).toContain("2 条未读"));
      releaseInbox();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(inbox.textContent).toContain("2 条未读");
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      expect(inbox.textContent).toBe("收到的留言与回复");
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      await vi.waitFor(() => expect(inbox.textContent).toContain("2 条未读"));
    } finally {
      window.KHTStateSync = previousSync;
      history.replaceState(null, "", location.pathname);
    }
  });
  it("explains a stopped service, retains input, and allows a subsequent retry", async () => {
    await Promise.resolve();
    window.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const name = document.getElementById("account-name");
    const password = document.getElementById("account-password");
    name.value = "测试者"; password.value = "test-password";
    const form = document.getElementById("account-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("account-error").textContent).toContain("start-product.cmd"));
    expect(name.value).toBe("测试者");
    expect(password.value).toBe("test-password");
    expect(document.getElementById("account-submit").disabled).toBe(false);
    window.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, message: "名字已注册，请登录。" }) });
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("account-error").textContent).toBe("名字已注册，请登录。"));
  });
});
