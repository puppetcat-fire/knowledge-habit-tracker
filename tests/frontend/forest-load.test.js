const { loadApp } = require("./harness");

const V2_STATE = {
  version: 2,
  habit: { name: "阅读", targetDays: 60, recurringLog: "固定时间复盘" },
  events: [
    {
      id: "ev-1",
      habitId: null,
      habitName: "自由记录",
      title: "完成阅读",
      createdAt: "2026-01-01T00:00:00.000Z",
      lightUp: false,
      singleLog: "",
      source: "manual",
      durationMs: null,
      report: ""
    }
  ],
  timer: { elapsedMs: 120000, running: false, startedAt: null },
  settings: { hubConnected: false, lastBackupAt: null }
};

describe("seed tree loading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the bundled k9-math seed tree", () => {
    loadApp();

    const tree = globalThis.FOREST_SEED_TREES["k9-math"];
    expect(tree).toBeTruthy();
    expect(tree.format).toBe("forest-tree/v1");
  });

  it("boots without throwing and warns once when the bundle is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => loadApp({ withSeedBundle: false })).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[forest]");
  });

  it("boots with a seeded v2 state while the bundle is missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => loadApp({ seedState: V2_STATE, withSeedBundle: false })).not.toThrow();
    expect(document.getElementById("habit-title").textContent).toBe("阅读");
  });

  it("boots and renders when the document has no hub toggle", () => {
    loadApp();

    expect(document.getElementById("hub-connected")).toBeNull();
    expect(document.getElementById("overview-today").textContent).toBe("0 次");
  });
});
