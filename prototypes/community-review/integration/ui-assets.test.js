const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const request = require('supertest');
const { createAuthenticatedActionApp } = require('./authenticated-app.cjs');
let directory, app;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-review-assets-'));
  app = createAuthenticatedActionApp({ dataDir: directory, reviewDirectory: path.join(directory, 'assets'), rateLimitEnabled: false }).app;
});
afterEach(() => { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected directory'); fs.rmSync(directory, { recursive: true, force: true }); });
it('serves the full review under external-script CSP without broadening script execution', async () => {
  const page = await request(app).get('/review/');
  expect(page.status).toBe(200); expect(page.text).toContain('src="review.js"');
  expect(page.text).not.toMatch(/<script>/); expect(page.text).not.toMatch(/<style>/);
  expect(page.headers['content-security-policy']).toContain("script-src 'self';");
  expect(page.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
  expect((await request(app).get('/review/review.js')).text).toContain('function timerPage()');
  expect((await request(app).get('/review/review.js')).text).toContain('function nodeDetail()');
  expect((await request(app).get('/knowledge/runtime-config.js')).text).toContain('"communityUrl":"/review/"');
  expect((await request(app).get('/knowledge/')).text).toContain('id="platform-community-link"');
  expect((await request(app).get('/review/review.js')).text).toContain('href="/knowledge/">返回知识平台');
});
it('does not expose integration modules or private state files through the review directory', async () => {
  expect((await request(app).get('/review/action-state.cjs')).status).toBe(404);
  expect((await request(app).get('/review/preview-data/users.json')).status).toBe(404);
  expect((await request(app).get('/review')).headers.location).toBe('/review/');
});
