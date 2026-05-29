// Canonical tile-notation maps for the JS prep pipeline. Twin of
// lib/tiles.py — keep in sync when the Python side moves. The browser-side
// rendering twin lives in static/js/tiles.js; the data structures the prep
// algorithms (board / parse / furiten / shanten / defense) need live here.
//
// Three integer schemes cohabit prep, same as Python:
//   - mjai IDs (0-36): canonical; 0..33 base tiles, 34..36 red fives.
//   - RT (1..37): suji math (lib/defense.py port). Gaps at 0/10/20/30.
//   - tenhou (11..53): KillerDucky port (lib/defense_kd.py / prep/defense_kd.js).
//
// Shanten has its own 34-entry red-blind scheme local to prep/shanten.js.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiPrepTiles = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  const MJAI_TO_ID = {
    "1m": 0, "2m": 1, "3m": 2, "4m": 3, "5m": 4, "6m": 5, "7m": 6, "8m": 7, "9m": 8,
    "1p": 9, "2p": 10, "3p": 11, "4p": 12, "5p": 13, "6p": 14, "7p": 15, "8p": 16, "9p": 17,
    "1s": 18, "2s": 19, "3s": 20, "4s": 21, "5s": 22, "6s": 23, "7s": 24, "8s": 25, "9s": 26,
    "E": 27, "S": 28, "W": 29, "N": 30, "P": 31, "F": 32, "C": 33,
    "5mr": 34, "5pr": 35, "5sr": 36,
  };

  const ID_TO_MJAI = {};
  for (const k of Object.keys(MJAI_TO_ID)) ID_TO_MJAI[MJAI_TO_ID[k]] = k;

  const RED_TO_BASE = { 34: 4, 35: 13, 36: 22 };

  function mjai_to_tile_id(tile) {
    const id = MJAI_TO_ID[tile];
    if (id === undefined) throw new Error("Unknown mjai tile: " + tile);
    return id;
  }

  function tile_id_to_base(tid) {
    return RED_TO_BASE[tid] !== undefined ? RED_TO_BASE[tid] : tid;
  }

  function is_honor_mjai(tile) {
    return tile === "E" || tile === "S" || tile === "W" || tile === "N"
      || tile === "P" || tile === "F" || tile === "C";
  }

  function is_red_five_mjai(tile) {
    return tile === "5mr" || tile === "5pr" || tile === "5sr";
  }

  // String-level red→base for mjai notation. The integer-level twin is
  // tile_id_to_base above; this one is for callers that operate on mjai
  // strings directly (prep/board.js shape/yaku helpers).
  function base_mjai(tile) {
    if (tile === "5mr") return "5m";
    if (tile === "5pr") return "5p";
    if (tile === "5sr") return "5s";
    return tile;
  }

  const MJAI_TO_RT = {
    "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "6m": 6, "7m": 7, "8m": 8, "9m": 9,
    "5mr": 5,
    "1p": 11, "2p": 12, "3p": 13, "4p": 14, "5p": 15, "6p": 16, "7p": 17, "8p": 18, "9p": 19,
    "5pr": 15,
    "1s": 21, "2s": 22, "3s": 23, "4s": 24, "5s": 25, "6s": 26, "7s": 27, "8s": 28, "9s": 29,
    "5sr": 25,
    "E": 31, "S": 32, "W": 33, "N": 34, "P": 35, "F": 36, "C": 37,
  };

  const MJAI_TO_TENHOU = {
    "1m": 11, "2m": 12, "3m": 13, "4m": 14, "5m": 15,
    "6m": 16, "7m": 17, "8m": 18, "9m": 19, "5mr": 51,
    "1p": 21, "2p": 22, "3p": 23, "4p": 24, "5p": 25,
    "6p": 26, "7p": 27, "8p": 28, "9p": 29, "5pr": 52,
    "1s": 31, "2s": 32, "3s": 33, "4s": 34, "5s": 35,
    "6s": 36, "7s": 37, "8s": 38, "9s": 39, "5sr": 53,
    "E": 41, "S": 42, "W": 43, "N": 44, "P": 45, "F": 46, "C": 47,
  };

  const TENHOU_TO_MJAI = {};
  for (const k of Object.keys(MJAI_TO_TENHOU)) TENHOU_TO_MJAI[MJAI_TO_TENHOU[k]] = k;

  // Dora indicator → dora rule (riichi standard): next tile in suit, wrapping
  // 9→1; E→S→W→N→E; P→F→C→P. Red five indicator maps the same as 5.
  const NEXT_TILE_MJAI = {
    "1m": "2m", "2m": "3m", "3m": "4m", "4m": "5m", "5m": "6m",
    "6m": "7m", "7m": "8m", "8m": "9m", "9m": "1m", "5mr": "6m",
    "1p": "2p", "2p": "3p", "3p": "4p", "4p": "5p", "5p": "6p",
    "6p": "7p", "7p": "8p", "8p": "9p", "9p": "1p", "5pr": "6p",
    "1s": "2s", "2s": "3s", "3s": "4s", "4s": "5s", "5s": "6s",
    "6s": "7s", "7s": "8s", "8s": "9s", "9s": "1s", "5sr": "6s",
    "E": "S", "S": "W", "W": "N", "N": "E",
    "P": "F", "F": "C", "C": "P",
  };

  function dora_indicator_to_dora_mjai(indicator) {
    const next = NEXT_TILE_MJAI[indicator];
    if (next === undefined) throw new Error("Unknown dora indicator: " + indicator);
    return next;
  }

  function _norm_red_five_tenhou(t) {
    if (t < 51) return t;
    if (t === 51) return 15;
    if (t === 52) return 25;
    if (t === 53) return 35;
    throw new Error("Unknown tenhou tile id: " + t);
  }

  const NEXT_TILE_TENHOU = {};
  for (const t of Object.keys(TENHOU_TO_MJAI)) {
    const ti = parseInt(t, 10);
    NEXT_TILE_TENHOU[ti] = MJAI_TO_TENHOU[NEXT_TILE_MJAI[TENHOU_TO_MJAI[_norm_red_five_tenhou(ti)]]];
  }

  function dora_indicator_to_dora_tenhou(indicator) {
    return NEXT_TILE_TENHOU[indicator];
  }

  return {
    MJAI_TO_ID,
    ID_TO_MJAI,
    RED_TO_BASE,
    MJAI_TO_RT,
    MJAI_TO_TENHOU,
    TENHOU_TO_MJAI,
    NEXT_TILE_MJAI,
    NEXT_TILE_TENHOU,
    mjai_to_tile_id,
    tile_id_to_base,
    is_honor_mjai,
    is_red_five_mjai,
    base_mjai,
    dora_indicator_to_dora_mjai,
    dora_indicator_to_dora_tenhou,
  };
}));
