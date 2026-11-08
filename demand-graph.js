const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createDemandGraph({ directory, readJsonFile, writeJsonFile, readWants, seed, moderatorId }) {
  const moderationFile = path.join(directory, "groups.json");
  const tutorials = seed.tutorials.map((tutorial) => ({
    id: tutorial.id,
    treeId: seed.tree.id,
    nodeId: tutorial.nodeId,
    title: tutorial.title,
    version: tutorial.version,
    method: tutorial.method
  }));
  const tutorialById = new Map(tutorials.map((tutorial) => [tutorial.id, tutorial]));

  function snapshot(id) {
    return tutorialById.get(id) || null;
  }

  function resolveGroup(id, aliases) {
    while (Object.prototype.hasOwnProperty.call(aliases, id)) id = aliases[id];
    return id;
  }

  function readGroups() {
    const { aliases, moves, history = [] } = readJsonFile(moderationFile, { aliases: {}, moves: {} });
    let files;
    try {
      files = fs.readdirSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files = [];
    }
    const groups = new Map();
    for (const file of files.filter((name) => /^[a-f0-9]{24}\.json$/.test(name))) {
      for (const want of readWants(path.join(directory, file))) {
        const share = want.publication;
        if (!share) continue;
        const move = moves[share.id];
        const id = resolveGroup(move?.from === share.groupId ? move.to : share.groupId, aliases);
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push({ share, owner: file, status: want.status });
      }
    }
    return { groups, aliases, moves, history };
  }

  function browse(query) {
    const { groups, aliases } = readGroups();
    const search = typeof query.q === "string" ? query.q.slice(0, 120).trim().toLowerCase() : "";
    const result = [];
    for (const [id, entries] of groups) {
      if (query.group && resolveGroup(query.group, aliases) !== id) continue;
      if (query.publication && !entries.some(({ share }) => share.id === query.publication)) continue;
      if (query.tutorial && !entries.some(({ share }) => share.tutorial?.id === query.tutorial)) continue;
      if (search && !entries.some(({ share }) =>
        [share.title, share.summary, share.specification, share.tutorial?.title].some((value) => value?.toLowerCase().includes(search)))) continue;
      const wanted = new Set();
      const considering = new Set();
      const resolved = new Set();
      const publications = entries.map(({ share, owner, status }) => {
        if (status === "open") wanted.add(owner);
        if (status === "open" && share.intent === "considering") considering.add(owner);
        if (status === "resolved") resolved.add(owner);
        // Public fields are explicitly copied. Private records never leave the server.
        const { id, title, summary, specification, wait, secondhand, intent, tutorial, tutorialUse, tutorialStep, publishedAt } = share;
        return { id, title, summary, specification, wait, secondhand, intent, tutorial, tutorialUse, tutorialStep, publishedAt, status };
      }).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
      result.push({ id, title: publications[0].title, wanted: wanted.size, considering: considering.size, resolved: resolved.size, publications });
    }
    return { ok: true, groups: result.sort((a, b) => b.wanted - a.wanted), tutorials };
  }

  function publish(want, input) {
    if (!input || typeof input.title !== "string") return null;
    const title = input.title.trim();
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    const specification = typeof input.specification === "string" ? input.specification.trim() : "";
    const wait = typeof input.wait === "string" ? input.wait.trim() : "";
    if (!title || title.length > 120 || summary.length > 1200 || specification.length > 500 || wait.length > 100) return null;
    if (!["want", "considering"].includes(input.intent) || !["unspecified", "yes", "no"].includes(input.secondhand)) return null;
    const previous = want.publication;
    const tutorial = input.tutorialId
      ? previous?.tutorial?.id === input.tutorialId ? previous.tutorial
        : want.tutorial?.id === input.tutorialId ? want.tutorial : snapshot(input.tutorialId)
      : null;
    if (input.tutorialId && !tutorial) return null;
    const tutorialUse = ["choose", "alternative", "make", "use"].includes(input.tutorialUse) ? input.tutorialUse : "use";
    const tutorialStep = tutorial && typeof input.tutorialStep === "string" ? input.tutorialStep.trim().slice(0, 240) : "";
    const groupId = input.groupId || previous?.groupId || randomUUID();
    if (input.groupId && !readGroups().groups.has(input.groupId)) return null;
    return {
      id: previous?.id || randomUUID(), groupId, title, summary, specification, wait,
      secondhand: input.secondhand, intent: input.intent, tutorial, tutorialUse, tutorialStep,
      publishedAt: previous?.publishedAt || new Date().toISOString()
    };
  }

  function moderate(input) {
    if (!input || typeof input.groupId !== "string") return null;
    const { groups, aliases, moves, history } = readGroups();
    const entries = groups.get(input.groupId);
    if (!entries) return null;
    let destination;
    if (input.action === "merge" && input.into !== input.groupId && groups.has(input.into)) {
      destination = input.into;
      aliases[input.groupId] = destination;
    } else if (input.action === "split" && entries.length > 1 && entries.some(({ share }) => share.id === input.publicationId)) {
      destination = randomUUID();
      const entry = entries.find(({ share }) => share.id === input.publicationId);
      moves[input.publicationId] = { from: entry.share.groupId, to: destination };
    } else {
      return null;
    }
    history.push({
      action: input.action, from: input.groupId, to: destination,
      ...(input.action === "split" ? { publicationId: input.publicationId } : {}),
      at: new Date().toISOString()
    });
    writeJsonFile(moderationFile, { aliases, moves, history });
    return destination;
  }

  return { browse, publish, moderate, snapshot, isModerator: (id) => Boolean(id && id === moderatorId) };
}

module.exports = { createDemandGraph };
