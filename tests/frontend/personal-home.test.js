const path = require("node:path");
const { loadPlatform } = require("./platform-harness");
describe("personal home", () => {
  it("links a reader to the exact author's public community contributions", async () => {
    loadPlatform();
    const runtime = window.KHTRuntime;
    const profileContext = window.KHTProfileContext;
    try {
      window.KHTRuntime = { communityUrl: "/review/" };
      window.KHTProfileContext = { ...profileContext, localOnly: false, getUser: () => ({ id: "reader" }) };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, own: false, user: { id: "author-1", name: "作者" } })
      });
      const script = path.join(__dirname, "../../personal-home.js");
      delete require.cache[require.resolve(script)]; require(script);
      const entry = document.getElementById("profile-entry");
      entry.dataset.userId = "author-1";
      entry.click();
      await vi.waitFor(() => expect(document.querySelector(".profile-side a")?.getAttribute("href")).toBe("/review/?author=author-1"));
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(document.querySelector("[data-community-summary]")).toBeNull();
    } finally {
      window.KHTRuntime = runtime;
      window.KHTProfileContext = profileContext;
      history.replaceState(null, "", location.pathname);
    }
  });
  it("opens, saves a private biography, restores it, and returns to the map", () => {
    loadPlatform();
    const script = path.join(__dirname, "../../personal-home.js");
    delete require.cache[require.resolve(script)]; require(script);
    document.getElementById("profile-entry").click();
    expect(document.getElementById("personal-home").textContent).toContain("实践的痕迹");
    expect(document.getElementById("atlas-stage").classList.contains("hidden")).toBe(true);
    document.querySelector("[data-action='profile-edit']").click();
    document.getElementById("profile-tagline").value = "探索可以亲手做出来的想法";
    document.querySelector("[data-action='profile-save']").click();
    expect(JSON.parse(localStorage.getItem("knowledge-habit-profile")).visibility).toBe("private");
    expect(document.getElementById("personal-home").textContent).toContain("探索可以亲手做出来的想法");
    document.querySelector("[data-action='atlas-home']").click();
    expect(document.getElementById("personal-home").classList.contains("hidden")).toBe(true);
    expect(document.querySelectorAll(".tree-node")).toHaveLength(26);
  });
});
