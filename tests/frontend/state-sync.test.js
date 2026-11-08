const path = require("path");

function response(state, revision = "r0", status = 200) {
  return { ok: status < 400, status, json: async () => ({ ok: status < 400, state, revision }) };
}

describe("account persistence under interruptions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = `<div id="save-status" class="hidden"><span id="save-status-message"></span>
      <button id="save-retry"></button><button id="save-export"></button><button id="save-reload"></button></div>`;
    const modulePath = path.join(__dirname, "../../state-sync.js");
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retains a failed save and restores it after reopening, isolated by account", async () => {
    window.fetch = vi.fn().mockResolvedValueOnce(response(null)).mockRejectedValueOnce(new Error("连接中断"));
    const client = new window.KHTStateSync("alice");
    expect(await client.load()).toBeNull();
    expect(document.getElementById("save-status").classList.contains("hidden")).toBe(true);
    client.queue({ version: 3, events: [{ id: "work" }] });
    expect(document.getElementById("save-status").classList.contains("hidden")).toBe(true);
    expect(await client.flush()).toBe(false);
    expect(document.getElementById("save-status").classList.contains("hidden")).toBe(false);
    expect(localStorage.getItem("knowledge-habit-pending:alice")).toContain("work");
    expect(document.getElementById("save-retry").hidden).toBe(false);

    window.fetch.mockResolvedValueOnce(response(null));
    const reopened = new window.KHTStateSync("alice");
    expect((await reopened.load()).events).toEqual([{ id: "work" }]);
    window.fetch.mockResolvedValueOnce(response(null));
    expect(await new window.KHTStateSync("bob").load()).toBeNull();
    window.fetch.mockResolvedValueOnce(response(null, "r1"));
    expect(await reopened.flush()).toBe(true);
    expect(document.getElementById("save-status").classList.contains("hidden")).toBe(true);
    expect(localStorage.getItem("knowledge-habit-pending:alice")).toBeNull();
    expect(window.fetch.mock.calls.at(-1)[1].headers["If-Match"]).toBe("r0");
  });

  it("does not manufacture an empty state when reading fails", async () => {
    window.fetch = vi.fn().mockResolvedValue(response(null, "r0", 500));
    const client = new window.KHTStateSync("alice");
    await expect(client.load()).rejects.toThrow("读取失败");
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("blocks a recovered stale draft and keeps it available for export", async () => {
    const draft = { revision: "r0", state: { version: 3, events: [{ id: "offline" }] } };
    localStorage.setItem("knowledge-habit-pending:alice", JSON.stringify(draft));
    window.fetch = vi.fn().mockResolvedValue(response({ version: 3, events: [{ id: "other" }] }, "r1"));
    const client = new window.KHTStateSync("alice");
    await expect(client.load()).rejects.toThrow("另一窗口");
    expect(await client.flush()).toBe(false);
    expect(document.getElementById("save-export").hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem(client.key))).toEqual(draft);
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  it("clears a recovered draft whose exact contents were already saved before the receipt was lost", async () => {
    const state = { version: 3, events: [{ id: "committed" }] };
    localStorage.setItem("knowledge-habit-pending:alice", JSON.stringify({ revision: "r0", state }));
    window.fetch = vi.fn().mockResolvedValue(response(state, "r1"));
    const client = new window.KHTStateSync("alice");
    expect(await client.load()).toEqual(state);
    expect(client.revision).toBe("r1");
    expect(await client.flush()).toBe(true);
    expect(localStorage.getItem(client.key)).toBeNull();
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(window.fetch.mock.calls[0][1].headers["X-Action-Account"]).toBe("alice");
  });

  it("recognizes HTTP errors as failed writes, including stale windows", async () => {
    window.fetch = vi.fn().mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(null, "r1", 409));
    const client = new window.KHTStateSync("alice");
    await client.load();
    client.queue({ version: 3, events: [{ id: "work" }] });
    expect(await client.flush()).toBe(false);
    expect(client.blocked).toBe(true);
    expect(localStorage.getItem(client.key)).toContain("work");
    expect(document.getElementById("save-reload").hidden).toBe(false);
  });

  it("saves edits made during an in-flight write using the returned revision", async () => {
    let finish;
    window.fetch = vi.fn().mockResolvedValueOnce(response(null))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(response(null, "r2"));
    const client = new window.KHTStateSync("alice");
    await client.load();
    client.queue({ version: 3, events: [{ id: "first" }] });
    const saving = client.flush();
    client.queue({ version: 3, events: [{ id: "first" }, { id: "second" }] });
    finish(response(null, "r1"));
    expect(await saving).toBe(true);
    expect(window.fetch.mock.calls.at(-1)[1].headers["If-Match"]).toBe("r1");
    expect(JSON.parse(window.fetch.mock.calls.at(-1)[1].body).events).toHaveLength(2);
    expect(client.pending).toBeNull();
  });

  it.each(["retry", "reopen"])("preserves later edits after an earlier write loses its receipt (%s)", async (mode) => {
    const first = { version: 3, events: [{ id: "first" }] };
    const latest = { version: 3, events: [{ id: "second" }, ...first.events] };
    let loseReceipt;
    window.fetch = vi.fn().mockResolvedValueOnce(response(null))
      .mockImplementationOnce(() => new Promise((_, reject) => { loseReceipt = reject; }));
    let client = new window.KHTStateSync("alice");
    await client.load();
    client.queue(first);
    const sending = client.flush();
    client.queue(latest);
    loseReceipt(new Error("没有收到保存结果"));
    expect(await sending).toBe(false);
    expect(JSON.parse(localStorage.getItem(client.key))).toMatchObject({ state: latest, priorState: first });

    if (mode === "reopen") {
      client = new window.KHTStateSync("alice");
      window.fetch.mockResolvedValueOnce(response(first, "r1"));
      expect(await client.load()).toEqual(latest);
    } else {
      window.fetch.mockResolvedValueOnce(response(null, "r1"));
    }
    window.fetch.mockResolvedValueOnce(response(null, "r2"));
    expect(await client.flush()).toBe(true);
    const puts = window.fetch.mock.calls.filter(([, options]) => options.method === "PUT").map(([, options]) => options);
    expect(puts.map((options) => JSON.parse(options.body))).toEqual(mode === "retry" ? [first, first, latest] : [first, latest]);
    expect(puts.at(-1).headers["If-Match"]).toBe("r1");
    expect(localStorage.getItem(client.key)).toBeNull();
  });
});
