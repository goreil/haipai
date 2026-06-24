// Mistake categorizer — sole owner of the rule-decision logic for the app.
//
// Input: a mistake dict shaped like the API response (hand, melds, actual,
// expected, discard_stats, dealin_rates, board_state). Prep runs in
// static/js/prep/ on fetch; this file decides the category from those inputs.
//
// Output: { skillArea, shape, wins, category, categorize_data, labels }. For
// dahai mistakes `category` is null — the win-vector + derived `shape`
// (obvious / trade-off / complex) describe it instead (CORE Phase 3 deleted
// the P/D/OD codes). `category` survives only for action decisions
// (4A–4C meld, 5A/5B riichi, 6A/6B kan), which carry no shape. Consumers
// (mistake-card, categorize-explanations, EV table) read these per mistake.
//
// !! Bump CATEGORIZER_VERSION whenever the decision tree, RULES, or the
// skill-area grouping in static/js/prep/parse.js::skill_area_for_entry
// changes. Trends snapshots are tagged with this version so users can see
// which past results came from which logic.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiCategorize = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  // Monotonically increasing integer. Append to CATEGORIZER_CHANGELOG on bump.
  const CATEGORIZER_VERSION = 9;
  const CATEGORIZER_CHANGELOG = {
    1: "Initial JS-side categorizer (P1-P4 push, D1-D3 defense, 4A/4B/4C meld, 5A/5B riichi, 6A/6B kan).",
    2: "P1/P2 shanten + ukeire comparisons now use Mortal's expected pick, not the speed-calculator's top. Fixes false shanten-failure flags when calc finds a faster line than Mortal (#6805, #6283, #12151, #12164).",
    3: "P3 now requires Mortal's ukeire to be at least equal to the player's (strict, no similarity threshold). Rule is now: more ukeire or better shanten → push; otherwise complex. Affects #12151.",
    4: "P3 reverted to a pure dora/yakuhai check — no ukeire comparison. The v3 gate misclassified #12611 (E discard is round-wind + dora, but had more ukeire than Mortal's 6p) as P4 Complex. Also drops the `similar_acceptance` flag and its '*0.9' similarity threshold from value_preserve.",
    5: "Kan-vs-call mismatches (chi/pon vs a kan, either direction) now route to 6A/6B instead of falling through to P4. Fixes #14173 (R-179): pon East when daiminkan East was the play is now 6B Missed Kan, not Complex Decision.",
    6: "Open Defense axis (OD1/OD2/OD3, backlog C-02): non-riichi opponents whose open melds pass the prep-side trigger emit kind='open' threats; dahai mistakes in open-threat-only scenes route to OD tiers via the same defend/push/complex logic as D1-D3.",
    7: "P3 also fires on dora-acceptance: when Mortal's pick keeps a wait that accepts strictly more live dora than yours (its ukeire intersects the active dora set more), the mistake is hand value, not Complex. Net rule — suppressed when Mortal's own discard is a dora (throwing a dora to re-accept it is a wash). Fixes #4932 (breaking the 5m6m ryanmen drops the 4m-dora acceptance).",
    8: "Multi-threat prioritized defense → Defend. With 2+ live threats, Mortal's pick can be strictly safer than yours against some and more dangerous against others; the combined deal-in rate nets this out and the spot fell through to D3/Complex. Now read per_threat directly: safer vs >=1 threat AND more dangerous vs >=1 other → D1/OD1 with a per-side `prioritized_defense` story (which sides it folds to, which it exposes). Kind-agnostic — Mortal may prioritize riichi or open either way (#m20071: folds to both riichi, exposes to the open hand).",
    9: "Shared dimension comparator (static/js/compare-dimensions.js, mistake-dimensions CORE Phase 0). The win-vector that drives the EV-table feature pills is now a single source of truth, fixing the ukeire-gate bug: cross-shanten ukeire 'gains' are marked suppressed and shown as context ('wider, a step slower') instead of a green +ukeire pill (ev-table previously fired with no shanten gate). CORE Phase 3 then DELETED the legacy dahai category codes (P1-P4 push, D1-D3 defense, OD1-OD3 open defense): dahai mistakes now return category:null and are described purely by {skillArea, shape, wins} — the comparator + skill-area grouping are unchanged from Phase 0 (the golden snapshot stays byte-identical), so the version does not bump. `category` survives only for action decisions (4A-4C meld, 5A/5B riichi, 6A/6B kan), which carry no shape.",
  };

  // --- Tunable rules (mirror RULES in rules.py) ---
  const RULES = {
    agree_exp_score_diff: 60,
    agree_necessary_ratio: 0.80,
    value_tile_diff: 60,
  };

  // --- Tile predicates ---
  function isHonorMjai(t) {
    return !!t && "ESWNPFC".includes(t);
  }
  function isTerminalMjai(t) {
    return !!t && /^[19][mps]$/.test(t);
  }
  function isValueTileMjai(t) {
    return isHonorMjai(t) || isTerminalMjai(t);
  }
  // Private copy of static/js/tiles.js::tileBase. Kept here so categorize.js
  // can load standalone in a vm context (scripts/verify_categorize_js.mjs,
  // scripts/snapshot_categorize_fixture.mjs). Same logic as tiles.js — sync
  // the two if either changes.
  function tileBase(t) {
    if (!t) return t;
    return t.endsWith("r") ? t.slice(0, -1) : t;
  }

  // --- discard_stats lookups (mirror _find_in_stats etc.) ---
  function findInStats(tileMjai, discardStats) {
    if (!discardStats || !tileMjai) return null;
    const base = tileBase(tileMjai);
    for (const s of discardStats) {
      const sBase = tileBase(s.tile);
      if (s.tile === tileMjai || sBase === base) return s;
    }
    return null;
  }

  function getShantenForTile(tileMjai, discardStats) {
    const s = findInStats(tileMjai, discardStats);
    return s ? (s.shanten ?? null) : null;
  }

  function getExpScoreForTile(tileMjai, discardStats) {
    const s = findInStats(tileMjai, discardStats);
    return s ? (s.exp_score ?? null) : null;
  }

  function dealinFor(tileMjai, dealinRates) {
    if (!tileMjai || !dealinRates) return null;
    const r = dealinRates[tileMjai];
    if (r != null) return r;
    return dealinRates[tileBase(tileMjai)] ?? null;
  }

  // True iff some non-player seat already has 3+ open calls (chi/pon/
  // daiminkan). kakan upgrades an existing pon — the underlying pon is
  // already in the list, so we don't count it again. ankan is hidden, not
  // a threat signal.
  const OPEN_MELD_TYPES = new Set(["chi", "pon", "daiminkan"]);
  function hasThreateningOpponent(opponentMelds) {
    if (!opponentMelds) return false;
    for (const opp of opponentMelds) {
      const melds = opp && opp.melds;
      if (!melds || melds.length < 3) continue;
      let opens = 0;
      for (const meld of melds) {
        if (OPEN_MELD_TYPES.has(meld && meld.type)) opens++;
      }
      if (opens >= 3) return true;
    }
    return false;
  }

  // --- Action-type categorization (non-dahai) ---
  function categorizeByActionType(actual, expected) {
    const at = actual && actual.type;
    const et = expected && expected.type;

    if ((at === "chi" || at === "pon") && et === "none") return "4A";
    if (at === "none" && (et === "chi" || et === "pon")) return "4B";
    if ((at === "chi" || at === "pon") && (et === "chi" || et === "pon")) return "4C";

    if (at === "reach" && et === "dahai") return "5A";
    if (at === "dahai" && et === "reach") return "5B";

    const KAN = new Set(["ankan", "kakan", "daiminkan"]);
    // Kan vs (pass / dahai / a lesser call): declared kan when a non-kan was
    // better. Includes chi/pon so "kan'd when a plain pon was right" lands here
    // rather than the catch-all. (Both-chi/pon is already caught above as 4C.)
    if (KAN.has(at) && (et === "dahai" || et === "none" || et === "chi" || et === "pon")) return "6A";
    // The reverse: only pon'd/chi'd (or passed) when a kan was better — e.g.
    // pon East when daiminkan East was the play. "Missed Kan", not "Bad Call".
    if ((at === "dahai" || at === "none" || at === "chi" || at === "pon") && KAN.has(et)) return "6B";

    // Both-dahai → no action code; the caller derives shape from the
    // win-vector instead. A missed agari (et === "hora") or any unrecognised
    // action combo carries no action code either — skill area alone names it.
    if (at === "dahai" && et === "dahai") return null;
    return null;
  }

  // --- Labels (mirror labels.py::compute_labels) ---
  function computeLabels(actualTile, expectedTile, doraTiles, roundWind, seatWind) {
    const tiles = [actualTile, expectedTile].filter(Boolean);
    const doraSet = doraTiles instanceof Set ? doraTiles : new Set(doraTiles || []);
    const labels = [];
    for (const t of tiles) {
      if (isHonorMjai(t) && !labels.includes("honor")) labels.push("honor");
      if (isTerminalMjai(t) && !labels.includes("terminal")) labels.push("terminal");
      const isRedFive = (t === "5mr" || t === "5pr" || t === "5sr");
      if ((doraSet.has(t) || isRedFive) && !labels.includes("dora")) labels.push("dora");
    }
    for (const t of tiles) {
      if (t === "P" || t === "F" || t === "C") {
        if (!labels.includes("yakuhai")) labels.push("yakuhai");
      } else if (t === roundWind || t === seatWind) {
        if (!labels.includes("yakuhai")) labels.push("yakuhai");
      }
    }
    return labels;
  }

  function tileIsDora(tile, doraTiles) {
    if (!tile) return false;
    if (tile === "5mr" || tile === "5pr" || tile === "5sr") return true;
    const doraSet = doraTiles instanceof Set ? doraTiles : new Set(doraTiles || []);
    return doraSet.has(tile);
  }

  // Live-dora acceptance of a candidate discard: how many wall-live tiles in
  // its ukeire (necessary_tiles) are part of the active dora set. necessary_tiles
  // carries base mjai names (no "r" suffix) with their live wall count, so we
  // intersect against doraTiles directly — red-five dora never appears here as a
  // distinct acceptance (a held red five is in hand, not in the wait), and bare-5
  // acceptance is deliberately NOT treated as red dora: we can't confirm the red
  // copy is live without a prep-side flag, and counting every 5 wait as dora
  // floods false positives (see scripts/dora_accept_eval.mjs, V3).
  function doraUkeireForTile(tileMjai, discardStats, doraTiles) {
    const stat = findInStats(tileMjai, discardStats);
    if (!stat || !stat.necessary_tiles) return 0;
    const doraSet = doraTiles instanceof Set ? doraTiles : new Set(doraTiles || []);
    let n = 0;
    for (const nt of stat.necessary_tiles) {
      if (doraSet.has(nt.tile)) n += nt.count || 0;
    }
    return n;
  }

  function tileIsYakuhai(tile, roundWind, seatWind) {
    if (!tile) return false;
    if (tile === "P" || tile === "F" || tile === "C") return true;
    return tile === roundWind || tile === seatWind;
  }

  function tileIsYakuhaiOrDora(tile, doraTiles, roundWind, seatWind) {
    return tileIsYakuhai(tile, roundWind, seatWind)
        || tileIsDora(tile, doraTiles);
  }

  // --- Stats agreement check (mirror _stats_reasonably_agree) ---
  // Mortal's tile-pick is judged "competitive" when its shanten matches the
  // top discard's and its expected score is within an absolute threshold.
  // Used when distinguishing efficiency from strategy in the legacy 1A/2A
  // logic, but kept here for future reuse — not active in the current
  // decision tree.
  function statsReasonablyAgree(mortalTile, discardStats) {
    if (!discardStats || !discardStats.length) return false;
    const mortalEntry = findInStats(mortalTile, discardStats);
    if (!mortalEntry) return false;
    const top = discardStats[0];
    if (mortalEntry.shanten !== top.shanten) return false;
    if (top.exp_score != null && mortalEntry.exp_score != null) {
      return Math.abs(top.exp_score - mortalEntry.exp_score) <= RULES.agree_exp_score_diff;
    }
    const topNec = top.necessary_count || 0;
    const mNec = mortalEntry.necessary_count || 0;
    if (topNec > 0) return mNec >= topNec * RULES.agree_necessary_ratio;
    return false;
  }

  // The legacy P1–P4 / D1–D3 dahai classifiers (classifyPush / classifyDefense /
  // prioritizedDefense) were deleted in mistake-dimensions CORE Phase 3. Dahai
  // mistakes are now described by the win-vector + derived `shape` (obvious /
  // trade-off / complex) from the shared comparator (compare-dimensions.js),
  // never by a category code.

  // Lazy handle on the shared dimension comparator (compare-dimensions.js).
  // Resolved at call time, never at factory time, to break the circular
  // dependency (compare-dimensions requires categorize for its primitives):
  // by the first categorize() call both modules are fully loaded. In the
  // browser the comparator attaches to the global as a sibling script.
  let _comparator = null;
  function comparator() {
    if (_comparator) return _comparator;
    try {
      // CommonJS (Node bench/snapshot tools): lazily require the sibling.
      // Guard on `require` existing — the parity vm context fakes module.exports
      // without a require, and must fall through to the global lookup (which is
      // also absent there, leaving the comparator null → empty dimensions).
      if (typeof module === "object" && module.exports
          && typeof require === "function") {
        _comparator = require("./compare-dimensions.js");
      } else if (typeof globalThis !== "undefined") {
        _comparator = globalThis.haipaiCompareDimensions || null;
      }
    } catch (_e) {
      _comparator = null;
    }
    return _comparator;
  }

  // The new result axes (CORE Phase 1.2): the win-vector + the scene-derived
  // skill area + the topology-derived shape. Computed for every mistake (the
  // win-vector is action-type agnostic; shape is "n/a" for non-dahai). Nothing
  // *new* reads the legacy `category` field — it remains only as the scaffold
  // deleted in Phase 3.
  function dimensions(m) {
    const cmp = comparator();
    if (!cmp) return { skillArea: null, shape: "n/a", wins: [] };
    const wins = cmp.compareDimensions(m);
    return {
      skillArea: cmp.skillAreaFor(m),
      shape: cmp.deriveShape(wins, m),
      wins,
    };
  }

  // --- Main: categorize_mistake decision-only ---
  // Mirrors the categorize_mistake orchestration in __init__.py, but skips
  // the steps that *produce* inputs (shanten/defense/board) — those run
  // server-side and arrive on `m`. JS only owns the decision tree.
  function categorize(m) {
    const actual = m.actual || {};
    const expected = m.expected || {};

    const actionCat = categorizeByActionType(actual, expected);
    if (actionCat != null) {
      return { category: actionCat, categorize_data: {}, labels: [], ...dimensions(m) };
    }

    // dahai vs dahai — the legacy P/D/OD category is gone (CORE Phase 3). The
    // mistake is now fully described by the win-vector + derived `shape`
    // (obvious / trade-off / complex), computed once in dimensions(m) off the
    // shared comparator. `labels` is retained (honor/terminal/dora/yakuhai
    // tags) for any downstream tagging; categorize_data no longer carries a
    // classifier trail because nothing reads it.
    const board = m.board_state || {};
    const doraTiles = new Set(board.dora_tiles || []);
    const labels = computeLabels(
      actual.pai, expected.pai, doraTiles, board.round_wind, board.seat_wind);

    return { category: null, categorize_data: {}, labels, ...dimensions(m) };
  }

  return {
    CATEGORIZER_VERSION,
    CATEGORIZER_CHANGELOG,
    RULES,
    categorize,
    // exposed for parity tests / future reuse:
    categorizeByActionType,
    computeLabels,
    tileIsYakuhaiOrDora,
    tileIsDora,
    tileIsYakuhai,
    statsReasonablyAgree,
    isHonorMjai, isTerminalMjai, isValueTileMjai,
    // Lifted for the shared dimension comparator (compare-dimensions.js) so the
    // pills and the categorizer read identical shanten/ukeire/dora/deal-in
    // primitives — never a forked second copy.
    findInStats,
    getShantenForTile,
    doraUkeireForTile,
    dealinFor,
    tileBase,
  };
}));
