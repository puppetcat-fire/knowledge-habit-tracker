const fs = require("node:fs");
const path = require("node:path");

it("marks a message read from the unread inbox and replaces a now-empty page", async () => {
  document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, "../../product.html"), "utf8");
  history.replaceState(null, "", "/product.html?view=practice-replies&scope=unread&page=2");
  const item = { recordId: "proof", id: "a".repeat(32), authorName: "留言者", kind: "comment",
    unread: true, text: "末页的留言" };
  const inbox = "/api/practice-replies?scope=unread&page=2";
  const read = "/api/records/proof/discussion/" + item.id + "/read";
  const json = (body) => ({ ok: true, json: async () => body });
  let marked = false;
  const fetchMock = vi.fn(async (url) => {
    if (url === read) {
      marked = true;
      return json({ ok: true });
    }
    if (url !== inbox) throw new Error("Unexpected request: " + url);
    const replies = marked ? [{ ...item, id: "b".repeat(32), text: "仍未读的留言" }] : [item];
    return json({ ownerId: "recipient", replies, page: marked ? 1 : 2, hasNext: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    require("../../product.js");
    const list = document.getElementById("practice-reply-list");
    await vi.waitFor(() => expect(list.textContent).toContain("末页的留言"));
    expect(list.querySelector("button").textContent).toBe("标为已读");
    list.querySelector("button").click();
    await vi.waitFor(() => expect(list.textContent).toContain("仍未读的留言"));
    expect(list.textContent).not.toContain("末页的留言");
    expect(new URLSearchParams(location.search).get("page")).toBe("1");
    expect(document.getElementById("practice-reply-pages").hidden).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(read, { method: "POST", headers: { "X-Action-Account": "recipient" } });
  } finally {
    vi.unstubAllGlobals();
  }
});
