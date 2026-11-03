const fs = require("fs");
const path = require("path");

const SITE_JS = path.join(__dirname, "../../site/site.js");

function loadSite(fetchImpl) {
  const html = fs.readFileSync(path.join(__dirname, "../../site/index.html"), "utf-8");
  document.documentElement.innerHTML = html;
  localStorage.clear();
  window.fetch = vi.fn(fetchImpl);
  delete require.cache[require.resolve(SITE_JS)];
  require(SITE_JS);
}

function fillForm({ title = "点不开知识平台", description = "从首页点过去是 404" } = {}) {
  document.getElementById("feedback-title").value = title;
  document.getElementById("feedback-description").value = description;
  document.getElementById("feedback-type").value = "bug";
  document.getElementById("feedback-page").value = "platform";
  document.getElementById("feedback-form").dispatchEvent(new Event("submit", { cancelable: true }));
}

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body)
  });
}

describe("the personal site homepage", () => {
  it("links the habit tracker and the platform", () => {
    loadSite(() => jsonResponse({ status: "ok" }));

    expect(document.querySelector('a[href="/habit/"]')).not.toBeNull();
    expect(document.querySelector('a[href="/platform/"]')).not.toBeNull();
    expect(document.title).toContain("humansneeds");
  });

  it("posts feedback to the local api when the service is up", async () => {
    loadSite((url, options) => {
      if (url === "/health") {
        return jsonResponse({ status: "ok" });
      }
      expect(url).toBe("/api/bugs");
      const payload = JSON.parse(options.body);
      expect(payload.title).toBe("[有问题] 点不开知识平台");
      expect(payload.page).toBe("platform");
      return jsonResponse({ ok: true });
    });

    fillForm();

    await vi.waitFor(() => {
      expect(document.getElementById("feedback-result").hidden).toBe(false);
    });
    expect(document.getElementById("feedback-result").classList.contains("is-ok")).toBe(true);
    expect(document.getElementById("feedback-fallback").hidden).toBe(true);
  });

  it("offers a prefilled github issue when the service is down", async () => {
    loadSite((url) => {
      if (url === "/health") {
        return Promise.reject(new Error("offline"));
      }
      return Promise.reject(new Error("offline"));
    });

    fillForm({ title: "计时器不动了", description: "点开始没有反应" });

    await vi.waitFor(() => {
      expect(document.getElementById("feedback-result").hidden).toBe(false);
    });

    expect(document.getElementById("feedback-result").classList.contains("is-error")).toBe(true);
    const fallback = document.getElementById("feedback-fallback");
    expect(fallback.hidden).toBe(false);

    const link = document.getElementById("feedback-issue-link");
    expect(link.href).toContain("github.com/puppetcat-fire/knowledge-habit-tracker/issues/new");
    expect(decodeURIComponent(link.href)).toContain("计时器不动了");
    expect(decodeURIComponent(link.href)).toContain("点开始没有反应");
  });

  it("keeps a draft in localStorage until it is submitted", async () => {
    loadSite(() => jsonResponse({ status: "ok" }));
    const title = document.getElementById("feedback-title");
    title.value = "写到一半";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    const draft = JSON.parse(localStorage.getItem("humansneeds-feedback-draft"));
    expect(draft.title).toBe("写到一半");
  });
});
