const fs = require("fs");
const path = require("path");

const STORAGE_KEY = "knowledge-habit-tracker";
const CUSTOM_NODES_KEY = "knowledge-habit-custom-nodes";

// seedState：要在 platform.js 求值之前写入 localStorage 的状态
// customNodes：要在 platform.js 求值之前写入的个人节点 overlay（{ nodes, edges }）
// withSeedBundle：false 时删除全局种子树，用于测试"树缺失"的退化路径
function loadPlatform({ seedState = null, customNodes = null, withSeedBundle = true } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "../../platform.html"), "utf-8");
  document.documentElement.innerHTML = html;
  localStorage.clear();
  if (seedState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState));
  }
  if (customNodes) {
    localStorage.setItem(CUSTOM_NODES_KEY, JSON.stringify(customNodes));
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
      json: () => Promise.resolve({ ok: true })
    })
  );

  if (withSeedBundle) {
    // platform.js 与种子包都是"求值即生效"的脚本、都没有 exports，所以每次都要出缓存后重新求值：
    // 否则先跑过 withSeedBundle: false 的用例之后，后续用例会拿到缓存模块、全局仍是 undefined。
    const bundlePath = path.join(__dirname, "../../seed-trees/seed-trees.js");
    delete require.cache[require.resolve(bundlePath)];
    require(bundlePath);
  } else {
    delete globalThis.FOREST_SEED_TREES;
  }

  // platform.js 在求值时读取该开关；前端测试一律走本地模式，不连服务端
  globalThis.__KHT_LOCAL_ONLY__ = true;
  require("../../product-rules");

  const platformPath = path.join(__dirname, "../../platform.js");
  delete require.cache[require.resolve(platformPath)];
  require(platformPath);
}

function getState() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

module.exports = { loadPlatform, getState, STORAGE_KEY };
