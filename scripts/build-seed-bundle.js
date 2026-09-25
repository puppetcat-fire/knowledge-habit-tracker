const fs = require("fs");
const path = require("path");

const SEED_DIR = path.join(__dirname, "..", "seed-trees");
const OUTPUT_PATH = path.join(SEED_DIR, "seed-trees.js");

function buildSeedBundle() {
  const fileNames = fs
    .readdirSync(SEED_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const trees = {};
  fileNames.forEach((fileName) => {
    const treeId = path.basename(fileName, ".json");
    trees[treeId] = JSON.parse(fs.readFileSync(path.join(SEED_DIR, fileName), "utf8"));
  });

  const serialized = JSON.stringify(trees, null, 2).replace(/\n/g, "\n  ");
  const contents = [
    "// 由 scripts/build-seed-bundle.js 从 seed-trees/*.json 生成，请勿手改。",
    "(function (root) {",
    `  root.FOREST_SEED_TREES = ${serialized};`,
    '})(typeof window !== "undefined" ? window : globalThis);',
    ""
  ].join("\n");

  fs.writeFileSync(OUTPUT_PATH, contents, "utf8");
  return { fileNames, size: Buffer.byteLength(contents) };
}

const { fileNames, size } = buildSeedBundle();
console.log(`seed-trees/seed-trees.js 已生成：${fileNames.length} 棵树，${size} 字节`);
