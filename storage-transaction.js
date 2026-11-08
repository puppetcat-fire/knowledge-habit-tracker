const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${nodeCrypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function checkedPath(directory, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative)) throw new Error("事务路径不合法。");
  const root = path.resolve(directory);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error("事务路径越出数据目录。");
  return resolved;
}
function recoverTransactions(directory, write = atomicJson) {
  const journalPath = path.join(directory, "restore-journal.json");
  if (!fs.existsSync(journalPath)) return false;
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (journal.format !== "kht-restore/v1" || !Array.isArray(journal.entries)) throw new Error("恢复事务格式损坏，请保留数据目录并检查日志。");
  const entries = journal.entries.map((entry) => ({ filePath: checkedPath(directory, entry.relative), value: entry.value }));
  entries.forEach((entry) => write(entry.filePath, entry.value));
  fs.unlinkSync(journalPath);
  return true;
}
function commitTransaction(directory, entries, write = atomicJson) {
  recoverTransactions(directory, write);
  const journal = { format: "kht-restore/v1", entries: entries.map((entry) => ({ relative: path.relative(directory, entry.filePath), value: entry.value })) };
  journal.entries.forEach((entry) => checkedPath(directory, entry.relative));
  atomicJson(path.join(directory, "restore-journal.json"), journal);
  recoverTransactions(directory, write);
}
module.exports = { atomicJson, recoverTransactions, commitTransaction };
