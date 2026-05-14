// Per-discard shanten + ukeire table — twin of lib/shanten.py:calculate.
// Wraps the KD shanten solver (prep/shanten.js) into the response shape the
// categorize prep / EV table consumes: {shanten, stats:[{tile, shanten,
// necessary_count, necessary_tiles}]} sorted by (shanten, -necessary_count).
//
// Red fives collapse to their base tile when counting; the display name
// reports "5mr"/"5pr"/"5sr" when the hand actually holds the red copy.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const shanten = require("./shanten.js");
    module.exports = factory(shanten);
  } else {
    root.haipaiPrepShantenCalc = factory(root.haipaiShanten);
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

  function _base_to_kd(b) {
    if (b < 9) return b + 1;
    if (b < 18) return b + 2;
    if (b < 27) return b + 3;
    return b + 4;
  }

  function _hand34_to_kd(hand34) {
    const kd = new Array(38).fill(0);
    for (let b = 0; b < 34; b++) kd[_base_to_kd(b)] = hand34[b];
    return kd;
  }

  function _hand_to_34(hand_mjai) {
    const counts = new Array(34).fill(0);
    const red = new Set();
    for (const t of hand_mjai) {
      const b = MJAI_TO_BASE[t];
      if (b === undefined) throw new Error("Unknown tile: " + t);
      counts[b] += 1;
      if (t === "5mr" || t === "5pr" || t === "5sr") red.add(b);
    }
    return { hand34: counts, red };
  }

  function _display_name(base_id, red) {
    if (base_id === 4 && red.has(4)) return "5mr";
    if (base_id === 13 && red.has(13)) return "5pr";
    if (base_id === 22 && red.has(22)) return "5sr";
    return BASE_TO_MJAI[base_id];
  }

  // Python's `mahjong` lib infers a meld count from `sum(hand) < 14`
  // (init_mentsu = floor((14 - sum) / 3)) and treats those slots as
  // already-complete sets, which both shifts the baseline AND caps how
  // many partial sets can usefully contribute (n_mentsu_kouho > 4 → +1
  // penalty). A raw `-2 * meld_count` adjustment to the KD result skips
  // the cap and over-counts excess partials, so for open hands we instead
  // extend the KD array with one virtual triplet per meld in slots beyond
  // the honor range. KD's recursive solver discovers each virtual as a
  // complete set, naturally enforcing the partial-set cap (the inner
  // sequence check is gated on `i < 30`, so the padding never participates
  // in a fake sequence).
  function _shanten_of(hand34, closed, meld_count) {
    if (closed) {
      return shantenMod.calculateMinimumShanten(_hand34_to_kd(hand34));
    }
    const extended = new Array(38 + meld_count).fill(0);
    for (let b = 0; b < 34; b++) extended[_base_to_kd(b)] = hand34[b];
    for (let m = 0; m < meld_count; m++) extended[38 + m] = 3;
    return shantenMod.calculateStandardShanten(extended);
  }

  // Red-five copies are already counted in the base slot. Mirrors
  // lib/shanten.py:_wall_count.
  function _wall_count(wall, base_id) {
    if (!wall || base_id >= wall.length) return 0;
    return wall[base_id] || 0;
  }

  // hand_mjai: 14-tile list (post-draw). melds_mjai: list of called melds.
  // wall: 37-entry array (slots 0..33 base inclusive of red, 34..36 red).
  // Raises if the hand is already in winning form (caller catches and
  // re-classifies the mistake as "passed on win"). Returns null shanten
  // when no stats produced (empty hand).
  function calculate(hand_mjai, melds_mjai, wall) {
    const { hand34, red } = _hand_to_34(hand_mjai);
    const closed = !melds_mjai || melds_mjai.length === 0;
    const meld_count = melds_mjai ? melds_mjai.length : 0;

    if (_shanten_of(hand34, closed, meld_count) === -1) {
      const err = new Error("hand is already in winning form");
      err.code = "winning";
      throw err;
    }

    const seen = new Set();
    const stats = [];
    for (let baseId = 0; baseId < 34; baseId++) {
      if (hand34[baseId] === 0 || seen.has(baseId)) continue;
      seen.add(baseId);

      const after = hand34.slice();
      after[baseId] -= 1;
      const sh = _shanten_of(after, closed, meld_count);

      const necessary = [];
      for (let t = 0; t < 34; t++) {
        // Skip drawing a 5th copy — physically impossible, and the KD
        // shanten solver assumes max 4 per tile. Python's mahjong lib
        // happens to compute the same shanten value for 5-of-a-kind so
        // the parity fixture doesn't trip on this, but the skip is the
        // safe primitive.
        if (after[t] >= 4) continue;
        const trial = after.slice();
        trial[t] += 1;
        if (_shanten_of(trial, closed, meld_count) < sh) {
          // Keep tiles with 0 wall count — the UI renders them as
          // dimmed "dead wait" chips to show shape even when fully dealt.
          necessary.push({ tile: BASE_TO_MJAI[t], count: _wall_count(wall, t) });
        }
      }

      stats.push({
        tile: _display_name(baseId, red),
        shanten: sh,
        necessary_count: necessary.reduce((s, n) => s + n.count, 0),
        necessary_tiles: necessary,
      });
    }

    stats.sort((a, b) => (a.shanten - b.shanten) || (b.necessary_count - a.necessary_count));
    const bestShanten = stats.length ? stats[0].shanten : null;
    return { shanten: bestShanten, stats };
  }

  return { calculate };
}));
