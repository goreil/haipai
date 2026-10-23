// On-demand presentation data for HP-02. No board/yaku/defense inference.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./hand-blocks.js"));
  } else root.haipaiBlockViewPrep = factory(root.haipaiHandBlocks);
}(typeof self !== "undefined" ? self : this, function (blocks) {
  const engine = blocks.createEngine({ cacheSize: 32 });

  function canGroup(m) {
    return Array.isArray(m.hand) && m.hand.length > 0
      && m.hand.length === 14 - 3 * (m.melds || []).length;
  }

  function prepareHand(m) {
    if (!canGroup(m)) return null;
    const result = engine.analyzeTiles(m.hand, m.melds || []);
    return { result, options: interpretations(result) };
  }

  function interpretations(result) {
    // Offer a small deterministic set with distinct heads, block counts or waits.
    // Include retained six-block plans even if their structural distance differs.
    const options = [], signatures = new Set();
    const configurations = result.standard.configurations;
    const counts = new Set([configurations[0].candidateBlockCount]);
    const blockCountAlternatives = configurations.filter(c => {
      if (c.shanten > result.standard.shanten + 1 || counts.has(c.candidateBlockCount)) return false;
      counts.add(c.candidateBlockCount);
      return true;
    });
    for (const config of [configurations[0], ...blockCountAlternatives, ...configurations]) {
      const waits = config.blocks.filter(b => ["side", "closed", "edge", "pair"].includes(b.kind))
        .map(b => `${b.kind}:${b.role}:${b.tiles.join(",")}`).join("|");
      const signature = `${config.headTile}:${config.candidateBlockCount}:${waits}`;
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      const head = config.headIndex === null ? "no head" : `head ${config.blocks[config.headIndex].tiles[0]}`;
      options.push({ id: `standard-${options.length}`, label: options.length
        ? `${config.candidateBlockCount} blocks · ${head} · grouping ${options.length + 1}`
        : "Four sets + pair · default", shanten: config.shanten, config, blocks: config.blocks });
      if (options.length === 8) break;
    }
    if (result.sevenPairs) options.push({ id: "sevenPairs", label: "Seven pairs",
      shanten: result.sevenPairs.shanten, config: result.sevenPairs,
      blocks: [...result.sevenPairs.pairs, ...result.sevenPairs.leftovers] });
    if (result.thirteenOrphans) options.push({ id: "thirteenOrphans", label: "Thirteen orphans",
      shanten: result.thirteenOrphans.shanten, config: result.thirteenOrphans,
      blocks: [...result.thirteenOrphans.blocks, ...result.thirteenOrphans.leftovers] });
    // Prefer a special model only when it has strictly lower structural distance.
    const best = Math.min(...options.map(o => o.shanten));
    const preferred = options.findIndex(o => o.shanten === best);
    return [options[preferred], ...options.filter((_, i) => i !== preferred)];
  }

  return { canGroup, prepareHand, interpretations,
    cacheInfo: engine.cacheInfo, clearCache: engine.clearCache };
}));
