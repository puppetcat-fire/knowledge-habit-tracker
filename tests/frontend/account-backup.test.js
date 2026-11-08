const path = require("node:path");
const { loadApp } = require("./harness");

const stateKey = "knowledge-habit-tracker";
function loadBackup(context = { localOnly: true, flush: async () => true }) {
  window.KHTBackupContext = context;
  const script = path.join(__dirname, "../../account-backup.js");
  delete require.cache[require.resolve(script)];
  require(script);
}
async function selectArchive(archive) {
  const input = document.getElementById("account-backup-file");
  Object.defineProperty(input, "files", { configurable: true, value: [{ text: async () => JSON.stringify(archive) }] });
  input.dispatchEvent(new Event("change"));
  await Promise.resolve(); await Promise.resolve();
}
describe("complete backup", () => {
  let originalLocation;
  beforeEach(() => {
    loadApp({ seedState: { version: 3, events: [{ id: "old", title: "原事件", createdAt: "2026-09-30T08:00:00Z" }] } });
    originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { reload: vi.fn() } });
  });
  afterEach(() => { Object.defineProperty(window, "location", originalLocation); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const archive = () => ({ format: "kht-account-archive/v1", mode: "local", state: { version: 3, events: [] }, nodes: [{ id: "node-one", treeId: "k9-math", title: "我的目标", goal: "试一次", estMinutes: 5, visibility: "public" }], edges: [], trees: [], tutorials: [], records: [] });
  it("previews counts before restoring all four stores privately", async () => {
    loadBackup(); await selectArchive(archive());
    expect(JSON.parse(localStorage.getItem(stateKey)).events[0].title).toBe("原事件");
    expect(document.getElementById("account-backup-status").textContent).toContain("1 个节点");
    document.getElementById("account-backup-confirm").click();
    await Promise.resolve(); await Promise.resolve();
    expect(JSON.parse(localStorage.getItem(stateKey)).events).toEqual([]);
    expect(JSON.parse(localStorage.getItem("knowledge-habit-custom-nodes")).nodes[0].visibility).toBe("private");
    expect(window.location.reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem("knowledge-habit-restore-journal")).toBeNull();
  });
  it("rejects malformed content without touching current records", async () => {
    loadBackup(); const before = localStorage.getItem(stateKey);
    await selectArchive({ ...archive(), nodes: [{ id: "node-one" }] });
    document.getElementById("account-backup-confirm").click();
    await Promise.resolve(); await Promise.resolve();
    expect(localStorage.getItem(stateKey)).toBe(before);
    expect(document.getElementById("account-backup-status").textContent).toContain("没有改变");
  });
  it("requires a new confirmation if the account changes during the save before restore", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ownerId: "alice", revision: "knowledge-1" }) }));
    vi.stubGlobal("fetch", fetch);
    const context = { localOnly: false, ownerId: "alice", revision: "revision-1", flush: async () => {
      context.ownerId = "bob";
      return true;
    } };
    loadBackup(context);
    await selectArchive(archive());
    await vi.waitFor(() => expect(document.getElementById("account-backup-confirm").hidden).toBe(false));
    document.getElementById("account-backup-confirm").click();
    await Promise.resolve();
    expect(document.getElementById("account-backup-status").textContent).toContain("账号已变化");
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rolls back an interrupted multi-store restore on the next load", () => {
    const before = localStorage.getItem(stateKey);
    localStorage.setItem("knowledge-habit-restore-journal", JSON.stringify({ before: [before, null, null, null] }));
    localStorage.setItem(stateKey, JSON.stringify({ version: 3, events: [] }));
    loadBackup();
    expect(localStorage.getItem(stateKey)).toBe(before);
    expect(window.location.reload).toHaveBeenCalledOnce();
  });
});
