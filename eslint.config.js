const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "prototypes/open-design-trial/.checks/**"]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      ...js.configs.recommended.rules
    }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest
      }
    }
  },
  // 试作原型用 ES module（浏览器里直接跑，无构建步骤），与仓库其余 CommonJS 脚本分开配置。
  {
    files: ["prototypes/open-design-trial/src/**/*.js", "tests/trial/**/*.js", "tests/trial-ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest
      }
    },
    rules: {
      ...js.configs.recommended.rules
    }
  }
];
