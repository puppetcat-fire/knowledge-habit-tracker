const fs = require("node:fs");
const path = require("node:path");

it("rechecks the author's access on return and preserves an open draft during a failed check", async () => {
  document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, "../../product.html"), "utf8");
  history.replaceState(null, "", "/product.html?view=practice-detail&record=proof");
  const element = (id) => document.getElementById(id);
  const record = { id: "proof", authorId: "author", authorName: "作者", text: "私人实践",
    treeId: "tree", nodeId: "node", visibility: "private", images: [] };
  const response = { ok: true, json: async () => ({ record, ownerId: "author", revision: "revision", canBookmark: false }) };
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  let visibility = "visible";
  const visibilityState = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  function switchTab(state) {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
  }
  try {
    require("../../product.js");
    await vi.waitFor(() => expect(element("practice-edit").hidden).toBe(false));
    element("practice-edit").click();
    const form = element("practice-edit-form");
    form.elements.text.value = "尚未保存的补充";
    switchTab("hidden");
    expect(element("practice-detail").hidden).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    switchTab("visible");
    await vi.waitFor(() => expect(element("product-status").textContent).toContain("暂时无法核对访问权限"));
    expect(element("practice-detail").hidden).toBe(true);
    switchTab("hidden");
    switchTab("visible");
    await vi.waitFor(() => expect(element("practice-detail").hidden).toBe(false));
    expect(form.hidden).toBe(false);
    expect(form.elements.text.value).toBe("尚未保存的补充");

    const publicRecord = { ...record, visibility: "public", text: "另一窗口的正文" };
    fetchMock.mockResolvedValue({
      ok: true, json: async () => ({ record: publicRecord, ownerId: "author", revision: "new-revision", canBookmark: true })
    });
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({ current: { text: publicRecord.text, visibility: "public", revision: "new-revision" } })
    });
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(element("practice-edit-status").textContent).toContain("改为公开"));
    expect(element("practice-edit-conflict").textContent).toContain(publicRecord.text);
    expect(form.elements.text.value).toBe("尚未保存的补充");
    const edits = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(edits()).toHaveLength(1);
    fetchMock.mockRejectedValueOnce(new Error("test stops after the confirmed request"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(edits()).toHaveLength(2));
    expect(edits()[1][1].headers["If-Match"]).toBe("new-revision");
  } finally {
    visibilityState.mockRestore();
    vi.unstubAllGlobals();
  }
});
