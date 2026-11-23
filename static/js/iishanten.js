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
    if (window.RiichiAgari.checkAll(suits)) {
      const tile = ID_TO_MJAI[id];
      const aka = _AKA_TILE_FOR_BASE[tile];
      waits.push({ tile, count: wall[id], aka_count: aka ? wall[MJAI_TO_ID[aka]] : 0 });
    }
    suit[rank]--;
  }
  return waits;
}

function _iishantenDraw(m, draw, hand, meldCounts, river) {
  const { base_mjai } = haipaiPrepTiles;
  const wall = m.iishanten_wall.slice();
  haipaiPrepBoardState.decrement_wall(wall, draw.tile);
  const drawnHand = [...hand, draw.tile];
  const branches = [];
  const support = new Map();
  let outcomes = 0, unavailable = false;
  // Identical copies are one choice, but keeping a red five scores
  // differently from keeping a regular five of the same suit.
  const shapes = new Map();
  for (const discard of new Set(drawnHand)) {
    const tenpai = drawnHand.slice();
    tenpai.splice(tenpai.indexOf(discard), 1);
    const base = base_mjai(discard);
    if (!shapes.has(base)) shapes.set(base, _iishantenWaits(tenpai, meldCounts, wall));
    const waits = shapes.get(base);
    if (!waits.length) continue;
    // Even a dead or no-yaku completion in the river locks ALL ron. The
    // current draw has cleared any earlier temporary pass; the original
    // decision's tenpai/furiten fields describe a different hand.
    const furiten = waits.some(w => w.tile === base || river.has(w.tile));
    const furitenSet = new Set(furiten ? waits.map(w => w.tile) : []);
    const live = _expandWaitsForAka(waits, furitenSet).filter(w => w.count > 0);
    const count = live.reduce((n, w) => n + w.count, 0);
    const groups = count ? _scoreTenpaiWaits(m, tenpai, live, false,
      "A wait is in your discard pool — ron is unavailable on every wait; tsumo is still possible.") : [];
    branches.push({ discard, count, groups });
    if (groups === null) { unavailable = true; continue; }
    for (const group of groups) {
      for (const score of [group.ron, group.tsumo]) {
        if (!score) continue; // furiten or no yaku: not a legal win
        outcomes++;
        for (const name of score.yaku) support.set(name, (support.get(name) || 0) + 1);
      }
    }
  }
  branches.sort((a, b) => b.count - a.count);
  // A solver discrepancy or incomplete score is unknown, not a conditional
  // yaku. Keep any available branch details inspectable in the expanded view.
  unavailable ||= !branches.length;
  const yaku = unavailable ? [] : Array.from(support, ([name, n]) => ({ name, confirmed: n === outcomes }));
  return { tile: draw.tile, count: draw.count, yaku, unavailable, branches };
}

// Null means missing/inapplicable data; [] means there are no unseen draws
// to examine. An empty branch.groups is known structural tenpai on dead waits.
function analyzeIishanten(m, discardTile, stat) {
  if (!m || stat?.shanten !== 1 || !Array.isArray(stat.necessary_tiles)
      || typeof window === "undefined" || !window.RiichiAgari || !window.Riichi
      || typeof haipaiPrepTiles === "undefined" || typeof haipaiPrepBoardState === "undefined"
      || typeof _scoreTenpaiWaits !== "function") return null;
  const { MJAI_TO_ID, ID_TO_MJAI, base_mjai, tile_id_to_base } = haipaiPrepTiles;
  const melds = m.melds || [], wall = m.iishanten_wall, board = m.board_state;
  const actor = m.actual?.actor ?? m.expected?.actor;
  const discards = board?.all_discards?.find(r => r.seat === actor)?.discards;
  if (!Array.isArray(discards) || !_windToKazeInt(board.round_wind) || !_windToKazeInt(board.seat_wind)
      || !Array.isArray(board.dora_tiles) || !Array.isArray(wall) || wall.length !== 37
      || !Array.isArray(m.hand) || m.hand.length !== 14 - 3 * melds.length
      || base_mjai(stat.tile) !== base_mjai(discardTile) || !m.hand.includes(discardTile)) return null;
  const cached = _iishantenCache.get(m);
  const hit = cached?.get(discardTile);
  if (hit?.stat === stat) return hit.result;
  for (let i = 0; i < 37; i++) {
    if (!Number.isInteger(wall[i]) || wall[i] < 0 || wall[i] > (i < 34 ? 4 : 1)
        || (i >= 34 && wall[i] > wall[tile_id_to_base(i)])) return null;
  }
  if (board.dora_tiles.some(t => MJAI_TO_ID[t] == null)) return null;

  const meldCounts = Array(34).fill(0);
  for (const meld of melds) {
    const tiles = _meldTiles(meld);
    if (!tiles || tiles.some(t => MJAI_TO_ID[t] == null)) return null;
    for (const t of tiles) meldCounts[tile_id_to_base(MJAI_TO_ID[t])]++;
  }
  const river = new Set([base_mjai(discardTile)]);
  for (const entry of discards) {
    if (MJAI_TO_ID[entry.tile] == null) return null;
    river.add(base_mjai(entry.tile));
  }
  const hand = m.hand.slice();
  if (hand.some(t => MJAI_TO_ID[t] == null)) return null;
  hand.splice(hand.indexOf(discardTile), 1); // discarding does not replenish unseen copies
  const result = [];
  const bases = new Set(stat.necessary_tiles.map(w => tile_id_to_base(MJAI_TO_ID[w.tile])));
  for (const id of bases) {
    if (id == null) return null;
    const tile = ID_TO_MJAI[id], aka = _AKA_TILE_FOR_BASE[tile];
    const waits = [{ tile, count: wall[id], aka_count: aka ? wall[MJAI_TO_ID[aka]] : 0 }];
    for (const draw of _expandWaitsForAka(waits, new Set())) {
      if (draw.count > 0) result.push(_iishantenDraw(m, draw, hand, meldCounts, river));
    }
  }
  if (!result.some(d => d.unavailable)) {
    const byDiscard = cached || new Map();
    byDiscard.set(discardTile, { stat, result });
    if (!cached) _iishantenCache.set(m, byDiscard);
  }
  return result;
}
