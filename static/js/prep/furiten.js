// Furiten detection — twin of lib/furiten.py. Pure logic; depends only on
// prep/shanten.js.
//
// Furiten: a tenpai hand whose wait includes a tile the player has already
// discarded — ron locked, tsumo only. Used by 5A (bad riichi) categorization.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const shanten = require("./shanten.js");
    module.exports = factory(shanten);
  } else {
    root.haipaiPrepFuriten = factory(root.haipaiShanten);
  }
}(typeof self !== "undefined" ? self : this, function (shantenMod) {

  const MJAI_TO_BASE = {
    "1m": 0, "2m": 1, "3m": 2, "4m": 3, "5m": 4, "6m": 5, "7m": 6, "8m": 7, "9m": 8,
    "1p": 9, "2p": 10, "3p": 11, "4p": 12, "5p": 13, "6p": 14, "7p": 15, "8p": 16, "9p": 17,
    "1s": 18, "2s": 19, "3s": 20, "4s": 21, "5s": 22, "6s": 23, "7s": 24, "8s": 25, "9s": 26,
    "E": 27, "S": 28, "W": 29, "N": 30, "P": 31, "F": 32, "C": 33,
    "5mr": 4, "5pr": 13, "5sr": 22,
  };

  const BASE_TO_MJAI = [
    "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
    "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
    "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
    "E", "S", "W", "N", "P", "F", "C",
  ];

  // KD shanten lives on a 38-slot array indexed 1..37 with gaps at 0/10/20/30.
  // Same conversion the smoke test uses.
  function _base_to_kd(b) {
    if (b < 9) return b + 1;
    if (b < 18) return b + 2;
    if (b < 27) return b + 3;
    return b + 4;
  }

  function _hand_to_34(hand_mjai) {
    const counts = new Array(34).fill(0);
    for (const t of hand_mjai) {
      const b = MJAI_TO_BASE[t];
      if (b === undefined) throw new Error("Unknown tile: " + t);
      counts[b] += 1;
    }
    return counts;
  }

  function _hand34_to_kd(hand34) {
    const kd = new Array(38).fill(0);
    for (let b = 0; b < 34; b++) kd[_base_to_kd(b)] = hand34[b];
    return kd;
  }

  function _shanten_of(hand34, closed) {
    const kd = _hand34_to_kd(hand34);
    return closed ? shantenMod.calculateMinimumShanten(kd) : shantenMod.calculateStandardShanten(kd);
  }

  // Red-fives are already counted in the base slot. Wall lookup picks the
  // base count — same convention as lib/furiten.py / lib/shanten.py.
  function _wall_count(wall, base_id) {
    if (!wall) return 0;
    return wall[base_id] || 0;
  }

  function tenpai_waits(hand_13_mjai, melds_mjai) {
    const hand34 = _hand_to_34(hand_13_mjai);
    const closed = !melds_mjai || melds_mjai.length === 0;
    if (_shanten_of(hand34, closed) !== 0) return [];
    const waits = [];
    for (let t = 0; t < 34; t++) {
      if (hand34[t] >= 4) continue;
      const trial = hand34.slice();
      trial[t] += 1;
      if (_shanten_of(trial, closed) === -1) waits.push(t);
    }
    return waits;
  }

  // Aka slots in the wall: 34=5mr, 35=5pr, 36=5sr. >0 means the red copy is
  // still out there (not in player's hand, not yet seen). Surfaced per wait so
  // the EV-bars view can split a 5/5/5 wait into regular + red rows.
  const _AKA_SLOT_FOR_BASE = { 4: 34, 13: 35, 22: 36 };

  function tenpai_wait_tiles(hand_13_mjai, melds_mjai, wall) {
    const ids = tenpai_waits(hand_13_mjai, melds_mjai);
    return ids.map(t => {
      const out = { tile: BASE_TO_MJAI[t], count: _wall_count(wall, t) };
      const akaSlot = _AKA_SLOT_FOR_BASE[t];
      if (akaSlot != null && wall && wall[akaSlot]) out.aka_count = wall[akaSlot];
      return out;
    });
  }

  function is_furiten(hand_13_mjai, melds_mjai, own_discards_mjai) {
    const waits = tenpai_waits(hand_13_mjai, melds_mjai);
    const waits_mjai = waits.map(t => BASE_TO_MJAI[t]);
    if (!waits.length) {
      return { is_furiten: false, waits: [], furiten_tiles: [] };
    }
    const discarded_bases = new Set();
    for (const t of own_discards_mjai) {
      const b = MJAI_TO_BASE[t];
      if (b !== undefined) discarded_bases.add(b);
    }
    const furiten_tiles = waits
      .filter(t => discarded_bases.has(t))
      .map(t => BASE_TO_MJAI[t]);
    return {
      is_furiten: furiten_tiles.length > 0,
      waits: waits_mjai,
      furiten_tiles,
    };
  }

  // Player's discard pool up to (but not including) their dahai on
  // `target_junme`. junme is 0-indexed (first tsumo = junme 0). Mirrors
  // lib/furiten.py::find_discard_history_for_turn.
  function find_discard_history_for_turn(mjai_events, start_pos, end_pos,
                                         player_id, target_junme) {
    const own_discards = [];
    let player_tsumo = -1;
    for (let pos = start_pos + 1; pos < end_pos; pos++) {
      const e = mjai_events[pos];
      if (!e) continue;
      const etype = e.type;
      const actor = e.actor;
      if (etype === "tsumo" && actor === player_id) {
        player_tsumo += 1;
        if (player_tsumo > target_junme) break;
      } else if (etype === "dahai" && actor === player_id) {
        if (player_tsumo === target_junme) break;
        const pai = e.pai;
        if (pai !== undefined && pai !== null) own_discards.push(pai);
      }
    }
    return own_discards;
  }

  function find_riichi_context(mjai_events, start_pos, end_pos, player_id) {
    const own_discards = [];
    for (let pos = start_pos + 1; pos < end_pos; pos++) {
      const e = mjai_events[pos];
      if (!e) continue;
      const etype = e.type;
      const actor = e.actor;
      if (etype === "reach" && actor === player_id) {
        for (let pos2 = pos + 1; pos2 < end_pos; pos2++) {
          const e2 = mjai_events[pos2];
          if (e2 && e2.type === "dahai" && e2.actor === player_id) {
            return { riichi_tile: e2.pai, own_discards };
          }
        }
        return { riichi_tile: null, own_discards };
      }
      if (etype === "dahai" && actor === player_id) {
        const pai = e.pai;
        if (pai !== undefined && pai !== null) own_discards.push(pai);
      }
    }
    return { riichi_tile: null, own_discards: [] };
  }

  return {
    tenpai_waits,
    tenpai_wait_tiles,
    is_furiten,
    find_discard_history_for_turn,
    find_riichi_context,
  };
}));
