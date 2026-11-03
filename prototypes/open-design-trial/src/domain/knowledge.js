// 知识平台域：节点=目标，方法=怎么做；两类关系（前置推荐 / 实例），点亮是自证。
export function tree(state) {
  return state.knowledge.trees[0] || { id: 'tree', title: '知识图谱', nodes: [], methods: [] };
}

export function nodes(state) {
  return tree(state).nodes;
}

export function node(state, id) {
  return nodes(state).find((item) => item.id === id) || null;
}

export function methods(state) {
  return tree(state).methods;
}

export function methodsOf(state, nodeId) {
  return methods(state).filter((method) => method.nodeId === nodeId);
}

export function methodOf(state, methodId) {
  return methods(state).find((method) => method.id === methodId) || null;
}

/** 节点归属：公共节点属于全部点亮者，私人节点只属于个人。缺省按公共。 */
export function ownershipOf(item) {
  return item && item.ownership === 'private' ? 'private' : 'public';
}

/** 方法的历史版本（更新时归档，只读保留）。 */
export function methodHistoryOf(method) {
  return method && Array.isArray(method.history) ? method.history : [];
}

/** 取某个已归档版本的内容，用于「实践时用的是哪一版」的对照。 */
export function methodVersion(method, version) {
  if (!method) return null;
  if (method.version === version) return method;
  return methodHistoryOf(method).find((item) => item.version === version) || null;
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step) => String(step || '').trim())
    .filter(Boolean)
    .map((text) => ({ id: 'step-' + Math.random().toString(36).slice(2, 10), text }));
}

/** 贡献方法：默认私人，公开是显式选择；不接任何评分或付费。 */
export function addMethod(state, { nodeId, title, firstFive = '', steps = [], visibility = 'private', owner = '我', now = Date.now() }) {
  const trimmed = String(title || '').trim();
  if (!node(state, nodeId) || !trimmed) return null;
  const method = {
    id: 'm-' + Math.random().toString(36).slice(2, 10),
    nodeId,
    title: trimmed,
    version: 1,
    updatedAt: now,
    visibility: visibility === 'public' ? 'public' : 'private',
    owner: String(owner || '我'),
    firstFive: String(firstFive || '').trim(),
    steps: normalizeSteps(steps),
    history: []
  };
  methods(state).push(method);
  return method;
}

/** 更新方法：旧内容归档进 history，版本号 +1；过去事件的版本快照不受影响。 */
export function addMethodVersion(state, methodId, { title, firstFive, steps, visibility } = {}, now = Date.now()) {
  const method = methodOf(state, methodId);
  if (!method) return null;
  const history = Array.isArray(method.history) ? method.history : (method.history = []);
  history.push({
    version: method.version,
    title: method.title,
    firstFive: method.firstFive,
    steps: method.steps.map((step) => ({ ...step })),
    visibility: method.visibility,
    updatedAt: method.updatedAt
  });
  const nextTitle = String(title ?? method.title).trim();
  if (nextTitle) method.title = nextTitle;
  method.firstFive = String(firstFive ?? method.firstFive).trim();
  const nextSteps = normalizeSteps(steps ?? method.steps.map((step) => step.text));
  if (nextSteps.length) method.steps = nextSteps;
  if (visibility) method.visibility = visibility === 'public' ? 'public' : 'private';
  method.version += 1;
  method.updatedAt = now;
  return method;
}

export function prereqsOf(state, nodeId) {
  const target = node(state, nodeId);
  if (!target) return [];
  return target.prereqs.map((id) => node(state, id)).filter(Boolean);
}

export function dependentsOf(state, nodeId) {
  return nodes(state).filter((item) => item.prereqs.includes(nodeId));
}

/** 两类边：前置推荐（prereq → 目标）与实例（原理 → 实例）。 */
export function edges(state) {
  const list = [];
  for (const item of nodes(state)) {
    for (const prereq of item.prereqs) list.push({ from: prereq, to: item.id, kind: 'prereq' });
    for (const example of item.examples || []) list.push({ from: item.id, to: example, kind: 'instance' });
  }
  return list;
}

export function lightupsOf(state, nodeId) {
  return state.lightups.filter((item) => item.nodeId === nodeId);
}

export function litStatus(state, nodeId) {
  const list = lightupsOf(state, nodeId);
  if (list.some((item) => item.state === 'confirmed')) return 'confirmed';
  if (list.length) return 'draft';
  return 'none';
}

export function practiceEvents(state, nodeId) {
  return state.events
    .filter((event) => event.endedAt !== null && event.knowledge && event.knowledge.nodeId === nodeId)
    .sort((a, b) => b.endedAt - a.endedAt);
}

export function draftFor(state, eventId) {
  return state.lightups.find((item) => item.eventId === eventId && item.state === 'draft') || null;
}

/** 结束一次关联了知识的实践后，留一条待用户确认的点亮草稿（不自动确认）。 */
export function ensureDraft(state, { nodeId, methodId = null, eventId = null, now = Date.now() }) {
  if (!nodeId) return null;
  const existing = state.lightups.find((item) => item.nodeId === nodeId && item.eventId === eventId && item.state === 'draft');
  if (existing) return existing;
  const draft = { id: 'light-' + Math.random().toString(36).slice(2, 10), nodeId, methodId, eventId, at: now, state: 'draft', visibility: 'private' };
  state.lightups.push(draft);
  return draft;
}

export function confirmLightup(state, draftId, visibility = 'private') {
  const draft = state.lightups.find((item) => item.id === draftId);
  if (!draft) return null;
  draft.state = 'confirmed';
  draft.visibility = visibility === 'public' ? 'public' : 'private';
  draft.confirmedAt = Date.now();
  return draft;
}

export function removeLightup(state, draftId) {
  const before = state.lightups.length;
  state.lightups = state.lightups.filter((item) => item.id !== draftId);
  return state.lightups.length !== before;
}

/** 下一段可开始的知识实践：优先前置都点亮且自己未点亮的目标，其次任何一个还没点亮的目标。 */
export function suggestNext(state) {
  const candidates = nodes(state)
    .filter((item) => methodsOf(state, item.id).length > 0 && litStatus(state, item.id) !== 'confirmed')
    .map((item) => {
      const missing = item.prereqs.filter((id) => litStatus(state, id) !== 'confirmed');
      return { node: item, method: methodsOf(state, item.id)[0], ready: missing.length === 0, missing };
    });
  candidates.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    if (a.ready && b.ready) return a.node.estMinutes - b.node.estMinutes;
    return b.missing.length - a.missing.length;
  });
  return candidates[0] || null;
}
