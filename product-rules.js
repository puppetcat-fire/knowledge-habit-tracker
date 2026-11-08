(function exposeProductRules(root) {
  // 纯规则：不上传数据、不修改事件，也不把五分钟经过等同于点亮。
  function recommendNextAction(tree, forest = {}, targetNodeId = null) {
    if (!tree || !tree.tree || !Array.isArray(tree.nodes)) return null;
    const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
    const edges = (tree.edges || []).filter((edge) => edge.type === "prereq" && nodes.has(edge.from) && nodes.has(edge.to));
    const confirmed = (forest.lightups || []).filter((item) => item.treeId === tree.tree.id && item.status === "confirmed");
    const lit = new Set(confirmed.map((item) => item.nodeId));
    const prerequisites = (id) => edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    const target = nodes.get(targetNodeId || forest.selectedNodeId);
    let node = null;
    let reason = "从一个可以开始的目标做起";
    if (target && !lit.has(target.id)) {
      const visited = new Set();
      function findStartingPoint(id) {
        if (visited.has(id)) return null;
        visited.add(id);
        for (const prerequisite of prerequisites(id)) {
          if (!lit.has(prerequisite)) {
            return findStartingPoint(prerequisite);
          }
        }
        return nodes.get(id);
      }
      node = findStartingPoint(target.id);
      reason = node && node.id !== target.id ? `为「${target.title || target.id}」先补一个前置` : "继续你选中的目标";
    }
    if (!node) {
      const last = confirmed.slice().sort((a, b) => Date.parse(b.confirmedAt || b.createdAt) - Date.parse(a.confirmedAt || a.createdAt))[0];
      const successors = new Set(last ? edges.filter((edge) => edge.from === last.nodeId).map((edge) => edge.to) : []);
      const candidates = tree.nodes.filter((candidate) => !lit.has(candidate.id) && prerequisites(candidate.id).every((id) => lit.has(id)));
      candidates.sort((a, b) => Number(successors.has(b.id)) - Number(successors.has(a.id)) || (a.estMinutes || 10) - (b.estMinutes || 10));
      node = candidates[0];
      if (node && successors.has(node.id)) reason = "接着你上次点亮的节点往下做";
    }
    return node ? { treeId: tree.tree.id, nodeId: node.id, title: node.title || node.id, goal: node.goal || "", verifyHint: node.verifyHint || "", estMinutes: node.estMinutes || 10, reason } : null;
  }

  function weekStart(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }

  function habitMilestone(habit, events, now = new Date()) {
    const currentWeek = weekStart(now);
    if (!habit || !currentWeek) return { achieved: false, counts: [0, 0, 0, 0] };
    const countsByWeek = new Map();
    const seen = new Set();
    const startTime = Date.parse(habit.startDate);
    (events || []).forEach((event) => {
      if (event.habitId !== habit.id || event.source === "quick-note") return;
      const eventTime = Date.parse(event.createdAt);
      if (!Number.isFinite(eventTime) || eventTime > Number(now) || (Number.isFinite(startTime) && eventTime < startTime)) return;
      if (event.id && seen.has(event.id)) return;
      if (event.id) seen.add(event.id);
      const key = weekStart(event.createdAt).getTime();
      countsByWeek.set(key, (countsByWeek.get(key) || 0) + 1);
    });
    const previousWeek = (date, offset) => {
      const result = new Date(date);
      result.setDate(result.getDate() + offset * 7);
      return result.getTime();
    };
    const counts = [-3, -2, -1, 0].map((offset) => countsByWeek.get(previousWeek(currentWeek, offset)) || 0);
    // 达成后保留资格，不因下一周开始、暂歇或月份切换而撤销。
    const achieved = Array.from(countsByWeek.keys()).some((key) => [0, 1, 2, 3].every((offset) => (countsByWeek.get(previousWeek(key, offset)) || 0) >= 5));
    return { achieved, counts };
  }

  function tutorialSnapshot(tutorial) {
    if (!tutorial || typeof tutorial.id !== "string" || typeof tutorial.title !== "string") return null;
    return {
      id: tutorial.id.slice(0, 64), version: typeof tutorial.version === "string" ? tutorial.version.slice(0, 64) : "seed-1",
      title: tutorial.title.slice(0, 80), method: typeof tutorial.method === "string" ? tutorial.method.slice(0, 8000) : "",
      startAction: typeof tutorial.startAction === "string" ? tutorial.startAction.slice(0, 240) : "",
      authorName: typeof tutorial.authorName === "string" ? tutorial.authorName.slice(0, 80) : "种子方法",
      ...(tutorial.archived === true ? { archived: true } : {})
    };
  }
  const rules = { recommendNextAction, habitMilestone, tutorialSnapshot };
  root.KHTProductRules = rules;
  if (typeof module !== "undefined" && module.exports) module.exports = rules;
})(globalThis);
