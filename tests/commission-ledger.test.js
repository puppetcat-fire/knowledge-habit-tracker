const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CommissionLedger, amounts } = require("../commission-ledger");

describe("auditable commission reserves", () => {
  let directory, ledger;
  const receipt = { provider: "merchant", orderId: "order-1", amountFen: 100000, rateBps: 50, treeId: "t", nodeId: "n", ownership: "group", holderIds: ["alice", "bob"] };
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-ledger-")); ledger = new CommissionLedger(path.join(directory, "ledger.json")); });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  it("reserves half of 0.5 percent for every public holder without inventing intra-pool weights", () => {
    const entry = ledger.record(receipt);
    expect(entry.commission).toEqual({ numerator: "500", denominator: "1", unit: "CNY-cent" });
    expect(entry.holderPool.numerator).toBe("250");
    expect(entry.platformPool).toEqual(entry.holderPool);
    expect(entry.receipt.holderIds).toEqual(["alice", "bob"]);
    expect(entry.settlement).toBe("reserved");
  });
  it("retains fractional cents exactly instead of selecting an unapproved rounding policy", () => {
    expect(amounts(1, 50).holderPool).toEqual({ numerator: "1", denominator: "400", unit: "CNY-cent" });
  });
  it("makes order and refund retries idempotent and caps cumulative refunds", () => {
    ledger.record(receipt); ledger.record(receipt);
    const refund = { provider: "merchant", orderId: "order-1", refundId: "r1", amountFen: 50000 };
    expect(ledger.refund(refund).commission.numerator).toBe("-250");
    ledger.refund(refund);
    expect(ledger.read()).toHaveLength(2);
    expect(() => ledger.refund({ ...refund, refundId: "r2", amountFen: 60000 })).toThrow("累计退款");
    expect(() => ledger.record({ ...receipt, amountFen: 1 })).toThrow("不一致");
  });
  it("detects edited history and stops writing rather than overwriting the ledger", () => {
    ledger.record(receipt);
    const history = JSON.parse(fs.readFileSync(ledger.filePath, "utf8"));
    history[0].receipt.amountFen = 1;
    fs.writeFileSync(ledger.filePath, JSON.stringify(history));
    expect(() => ledger.read()).toThrow("完整性");
    expect(() => ledger.record({ ...receipt, orderId: "order-2" })).toThrow("完整性");
  });
});
