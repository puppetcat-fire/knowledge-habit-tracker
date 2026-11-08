const fs = require("node:fs");
const path = require("node:path");

it("refreshes saved products on return, handles withdrawal and ignores stale login responses", async () => {
  document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, "../../product.html"), "utf8");
  history.replaceState(null, "", "/product.html?view=wants");
  const list = document.getElementById("want-list");
  const saved = { tutorial: "tutorial", version: "version", material: "0", label: "方格本",
    budgetCents: 2599, visibility: "public", productAvailable: true };
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchMock = vi.fn(async (_url, options) => {
    if (options?.method === "PUT") {
      saved.visibility = "private";
      return json({ ok: true });
    }
    return json({ ownerId: "buyer", items: [{ ...saved }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    require("../../product.js");
    await vi.waitFor(() => expect(list.querySelector("a")?.textContent).toBe("方格本"));

    saved.productAvailable = false;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.waitFor(() => expect(list.textContent).toContain("关联商品暂不可访问"));
    expect(list.querySelector("a")).toBeNull();
    expect(list.textContent).toContain("¥25.99");
    list.querySelector("button").click();
    await vi.waitFor(() => expect(list.textContent).toContain("私人"));
    expect(fetchMock).toHaveBeenCalledWith("/api/product-wants/tutorial/version/0", expect.objectContaining({
      method: "PUT", headers: expect.objectContaining({ "X-Action-Account": "buyer" }),
      body: JSON.stringify({ action: "retract" })
    }));

    saved.productAvailable = true;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.waitFor(() => expect(list.querySelector("a")?.textContent).toBe("方格本"));
    expect(list.children).toHaveLength(1);
    expect(list.textContent).toContain("私人");

    let rejectOldSession;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      rejectOldSession = () => resolve({ ok: false, status: 401 });
    }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    fetchMock.mockResolvedValueOnce(json({ ownerId: "new-buyer", items: [{ ...saved, label: "另一账号的书" }] }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.waitFor(() => expect(list.querySelector("a")?.textContent).toBe("另一账号的书"));
    rejectOldSession();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById("product-login").hidden).toBe(true);
    expect(list.textContent).not.toContain("方格本");

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await vi.waitFor(() => expect(document.getElementById("product-login").hidden).toBe(false));
    expect(list.children).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
