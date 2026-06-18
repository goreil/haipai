// Mistake categorizer — sole owner of the rule-decision logic for the app.
//
// Input: a mistake dict shaped like the API response (hand, melds, actual,
// expected, discard_stats, dealin_rates, board_state). Prep runs in
// static/js/prep/ on fetch; this file decides the category from those inputs.
//
// Output: { category, categorize_data, labels } in the shape consumers
// (mistake-card, categorize-explanations, EV table) read from each mistake.
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
  const CATEGORIZER_VERSION = 7;
  const CATEGORIZER_CHANGELOG = {
    1: "Initial JS-side categorizer (P1-P4 push, D1-D3 defense, 4A/4B/4C meld, 5A/5B riichi, 6A/6B kan).",
    2: "P1/P2 shanten + ukeire comparisons now use Mortal's expected pick, not the speed-calculator's top. Fixes false shanten-failure flags when calc finds a faster line than Mortal (#6805, #6283, #12151, #12164).",
    3: "P3 now requires Mortal's ukeire to be at least equal to the player's (strict, no similarity threshold). Rule is now: more ukeire or better shanten → push; otherwise complex. Affects #12151.",
    4: "P3 reverted to a pure dora/yakuhai check — no ukeire comparison. The v3 gate misclassified #12611 (E discard is round-wind + dora, but had more ukeire than Mortal's 6p) as P4 Complex. Also drops the `similar_acceptance` flag and its '*0.9' similarity threshold from value_preserve.",
    5: "Kan-vs-call mismatches (chi/pon vs a kan, either direction) now route to 6A/6B instead of falling through to P4. Fixes #14173 (R-179): pon East when daiminkan East was the play is now 6B Missed Kan, not Complex Decision.",
    6: "Open Defense axis (OD1/OD2/OD3, backlog C-02): non-riichi opponents whose open melds pass the prep-side trigger emit kind='open' threats; dahai mistakes in open-threat-only scenes route to OD tiers via the same defend/push/complex logic as D1-D3.",
    7: "P3 also fires on dora-acceptance: when Mortal's pick keeps a wait that accepts strictly more live dora than yours (its ukeire intersects the active dora set more), the mistake is hand value, not Complex. Net rule — suppressed when Mortal's own discard is a dora (throwing a dora to re-accept it is a wash). Fixes #4932 (breaking the 5m6m ryanmen drops the 4m-dora acceptance).",
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

    if (et === "hora") return "P4";
    if (at === "dahai" && et === "dahai") return null;
    return "P4";
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

  // --- _classify_push: P1 / P2 / P3 / P4 ---
  // valueCtx (optional): { doraApplies, yakuhaiApplies } — each true iff
  // the actual (your) discard qualifies for that value dimension AND the
  // expected (Mortal's) discard does NOT. This is what distinguishes
  // "Mortal preserves a value tile" (P3) from "both sides give up the
  // same kind of value" (P4) — see #6165 (both red five), #6710 (both
  // dragons).
  //
  // All shanten / ukeire comparisons are against Mortal's expected pick,
  // never against the in-app speed calculator's top — see #6805, #6283,
  // #12151 / #12164 where calc found a faster line than Mortal and the
  // user was falsely flagged with a shanten failure or worse ukeire.
  function classifyPush(actualTile, expectedTile, discardStats, catData, labels, valueCtx) {
    const actualStat = findInStats(actualTile, discardStats);
    const expectedStat = findInStats(expectedTile, discardStats);

    // P1: your discard's shanten is strictly worse than Mortal's pick.
    if (actualStat && expectedStat
        && actualStat.shanten != null
        && expectedStat.shanten != null
        && actualStat.shanten > expectedStat.shanten) {
      return "P1";
    }

    // P2: strictly worse ukeire at the same shanten as Mortal.
    const aNec = (actualStat && actualStat.necessary_count) || 0;
    const eNec = (expectedStat && expectedStat.necessary_count) || 0;
    if (actualStat && expectedStat) {
      const aSh = actualStat.shanten;
      const eSh = expectedStat.shanten;
      const sameShanten = aSh == null || eSh == null || eSh === aSh;
      if (sameShanten && eNec > aNec) return "P2";
    }

    // P3: hand-value preservation. Fires whenever your discard carries
    // dora/yakuhai that Mortal's pick doesn't — pure value check, no
    // ukeire comparison. (#12611: discarding E gives more ukeire than
    // Mortal's 6p, but E is round wind + dora so the mistake is still
    // hand value, not "complex".) doraAcceptApplies extends this to the
    // case where the dora is in the WAIT, not the discarded tile: Mortal's
    // pick keeps a wait that accepts more live dora than yours (#4932).
    if (valueCtx && (valueCtx.doraApplies || valueCtx.yakuhaiApplies
                     || valueCtx.doraAcceptApplies)) {
      return "P3";
    }

    return "P4";
  }

  // --- _classify_defense: D1 / D2 / D3 (with push_reason side-output) ---
  function classifyDefense(actualTile, expectedTile, dealinRates,
                            discardStats, catData, labels, valueCtx) {
    const userR = dealinFor(actualTile, dealinRates);
    const mortalR = dealinFor(expectedTile, dealinRates);

    // Strict inequality — equal deal-in rate means Mortal isn't defending.
    if (userR != null && mortalR != null && mortalR < userR) {
      return { category: "D1", pushReason: null };
    }

    const push = classifyPush(actualTile, expectedTile, discardStats, catData,
                              labels, valueCtx);
    if (push === "P1" || push === "P2" || push === "P3") {
      return { category: "D2", pushReason: push };
    }
    return { category: "D3", pushReason: null };
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
      return { category: actionCat, categorize_data: {}, labels: [] };
    }

    // dahai vs dahai — needs discard_stats + dealin_rates.
    const discardStats = m.discard_stats || [];
    const dealinRates = m.dealin_rates || null;

    // Reconstruct dora/winds from the canonical board_state shipped server-side.
    // dora_tiles is the full active set (opening indicator + any kan-revealed
    // dora visible at decision time), so kan dora are tagged on labels.
    const board = m.board_state || {};
    const doraTiles = new Set(board.dora_tiles || []);
    const roundWind = board.round_wind || null;
    const seatWind = board.seat_wind || null;

    // categorize_data accumulator.
    const catData = {};
    // Headline shanten = Mortal's expected discard's resulting shanten.
    // Calc-only fields (discardStats[0]) are display-only and never enter
    // categorize_data; the trainer text always reasons off Mortal's pick.
    const expectedShanten = getShantenForTile(expected.pai, discardStats);
    if (expectedShanten != null) {
      catData.shanten = expectedShanten;
    }

    // Shanten-increase signal: your discard puts you at a worse shanten
    // than Mortal's choice would have.
    const actualShanten = getShantenForTile(actual.pai, discardStats);
    if (actualShanten != null && expectedShanten != null && actualShanten > expectedShanten) {
      catData.shanten_increase = true;
      catData.actual_shanten = actualShanten;
      catData.best_shanten = expectedShanten;
    }

    // Threat kinds come from prep's per_threat (single source of truth).
    // Missing kind tags (older prepped data) are treated as riichi.
    const threatKinds = new Set(
      (m.per_threat || []).map(t => (t && t.kind) || "riichi"));
    const hasDealin = !!(dealinRates && Object.keys(dealinRates).length > 0);
    const riichiThreat = hasDealin
      && (threatKinds.has("riichi") || threatKinds.size === 0);
    const openOnlyThreat = hasDealin && !riichiThreat && threatKinds.has("open");

    if (riichiThreat) {
      catData.defense_trigger = "riichi";
    } else if (openOnlyThreat) {
      catData.defense_trigger = "open";
    }

    // Scene flag: any non-player seat with 3+ open calls (chi/pon/daiminkan)
    // visible at decision time signals a fast, threatening hand even without
    // a riichi declaration. opponent_melds is already cut at the mistake's
    // tiles_left, so future melds don't leak in. Mirrors the original
    // _has_threatening_opponent in the removed Python categorizer.
    if (hasThreateningOpponent(board.opponent_melds)) {
      catData.threatening_opponent = true;
    }

    const labels = computeLabels(actual.pai, expected.pai, doraTiles, roundWind, seatWind);

    // Per-dimension value preservation — each is true only when YOUR
    // discard has that value AND Mortal's discard does not. Splitting
    // dora and yakuhai independently is what handles #5094 cleanly:
    // both tiles are yakuhai (yakuhai_applies=false), but only yours is
    // dora (dora_applies=true), so it's still a hand-value mistake.
    const doraApplies = tileIsDora(actual.pai, doraTiles)
                     && !tileIsDora(expected.pai, doraTiles);
    const yakuhaiApplies = tileIsYakuhai(actual.pai, roundWind, seatWind)
                        && !tileIsYakuhai(expected.pai, roundWind, seatWind);

    // Dora-acceptance (#4932): Mortal's wait accepts strictly more live dora
    // than yours. Net rule — if Mortal's own discard is a dora it's throwing
    // value to re-accept it, so the gain is a wash and we don't fire. (When
    // YOUR discard is the dora, doraApplies already routes to P3 upstream.)
    const doraAcceptExpected = doraUkeireForTile(expected.pai, discardStats, doraTiles);
    const doraAcceptActual = doraUkeireForTile(actual.pai, discardStats, doraTiles);
    const doraAcceptApplies = doraAcceptExpected > doraAcceptActual
                           && !tileIsDora(expected.pai, doraTiles);
    const valueCtx = { doraApplies, yakuhaiApplies, doraAcceptApplies };

    if (doraApplies || yakuhaiApplies || doraAcceptApplies) {
      catData.value_preserve = {
        dora: doraApplies,
        yakuhai: yakuhaiApplies,
        dora_acceptance: doraAcceptApplies,
      };
      // Name the dora tiles Mortal's wait keeps but yours drops, for the
      // explanation text ("Mortal's wait still accepts 4m (dora)").
      if (doraAcceptApplies) {
        const expStat = findInStats(expected.pai, discardStats);
        const actStat = findInStats(actual.pai, discardStats);
        const yourDora = new Set(((actStat && actStat.necessary_tiles) || [])
          .filter(nt => doraTiles.has(nt.tile)).map(nt => nt.tile));
        catData.value_preserve.dora_accept_tiles =
          ((expStat && expStat.necessary_tiles) || [])
            .filter(nt => doraTiles.has(nt.tile) && !yourDora.has(nt.tile))
            .map(nt => nt.tile);
      }
    }

    let category;
    if (riichiThreat || openOnlyThreat) {
      const def = classifyDefense(actual.pai, expected.pai, dealinRates,
                                  discardStats, catData, labels, valueCtx);
      category = def.category;
      if (def.pushReason) catData.push_reason = def.pushReason;

      const userR = dealinFor(actual.pai, dealinRates);
      const mortalR = dealinFor(expected.pai, dealinRates);
      if (userR === 0 && mortalR === 0 && (category === "D2" || category === "D3")) {
        catData.both_safe = true;
      }
      // Open-only threats use the same defend/push/complex logic but land in
      // their own OD tier so trends can split riichi defense from open defense.
      if (openOnlyThreat) {
        category = { D1: "OD1", D2: "OD2", D3: "OD3" }[category] || category;
      }
    } else {
      category = classifyPush(actual.pai, expected.pai, discardStats, catData,
                              labels, valueCtx);
    }

    return { category, categorize_data: catData, labels };
  }

  return {
    CATEGORIZER_VERSION,
    CATEGORIZER_CHANGELOG,
    RULES,
    categorize,
    // exposed for parity tests / future reuse:
    categorizeByActionType,
    classifyPush,
    classifyDefense,
    computeLabels,
    tileIsYakuhaiOrDora,
    tileIsDora,
    tileIsYakuhai,
    statsReasonablyAgree,
    isHonorMjai, isTerminalMjai, isValueTileMjai,
  };
}));
