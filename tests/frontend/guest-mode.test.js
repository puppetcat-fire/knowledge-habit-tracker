const fs = require("fs");
const path = require("path");

const GUEST_KEY = "kht:guest";

// 和 harness.js 一样把 index.html 灌进 jsdom，但不走 __KHT_LOCAL_ONLY__，
// 这样才能覆盖"账号门 + 游客"这条分支。
function loadGate() {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf-8");
  document.documentElement.innerHTML = html;
  localStorage.clear();

  globalThis.crypto.randomUUID = () => `id-${Math.random().toString(16).slice(2, 10)}`;
  global.alert = vi.fn();
  global.confirm = vi.fn(() => true);
  global.fetch = vi.fn((url) => {
    if (String(url).includes("/api/me")) {
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ ok: false }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  });

  const bundlePath = path.join(__dirname, "../../seed-trees/seed-trees.js");
  delete require.cache[require.resolve(bundlePath)];
  require(bundlePath);

  globalThis.__KHT_LOCAL_ONLY__ = false;

  const appPath = path.join(__dirname, "../../app.js");
  delete require.cache[require.resolve(appPath)];
  require(appPath);
}

describe("guest mode on the account gate", () => {
  it("enters the app from the gate and remembers the choice", async () => {
    loadGate();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const gate = document.getElementById("account-gate");
    const guest = document.getElementById("account-guest");
    const shell = document.querySelector(".app-shell");

    expect(gate.classList.contains("hidden")).toBe(false);

    guest.click();

    expect(gate.classList.contains("hidden")).toBe(true);
    expect(shell.classList.contains("hidden")).toBe(false);
    expect(localStorage.getItem(GUEST_KEY)).toBe("1");
    expect(document.getElementById("account-logout").textContent).toContain("登录");
  });
});
