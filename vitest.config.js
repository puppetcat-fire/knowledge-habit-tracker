const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    globals: true,
    projects: [
      {
        name: "node",
        test: {
          globals: true,
          environment: "node",
          include: ["tests/**/*.test.js"],
          exclude: ["tests/frontend/**/*.test.js", "tests/trial-ui/**/*.test.js"]
        }
      },
      {
        name: "jsdom",
        test: {
          globals: true,
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.js"]
        }
      },
      {
        // 试作原型的集成测试：在 jsdom 里真跑 main.js（注册 → 计时 → 切换 → 结束 → 战报 → 各页）
        name: "trial-ui",
        test: {
          globals: true,
          environment: "jsdom",
          include: ["tests/trial-ui/**/*.test.js"]
        }
      }
    ]
  }
});
