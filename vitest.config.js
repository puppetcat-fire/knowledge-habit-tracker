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
          exclude: ["tests/frontend/**/*.test.js"]
        }
      },
      {
        name: "jsdom",
        test: {
          globals: true,
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.js"]
        }
      }
    ]
  }
});
