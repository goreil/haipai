// Pure structural evidence. No board state, strategy, or scoring claims.
// Contract and retention policy: docs/hand-blocks.md.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tiles.js"));
  } else {
    root.haipaiHandBlocks = factory(root.haipaiPrepTiles);
  }
}(typeof self !== "undefined" ? self : this, function (tilesMod) {
  "use strict";

  const { mjai_to_tile_id, tile_id_to_base, ID_TO_MJAI } = tilesMod;
  const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const KINDS = ["sequence", "triplet", "pair", "side", "closed", "edge", "singleton"];
  const outside = id => id >= 27 || id % 9 === 0 || id % 9 === 8;
  function baseId(tile) {
    if (typeof tile !== "string") throw new Error("Tile must be an mjai string");
    const id = mjai_to_tile_id(tile);
    if (!Number.isInteger(id) || id < 0 || id > 36) throw new Error("Unknown mjai tile: " + tile);
    return tile_id_to_base(id);
  }
  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  function countsFromTiles(tiles) {
    const counts = Array(34).fill(0);
    for (const tile of tiles) counts[baseId(tile)]++;
    return counts;
  }

  function normalize({ counts, tiles, melds = [] }) {
    if (!counts || counts.length !== 34 || !Array.from(counts).every(n => Number.isInteger(n) && n >= 0 && n <= 4)) {
      throw new Error("counts must contain 34 integers between zero and four");
    }
    counts = Array.from(counts);
    if (!Array.isArray(melds) || melds.length > 4) throw new Error("At most four fixed melds are allowed");
    if (tiles !== undefined && !Array.isArray(tiles)) throw new Error("tiles must be an array of mjai tiles");
    const concealed = tiles === undefined
      ? counts.flatMap((n, id) => Array(n).fill(ID_TO_MJAI[id])) : Array.from(tiles);
    if (countsFromTiles(concealed).some((n, id) => n !== counts[id])) {
      throw new Error("tiles must match concealed counts, including red fives in their base count");
    }
    const sortTiles = list => list.slice().sort((a, b) => baseId(a) - baseId(b)
      || mjai_to_tile_id(a) - mjai_to_tile_id(b));
    const fixedMelds = melds.map(meld => {
      if (!["chi", "pon", "ankan", "kakan", "daiminkan"].includes(meld.type)) {
        throw new Error("Unknown fixed meld type: " + meld.type);
      }
      // Stored player fuuros retain the original two consumed pon tiles and
      // previous_pon_pai; raw mjai kakan events instead consume all three.
      const previousPonTile = meld.type === "kakan" && (meld.consumed || []).length === 2
        && meld.previous_pon_pai != null ? [meld.previous_pon_pai] : [];
      const physical = sortTiles(meld.tiles !== undefined ? meld.tiles
        : [...(meld.consumed || []), ...previousPonTile, ...(meld.pai == null ? [] : [meld.pai])]);
      const ids = physical.map(baseId);
      const kan = ["ankan", "kakan", "daiminkan"].includes(meld.type);
      const valid = ids.length === (kan ? 4 : 3) && (meld.type === "chi"
        ? ids[0] < 27 && ids[0] % 9 <= 6 && ids[1] === ids[0] + 1 && ids[2] === ids[0] + 2
        : ids.every(id => id === ids[0]));
      if (!valid) throw new Error("Invalid physical tiles for " + meld.type);
      return { type: meld.type, kind: kan ? "kan" : meld.type === "chi" ? "sequence" : "triplet",
        fixed: true, tiles: physical, tileIds: ids, closed: meld.type === "ankan" };
    }).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
    const totalCounts = counts.slice();
    for (const meld of fixedMelds) for (const id of meld.tileIds) totalCounts[id]++;
    if (totalCounts.some(n => n > 4)) throw new Error("More than four physical copies of a tile");
    const redCounts = [0, 0, 0];
    for (const tile of [...concealed, ...fixedMelds.flatMap(m => m.tiles)]) {
      const id = mjai_to_tile_id(tile);
      if (id >= 34 && ++redCounts[id - 34] > 1) throw new Error("Duplicate red five");
    }
    if (concealed.length > 14 - 3 * fixedMelds.length) throw new Error("Too many concealed tiles for fixed melds");
    const sortedTiles = sortTiles(concealed);
    const key = JSON.stringify([sortedTiles, fixedMelds]);
    return { counts, tiles: sortedTiles, fixedMelds, totalCounts, key };
  }

  function completionIds(kind, ids) {
    const first = ids[0];
    if (kind === "pair") return [first];
    if (kind === "closed") return [first + 1];
    if (kind === "edge") return [first % 9 === 0 ? first + 2 : first - 1];
    if (kind === "side") return [first - 1, first + 2];
    return [];
  }

  // Enumerate canonical, non-overlapping allocations. Requiring increasing
  // group codes removes permutations even when several groups start alike.
  // No suit-local minimum-component or complete-set pruning is safe here.
  function enumerate(counts, visit) {
    const groups = [];
    function walk(previousCode) {
      const first = counts.findIndex(n => n > 0);
      if (first < 0) { visit(groups); return; }
      function take(kind, ids) {
        const code = first * KINDS.length + KINDS.indexOf(kind);
        if (code < previousCode) return;
        for (const id of ids) counts[id]--;
        groups.push({ kind, tileIds: ids });
        walk(code);
        groups.pop();
        for (const id of ids) counts[id]++;
      }
      if (first < 27 && first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
        take("sequence", [first, first + 1, first + 2]);
      }
      if (counts[first] >= 3) take("triplet", [first, first, first]);
      if (counts[first] >= 2) take("pair", [first, first]);
      if (first < 27) {
        if (first % 9 <= 7 && counts[first + 1]) {
          take(first % 9 === 0 || first % 9 === 7 ? "edge" : "side", [first, first + 1]);
        }
        if (first % 9 <= 6 && counts[first + 2]) take("closed", [first, first + 2]);
      }
      take("singleton", [first]);
    }
    walk(-1);
  }

  function summarize(groups, fixedMelds) {
    let completeSets = fixedMelds.length, pairs = 0, incomplete = 0, sideWaits = 0, singletonCount = 0;
    let outsideCompatible = fixedMelds.every(g => g.tileIds.some(outside));
    for (const g of groups) {
      if (g.kind === "singleton") { singletonCount++; continue; }
      if (g.kind === "pair") pairs++;
      else if (g.kind === "sequence" || g.kind === "triplet") completeSets++;
      else { incomplete++; if (g.kind === "side") sideWaits++; }
      if (!g.tileIds.some(outside) && !completionIds(g.kind, g.tileIds).some(outside)) outsideCompatible = false;
    }
    return { groups: groups.slice(), completeSets, pairs, incomplete, sideWaits, singletonCount, outsideCompatible,
      allocationKey: groups.map(g => `${KINDS.indexOf(g.kind)}:${g.tileIds.join(".")}`).join("/") };
  }

  function describe(summary, headIndex) {
    const { groups, completeSets, pairs, incomplete, sideWaits, singletonCount, outsideCompatible } = summary;
    const hasHead = headIndex !== null;
    const setCandidates = pairs + incomplete - Number(hasHead);
    const occupiedSetSlots = Math.min(4, completeSets + setCandidates);
    const candidateBlockCount = completeSets + pairs + incomplete;
    const missingSetSlots = 4 - occupiedSetSlots;
    const missingHead = !hasHead;
    const excessCandidates = Math.max(0, setCandidates - (4 - completeSets));
    const shanten = 8 - 2 * completeSets - Math.min(setCandidates, 4 - completeSets) - Number(hasHead);
    const headTile = hasHead ? groups[headIndex].tileIds[0] : null;
    const key = summary.allocationKey + `@${headIndex}`;
    return { key, groups, headIndex, headTile, completeSets,
      occupiedSetSlots, missingSetSlots, missingHead, missingSlots: missingSetSlots + Number(missingHead),
      candidateBlockCount, excessCandidates, shanten, outsideCompatible, sideWaits, singletonCount };
  }

  function compareConfigurations(a, b) {
    return a.shanten - b.shanten || a.excessCandidates - b.excessCandidates
      || a.missingSlots - b.missingSlots || b.completeSets - a.completeSets
      || b.sideWaits - a.sideWaits || a.singletonCount - b.singletonCount || compareText(a.key, b.key);
  }

  // Retain a representative of each head, block count, outside compatibility,
  // and optimal tile role before filling by structural rank. Truncation is
  // explicit: a retained sample must never prove that an alternative is absent.
  function retain(candidates, limit, minimumShanten) {
    candidates.sort(compareConfigurations);
    const representatives = new Map();
    function offer(feature, config) {
      if (!representatives.has(feature)) representatives.set(feature, config);
    }
    for (const c of candidates) offer(`head:${c.headTile}`, c);
    for (const c of candidates) offer(`blocks:${c.candidateBlockCount}`, c);
    for (const c of candidates) offer(`outside:${c.outsideCompatible}`, c);
    for (const c of candidates) {
      if (c.shanten !== minimumShanten) continue;
      c.groups.forEach((g, i) => g.tileIds.forEach(id => offer(`role:${id}:${i === c.headIndex ? "head" : g.kind}`, c)));
    }
    const selected = new Map([[candidates[0].key, candidates[0]]]);
    for (const c of [...representatives.values(), ...candidates]) {
      if (selected.size >= limit) break;
      selected.set(c.key, c);
    }
    return [...selected.values()].sort(compareConfigurations);
  }

  function materialize(config, tiles) {
    const pools = Array.from({ length: 34 }, () => []);
    tiles.forEach((tile, index) => pools[baseId(tile)].push(index));
    const blocks = config.groups.map((g, i) => {
      const tileIndices = g.tileIds.map(id => pools[id].shift());
      const role = i === config.headIndex ? "head" : g.kind === "pair" ? "triplet_candidate"
        : g.kind === "singleton" ? config.missingHead ? "head_candidate" : "unassigned"
        : ["sequence", "triplet"].includes(g.kind) ? "set" : "set_candidate";
      return { kind: g.kind, role, fixed: false, tileIds: g.tileIds,
        tileIndices, tiles: tileIndices.map(index => tiles[index]),
        completionTileIds: role === "head" ? [] : role === "head_candidate" ? [g.tileIds[0]]
          : completionIds(g.kind, g.tileIds) };
    });
    const { groups, sideWaits, singletonCount, ...metadata } = config;
    return { ...metadata, blocks };
  }

  function specialHands(input) {
    if (input.fixedMelds.length) return { sevenPairs: null, thirteenOrphans: null };
    const pools = Array.from({ length: 34 }, () => []);
    input.tiles.forEach((tile, i) => pools[baseId(tile)].push(i));
    function group(kind, tileIndices) {
      return { kind, tileIndices, tiles: tileIndices.map(i => input.tiles[i]) };
    }
    const pairIds = input.counts.flatMap((n, id) => n >= 2 ? [id] : []);
    const unique = input.counts.filter(n => n > 0).length;
    const pairIndices = new Set(pairIds.flatMap(id => pools[id].slice(0, 2)));
    const sevenPairs = {
      shanten: 6 - pairIds.length + Math.max(0, 7 - unique),
      pairs: pairIds.map(id => group("pair", pools[id].slice(0, 2))),
      leftovers: input.tiles.flatMap((_, i) => pairIndices.has(i) ? [] : [group("singleton", [i])]),
      missingPairs: Math.max(0, 7 - pairIds.length),
    };
    const present = ORPHANS.filter(id => input.counts[id] > 0);
    const possibleHeads = present.filter(id => input.counts[id] >= 2);
    const headTile = possibleHeads[0] ?? null;
    const orphanBlocks = present.map(id => group(id === headTile ? "pair" : "singleton",
      pools[id].slice(0, id === headTile ? 2 : 1)));
    const used = new Set(orphanBlocks.flatMap(b => b.tileIndices));
    const thirteenOrphans = {
      shanten: 13 - present.length - Number(headTile !== null), headTile, possibleHeads,
      missingTileIds: ORPHANS.filter(id => !input.counts[id]), blocks: orphanBlocks,
      leftovers: input.tiles.flatMap((_, i) => used.has(i) ? [] : [group("singleton", [i])]),
    };
    return { sevenPairs, thirteenOrphans };
  }

  function createEngine({ cacheSize = 64, maxConfigurations = 128 } = {}) {
    if (!Number.isInteger(cacheSize) || cacheSize < 0 || cacheSize > 1024
        || !Number.isInteger(maxConfigurations) || maxConfigurations < 1 || maxConfigurations > 4096) {
      throw new Error("cacheSize must be 0..1024; maxConfigurations must be 1..4096");
    }
    const cache = new Map();
    let hits = 0, misses = 0;
    function analyzeHand(raw) {
      const input = normalize(raw);
      if (cache.has(input.key)) {
        const result = cache.get(input.key);
        cache.delete(input.key);
        cache.set(input.key, result);
        hits++;
        return result;
      }
      misses++;
      const candidates = [];
      enumerate(input.counts.slice(), groups => {
        const summary = summarize(groups, input.fixedMelds);
        if (summary.completeSets > 4) return;
        // Identical pairs in one allocation have equivalent head assignments.
        const headIndices = [null];
        const seen = new Set();
        groups.forEach((g, i) => {
          if (g.kind === "pair" && !seen.has(g.tileIds[0])) {
            headIndices.push(i);
            seen.add(g.tileIds[0]);
          }
        });
        for (const head of headIndices) {
          candidates.push(describe(summary, head));
        }
      });
      const shanten = candidates.reduce((best, c) => Math.min(best, c.shanten), 8);
      const configurations = retain(candidates, maxConfigurations, shanten).map(c => materialize(c, input.tiles));
      const result = freeze({ ...input, standard: { shanten, configurations,
        totalConfigurations: candidates.length, truncated: candidates.length > configurations.length,
        exhaustive: true }, ...specialHands(input) });
      if (cacheSize) {
        cache.set(input.key, result);
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      }
      return result;
    }
    function analyzeTiles(tiles, melds = []) {
      return analyzeHand({ counts: countsFromTiles(tiles), tiles, melds });
    }
    return { analyzeHand, analyzeTiles,
      clearCache() { cache.clear(); hits = 0; misses = 0; },
      cacheInfo() { return { size: cache.size, capacity: cacheSize, hits, misses, maxConfigurations }; } };
  }

  // Board-sensitive immediate block completions, deliberately separate from
  // structural caching. The union is NOT full-hand ukeire or multi-draw EV.
  function evaluateAvailability(analysis, wall) {
    if (!wall || ![34, 37].includes(wall.length)
        || !Array.from(wall).every(n => Number.isInteger(n) && n >= 0 && n <= 4)) {
      throw new Error("wall must contain 34 or 37 unseen-copy counts");
    }
    const liveCount = id => Math.min(wall[id], 4 - analysis.totalCounts[id]);
    const configurations = analysis.standard.configurations.map(config => {
      const union = new Set();
      const blocks = config.blocks.map(block => {
        const completions = block.completionTileIds.map(id => {
          union.add(id);
          return { tileId: id, tile: ID_TO_MJAI[id], count: liveCount(id) };
        });
        const liveCompletionCount = completions.reduce((sum, t) => sum + t.count, 0);
        return { completions, liveCompletionCount,
          dead: completions.length > 0 && liveCompletionCount === 0 };
      });
      const completionTiles = [...union].sort((a, b) => a - b).map(id => ({ tileId: id, count: liveCount(id) }));
      return { key: config.key, blocks, completionTiles,
        liveCompletionCount: completionTiles.reduce((sum, t) => sum + t.count, 0) };
    });
    return { configurations };
  }

  return { createEngine, countsFromTiles, evaluateAvailability, ...createEngine() };
}));
