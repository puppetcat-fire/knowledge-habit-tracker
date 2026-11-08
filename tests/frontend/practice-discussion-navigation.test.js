const fs = require("node:fs");
const path = require("node:path");

it("opens a linked reply once and keeps pagination separate from marking a reply read", async () => {
  document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, "../../product.html"), "utf8");
  history.replaceState(null, "", "/product.html?view=practice-detail&record=proof");
  const discussion = "/api/records/proof/discussion";
  const reply = { id: "a".repeat(32), authorId: "author", authorName: "作者", text: "旧页上的回复", received: true };
  const newest = { ...reply, id: "b".repeat(32), text: "最新留言", received: false };
  const record = { id: "proof", authorId: "author", authorName: "作者", text: "公开实践",
    treeId: "tree", nodeId: "node", visibility: "public", images: [] };
  const json = (body) => ({ ok: true, json: async () => body });
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/records/proof") return json({ record, ownerId: "reader", canBookmark: true });
    if (url === discussion + "?around=" + reply.id) return json({ ownerId: "reader", comments: [reply], newer: reply.id });
    if (url === discussion + "/" + reply.id + "/read") return json({ ok: true });
    if (url === discussion + "?" || url === discussion + "?after=" + reply.id) return json({ ownerId: "reader", comments: [newest] });
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    require("../../product.js");
    await vi.waitFor(() => expect(document.getElementById("comment-" + newest.id)).toBeTruthy());
    history.replaceState(null, "", "#comment-" + reply.id);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.waitFor(() => expect(document.activeElement.id).toBe("comment-" + reply.id));
    expect(fetchMock.mock.calls.filter(([url]) => url === discussion + "?around=" + reply.id)).toHaveLength(1);
    document.getElementById("practice-comments-newer").click();
    await vi.waitFor(() => expect(document.getElementById("comment-" + newest.id)).toBeTruthy());
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/read"))).toEqual([
      [discussion + "/" + reply.id + "/read", { method: "POST", headers: { "X-Action-Account": "reader" } }]
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
