const { loadApp } = require("./harness");

const PLATFORM_ORIGIN = "/platform/";

describe("the habit page is habit-only", () => {
  it("keeps the four daily nav buttons", () => {
    loadApp();

    expect(document.querySelectorAll(".nav .nav-button")).toHaveLength(4);
  });

  it("links back to the humansneeds.com homepage", () => {
    loadApp();

    const home = document.querySelector(".nav .nav-home");

    expect(home).not.toBeNull();
    expect(home.tagName).toBe("A");
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).toContain("humansneeds.com");
  });

  it("offers a local guest mode on the account gate", () => {
    loadApp();

    const gate = document.getElementById("account-gate");
    const guest = document.getElementById("account-guest");

    expect(gate).not.toBeNull();
    expect(guest).not.toBeNull();
    expect(guest.tagName).toBe("BUTTON");
    expect(gate.contains(guest)).toBe(true);
  });

  it("does not embed the platform shell", () => {
    loadApp();

    expect(document.getElementById("platform-shell")).toBeNull();
    expect(document.getElementById("platform-feed")).toBeNull();
    expect(document.getElementById("platform-mine")).toBeNull();
  });

  it("links every platform entry to the standalone platform service", () => {
    loadApp();

    const entry = document.getElementById("platform-entry");
    const overview = document.getElementById("overview-platform-entry");
    const change = document.getElementById("node-aim-change");

    [entry, overview, change].forEach((element) => {
      expect(element.tagName).toBe("A");
      expect(element.getAttribute("href")).toBe(PLATFORM_ORIGIN);
    });

    expect(entry.textContent).toContain("知识共建共享平台");
  });

  it("leaves the timer page in place instead of replacing it with the platform", () => {
    loadApp();

    expect(document.querySelector(".nav-button[data-page-target='timer']").textContent).toContain("专注计时");
    expect(document.querySelector(".page[data-page='timer']")).not.toBeNull();
  });
});
