const fs = require('node:fs');
const path = require('node:path');
const { hasStoredActionConfirmation } = require('./knowledge-confirmation.cjs');
const { recoverTransactions } = require('../../../storage-transaction');
const { disclosedTarget } = require('./knowledge-visible-targets.cjs');
function readArray(file) {
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw Error('Unreadable knowledge store');
  return value;
}
// The independent review wraps existing knowledge routes without rewriting
// production records or trusting a caller-supplied author or light-up flag.
async function checkPublication(req, res, next, { config, sessionAccount }) {
  try {
    recoverTransactions(config.dataDir);
    if (!['POST', 'PATCH'].includes(req.method)) return next();
    const user = await sessionAccount(req);
    if (!user) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED' });
    if (req.get('X-Action-Account') && req.get('X-Action-Account') !== user.id)
      return res.status(409).json({ ok: false, code: 'ACTION_ACCOUNT_CHANGED' });
    let treeId = req.body?.treeId, nodeId = req.body?.nodeId, visibility = req.body?.visibility;
    if (req.method === 'PATCH') {
      const id = decodeURIComponent(req.path.slice(1));
      const old = readArray(path.join(config.dataDir, 'tutorials.json')).find(t => t.id === id && t.authorId === user.id && !t.archived);
      if (!old) return next(); // Existing route retains its author-only 404.
      treeId = old.treeId; nodeId = old.nodeId; visibility = visibility === undefined ? old.visibility : visibility;
    }
    if (visibility !== 'public') return next();
    let target = null;
    if (typeof nodeId === 'string' && nodeId.startsWith('review-visible-')) {
      const store = JSON.parse(fs.readFileSync(config.customNodesPath, 'utf8'));
      if (!Array.isArray(store.nodes) || !Array.isArray(store.trees)) throw Error('Unreadable target store');
      const node = store.nodes.find(n => n.id === nodeId && n.treeId === treeId);
      const tree = store.trees.find(t => t.id === treeId);
      if (!node || node.visibility !== 'public' || tree?.visibility !== 'public')
        return res.status(403).json({ ok: false, code: 'KNOWLEDGE_TARGET_UNAVAILABLE', message: '目标当前未公开，已停止公开教程，私人内容保留。' });
      target = disclosedTarget(node, tree);
    }
    const confirmed = readArray(config.recordsPath).some(r => r && r.authorId === user.id &&
      r.treeId === treeId && r.nodeId === nodeId && r.lightUp === true && typeof r.text === 'string' && r.text.trim() &&
      (!target || r.targetVersion === target.version && r.sourceSnapshot?.nodeVersion === target.sourceVersion &&
        r.sourceSnapshot.nodeTitle === target.title && r.sourceSnapshot.nodeGoal === target.goal));
    if (!confirmed && (target || !hasStoredActionConfirmation(config,user,treeId,nodeId))) return res.status(403).json({ ok: false, code: 'KNOWLEDGE_LIGHT_REQUIRED',
      message: '公开贡献前，需要本人先在同一目标留下确认点亮的实践记录。可以先保存私人方法。' });
    return next();
  } catch {
    return res.status(503).json({ ok: false, code: 'KNOWLEDGE_PUBLICATION_UNAVAILABLE',
      message: '暂时无法核对点亮与方法记录，已停止公开保存，原数据保留。' });
  }
}
module.exports = { checkPublication };
