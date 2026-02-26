const request = require("supertest");
const { app } = require("../server");

describe("server", () => {
  it("serves index.html", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("<!DOCTYPE html>");
    expect(response.text).toContain("专注计时");
  });
});
