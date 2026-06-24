// Shared dimension comparator — the single source of truth for "how does your
// pick differ from Mortal's?". (mistake-dimensions CORE, Phase 0.)
//
// Both engines that used to answer this question independently now consume this
// one win-vector, so they can no longer drift:
//   - the EV-table feature pills (static/js/ev-table.js) render it directly;
//   - the categorizer's `shape` (CORE Phase 1) is derived from its topology.
//
// `compareDimensions(m)` returns the FULL win-vector — every dimension is
// evaluated and emitted (nothing short-circuits), each tagged with its group:
//
//   Speed   — shanten, ukeire   (ukeire is GATED: only a real win at tied shanten)
//   Yaku    — yakuhai_kept
//   Dora    — dora_kept, dora_acceptance
//   Defense — deal_in           (a per-opponent vector, read off m.per_threat)
//
// Each entry: { dim, group, prio, winner: "you"|"mortal"|null, magnitude?,
//   pct?, tiles?, suppressed?, context?, seat?, kind? }. "you" = the player's
// (actual) pick; "mortal" = the AI's (expected) pick. A dimension with no
// winner (a tie) is simply not emitted.
//
// The ukeire gate is the one behavioural fix this module ships: raw ukeire
// counts are not comparable across shanten (a 2-shanten hand structurally
// accepts more tiles than a 1-shanten hand), so "+5 ukeire while +1 shanten
// worse" is a wide-but-slow shape, not a win. When shanten differs the ukeire
// entry is emitted `suppressed: true` with a context string and never counts
// as a winning pill. ev-table.js previously fired the +ukeire pill with no
// shanten gate at all — that bug dies here.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./categorize.js"), require("./prep/parse.js"));
  } else {
    root.haipaiCompareDimensions = factory(root.haipaiCategorize, root.haipaiPrepParse);
  }
}(typeof self !== "undefined" ? self : this, function (categorize, prepParse) {

  // Reuse the categorizer's primitives verbatim — no forked dora/yakuhai/
  // shanten/deal-in logic (the whole point of a shared comparator).
  const {
    findInStats, getShantenForTile, doraUkeireForTile, dealinFor,
    tileIsDora, tileIsYakuhai,
  } = categorize;
  const skillAreaForEntry = prepParse && prepParse.skill_area_for_entry;

  // The two tiles under comparison, derived exactly as ev-table.js does: a
  // reach action has no pai of its own (the riichi tile is the next dahai), so
  // 5A reads actual_riichi_tile and 5B reuses the player's discard for both.
  function comparedTiles(m) {
    const actual = m.actual || {};
    const expected = m.expected || {};
    const actualTile = actual.pai
      || (actual.type === "reach" ? m.actual_riichi_tile : null);
    const expectedTile = expected.pai
      || (expected.type === "reach" ? actualTile : null);
    return { actualTile, expectedTile };
  }

  // True iff there's a live riichi / open-only threat at this decision — the
  // same scene read the categorizer makes from per_threat + dealin_rates. Feeds
  // skill_area_for_entry's in_riichi / open_threat and is reserved for the
  // deal_in vector. Kept here so the snapshot (Phase 0) and the categorize
  // result (Phase 1) classify the scene identically.
  function threatScene(m) {
    const dealinRates = m.dealin_rates || null;
    const hasDealin = !!(dealinRates && Object.keys(dealinRates).length > 0);
    const threatKinds = new Set((m.per_threat || []).map(t => (t && t.kind) || "riichi"));
    const riichiThreat = hasDealin
      && (threatKinds.has("riichi") || threatKinds.size === 0);
    const openOnlyThreat = hasDealin && !riichiThreat && threatKinds.has("open");
    return { riichiThreat, openOnlyThreat, hasDealin };
  }

  // Skill area for a mistake, via the unchanged scene classifier
  // (prep/parse.js::skill_area_for_entry) — never from a category code. detail
  // types aren't carried on a prepped mistake; actual/expected types cover
  // every action-type scene, and the dahai fallthrough only needs the threat
  // scene (riichi → defense, open-only → open_defense, else attack).
  function skillAreaFor(m) {
    if (!skillAreaForEntry) return null;
    const actual = m.actual || {};
    const expected = m.expected || {};
    const { riichiThreat, openOnlyThreat } = threatScene(m);
    return skillAreaForEntry(
      actual.type || null, expected.type || null, [],
      riichiThreat, openOnlyThreat);
  }

  function compareDimensions(m) {
    const wins = [];
    const { actualTile, expectedTile } = comparedTiles(m);
    const discardStats = m.discard_stats || [];

    const board = m.board_state || {};
    const doraTiles = new Set(board.dora_tiles || []);
    const roundWind = board.round_wind || null;
    const seatWind = board.seat_wind || null;

    const actualStat = findInStats(actualTile, discardStats);
    const expectedStat = findInStats(expectedTile, discardStats);
    const aSh = actualStat ? (actualStat.shanten ?? null) : null;
    const eSh = expectedStat ? (expectedStat.shanten ?? null) : null;

    // --- Speed / shanten — lower wins; only fires on a strict difference. ---
    if (aSh != null && eSh != null && aSh !== eSh) {
      wins.push({
        dim: "shanten", group: "Speed", prio: 1,
        winner: aSh < eSh ? "you" : "mortal",
        magnitude: Math.abs(aSh - eSh),
      });
    }

    // --- Speed / ukeire — more wins, GATED on tied shanten. ---
    // When shanten differs the wider count is the seductive wide-but-slow
    // shape: emit it suppressed, as context, never a winning pill.
    const aNec = (actualStat && actualStat.necessary_count) || 0;
    const eNec = (expectedStat && expectedStat.necessary_count) || 0;
    if (actualStat && expectedStat && aNec !== eNec) {
      const winner = aNec > eNec ? "you" : "mortal";
      const sameShanten = aSh == null || eSh == null || aSh === eSh;
      const entry = {
        dim: "ukeire", group: "Speed", prio: 2,
        winner, magnitude: Math.abs(aNec - eNec),
      };
      if (!sameShanten) {
        entry.suppressed = true;
        entry.context = "wider, but a step slower";
      }
      wins.push(entry);
    }

    // --- Yaku / yakuhai_kept — the side that keeps a yakuhai the other drops. ---
    // ev-table's +yakuhai pill rides on the column NOT discarding the yakuhai;
    // the kept tile is the other column's discard.
    const aYak = tileIsYakuhai(actualTile, roundWind, seatWind);
    const eYak = tileIsYakuhai(expectedTile, roundWind, seatWind);
    if (eYak && !aYak) {
      wins.push({ dim: "yakuhai_kept", group: "Yaku", prio: 1, winner: "you", tiles: [expectedTile] });
    } else if (aYak && !eYak) {
      wins.push({ dim: "yakuhai_kept", group: "Yaku", prio: 1, winner: "mortal", tiles: [actualTile] });
    }

    // --- Dora / dora_kept — the side that keeps a dora the other drops. ---
    const aDora = tileIsDora(actualTile, doraTiles);
    const eDora = tileIsDora(expectedTile, doraTiles);
    if (eDora && !aDora) {
      wins.push({ dim: "dora_kept", group: "Dora", prio: 1, winner: "you", tiles: [expectedTile] });
    } else if (aDora && !eDora) {
      wins.push({ dim: "dora_kept", group: "Dora", prio: 1, winner: "mortal", tiles: [actualTile] });
    }

    // --- Dora / dora_acceptance — the wait that draws strictly more live dora. ---
    // Net rule (categorizer's): a side throwing its own dora to re-accept it is
    // a wash, so the win is suppressed when that side's discard is itself a
    // dora. The dora the winning wait keeps but the loser's drops names the tiles.
    const aAcc = doraUkeireForTile(actualTile, discardStats, doraTiles);
    const eAcc = doraUkeireForTile(expectedTile, discardStats, doraTiles);
    if (eAcc > aAcc && !eDora) {
      wins.push({
        dim: "dora_acceptance", group: "Dora", prio: 2, winner: "mortal",
        magnitude: eAcc - aAcc,
        tiles: doraAcceptTiles(expectedStat, actualStat, doraTiles),
      });
    } else if (aAcc > eAcc && !aDora) {
      wins.push({
        dim: "dora_acceptance", group: "Dora", prio: 2, winner: "you",
        magnitude: aAcc - eAcc,
        tiles: doraAcceptTiles(actualStat, expectedStat, doraTiles),
      });
    }

    // --- Defense / deal_in — per-opponent vector (read off per_threat). ---
    // With 2+ live threats a pick can be safer vs one and riskier vs another, so
    // the vector is emitted per seat (matching the per-direction deal-in pills);
    // a lone threat collapses to a single aggregate entry off m.dealin_rates.
    const perThreat = Array.isArray(m.per_threat) ? m.per_threat : [];
    if (perThreat.length >= 2) {
      for (const th of perThreat) {
        if (!th || !th.dealin_rates) continue;
        const aR = dealinFor(actualTile, th.dealin_rates);
        const eR = dealinFor(expectedTile, th.dealin_rates);
        if (aR == null || eR == null || aR === eR) continue;
        wins.push({
          dim: "deal_in", group: "Defense", prio: 1,
          winner: aR < eR ? "you" : "mortal",
          pct: Math.abs(aR - eR), seat: th.seat, kind: th.kind || "riichi",
        });
      }
    } else {
      const dealinRates = m.dealin_rates || null;
      if (dealinRates && Object.keys(dealinRates).length) {
        const aR = dealinFor(actualTile, dealinRates);
        const eR = dealinFor(expectedTile, dealinRates);
        if (aR != null && eR != null && aR !== eR) {
          wins.push({
            dim: "deal_in", group: "Defense", prio: 1, aggregate: true,
            winner: aR < eR ? "you" : "mortal", pct: Math.abs(aR - eR),
          });
        }
      }
    }

    return wins;
  }

  // The live-dora tiles the winning wait accepts that the losing wait doesn't —
  // for the pill / fragment to name ("its wait still draws 4m (dora)").
  function doraAcceptTiles(winStat, loseStat, doraTiles) {
    const loseDora = new Set(((loseStat && loseStat.necessary_tiles) || [])
      .filter(nt => doraTiles.has(nt.tile)).map(nt => nt.tile));
    return ((winStat && winStat.necessary_tiles) || [])
      .filter(nt => doraTiles.has(nt.tile) && !loseDora.has(nt.tile))
      .map(nt => nt.tile);
  }

  return { compareDimensions, skillAreaFor, threatScene, comparedTiles };
}));
