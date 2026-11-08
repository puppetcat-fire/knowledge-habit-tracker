const { recommendNextAction, habitMilestone } = require("../product-rules");

const tree = {
  tree: { id: "study" },
  nodes: [
    { id: "a", title: "起点", estMinutes: 10 },
    { id: "b", title: "目标", estMinutes: 15 },
    { id: "c", title: "实例", estMinutes: 5 }
  ],
  edges: [{ from: "a", to: "b", type: "prereq" }, { from: "c", to: "b", type: "instance-of" }]
};

describe("next five minutes", () => {
  it("offers an uncompleted prerequisite without treating instances as prerequisites", () => {
    expect(recommendNextAction(tree, { selectedNodeId: "b" }).nodeId).toBe("a");
    expect(recommendNextAction(tree, { selectedNodeId: "b", lightups: [{ treeId: "study", nodeId: "a", status: "confirmed" }] }).nodeId).toBe("b");
  });

  it("does not treat drafts or another tree's evidence as completion", () => {
    const forest = { selectedNodeId: "b", lightups: [{ treeId: "study", nodeId: "a", status: "draft" }, { treeId: "other", nodeId: "a", status: "confirmed" }] };
    expect(recommendNextAction(tree, forest).nodeId).toBe("a");
  });

  it("continues along the last confirmed node before another short root", () => {
    expect(recommendNextAction(tree, { lightups: [{ treeId: "study", nodeId: "a", status: "confirmed" }] }).nodeId).toBe("b");
  });

  it("returns no fabricated action when all goals are lit or content is missing", () => {
    expect(recommendNextAction(null)).toBeNull();
    expect(recommendNextAction(tree, { lightups: tree.nodes.map((node) => ({ treeId: "study", nodeId: node.id, status: "confirmed" })) })).toBeNull();
  });

  it("handles a cyclic imported graph without recursion failure", () => {
    const cyclic = { ...tree, edges: [...tree.edges, { from: "b", to: "a", type: "prereq" }] };
    expect(recommendNextAction(cyclic, { selectedNodeId: "b" })).not.toBeNull();
  });
});

const habit = { id: "h", startDate: "2026-08-01T00:00:00" };
function weeksOfEvents(offsets, source = "manual") {
  return offsets.flatMap((offset) => Array.from({ length: 5 }, (_, index) => {
    const date = new Date("2026-08-03T12:00:00");
    date.setDate(date.getDate() + offset * 7 + index);
    return { id: `${offset}-${index}`, habitId: "h", createdAt: date.toISOString(), source };
  }));
}

describe("four weeks with five completed practices", () => {
  it("requires four consecutive weeks and retains a historical achievement", () => {
    expect(habitMilestone(habit, weeksOfEvents([0, 1, 2, 3]), new Date("2026-09-30T12:00:00")).achieved).toBe(true);
    expect(habitMilestone(habit, weeksOfEvents([0, 1, 3, 4]), new Date("2026-09-30T12:00:00")).achieved).toBe(false);
  });

  it("excludes notes, other habits, future records and duplicate event ids", () => {
    const events = weeksOfEvents([0, 1, 2]);
    const lastWeek = weeksOfEvents([3]);
    const extras = [lastWeek[0], lastWeek[0], ...lastWeek.slice(1).map((event) => ({ ...event, source: "quick-note" })), ...lastWeek.map((event) => ({ ...event, habitId: "other" }))];
    expect(habitMilestone(habit, events.concat(extras), new Date("2026-08-31T12:00:00")).achieved).toBe(false);
    expect(habitMilestone(habit, weeksOfEvents([0, 1, 2, 3]), new Date("2026-08-24T10:00:00")).achieved).toBe(false);
  });

  it("allows the fifth practice in the current week and uses local Monday boundaries", () => {
    const events = weeksOfEvents([0, 1, 2, 3]);
    expect(habitMilestone(habit, events, new Date("2026-08-28T13:00:00"))).toEqual({ achieved: true, counts: [5, 5, 5, 5] });
    expect(habitMilestone(habit, events, new Date("2026-08-31T00:00:00")).counts).toEqual([5, 5, 5, 0]);
  });
});
