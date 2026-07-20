// WASM-backed drop-in for shanten_calc.calculate, same input/output contract.
//
// Backed by riichi-tools-rs (fast_shanten kernel) via wasm/haipai-shanten. It
// produces the SAME shape as shanten_calc.calculate — {shanten, stats:[{tile,
// shanten, necessary_count, necessary_tiles}]} — using one native call
// (full_discard_table) for the whole per-discard ukeire table.
//
// Open hands: melds_mjai (Haipai's fuuro objects — pon/chi/ankan/daiminkan/
// kakan) are appended to the hand text as riichi-tools-rs meld brackets
// (_meld_to_bracket) — see Hand::from_text/parse_chi/parse_pon/parse_kan in
// wasm/haipai-shanten/src/lib.rs. The fast_shanten kernel reads melds off the
// parsed Hand natively (both open shapes AND closed ankan), so this is a
// faithful calculation, not the JS kernel's virtual-complete-meld-count trick.
// Which specific opponent a meld was called from, and which tile within a
// chi/pon was the physically-called one, don't affect shanten/ukeire — those
// bracket fields are filled with fixed placeholders.
//
// Correctness fallback to the pure-JS kernel for the shapes where riichi
// diverges (see scripts/wasm_ukeire_parity.mjs):
//   - concealed 4-of-a-kind: fast_shanten lookup tables misread a quad as not
//     a triplet+tanki (the slow kernel is fine, but we use fast)
//   - chiitoi 6-pairs-over-6-kinds: riichi reports tenpai; our JS is stricter
//   - any meld shape _meld_to_bracket doesn't recognize
//   - a second (or more) honor-tile meld, or any kakan on an honor tile —
//     see _needs_js_fallback_for_melds for the confirmed upstream bug
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
  // Aka slots in the wall: 34=5mr, 35=5pr, 36=5sr (>0 means the red copy is
  // still live). Mirrors prep/furiten.js + the JS shanten_calc kernel.
  const _AKA_SLOT_FOR_BASE = { 4: 34, 13: 35, 22: 36 };

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

  const HONORS = new Set(["E", "S", "W", "N", "P", "F", "C"]);

  // riichi-tools-rs's fast_shanten kernel shares ONE scalar state machine
  // (ProgressiveHonorClassifier) across every honor tile in the hand — draws
  // of DIFFERENT concealed honor kinds compose on it correctly (proven by the
  // 1552-closed-hand GT run in docs/backlogs/WASM-SHANTEN.md), but its
  // pon()/shouminkan() transitions (fired for pon/kakan/daiminkan on an honor
  // — see HandCalculator::init in riichi-tools-rs) carry no notion of *which*
  // honor value they're for, and corrupt that shared state once a SECOND
  // distinct honor kind touches the hand alongside a honor meld — whether
  // that second kind is another meld or just a concealed tile. Confirmed by
  // direct repro against the Python `mahjong` ground truth (not a JS-encoding
  // bug on our side):
  //   - closed 666m + pon(E) + pon(S) (verifiably tenpai): fast kernel
  //     reports shanten 2 instead of 0; kakan+ankan on different honors
  //     returns outright nonsense (-1/8)
  //   - ONE honor meld (e.g. pon(F)) + TWO distinct concealed honor kinds
  //     (e.g. lone P and C): shanten stays right, but ukeire silently drops
  //     one of them (misses C as an accepting tile)
  //   - a lone kakan (added kan) on an honor tile is broken even by itself —
  //     it's pon()+shouminkan() internally, two hits to the FSM in one meld
  //   - ONE honor meld + at most ONE other distinct honor kind anywhere else
  //     in the hand is fine (GT-verified) — that's the common single-yakuhai-
  //     pon case, so it stays on the fast path
  // Reported nowhere upstream; scoped fallback here rather than patching the
  // vendored fork's opaque lookup-table FSM blind.
  function _needs_js_fallback_for_melds(hand_mjai, melds_mjai) {
    if (!melds_mjai || !melds_mjai.length) return false;
    let hasHonorMeld = false;
    const honorKinds = new Set();
    for (const t of hand_mjai) if (HONORS.has(t)) honorKinds.add(t);
    for (const m of melds_mjai) {
      const tile = m.pai != null ? m.pai : (m.consumed && m.consumed[0]);
      if (!HONORS.has(tile)) continue;
      if (m.type === "kakan") return true;
      hasHonorMeld = true;
      honorKinds.add(tile);
    }
    return hasHonorMeld && honorKinds.size > 1;
  }

  // base id -> {num (1-9 suits, 1-7 honors), color (m/p/s/z)}, per Tile::from_id
  // in riichi-tools-rs (1z..4z = E S W N, 5z..7z = P F C). Red fives collapse to
  // their plain base id already (MJAI_TO_BASE), and red-ness never affects
  // shanten/ukeire, so there's no "r" flag to thread through here.
  function _num_color(mjai_tile) {
    const b = MJAI_TO_BASE[mjai_tile];
    if (b === undefined) throw new Error("Unknown tile: " + mjai_tile);
    if (b < 27) return { num: (b % 9) + 1, color: SUIT_CH[Math.floor(b / 9)] };
    return { num: b - 26, color: "z" };
  }

  // One Haipai fuuro object -> one riichi-tools-rs meld bracket. Player/called-
  // index fields are fixed placeholders (1 / index 0) since they don't affect
  // shanten or ukeire — only which tiles form the meld does.
  function _meld_to_bracket(m) {
    switch (m.type) {
      case "pon": {
        const { num, color } = _num_color(m.pai);
        return `(p${num}${color}1)`;
      }
      case "chi": {
        const called = _num_color(m.pai);
        const sorted = [m.pai, ...m.consumed].map(_num_color).sort((a, b) => a.num - b.num);
        const calledIdx = sorted.findIndex((t) => t.num === called.num);
        return `(${sorted[0].num}${sorted[1].num}${sorted[2].num}${sorted[0].color}${calledIdx})`;
      }
      case "ankan": {
        const { num, color } = _num_color(m.consumed[0]);
        return `(k${num}${color})`;
      }
      case "daiminkan": {
        const { num, color } = _num_color(m.pai);
        return `(k${num}${color}1)`;
      }
      case "kakan": {
        const { num, color } = _num_color(m.pai);
        return `(s${num}${color}1)`;
      }
      default:
        throw new Error("Unknown meld type: " + m.type);
    }
  }

  function calculate(hand_mjai, melds_mjai, wall) {
    const { counts, red } = _counts_and_red(hand_mjai);
    if (_needs_js_fallback(counts)) return jsCalc.calculate(hand_mjai, melds_mjai, wall);
    if (_needs_js_fallback_for_melds(hand_mjai, melds_mjai)) return jsCalc.calculate(hand_mjai, melds_mjai, wall);

    let text = _counts_to_text(counts);
    if (melds_mjai && melds_mjai.length) {
      try {
        for (const m of melds_mjai) text += _meld_to_bracket(m);
      } catch (e) {
        return jsCalc.calculate(hand_mjai, melds_mjai, wall); // unrecognized meld shape guard
      }
    }
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
      const necessary = row.tiles.map(([id]) => {
        const base = id - 1;
        const nec = { tile: BASE_TO_MJAI[base], count: _wall_count(wall, base) };
        const akaSlot = _AKA_SLOT_FOR_BASE[base];
        if (akaSlot != null && wall && wall[akaSlot]) nec.aka_count = wall[akaSlot];
        return nec;
      });
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
