(function bootstrapPlatform() {
  const STORAGE_KEY = "knowledge-habit-tracker";
  const CUSTOM_NODES_KEY = "knowledge-habit-custom-nodes";
  const CUSTOM_HABIT_NAME = "自由记录";
  const TREE_FORMAT = "forest-tree/v1";
  const STATE_VERSION = 3;
  // 「去做」把这次瞄准交回习惯服务：习惯页固定跑在本地服务的根路径上
  const HABIT_ORIGIN = "http://127.0.0.1:3000";

  // 平台页自身可以单文件运行；LOCAL_ONLY 时不连服务端，与 app.js 的约定一致
  const LOCAL_ONLY = globalThis.__KHT_LOCAL_ONLY__ === true;

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
  // seedTrees 是种子原样，mergedTrees 是叠加个人节点后的结果；布局与索引都读后者
  let seedTrees = [];
  let mergedTrees = [];
  let overlay = { nodes: [], edges: [] };
  let currentUser = LOCAL_ONLY ? { id: "local", name: "我" } : null;
  let stateSync = null;
  let handoffBusy = false;
  let nodeIndex = new Map();
  let tutorialIndex = new Map();
  let platformRecords = [];
  const localPracticeRecords = [];
  // 折叠只存在内存里：展开教程不写 localStorage，也不写服务端
  const expandedTutorialIds = new Set();
  let detailNode = null;
  let detailEditing = false;
  let composerOpen = false;
  let composerKind = "prereq";

  const elements = {
    platformRoot: document.getElementById("platform-root"),
    platformFeed: document.getElementById("platform-feed"),
    platformDetail: document.getElementById("platform-detail"),
    platformDetailBack: document.getElementById("platform-detail-back"),
    platformDetailBody: document.getElementById("platform-detail-body")
  };

  function bootPlatform() {
    seedTrees = loadSeedTrees();
    if (LOCAL_ONLY) {
      overlay = loadLocalOverlay();
    }
    rebuildIndexes();
    bindEvents();
    render();
  }

  // 个人节点并进种子树后再建索引；布局数学只认合并后的树
  function rebuildIndexes() {
    mergedTrees = mergeCustomNodes(seedTrees, overlay);
    nodeIndex = buildNodeIndex(mergedTrees);
    tutorialIndex = buildTutorialIndex(mergedTrees);
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
        edges: parsed && Array.isArray(parsed.edges) ? parsed.edges : []
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
    elements.platformDetailBack.addEventListener("click", closePlatformDetail);
  }

  function handlePlatformActions(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === "platform-view") {
      openPlatformDetail(button.dataset.treeId, button.dataset.nodeId);
    } else if (action === "platform-do") {
      void aimAndGo(button.dataset.treeId, button.dataset.nodeId);
    } else if (action === "platform-submit") {
      void submitPracticeRecord();
    } else if (action === "platform-confirm") {
      confirmLightUp(button.dataset.id);
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
    }
  }

  function render() {
    renderPlatformFeed();
    renderPlatformDetail();
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
    elements.platformFeed.innerHTML = buildTreeLayout(tree);
  }

  // 二维平面：prereq 决定列与顺序，instance-of 的实例挂在原理右下角
  function buildTreeLayout(tree) {
    const NODE_WIDTH = 140;
    const NODE_HEIGHT = 64;
    const COLUMN_GAP = 360;
    const ROW_GAP = 92;
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
      return `<line class="tree-edge ${className}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
    }

    const lines = prereqEdges
      .map((edge) => buildLine(edge, "tree-edge-prereq"))
      .concat(instanceEdges.map((edge) => buildLine(edge, "tree-edge-instance")))
      .join("");
    const buttons = nodes
      .filter((node) => position.has(node.id))
      .map((node) => renderTreeNode(tree.tree.id, node, position.get(node.id)))
      .join("");

    return `
      <div class="tree-plane" style="width: ${planeWidth}px; height: ${planeHeight}px">
        <div class="tree-legend">
          <span class="tree-legend-item"><span class="tree-legend-swatch prereq"></span>前置 → 后置</span>
          <span class="tree-legend-item"><span class="tree-legend-swatch instance"></span>实例 → 原理</span>
        </div>
        <svg class="tree-svg" width="${planeWidth}" height="${planeHeight}" aria-hidden="true">
          ${lines}
        </svg>
        ${buttons}
      </div>
    `;
  }

  function renderTreeNode(treeId, node, pos) {
    const count = recordsForNode(treeId, node.id).length;
    return `
      <button
        class="tree-node node-row"
        style="left: ${pos.x}px; top: ${pos.y}px"
        type="button"
        data-action="platform-view"
        data-tree-id="${escapeAttribute(treeId)}"
        data-node-id="${escapeAttribute(node.id)}"
      >
        <span class="node-title">${escapeHtml(nodeTitle(node))}</span>
        <span class="node-count">${count} 次打卡</span>
      </button>
    `;
  }

  function renderPlatformDetail() {
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
    const records = recordsForNode(treeId, nodeId);
    const recordsHtml = records.length
      ? records.map(renderPracticeRecord).join("")
      : `<div class="meta-note">还没有人在这里打过卡。</div>`;
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
      <div class="detail-block">
        <div class="detail-label">打卡记录</div>
        <div class="record-list">${recordsHtml}</div>
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
        <div id="practice-status" class="report hidden"></div>
        <button class="primary" type="button" data-action="platform-submit">记一次</button>
      </div>
      <div class="detail-block">
        <div class="detail-label">方法（默认折叠）</div>
        ${tutorialHtml}
      </div>
      <button
        class="primary"
        type="button"
        data-action="platform-do"
        data-tree-id="${escapeAttribute(treeId)}"
        data-node-id="${escapeAttribute(nodeId)}"
      >去做</button>
    `;

    Array.from(elements.platformDetailBody.querySelectorAll(".tutorial-toggle")).forEach((button) => {
      button.addEventListener("click", () => {
        toggleTutorial(button.dataset.tutorialId);
      });
    });
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
    overlay = { nodes: overlay.nodes.concat(node), edges: overlay.edges.concat(edge) };
    saveLocalOverlay();
    rebuildIndexes();
    return { ok: true, node };
  }

  async function persistRemoteNodeCreate({ title, goal, estMinutes, anchorId, kind }) {
    try {
      const response = await window.fetch("/api/nodes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, goal, estMinutes, link: { type: kind, anchorId } })
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
    const values = { title, goal, estMinutes };
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

  function persistLocalNodeUpdate(id, { title, goal, estMinutes }) {
    const now = new Date().toISOString();
    overlay = {
      nodes: overlay.nodes.map((item) =>
        item.id === id ? { ...item, title, goal, estMinutes, updatedAt: now } : item
      ),
      edges: overlay.edges
    };
    saveLocalOverlay();
    rebuildIndexes();
    return { ok: true };
  }

  async function persistRemoteNodeUpdate(id, { title, goal, estMinutes }) {
    try {
      const response = await window.fetch(`/api/nodes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, goal, estMinutes })
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
    try {
      const response = await window.fetch("/api/nodes", { credentials: "same-origin" });
      if (!response.ok) {
        return;
      }
      const data = await readJsonResponse(response);
      if (data && Array.isArray(data.nodes)) {
        overlay = { nodes: data.nodes, edges: Array.isArray(data.edges) ? data.edges : [] };
      }
    } catch {
      // 拉取失败时保持已有 overlay，不打断浏览
    }
  }

  function ownershipLabel(node) {
    const ownership = node && node.ownership ? node.ownership : "group";
    if (ownership !== "personal") {
      return "共有";
    }
    if (currentUser && node.ownerId === currentUser.id) {
      return "我的";
    }
    return `${(node && node.ownerName) || "别人"} 的`;
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
      .map((image) => `<img class="practice-image" src="/api/media/${escapeAttribute(image.id)}" alt="">`)
      .join("");
    const textHtml = record.text ? `<div class="record-text">${escapeHtml(record.text)}</div>` : "";
    const actionsHtml = record.lightUpId
      ? `
        <div class="record-actions">
          ${
            record.status === "confirmed"
              ? ""
              : `<button class="ghost-button" type="button" data-action="platform-confirm" data-id="${escapeAttribute(record.lightUpId)}">发出</button>`
          }
          <button class="ghost-button danger" type="button" data-action="platform-delete" data-id="${escapeAttribute(record.lightUpId)}">删除</button>
        </div>
      `
      : "";
    return `
      <article class="record-item">
        <div class="record-meta">${escapeHtml(record.authorName || "我")} · ${formatDateTime(record.createdAt)}</div>
        ${textHtml}
        ${imagesHtml}
        ${actionsHtml}
      </article>
    `;
  }

  // 服务器打卡 + 当前用户挂在这个节点上的 lightup（按 eventId 去重），新的在前
  function recordsForNode(treeId, nodeId) {
    const source = LOCAL_ONLY ? localPracticeRecords : platformRecords;
    const server = source.filter((record) => record.treeId === treeId && record.nodeId === nodeId);
    const serverEventIds = new Set(server.map((record) => record.eventId).filter(Boolean));
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
        images: []
      }));
    return server.concat(own).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  // 默认折叠：展开之前 method 不写进 DOM，折叠才能被断言而不是只做视觉隐藏
  function renderTutorialCard(tutorial) {
    const expanded = expandedTutorialIds.has(tutorial.id);
    const method = expanded ? `<div class="record-text">${escapeHtml(tutorial.method || "")}</div>` : "";
    return `
      <article class="record-item">
        <div class="tutorial-head">
          <h4>${escapeHtml(tutorial.title || tutorial.id)}</h4>
          <button
            class="ghost-button tutorial-toggle"
            type="button"
            data-tutorial-id="${escapeAttribute(tutorial.id)}"
            aria-expanded="${expanded}"
          >
            ${expanded ? "收起" : "展开"}
          </button>
        </div>
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
    renderPlatformDetail();
  }

  function openPlatformDetail(treeId, nodeId) {
    if (!treeId || !nodeId) {
      return;
    }
    composerOpen = false;
    detailEditing = false;
    detailNode = { treeId, nodeId };
    renderPlatformDetail();
    elements.platformDetail.classList.remove("hidden");
  }

  function closePlatformDetail() {
    detailNode = null;
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
    const duplicate = platformRecords.some(
      (item) => item.id === record.id || (record.eventId && item.eventId === record.eventId)
    );
    if (!duplicate) {
      platformRecords.unshift(record);
    }
  }

  async function loadPlatformRecords() {
    const tree = getActiveTree();
    if (!tree) {
      return;
    }
    try {
      const response = await window.fetch(`/api/records?treeId=${encodeURIComponent(tree.tree.id)}`, {
        credentials: "same-origin"
      });
      if (!response.ok) {
        return;
      }
      const data = await readJsonResponse(response);
      platformRecords = data && Array.isArray(data.records) ? data.records : [];
      render();
    } catch {
      // 拉取失败时保持已有列表，不打断浏览
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
    if (!detailNode) {
      return;
    }
    const { treeId, nodeId } = detailNode;
    const textInput = document.getElementById("practice-text");
    const imageInput = document.getElementById("practice-image");
    const text = textInput ? textInput.value.trim() : "";
    if (LOCAL_ONLY) {
      if (!text) {
        setPracticeStatus("写点文字再记一次。");
        return;
      }
      localPracticeRecords.unshift({
        id: createId(),
        treeId,
        nodeId,
        authorName: "我",
        createdAt: new Date().toISOString(),
        text,
        images: [],
        eventId: null
      });
      render();
      return;
    }
    let images = [];
    try {
      images = await collectPracticeImages(imageInput);
    } catch {
      setPracticeStatus("图片读取失败，请重试。");
      return;
    }
    if (!text && !images.length) {
      setPracticeStatus("写点文字或选一张图片。");
      return;
    }
    const result = await postPracticeRecord({ treeId, nodeId, text, images });
    if (!result.ok) {
      setPracticeStatus(result.message || "记录失败，请稍后再试。");
      return;
    }
    render();
  }

  async function collectPracticeImages(input) {
    if (!input || !input.files) {
      return [];
    }
    const files = Array.from(input.files).slice(0, 4);
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

  async function postPracticeRecord(payload) {
    try {
      const response = await window.fetch("/api/records", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data || !data.ok || !data.record) {
        return { ok: false, message: (data && data.message) || "记录失败，请稍后再试。" };
      }
      mergePlatformRecord(data.record);
      return { ok: true, record: data.record };
    } catch {
      return { ok: false, message: "无法连接到本地服务，请确认服务端已启动。" };
    }
  }

  // L1 自证：一次点击即确认，不打分、不判题。已确认的重复调用不改状态（幂等）。
  function confirmLightUp(id) {
    const lightUp = state.forest.lightups.find((item) => item.id === id);
    if (!lightUp || lightUp.status === "confirmed") {
      return;
    }
    lightUp.status = "confirmed";
    lightUp.confirmedAt = new Date().toISOString();
    void persistForest(id, lightUp);
    renderPlatformDetail();
  }

  function deleteLightUp(id) {
    const remaining = state.forest.lightups.filter((item) => item.id !== id);
    if (remaining.length === state.forest.lightups.length) {
      return;
    }
    state.forest.lightups = remaining;
    void persistForest(id, null);
    renderPlatformDetail();
  }

  // LOCAL_ONLY 写回同一 localStorage 键；否则从服务端取回 state、改 forest 后整份 PUT
  async function persistForest(id, replacement) {
    if (LOCAL_ONLY) {
      saveLocal();
      return;
    }
    await stateSync.update((raw) => {
      const serverState = raw || cloneDefaultState();
      const forest = serverState.forest || normalizeForest(null);
      const lightups = Array.isArray(forest.lightups) ? forest.lightups : [];
      // 只修改这一条，不把本页过期的整份 forest 写回。
      forest.lightups = lightups.flatMap((item) => item.id === id ? (replacement ? [replacement] : []) : [item]);
      serverState.forest = forest;
      return serverState;
    });
  }

  function applyAim(treeId, nodeId) {
    state.forest.selectedNodeId = nodeId;
    state.forest.selectedNodeAt = new Date().toISOString();
    if (treeId) {
      state.forest.activeTreeId = treeId;
    }
    // 已有文字不覆盖；只有空白时才补上节点标题
    if (!state.timer.predictedAction.trim()) {
      const node = getNodeById(treeId, nodeId);
      state.timer.predictedAction = node ? nodeTitle(node) : "";
    }
  }

  // 「去做」：瞄准节点、按需补上预测文字，然后交回习惯服务
  async function aimAndGo(treeId, nodeId) {
    if (!treeId || !nodeId || handoffBusy) {
      return;
    }
    applyAim(treeId, nodeId);
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
    return trees;
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
    return mergedTrees.find((tree) => tree.tree.id === state.forest.activeTreeId) || mergedTrees[0] || null;
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
      status: raw.status === "confirmed" ? "confirmed" : "draft",
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

  async function enterApp() {
    stateSync = new window.KHTStateSync(currentUser.id);
    const nextState = await stateSync.load();
    state = nextState ? normalizeState(nextState) : cloneDefaultState();
    showApp();
    if (!platformBooted) {
      await loadOverlay();
      bootPlatform();
      platformBooted = true;
      void loadPlatformRecords();
    } else {
      // 已启动：只重新并树、重建索引再渲染，不重复绑定事件
      await loadOverlay();
      rebuildIndexes();
      render();
    }
    // 启动加载本身不写服务端，等用户第一次改动再同步
    if (stateSync.pending) void stateSync.flush();
  }

  function returnToGate() {
    const passwordInput = document.getElementById("account-password");
    if (passwordInput) {
      passwordInput.value = "";
    }
    showGate();
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
        await enterApp();
      } catch (error) {
        showError(error.message || "连接失败，请稍后再试。");
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

    setMode("register");
    resolveInitialSession();
  }

  if (LOCAL_ONLY) {
    state = loadState();
    showApp();
    bootPlatform();
    platformBooted = true;
  } else {
    showGate();
    setupAccountGate();
  }
})();
