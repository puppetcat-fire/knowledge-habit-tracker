const fs = require("node:fs");
const path = require("node:path");
const { CommissionLedger } = require("../commission-ledger");

const [action, receiptFile] = process.argv.slice(2);
const ledger = new CommissionLedger(path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "commission-ledger.json"));
try {
  if (action === "verify") console.log(JSON.stringify({ valid: true, entries: ledger.read().length, settlement: "reserved" }));
  else if (["order", "refund"].includes(action) && receiptFile) {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(receiptFile), "utf8"));
    console.log(JSON.stringify(action === "order" ? ledger.record(receipt) : ledger.refund(receipt), null, 2));
  } else {
    console.error("用法：node scripts/commission-ledger.js verify | order <订单JSON> | refund <退款JSON>。本工具只记账，不收款、不分账。");
    process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
