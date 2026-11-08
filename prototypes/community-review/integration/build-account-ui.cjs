const fs = require('node:fs');
const path = require('node:path');
function transformAccountReview(source) {
  let js = source;
  const replace = (old, value) => { if (!js.includes(old)) throw Error('Account review source changed: ' + old.slice(0, 50)); js = js.replace(old, value); };
  replace("const KEY='dianliang-local-prototype-v1'", "const KEY='dianliang-service-review-v1'");
  js=js.replaceAll("['atlas','paths','contribute','governance']","['atlas','publicPractices','author','following','discover','savedTutorials','paths','contribute','governance']").replaceAll("['atlas','paths','contribute','governance','profile','account']","['atlas','publicPractices','author','following','discover','savedTutorials','paths','contribute','governance','profile','account']");
  replace("atlas:'知识图谱',paths:","atlas:'知识图谱',publicPractices:'公开实践',author:'作者主页',following:'关注的作者',discover:'发现',savedTutorials:'收藏教程',paths:");
  replace('atlas:atlasPage,paths:','atlas:atlasPage,publicPractices:reviewPublicPracticePage,author:reviewPublicAuthorPage,following:reviewFollowedAuthorsPage,discover:reviewCommunityPage,savedTutorials:reviewTutorialBookmarksPage,paths:');
  replace("navItem('atlas','知识图谱','atlas')+navItem('paths'","navItem('atlas','知识图谱','atlas')+(S.user?.reviewService?navItem('discover','发现','atlas')+navItem('savedTutorials','收藏教程','paths')+navItem('publicPractices','公开实践','records')+navItem('following','关注的作者','profile')+(reviewSelectedPublicAuthor()?navItem('author','作者主页','profile'):''):'')+navItem('paths'");
  replace("U.groups[id]=open;render()}", "U.groups[id]=open;render();document.querySelector('[data-action=\"group:'+id+'\"]')?.focus({preventScroll:true})}");
  replace("navItem('governance','共同治理','govern'):''}", "navItem('governance','共同治理','govern')+(S.user?.reviewService?'<a class=\"nav-item\" href=\"/knowledge/\">返回知识平台</a>':''):''}");
  replace('save();render();window.scrollTo(0,0)}', 'save();render();window.scrollTo(0,0);document.getElementById("main-content")?.focus({preventScroll:true})}');
  replace('function save(){let success=', 'function save(){reviewBeforeLocalSave();let success=');
  replace('return success}', 'if(success)reviewQueueRemote();return success}');
  replace('${esc(S.bio)}</p></div></header>', '${esc(S.bio)}</p></div></header>${S.user?.reviewService?reviewOwnProfileSummary(): ""}');
  replace('<div class="num">${S.nodes.flatMap(n=>n.methods.filter(m=>m.author===S.user.name)).length}</div><span class="muted small">贡献的方法</span>', '${S.user?.reviewService?reviewProfileMethodStat():`<div class="num">${S.nodes.flatMap(n=>n.methods.filter(m=>m.author===S.user.name)).length}</div><span class="muted small">贡献的方法</span>`}');
  replace('function accountPage(){', 'function accountPageBase(){');
  replace('function submitMethod(form,copy=false){', 'function submitMethodLocal(form,copy=false){');
  replace('function methodForm(n,existing=null){', 'function methodFormLocal(n,existing=null){');
  replace('默认保存为私人；公开前必须先确认点亮。', "${S.user.reviewService&&n.ownership==='personal'&&n.visibility==='private'?'目标仍为私人，方法仅对本人保存；目标分享需另行核对。':'默认保存为私人；公开前必须先确认点亮。'}");
  replace("btn('创建私人节点','new-node','primary'))+", "(btn('创建私人节点','new-node','primary')+reviewOwnVisibleTools()))+");
  replace("btn('选择并导出数据','export-data')", "btn('选择并导出数据','export-data')+reviewAccountExportTools()");
  replace('function handle(action){', 'function handleLocal(action){');
  replace("else if(a==='confirm-delete'){", "else if(a==='confirm-delete'&&S.user?.reviewService)reviewDeleteEvent(id);\n else if(a==='confirm-delete'){");
  replace("btn('删除本次模拟记录','confirm-delete:'", "btn(S.user.reviewService?'删除事件及服务关联记录':'删除本次模拟记录','confirm-delete:'");
  replace('将删除该事件及其笔记、关联点亮。子事件和计时保留', "${S.user.reviewService?'将删除本人服务中的事件、笔记、关联点亮、已保存知识实践及其回执':'将删除该事件及其笔记、关联点亮'}。子事件和计时保留");
  replace("return title('知识图谱','选择一个目标，查看方法，再开始实践。')+", "return title('知识图谱','选择一个目标，查看方法，再开始实践。',reviewPublicTargetTools())+");
  replace("else if(a==='share-node'){", "else if(a==='review-account-export')reviewExportAccountBundle(document.querySelector('[data-action=review-account-export]'));\n else if(a==='review-owned-practices')reviewOpenOwnedPractices();\n else if(a==='review-own-profile')reviewOpenOwnProfile();\n else if(a==='review-copy-target')reviewOpenCopiedPathTarget(id);\n else if(a==='review-edit-path-copy')reviewEditCopiedPath(id);\n else if(a==='review-bookmarked-target')reviewOpenBookmarkedPathTarget(id);\n else if(a==='review-remove-path-bookmark')reviewRemovePathBookmark(id);\n else if(a==='review-public-paths')reviewOpenPublicPaths();\n else if(a==='review-owned-paths')reviewOpenOwnedPaths();\n else if(a==='share-path'&&S.user?.reviewService)reviewOpenPathSharing(id);\n else if(a==='review-node-practices')reviewOpenTargetPractices({treeId:'dianliang-review-catalog-v1',nodeId:'od-'+id,title:node(id).title});\n else if(a==='review-public-practices')reviewOpenPublicPractices();\n else if(a==='review-public-search')reviewOpenPublicSearch();\n else if(a==='review-received-replies')reviewOpenReceivedReplies();\n else if(a==='review-owned-discussions')reviewOpenOwnedDiscussions();\n else if(a==='review-my-discussion-reports')reviewOpenMyDiscussionReports();\n else if(a==='review-owned-visible')reviewOpenOwnedVisible();\n else if(a==='review-visible-targets')reviewOpenVisibleTargets();\n else if(a==='share-node'){");
  replace("else if(a==='share-node'){", "else if(a==='share-node'&&S.user?.reviewService)reviewOpenTargetSharing(id);\n else if(a==='share-node'){");
  replace("${n.visibility==='public'?'公开模拟':'仅自己可见'}", "${S.user.reviewService?reviewTargetSharingStatus(n):(n.visibility==='public'?'公开模拟':'仅自己可见')}");
  replace('function navigate(page){', 'function navigateWithoutPathSelection(page){');
  replace("else if(a==='node'){", "else if(a==='node'){U.reviewPathSelection=null;");
  replace("S.paths.filter(p=>U.pathFilter!=='saved'||p.bookmarked).map", "S.paths.filter(p=>!p.targetRefs&&(U.pathFilter!=='saved'||p.bookmarked)).map");
  replace('function pathsPage(){', 'function pathsPageLocal(){');
  replace("btn('创建自己的路径','new-path','primary')", "btn('创建自己的路径','new-path','primary')+(S.user?.reviewService?btn('浏览服务公开路径','review-public-paths','ghost')+btn('我的路径分享与历史','review-owned-paths','ghost'):'')");
  replace("p.seed?'演示路径':p.visibility==='public'?'公开模拟':'私人路径'", "p.seed?'演示路径':S.user?.reviewService?'本人路径编排':p.visibility==='public'?'公开模拟':'私人路径'");
  replace("btn(p.visibility==='public'?'撤回公开模拟':'选择公开此路径','share-path:'", "btn(S.user?.reviewService?'分享与历史':p.visibility==='public'?'撤回公开模拟':'选择公开此路径','share-path:'");
  replace("btn(n.visibility==='public'?'撤回公开':'选择公开','share-node:'", "btn(S.user.reviewService?reviewTargetSharingLabel(n):(n.visibility==='public'?'撤回公开模拟':'选择公开'),'share-node:'");
  replace("${btn('修订目标','edit-node:'+n.id,'ghost')}", "${btn('修订目标','edit-node:'+n.id,'ghost')}${S.user.reviewService&&n.visibility==='private'?btn('保存私人目标到服务','review-private-target:'+n.id,'ghost'):''}");
  replace('${n.versions?.length?', '${S.user.reviewService?`<p class="small muted">${reviewPrivateTargetStatus(n)}</p>`:""}${n.versions?.length?');
  replace("${btn('调整本次笔记','edit-event-note:'+e.id)}", "${btn('调整本次笔记','edit-event-note:'+e.id)}${S.user.reviewService&&e.knowledge?btn('保存实践到知识服务','review-practice-open:'+e.id):''}");
  replace("${btn('查看事件记录','report-history')}", "${btn('查看事件记录','report-history')}${S.user.reviewService&&e.knowledge?btn('保存实践到知识服务','review-practice-open:'+e.id):''}");
  replace("${btn('查看实践记录','event-detail:'+l.eventId,'ghost')}", "${btn('查看实践记录','event-detail:'+l.eventId,'ghost')}${S.user.reviewService?btn('保存实践到知识服务','review-practice-open:'+l.eventId,'ghost'):''}");
  replace("${l.public?'公开模拟':'仅自己可见'}", "${S.user.reviewService?reviewPracticeLightStatus(l):(l.public?'公开模拟':'仅自己可见')}");
  replace("btn(l.public?'撤回公开':'选择公开证据','share-light:'", "btn(S.user.reviewService?reviewPracticeShareLabel(l):(l.public?'撤回公开':'选择公开证据'),'share-light:'");
  replace('我选择公开此证据（仅本地模拟）', "${S.user.reviewService?'选择分享意愿（仍需单独提交到服务）':'我选择公开此证据（仅本地模拟）'}");
  replace("toast('已保存本人自证；没有上传或自动判定掌握。')", "toast(S.user.reviewService?'自证已留在本人档案，公开分享需另行提交。':'已保存本人自证；没有上传或自动判定掌握。')");
  replace('methods=n.methods;return', 'methods=reviewAvailableMethods(n);return');
  replace('${esc(m.author)} · v${v.number} ·', '${esc(m.author)} · ${m.serviceReference?`服务版本 ${esc(m.serviceReference.version.slice(0,8))}`:`v${v.number}`} ·');
  replace('<p class="small muted">先试试，需要时再展开。</p>', '<p class="small muted">先试试，需要时再展开。</p>${reviewSharedTools(n)}${S.user?.reviewService&&n.ownership===\'group\'&&n.visibility===\'public\'?btn(\'查看该目标的公开实践\',\'review-node-practices:\'+n.id,\'ghost\'):\'\'}');
  replace('${v.resource?`<p class="pre small">资料 / 产品地址：', '${reviewSharedResources(v)}${v.resource?`<p class="pre small">资料 / 产品地址：');
  replace("${e.knowledge.version!=null?' v'+esc(e.knowledge.version):''}", "${e.knowledge.serviceReference?' 服务版本 '+esc(String(e.knowledge.serviceReference.version||'待核对').slice(0,8)):(e.knowledge.version!=null?' v'+esc(e.knowledge.version):'')} ${e.knowledge.methodAuthor?' · '+esc(e.knowledge.methodAuthor):''}");
  replace('${e.knowledge.resource?`<p class="pre small">当时资料地址：', '${reviewSharedResources(e.knowledge)}${e.knowledge.resource?`<p class="pre small">当时资料地址：');
  replace("resource:v?.resource||'',...(v?.resourceLinks?{resourceLinks:clone(v.resourceLinks)}:{})}});toast", "resource:v?.resource||'',nodeDomain:n.domain,nodeBranch:n.branch,nodeOwnership:n.ownership,nodeVisibility:n.visibility,...(v?.resourceLinks?{resourceLinks:clone(v.resourceLinks)}:{}),...(m?.serviceReference?{serviceReference:clone(m.serviceReference),methodAuthor:m.author}:{})}});toast");
  replace('${esc(e.knowledge.methodTitle)} v${e.knowledge.version}</p>', '${esc(e.knowledge.methodTitle)} ${e.knowledge.serviceReference?`服务版本 ${esc(String(e.knowledge.serviceReference.version||"待核对").slice(0,8))}`:(e.knowledge.version==null?"":`v${e.knowledge.version}`)}</p>${S.user.reviewService&&e.knowledge.serviceReference&&!S.nodes.find(n=>n.id===e.knowledge.nodeId)?.methods.find(m=>m.id===e.knowledge.methodId)?.serviceBinding?btn(\'重试关联服务引用\',\'review-shared-bind:\'+e.id,\'ghost\'):""}');
  replace("toast('方法已本地保存，过去实践的快照保留。')}", "toast('方法已本地保存，过去实践的快照保留。');return existing||n.methods.at(-1)}");
  replace("else if(a==='share-method'){", "else if(a==='review-method-open')reviewOpenMethodPublication(id,x,action.split(':')[3]||'public');\n else if(a==='review-method-refresh'){const p=reviewMethodPlan;if(p)reviewOpenMethodPublication(p.nid,p.mid,document.querySelector('#review-method-publish-form select')?.value||p.wanted)}\n else if(a==='share-method'&&S.user?.reviewService)reviewOpenMethodPublication(id,x,'public');\n else if(a==='share-method'){");
  replace("else if(a==='method-draft-retry')", "else if(a==='review-sync-compare')reviewOpenConflict();\n else if(a==='review-resolve-local')reviewResolveConflict('local');\n else if(a==='review-resolve-remote')reviewResolveConflict('remote');\n else if(a==='review-archive-local')reviewExportArchive(id,'local');\n else if(a==='review-archive-remote')reviewExportArchive(id,'remote');\n else if(a==='method-draft-retry')");
  replace("else if(a==='method-draft-retry')", "else if(a==='review-sync-retry')reviewRetryState();\n else if(a==='review-sync-export')download('点亮-未同步行动备份.json',{format:'dianliang-local-backup/v1',data:portableData(S)});\n else if(a==='review-sync-remote'){reviewClient.readRemote().then(value=>download('点亮-服务器行动版本.json',value)).catch(error=>toast(error.message))}\n else if(a==='method-draft-retry')");
  const match = js.match(/^ on\('auth-form','submit',[^\n]+/m);
  if (!match) throw Error('Account submit handler missing');
  replace(match[0], " on('auth-form','submit',reviewAuthSubmit);");
  replace("if(!value.user.example&&!value.accounts.some", "if(!value.user.example&&!value.user.reviewService&&!value.accounts.some");
  replace("else if(a==='logout'){pause();", "else if(a==='logout'&&S.user?.reviewService)reviewLogout();\n else if(a==='logout'){pause();");
  replace("else if(a==='change-password'){if(S.user.example)", "else if(a==='change-password'){if(S.user.reviewService){toast('服务账号的密码修改尚未接入此试验界面。');return}if(S.user.example)");
  replace("async function verifyPassword(pwd){const a=", "async function verifyPassword(pwd){if(S.user?.reviewService){const context=reviewContext();try{const r=await reviewAccountRequest('/api/review-password-check',{password:pwd},{'X-Action-Account':context.ownerId});return reviewContextCurrent(context)&&r.verified===true&&r.userId===context.ownerId}catch{return false}}const a=");
  replace('normalize();render();updateStorageStatus();', fs.readFileSync(path.join(__dirname, 'review-sync-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-conflict-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-account-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-method-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-practice-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-shared-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-private-target-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-target-sharing-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-visible-targets-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-discussion-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-owned-practices-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-profile-methods-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-own-profile-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-public-author-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-author-follow-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-tutorial-bookmarks-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-path-copy-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-path-bookmarks-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-path-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-public-practices-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-public-search-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-account-export-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-received-replies-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-owned-discussion-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-owned-visible-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-visible-contribution-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-visible-method-runtime.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'review-event-deletion-runtime.js'), 'utf8') + '\nreviewAccountBoot();');
  replace("${m.visibility==='public'?'公开模拟':'私人保存'}", "${S.user.reviewService?reviewMethodStatus(m):(m.visibility==='public'?'公开模拟':'私人保存')}");
  replace("${m.visibility==='public'?'公开演示':'私人草稿'}", "${S.user.reviewService?reviewMethodStatus(m):(m.visibility==='public'?'公开演示':'私人草稿')}");
  replace("btn(m.visibility==='public'?'撤回公开':'选择公开','share-method:'", "btn(S.user.reviewService?(n.ownership==='personal'&&n.visibility==='private'?'保存私人方法到服务':'保存 / 发布到服务'):(m.visibility==='public'?'撤回公开':'选择公开'),'share-method:'");
  replace('主动选择公开模拟（需本人已点亮）', "${S.user.reviewService?'保存后核对公开到知识服务':'主动选择公开模拟（需本人已点亮）'}");
  js=js.replace('独立原型 · 本地模拟账户','独立接入试验 · 服务账号')
    .replace('验证本地模拟密码','验证账号密码')
    .replace('本次历史需要验证模拟密码','本次历史需要验证账号密码')
    .replace('<span class="tag">本地模拟</span>', '<span class="tag">${S.user.example?\'示例模式\':\'独立服务预览\'}</span>')
    .replace('你决定什么留在这里、什么可以共享。所有开关均为本地模拟。','行动档案、教程与社区审核连接独立测试服务。支付功能仍为模拟。')
    .replace('仅本机认证，不是生产安全账户。退出时冻结活动段，未结束记录保留。','${S.user.example?\'示例模式只使用本机数据。\':\'使用独立服务账号，行动档案同步到本人账户。\'}退出时冻结活动段，未结束记录保留。')
    .replace("btn('修改模拟密码','change-password'", "btn(S.user.reviewService?'修改密码':'修改模拟密码','change-password'")
    .replace('查看历史详情前验证模拟密码','查看历史详情前验证${S.user.reviewService?\'账号密码\':\'模拟密码\'}')
    .replace('个人介绍已本地保存。','个人介绍已更新。')
    .replace('名字与密码仅用于本浏览器演示，请使用模拟信息。','使用独立测试服务保存行动、发布教程和参与讨论。支付功能仍为模拟。')
    .replace("${S.user.example?'示例模式':'模拟名字 / 密码'}", "${S.user.example?'示例模式':'独立服务账号'}")
    .replace('同步：未连接。没有真实服务器，所有保存均在本浏览器。','已连接独立本地服务。保存失败时保留本机编辑，可重试和导出。')
    .replaceAll("S.user.example?'示例模式':'本地模拟账户'", "S.user.example?'示例模式':'服务账号'")
    .replaceAll("S.user?.example?'示例模式':'本地模拟账户'", "S.user?.example?'示例模式':'服务账号'")
    .replaceAll('minlength="4"','minlength="8"');
  return js;
}
module.exports = { transformAccountReview };
