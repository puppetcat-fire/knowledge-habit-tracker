const fs = require("node:fs");
const nodeCrypto = require("node:crypto");
const path = require("node:path");

function hash(value) { return nodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fraction(numerator, denominator) {
  let a = numerator, b = denominator;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  if (a < 0n) a = -a;
  return { numerator: String(numerator / (a || 1n)), denominator: String(denominator / (a || 1n)), unit: "CNY-cent" };
}
function amounts(amountFen, rateBps) {
  const numerator = BigInt(amountFen) * BigInt(rateBps);
  return { commission: fraction(numerator, 10000n), holderPool: fraction(numerator, 20000n), platformPool: fraction(numerator, 20000n) };
}
function validateReceipt(input) {
  if (!input || !/^[\w.-]{1,100}$/.test(input.orderId || "") || !/^[\w.-]{1,64}$/.test(input.provider || "")) throw new Error("订单需要商户来源和稳定订单号。");
  if (!Number.isSafeInteger(input.amountFen) || input.amountFen <= 0 || input.amountFen > 100000000000) throw new Error("金额以分为单位，必须是合法的正整数。");
  const rateBps = input.rateBps === undefined ? 50 : input.rateBps;
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw new Error("抽成率需为 0–10000 个基点。");
  if (!["group", "personal"].includes(input.ownership) || !input.treeId || !input.nodeId || !Array.isArray(input.holderIds) || input.holderIds.some((id) => typeof id !== "string" || !id)) throw new Error("必须记录归因节点、持有类型与当时的持有者名单。");
  const holderIds = [...new Set(input.holderIds)].sort();
  if (input.ownership === "personal" && holderIds.length !== 1) throw new Error("个人节点应有且仅有一个持有者。");
  return { provider: input.provider, orderId: input.orderId, amountFen: input.amountFen, rateBps, ownership: input.ownership, treeId: input.treeId, nodeId: input.nodeId, holderIds };
}

class CommissionLedger {
  constructor(filePath) { this.filePath = filePath; }
  read() {
    let entries;
    try { entries = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    if (!Array.isArray(entries)) throw new Error("账本格式损坏，停止写入。");
    let previousHash = "genesis";
    entries.forEach((entry, index) => {
      const { digest, ...body } = entry;
      if (body.sequence !== index + 1 || body.previousHash !== previousHash || hash(body) !== digest) throw new Error("账本完整性检查失败，停止写入。");
      previousHash = digest;
    });
    return entries;
  }
  append(entries, value) {
    const body = { ...value, sequence: entries.length + 1, previousHash: entries.length ? entries[entries.length - 1].digest : "genesis", recordedAt: new Date().toISOString(), source: "operator-recorded", settlement: "reserved" };
    const entry = { ...body, digest: hash(body) };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${nodeCrypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(entries.concat(entry), null, 2), { flag: "wx" });
      fs.renameSync(temporary, this.filePath);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return entry;
  }
  record(input) {
    const receipt = validateReceipt(input);
    const entries = this.read();
    const existing = entries.find((entry) => entry.type === "order" && entry.receipt.provider === receipt.provider && entry.receipt.orderId === receipt.orderId);
    if (existing) {
      if (JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) throw new Error("同一订单已记账，新的内容与原单不一致。");
      return existing;
    }
    return this.append(entries, { type: "order", receipt, ...amounts(receipt.amountFen, receipt.rateBps) });
  }
  refund(input) {
    if (!input || !/^[\w.-]{1,100}$/.test(input.refundId || "") || !Number.isSafeInteger(input.amountFen) || input.amountFen <= 0) throw new Error("退款需要稳定退款号和正整数分金额。");
    const entries = this.read();
    const order = entries.find((entry) => entry.type === "order" && entry.receipt.provider === input.provider && entry.receipt.orderId === input.orderId);
    if (!order) throw new Error("原订单不存在。");
    const receipt = { provider: input.provider, orderId: input.orderId, refundId: input.refundId, amountFen: input.amountFen };
    const previous = entries.filter((entry) => entry.type === "refund" && entry.receipt.provider === input.provider && entry.receipt.orderId === input.orderId);
    const existing = previous.find((entry) => entry.receipt.refundId === input.refundId);
    if (existing) {
      if (JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) throw new Error("退款号重复且内容不一致。");
      return existing;
    }
    if (previous.reduce((sum, entry) => sum + entry.receipt.amountFen, 0) + input.amountFen > order.receipt.amountFen) throw new Error("累计退款超过原订单金额。");
    return this.append(entries, { type: "refund", receipt, reverses: order.digest, holderIds: order.receipt.holderIds, ...amounts(-input.amountFen, order.receipt.rateBps) });
  }
}

module.exports = { CommissionLedger, amounts };
