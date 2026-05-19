// Mistake categorizer — sole owner of the rule-decision logic for the app.
//
// Input: a mistake dict shaped like the API response (hand, melds, actual,
// expected, discard_stats, dealin_rates, board_state). Prep runs in
// static/js/prep/ on fetch; this file decides the category from those inputs.
//
// Output: { category, categorize_data, labels } in the shape consumers
// (mistake-card, categorize-view, EV table) read from each mistake.
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
  const CATEGORIZER_VERSION = 1;
  const CATEGORIZER_CHANGELOG = {
    1: "Initial JS-side categorizer (P1-P4 push, D1-D3 defense, 4A/4B/4C meld, 5A/5B riichi, 6A/6B kan).",
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
    if (KAN.has(at) && (et === "dahai" || et === "none")) return "6A";
    if ((at === "dahai" || at === "none") && KAN.has(et)) return "6B";

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
  function classifyPush(actualTile, expectedTile, discardStats, catData, labels, valueCtx) {
    const actualStat = findInStats(actualTile, discardStats);
    const expectedStat = findInStats(expectedTile, discardStats);

    // P1: shanten increase. Detect from discard_stats first (works on legacy
    // mistakes that pre-date the shanten_increase flag).
    const bestShanten = discardStats && discardStats.length ? (discardStats[0].shanten ?? null) : null;
    if (actualStat && bestShanten != null
        && actualStat.shanten != null
        && actualStat.shanten > bestShanten) {
      return "P1";
    }
    if (catData && catData.shanten_increase) return "P1";

    // P2: strictly worse ukeire. Skip when Mortal's pick is at a worse
    // shanten — that's BUG-01 (comparing ukeire across shanten is bogus).
    if (actualStat && expectedStat) {
      const aSh = actualStat.shanten;
      const eSh = expectedStat.shanten;
      const shantenOk = aSh == null || eSh == null || eSh <= aSh;
      const aNec = actualStat.necessary_count || 0;
      const eNec = expectedStat.necessary_count || 0;
      if (shantenOk && eNec > aNec) return "P2";
    }

    // P3: hand-value preservation. Fires when at least one value
    // dimension applies — meaning the YOUR-discard tile carries that
    // value and Mortal's pick does not.
    if (valueCtx && (valueCtx.doraApplies || valueCtx.yakuhaiApplies)) {
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
    if (discardStats.length) {
      catData.shanten = discardStats[0].shanten ?? null;
    }

    // Shanten-increase signals.
    const actualShanten = getShantenForTile(actual.pai, discardStats);
    const bestShanten = discardStats.length ? (discardStats[0].shanten ?? null) : null;
    if (actualShanten != null && bestShanten != null && actualShanten > bestShanten) {
      catData.shanten_increase = true;
      catData.actual_shanten = actualShanten;
      catData.best_shanten = bestShanten;
    }

    if (dealinRates && Object.keys(dealinRates).length > 0) {
      catData.defense_trigger = "riichi";
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
    const valueCtx = { doraApplies, yakuhaiApplies };

    if (doraApplies || yakuhaiApplies) {
      // Stash for the explainer. similar_acceptance flips the trigger
      // line between "Similar tile acceptance, …" and the looser
      // "Mortal is preserving hand value." framing (#4263).
      const aStat = findInStats(actual.pai, discardStats);
      const eStat = findInStats(expected.pai, discardStats);
      const aNec = (aStat && aStat.necessary_count) || 0;
      const eNec = (eStat && eStat.necessary_count) || 0;
      const similarAcceptance = aNec === 0 || eNec >= aNec * 0.9;
      catData.value_preserve = {
        dora: doraApplies,
        yakuhai: yakuhaiApplies,
        similar_acceptance: similarAcceptance,
      };
    }

    let category;
    if (dealinRates && Object.keys(dealinRates).length > 0) {
      const def = classifyDefense(actual.pai, expected.pai, dealinRates,
                                  discardStats, catData, labels, valueCtx);
      category = def.category;
      if (def.pushReason) catData.push_reason = def.pushReason;

      const userR = dealinFor(actual.pai, dealinRates);
      const mortalR = dealinFor(expected.pai, dealinRates);
      if (userR === 0 && mortalR === 0 && (category === "D2" || category === "D3")) {
        catData.both_safe = true;
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
    isHonorMjai, isTerminalMjai, isValueTileMjai, tileBase,
  };
}));
