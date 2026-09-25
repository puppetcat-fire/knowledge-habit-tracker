const fs = require("fs");
const path = require("path");

const SEED_DIR = path.join(__dirname, "../seed-trees");
const BUNDLE_PATH = path.join(SEED_DIR, "seed-trees.js");

function listSeedJsonFiles() {
  return fs
    .readdirSync(SEED_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readSeedJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(SEED_DIR, fileName), "utf8"));
}

function loadBundle() {
  delete require.cache[require.resolve(BUNDLE_PATH)];
  require(BUNDLE_PATH);
  return globalThis.FOREST_SEED_TREES;
}

describe("seed bundle", () => {
  it("matches every seed-trees json file", () => {
    const bundle = loadBundle();
    const fileNames = listSeedJsonFiles();

    expect(fileNames.length).toBeGreaterThan(0);
    expect(Object.keys(bundle).sort()).toEqual(fileNames.map((name) => path.basename(name, ".json")));

    fileNames.forEach((fileName) => {
      const treeId = path.basename(fileName, ".json");
      expect(
        bundle[treeId],
        `seed-trees/seed-trees.js 里的 "${treeId}" 与 seed-trees/${fileName} 不一致，请运行 npm run seed:bundle`
      ).toEqual(readSeedJson(fileName));
    });
  });

  it("bundles the k9-math seed tree with its node, edge and tutorial counts", () => {
    const tree = loadBundle()["k9-math"];
    expect(tree.format).toBe("forest-tree/v1");
    expect(tree.nodes).toHaveLength(26);
    expect(tree.edges).toHaveLength(27);
    expect(tree.tutorials).toHaveLength(3);
  });
});
