// Local benchmark using a disposable, authenticated service and a synthetic thread.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { once } = require('node:events');
const { createAuthenticatedActionApp } = require('./authenticated-app.cjs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-discussion-bench-'));
  let server;
  try {
    const { app } = createAuthenticatedActionApp({ dataDir: dir, reviewDirectory: path.join(dir, 'assets'), rateLimitEnabled: false });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    async function request(url, body) {
      const r = await fetch(origin + url, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      const result = await r.json();
      if (!r.ok || !result.ok) throw Error(`${url}: ${r.status} ${result.code}`);
      return result;
    }
    const { user } = await request('/api/register', { name: 'benchmark-author', password: 'test-only-2026' });
    const treeId = 'dianliang-review-catalog-v1', nodeId = 'od-eq';
    await request('/api/records', { treeId, nodeId, text: 'Benchmark proof', lightUp: true, visibility: 'private' });
    const { tutorial } = await request('/api/tutorials', { treeId, nodeId, title: 'Benchmark tutorial', method: 'Check by substitution.', visibility: 'public' });
    const t = (await request('/api/review-public-tutorials/one?id=' + tutorial.id)).tutorial;
    if (process.argv.includes('--archives')) {
      const overBudget = process.argv.includes('--over-budget'), many = process.argv.includes('--many-threads') || overBudget;
      const threadCount = many ? 8 : 3, entriesPerThread = overBudget ? 800 : many ? 300 : 800, ids = [];
      const { user: reader } = await request('/api/register', { name: 'benchmark-reader', password: 'test-only-2026' });
      await request('/api/records', { treeId, nodeId, text: 'Reader benchmark proof', lightUp: true, visibility: 'private' });
      const storage = path.join(dir, 'tutorial-discussions'); fs.mkdirSync(storage, { recursive: true });
      let totalBytes = 0;
      for (let group = 0; group < threadCount; group++) {
        const id = group === 0 ? t.id : (await request('/api/tutorials', { treeId, nodeId, title: `Benchmark tutorial ${group}`, method: 'Check by substitution.', visibility: 'public' })).tutorial.id;
        const source = (await request('/api/review-public-tutorials/one?id=' + id)).tutorial;
        ids.push(id);
        const tutorialSnapshot = { id, title: source.title, version: source.version, target: source.target }, snapshotHash = hash(tutorialSnapshot);
        const entries = Array.from({ length: entriesPerThread }, (_, i) => {
          const actor = i % 2 ? user : reader, text = `Comment ${group}-${i}: ` + 'check the substituted value. '.repeat(12), parentId = i % 2 ? `q-${i - 1}` : null;
          return { id: i % 2 ? `r-${i}` : `q-${i}`, authorId: actor.id, authorName: actor.name, text, parentId, createdAt: i, withdrawnAt: null, requestId: `bench-${i}`, fingerprint: hash({ text, tutorialVersion: source.version, parentId }), tutorialSnapshot, snapshotHash };
        });
        const bytes = JSON.stringify({ format: 'dianliang-tutorial-discussion/v1', tutorialId: id, entries });
        totalBytes += Buffer.byteLength(bytes); fs.writeFileSync(path.join(storage, id + '.json'), bytes);
      }
      const result = { threads: threadCount, entries: threadCount * entriesPerThread, bytes: totalBytes };
      const hot = '/api/review-tutorial-discussions/' + ids.sort()[0];
      if (overBudget) await request(hot);
      for (const [name, url, field] of [['inbox', '/api/review-received-replies?scope=unread', 'replies'], ['archive', '/api/review-owned-discussions?query=Comment', 'entries']]) {
        const first = await request(url), second = url + '&cursor=' + encodeURIComponent(first.nextCursor), samples = [], hotSamples = [];
        if (first.total !== threadCount * entriesPerThread / 2 || first[field].length !== 25 || !first.nextCursor) throw Error(`Unexpected ${name} page`);
        for (let i = 0; i < 40; i++) {
          const start = performance.now(), page = await request(i % 2 ? second : url);
          if (page.pageNumber !== (i % 2 ? 2 : 1) || page[field].length !== 25) throw Error(`Unexpected ${name} order`);
          samples.push(performance.now()-start);
          if (overBudget) { const began = performance.now(), hotPage = await request(hot); if (hotPage.total !== entriesPerThread || hotPage.comments.length !== 30) throw Error('Unexpected hot page'); hotSamples.push(performance.now()-began); }
        }
        samples.sort((a,b)=>a-b); result[name] = { requests: samples.length, p50Ms: samples[19], p95Ms: samples[37] };
        if (hotSamples.length) { hotSamples.sort((a,b)=>a-b); result[name].hotPageAfterScanP95Ms=hotSamples[37]; }
      }
      return result;
    }
    const tutorialSnapshot = { id: t.id, title: t.title, version: t.version, target: t.target }, snapshotHash = hash(tutorialSnapshot);
    const entries = Array.from({ length: 2500 }, (_, i) => {
      const text = `Comment ${i}: ` + 'check the substituted value. '.repeat(12), parentId = i ? 'comment-0' : null;
      return { id: `comment-${i}`, authorId: user.id, authorName: user.name, text, parentId, createdAt: i, withdrawnAt: null, requestId: `bench-${i}`, fingerprint: hash({ text, tutorialVersion: t.version, parentId }), tutorialSnapshot, snapshotHash };
    });
    const storage = path.join(dir, 'tutorial-discussions'); fs.mkdirSync(storage, { recursive: true });
    const bytes = JSON.stringify({ format: 'dianliang-tutorial-discussion/v1', tutorialId: t.id, entries });
    fs.writeFileSync(path.join(storage, t.id + '.json'), bytes);
    const url = '/api/review-tutorial-discussions/' + t.id;
    const first = await request(url);
    if (first.total !== entries.length || first.comments.length !== 30 || !first.nextCursor) throw Error('Unexpected benchmark page');
    const second = url + '?cursor=' + encodeURIComponent(first.nextCursor);
    const samples = [];
    for (let i = 0; i < 40; i++) {
      const start = performance.now(), page = await request(i % 2 ? second : url);
      if (page.comments[0].id !== (i % 2 ? 'comment-30' : 'comment-0')) throw Error('Unexpected page order');
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { entries: entries.length, bytes: Buffer.byteLength(bytes), requests: samples.length, p50Ms: samples[19], p95Ms: samples[37] };
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected benchmark directory');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
