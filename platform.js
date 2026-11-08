(function bootstrapPlatform() {
  const STORAGE_KEY = "knowledge-habit-tracker";
  const CUSTOM_NODES_KEY = "knowledge-habit-custom-nodes";
  const CUSTOM_HABIT_NAME = "自由记录";
  const TREE_FORMAT = "forest-tree/v1";
  const STATE_VERSION = 3;
  // 「去做」把这次瞄准交回习惯服务：习惯页固定跑在本地服务的根路径上
  const HABIT_ORIGIN = (globalThis.KHTRuntime && globalThis.KHTRuntime.habitUrl || "http://127.0.0.1:3000/").replace(/\/$/, "");
  if (globalThis.KHTRuntime && globalThis.KHTRuntime.habitUrl) document.querySelector(".platform-link").href = globalThis.KHTRuntime.habitUrl;

  // 平台页自身可以单文件运行；LOCAL_ONLY 时不连服务端，与 app.js 的约定一致
  const LOCAL_ONLY = globalThis.__KHT_LOCAL_ONLY__ === true;
  const communityLink = document.getElementById("platform-community-link");
  if (communityLink && !LOCAL_ONLY && globalThis.KHTRuntime?.communityUrl === "/review/") {
    communityLink.classList.remove("hidden");
  }

  const defaultState = {
    version: STATE_VERSION,
    habit: null,
    habitHistory: [],
    events: [],
    timer: {
      elapsedMs: 0,
      running: false,
      startedAt: null,
      predictedAction: "",
      selectedOption: "custom",
      selectedHabitId: null,
      selectedHabitName: CUSTOM_HABIT_NAME
    },
    settings: {
      hubConnected: false,
      lastBackupAt: null
    },
    forest: {
      activeTreeId: null,
      selectedNodeId: null,
      selectedNodeAt: null,
      lightups: []
    }
  };

  let state = null;
  let platformBooted = false;
  let platformRecordsRequest = 0;
  let platformRecordsRevision = 0;
  let platformRecordsLoad = null;
  // seedTrees 是种子原样，mergedTrees 是叠加个人节点后的结果；布局与索引都读后者
  let seedTrees = [];
  let mergedTrees = [];
  let overlay = { nodes: [], edges: [] };
  let currentUser = LOCAL_ONLY ? { id: "local", name: "我" } : null;
  let stateSync = null;
  globalThis.KHTBackupContext = { localOnly: LOCAL_ONLY || window.location.protocol === "file:", flush: () => stateSync ? stateSync.flush() : Promise.resolve(true), get ownerId() { return currentUser?.id; }, get revision() { return stateSync?.revision; } };
  let handoffBusy = false;
  let nodeIndex = new Map();
  let tutorialIndex = new Map();
  let platformRecords = [];
  let localPracticeRecords = [];
  const publishingLightups = new Set();
  // 折叠只存在内存里：展开教程不写 localStorage，也不写服务端
  const expandedTutorialIds = new Set();
  let detailNode = null;
  let linkedTutorial = null;
  let detailEditing = false;
  let composerOpen = false;
  let composerKind = "prereq";
  let userTutorials = [];
  let tutorialEditor = null;
  let tutorialSaving = false;
  let practiceSaving = false;
  const savingRecordVisibility = new Set();
  const practiceRequests = new WeakMap();
  let browsingTreeId = null;
  let treeComposerOpen = false;
  let mapZoom = null;
  globalThis.KHTProfileContext = {
    getUser: () => currentUser,
    localOnly: LOCAL_ONLY,
    nodeTitle: (treeId, nodeId) => { const node = getNodeById(treeId, nodeId); return node ? node.title : null; },
    getLocal: () => ({ user: currentUser, own: true, profile: JSON.parse(localStorage.getItem("knowledge-habit-profile") || "null") || {}, methods: userTutorials, records: localPracticeRecords, nodes: overlay.nodes, holdings: overlay.nodes.map((node) => ({ treeId: node.treeId, nodeId: node.id, title: node.title, ownership: "personal" })), stats: { events: state.events.length, measuredMs: state.events.reduce((sum, event) => sum + (event.durationMs || 0), 0) } }),
    openNode: (treeId, nodeId) => { browsingTreeId = treeId; render(); openPlatformDetail(treeId, nodeId); if (!LOCAL_ONLY) void loadPlatformRecords(); },
    refreshMap: () => render()
  };

  const elements = {
    platformRoot: document.getElementById("platform-root"),
    platformFeed: document.getElementById("platform-feed"),
    platformDetail: document.getElementById("platform-detail"),
    platformDetailBack: document.getElementById("platform-detail-back"),
    platformDetailBody: document.getElementById("platform-detail-body")
  };

  function bootPlatform() {
    if (LOCAL_ONLY) {
      try { userTutorials = JSON.parse(localStorage.getItem("knowledge-habit-tutorials") || "[]"); } catch { userTutorials = []; }
      if (!Array.isArray(userTutorials)) userTutorials = [];
      try { localPracticeRecords = JSON.parse(localStorage.getItem("knowledge-habit-practice-records") || "[]"); } catch { localPracticeRecords = []; }
      if (!Array.isArray(localPracticeRecords)) localPracticeRecords = [];
    }
    if (LOCAL_ONLY) {
      overlay = loadLocalOverlay();
    }
    rebuildIndexes();
    bindEvents();
    render();
  }

  // 个人节点并进种子树后再建索引；布局数学只认合并后的树
  function rebuildIndexes() {
    seedTrees = loadSeedTrees();
    mergedTrees = mergeCustomNodes(seedTrees, overlay);
    nodeIndex = buildNodeIndex(mergedTrees);
    tutorialIndex = buildTutorialIndex(mergedTrees);
    userTutorials.forEach((tutorial) => {
      if (tutorial.archived) return;
      const key = `${tutorial.treeId}::${tutorial.nodeId}`;
      tutorialIndex.set(key, (tutorialIndex.get(key) || []).concat(tutorial));
    });
  }

  function mergeCustomNodes(trees, customOverlay) {
    const nodes = customOverlay && Array.isArray(customOverlay.nodes) ? customOverlay.nodes : [];
    const edges = customOverlay && Array.isArray(customOverlay.edges) ? customOverlay.edges : [];
    return trees.map((tree) => {
      const treeId = tree.tree ? tree.tree.id : null;
      const addedNodes = nodes.filter((node) => node && node.treeId === treeId);
      const addedIds = new Set(addedNodes.map((node) => node.id));
      const addedEdges = edges.filter((edge) => edge && (addedIds.has(edge.from) || addedIds.has(edge.to)));
      return {
        ...tree,
        nodes: (Array.isArray(tree.nodes) ? tree.nodes : []).concat(addedNodes),
        edges: (Array.isArray(tree.edges) ? tree.edges : []).concat(addedEdges)
      };
    });
  }

  function loadLocalOverlay() {
    try {
      const raw = window.localStorage.getItem(CUSTOM_NODES_KEY);
      if (!raw) {
        return { nodes: [], edges: [] };
      }
      const parsed = JSON.parse(raw);
      return {
        nodes: parsed && Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: parsed && Array.isArray(parsed.edges) ? parsed.edges : [],
        trees: parsed && Array.isArray(parsed.trees) ? parsed.trees : []
      };
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  function saveLocalOverlay() {
    window.localStorage.setItem(CUSTOM_NODES_KEY, JSON.stringify(overlay));
  }

  function bindEvents() {
    elements.platformRoot.addEventListener("click", handlePlatformActions);
    elements.platformDetailBack.addEventListener("click", () => {
      closePlatformDetail();
      elements.platformFeed.querySelector('[data-action="map-fit"]')?.focus();
    });
    document.getElementById("tree-select").addEventListener("change", (event) => {
      browsingTreeId = event.target.value;
      mapZoom = null;
      closePlatformDetail();
      platformRecords = [];
      render();
      if (!LOCAL_ONLY) void loadPlatformRecords();
    });
  }

  function handlePlatformActions(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === "tree-create" || action === "platform-create-open") button.closest(".workspace-tools")?.removeAttribute("open");
    if (action === "map-zoom") {
      mapZoom = Math.max(0.25, Math.min(1.6, (mapZoom || 0.65) + Number(button.dataset.step)));
      renderPlatformFeed();
      return;
    }
    if (action === "map-fit") { mapZoom = null; renderPlatformFeed(); return; }
    if (action === "tree-create") {
      treeComposerOpen = true;
      composerOpen = false;
      renderPlatformDetail();
      elements.platformDetail.classList.remove("hidden");
    } else if (action === "tree-save") {
      void createKnowledgeTree();
    } else if (action === "tutorial-toggle") {
      toggleTutorial(button.dataset.tutorialId);
    } else if (action === "platform-view") {
      openPlatformDetail(button.dataset.treeId, button.dataset.nodeId);
    } else if (action === "platform-do") {
      void aimAndGo(button.dataset.treeId, button.dataset.nodeId);
    } else if (action === "platform-submit") {
      void submitPracticeRecord();
    } else if (action === "platform-records-retry") {
      void loadPlatformRecords();
    } else if (action === "record-method") {
      void showHistoricMethod(button);
    } else if (action === "platform-confirm") {
      void confirmLightUp(button.dataset.id, button.dataset.visibility === "public");
    } else if (action === "platform-delete") {
      deleteLightUp(button.dataset.id);
    } else if (action === "platform-create-open") {
      openNodeComposer();
    } else if (action === "platform-create-kind") {
      setComposerKind(button.dataset.kind);
    } else if (action === "platform-create-submit") {
      void submitNodeComposer();
    } else if (action === "platform-edit-open") {
      detailEditing = true;
      renderPlatformDetail();
    } else if (action === "platform-edit-save") {
      void saveNodeEdit();
    } else if (action === "platform-edit-cancel") {
      detailEditing = false;
      renderPlatformDetail();
    } else if (action === "platform-node-delete") {
      void deleteNode();
    } else if (action === "tutorial-create") {
      tutorialEditor = { id: null };
      renderPlatformDetail();
    } else if (action === "tutorial-edit") {
      tutorialEditor = userTutorials.find((item) => item.id === button.dataset.id) || null;
      renderPlatformDetail();
    } else if (action === "tutorial-cancel") {
      tutorialEditor = null;
      renderPlatformDetail();
    } else if (action === "tutorial-save") {
      void saveTutorial();
    } else if (action === "tutorial-archive") {
      void archiveTutorial(button);
    } else if (action === "tutorial-use" && detailNode) {
      void useTutorialCard(button);
    } else if (action === "linked-tutorial-use") {
      void useLinkedTutorial(button);
    } else if (action === "record-visibility") {
      void setRecordVisibility(button);
    }
  }

  function render(recordsOnly = false) {
    const treeSelect = document.getElementById("tree-select");
    treeSelect.innerHTML = mergedTrees.map((tree) => `<option value="${escapeAttribute(tree.tree.id)}">${escapeHtml(tree.tree.name || tree.tree.id)}</option>`).join("");
    const activeTree = getActiveTree();
    if (activeTree) treeSelect.value = activeTree.tree.id;
    const visibleRecords = LOCAL_ONLY ? localPracticeRecords : platformRecords;
    const methodIds = new Set(mergedTrees.flatMap((tree) => tree.tutorials || []).concat(userTutorials).map((method) => method.id));
    document.getElementById("atlas-stats").innerHTML = `<div><strong>${nodeIndex.size}</strong><span>知识目标</span></div><div><strong>${visibleRecords.length + state.forest.lightups.filter((item) => !visibleRecords.some((record) => record.eventId && record.eventId === item.eventId && (LOCAL_ONLY || record.authorId === currentUser.id))).length}</strong><span>可见实践</span></div><div><strong>${methodIds.size}</strong><span>可用方法</span></div>`;
    renderNextAction();
    renderPlatformFeed();
    if (recordsOnly) renderDetailRecords();
    else renderPlatformDetail();
  }

  function renderNextAction() {
    const container = document.getElementById("next-action");
    const practice = (LOCAL_ONLY ? localPracticeRecords : platformRecords).filter((record) => record.lightUp && (LOCAL_ONLY || record.authorId === currentUser.id)).map((record) => ({ treeId: record.treeId, nodeId: record.nodeId, status: "confirmed", confirmedAt: record.createdAt }));
    const suggestion = globalThis.KHTProductRules.recommendNextAction(getActiveTree(), { ...state.forest, lightups: state.forest.lightups.concat(practice) });
    container.classList.toggle("hidden", !suggestion);
    if (!suggestion) { container.innerHTML = ""; return; }
    container.innerHTML = `
      <div>
        <span class="next-action-label">接下来 5 分钟</span>
        <strong>${escapeHtml(suggestion.title)}</strong>
        <p>${escapeHtml(suggestion.reason)} · 完整目标约 ${escapeHtml(String(suggestion.estMinutes))} 分钟</p>
        <p>${escapeHtml(suggestion.verifyHint || suggestion.goal)}</p>
      </div>
      <div class="next-action-buttons">
        <button class="ghost-button" type="button" data-action="platform-view" data-tree-id="${escapeAttribute(suggestion.treeId)}" data-node-id="${escapeAttribute(suggestion.nodeId)}">看看目标</button>
        <button class="primary" type="button" data-action="platform-do" data-tree-id="${escapeAttribute(suggestion.treeId)}" data-node-id="${escapeAttribute(suggestion.nodeId)}">去做</button>
      </div>`;
  }

  function renderPlatformFeed() {
    if (nodeIndex.size === 0) {
      elements.platformFeed.innerHTML = createEmptyCard("还没有可浏览的内容。");
      return;
    }
    const tree = getActiveTree();
    if (!tree) {
      elements.platformFeed.innerHTML = createEmptyCard("还没有可浏览的内容。");
      return;
    }
    elements.platformFeed.innerHTML = `<div class="map-heading"><div><span class="eyebrow">${escapeHtml(tree.tree.name || tree.tree.id)}</span><h3>先修关系与实例关系，连接理解和实践</h3></div><div class="map-tools"><button class="ghost-button" data-action="map-zoom" data-step="-0.15" aria-label="缩小图谱">−</button><button class="ghost-button" data-action="map-fit">全览</button><button class="ghost-button" data-action="map-zoom" data-step="0.15" aria-label="放大图谱">＋</button></div></div><div class="map-viewport">${buildTreeLayout(tree)}</div><p class="map-footnote"><span class="live-dot"></span>光来自真实的实践。尚未点亮的节点，也为下一次尝试留着位置。</p>`;
  }

  // 二维平面：prereq 决定列与顺序，instance-of 的实例挂在原理右下角
  function buildTreeLayout(tree) {
    const NODE_WIDTH = 168;
    const NODE_HEIGHT = 88;
    const COLUMN_GAP = 264;
    const ROW_GAP = 124;
    const PAD_LEFT = 28;
    const PAD_TOP = 56;
    const PLANE_PAD = 28;

    const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
    const edges = Array.isArray(tree.edges) ? tree.edges : [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const prereqEdges = [];
    const instanceEdges = [];
    edges.forEach((edge) => {
      if (!edge || !byId.has(edge.from) || !byId.has(edge.to)) {
        return;
      }
      if (edge.type === "instance-of") {
        instanceEdges.push(edge);
      } else if (edge.type === "prereq") {
        prereqEdges.push(edge);
      }
    });

    // 实例节点不进 prereq 的列，只在原理节点右下方单独摆位
    const instanceIds = new Set(instanceEdges.map((edge) => edge.from));
    const prereqNodes = nodes.filter((node) => !instanceIds.has(node.id));

    // rank = 1 + 前置 rank 最大值；无前置入边则为 0
    const rankOf = new Map();
    function resolveRank(nodeId, visiting) {
      if (rankOf.has(nodeId)) {
        return rankOf.get(nodeId);
      }
      if (visiting.has(nodeId)) {
        return 0;
      }
      visiting.add(nodeId);
      let rank = 0;
      prereqEdges.forEach((edge) => {
        if (edge.to === nodeId) {
          rank = Math.max(rank, resolveRank(edge.from, visiting) + 1);
        }
      });
      rankOf.set(nodeId, rank);
      return rank;
    }
    prereqNodes.forEach((node) => resolveRank(node.id, new Set()));

    const maxRank = prereqNodes.reduce((max, node) => Math.max(max, rankOf.get(node.id) || 0), 0);
    const columns = [];
    for (let rank = 0; rank <= maxRank; rank += 1) {
      columns[rank] = [];
    }
    prereqNodes.forEach((node) => {
      columns[rankOf.get(node.id) || 0].push(node);
    });

    // 列从左到右摆放；同列按前置 y 的平均值排序，无前置则保持原始顺序
    const position = new Map();
    for (let rank = 0; rank <= maxRank; rank += 1) {
      const column = columns[rank];
      if (!column.length) {
        continue;
      }
      const ordered = column
        .map((node, index) => ({ node, index, key: averagePredecessorY(node.id) }))
        .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key - b.key));
      ordered.forEach((entry, row) => {
        position.set(entry.node.id, {
          x: PAD_LEFT + rank * COLUMN_GAP,
          y: PAD_TOP + row * ROW_GAP
        });
      });
    }

    function averagePredecessorY(nodeId) {
      let sum = 0;
      let count = 0;
      prereqEdges.forEach((edge) => {
        if (edge.to !== nodeId) {
          return;
        }
        const from = position.get(edge.from);
        if (!from) {
          return;
        }
        sum += from.y;
        count += 1;
      });
      return count ? sum / count : 0;
    }

    // 实例放在原理右下方的空档里，不压住原理，也不占后置那一列
    const siblingIndex = new Map();
    instanceEdges.forEach((edge) => {
      const principle = position.get(edge.to);
      if (!principle) {
        return;
      }
      const index = siblingIndex.get(edge.to) || 0;
      siblingIndex.set(edge.to, index + 1);
      position.set(edge.from, {
        x: principle.x + NODE_WIDTH + 32,
        y: principle.y + NODE_HEIGHT + 24 + index * (NODE_HEIGHT + 16)
      });
    });

    const placedIds = Array.from(position.keys());
    for (let pass = 0; pass < 40; pass += 1) {
      let moved = false;
      for (let i = 0; i < placedIds.length; i += 1) {
        for (let j = i + 1; j < placedIds.length; j += 1) {
          const leftId = placedIds[i];
          const rightId = placedIds[j];
          const leftPos = position.get(leftId);
          const rightPos = position.get(rightId);
          const gap = 12;
          const hits = leftPos.x < rightPos.x + NODE_WIDTH + gap
            && rightPos.x < leftPos.x + NODE_WIDTH + gap
            && leftPos.y < rightPos.y + NODE_HEIGHT + gap
            && rightPos.y < leftPos.y + NODE_HEIGHT + gap;
          if (!hits) {
            continue;
          }
          const lowerId = leftPos.y > rightPos.y ? leftId : rightId;
          const lowerPos = position.get(lowerId);
          const upperPos = lowerId === leftId ? rightPos : leftPos;
          position.set(lowerId, {
            x: lowerPos.x,
            y: upperPos.y + NODE_HEIGHT + 16
          });
          moved = true;
        }
      }
      if (!moved) {
        break;
      }
    }

    let contentRight = 0;
    let contentBottom = 0;
    position.forEach((pos) => {
      contentRight = Math.max(contentRight, pos.x + NODE_WIDTH);
      contentBottom = Math.max(contentBottom, pos.y + NODE_HEIGHT);
    });
    const planeWidth = contentRight + PLANE_PAD;
    const planeHeight = contentBottom + PLANE_PAD;

    function buildLine(edge, className) {
      const from = position.get(edge.from);
      const to = position.get(edge.to);
      if (!from || !to) {
        return "";
      }
      const x1 = from.x + NODE_WIDTH / 2;
      const y1 = from.y + NODE_HEIGHT / 2;
      const x2 = to.x + NODE_WIDTH / 2;
      const y2 = to.y + NODE_HEIGHT / 2;
      const bend = (x1 + x2) / 2;
      return `<path class="tree-edge ${className}" d="M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}" />`;
    }

    const lines = prereqEdges
      .map((edge) => buildLine(edge, "tree-edge-prereq"))
      .concat(instanceEdges.map((edge) => buildLine(edge, "tree-edge-instance")))
      .join("");
    const buttons = nodes
      .filter((node) => position.has(node.id))
      .map((node) => renderTreeNode(tree.tree.id, node, position.get(node.id)))
      .join("");

    const zoom = mapZoom || Math.min(1, Math.max(0.3, ((elements.platformFeed.clientWidth || 1100) - 80) / planeWidth));
    return `
      <div class="map-scaled${zoom < 0.65 ? " map-compact" : ""}" style="width:${planeWidth * zoom}px;height:${planeHeight * zoom}px;--map-scale:${zoom}"><div class="tree-plane" style="width: ${planeWidth}px; height: ${planeHeight}px;transform:scale(${zoom})">
        <div class="tree-legend">
          <span class="tree-legend-item"><span class="tree-legend-swatch prereq"></span>前置 → 后置</span>
          <span class="tree-legend-item"><span class="tree-legend-swatch instance"></span>实例 → 原理</span>
        </div>
        <svg class="tree-svg" width="${planeWidth}" height="${planeHeight}" aria-hidden="true">
          ${lines}
        </svg>
        ${buttons}
      </div></div>
    `;
  }

  function renderTreeNode(treeId, node, pos) {
    const count = recordsForNode(treeId, node.id).length;
    const lit = state.forest.lightups.some((item) => item.treeId === treeId && item.nodeId === node.id && item.status === "confirmed") || recordsForNode(treeId, node.id).some((item) => item.lightUp);
    const methodCount = getTutorialsForNode(treeId, node.id).length;
    return `
      <button
        class="tree-node node-row${lit ? " is-lit" : ""}${count ? " has-practice" : ""}"
        style="left: ${pos.x}px; top: ${pos.y}px"
        type="button"
        data-action="platform-view"
        data-tree-id="${escapeAttribute(treeId)}"
        data-node-id="${escapeAttribute(node.id)}"
        aria-label="${escapeAttribute(nodeTitle(node))}，${lit ? "已点亮" : "尚未点亮"}，${count} 次实践，${methodCount} 个方法"
        title="${escapeAttribute(node.goal || nodeTitle(node))}"
      >
        <span class="node-orbit" aria-hidden="true"></span><span class="node-kicker">${lit ? "已点亮" : node.visibility === "private" ? "私人目标" : "知识结点"}</span>
        <span class="node-title">${escapeHtml(nodeTitle(node))}</span>
        <span class="node-count">${count} 次打卡 · ${methodCount} 个方法</span>
      </button>
    `;
  }

  function renderPlatformDetail() {
    if (treeComposerOpen) {
      elements.platformDetailBody.innerHTML = `<h2>新建知识树</h2><p class="detail-meta">从你想做的事情开始，保留一条可以逐步实践的路径。</p>
        <label class="field"><span>知识树名字</span><input id="tree-name" maxlength="40" placeholder="例如：把自己的想法做成产品"></label>
        <label class="field"><span>第一个五分钟目标</span><textarea id="tree-goal" rows="3" maxlength="200" placeholder="一个可以通过实践确认的小目标"></textarea></label>
        <label class="check-field"><input id="tree-public" type="checkbox">公开展示这棵树，起始节点仍由我持有</label><div id="tree-status" class="report hidden" role="status"></div>
        <button class="primary" type="button" data-action="tree-save">建立知识树</button>`;
      return;
    }
    if (composerOpen) {
      renderNodeComposer();
      return;
    }
    if (!detailNode) {
      elements.platformDetailBody.innerHTML = "";
      return;
    }
    const { treeId, nodeId } = detailNode;
    const node = getNodeById(treeId, nodeId);
    if (!node) {
      elements.platformDetailBody.innerHTML = createEmptyCard("找不到这个节点。");
      return;
    }
    const tutorials = getTutorialsForNode(treeId, nodeId);
    const tutorialHtml = tutorials.length
      ? tutorials.map(renderTutorialCard).join("")
      : `<div class="meta-note">这个节点还没有方法。</div>`;
    const ownershipHtml = `<p id="node-ownership" class="detail-meta">${escapeHtml(ownershipLabel(node))}</p>`;
    const editButtonHtml =
      canEditNode(node)
        ? `<button id="node-edit" class="ghost-button" type="button" data-action="platform-edit-open">编辑</button>`
        : "";
    const headerHtml = detailEditing
      ? `${ownershipHtml}${renderNodeEditForm(node)}`
      : `
        <h2>${escapeHtml(nodeTitle(node))}</h2>
        ${ownershipHtml}
        ${editButtonHtml}
        <div class="detail-meta">${escapeHtml(node.goal || "暂无目标说明")}</div>
      `;
    elements.platformDetailBody.innerHTML = `
      ${headerHtml}
      ${linkedTutorial && linkedTutorial.hash === window.location.hash && linkedTutorial.owner === currentUser?.id &&
        linkedTutorial.treeId === treeId && linkedTutorial.nodeId === nodeId
        ? `<section class="detail-block" id="linked-tutorial" aria-label="链接指向的教程版本">${renderLinkedTutorial()}</section>` : ""}
      <div class="detail-block">
        <div class="detail-label">打卡记录</div>
        ${!LOCAL_ONLY && canSharePractice({ treeId, nodeId }) ? `<a class="ghost-button" href="product.html?view=practice&amp;treeId=${encodeURIComponent(treeId)}&amp;nodeId=${encodeURIComponent(nodeId)}">搜索这个节点的公开实践</a>` : ""}
        <div class="record-list" id="detail-practice-records"></div>
      </div>
      <div class="detail-block">
        <label class="field">
          <span>记一次</span>
          <textarea id="practice-text" rows="3" maxlength="400" placeholder="写下这一次实际做了什么"></textarea>
        </label>
        <label class="field">
          <span>图片</span>
          <input id="practice-image" type="file" accept="image/*" multiple />
        </label>
        <label class="check-field"><input id="practice-lightup" type="checkbox">我已完成这个目标，作为一次自证点亮</label>
        <label class="check-field"><input id="practice-public" type="checkbox"${canSharePractice({ treeId, nodeId }) ? "" : " disabled"}>公开分享这次记录（文字、图片与方法引用）</label>
        <p class="detail-meta">未勾选分享时，只保存在自己的账号。</p>
        <div id="practice-status" class="report hidden"></div>
        <button class="primary" type="button" data-action="platform-submit">记一次</button>
      </div>
      <div class="detail-block">
        <div class="tutorial-head"><div class="detail-label">方法（默认折叠）</div><button class="ghost-button" type="button" data-action="tutorial-create">贡献方法</button></div>
        ${tutorialEditor ? renderTutorialEditor() : ""}
        ${tutorialHtml}
        ${LOCAL_ONLY ? "" : `<a class="ghost-button" href="product.html?view=demands&amp;tree=${encodeURIComponent(treeId)}&amp;node=${encodeURIComponent(nodeId)}">查看或记录节点需求</a>`}
      </div>
      <button
        class="primary"
        type="button"
        data-action="platform-do"
        data-tree-id="${escapeAttribute(treeId)}"
        data-node-id="${escapeAttribute(nodeId)}"
      >去做</button>
    `;
    renderDetailRecords();
  }

  function renderDetailRecords() {
    const list = document.getElementById("detail-practice-records");
    if (!list || !detailNode) return;
    const { treeId, nodeId } = detailNode;
    const records = recordsForNode(treeId, nodeId);
    const load = platformRecordsLoad?.treeId === treeId ? platformRecordsLoad.status : null;
    const feedback = LOCAL_ONLY || load === "ready" ? ""
      : load === "error"
        ? '<p class="meta-note" role="status">实践记录暂时无法读取。</p><button class="ghost-button" type="button" data-action="platform-records-retry">重新读取实践</button>'
        : '<p class="meta-note" role="status">正在读取实践记录…</p>';
    list.innerHTML = feedback + (records.length ? records.map(renderPracticeRecord).join("")
      : feedback ? "" : '<p class="meta-note">还没有人在这里打过卡。</p>');
  }

  function renderTutorialEditor() {
    const tutorial = tutorialEditor || {};
    return `<div class="tutorial-editor">
      <label class="field"><span>方法标题</span><input id="tutorial-title" maxlength="80" value="${escapeAttribute(tutorial.title || "")}" placeholder="给这个方法起一个具体的名字"></label>
      <label class="field"><span>怎样做到</span><textarea id="tutorial-method" rows="6" maxlength="8000" placeholder="材料、步骤、判断结果的方式，以及可能卡住的地方">${escapeHtml(tutorial.method || "")}</textarea></label>
      <label class="field"><span>前五分钟做什么</span><textarea id="tutorial-start" rows="2" maxlength="240" placeholder="写一个现在就可以开始的小动作">${escapeHtml(tutorial.startAction || "")}</textarea></label>
      <details><summary>参考资料与产品材料（可选）</summary><label class="field"><span>每行：材料名称 | 链接</span><textarea id="tutorial-resources" rows="3" placeholder="笔记模板 | https://...">${escapeHtml((tutorial.resources || []).map((item) => `${item.label} | ${item.url}`).join("\n"))}</textarea></label>
      <label class="check-field"><input id="tutorial-affiliate" type="checkbox"${(tutorial.resources || []).some((item) => item.affiliate) ? " checked" : ""}>这些链接包含产品推广，向使用者明确展示</label></details>
      <label class="check-field"><input id="tutorial-public" type="checkbox"${tutorial.visibility === "public" ? " checked" : ""}>公开分享这个方法，其他人可以使用；节点持有权保持原样</label>
      <p class="detail-meta">未勾选时只保存在自己的账号。每次修改保留旧版本，已经发生的实践不会改写。</p>
      <div id="tutorial-status" class="report hidden" role="status"></div>
      <div class="next-action-buttons"><button class="primary" type="button" data-action="tutorial-save">保存方法</button><button class="ghost-button" type="button" data-action="tutorial-cancel">取消</button></div>
    </div>`;
  }

  async function loadUserTutorials() {
    if (LOCAL_ONLY) return;
    const response = await window.fetch("/api/tutorials", { credentials: "same-origin" });
    if (!response.ok) throw new Error("方法暂时无法读取，请重试；已保存的方法不会被空白列表覆盖。");
    const data = await readJsonResponse(response);
    if (!data || !Array.isArray(data.tutorials)) throw new Error("方法列表格式不正确，请恢复服务后重试。");
    userTutorials = data.tutorials;
  }

  async function createKnowledgeTree() {
    const name = document.getElementById("tree-name").value.trim();
    const goal = document.getElementById("tree-goal").value.trim();
    const visibility = document.getElementById("tree-public").checked ? "public" : "private";
    const status = document.getElementById("tree-status");
    if (!name || !goal) { status.textContent = "填写知识树名字和第一个目标。"; status.classList.remove("hidden"); return; }
    try {
      let tree, node;
      if (LOCAL_ONLY) {
        tree = { id: createId(), name, domain: name, visibility, ownerId: currentUser.id };
        node = { id: createId(), treeId: tree.id, title: name, goal, estMinutes: 5, ownership: "personal", visibility, ownerId: currentUser.id, ownerName: currentUser.name };
        const next = { ...overlay, trees: (overlay.trees || []).concat(tree), nodes: overlay.nodes.concat(node) };
        localStorage.setItem(CUSTOM_NODES_KEY, JSON.stringify(next));
        overlay = next;
      } else {
        const response = await window.fetch("/api/trees", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, goal, visibility }) });
        const data = await readJsonResponse(response);
        if (!response.ok || !data || !data.tree) throw new Error(data && data.message || "知识树保存失败，请重试。");
        tree = data.tree; node = data.node;
        await loadOverlay();
      }
      browsingTreeId = tree.id;
      treeComposerOpen = false;
      detailNode = { treeId: tree.id, nodeId: node.id };
      rebuildIndexes();
      render();
    } catch (error) { status.textContent = error.message; status.classList.remove("hidden"); }
  }

  async function saveTutorial() {
    if (!detailNode || tutorialSaving) return;
    const title = document.getElementById("tutorial-title").value.trim();
    const method = document.getElementById("tutorial-method").value.trim();
    const startAction = document.getElementById("tutorial-start").value.trim();
    const affiliate = document.getElementById("tutorial-affiliate").checked;
    const visibility = document.getElementById("tutorial-public").checked ? "public" : "private";
    const status = document.getElementById("tutorial-status");
    const show = (message) => { status.textContent = message; status.classList.remove("hidden"); };
    if (!title || !method) { show("写下方法标题和具体步骤再保存。"); return; }
    let resources;
    try {
      resources = document.getElementById("tutorial-resources").value.split("\n").filter((line) => line.trim()).map((line) => {
        const [label, rawUrl] = line.split("|").map((part) => part.trim());
        const url = new URL(rawUrl);
        if (!label || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid");
        return { label, url: url.href, affiliate, optional: true };
      });
      if (resources.length > 12) throw new Error("invalid");
    } catch { show("材料请按「名称 | HTTP/HTTPS 链接」逐行填写，最多 12 项。"); return; }
    const content = { title, method, startAction, resources, visibility, ...detailNode };
    tutorialSaving = true;
    show("正在保存方法…");
    try {
      if (LOCAL_ONLY) {
        const existing = tutorialEditor && tutorialEditor.id ? userTutorials.find((item) => item.id === tutorialEditor.id) : null;
        const now = new Date().toISOString();
        const tutorial = { ...existing, ...content, id: existing ? existing.id : createId(), authorId: currentUser.id, authorName: currentUser.name, version: createId(), updatedAt: now, createdAt: existing ? existing.createdAt : now };
        tutorial.versions = (existing && existing.versions || []).concat({ ...content, version: tutorial.version, createdAt: now });
        const next = userTutorials.filter((item) => item.id !== tutorial.id).concat(tutorial);
        localStorage.setItem("knowledge-habit-tutorials", JSON.stringify(next));
        userTutorials = next;
      } else {
        const editing = tutorialEditor && tutorialEditor.id;
        const response = await window.fetch(editing ? `/api/tutorials/${encodeURIComponent(editing)}` : "/api/tutorials", {
          method: editing ? "PATCH" : "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...(editing ? { "If-Match": tutorialEditor.version } : {}) }, body: JSON.stringify(content)
        });
        const data = await readJsonResponse(response);
        if (!response.ok || !data || !data.tutorial) throw new Error(data && data.message || "保存失败，文字仍在这里，请重试。");
        userTutorials = userTutorials.filter((item) => item.id !== data.tutorial.id).concat(data.tutorial);
      }
      tutorialEditor = null;
      rebuildIndexes();
      renderPlatformDetail();
    } catch (error) { show(error.message || "保存失败，文字仍在这里，请重试。"); }
    finally { tutorialSaving = false; }
  }

  async function archiveTutorial(button) {
    const tutorial = userTutorials.find((item) => item.id === button.dataset.id);
    const ownerId = currentUser?.id;
    if (!tutorial || !ownerId || tutorial.authorId !== ownerId || button.disabled) return;
    if (!window.confirm("归档《" + tutorial.title + "》？已公开的旧版本仍可从实践记录查看。")) return;
    const status = button.parentElement.querySelector("[data-archive-status]");
    button.disabled = true;
    try {
      const response = await window.fetch("/api/tutorials/" + encodeURIComponent(tutorial.id), {
        method: "DELETE", credentials: "same-origin",
        headers: { "If-Match": tutorial.version, "X-Action-Account": ownerId }
      });
      const data = await readJsonResponse(response);
      if (currentUser?.id !== ownerId) return;
      if (!response.ok || !data?.ok) throw new Error(data?.message || "归档失败，请重试。");
      userTutorials = userTutorials.filter((item) => item.id !== tutorial.id);
      rebuildIndexes();
      renderPlatformDetail();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function renderNodeEditForm(node) {
    return `
      <div class="node-edit-form">
        <label class="field">
          <span>节点名字</span>
          <input id="node-edit-title" type="text" maxlength="40" value="${escapeAttribute(nodeTitle(node))}" />
        </label>
        <label class="field">
          <span>这一节点要达成什么</span>
          <textarea id="node-edit-goal" rows="3" maxlength="200">${escapeHtml(node.goal || "")}</textarea>
        </label>
        <label class="field">
          <span>建议时长（分钟）</span>
          <input id="node-edit-minutes" type="number" value="${escapeAttribute(node.estMinutes ?? 10)}" />
        </label>
        <label class="check-field"><input id="node-edit-public" type="checkbox"${node.visibility !== "private" ? " checked" : ""}>公开展示节点（仍归我持有）</label>
        <div id="node-edit-error" class="report hidden"></div>
        <div class="account-modes">
          <button class="primary" type="button" data-action="platform-edit-save">保存</button>
          <button class="ghost-button" type="button" data-action="platform-edit-cancel">取消</button>
          <button class="ghost-button danger" type="button" data-action="platform-node-delete">删除</button>
        </div>
      </div>
    `;
  }

  function renderNodeComposer() {
    const tree = getActiveTree();
    const nodes = tree && Array.isArray(tree.nodes) ? tree.nodes : [];
    const options = nodes
      .map((node) => `<option value="${escapeAttribute(node.id)}">${escapeHtml(nodeTitle(node))}</option>`)
      .join("");
    const prereqActive = composerKind !== "instance-of";
    elements.platformDetailBody.innerHTML = `
      <h2>新建节点</h2>
      <label class="field">
        <span>节点名字</span>
        <input id="node-create-title" type="text" maxlength="40" placeholder="节点名字" />
      </label>
      <label class="field">
        <span>这一节点要达成什么</span>
        <textarea id="node-create-goal" rows="3" maxlength="200" placeholder="这一节点要达成什么"></textarea>
      </label>
      <label class="field">
        <span>建议时长（分钟）</span>
        <input id="node-create-minutes" type="number" value="10" />
      </label>
      <label class="field">
        <span>挂在哪里</span>
        <select id="node-create-anchor">${options}</select>
      </label>
      <div class="account-modes">
        <button class="account-mode-button${prereqActive ? " active" : ""}" type="button" data-action="platform-create-kind" data-kind="prereq">作为它的后置</button>
        <button class="account-mode-button${prereqActive ? "" : " active"}" type="button" data-action="platform-create-kind" data-kind="instance-of">作为它的实例</button>
      </div>
      <div id="node-create-error" class="report hidden"></div>
      <button class="primary" type="button" data-action="platform-create-submit">放上树</button>
    `;
  }

  function openNodeComposer() {
    composerOpen = true;
    composerKind = "prereq";
    detailEditing = false;
    detailNode = null;
    renderPlatformDetail();
    elements.platformDetail.classList.remove("hidden");
  }

  function setComposerKind(kind) {
    composerKind = kind === "instance-of" ? "instance-of" : "prereq";
    Array.from(elements.platformDetailBody.querySelectorAll("[data-action='platform-create-kind']")).forEach((button) => {
      button.classList.toggle("active", button.dataset.kind === composerKind);
    });
  }

  function setComposerError(message) {
    const box = document.getElementById("node-create-error");
    if (!box) {
      return;
    }
    box.textContent = message || "";
    box.classList.toggle("hidden", !message);
  }

  function setEditError(message) {
    const box = document.getElementById("node-edit-error");
    if (!box) {
      return;
    }
    box.textContent = message || "";
    box.classList.toggle("hidden", !message);
  }

  async function submitNodeComposer() {
    const titleInput = document.getElementById("node-create-title");
    const goalInput = document.getElementById("node-create-goal");
    const minutesInput = document.getElementById("node-create-minutes");
    const anchorSelect = document.getElementById("node-create-anchor");
    const title = titleInput ? titleInput.value.trim() : "";
    const goal = goalInput ? goalInput.value.trim() : "";
    const minutes = minutesInput ? Number(minutesInput.value) : NaN;
    const anchorId = anchorSelect ? anchorSelect.value : "";
    if (!title) {
      setComposerError("写上节点名字。");
      return;
    }
    if (!goal) {
      setComposerError("写上这个节点要达成什么。");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 15) {
      setComposerError("建议时长是 5 到 15 分钟。");
      return;
    }
    if (!anchorId) {
      setComposerError("先选一个已有节点，说明它挂在哪里。");
      return;
    }
    const tree = getActiveTree();
    const treeId = tree ? tree.tree.id : null;
    const payload = { title, goal, estMinutes: minutes, anchorId, kind: composerKind, treeId };
    if (LOCAL_ONLY) {
      // 本地模式没有网络往返：同步落盘并渲染，点击即可见
      finishNodeCreate(persistLocalNodeCreate(payload), treeId);
      return;
    }
    finishNodeCreate(await persistRemoteNodeCreate(payload), treeId);
  }

  function finishNodeCreate(result, treeId) {
    if (!result.ok) {
      setComposerError(result.message || "创建失败，请稍后再试。");
      return;
    }
    composerOpen = false;
    composerKind = "prereq";
    detailNode = { treeId, nodeId: result.node.id };
    render();
    elements.platformDetail.classList.remove("hidden");
  }

  function persistLocalNodeCreate({ title, goal, estMinutes, anchorId, kind, treeId }) {
    const now = new Date().toISOString();
    const node = {
      id: createId(),
      treeId,
      title,
      goal,
      estMinutes,
      ownership: "personal",
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      createdAt: now,
      updatedAt: now
    };
    const edge =
      kind === "instance-of"
        ? { from: node.id, to: anchorId, type: "instance-of" }
        : { from: anchorId, to: node.id, type: "prereq" };
    overlay = { ...overlay, nodes: overlay.nodes.concat(node), edges: overlay.edges.concat(edge) };
    saveLocalOverlay();
    rebuildIndexes();
    return { ok: true, node };
  }

  async function persistRemoteNodeCreate({ title, goal, estMinutes, anchorId, kind, treeId }) {
    try {
      const response = await window.fetch("/api/nodes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treeId, title, goal, estMinutes, link: { type: kind, anchorId } })
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data || !data.node) {
        return { ok: false, message: (data && data.message) || "创建失败，请稍后再试。" };
      }
      await loadOverlay();
      rebuildIndexes();
      return { ok: true, node: data.node };
    } catch {
      return { ok: false, message: "无法连接到本地服务，请确认服务端已启动。" };
    }
  }

  async function saveNodeEdit() {
    if (!detailNode) {
      return;
    }
    const { treeId, nodeId } = detailNode;
    const node = getNodeById(treeId, nodeId);
    if (!node) {
      return;
    }
    const titleInput = document.getElementById("node-edit-title");
    const goalInput = document.getElementById("node-edit-goal");
    const minutesInput = document.getElementById("node-edit-minutes");
    const title = titleInput ? titleInput.value.trim() : nodeTitle(node);
    const goal = goalInput ? goalInput.value.trim() : node.goal || "";
    const estMinutes = minutesInput
      ? clampNumber(minutesInput.value, 5, 15, node.estMinutes || 10)
      : node.estMinutes;
    const visibility = document.getElementById("node-edit-public").checked ? "public" : "private";
    const values = { title, goal, estMinutes, visibility };
    if (LOCAL_ONLY) {
      finishNodeUpdate(persistLocalNodeUpdate(node.id, values));
      return;
    }
    finishNodeUpdate(await persistRemoteNodeUpdate(node.id, values));
  }

  function finishNodeUpdate(result) {
    if (!result.ok) {
      setEditError(result.message || "保存失败，请稍后再试。");
      return;
    }
    detailEditing = false;
    render();
  }

  function persistLocalNodeUpdate(id, { title, goal, estMinutes, visibility }) {
    const now = new Date().toISOString();
    overlay = {
      ...overlay,
      nodes: overlay.nodes.map((item) =>
        item.id === id ? { ...item, title, goal, estMinutes, visibility, updatedAt: now } : item
      ),
      edges: overlay.edges
    };
    saveLocalOverlay();
    rebuildIndexes();
    return { ok: true };
  }

  async function persistRemoteNodeUpdate(id, { title, goal, estMinutes, visibility }) {
    try {
      const response = await window.fetch(`/api/nodes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, goal, estMinutes, visibility })
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data || !data.node) {
        return { ok: false, message: (data && data.message) || "保存失败，请稍后再试。" };
      }
      await loadOverlay();
      rebuildIndexes();
      return { ok: true };
    } catch {
      return { ok: false, message: "无法连接到本地服务，请确认服务端已启动。" };
    }
  }

  async function deleteNode() {
    if (!detailNode) {
      return;
    }
    const { nodeId } = detailNode;
    if (!window.confirm("删除这个节点？打卡记录会留下来。")) {
      return;
    }
    if (LOCAL_ONLY) {
      overlay = {
        ...overlay,
        nodes: overlay.nodes.filter((node) => node.id !== nodeId),
        edges: overlay.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
      };
      saveLocalOverlay();
      closePlatformDetail();
      rebuildIndexes();
      render();
      return;
    }
    try {
      const response = await window.fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data || data.ok !== true) {
        setEditError((data && data.message) || "删除失败，请稍后再试。");
        return;
      }
      await loadOverlay();
      closePlatformDetail();
      rebuildIndexes();
      render();
    } catch {
      setEditError("无法连接到本地服务，请确认服务端已启动。");
    }
  }

  async function loadOverlay() {
    const response = await window.fetch("/api/nodes", { credentials: "same-origin" });
    if (!response.ok) throw new Error("知识树暂时无法读取，请重试。");
    const data = await readJsonResponse(response);
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("知识树数据格式不正确，请恢复服务后重试。");
    overlay = { nodes: data.nodes, edges: data.edges, trees: Array.isArray(data.trees) ? data.trees : [] };
  }

  function ownershipLabel(node) {
    const ownership = node && node.ownership ? node.ownership : "group";
    if (ownership !== "personal") {
      return "共有";
    }
    if (currentUser && node.ownerId === currentUser.id) {
      return node.visibility === "private" ? "我的 · 私人" : "我的";
    }
    return `${(node && node.ownerName) || "别人"} 的${node.visibility === "private" ? " · 私人" : ""}`;
  }

  function canEditNode(node) {
    return Boolean(
      node &&
        (node.ownership || "group") === "personal" &&
        currentUser &&
        node.ownerId === currentUser.id
    );
  }

  function renderPracticeRecord(record) {
    const images = Array.isArray(record.images) ? record.images.filter((image) => image && image.id) : [];
    const imagesHtml = images
      .map((image) => `<img class="practice-image" src="${LOCAL_ONLY && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl || "") ? escapeAttribute(image.dataUrl) : `/api/media/${escapeAttribute(image.id)}`}" alt="实践图片">`)
      .join("");
    const textHtml = record.text ? `<div class="record-text">${escapeHtml(record.text)}</div>` : "";
    const methodHtml = record.tutorialSnapshot ? `<details class="record-method"><summary>当时所用方法：${escapeHtml(record.tutorialSnapshot.title)} · ${escapeHtml(record.tutorialSnapshot.version.slice(0, 8))}</summary><div class="record-text">${escapeHtml(record.tutorialSnapshot.method)}</div></details>` : record.tutorialId && record.tutorialVersion ? `<div class="record-method"><button class="ghost-button" data-action="record-method" data-method-id="${escapeAttribute(record.tutorialId)}" data-version="${escapeAttribute(record.tutorialVersion)}">查看当时所用方法 · ${escapeHtml(record.tutorialVersion.slice(0, 8))}</button><div class="record-text"></div></div>` :
      record.tutorialUnavailable ? '<p class="detail-meta">原教程版本目前不可访问。</p>' : "";
    const actionsHtml = record.lightUpId
      ? `
        <div class="record-actions">
          ${
            record.status === "confirmed"
              ? (!LOCAL_ONLY && record.visibility === "private" && canSharePractice(record)
                ? `<button class="ghost-button" type="button" data-action="platform-confirm" data-id="${escapeAttribute(record.lightUpId)}" data-visibility="public">公开分享这次点亮</button>`
                : "")
              : `<button class="ghost-button" type="button" data-action="platform-confirm" data-id="${escapeAttribute(record.lightUpId)}">自证点亮，私人保存</button>
                ${!LOCAL_ONLY && canSharePractice(record) ? `<button class="ghost-button" type="button" data-action="platform-confirm" data-id="${escapeAttribute(record.lightUpId)}" data-visibility="public">自证点亮并公开分享</button>` : ""}`
          }
          <button class="ghost-button danger" type="button" data-action="platform-delete" data-id="${escapeAttribute(record.lightUpId)}">删除</button>
        </div>
      `
      : (LOCAL_ONLY || record.authorId === currentUser.id) && (record.visibility !== "private" || canSharePractice(record))
        ? `<div class="record-actions"><button class="ghost-button" type="button" data-action="record-visibility" data-id="${escapeAttribute(record.id)}" data-visibility="${record.visibility === "private" ? "public" : "private"}"${savingRecordVisibility.has(record.id) ? " disabled" : ""}>${record.visibility === "private" ? "公开分享这次记录" : "撤回分享，保留私人记录"}</button></div>`
        : "";
    return `
      <article class="record-item">
        <div class="record-meta">${record.authorId ? `<button class="author-link" data-action="profile-open" data-user-id="${escapeAttribute(record.authorId)}">${escapeHtml(record.authorName || "我")}</button>` : escapeHtml(record.authorName || "我")} · ${formatDateTime(record.createdAt)}${record.visibility === "private" ? " · 仅自己可见" : ""}${record.lightUp ? " · 自证点亮" : ""}</div>
        ${textHtml}
        ${methodHtml}
        ${imagesHtml}
        ${!LOCAL_ONLY && !record.lightUpId && record.authorId ? `<a class="ghost-button" href="product.html?view=practice-detail&amp;record=${encodeURIComponent(record.id)}">查看实践详情</a>` : ""}
        ${actionsHtml}
      </article>
    `;
  }

  // 服务器打卡 + 当前用户挂在这个节点上的 lightup（按 eventId 去重），新的在前
  function recordsForNode(treeId, nodeId) {
    const source = LOCAL_ONLY ? localPracticeRecords : platformRecords;
    const server = source.filter((record) => record.treeId === treeId && record.nodeId === nodeId);
    const serverEventIds = new Set(server.filter((record) => LOCAL_ONLY || record.authorId === currentUser.id).map((record) => record.eventId).filter(Boolean));
    const own = state.forest.lightups
      .filter((lightUp) => lightUp.treeId === treeId && lightUp.nodeId === nodeId)
      .filter((lightUp) => !(lightUp.eventId && serverEventIds.has(lightUp.eventId)))
      .map((lightUp) => ({
        id: lightUp.id,
        lightUpId: lightUp.id,
        status: lightUp.status,
        treeId,
        nodeId,
        authorName: "我",
        createdAt: lightUp.evidence.timestamp || lightUp.createdAt,
        text: lightUp.evidence.detail || "",
        tutorialSnapshot: lightUpTutorial(lightUp),
        visibility: lightUp.status === "confirmed" && (lightUp.visibility === "private" || lightUpTutorial(lightUp)?.archived) ? "private" : undefined,
        images: []
      }));
    return server.concat(own).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  function lightUpTutorial(lightUp) {
    return lightUp.tutorialSnapshot || state.events.find((event) => event.id === lightUp.eventId)?.tutorialSnapshot || null;
  }

  // 默认折叠：展开之前 method 不写进 DOM，折叠才能被断言而不是只做视觉隐藏
  async function showHistoricMethod(button) {
    const output = button.parentElement.querySelector(".record-text");
    const ownerId = currentUser?.id;
    const { methodId, version: requestedVersion } = button.dataset;
    const current = () => button.isConnected && currentUser?.id === ownerId;
    button.disabled = true;
    try {
      let version;
      if (LOCAL_ONLY) version = userTutorials.find((item) => item.id === button.dataset.methodId)?.versions?.find((item) => item.version === button.dataset.version);
      else {
        const response = await fetch(`/api/tutorials/${encodeURIComponent(button.dataset.methodId)}/versions/${encodeURIComponent(button.dataset.version)}`, { credentials: "same-origin" });
        const data = await response.json();
        if (response.ok && data.tutorial?.id === methodId && (data.tutorial.version || "seed-1") === requestedVersion) version = data.tutorial;
        else if (response.status !== 404) throw new Error("Historic method unavailable");
      }
      if (!current()) return;
      output.textContent = version ? `${version.title}\n${version.method}` : "这个历史方法暂不可访问，原实践及版本引用仍然保留。";
      if (version && !LOCAL_ONLY) {
        const links = document.createElement("ul");
        (version.resources || []).forEach((resource, index) => {
          if (!resource.affiliate) return;
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = productLink(methodId, requestedVersion, index);
          link.textContent = resource.label;
          item.append(link);
          links.append(item);
        });
        if (links.childElementCount) output.append(links);
      }
    } catch { if (current()) output.textContent = "历史方法读取失败，请重试。原实践仍然保留。"; }
    finally { button.disabled = false; }
  }

  function productLink(id, version, index) {
    const page = new URL("product.html", window.location.href);
    page.search = new URLSearchParams({ tutorial: id, version, material: index });
    return page.href;
  }

  function renderTutorialResources(tutorial) {
    const resources = (tutorial.resources || []).map((resource, index) => {
      try {
        const url = new URL(resource.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
        const internal = !LOCAL_ONLY && resource.affiliate && tutorial.version;
        const href = internal ? productLink(tutorial.id, tutorial.version, index) : url.href;
        return `<li><a href="${escapeAttribute(href)}"${internal ? "" : ' target="_blank" rel="noopener noreferrer"'}>${escapeHtml(resource.label)}</a>${resource.optional !== false ? " · 可选" : ""}${resource.affiliate ? " · 产品推广链接，可能产生抽成" : ""}</li>`;
      } catch { return ""; }
    }).join("");
    return resources ? `<ul class="tutorial-resources">${resources}</ul>` : "";
  }

  function renderTutorialPracticeLink(tutorial, scope) {
    if (LOCAL_ONLY || tutorial.visibility === "private" || !scope || !canSharePractice(scope)) return "";
    const params = new URLSearchParams({
      view: "practice", treeId: scope.treeId, nodeId: scope.nodeId,
      tutorialId: tutorial.id, tutorialVersion: tutorial.version || "seed-1"
    });
    return `<a class="ghost-button" href="product.html?${escapeAttribute(params.toString())}">查看使用这个版本的公开实践</a>`;
  }

  function renderLinkedTutorial() {
    const { tutorial, message, version } = linkedTutorial;
    if (!tutorial) return `<p role="status">${escapeHtml(message)}</p>`;
    return `<div class="detail-label">链接指向的教程版本 · ${escapeHtml(version.slice(0, 8))}</div>
      <h3>${escapeHtml(tutorial.title)}</h3><div class="record-text">${escapeHtml(tutorial.method)}</div>
      ${tutorial.startAction ? `<p class="detail-meta">前五分钟：${escapeHtml(tutorial.startAction)}</p>` : ""}
      ${renderTutorialResources(tutorial)}
      ${renderTutorialPracticeLink(tutorial, linkedTutorial)}
      ${tutorial.archived ? '<p class="detail-meta">教程已归档。仍可查看旧版本，并将这次实践私人保存。</p>' : ""}
      <button class="ghost-button" type="button" data-action="linked-tutorial-use">${tutorial.archived ? "用这个版本做私人记录" : "用这个版本去做"}</button>`;
  }

  function renderTutorialCard(tutorial) {
    const expanded = expandedTutorialIds.has(tutorial.id);
    const method = expanded ? `<div class="record-text">${escapeHtml(tutorial.method || "")}</div>
      ${tutorial.startAction ? `<p class="detail-meta">前五分钟：${escapeHtml(tutorial.startAction)}</p>` : ""}
      ${renderTutorialResources(tutorial)}
      ${renderTutorialPracticeLink(tutorial, detailNode)}
      <button class="ghost-button" type="button" data-action="tutorial-use" data-id="${escapeAttribute(tutorial.id)}">用这个方法去做</button>
      <span data-tutorial-use-status role="status"></span>
      ${currentUser && tutorial.authorId === currentUser.id ? `<button class="ghost-button" type="button" data-action="tutorial-edit" data-id="${escapeAttribute(tutorial.id)}">编辑方法</button>
        ${LOCAL_ONLY ? "" : `<button class="ghost-button" type="button" data-action="tutorial-archive" data-id="${escapeAttribute(tutorial.id)}">归档方法</button><span data-archive-status role="status"></span>`}` : ""}` : "";
    return `
      <article class="record-item" data-tutorial-card="${escapeAttribute(tutorial.id)}">
        <div class="tutorial-head">
          <h4>${escapeHtml(tutorial.title || tutorial.id)}</h4>
          <button
            class="ghost-button tutorial-toggle"
            type="button"
            data-action="tutorial-toggle"
            data-tutorial-id="${escapeAttribute(tutorial.id)}"
            aria-expanded="${expanded}"
          >
            ${expanded ? "收起" : "展开"}
          </button>
        </div>
        <div class="detail-meta">${escapeHtml(tutorial.authorName || "种子方法")}${tutorial.visibility === "private" ? " · 仅自己可见" : ""} · ${escapeHtml((tutorial.version || "seed-1").slice(0, 8))}</div>
        ${method}
      </article>
    `;
  }

  function toggleTutorial(tutorialId) {
    if (!tutorialId) {
      return;
    }
    if (expandedTutorialIds.has(tutorialId)) {
      expandedTutorialIds.delete(tutorialId);
    } else {
      expandedTutorialIds.add(tutorialId);
    }
    const tutorial = detailNode && getTutorialsForNode(detailNode.treeId, detailNode.nodeId).find((item) => item.id === tutorialId);
    const card = Array.from(elements.platformDetailBody.querySelectorAll("[data-tutorial-card]")).find((item) => item.dataset.tutorialCard === tutorialId);
    if (tutorial && card) card.outerHTML = renderTutorialCard(tutorial);
  }

  function readNodeRoute() {
    if (!currentUser || !platformBooted || elements.platformRoot.classList.contains("hidden")) return;
    const match = /^#node\/([^/]+)\/([^/]+)(?:\/tutorial\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64}))?$/.exec(window.location.hash);
    if (!match) return;
    let treeId, nodeId;
    try {
      treeId = decodeURIComponent(match[1]);
      nodeId = decodeURIComponent(match[2]);
    } catch {
      return;
    }
    window.dispatchEvent(new Event("KHTNodeRoute"));
    const node = getNodeById(treeId, nodeId);
    if (node) {
      browsingTreeId = treeId;
      render();
    }
    openPlatformDetail(treeId, nodeId);
    if (node && match[3]) void loadLinkedTutorial(treeId, nodeId, match[3], match[4]);
    return Boolean(node);
  }

  async function loadLinkedTutorial(treeId, nodeId, id, version) {
    const owner = currentUser.id;
    const hash = window.location.hash;
    const target = { treeId, nodeId, owner, hash, id, version, message: "正在读取教程版本…" };
    linkedTutorial = target;
    renderPlatformDetail();
    try {
      target.tutorial = await fetchLinkedTutorial(target);
    } catch (error) { target.message = error.message || "暂时无法读取教程版本，请刷新后重试。"; }
    if (linkedTutorial !== target || currentUser?.id !== owner || window.location.hash !== hash) return;
    const section = document.getElementById("linked-tutorial");
    if (section) section.innerHTML = renderLinkedTutorial();
  }

  async function fetchLinkedTutorial({ treeId, nodeId, id, version }) {
    if (LOCAL_ONLY) {
      const tutorial = getTutorialsForNode(treeId, nodeId).find((item) => item.id === id);
      if (tutorial && (tutorial.version || "seed-1") === version) return tutorial;
      const historical = tutorial?.versions?.find((item) => item.version === version);
      if (historical) return { ...tutorial, ...historical };
      throw new Error("这个教程版本目前不可访问。");
    }
    const response = await fetch(`/api/tutorials/${id}/versions/${version}`, { credentials: "same-origin" });
    if (response.status === 404 || response.status === 401) throw new Error("这个教程版本目前不可访问。");
    if (!response.ok) throw new Error("暂时无法读取教程版本，请刷新后重试。");
    const { tutorial } = await response.json();
    if (tutorial?.treeId !== treeId || tutorial.nodeId !== nodeId || tutorial.id !== id || (tutorial.version || "seed-1") !== version) {
      throw new Error("这个教程版本与当前节点不匹配。");
    }
    return tutorial;
  }

  async function useTutorialCard(button) {
    const node = detailNode;
    const owner = currentUser?.id;
    const tutorial = getTutorialsForNode(node.treeId, node.nodeId).find((item) => item.id === button.dataset.id);
    if (!tutorial || button.disabled || handoffBusy) return;
    if (LOCAL_ONLY || !userTutorials.some((item) => item.id === tutorial.id)) {
      await aimAndGo(node.treeId, node.nodeId, tutorial);
      return;
    }
    const current = () => detailNode === node && currentUser?.id === owner && button.isConnected;
    const status = button.parentElement.querySelector("[data-tutorial-use-status]");
    button.disabled = true;
    status.textContent = "";
    try {
      const latest = await fetchLinkedTutorial({ ...node, id: tutorial.id, version: tutorial.version });
      if (!current()) return;
      if (latest.archived && button.dataset.archived !== "true") {
        button.dataset.archived = "true";
        button.textContent = "用这个版本做私人记录";
        status.textContent = "教程已归档。这次实践可以私人保存。";
        return;
      }
      await aimAndGo(node.treeId, node.nodeId, latest);
    } catch (error) {
      if (current()) status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function useLinkedTutorial(button) {
    const target = linkedTutorial;
    if (!target?.tutorial || button.disabled || handoffBusy) return;
    const current = () => linkedTutorial === target && currentUser?.id === target.owner &&
      window.location.hash === target.hash && detailNode?.treeId === target.treeId && detailNode?.nodeId === target.nodeId;
    if (!current()) return;
    button.disabled = true;
    try {
      const tutorial = await fetchLinkedTutorial(target);
      if (current()) await aimAndGo(target.treeId, target.nodeId, tutorial);
    } catch (error) {
      if (!current()) return;
      target.tutorial = null;
      target.message = error.message || "暂时无法读取教程版本，请刷新后重试。";
      const section = document.getElementById("linked-tutorial");
      if (section) section.innerHTML = renderLinkedTutorial();
    } finally { button.disabled = false; }
  }

  function openPlatformDetail(treeId, nodeId) {
    if (!treeId || !nodeId) {
      return;
    }
    composerOpen = false;
    treeComposerOpen = false;
    tutorialEditor = null;
    detailEditing = false;
    linkedTutorial = null;
    detailNode = { treeId, nodeId };
    renderPlatformDetail();
    elements.platformDetail.classList.remove("hidden");
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 800px)").matches) {
      elements.platformDetail.focus({ preventScroll: true });
      elements.platformDetail.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }

  function closePlatformDetail() {
    if (window.location.hash.startsWith("#node/")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    treeComposerOpen = false;
    tutorialEditor = null;
    detailNode = null;
    linkedTutorial = null;
    detailEditing = false;
    composerOpen = false;
    expandedTutorialIds.clear();
    elements.platformDetailBody.innerHTML = "";
    elements.platformDetail.classList.add("hidden");
  }

  function mergePlatformRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const existing = platformRecords.findIndex(item => item.id === record.id);
    if (existing === -1) platformRecords.unshift(record);
    else platformRecords[existing] = record;
    platformRecordsRevision++;
  }

  function canSharePractice(record) {
    const node = getNodeById(record.treeId, record.nodeId);
    const tree = mergedTrees.find(item => item.tree.id === record.treeId);
    return Boolean(!record.tutorialArchived && !record.tutorialSnapshot?.archived && node && node.visibility !== "private" && tree && tree.tree.visibility !== "private");
  }

  async function setRecordVisibility(button) {
    const { id, visibility } = button.dataset;
    const records = LOCAL_ONLY ? localPracticeRecords : platformRecords;
    const record = records.find(item => item.id === id);
    if (!record || savingRecordVisibility.has(id) || (visibility === "public" && !canSharePractice(record))) return;
    const ownerId = currentUser?.id;
    const current = () => currentUser?.id === ownerId && detailNode?.treeId === record.treeId && detailNode?.nodeId === record.nodeId;
    savingRecordVisibility.add(id);
    button.disabled = true;
    try {
      if (LOCAL_ONLY) {
        const next = localPracticeRecords.map((record) => record.id === id ? { ...record, visibility } : record);
        localStorage.setItem("knowledge-habit-practice-records", JSON.stringify(next));
        localPracticeRecords = next;
      } else {
        const endpoint = `/api/records/${encodeURIComponent(id)}`;
        const headers = { "Content-Type": "application/json", "X-Action-Account": ownerId };
        if (visibility === "public") {
          const latest = await window.fetch(endpoint, { credentials: "same-origin" }).then(readJsonResponse);
          if (!current()) return;
          if (!latest?.revision || latest.ownerId !== ownerId ||
              latest.record?.text !== record.text || latest.record?.visibility !== record.visibility ||
              latest.record?.visibilityRevision !== record.visibilityRevision) {
            throw new Error("实践已在另一页面更新，请刷新并核对后再公开。");
          }
          headers["If-Match"] = latest.revision;
        }
        const response = await window.fetch(endpoint, { method: "PATCH", credentials: "same-origin",
          headers, body: JSON.stringify({ visibility }) });
        const data = await readJsonResponse(response);
        if (currentUser?.id !== ownerId) return;
        if (!response.ok || !data || !data.record) throw new Error(data && data.message || "分享状态修改失败，请重试。");
        platformRecords = platformRecords.map((item) => item.id === id
          ? { ...data.record, tutorialArchived: item.tutorialArchived } : item);
        platformRecordsRevision++;
      }
      if (current()) setPracticeStatus(visibility === "public" ? "实践已公开分享。" : "已撤回公开分享，私人记录保留。");
    } catch (error) { if (current()) setPracticeStatus(error.message); }
    finally {
      savingRecordVisibility.delete(id);
      if (current()) render(true);
    }
  }

  async function loadPlatformRecords() {
    const tree = getActiveTree();
    const ownerId = currentUser?.id;
    if (!tree) {
      return;
    }
    const request = ++platformRecordsRequest;
    const revision = platformRecordsRevision;
    const treeId = tree.tree.id;
    const current = () => request === platformRecordsRequest && currentUser?.id === ownerId && getActiveTree()?.tree.id === treeId;
    platformRecordsLoad = { treeId, status: "loading" };
    renderDetailRecords();
    try {
      const response = await window.fetch(`/api/records?treeId=${encodeURIComponent(tree.tree.id)}`, {
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Practice records unavailable");
      const data = await readJsonResponse(response);
      if (!current()) return;
      if (revision !== platformRecordsRevision) {
        void loadPlatformRecords();
        return;
      }
      if (!Array.isArray(data?.records)) throw new Error("Invalid practice response");
      platformRecords = data.records;
      platformRecordsLoad = { treeId, status: "ready" };
      render(true);
    } catch {
      if (!current()) return;
      platformRecordsLoad = { treeId, status: "error" };
      renderDetailRecords();
    }
  }

  function setPracticeStatus(message) {
    const status = document.getElementById("practice-status");
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.classList.toggle("hidden", !message);
  }

  async function submitPracticeRecord() {
    if (!detailNode || practiceSaving) {
      return;
    }
    const { treeId, nodeId } = detailNode;
    const textInput = document.getElementById("practice-text");
    const imageInput = document.getElementById("practice-image");
    const publicInput = document.getElementById("practice-public");
    const lightInput = document.getElementById("practice-lightup");
    const draft = textInput.value;
    const files = Array.from(imageInput.files || []);
    const text = draft.trim();
    const visibility = publicInput.checked ? "public" : "private";
    if (visibility === "public" && !canSharePractice({ treeId, nodeId })) {
      setPracticeStatus("当前知识目标只允许私人保存。");
      return;
    }
    const lightUp = lightInput.checked;
    const ownerId = currentUser?.id;
    const current = () => currentUser?.id === ownerId && textInput.isConnected;
    const finish = () => {
      if (!current()) return;
      const currentFiles = Array.from(imageInput.files || []);
      const unchanged = textInput.value === draft && publicInput.checked === (visibility === "public") &&
        lightInput.checked === lightUp && currentFiles.length === files.length && currentFiles.every((file, i) => file === files[i]);
      if (unchanged) {
        textInput.value = "";
        imageInput.value = "";
        publicInput.checked = false;
        lightInput.checked = false;
      }
      practiceRequests.delete(textInput);
      render(true);
      setPracticeStatus(unchanged ? "实践已保存。" : "上一条实践已保存，当前输入已保留。");
    };
    if (LOCAL_ONLY) {
      practiceSaving = true;
      try {
      const images = imageInput?.files?.length ? await collectPracticeImages(imageInput) : [];
      if (!text && !images.length) { setPracticeStatus("写点文字或选一张图片。"); return; }
      const record = {
        id: createId(),
        treeId,
        nodeId,
        authorName: "我",
        createdAt: new Date().toISOString(),
        text,
        images: images.map((image) => ({ ...image, id: crypto.randomUUID().replace(/-/g, "") })),
        eventId: null, visibility, lightUp
      };
      const next = [record, ...localPracticeRecords];
      try { localStorage.setItem("knowledge-habit-practice-records", JSON.stringify(next)); }
      catch { setPracticeStatus("浏览器空间不足，内容尚未保存，请先备份。"); return; }
      localPracticeRecords = next;
      finish();
      } catch (error) { setPracticeStatus(error.message || "内容尚未保存，请保留并重试。"); }
      finally { practiceSaving = false; }
      return;
    }
    practiceSaving = true;
    try {
      const images = await collectPracticeImages(imageInput);
      if (!current()) return;
      if (!text && !images.length) { setPracticeStatus("写点文字或选一张图片。"); return; }
      const payload = { treeId, nodeId, text, images, visibility, lightUp };
      const fingerprint = JSON.stringify(payload);
      let request = practiceRequests.get(textInput);
      if (request?.fingerprint !== fingerprint) {
        request = { fingerprint, key: crypto.randomUUID() };
        practiceRequests.set(textInput, request);
      }
      const result = await postPracticeRecord(payload, { "Idempotency-Key": request.key, "X-Action-Account": ownerId });
      if (!current()) return;
      if (!result.ok) { setPracticeStatus(result.message || "记录失败，请稍后再试。"); return; }
      finish();
    } catch { if (current()) setPracticeStatus("图片读取或保存失败，内容仍在这里，请重试。"); }
    finally { practiceSaving = false; }
  }

  async function collectPracticeImages(input) {
    if (!input || !input.files) {
      return [];
    }
    const files = Array.from(input.files);
    if (files.length > 4 || files.some((file) => file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))) throw new Error("一次最多四张，每张不超过 2MB，仅支持 JPEG、PNG、WebP、GIF。");
    const images = [];
    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file);
      images.push({ mediaType: file.type, dataUrl });
    }
    return images;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function postPracticeRecord(payload, headers = {}) {
    const ownerId = currentUser?.id;
    try {
      const response = await window.fetch("/api/records", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload)
      });
      const data = await readJsonResponse(response);
      if (currentUser?.id !== ownerId) return { ok: false };
      if (!response.ok || !data || !data.ok || !data.record) {
        return { ok: false, code: data?.code, message: (data && data.message) || "记录失败，请稍后再试。" };
      }
      mergePlatformRecord(data.record);
      return { ok: true, record: data.record };
    } catch {
      return { ok: false, message: "没有收到保存结果。内容仍在这里，可以重试。" };
    }
  }

  // L1 自证：一次点击即确认，不打分、不判题。已确认的重复调用不改状态（幂等）。
  async function confirmLightUp(id, shareRequested) {
    const lightUp = state.forest.lightups.find((item) => item.id === id);
    const shareConfirmed = !LOCAL_ONLY && shareRequested && lightUp?.visibility === "private";
    if (!lightUp || (lightUp.status === "confirmed" && !shareConfirmed) || publishingLightups.has(id)) {
      return;
    }
    if (LOCAL_ONLY) {
      lightUp.status = "confirmed";
      lightUp.visibility = "private";
      lightUp.confirmedAt = new Date().toISOString();
      saveLocal();
      render();
      return;
    }
    const owner = currentUser?.id;
    const sync = stateSync;
    const current = () => currentUser?.id === owner && stateSync === sync && state.forest.lightups.includes(lightUp);
    publishingLightups.add(id);
    try {
      if (!(await sync.flush()) || !current()) return;
      const confirmation = { ...lightUp, status: "confirmed", confirmedAt: lightUp.confirmedAt || new Date().toISOString() };
      const tutorialSnapshot = lightUpTutorial(lightUp);
      const share = shareRequested && canSharePractice({ ...lightUp, tutorialSnapshot });
      if (shareRequested && !share) return;
      if (!share) confirmation.visibility = "private";
      if (share) {
        const key = "confirm-lightup-" + id;
        const headers = { "X-Action-Account": owner, "X-Practice-Draft": id };
        if (/^[A-Za-z0-9_-]{16,100}$/.test(key)) headers["Idempotency-Key"] = key;
        const result = await postPracticeRecord({ treeId: lightUp.treeId, nodeId: lightUp.nodeId, text: lightUp.evidence.detail || "完成了这次实践", eventId: lightUp.eventId, visibility: "public", lightUp: true, tutorialId: lightUp.tutorialId || tutorialSnapshot?.id, tutorialVersion: tutorialSnapshot?.version }, headers);
        if (!current()) return;
        if (!result.ok) {
          if (result.code === "TUTORIAL_ARCHIVED" && tutorialSnapshot) {
            lightUp.tutorialSnapshot = { ...tutorialSnapshot, archived: true };
            render();
          }
          document.getElementById("save-status-message").textContent = result.message || "公开分享失败，草稿仍在这里。";
          document.getElementById("save-status").classList.remove("hidden");
          return;
        }
        if (shareConfirmed) {
          render();
          return;
        }
        confirmation.confirmedAt = result.record.createdAt || confirmation.confirmedAt;
      }
      if (!(await persistForest(id, confirmation, sync, share ? null : lightUp)) || !current()) return;
      Object.assign(lightUp, confirmation);
      render();
    } finally { publishingLightups.delete(id); }
  }

  async function deleteLightUp(id) {
    if (publishingLightups.has(id)) return;
    const record = state.forest.lightups.find((item) => item.id === id);
    if (!record) return;
    if (!LOCAL_ONLY) {
      const sync = stateSync;
      publishingLightups.add(id);
      try {
        if (!(await persistForest(id, null, sync, record)) || stateSync !== sync ||
            currentUser?.id !== sync.userId || !state.forest.lightups.includes(record)) return;
      } finally {
        publishingLightups.delete(id);
      }
    }
    state.forest.lightups = state.forest.lightups.filter((item) => item !== record);
    if (LOCAL_ONLY) saveLocal();
    renderNextAction();
    renderPlatformDetail();
  }

  // LOCAL_ONLY 写回同一 localStorage 键；否则从服务端取回 state、改 forest 后整份 PUT
  async function persistForest(id, replacement, sync = stateSync, expectedRecord = null) {
    if (LOCAL_ONLY) {
      saveLocal();
      return;
    }
    return sync.update((raw) => {
      const serverState = raw || cloneDefaultState();
      const forest = serverState.forest || normalizeForest(null);
      const lightups = Array.isArray(forest.lightups) ? forest.lightups : [];
      const stored = lightups.find((item) => item.id === id);
      if (replacement && !stored) throw new Error("这条草稿已在另一窗口移除，请刷新后查看。");
      if (stored && expectedRecord && (stored.status !== expectedRecord.status || stored.evidence?.detail !== expectedRecord.evidence.detail)) {
        throw new Error(replacement
          ? "草稿已在另一页面修改，请刷新并核对最新内容后再确认。"
          : "记录已在另一页面修改，请刷新并核对最新内容后再删除。");
      }
      // 只修改这一条，不把本页过期的整份 forest 写回。
      forest.lightups = lightups.flatMap((item) => item.id === id ? (replacement ? [replacement] : []) : [item]);
      serverState.forest = forest;
      return serverState;
    });
  }

  function applyAim(treeId, nodeId, tutorial = null) {
    state.forest.selectedNodeId = nodeId;
    state.forest.selectedNodeAt = new Date().toISOString();
    state.forest.selectedTutorial = globalThis.KHTProductRules.tutorialSnapshot(tutorial);
    if (treeId) {
      state.forest.activeTreeId = treeId;
    }
    // 已有文字不覆盖；只有空白时才补上节点标题
    if (!state.timer.predictedAction.trim()) {
      const node = getNodeById(treeId, nodeId);
      state.timer.predictedAction = tutorial && tutorial.startAction || (node ? nodeTitle(node) : "");
    }
  }

  // 「去做」：瞄准节点、按需补上预测文字，然后交回习惯服务
  async function aimAndGo(treeId, nodeId, tutorial = null) {
    if (!treeId || !nodeId || handoffBusy) {
      return;
    }
    if (state.timer.running) {
      document.getElementById("save-status-message").textContent = "还有计时正在进行。请先结束这次，再选择下一个目标。";
      document.getElementById("save-status").classList.remove("hidden");
      return;
    }
    applyAim(treeId, nodeId, tutorial);
    if (LOCAL_ONLY) {
      saveLocal();
    } else {
      handoffBusy = true;
      try {
        if (!(await syncAimToServer())) return;
      } finally {
        handoffBusy = false;
      }
    }
    window.location.assign(HABIT_ORIGIN + "/");
  }

  async function syncAimToServer() {
    return stateSync.update((raw) => {
      const serverState = raw || cloneDefaultState();
      if (serverState.timer && serverState.timer.running) {
        throw new Error("你还有一次正在进行的计时，请先结束它，再开始这个节点。");
      }
      serverState.forest = {
        ...(serverState.forest || {}),
        selectedNodeId: state.forest.selectedNodeId,
        selectedNodeAt: state.forest.selectedNodeAt,
        selectedTutorial: state.forest.selectedTutorial,
        activeTreeId: state.forest.activeTreeId
      };
      serverState.timer = { ...(serverState.timer || {}), predictedAction: state.timer.predictedAction };
      return serverState;
    });
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return cloneDefaultState();
      }
      return normalizeState(JSON.parse(raw));
    } catch {
      return cloneDefaultState();
    }
  }

  function saveLocal() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadSeedTrees() {
    const bundled = window.FOREST_SEED_TREES;
    const list = Array.isArray(bundled)
      ? bundled
      : bundled && typeof bundled === "object" ? Object.values(bundled) : [];
    const trees = list.filter(
      (tree) => tree && tree.format === TREE_FORMAT && tree.tree && typeof tree.tree.id === "string"
    );
    if (!trees.length) {
      console.warn("[forest] 未加载到种子树：请确认 seed-trees/seed-trees.js 与 platform.html 一起分发。");
    }
    return trees.concat((overlay.trees || []).map((tree) => ({ format: TREE_FORMAT, tree, nodes: [], edges: [], tutorials: [] })));
  }

  function buildNodeIndex(trees) {
    const index = new Map();
    trees.forEach((tree) => {
      (Array.isArray(tree.nodes) ? tree.nodes : []).forEach((node) => {
        if (node && typeof node.id === "string" && node.id) {
          index.set(`${tree.tree.id}::${node.id}`, node);
        }
      });
    });
    return index;
  }

  function buildTutorialIndex(trees) {
    const index = new Map();
    trees.forEach((tree) => {
      (Array.isArray(tree.tutorials) ? tree.tutorials : []).forEach((tutorial) => {
        if (!tutorial || typeof tutorial.id !== "string" || typeof tutorial.nodeId !== "string") {
          return;
        }
        const key = `${tree.tree.id}::${tutorial.nodeId}`;
        index.set(key, (index.get(key) || []).concat(tutorial));
      });
    });
    return index;
  }

  function nodeTitle(node) {
    return node && typeof node.title === "string" && node.title ? node.title : node && node.id ? node.id : "";
  }

  function getActiveTree() {
    return mergedTrees.find((tree) => tree.tree.id === (browsingTreeId || state.forest.activeTreeId)) || mergedTrees[0] || null;
  }

  function getNodeById(treeId, nodeId) {
    if (!treeId || !nodeId) {
      return null;
    }
    return nodeIndex.get(`${treeId}::${nodeId}`) || null;
  }

  function getTutorialsForNode(treeId, nodeId) {
    return tutorialIndex.get(`${treeId}::${nodeId}`) || [];
  }

  function normalizeState(raw) {
    const candidate = raw && typeof raw === "object" ? raw : {};
    const timer = candidate.timer && typeof candidate.timer === "object" ? candidate.timer : {};
    const settings = candidate.settings && typeof candidate.settings === "object" ? candidate.settings : {};
    return {
      version: STATE_VERSION,
      habit: normalizeHabit(candidate.habit, true),
      habitHistory: Array.isArray(candidate.habitHistory)
        ? candidate.habitHistory.map((habit) => normalizeHabit(habit, false)).filter(Boolean)
        : [],
      events: Array.isArray(candidate.events) ? candidate.events.map(normalizeEvent).filter(Boolean) : [],
      timer: {
        elapsedMs: Number(timer.elapsedMs) > 0 ? Number(timer.elapsedMs) : 0,
        running: Boolean(timer.running),
        startedAt: typeof timer.startedAt === "string" ? timer.startedAt : null,
        predictedAction: typeof timer.predictedAction === "string" ? timer.predictedAction : "",
        singleLog: typeof timer.singleLog === "string" ? timer.singleLog : "",
        practiceContext: timer.practiceContext && typeof timer.practiceContext === "object" ? timer.practiceContext : null,
        selectedOption: ["p1", "p2", "p3", "custom"].includes(timer.selectedOption)
          ? timer.selectedOption
          : "custom",
        selectedHabitId: typeof timer.selectedHabitId === "string" && timer.selectedHabitId ? timer.selectedHabitId : null,
        selectedHabitName:
          typeof timer.selectedHabitName === "string" && timer.selectedHabitName
            ? timer.selectedHabitName
            : CUSTOM_HABIT_NAME
      },
      settings: {
        hubConnected: Boolean(settings.hubConnected),
        lastBackupAt: typeof settings.lastBackupAt === "string" ? settings.lastBackupAt : null
      },
      forest: normalizeForest(candidate.forest)
    };
  }

  function normalizeForest(raw) {
    const forest = raw && typeof raw === "object" ? raw : {};
    return {
      activeTreeId: typeof forest.activeTreeId === "string" && forest.activeTreeId ? forest.activeTreeId : null,
      selectedNodeId:
        typeof forest.selectedNodeId === "string" && forest.selectedNodeId ? forest.selectedNodeId : null,
      selectedNodeAt: typeof forest.selectedNodeAt === "string" ? forest.selectedNodeAt : null,
      selectedTutorial: globalThis.KHTProductRules.tutorialSnapshot(forest.selectedTutorial),
      lightups: Array.isArray(forest.lightups) ? forest.lightups.map(normalizeLightUp).filter(Boolean) : []
    };
  }

  function normalizeLightUp(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    if (typeof raw.nodeId !== "string" || !raw.nodeId.trim()) {
      return null;
    }
    const evidence = raw.evidence && typeof raw.evidence === "object" ? raw.evidence : {};
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
      treeId: typeof raw.treeId === "string" && raw.treeId ? raw.treeId : null,
      nodeId: raw.nodeId.trim(),
      tutorialId: typeof raw.tutorialId === "string" && raw.tutorialId ? raw.tutorialId : null,
      tutorialSnapshot: globalThis.KHTProductRules.tutorialSnapshot(raw.tutorialSnapshot),
      status: raw.status === "confirmed" ? "confirmed" : "draft",
      ...(raw.visibility === "private" ? { visibility: "private" } : {}),
      evidence: {
        type: "self",
        detail: typeof evidence.detail === "string" ? evidence.detail : "",
        timestamp: typeof evidence.timestamp === "string" ? evidence.timestamp : new Date().toISOString()
      },
      eventId: typeof raw.eventId === "string" && raw.eventId ? raw.eventId : null,
      habitId: typeof raw.habitId === "string" && raw.habitId ? raw.habitId : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      confirmedAt: typeof raw.confirmedAt === "string" ? raw.confirmedAt : null,
      verified: false
    };
  }

  function normalizeHabit(rawHabit, active) {
    if (!rawHabit || typeof rawHabit !== "object") {
      return null;
    }
    if (typeof rawHabit.name !== "string" || !rawHabit.name.trim()) {
      return null;
    }
    return {
      id: typeof rawHabit.id === "string" && rawHabit.id ? rawHabit.id : createId(),
      name: rawHabit.name.trim(),
      startDate: typeof rawHabit.startDate === "string" ? rawHabit.startDate : new Date().toISOString(),
      targetDays: clampNumber(rawHabit.targetDays, 21, 365, 60),
      active,
      recurringLog: typeof rawHabit.recurringLog === "string" ? rawHabit.recurringLog : "",
      completedAt: typeof rawHabit.completedAt === "string" ? rawHabit.completedAt : null,
      progressDays: Number(rawHabit.progressDays) > 0 ? Number(rawHabit.progressDays) : undefined
    };
  }

  function normalizeEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") {
      return null;
    }
    if (typeof rawEvent.title !== "string" || !rawEvent.title.trim()) {
      return null;
    }
    return {
      id: typeof rawEvent.id === "string" && rawEvent.id ? rawEvent.id : createId(),
      habitId: typeof rawEvent.habitId === "string" && rawEvent.habitId ? rawEvent.habitId : null,
      habitName: typeof rawEvent.habitName === "string" && rawEvent.habitName ? rawEvent.habitName : null,
      title: rawEvent.title.trim(),
      nodeId: typeof rawEvent.nodeId === "string" && rawEvent.nodeId ? rawEvent.nodeId : null,
      treeId: typeof rawEvent.treeId === "string" && rawEvent.treeId ? rawEvent.treeId : null,
      tutorialSnapshot: globalThis.KHTProductRules.tutorialSnapshot(rawEvent.tutorialSnapshot),
      nodeSnapshot: rawEvent.nodeSnapshot && typeof rawEvent.nodeSnapshot === "object" ? rawEvent.nodeSnapshot : null,
      createdAt: typeof rawEvent.createdAt === "string" ? rawEvent.createdAt : new Date().toISOString(),
      lightUp: Boolean(rawEvent.lightUp),
      singleLog: typeof rawEvent.singleLog === "string" ? rawEvent.singleLog : "",
      source:
        rawEvent.source === "timer"
          ? "timer"
          : rawEvent.source === "quick-note"
            ? "quick-note"
            : "manual",
      durationMs: Number(rawEvent.durationMs) > 0 ? Number(rawEvent.durationMs) : null,
      report: typeof rawEvent.report === "string" ? rawEvent.report : ""
    };
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function createEmptyCard(message) {
    return `<article class="record-item"><div class="record-meta">${escapeHtml(message)}</div></article>`;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `id-${Math.random().toString(16).slice(2, 10)}`;
  }

  function formatDateTime(value) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function readJsonResponse(response) {
    return response.json().catch(() => null);
  }

  function showApp() {
    const gate = document.getElementById("account-gate");
    if (gate) {
      gate.classList.add("hidden");
    }
    elements.platformRoot.classList.remove("hidden");
  }

  function showGate() {
    const gate = document.getElementById("account-gate");
    if (gate) {
      gate.classList.remove("hidden");
    }
    elements.platformRoot.classList.add("hidden");
  }

  function fallbackToLocal() {
    state = loadState();
    showApp();
    bootPlatform();
    platformBooted = true;
  }

  let practiceInboxRequest = 0;
  function clearPracticeInbox() {
    practiceInboxRequest += 1;
    const link = document.getElementById("platform-practice-replies");
    if (link) link.textContent = "收到的留言与回复";
    return link;
  }

  async function refreshPracticeInbox() {
    const link = clearPracticeInbox();
    if (!link) return;
    const request = practiceInboxRequest;
    const accountId = currentUser?.id;
    if (!accountId || document.visibilityState === "hidden") return;
    try {
      const response = await window.fetch("/api/practice-replies?summary=1");
      if (!response.ok) return;
      const { ownerId, unreadCount } = await response.json();
      if (request === practiceInboxRequest && currentUser?.id === accountId && ownerId === accountId && unreadCount > 0) {
        link.textContent = `收到的留言与回复（${unreadCount} 条未读）`;
      }
    } catch {
      // The inbox link is still usable when the count is unavailable.
    }
  }

  async function enterApp() {
    window.dispatchEvent(new Event("KHTProfileReset"));
    overlay = { nodes: [], edges: [], trees: [] };
    platformRecords = [];
    platformRecordsLoad = null;
    detailNode = null;
    linkedTutorial = null;
    expandedTutorialIds.clear();
    userTutorials = [];
    browsingTreeId = null;
    tutorialEditor = null;
    stateSync = new window.KHTStateSync(currentUser.id);
    const nextState = await stateSync.load();
    state = nextState ? normalizeState(nextState) : cloneDefaultState();
    await loadUserTutorials();
    await loadOverlay();
    showApp();
    if (!platformBooted) {
      bootPlatform();
      platformBooted = true;
    } else {
      // 已启动：只重新并树、重建索引再渲染，不重复绑定事件
      rebuildIndexes();
      platformRecords = [];
      render();
    }
    // 启动加载本身不写服务端，等用户第一次改动再同步
    if (stateSync.pending) void stateSync.flush();
    readNodeRoute();
    void loadPlatformRecords();
    void refreshPracticeInbox();
    window.dispatchEvent(new Event("KHTProfileReady"));
  }

  function returnToGate() {
    window.dispatchEvent(new Event("KHTProfileLogout"));
    currentUser = null;
    clearPracticeInbox();
    closePlatformDetail();
    const passwordInput = document.getElementById("account-password");
    if (passwordInput) {
      passwordInput.value = "";
    }
    showGate();
  }

  function sharedPageReturn() {
    const value = new URLSearchParams(window.location.search).get("returnTo");
    if (!value || !value.startsWith("/")) return null;
    try {
      const target = new URL(value, window.location.href);
      const allowed = new URL("product.html", window.location.href);
      return target.origin === allowed.origin && target.pathname === allowed.pathname ? target.href : null;
    } catch { return null; }
  }

  async function resolveInitialSession() {
    let response;
    try {
      response = await window.fetch("/api/me", { credentials: "same-origin" });
    } catch {
      if (window.location.protocol === "file:") {
        fallbackToLocal();
      } else {
        const errorBox = document.getElementById("account-error");
        errorBox.textContent = "本机服务连接中断。请恢复服务后登录，账号记录不会被空白状态覆盖。";
        errorBox.classList.remove("hidden");
      }
      return;
    }
    if (response.status === 404) {
      if (window.location.protocol === "file:") fallbackToLocal();
      return;
    }
    if (!response.ok) {
      // 401 等：留在门口等用户登录
      return;
    }
    const data = await readJsonResponse(response);
    if (!data || !data.user) {
      return;
    }
    currentUser = data.user;
    const destination = sharedPageReturn();
    if (destination) {
      window.location.replace(destination);
      return;
    }
    try {
      await enterApp();
    } catch {
      showGate();
    }
  }

  function setupAccountGate() {
    const form = document.getElementById("account-form");
    const gate = document.getElementById("account-gate");
    if (!gate || !form) {
      fallbackToLocal();
      return;
    }
    const nameInput = document.getElementById("account-name");
    const passwordInput = document.getElementById("account-password");
    const submitButton = document.getElementById("account-submit");
    const errorBox = document.getElementById("account-error");
    const registerButton = document.getElementById("account-mode-register");
    const loginButton = document.getElementById("account-mode-login");
    const logoutButton = document.getElementById("account-logout");
    let mode = "register";
    let busy = false;

    function showError(message) {
      if (!errorBox) {
        return;
      }
      errorBox.textContent = message || "";
      errorBox.classList.toggle("hidden", !message);
    }

    function setMode(next) {
      mode = next;
      registerButton.classList.toggle("active", mode === "register");
      loginButton.classList.toggle("active", mode === "login");
      passwordInput.setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
      submitButton.textContent = mode === "register" ? "注册并进入" : "登录";
      showError("");
    }

    registerButton.addEventListener("click", () => setMode("register"));
    loginButton.addEventListener("click", () => setMode("login"));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) {
        return;
      }
      busy = true;
      submitButton.disabled = true;
      showError("");
      try {
        const response = await window.fetch(mode === "register" ? "/api/register" : "/api/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameInput.value.trim(), password: passwordInput.value })
        });
        const data = await readJsonResponse(response);
        if (!response.ok || !data || !data.ok || !data.user) {
          const fallbackMessage = mode === "register" ? "注册失败，请稍后再试。" : "登录失败，请稍后再试。";
          showError((data && data.message) || fallbackMessage);
          return;
        }
        passwordInput.value = "";
        currentUser = data.user;
        const destination = sharedPageReturn();
        if (destination) {
          window.location.replace(destination);
          return;
        }
        await enterApp();
      } catch (error) {
        showError(error instanceof TypeError ? "无法连接到账号服务。请双击项目中的 start-product.cmd 启动两个系统，再重试；输入的名字和密码仍在这里。" : error.message || "连接失败，请稍后再试。");
      } finally {
        busy = false;
        submitButton.disabled = false;
      }
    });

    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        if (stateSync && !(await stateSync.flush())) return;
        try {
          const response = await window.fetch("/api/logout", { method: "POST", credentials: "same-origin" });
          if (!response.ok) throw new Error("退出失败");
        } catch {
          if (stateSync) stateSync.show("退出失败，请重试。已保存的记录不受影响。", true);
          return;
        }
        returnToGate();
      });
    }

    setMode(sharedPageReturn() ? "login" : "register");
    resolveInitialSession();
  }

  window.addEventListener("hashchange", () => {
    if (readNodeRoute() && !LOCAL_ONLY) void loadPlatformRecords();
  });
  if (LOCAL_ONLY) {
    state = loadState();
    showApp();
    bootPlatform();
    platformBooted = true;
    readNodeRoute();
  } else {
    showGate();
    setupAccountGate();
    window.addEventListener("pagehide", clearPracticeInbox);
    window.addEventListener("pageshow", (event) => { if (event.persisted) void refreshPracticeInbox(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshPracticeInbox();
      else clearPracticeInbox();
    });
  }
})();
