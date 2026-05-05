// Mistake categorizer — JS mirror of lib/categorize/{rules,labels}.py
// + the relevant slice of lib/categorize/__init__.py::categorize_mistake.
//
// Input: a mistake dict shaped like the API response (hand, melds, actual,
// expected, discard_stats, dealin_rates, board_state, optional pre-shipped
// scene flags). Output: { category, categorize_data, labels }.
//
// Inputs not derivable from data_json alone (currently just
// `threatening_opponent`, a 3+-open-melds scene flag) are read from
// the existing `categorize_data` blob carried over from the backend.
// That keeps step-1 self-contained: the server emits the raw signal,
// the JS only owns the decision.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiCategorize = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

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
  function computeLabels(actualTile, expectedTile, openingDora, roundWind, seatWind) {
    const tiles = [actualTile, expectedTile].filter(Boolean);
    const doraSet = openingDora instanceof Set ? openingDora : new Set(openingDora || []);
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

  function tileIsYakuhaiOrDora(tile, openingDora, roundWind, seatWind) {
    if (!tile) return false;
    if (tile === "P" || tile === "F" || tile === "C") return true;
    if (tile === roundWind || tile === seatWind) return true;
    if (tile === "5mr" || tile === "5pr" || tile === "5sr") return true;
    const doraSet = openingDora instanceof Set ? openingDora : new Set(openingDora || []);
    return doraSet.has(tile);
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
  function classifyPush(actualTile, expectedTile, discardStats, catData, labels, actualValueTile) {
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

    // P3: hand-value preservation. Need a yakuhai/dora label, AND Mortal
    // must be the one keeping it (so the discarded tile is the value tile).
    if (labels && (labels.includes("yakuhai") || labels.includes("dora"))) {
      if (actualValueTile == null || actualValueTile) return "P3";
    }

    return "P4";
  }

  // --- _classify_defense: D1 / D2 / D3 (with push_reason side-output) ---
  function classifyDefense(actualTile, expectedTile, dealinRates,
                            discardStats, catData, labels, actualValueTile) {
    const userR = dealinFor(actualTile, dealinRates);
    const mortalR = dealinFor(expectedTile, dealinRates);

    // Strict inequality — equal deal-in rate means Mortal isn't defending.
    if (userR != null && mortalR != null && mortalR < userR) {
      return { category: "D1", pushReason: null };
    }

    const push = classifyPush(actualTile, expectedTile, discardStats, catData,
                              labels, actualValueTile);
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
    // NOTE: Python parity — categorize_mistake passes only the *opening*
    // dora indicator to compute_labels, ignoring kan-revealed extras even
    // when they're visible at decision time. We mirror that by reading
    // only `dora_tiles[0]` (parallel-indexed with dora_indicators[0]).
    // Probably a Python bug worth fixing later — for step 1 we match.
    const board = m.board_state || {};
    const openingDora = (board.dora_tiles && board.dora_tiles.length)
      ? new Set([board.dora_tiles[0]])
      : new Set();
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

    // Carry over scene flags that JS can't derive.
    const incoming = m.categorize_data || {};
    if (incoming.threatening_opponent) catData.threatening_opponent = true;
    if (dealinRates && Object.keys(dealinRates).length > 0) {
      catData.defense_trigger = "riichi";
    }

    const labels = computeLabels(actual.pai, expected.pai, openingDora, roundWind, seatWind);

    // P3 side check: Mortal must be the one keeping the value tile, i.e.
    // the discarded (actual) side IS the yakuhai/dora.
    const actualValueTile = tileIsYakuhaiOrDora(actual.pai, openingDora, roundWind, seatWind);

    let category;
    if (dealinRates && Object.keys(dealinRates).length > 0) {
      const def = classifyDefense(actual.pai, expected.pai, dealinRates,
                                  discardStats, catData, labels, actualValueTile);
      category = def.category;
      if (def.pushReason) catData.push_reason = def.pushReason;

      const userR = dealinFor(actual.pai, dealinRates);
      const mortalR = dealinFor(expected.pai, dealinRates);
      if (userR === 0 && mortalR === 0 && (category === "D2" || category === "D3")) {
        catData.both_safe = true;
      }
    } else {
      category = classifyPush(actual.pai, expected.pai, discardStats, catData,
                              labels, actualValueTile);
    }

    return { category, categorize_data: catData, labels };
  }

  return {
    RULES,
    categorize,
    // exposed for parity tests / future reuse:
    categorizeByActionType,
    classifyPush,
    classifyDefense,
    computeLabels,
    tileIsYakuhaiOrDora,
    statsReasonablyAgree,
    isHonorMjai, isTerminalMjai, isValueTileMjai, tileBase,
  };
}));
