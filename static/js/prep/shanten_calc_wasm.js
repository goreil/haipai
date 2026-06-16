// WASM-backed drop-in for shanten_calc.calculate, same input/output contract.
//
// Backed by riichi-tools-rs (fast_shanten kernel) via wasm/haipai-shanten. It
// produces the SAME shape as shanten_calc.calculate — {shanten, stats:[{tile,
// shanten, necessary_count, necessary_tiles}]} — using one native call
// (full_discard_table) for the whole per-discard ukeire table.
//
// Correctness fallback to the pure-JS kernel for the shapes where riichi
// diverges (see scripts/wasm_ukeire_parity.mjs):
//   - open hands (melds): WASM path is closed-hand only
//   - concealed 4-of-a-kind: fast_shanten lookup tables misread a quad as not
//     a triplet+tanki (the slow kernel is fine, but we use fast)
//   - chiitoi 6-pairs-over-6-kinds: riichi reports tenpai; our JS is stricter
// The rare ukeire false-positive in dense multi-pair shapes has no clean
// trigger and is left to the caller's correctness tolerance.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const wasm = require("../../../wasm/haipai-shanten/pkg/haipai_shanten.js");
    const jsCalc = require("./shanten_calc.js");
    module.exports = factory(wasm, jsCalc);
  } else {
    root.haipaiPrepShantenCalcWasm = factory(root.haipaiShantenWasm, root.haipaiPrepShantenCalc);
  }
}(typeof self !== "undefined" ? self : this, function (wasm, jsCalc) {

  const MJAI_TO_BASE = {
    "1m":0,"2m":1,"3m":2,"4m":3,"5m":4,"6m":5,"7m":6,"8m":7,"9m":8,
    "1p":9,"2p":10,"3p":11,"4p":12,"5p":13,"6p":14,"7p":15,"8p":16,"9p":17,
    "1s":18,"2s":19,"3s":20,"4s":21,"5s":22,"6s":23,"7s":24,"8s":25,"9s":26,
    "E":27,"S":28,"W":29,"N":30,"P":31,"F":32,"C":33,
    "5mr":4,"5pr":13,"5sr":22,
  };
  const BASE_TO_MJAI = [
    "1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p","5p","6p","7p","8p","9p",
    "1s","2s","3s","4s","5s","6s","7s","8s","9s","E","S","W","N","P","F","C",
  ];
  const SUIT_CH = ["m", "p", "s"];

  function _counts_and_red(hand_mjai) {
    const counts = new Array(34).fill(0);
    const red = new Set();
    for (const t of hand_mjai) {
      const b = MJAI_TO_BASE[t];
      if (b === undefined) throw new Error("Unknown tile: " + t);
      counts[b] += 1;
      if (t === "5mr" || t === "5pr" || t === "5sr") red.add(b);
    }
    return { counts, red };
  }

  function _counts_to_text(counts) {
    let text = "";
    for (let s = 0; s < 3; s++) {
      let d = "";
      for (let n = 1; n <= 9; n++) for (let k = 0; k < counts[s * 9 + (n - 1)]; k++) d += n;
      if (d) text += d + SUIT_CH[s];
    }
    let h = "";
    for (let i = 0; i < 7; i++) for (let k = 0; k < counts[27 + i]; k++) h += (i + 1);
    if (h) text += h + "z";
    return text;
  }

  function _display_name(base_id, red) {
    if (base_id === 4 && red.has(4)) return "5mr";
    if (base_id === 13 && red.has(13)) return "5pr";
    if (base_id === 22 && red.has(22)) return "5sr";
    return BASE_TO_MJAI[base_id];
  }
  const _wall_count = (wall, b) => (!wall || b >= wall.length) ? 0 : (wall[b] || 0);

  // Verified against the Python `mahjong` library as ground truth over 8000
  // hands (scripts/gt_compare_gen.mjs + gt_compare.py): riichi's fast_shanten
  // kernel matches ground truth on shanten AND ukeire everywhere EXCEPT a
  // concealed 4-of-a-kind, which it misreads as not a triplet+tanki. (Our old
  // JS kernel is actually the LESS correct one — it over-penalizes chiitoi-dense
  // hands — so there is no chiitoi fallback; riichi is right there.) JS is
  // ground-truth-correct on quads, so route only those to it.
  function _needs_js_fallback(counts) {
    for (let b = 0; b < 34; b++) if (counts[b] === 4) return true; // concealed quad
    return false;
  }

  function calculate(hand_mjai, melds_mjai, wall) {
    if (melds_mjai && melds_mjai.length) return jsCalc.calculate(hand_mjai, melds_mjai, wall);

    const { counts, red } = _counts_and_red(hand_mjai);
    if (_needs_js_fallback(counts)) return jsCalc.calculate(hand_mjai, melds_mjai, wall);

    const text = _counts_to_text(counts);
    if (wasm.shanten_from_text(text) === -1) {
      const err = new Error("hand is already in winning form");
      err.code = "winning";
      throw err;
    }

    const table = JSON.parse(wasm.full_discard_table(text));
    if (table.error) return jsCalc.calculate(hand_mjai, melds_mjai, wall); // parse guard

    const stats = [];
    for (const row of table.stats) {
      const base = row.discard - 1;                 // get_id is 1-based
      const necessary = row.tiles.map(([id]) => ({
        tile: BASE_TO_MJAI[id - 1],
        count: _wall_count(wall, id - 1),
      }));
      stats.push({
        tile: _display_name(base, red),
        shanten: row.shanten,
        necessary_count: necessary.reduce((s, n) => s + n.count, 0),
        necessary_tiles: necessary,
      });
    }

    stats.sort((a, b) => (a.shanten - b.shanten) || (b.necessary_count - a.necessary_count));
    return { shanten: stats.length ? stats[0].shanten : null, stats };
  }

  return { calculate };
}));
