(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./vendor/riichi/riichi-bundle.js"), require("./bad-riichi-bars.js"),
      require("./prep/tiles.js"), require("./prep/prep-board-state.js"));
  } else {
    Object.assign(root, factory(root, root, root.haipaiPrepTiles, root.haipaiPrepBoardState));
  }
}(globalThis, function (vendor, { _AKA_TILE_FOR_BASE, _meldTiles, _expandWaitsForAka, _iishantenRiichiFlags,
  _scoreTenpaiWaits, scoringDiscardRiver, profileWaitScores }, haipaiPrepTiles, haipaiPrepBoardState) {

// One draw beyond a specific iishanten discard. The wall describes unseen
// copies, not the actual wall order or a probability of winning. A draw is
// counted once no matter how many tenpai discards it permits.
const _iishantenCache = new WeakMap();

function _iishantenWaits(hand, meldCounts, wall) {
  const { MJAI_TO_ID, ID_TO_MJAI, tile_id_to_base } = haipaiPrepTiles;
  // RiichiAgari.checkAll tests the concealed portion for a complete shape
  // (including chiitoitsu/kokushi); its length already accounts for melds.
  const suits = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0), Array(7).fill(0)];
  for (const tile of hand) {
    const id = tile_id_to_base(MJAI_TO_ID[tile]);
    suits[Math.floor(id / 9)][id % 9]++;
  }
  const waits = [];
  for (let id = 0; id < 34; id++) {
    const suit = suits[Math.floor(id / 9)], rank = id % 9;
    if (suit[rank] + meldCounts[id] >= 4) continue; // no fifth physical copy
    suit[rank]++;
    if (vendor.RiichiAgari.checkAll(suits)) {
      const tile = ID_TO_MJAI[id];
      const aka = _AKA_TILE_FOR_BASE[tile];
      waits.push({ tile, count: wall[id], aka_count: aka ? wall[MJAI_TO_ID[aka]] : 0 });
    }
    suit[rank]--;
  }
  return waits;
}

// Value is peak legal points first, then mean points on a legal win.
function _compareIishantenValue(a, b) {
  return a.profile.maxPoints - b.profile.maxPoints || a.profile.meanPoints - b.profile.meanPoints;
}

function _iishantenDraw(m, draw, hand, meldCounts, river, riichiFlags) {
  const { base_mjai } = haipaiPrepTiles;
  const wall = m.iishanten_wall.slice();
  haipaiPrepBoardState.decrement_wall(wall, draw.tile);
  const drawnHand = [...hand, draw.tile];
  const branches = [];
  // Identical copies are one choice, but keeping a red five scores
  // differently from keeping a regular five of the same suit.
  const shapes = new Map();
  for (const discard of new Set(drawnHand)) {
    const tenpai = drawnHand.slice();
    tenpai.splice(tenpai.indexOf(discard), 1);
    const base = base_mjai(discard);
    if (!shapes.has(base)) {
      const waits = _iishantenWaits(tenpai, meldCounts, wall);
      // Base counts already include red copies. Do not count them twice.
      shapes.set(base, { waits, count: waits.reduce((n, w) => n + w.count, 0) });
    }
    const { waits, count } = shapes.get(base);
    if (!waits.length) continue;
    // Even a dead or no-yaku completion in the river locks ALL ron. The
    // current draw has cleared any earlier temporary pass; the original
    // decision's tenpai/furiten fields describe a different hand.
    const furiten = waits.some(w => w.tile === base || river.has(w.tile));
    const furitenSet = new Set(furiten ? waits.map(w => w.tile) : []);
    const live = _expandWaitsForAka(waits, furitenSet).filter(w => w.count > 0);
    const groups = count ? _scoreTenpaiWaits(m, tenpai, live, false,
      "A wait is in your discard pool — ron is unavailable on every wait; tsumo is still possible.", riichiFlags) : [];
    branches.push({ discard, count, groups, profile: profileWaitScores(groups, false) });
  }

  const widest = Math.max(...branches.map(b => b.count));
  const fastest = branches.filter(b => b.count === widest);
  const highest = branches.length && branches.every(b => b.groups !== null)
    ? branches.reduce((best, b) => _compareIishantenValue(b, best) > 0 ? b : best) : null;
  const isHighest = b => highest?.profile?.maxPoints > 0 && _compareIishantenValue(b, highest) === 0;
  const hasBest = fastest.some(isHighest);
  for (const b of branches) {
    const speed = b.count === widest && widest > 0;
    const value = isHighest(b);
    b.label = speed && value ? "Best" : !hasBest && speed ? "Speed" : !hasBest && value ? "Value" : "Cut";
  }
  // Keep the draw summary width-first, independent of which cut is inspected.
  let branch = fastest[0] ?? null;
  if (fastest.length > 1) {
    branch = fastest.some(b => b.groups === null) ? null
      : fastest.reduce((best, b) => _compareIishantenValue(b, best) > 0 ? b : best);
  }
  const yaku = Object.entries(branch?.profile?.yaku ?? {}).map(([name, share]) => ({ name, confirmed: share === 1 }));
  return { tile: draw.tile, count: draw.count, yaku, unavailable: branch?.groups == null, branch, branches };
}

// Null means missing/inapplicable data; [] means there are no unseen draws
// to examine. An empty branch.groups is known structural tenpai on dead waits.
function analyzeIishanten(m, discardTile, stat) {
  if (!m || stat?.shanten !== 1 || !vendor.RiichiAgari || !vendor.Riichi) return null;
  const { MJAI_TO_ID, ID_TO_MJAI, tile_id_to_base, base_mjai } = haipaiPrepTiles;
  const melds = m.melds || [], wall = m.iishanten_wall;
  const cached = _iishantenCache.get(m);
  const hit = cached?.get(discardTile);
  if (hit?.stat === stat) return hit.result;
  const entries = scoringDiscardRiver(m, discardTile, stat);
  if (!entries || !Array.isArray(wall) || wall.length !== 37) return null;
  const river = new Set([base_mjai(discardTile)]);
  for (const d of entries) river.add(base_mjai(d.tile));
  for (let i = 0; i < 37; i++) {
    if (!Number.isInteger(wall[i]) || wall[i] < 0 || wall[i] > (i < 34 ? 4 : 1)
        || (i >= 34 && wall[i] > wall[tile_id_to_base(i)])) return null;
  }

  const meldCounts = Array(34).fill(0);
  for (const meld of melds) {
    const tiles = _meldTiles(meld);
    if (!tiles || tiles.some(t => MJAI_TO_ID[t] == null)) return null;
    for (const t of tiles) meldCounts[tile_id_to_base(MJAI_TO_ID[t])]++;
  }
  const hand = m.hand.slice();
  hand.splice(hand.indexOf(discardTile), 1); // discarding does not replenish unseen copies
  const result = [];
  const riichiFlags = _iishantenRiichiFlags(m);
  if (riichiFlags === null) return null;
  const bases = new Set(stat.necessary_tiles.map(w => tile_id_to_base(MJAI_TO_ID[w.tile])));
  for (const id of bases) {
    const tile = ID_TO_MJAI[id], aka = _AKA_TILE_FOR_BASE[tile];
    const waits = [{ tile, count: wall[id], aka_count: aka ? wall[MJAI_TO_ID[aka]] : 0 }];
    for (const draw of _expandWaitsForAka(waits, new Set())) {
      if (draw.count > 0) result.push(_iishantenDraw(m, draw, hand, meldCounts, river, riichiFlags));
    }
  }
  if (!result.some(d => d.unavailable || d.branches.some(b => b.groups === null))) {
    const byDiscard = cached || new Map();
    byDiscard.set(discardTile, { stat, result });
    if (!cached) _iishantenCache.set(m, byDiscard);
  }
  return result;
}

return { analyzeIishanten };
}));
