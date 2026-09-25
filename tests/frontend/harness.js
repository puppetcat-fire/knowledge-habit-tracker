const fs = require("fs");
const path = require("path");

const STORAGE_KEY = "knowledge-habit-tracker";

// seedState：要在 app.js 求值之前写入 localStorage 的状态（v1/v2/v3 都可以）
// withSeedBundle：false 时删除全局种子树，用于测试"树缺失"的退化路径
function loadApp({ seedState = null, withSeedBundle = true } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf-8");
  document.documentElement.innerHTML = html;
  localStorage.clear();
  if (seedState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState));
  }

  const uuid = () => `id-${Math.random().toString(16).slice(2, 10)}`;
  if (globalThis.crypto && typeof globalThis.crypto === "object") {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: uuid,
      configurable: true
    });
  } else {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: uuid },
      configurable: true
    });
  }

  global.alert = vi.fn();
  global.confirm = vi.fn(() => true);
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, bugs: [] })
    })
  );

  if (withSeedBundle) {
    // app.js 与种子包都是"求值即生效"的脚本、都没有 exports，所以每次都要出缓存后重新求值：
    // 否则先跑过 withSeedBundle: false 的用例之后，后续用例会拿到缓存模块、全局仍是 undefined。
    const bundlePath = path.join(__dirname, "../../seed-trees/seed-trees.js");
    delete require.cache[require.resolve(bundlePath)];
    require(bundlePath);
  } else {
    delete globalThis.FOREST_SEED_TREES;
  }

  const appPath = path.join(__dirname, "../../app.js");
  delete require.cache[require.resolve(appPath)];
  require(appPath);
}

function getState() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

module.exports = { loadApp, getState, STORAGE_KEY };
