const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
for (const [name, relative, args] of [
  ["代码检查", "eslint/bin/eslint.js", ["."]],
  ["类型检查", "typescript/bin/tsc", ["--noEmit"]],
  ["行为测试", "vitest/vitest.mjs", ["run", "--configLoader", "native"]]
]) {
  console.log(`\n${name}`);
  const result = spawnSync(process.execPath, [path.join(root, "node_modules", relative), ...args], { cwd: root, stdio: "inherit" });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("\n全部检查通过。");
