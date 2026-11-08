const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const request = require('supertest');
const { createAuthenticatedActionApp } = require('./authenticated-app.cjs');
const { createActionStateClient } = require('./action-client');
const data = text => ({ schema: 1, activeId: 'e', habitId: 'h', habits: [{ id: 'h', name: '阅读', formedAt: null }], templates: {},
  events: [{ id: 'e', name: '阅读', startedAt: 0, endedAt: null, segments: [{ start: 0, end: null }], steps: [], stepDone: {}, draft: text,
    notes: [{ id: 'a', text: '笔记一', at: 0 }, { id: 'b', text: '笔记二', at: 1 }], knowledge: { content: '原方法', version: 1 } }] });
let directory, server, app, cookie, networkFailure;
function fetcher(url, options = {}) {
  if (networkFailure) return Promise.reject(Error('test connection interrupted'));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method: options.method || 'GET',
      headers: { Cookie: cookie, ...options.headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(body) }));
    });
    req.on('error', reject); req.end(options.body);
  });
}
async function signup(name) {
  const result = await request(app).post('/api/register').send({ name, password: 'test-only-2026' });
  return result.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
}
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-client-integration-'));
  app = createAuthenticatedActionApp({ dataDir: directory, reviewDirectory: path.join(directory, 'assets'), rateLimitEnabled: false }).app;
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  cookie = await signup('client-alice'); networkFailure = false;
});
afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected directory');
  fs.rmSync(directory, { recursive: true, force: true });
});
it('serializes consecutive complete snapshots using each saved revision', async () => {
  const client = createActionStateClient(fetcher); await client.connect();
  await Promise.all([client.save(data('第一份草稿')), client.save(data('最后一份草稿'))]);
  expect((await client.readRemote()).data).toEqual(data('最后一份草稿'));
  expect(client.snapshot().pending).toHaveLength(0);
});
it('retains failed editing and retries without inventing a successful save', async () => {
  const client = createActionStateClient(fetcher); await client.connect(); networkFailure = true;
  await expect(client.save(data('未保存'))).rejects.toThrow();
  expect(client.snapshot().pending).toHaveLength(1); expect(client.snapshot().data).toEqual(data('未保存'));
  networkFailure = false; await client.retryPending();
  expect((await client.readRemote()).data).toEqual(data('未保存'));
});
it('keeps local conflict content and does not silently rebase on reconnect', async () => {
  const first = createActionStateClient(fetcher), second = createActionStateClient(fetcher);
  await first.connect(); await second.connect(); await second.save(data('乙已保存'));
  await expect(first.save(data('甲未保存'))).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
  expect((await first.readRemote()).data).toEqual(data('乙已保存'));
  await first.connect(); expect(first.snapshot().data).toEqual(data('甲未保存'));
  await expect(first.retryPending()).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
  expect((await first.readRemote()).data).toEqual(data('乙已保存'));
});
it('stops an old account payload from being saved into a newly selected account', async () => {
  const client = createActionStateClient(fetcher); await client.connect(); const aliceCookie = cookie;
  cookie = await signup('client-bob');
  await expect(client.save(data('甲的私人内容'))).rejects.toMatchObject({ code: 'ACTION_ACCOUNT_CHANGED' });
  expect(client.snapshot().data).toBeNull();
  await client.connect(); expect(client.snapshot().data).toBeNull(); expect((await client.readRemote())).toBeNull();
  cookie = aliceCookie; await client.connect(); expect(client.snapshot().data).toEqual(data('甲的私人内容'));
});
async function conflictedPair() {
  const first = createActionStateClient(fetcher), second = createActionStateClient(fetcher);
  await first.connect(); await second.connect(); await second.save(data('乙已保存'));
  await expect(first.save(data('甲未保存'))).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
  return { first, second, reviewed: await first.readRemoteVersion() };
}
it('saves the explicitly reviewed local version using the displayed remote revision', async () => {
  const { first, reviewed } = await conflictedPair();
  expect(reviewed.state.data).toEqual(data('乙已保存'));expect(first.snapshot().pending).toHaveLength(1);
  await first.resolveReviewed('local', reviewed.revision, data('甲核对后保留'));
  expect((await first.readRemote()).data).toEqual(data('甲核对后保留'));
  expect(first.snapshot().pending).toHaveLength(0);
});
it('adopts an explicitly reviewed server version without writing another revision', async () => {
  const { first, reviewed } = await conflictedPair();
  await first.resolveReviewed('remote', reviewed.revision);
  expect(first.snapshot().data).toEqual(data('乙已保存'));expect(first.snapshot().pending).toHaveLength(0);
  expect((await first.readRemoteVersion()).revision).toBe(reviewed.revision);
});
it.each(['local','remote'])('stops %s resolution if the server changes after review', async choice => {
  const { first, second, reviewed } = await conflictedPair();await second.save(data('乙又有新修改'));
  await expect(first.resolveReviewed(choice, reviewed.revision, data('甲核对后保留'))).rejects.toMatchObject({code:'ACTION_CONFLICT'});
  expect(first.snapshot().data).toEqual(data('甲未保存'));expect(first.snapshot().pending).toHaveLength(1);
  expect((await first.readRemote()).data).toEqual(data('乙又有新修改'));
});
it('does not resolve an old account conflict into a different signed-in account', async () => {
  const { first, reviewed } = await conflictedPair();cookie = await signup('review-bob');
  await expect(first.resolveReviewed('local', reviewed.revision, data('甲核对后保留'))).rejects.toMatchObject({code:'ACTION_ACCOUNT_CHANGED'});
  const bob=createActionStateClient(fetcher);await bob.connect();expect(await bob.readRemote()).toBeNull();
  expect(first.snapshot().pending).toHaveLength(1);
});
it('does not discard editing added while a reviewed server version is being read', async () => {
  let hold=false, entered, release;
  const enteredPromise=new Promise(resolve=>entered=resolve), gate=new Promise(resolve=>release=resolve);
  const client=createActionStateClient(async (url,options)=>{const result=await fetcher(url,options);if(hold&&url==='/api/action-state'&&!options?.method){entered();await gate}return result});
  const second=createActionStateClient(fetcher);await client.connect();await second.connect();await second.save(data('乙已保存'));
  await expect(client.save(data('甲未保存'))).rejects.toMatchObject({code:'ACTION_CONFLICT'});
  const reviewed=await client.readRemoteVersion();hold=true;
  const resolution=client.resolveReviewed('remote',reviewed.revision);await enteredPromise;
  const newer=client.save(data('核对期间新增的编辑'));const rejected=expect(newer).rejects.toMatchObject({code:'ACTION_SAVE_BLOCKED'});
  release();await expect(resolution).rejects.toMatchObject({code:'ACTION_REVIEW_CHANGED'});await rejected;
  expect(client.snapshot().data).toEqual(data('核对期间新增的编辑'));expect(client.snapshot().pending).toHaveLength(2);
});
it('saves later editing after a reviewed local write without erasing its pending snapshot', async () => {
  let hold=false, entered, release;
  const enteredPromise=new Promise(resolve=>entered=resolve), gate=new Promise(resolve=>release=resolve);
  const client=createActionStateClient(async (url,options)=>{const result=await fetcher(url,options);if(hold&&options?.method==='PUT'){hold=false;entered();await gate}return result});
  const second=createActionStateClient(fetcher);await client.connect();await second.connect();await second.save(data('乙已保存'));
  await expect(client.save(data('甲未保存'))).rejects.toMatchObject({code:'ACTION_CONFLICT'});
  const reviewed=await client.readRemoteVersion();hold=true;
  const resolution=client.resolveReviewed('local',reviewed.revision,data('甲确认版本'));await enteredPromise;
  const newer=client.save(data('确认期间的后续编辑'));release();await resolution;await newer;
  expect(client.snapshot().data).toEqual(data('确认期间的后续编辑'));expect(client.snapshot().pending).toHaveLength(0);
  expect((await client.readRemote()).data).toEqual(data('确认期间的后续编辑'));
});
