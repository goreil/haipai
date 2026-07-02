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
//   Yaku    — yakuhai_kept, tanyao_kept, honitsu_kept, ittsu_kept
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
    tileIsDora, tileIsYakuhai, isValueTileMjai, tileBase,
  } = categorize;

  // tanyao_kept fires only on an already-simple-heavy hand — a realistic
  // all-simples shape, not an incidental terminal cut from a terminal-heavy
  // hand. The pre-discard hand is 14 tiles; ">= 11 simples" leaves at most 3
  // non-simples (terminals/honors) to clear for tanyao.
  const TANYAO_MIN_SIMPLES = 11;
  // honitsu_kept: of the 14 tiles, >= 10 share one suit-or-honors — a committed
  // flush shape, so cutting one of the few off-suit tiles is the yaku play.
  const HONITSU_MIN_INSHAPE = 10;
  // ittsu_kept: one suit holds >= 6 of the 9 distinct ranks (1-9) needed for a
  // straight — a genuinely stretched suit, not an incidental run.
  const ITTSU_MIN_UNIQUE = 6;

  // mjai suit ("m"/"p"/"s" for numbers, "z" for honors) and rank (1-9, 0 for
  // honors). tileBase strips the red-five "r" so 5mr reads as 5m.
  function tileSuit(t) {
    if (!t) return null;
    const b = tileBase(t);
    if ("ESWNPFC".includes(b)) return "z";
    const s = b[b.length - 1];
    return (s === "m" || s === "p" || s === "s") ? s : null;
  }
  function tileRank(t) {
    const b = t && tileBase(t);
    if (!b || "ESWNPFC".includes(b)) return 0;
    return parseInt(b[0], 10) || 0;
  }
  const skillAreaForEntry = prepParse && prepParse.skill_area_for_entry;

  // Group → display label + colour. The single source for the colour scheme
  // shared by the EV-table feature pills (ev-table.js) and the concept
  // breakdown (game-concept-breakdown.js / game-render.js). Keyed by the
  // `group` field every win carries, so a new dimension inherits its group's
  // colour for free. Hues match the skill-area palette (skill-areas.js).
  // Colours align with the skill-area card palette (categorize-metadata
  // SKILL_AREA_INFO) so a concept shares one hue across the app: Defense is red
  // (matching the Defense card; pink is reserved by Meld), and Yaku is cyan
  // (green is reserved by Kan). Efficiency/Value keep their blue/gold.
  const GROUP_META = {
    Speed:   { label: "Efficiency", color: "#4a9eff" },  // blue
    Yaku:    { label: "Yaku",       color: "#22d3ee" },  // cyan
    Dora:    { label: "Value",      color: "#f5b342" },  // gold
    Defense: { label: "Defense",    color: "#ff6b6b" },  // red
  };

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

  // Push/fold context for a per_threat entry, attached to the deal_in win so the
  // deal-in pill can spell out what you'd be folding to (ev-table.js). `seat`
  // lets the renderer resolve the threat's kyoku wind / dealer-ness from oya;
  // `han` is the guaranteed visible han for OPEN threats (a riichi's han is
  // unknown pre-reveal → null).
  function threatMeta(th) {
    if (!th) return null;
    const open = th.kind === "open";
    return {
      kind: open ? "open" : "riichi",
      seat: th.seat,
      han: open ? (th.guaranteed_han ?? null) : null,
    };
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

    // --- Yaku / tanyao_kept — the side that cuts a non-simple (terminal/honor)
    // keeps the hand all-simples (tanyao), while the other side cuts a simple. ---
    // Gated on an already-simple-heavy hand so we only flag genuine tanyao
    // shapes. The pill's "N/14" is the simples the winning pick preserves — cutting
    // a non-simple keeps every simple, so that's just the pre-discard simple count.
    const hand = m.hand || [];
    const simples = hand.reduce((n, t) => n + (isValueTileMjai(t) ? 0 : 1), 0);
    if (simples >= TANYAO_MIN_SIMPLES && actualTile && expectedTile
        && !meldBlocksTanyao(m.melds)) {
      const aNon = isValueTileMjai(actualTile);
      const eNon = isValueTileMjai(expectedTile);
      if (aNon && !eNon) {
        wins.push({ dim: "tanyao_kept", group: "Yaku", prio: 1, winner: "you", magnitude: simples });
      } else if (eNon && !aNon) {
        wins.push({ dim: "tanyao_kept", group: "Yaku", prio: 1, winner: "mortal", magnitude: simples });
      }
    }

    // --- Yaku / honitsu_kept — the side that cuts an off-suit tile keeps the
    // hand one-suit-plus-honors (honitsu), while the other cuts an in-shape
    // tile. --- Mirrors tanyao: the off-shape cut is the yaku play. Gated on a
    // committed flush shape (>= 11 of 14 tiles in the dominant suit or honors)
    // and suppressed when a called meld already holds an off-suit tile (an open
    // off-suit meld makes any flush impossible). magnitude = in-shape tiles, N/14.
    const fullHand = allHandTiles(m);
    const domSuit = dominantSuit(fullHand);
    if (domSuit && actualTile && expectedTile && !meldBlocksHonitsu(m.melds, domSuit)) {
      const inShape = fullHand.reduce((n, t) => {
        const s = tileSuit(t);
        return n + (s === domSuit || s === "z" ? 1 : 0);
      }, 0);
      if (inShape >= HONITSU_MIN_INSHAPE) {
        const aOff = isOffSuit(actualTile, domSuit);
        const eOff = isOffSuit(expectedTile, domSuit);
        // `suit`/`tiles` drive the pill's colour indicator: a representative
        // mid tile (5) of the flush suit, the same way the yakuhai pill shows
        // the honor it keeps.
        const winner = (aOff && !eOff) ? "you" : (eOff && !aOff) ? "mortal" : null;
        if (winner) {
          wins.push({
            dim: "honitsu_kept", group: "Yaku", prio: 1, winner, magnitude: inShape,
            suit: domSuit, tiles: [`5${domSuit}`],
          });
        }
      }
    }

    // --- Yaku / ittsu_kept — the side that does NOT cut a sole ittsu rank keeps
    // the straight (123-456-789 in one suit) alive, while the other throws a
    // tile the run still needs. --- Unlike tanyao/honitsu the off-shape tiles
    // (other suits, honors, duplicate ranks) are neutral for ittsu — they fill
    // the free 4th set / pair — so the signal is "who threw a needed rank", not
    // "who cut the off-shape tile". Gated on a stretched suit (>= 6 of the 9
    // distinct ranks present) and suppressed when 2+ called melds aren't ittsu
    // runs of the target suit (only one free set fits around the three runs).
    const ittsu = ittsuTargetInfo(m);
    if (ittsu && ittsu.unique >= ITTSU_MIN_UNIQUE && actualTile && expectedTile
        && !meldBlocksIttsu(m.melds, ittsu.suit)) {
      const counts = ittsuRankCounts(m, ittsu.suit);
      const aNeed = ittsuNeededRank(actualTile, ittsu.suit, counts);
      const eNeed = ittsuNeededRank(expectedTile, ittsu.suit, counts);
      const winner = (eNeed && !aNeed) ? "you" : (aNeed && !eNeed) ? "mortal" : null;
      if (winner) {
        // `missing`/`tiles` drive the pill: the ranks the straight still lacks
        // (its colour shows the target suit) plus how many of each remain live,
        // for the hover.
        const missing = ittsuMissing(m, ittsu.suit, counts);
        wins.push({
          dim: "ittsu_kept", group: "Yaku", prio: 1, winner, magnitude: ittsu.unique,
          suit: ittsu.suit, tiles: missing.map(x => x.tile), missing,
        });
      }
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
          // Push/fold context for the deal-in pill (ev-table.js): what you'd be
          // folding to. `han` is the guaranteed visible han — open threats only;
          // a riichi's han is unknown pre-reveal so it stays null.
          threat: threatMeta(th),
        });
      }
    } else {
      const dealinRates = m.dealin_rates || null;
      if (dealinRates && Object.keys(dealinRates).length) {
        const aR = dealinFor(actualTile, dealinRates);
        const eR = dealinFor(expectedTile, dealinRates);
        if (aR != null && eR != null && aR !== eR) {
          // A lone threat collapses to one aggregate pill; still carry its
          // push/fold context (riichi/open, dealer, han) off the single entry.
          const lone = perThreat[0] || null;
          wins.push({
            dim: "deal_in", group: "Defense", prio: 1, aggregate: true,
            winner: aR < eR ? "you" : "mortal", pct: Math.abs(aR - eR),
            threat: lone ? threatMeta(lone) : null,
          });
        }
      }
    }

    return wins;
  }

  // A called meld containing any terminal/honor makes tanyao impossible no
  // matter how the concealed hand develops — so tanyao_kept must never fire.
  // Each meld's tiles are its `consumed` array plus the called `pai`.
  function meldBlocksTanyao(melds) {
    for (const meld of (melds || [])) {
      if (!meld) continue;
      const tiles = (meld.consumed || []).slice();
      if (meld.pai) tiles.push(meld.pai);
      if (tiles.some(t => isValueTileMjai(t))) return true;
    }
    return false;
  }

  // Every tile of the hand (concealed + the tiles locked in called melds) so the
  // honitsu/ittsu shapes read all 14, not just the concealed portion of an open
  // hand. A meld's tiles are its `consumed` array plus the called `pai`.
  function meldTiles(meld) {
    if (!meld) return [];
    const tiles = (meld.consumed || []).slice();
    if (meld.pai) tiles.push(meld.pai);
    return tiles;
  }
  function allHandTiles(m) {
    const tiles = (m.hand || []).slice();
    for (const meld of (m.melds || [])) tiles.push(...meldTiles(meld));
    return tiles;
  }

  // The numbered suit ("m"/"p"/"s") with the most tiles — the suit a honitsu/
  // chinitsu would be built around. null when the hand has no numbered tiles.
  function dominantSuit(tiles) {
    const c = { m: 0, p: 0, s: 0 };
    for (const t of tiles) {
      const s = tileSuit(t);
      if (s && s !== "z") c[s]++;
    }
    let best = null, bestN = 0;
    for (const s of ["m", "p", "s"]) if (c[s] > bestN) { bestN = c[s]; best = s; }
    return best;
  }
  // An off-suit numbered tile (a different colour) — the only cut that advances
  // honitsu. Honors are in-shape, never off-suit.
  function isOffSuit(t, dom) {
    const s = tileSuit(t);
    return !!s && s !== "z" && s !== dom;
  }
  // A called meld holding any off-suit numbered tile (a second colour) makes a
  // flush impossible — honitsu_kept must never fire.
  function meldBlocksHonitsu(melds, dom) {
    for (const meld of (melds || [])) {
      if (meldTiles(meld).some(t => isOffSuit(t, dom))) return true;
    }
    return false;
  }

  // A called meld that is one of the three ittsu runs (123 / 456 / 789) of the
  // given suit — these contribute their ranks toward the straight; any other
  // meld (a pon, a 234 chi, an off-suit run) does not.
  function isIttsuRunMeld(meld, suit) {
    const tiles = meldTiles(meld);
    if (tiles.length !== 3) return false;                 // pon/kan aren't runs
    if (tiles.some(t => tileSuit(t) !== suit)) return false;
    const ranks = tiles.map(tileRank).sort((a, b) => a - b);
    return ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1
      && (ranks[0] === 1 || ranks[0] === 4 || ranks[0] === 7);
  }
  // Tiles usable for an ittsu in `suit`: concealed tiles of that suit plus the
  // ranks locked in ittsu-run melds of that suit. A 234 chi (or any non-run
  // meld) is excluded — its tiles can't serve the straight.
  function ittsuTilesFor(m, suit) {
    const tiles = (m.hand || []).filter(t => tileSuit(t) === suit);
    for (const meld of (m.melds || [])) {
      if (isIttsuRunMeld(meld, suit)) tiles.push(...meldTiles(meld));
    }
    return tiles;
  }
  // Best ittsu candidate: the suit with the most distinct 1-9 ranks present.
  function ittsuTargetInfo(m) {
    let best = null;
    for (const suit of ["m", "p", "s"]) {
      const unique = new Set(ittsuTilesFor(m, suit).map(tileRank)).size;
      if (!best || unique > best.unique) best = { suit, unique };
    }
    return best;
  }
  function ittsuRankCounts(m, suit) {
    const counts = {};
    for (const t of ittsuTilesFor(m, suit)) {
      const r = tileRank(t);
      counts[r] = (counts[r] || 0) + 1;
    }
    return counts;
  }
  // True iff cutting `tile` drops a rank the straight still needs — a sole copy
  // of a 1-9 rank in the target suit. A duplicate rank, an off-suit tile, or an
  // honor is safe to cut (the run survives).
  function ittsuNeededRank(tile, suit, counts) {
    if (tileSuit(tile) !== suit) return false;
    const r = tileRank(tile);
    if (r < 1 || r > 9) return false;
    return (counts[r] || 0) === 1;
  }
  // The 1-9 ranks the straight still lacks, each with how many copies remain
  // live (4 minus every visible copy — our hand/melds, all discards, opponents'
  // melds, dora indicators). Powers the ittsu pill's hover ("still needs 4s,
  // 3 left"). Visible counts fall back gracefully to 4-left when the board
  // state is absent (e.g. parity tests).
  function visibleCounts(m) {
    const board = m.board_state || {};
    const map = {};
    const add = (t) => { if (!t) return; const b = tileBase(t); map[b] = (map[b] || 0) + 1; };
    for (const t of (m.hand || [])) add(t);
    for (const meld of (m.melds || [])) meldTiles(meld).forEach(add);
    for (const d of (board.all_discards || [])) for (const x of (d.discards || [])) add(x.tile);
    for (const om of (board.opponent_melds || [])) for (const meld of (om.melds || [])) meldTiles(meld).forEach(add);
    for (const ind of (board.dora_indicators || [])) add(ind);
    return map;
  }
  function ittsuMissing(m, suit, counts) {
    const vis = visibleCounts(m);
    const out = [];
    for (let r = 1; r <= 9; r++) {
      if ((counts[r] || 0) > 0) continue;
      const tile = `${r}${suit}`;
      out.push({ tile, left: Math.max(0, 4 - (vis[tile] || 0)) });
    }
    return out;
  }
  // 2+ called melds that aren't ittsu runs of the target suit kill the straight:
  // the three runs already fill three of the four sets, leaving room for only
  // one free meld (the 4th set) around them.
  function meldBlocksIttsu(melds, suit) {
    let nonRun = 0;
    for (const meld of (melds || [])) {
      if (meld && !isIttsuRunMeld(meld, suit)) nonRun++;
    }
    return nonRun >= 2;
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

  // Derive the three-way shape from the win-vector topology (CORE Phase 1.1).
  // The single source of truth for both the golden snapshot and the live
  // categorize result — they import this, never a forked copy, so the frozen
  // baseline and the runtime classification can't drift.
  //
  // Shape describes a discard-vs-discard value/speed/safety trade, so it is
  // derived only when BOTH picks are dahai. Action decisions (call / reach /
  // kan) are classified by their action category and carry no shape ("n/a").
  function deriveShape(wins, m) {
    const actualType = m && m.actual && m.actual.type;
    const expectedType = m && m.expected && m.expected.type;
    if (actualType !== "dahai" || expectedType !== "dahai") return "n/a";
    const youWin = wins.filter(w => w.winner === "you" && !w.suppressed);
    const mortalWin = wins.filter(w => w.winner === "mortal" && !w.suppressed);
    // Check "Mortal wins nothing visible" FIRST → complex ("the stats don't
    // explain it — trust the read"). That single branch covers both the
    // one-sided case (you won something, Mortal nothing) AND the both-empty
    // case (identical visible stats, yet Mortal's pick is better): the same
    // unnamed edge as every other complex spot, we just don't have a feature
    // to name it yet.
    if (!mortalWin.length) return "complex";
    if (!youWin.length) return "obvious";
    return "trade-off";
  }

  return { compareDimensions, deriveShape, skillAreaFor, threatScene, comparedTiles, GROUP_META };
}));
