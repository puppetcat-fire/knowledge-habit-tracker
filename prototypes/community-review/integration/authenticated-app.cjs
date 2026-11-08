const express = require('express');
const path = require('node:path');
const { createApp } = require('../../../server');
const { installActionStateRoutes } = require('./action-state.cjs');
const { buildReviewAssets } = require('./build-ui.cjs');
const { checkPublication } = require('./knowledge-publication-gate.cjs');
const { installCatalog } = require('./knowledge-catalog.cjs');
const { installMethodBindingRoutes } = require('./knowledge-binding-store.cjs');
const { installReviewPracticeRoutes } = require('./knowledge-practice-store.cjs');
const { installMethodPublicationRoutes } = require('./knowledge-method-publication.cjs');
const { installSharedMethodRoutes } = require('./knowledge-shared-methods.cjs');
const { installPrivateTargetRoutes } = require('./knowledge-private-targets.cjs');
const { installPasswordCheck } = require('./password-check.cjs');
const { installTargetSharing } = require('./knowledge-target-sharing.cjs');
const { installVisibleTargets,installVisibleTargetRead } = require('./knowledge-visible-targets.cjs');
const { installHistoricalPracticeRead } = require('./historical-practice-read.cjs');
const { installEventDeletion } = require('./event-deletion.cjs');
const { installVisibleTargetTutorials } = require('./visible-target-tutorials.cjs');
const { installOwnedTutorialHistory } = require('./owned-tutorial-history.cjs');
const { installReviewAccountExport } = require('./review-account-export.cjs');
const { installPublicPractices } = require('./public-practices.cjs');
const { installOwnProfile } = require('./own-profile.cjs');
const { installPublicTutorialSearch } = require('./public-tutorial-search.cjs');
const {installPathPublications}=require('./knowledge-path-publications.cjs');
const { installTutorialDiscussion } = require('./tutorial-discussion.cjs');
const {installFollowingFeed}=require('./following-feed.cjs');

function createAuthenticatedActionApp(overrides = {}) {
  const dataDir = overrides.dataDir || path.join(__dirname, 'preview-data');
  const existing = createApp({ ...overrides, dataDir, communityEnabled: true });
  const sessionAccount = async req => existing.resolveSession(req);
  installCatalog(existing.config.customNodesPath);
  const app = express(), account = Symbol('verified-action-account');
  app.disable('x-powered-by');
  if(existing.config.trustProxy)app.set('trust proxy',existing.config.trustProxy);
  app.use('/api/review-tutorial-discussions',(_req,res,next)=>{
    res.set('Cache-Control','no-store');
    next();
  });
  app.use('/api/',(req,res,next)=>{const origin=req.get('origin');if(origin&&origin!==req.protocol+'://'+req.get('host')&&!existing.config.allowedOrigins.includes(origin))return res.status(403).json({ok:false,code:'ORIGIN_NOT_ALLOWED'});next()},existing.limitApiRequest);
  app.use(['/api/action-state','/api/review-method-bindings','/api/review-practices','/api/review-method-publications','/api/review-shared-methods','/api/review-private-targets','/api/review-password-check','/api/review-target-sharing','/api/review-visible-targets','/api/review-event-deletion','/api/review-path-publications','/api/review-public-paths'], (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}` && !existing.config.allowedOrigins.includes(origin))
      return res.status(403).json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  }, express.json({ limit: existing.config.bodyLimit }), async (req, res, next) => {
    try {
      req[account] = await sessionAccount(req);
      if (!req[account]) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED' });
      next();
    } catch { return res.status(503).json({ ok: false, code: 'ACCOUNT_SERVICE_UNAVAILABLE' }); }
  });
  installActionStateRoutes(app, { directory: path.join(dataDir, 'action-states'), authenticate: req => req[account] || null });
  app.use(['/api/review-community-feed','/api/review-following-feed','/api/review-public-practices','/api/review-own-profile','/api/review-owned-tutorials','/api/review-account-export','/api/review-public-tutorials','/api/review-tutorial-discussions','/api/review-owned-discussions','/api/review-received-replies'], (req,res,next)=>{
    const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`&&!existing.config.allowedOrigins.includes(origin))return res.status(403).json({ok:false,code:'ORIGIN_NOT_ALLOWED'});
    res.set('X-Content-Type-Options','nosniff');next();
  },express.json({limit:existing.config.bodyLimit}),async(req,res,next)=>{try{req[account]=await sessionAccount(req);if(!req[account])return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});next()}catch{return res.status(503).json({ok:false,code:'ACCOUNT_SERVICE_UNAVAILABLE'})}});
  installOwnedTutorialHistory(app,{config:existing.config,authenticate:req=>req[account]||null});
  installFollowingFeed(app,{config:existing.config,authenticate:req=>req[account]||null});
  installPublicPractices(app,{config:existing.config,authenticate:req=>req[account]||null});
  installOwnProfile(app,{config:existing.config,authenticate:req=>req[account]||null});
  installPublicTutorialSearch(app,{config:existing.config,authenticate:req=>req[account]||null});
  installTutorialDiscussion(app,{config:existing.config,authenticate:req=>req[account]||null,moderatorIds:overrides.discussionModeratorIds,commit:overrides.discussionModerationCommit});
  installReviewAccountExport(app,{config:existing.config,authenticate:req=>req[account]||null,legacyApp:existing.app});
  installPasswordCheck(app,{config:existing.config,authenticate:req=>req[account]||null,sessionAccount});
  installTargetSharing(app,{config:existing.config,authenticate:req=>req[account]||null});
  installVisibleTargets(app,{config:existing.config,authenticate:req=>req[account]||null});
  installVisibleTargetRead(app,{config:existing.config,authenticate:req=>req[account]||null});
  installHistoricalPracticeRead(app,{config:existing.config,sessionAccount});
  installEventDeletion(app,{config:existing.config,authenticate:req=>req[account]||null,commit:overrides.eventDeletionCommit});
  installPathPublications(app,{config:existing.config,authenticate:req=>req[account]||null});
  installMethodBindingRoutes(app, { config: existing.config, authenticate: req => req[account] || null });
  installReviewPracticeRoutes(app, { config: existing.config, authenticate: req => req[account] || null, commit: overrides.practiceCommit });
  installMethodPublicationRoutes(app, { config: existing.config, authenticate: req => req[account] || null, commit: overrides.methodPublicationCommit });
  installSharedMethodRoutes(app, { config: existing.config, authenticate: req => req[account] || null });
  installPrivateTargetRoutes(app, { config: existing.config, authenticate: req => req[account] || null, commit: overrides.privateTargetCommit });
  app.post('/api/logout',async(req,res,next)=>{const expected=req.get('X-Action-Account');if(!expected)return next();try{const user=await sessionAccount(req);if(!user||user.id!==expected)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED',message:'服务账号已变化，未退出其他账号；请先核对。'});return next()}catch{return res.status(503).json({ok:false,code:'ACCOUNT_SERVICE_UNAVAILABLE'})}});
  app.use('/api/tutorials', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}` && !existing.config.allowedOrigins.includes(origin))
      return res.status(403).json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    next();
  }, express.json({ limit: existing.config.bodyLimit }), (req, res, next) =>
    checkPublication(req, res, next, { config: existing.config, sessionAccount }));
  installVisibleTargetTutorials(app,{config:existing.config,authenticate:req=>req[account]||null,sessionAccount});
  const review = buildReviewAssets(overrides.reviewDirectory);
  app.get(/^\/review$/, (req, res) => res.redirect('/review/'));
  for (const [route, file] of [['/review/', 'index.html'], ['/review/review.css', 'review.css'], ['/review/review.js', 'review.js'], ['/review/action-client.js', 'action-client.js'], ['/review/manifest.json', 'manifest.json']]) {
    app.get(route, (req, res) => res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:;",
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }).sendFile(path.join(review.destination, file)));
  }
  // Existing account endpoints and assets are a fallback; the new state route
  // is independent of the legacy client/state format and directory.
  app.use(existing.app);
  app.use((error, req, res, next) => {
    void req; void next;
    const status = error.type === 'entity.too.large' ? 413 : 400;
    res.status(status).json({ ok: false, code: 'ACTION_REQUEST_INVALID' });
  });
  return { app, config: existing.config };
}
module.exports = { createAuthenticatedActionApp };
