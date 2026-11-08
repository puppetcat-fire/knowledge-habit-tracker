const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validatePathBookmarks,validateCopiedPath}=require('./path-bookmark-schema.cjs');
const {validateTutorialBookmarks}=require('./tutorial-bookmark-schema.cjs');
const { atomicJson } = require('../../../storage-transaction');
const FORMAT = 'dianliang-action-state/v1';
const allowed = new Set(['schema', 'mode', 'events', 'activeId', 'habits', 'habitId', 'templates', 'nodes', 'edges', 'lights', 'paths', 'proposals', 'issues', 'bio', 'settings', 'share']);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string';
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function validateResourceLinks(links) {
  requireValue(Array.isArray(links) && links.length <= 12, 'Invalid material list');
  for (const r of links) {
    requireValue(object(r) && Object.keys(r).every(k => ['label', 'url', 'optional', 'affiliate'].includes(k)) &&
      text(r.label) && r.label.trim() && r.label.length <= 80 && text(r.url) &&
      typeof r.optional === 'boolean' && typeof r.affiliate === 'boolean', 'Invalid material fields');
    const url = new URL(r.url);
    requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2000,
      'Invalid material URL');
  }
}
function ids(items, label) {
  requireValue(Array.isArray(items), label + ' must be an array');
  const set = new Set();
  for (const item of items) {
    requireValue(object(item) && text(item.id) && item.id.length > 0 && !set.has(item.id), label + ' IDs invalid');
    set.add(item.id);
  }
  return set;
}
function validateActionState(data) {
  requireValue(object(data) && data.schema === 1, 'Unsupported action schema');
  requireValue(Object.keys(data).every(key => allowed.has(key)), 'Unknown or account credential field');
  const eventIds = ids(data.events, 'events'), habitIds = ids(data.habits, 'habits');
  requireValue(data.activeId === null || eventIds.has(data.activeId), 'Invalid active event');
  requireValue(habitIds.has(data.habitId), 'Invalid habit focus');
  requireValue(object(data.templates), 'Invalid templates');
  if(data.settings?.publicPathBookmarks!==undefined)validatePathBookmarks(data.settings.publicPathBookmarks);
  if(data.settings?.publicTutorialBookmarks!==undefined)validateTutorialBookmarks(data.settings.publicTutorialBookmarks);
  if(data.settings?.publicFeedViews!==undefined){requireValue(object(data.settings.publicFeedViews)&&Object.keys(data.settings.publicFeedViews).every(k=>['community','following'].includes(k)),'Invalid feed view scopes');for(const v of Object.values(data.settings.publicFeedViews))requireValue(object(v)&&Object.keys(v).every(k=>['query','kind','cursor','history','draft','order'].includes(k))&&(v.order===undefined||['relevance','recent'].includes(v.order))&&text(v.query)&&v.query.length<=120&&['all','tutorial','practice','path'].includes(v.kind)&&text(v.cursor)&&v.cursor.length<=100&&Array.isArray(v.history)&&v.history.every(c=>text(c)&&c.length<=100)&&typeof v.draft==='boolean','Invalid feed view')}
  if(data.settings?.followedAuthors!==undefined){requireValue(Array.isArray(data.settings.followedAuthors),'Invalid followed authors');const followed=new Set();for(const a of data.settings.followedAuthors){requireValue(object(a)&&Object.keys(a).every(k=>['id','name','followedAt'].includes(k))&&text(a.id)&&/^[A-Za-z0-9_-]{1,64}$/.test(a.id)&&!followed.has(a.id)&&text(a.name)&&a.name.trim()&&a.name.length<=160&&Number.isSafeInteger(a.followedAt)&&a.followedAt>=0,'Invalid followed author');followed.add(a.id)}}
  for (const p of data.paths || []) {requireValue(p.bookmarked === undefined || typeof p.bookmarked === 'boolean', 'Invalid path bookmark');if(p.targetRefs!==undefined||p.sourcePathSnapshot!==undefined)validateCopiedPath(p)}
  for (const h of data.habits) requireValue(text(h.name) && h.name.trim() && (h.formedAt === null || Number.isFinite(h.formedAt)), 'Invalid habit');
  const intervals = [];
  let openCount = 0;
  for (const e of data.events) {
    requireValue(text(e.name) && e.name.trim() && Number.isFinite(e.startedAt) &&
      (e.endedAt === null || Number.isFinite(e.endedAt) && e.endedAt >= e.startedAt), 'Invalid event timestamps');
    requireValue(Array.isArray(e.segments) && text(e.draft) && object(e.stepDone), 'Invalid event body');
    ids(e.notes, 'event notes');
    for (const n of e.notes) requireValue(text(n.text) && Number.isFinite(n.at), 'Invalid single note');
    ids(e.steps, 'event steps');
    for (const step of e.steps) requireValue(text(step.text), 'Invalid step text');
    requireValue(Object.values(e.stepDone).every(v => typeof v === 'boolean'), 'Invalid step completion');
    if (e.habitId != null) requireValue(habitIds.has(e.habitId), 'Unknown event habit');
    if (e.parentId != null) requireValue(e.parentId !== e.id && eventIds.has(e.parentId), 'Unknown parent event');
    if (e.parentOrigin !== undefined) {
      const p = e.parentOrigin;
      requireValue(object(p) && text(p.id) && p.id.length > 0 && text(p.name) &&
        (p.stepId === null || text(p.stepId)) && Number.isFinite(p.deletedAt) && e.parentId == null,
        'Invalid deleted parent origin');
      requireValue(Object.keys(p).every(k => ['id', 'name', 'stepId', 'deletedAt'].includes(k)), 'Deleted parent origin contains extra data');
    }
    if (e.parentMissing !== undefined) {
      const p = e.parentMissing;
      requireValue(object(p) && text(p.id) && p.id.length > 0 && (p.stepId === null || text(p.stepId)) &&
        e.parentId == null && e.parentOrigin === undefined && Object.keys(p).every(k => ['id', 'stepId'].includes(k)), 'Invalid unavailable parent source');
    }
    if (e.knowledge != null) {
      requireValue(object(e.knowledge), 'Invalid knowledge snapshot');
      if (e.knowledge.resourceLinks !== undefined) validateResourceLinks(e.knowledge.resourceLinks);
    }
    let lastEnd = e.startedAt;
    for (const [i, seg] of e.segments.entries()) {
      requireValue(object(seg) && Number.isFinite(seg.start) && seg.start >= lastEnd, 'Unordered event segments');
      if (seg.end === null) {
        requireValue(e.id === data.activeId && e.endedAt === null && i === e.segments.length - 1, 'Open segment is not current activity');
        openCount++;
      } else {
        requireValue(Number.isFinite(seg.end) && seg.end >= seg.start && (e.endedAt === null || seg.end <= e.endedAt), 'Invalid segment end');
      }
      lastEnd = seg.end === null ? Infinity : seg.end;
      if (lastEnd > seg.start) intervals.push({ start: seg.start, end: lastEnd });
    }
  }
  requireValue(openCount === (data.activeId === null ? 0 : 1), 'Only one activity may accumulate');
  for (const n of data.nodes || []) for (const m of n.methods || []) for (const v of m.versions || [])
    if (v.resourceLinks !== undefined) validateResourceLinks(v.resourceLinks);
  intervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < intervals.length; i++) requireValue(intervals[i].start >= intervals[i - 1].end, 'Activities overlap');
  const byId = new Map(data.events.map(e => [e.id, e])), checked = new Set();
  for (const e of data.events) {
    const visiting = new Set();
    let id = e.id;
    while (id != null && !checked.has(id)) {
      requireValue(!visiting.has(id), 'Parent cycle');
      visiting.add(id); id = byId.get(id).parentId;
    }
    for (const id of visiting) checked.add(id);
  }
  return data;
}
const revision = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Independent route installation. Authentication must be supplied by a trusted
// server session resolver; no caller-supplied owner is accepted in the payload.
function readActionState(name) {
  if (!fs.existsSync(name)) return null;
  const envelope = JSON.parse(fs.readFileSync(name, 'utf8'));
  requireValue(envelope.format === FORMAT, 'Invalid stored action envelope');
  validateActionState(envelope.data);
  return envelope;
}

function readFollowedAuthors(dataDir, userId) {
  requireValue(typeof userId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(userId), 'Invalid authenticated account');
  return readActionState(path.join(dataDir, 'action-states', userId + '.json'))?.data.settings?.followedAuthors || [];
}

function installActionStateRoutes(app, { directory, authenticate }) {
  if (typeof authenticate !== 'function') throw new Error('Trusted authentication resolver required');
  const file = user => {
    requireValue(user && /^[A-Za-z0-9_-]{1,64}$/.test(user.id), 'Invalid authenticated account');
    return path.join(path.resolve(directory), user.id + '.json');
  };
  app.get('/api/action-state/summary', (req, res) => {
    const user = authenticate(req);
    if (!user) return res.status(401).json({ ok: false });
    if (req.get('X-Action-Account') && req.get('X-Action-Account') !== user.id) return res.status(409).json({ ok: false, code: 'ACTION_ACCOUNT_CHANGED' });
    res.set('Cache-Control', 'no-store');
    try {
      const state = readActionState(file(user));
      const events = state?.data.events ?? [];
      let recordedMs = 0;
      for (const event of events) {
        for (const segment of event.segments) {
          if (segment.end !== null) recordedMs += segment.end - segment.start;
        }
      }
      return res.json({ ok: true, ownerId: user.id, summary: { events: events.length, recordedMs } });
    } catch { return res.status(500).json({ ok: false, code: 'ACTION_STORE_UNREADABLE' }); }
  });
  app.get('/api/action-state', (req, res) => {
    const user = authenticate(req);
    if (!user) return res.status(401).json({ ok: false });
    if (req.get('X-Action-Account') && req.get('X-Action-Account') !== user.id) return res.status(409).json({ ok: false, code: 'ACTION_ACCOUNT_CHANGED' });
    try {
      const state = readActionState(file(user)), token = revision(state);
      return res.set('Cache-Control', 'no-store').set('ETag', '"' + token + '"').json({ ok: true, revision: token, state });
    } catch { return res.status(500).json({ ok: false, code: 'ACTION_STORE_UNREADABLE' }); }
  });
  app.put('/api/action-state', (req, res) => {
    const user = authenticate(req);
    if (!user) return res.status(401).json({ ok: false });
    if (req.get('X-Action-Account') && req.get('X-Action-Account') !== user.id) return res.status(409).json({ ok: false, code: 'ACTION_ACCOUNT_CHANGED' });
    const match = req.get('If-Match');
    if (!match) return res.status(428).json({ ok: false, code: 'ACTION_REVISION_REQUIRED' });
    try {
      requireValue(object(req.body) && req.body.format === FORMAT && Object.keys(req.body).every(key => ['format', 'data'].includes(key)), 'Invalid action envelope');
      validateActionState(req.body.data);
    } catch (error) { return res.status(400).json({ ok: false, code: 'ACTION_VALIDATION', message: error.message }); }
    try {
      const name = file(user), old = readActionState(name), token = revision(old);
      if (match !== token && match !== '"' + token + '"') return res.status(409).json({ ok: false, code: 'ACTION_CONFLICT' });
      atomicJson(name, req.body);
      return res.json({ ok: true, revision: revision(req.body) });
    } catch { return res.status(500).json({ ok: false, code: 'ACTION_STORE_UNREADABLE' }); }
  });
}
module.exports = { FORMAT, validateActionState, installActionStateRoutes, readFollowedAuthors };
