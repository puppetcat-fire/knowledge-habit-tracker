// hash 路由：#/habit-record/timer、#/habit-record/habits/:id、#/knowledge/atlas/:nodeId 等。
export function parseHash(hash = '') {
  const clean = String(hash || '').replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return { name: 'timer', params: {} };
  const [first, second, third, fourth, fifth] = parts;
  if (first === 'habit-record') {
    if (second === 'habits') return third ? { name: 'habit-detail', params: { habitId: third } } : { name: 'habits', params: {} };
    if (second === 'records') return third ? { name: 'event-detail', params: { eventId: third } } : { name: 'records', params: {} };
    return { name: 'timer', params: {} };
  }
  if (first === 'knowledge') {
    if (second === 'atlas') {
      if (third && fourth === 'method' && fifth) return { name: 'node-detail', params: { nodeId: third, methodId: fifth } };
      return third ? { name: 'node-detail', params: { nodeId: third } } : { name: 'atlas', params: {} };
    }
    return { name: 'atlas', params: {} };
  }
  if (first === 'profile') return { name: 'profile', params: {} };
  return { name: 'timer', params: {} };
}

export function hashFor(name, params = {}) {
  switch (name) {
    case 'habits':
      return '#/habit-record/habits';
    case 'habit-detail':
      return `#/habit-record/habits/${params.habitId || ''}`;
    case 'records':
      return '#/habit-record/records';
    case 'event-detail':
      return `#/habit-record/records/${params.eventId || ''}`;
    case 'atlas':
      return '#/knowledge/atlas';
    case 'node-detail':
      return params.methodId
        ? `#/knowledge/atlas/${params.nodeId}/method/${params.methodId}`
        : `#/knowledge/atlas/${params.nodeId}`;
    case 'profile':
      return '#/profile';
    case 'timer':
    default:
      return '#/habit-record/timer';
  }
}

export function groupOf(name) {
  if (name === 'atlas' || name === 'node-detail') return 'knowledge';
  if (name === 'profile') return 'profile';
  return 'habit-record';
}

export function navigate(name, params = {}) {
  const hash = hashFor(name, params);
  if (location.hash === hash) return;
  location.hash = hash;
}
