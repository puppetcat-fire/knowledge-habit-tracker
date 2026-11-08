const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../../../server');
const { loadApp, getState } = require('../../../tests/frontend/harness');

// Diagnostic tests prove incompatibility; passing is NOT migration acceptance.
const report = { kind: 'compatibility-diagnostic', observations: [] };
const at = Date.parse('2026-10-08T00:00:00Z');
function fixture() {
  const event = (id, name, endedAt, segments) => ({ id, name, startedAt: at, endedAt, segments,
    notes: [{ id: id + '-note1', text: '第一次保存', at }, { id: id + '-note2', text: '第二次保存', at: at + 1000 }],
    draft: '未保存输入', steps: [{ id: 'step-water', text: '喝水' }], stepDone: {}, repeatText: '复用说明',
    knowledge: { nodeId: 'eq', nodeTitle: '解一元一次方程', nodeGoal: '求解并验证', nodeVersion: 1,
      methodId: 'm-eq', methodTitle: '移项', version: 1, content: '两边同做运算', five: '写第一步', resource: '' } });
  return { schema: 1, activeId: 'game', habitId: 'habit-reading', habits: [{ id: 'habit-reading', name: '阅读', formedAt: null }],
    events: [event('eat', '吃东西', null, [{ start: at, end: at + 10000 }]),
      event('game', '打游戏', null, [{ start: at + 10000, end: null }]),
      event('water', '喝水', at + 10000, [{ start: at, end: at + 3000 }, { start: at + 6000, end: at + 10000 }])],
    templates: { '吃东西': { text: '复用说明', steps: [] } } };
}

function persistLoadedClient() {
  // The harness storage initially still contains the input. Exercise the real
  // input handler to persist normalized client state before observing it.
  const note = document.getElementById('timer-single-log');
  note.dispatchEvent(new Event('input', { bubbles: true }));
}

afterAll(() => {
  const output = path.join(__dirname, '../output/root-audit');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'timer-compatibility-observations.json'), JSON.stringify(report, null, 2));
});

it('demonstrates that API acceptance does not prove old client compatibility', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dianliang-compatibility-'));
  try {
    const client = request.agent(createApp({ dataDir: directory, rateLimitEnabled: false }).app);
    expect((await client.post('/api/register').send({ name: 'compatibility-fixture', password: 'test-only-2026' })).status).toBe(201);
    const source = { version: 3, ...fixture() };
    expect((await client.put('/api/state').send(source)).status).toBe(200);
    const returned = (await client.get('/api/state')).body.state;
    expect(returned).toEqual(source);
    loadApp({ seedState: returned });
    persistLoadedClient();
    const loaded = getState();
    report.observations.push({ scenario: 'unconverted-prototype-state', apiPreservesPayload: true,
      sourceEvents: source.events.length, clientEvents: loaded.events.length,
      sourceActiveId: source.activeId, clientActiveId: loaded.activeId || null });
    expect(loaded.events).toHaveLength(0);
    expect(loaded.activeId).toBeUndefined();
  } finally {
    const absolute = path.resolve(directory), prefix = path.resolve(os.tmpdir()) + path.sep;
    if (!absolute.startsWith(prefix)) throw new Error('Unexpected test directory');
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});

it('demonstrates that renaming name/title and converting dates still loses event semantics', () => {
  const source = fixture();
  const naive = { version: 3, ...source, events: source.events.map(e => ({ ...e, title: e.name,
    createdAt: new Date(e.startedAt).toISOString(), startedAt: new Date(e.startedAt).toISOString(),
    endedAt: e.endedAt === null ? null : new Date(e.endedAt).toISOString() })) };
  loadApp({ seedState: naive });
  persistLoadedClient();
  const loaded = getState();
  expect(loaded.events).toHaveLength(3);
  expect(loaded.activeId).toBeUndefined();
  expect(loaded.events.every(e => e.segments === undefined && e.notes === undefined && e.draft === undefined)).toBe(true);
  expect(loaded.events.every(e => e.tutorialSnapshot === null)).toBe(true);
  report.observations.push({ scenario: 'name-and-date-only-conversion', sourceEvents: 3, clientEvents: loaded.events.length,
    missing: ['activeId', 'events.segments', 'events.notes', 'events.draft', 'events.steps', 'events.knowledge'],
    sourceWaterActualMs: 7000, clientWaterDurationMs: loaded.events.find(e => e.id === 'water').durationMs });
});
