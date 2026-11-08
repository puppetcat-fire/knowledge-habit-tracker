(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DianliangActionClient = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clone = value => JSON.parse(JSON.stringify(value));
  function createActionStateClient(fetcher) {
    const contexts = new Map();
    let owner = null, epoch = 0, sequence = 0, tail = Promise.resolve();
    async function json(url, options = {}) {
      const response = await fetcher(url, { credentials: 'same-origin', ...options });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        const error = Error(body.message || body.code || '请求失败');
        error.code = body.code || (response.status === 401 ? 'UNAUTHENTICATED' : 'REQUEST_FAILED');
        throw error;
      }
      return body;
    }
    function snapshot() {
      const context = owner && contexts.get(owner);
      return clone(context ? { ownerId: owner, data: context.data, revision: context.revision,
        pending: [...context.pending.values()], blocked: context.blocked } : { ownerId: null, data: null, revision: null, pending: [], blocked: false });
    }
    async function connect() {
      const generation = ++epoch; owner = null;
      const me = await json('/api/me');
      if (generation !== epoch) throw Error('连接已变化');
      const remote = await json('/api/action-state', { headers: { 'X-Action-Account': me.user.id } });
      if (generation !== epoch) throw Error('连接已变化');
      if (typeof remote.revision !== 'string') throw Error('状态缺少修订标识');
      let context = contexts.get(me.user.id);
      if (!context || !context.pending.size) {
        context = { data: remote.state ? remote.state.data : null, revision: remote.revision, pending: new Map(), blocked: false };
        contexts.set(me.user.id, context);
      }
      // Pending edits keep their original revision. Reconnection must not turn
      // an unresolved conflict into an implicit overwrite of the latest state.
      context.remote = remote.state; owner = me.user.id;
      return snapshot();
    }
    function enqueue(context, account, generation, entry) {
      const task = tail.then(async () => {
        if (generation !== epoch || owner !== account) throw Object.assign(Error('账号连接已变化'), { code: 'ACTION_ACCOUNT_CHANGED' });
        if (context.blocked) throw Object.assign(Error('前一次保存未解决，当前编辑已保留'), { code: 'ACTION_SAVE_BLOCKED' });
        try {
          const result = await json('/api/action-state', { method: 'PUT', headers: { 'Content-Type': 'application/json',
            'If-Match': context.revision, 'X-Action-Account': account }, body: JSON.stringify({ format: 'dianliang-action-state/v1', data: entry.data }) });
          if (generation !== epoch || owner !== account) throw Object.assign(Error('账号连接已变化'), { code: 'ACTION_ACCOUNT_CHANGED' });
          context.revision = result.revision; context.pending.delete(entry.id);
          return snapshot();
        } catch (error) {
          entry.error = error.code || 'NETWORK_ERROR'; context.blocked = true;
          if (error.code === 'ACTION_ACCOUNT_CHANGED' || error.code === 'UNAUTHENTICATED') { owner = null; epoch++; }
          throw error;
        }
      });
      tail = task.catch(() => {});
      return task;
    }
    function save(data) {
      if (!owner) return Promise.reject(Error('请先连接账户'));
      const context = contexts.get(owner), entry = { id: ++sequence, data: clone(data), error: null };
      context.data = clone(data); context.pending.set(entry.id, entry);
      return enqueue(context, owner, epoch, entry);
    }
    async function readRemoteVersion() {
      if (!owner) throw Error('请先连接账户');
      const generation = epoch, account = owner;
      const result = await json('/api/action-state', { headers: { 'X-Action-Account': account } });
      if (generation !== epoch || owner !== account) throw Error('连接已变化');
      return clone({ ownerId: account, revision: result.revision, state: result.state });
    }
    async function readRemote() { return (await readRemoteVersion()).state; }
    function resolveReviewed(choice, expectedRevision, data) {
      if (!owner || typeof expectedRevision !== 'string' || !['local', 'remote'].includes(choice))
        return Promise.reject(Error('核对需要原账户、版本和明确选择'));
      const account = owner, generation = epoch, context = contexts.get(owner), reviewedSequence = sequence;
      const selected = choice === 'local' ? clone(data) : null;
      const assertAccount = () => {
        if (generation !== epoch || owner !== account) throw Object.assign(Error('核对期间账户已变化'), { code: 'ACTION_ACCOUNT_CHANGED' });
      };
      const task = tail.then(async () => {
        assertAccount();
        let result, adopted;
        if (choice === 'local') {
          result = await json('/api/action-state', { method: 'PUT', headers: { 'Content-Type': 'application/json',
            'If-Match': expectedRevision, 'X-Action-Account': account }, body: JSON.stringify({ format: 'dianliang-action-state/v1', data: selected }) });
          adopted = selected;
        } else {
          result = await json('/api/action-state', { headers: { 'X-Action-Account': account } });
          if (result.revision !== expectedRevision) throw Object.assign(Error('服务版本又有变化，需要重新核对'), { code: 'ACTION_CONFLICT' });
          if ([...context.pending.keys()].some(id => id > reviewedSequence)) throw Object.assign(Error('核对期间又有编辑，需要重新核对'), { code: 'ACTION_REVIEW_CHANGED' });
          adopted = result.state ? result.state.data : null;
        }
        assertAccount();
        for (const id of context.pending.keys()) if (id <= reviewedSequence) context.pending.delete(id);
        if (!context.pending.size) context.data = clone(adopted);
        context.revision = result.revision; context.blocked = false;
        return snapshot();
      });
      tail = task.catch(() => {});
      return task;
    }
    async function retryPending() {
      if (!owner) throw Error('请先连接账户');
      const context = contexts.get(owner), account = owner, generation = epoch;
      await tail; context.blocked = false;
      for (const entry of [...context.pending.values()]) { entry.error = null; await enqueue(context, account, generation, entry); }
      return snapshot();
    }
    function restorePending(data, expectedRevision) {
      if (!owner || typeof expectedRevision !== 'string') throw Error('恢复需要原账户和修订标识');
      const context = contexts.get(owner), entry = { id: ++sequence, data: clone(data), error: 'RECOVERED_PENDING' };
      context.data = clone(data); context.revision = expectedRevision; context.pending.set(entry.id, entry); context.blocked = true;
      return snapshot();
    }
    return { connect, save, readRemote, readRemoteVersion, resolveReviewed, retryPending, restorePending, snapshot, disconnect() { owner = null; epoch++; } };
  }
  return { createActionStateClient };
});
