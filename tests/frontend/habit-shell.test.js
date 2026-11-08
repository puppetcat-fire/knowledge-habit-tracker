const { loadApp } = require("./harness");

const PLATFORM_PATH = "/platform/";

describe("the habit page is habit-only", () => {
  it("keeps the four daily nav buttons", () => {
    loadApp();

    expect(document.querySelectorAll(".nav button[data-page-target]")).toHaveLength(4);
  });

  it("does not embed the platform shell", () => {
    loadApp();

    expect(document.getElementById("platform-shell")).toBeNull();
    expect(document.getElementById("platform-feed")).toBeNull();
    expect(document.getElementById("platform-mine")).toBeNull();
  });

  it("links every platform entry to the same-origin knowledge page", () => {
    loadApp();

    const entry = document.getElementById("platform-entry");
    const overview = document.getElementById("overview-platform-entry");
    const change = document.getElementById("node-aim-change");

    [entry, overview, change, document.getElementById("sidebar-platform-entry")].forEach((element) => {
      expect(element.tagName).toBe("A");
      expect(element.getAttribute("href")).toBe(PLATFORM_PATH);
    });

    expect(entry.textContent).toContain("知识共建共享平台");
  });

  it("leaves the timer page in place instead of replacing it with the platform", () => {
    loadApp();

    expect(document.querySelector(".nav-button[data-page-target='timer']").textContent).toContain("专注计时");
    expect(document.querySelector(".page[data-page='timer']")).not.toBeNull();
  });
});
