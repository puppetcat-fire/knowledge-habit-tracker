const { loadPlatform, getState } = require("./platform-harness");
const { loadApp } = require("./harness");

describe("quiet next action and voluntary support", () => {
  it("shows one suggestion and opens the existing node detail without exposing methods", () => {
    loadPlatform();
    const suggestion = document.getElementById("next-action");
    expect(suggestion.classList.contains("hidden")).toBe(false);
    expect(suggestion.textContent).toContain("接下来 5 分钟");
    expect(suggestion.querySelectorAll("[data-action='platform-do']")).toHaveLength(1);
    const view = suggestion.querySelector("[data-action='platform-view']");
    view.click();
    expect(document.getElementById("platform-detail").classList.contains("hidden")).toBe(false);
    expect(document.querySelectorAll(".tutorial-toggle[aria-expanded='true']")).toHaveLength(0);
    expect(getState()).toBeNull(); // 只浏览建议与目标，不制造记录或保存空白状态。
  });

  it("hides the suggestion when there is no tree", () => {
    loadPlatform({ withSeedBundle: false });
    expect(document.getElementById("next-action").classList.contains("hidden")).toBe(true);
  });

  it("uses the existing weekly status for a voluntary invitation after achieving the milestone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00"));
    try {
      const events = Array.from({ length: 20 }, (_, index) => {
        const date = new Date("2026-08-03T12:00:00");
        date.setDate(date.getDate() + Math.floor(index / 5) * 7 + index % 5);
        return { id: `e-${index}`, habitId: "h", title: "阅读", source: "manual", createdAt: date.toISOString() };
      });
      loadApp({ seedState: { version: 3, habit: { id: "h", name: "阅读", startDate: "2026-08-01T00:00:00", targetDays: 60, active: true }, events } });
      const status = document.getElementById("habit-weekly-status").textContent;
      expect(status).toContain("已达成连续四周");
      expect(status).toContain("自愿赞赏 2–5 元");
      expect(status).toContain("继续使用免费");
      expect(document.getElementById("timer-start").disabled).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
