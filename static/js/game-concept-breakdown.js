// Concept-level EV breakdown — shown at the top of a game detail.
//
// Re-buckets every mistake's feature pills (the win-vector from
// compare-dimensions.js, the SAME source the EV-table pills render) into two
// ledgers, so a game opens with "what kind of points am I leaking?":
//
//   • Missed     — pills won by Mortal (the AI / expected pick). The better
//                  play held this edge, so you lose points UNDER-using the
//                  concept (you discarded the ukeire, threw the dora, pushed
//                  the unsafe tile).
//   • Overvalued — pills won by you (the actual pick). You kept this edge but
//                  the play was still a mistake, so you lose points
//                  OVER-prioritizing the concept (chasing dora/speed when
//                  folding or a safer shape scored better).
//
// Buckets roll up to the GROUP (compare-dimensions.GROUP_META: Efficiency /
// Yaku / Value / Defense), deduped per mistake — so a mistake winning both
// ukeire and shanten, or both dora_kept and dora_acceptance, is ONE group hit,
// not two. Each row carries the summed EV loss and a severity split. A mistake's
// full ev_loss is attributed to every group it touches (one mistake can be both
// "overvalued Value" and "missed Defense"), so the two ledgers are an
// attribution view, not a partition of total EV.
//
// On top of the win-vector groups, the breakdown adds category/shape pills that
// read straight off the categorized mistake (m.category / m.shape), so action
// decisions the win-vector can't describe still surface (ACTION_CELL/PILL_META):
//   • Riichi / Meld / Kan — Missed (→ Losing points here) vs Bad (→ Overvaluing).
//   • Complex — missed-side only: dahai spots the visible stats don't explain.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiConceptBreakdown = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  // Pill dim → display label. Order is the fallback sort (ledgers sort by EV
  // first); dims absent here (none today) are skipped so an unmapped future
  // pill never renders blank.
  var CONCEPT_META = {
    shanten:         { label: "Speed (shanten)" },
    ukeire:          { label: "Efficiency (ukeire)" },
    yakuhai_kept:    { label: "Yakuhai" },
    tanyao_kept:     { label: "Tanyao" },
    honitsu_kept:    { label: "Honitsu" },
    ittsu_kept:      { label: "Ittsu" },
    dora_kept:       { label: "Dora" },
    dora_acceptance: { label: "Dora acceptance" },
    deal_in:         { label: "Defense (deal-in)" },
  };

  // Action-decision codes (categorize.js::categorizeByActionType) → the ledger
  // cell they feed. These are NOT win-vector pills — they read straight off the
  // categorized `m.category`, so a call/riichi/kan that the win-vector can't
  // describe still surfaces. A *missed* action (you should have acted) is a leak
  // you under-used → "missed"; a *bad* action (you acted when you shouldn't) is
  // a concept you over-prioritized → "you". 4C (called the wrong combination) is
  // still an active call, so it sits with the over-melding side.
  var ACTION_CELL = {
    "5B": { side: "missed", group: "Riichi" },  // Missed Riichi
    "5A": { side: "you",    group: "Riichi" },  // Bad Riichi
    "4B": { side: "missed", group: "Meld" },    // Missed Call
    "4A": { side: "you",    group: "Meld" },    // Bad Call
    "4C": { side: "you",    group: "Meld" },    // Wrong combination
    "6B": { side: "missed", group: "Kan" },     // Missed Kan
    "6A": { side: "you",    group: "Kan" },     // Bad Kan
  };

  // Display meta for the category/shape pills the breakdown adds on top of the
  // win-vector groups (whose meta lives in compare-dimensions.GROUP_META).
  // Colours mirror the skill-area card palette (categorize-metadata
  // SKILL_AREA_INFO) so a pill matches its mistake-card badge: Riichi=purple,
  // Meld=pink, Kan=green. Complex is grey — it's a shape, not a skill area, and
  // only ever lands in the "missed" ledger (the stats don't explain Mortal's
  // pick, so you're under-reading something).
  var PILL_META = {
    Riichi:  { label: "Riichi",  color: "#a855f7" },
    Meld:    { label: "Meld",    color: "#ee5fa7" },
    Kan:     { label: "Kan",     color: "#22c55e" },
    Complex: { label: "Complex", color: "#9ca3af" },
  };

  function emptyTiers() {
    return { severe: 0, mistake: 0, light: 0, unsure: 0 };
  }

  // Every concept hit a single mistake feeds, NOT deduped — the raw
  // (side, group, dim, label) tuples from both sources. Callers dedup at the
  // granularity they need: cellsFor() dedups per (side, group) for the filter,
  // aggregate() dedups per group for the row EV and per (group, dim) for the
  // sub-pills. `dim`/`label` are present only for win-vector hits (a group like
  // Yaku or Value has a finer concept inside it); action/shape pills ARE their
  // own leaf, so they carry no sub-dim.
  //   1. Win-vector dims (Speed/Yaku/Dora/Defense) — winning pills from the
  //      shared comparator. The per-seat deal_in vector can emit the same dim
  //      twice and a Value mistake can emit both dora_kept and dora_acceptance.
  //   2. Category/shape pills — the action code (Riichi/Meld/Kan) off
  //      `m.category`, plus a "missed Complex" hit when the shape is complex.
  function rawHits(m, compareDimensions) {
    var hits = [];
    if (typeof compareDimensions === "function") {
      var wins = compareDimensions(m) || [];
      for (var w = 0; w < wins.length; w++) {
        var win = wins[w];
        if (!win || win.suppressed) continue;
        if (win.winner !== "you" && win.winner !== "mortal") continue;
        var meta = CONCEPT_META[win.dim];
        if (!meta) continue;
        hits.push({
          side: win.winner === "mortal" ? "missed" : "you",
          group: win.group || "Other",
          dim: win.dim,
          label: meta.label,
        });
      }
    }
    var cell = m && m.category && ACTION_CELL[m.category];
    if (cell) hits.push({ side: cell.side, group: cell.group, dim: null, label: null });
    if (m && m.shape === "complex") hits.push({ side: "missed", group: "Complex", dim: null, label: null });
    return hits;
  }

  // The full set of (side, group) ledger cells a single mistake feeds, deduped.
  // Derived from rawHits so aggregate() and mistakeTouchesGroup() can never
  // disagree on which mistakes belong to a cell.
  function cellsFor(m, compareDimensions) {
    var hits = rawHits(m, compareDimensions);
    var cells = [];
    var seen = {};
    for (var i = 0; i < hits.length; i++) {
      var k = hits[i].side + "|" + hits[i].group;
      if (seen[k]) continue;
      seen[k] = true;
      cells.push({ side: hits[i].side, group: hits[i].group });
    }
    return cells;
  }

  // Walk every mistake and tally its concept hits. Returns
  // { groups: {missed, you} } (each value a {group->entry} map) or null when
  // nothing qualifies. Each entry carries the group total (deduped per group, so
  // each mistake's full ev_loss counts once) plus a `subs` map of the finer
  // win-vector dims inside that group (Yaku → Tanyao/Yakuhai/…, Value → Dora/
  // Dora acceptance), each deduped per dim and carrying its own summed EV. Subs
  // don't sum to the group EV — a mistake winning both dora_kept and
  // dora_acceptance counts its full EV in each sub AND once in the group.
  // `tier()` is injected so this stays decoupled from severity.js for tests.
  function aggregate(game, compareDimensions, tier) {
    var groups = { missed: {}, you: {} };
    var any = false;
    var rounds = (game && game.rounds) || [];
    for (var r = 0; r < rounds.length; r++) {
      var mistakes = rounds[r].mistakes || [];
      for (var i = 0; i < mistakes.length; i++) {
        var m = mistakes[i];
        var ev = m.ev_loss || 0;
        var t = tier(m.ev_loss);
        var hits = rawHits(m, compareDimensions);
        var seenGrp = {}, seenSub = {};
        for (var c = 0; c < hits.length; c++) {
          var side = hits[c].side, grp = hits[c].group;
          var led = groups[side];
          var e = led[grp];
          if (!e) { e = led[grp] = { group: grp, count: 0, ev: 0, tiers: emptyTiers(), subs: {} }; }
          var gk = side + "|" + grp;
          if (!seenGrp[gk]) {
            seenGrp[gk] = true;
            e.count += 1;
            e.ev += ev;
            e.tiers[t] += 1;
            any = true;
          }
          // Finer per-dim breakdown — only win-vector hits have one.
          if (hits[c].dim) {
            var sk = gk + "|" + hits[c].dim;
            if (!seenSub[sk]) {
              seenSub[sk] = true;
              var s = e.subs[hits[c].dim];
              if (!s) { s = e.subs[hits[c].dim] = { dim: hits[c].dim, label: hits[c].label, ev: 0, count: 0 }; }
              s.ev += ev;
              s.count += 1;
            }
          }
        }
      }
    }
    return any ? { groups: groups } : null;
  }

  // Does this single mistake feed the (side, group) ledger cell? Reuses
  // cellsFor() so the rounds filter and the breakdown rows always agree on which
  // mistakes belong to a concept group. side is "missed" / "you".
  function mistakeTouchesGroup(m, compareDimensions, side, group) {
    var cells = cellsFor(m, compareDimensions);
    for (var c = 0; c < cells.length; c++) {
      if (cells[c].side === side && cells[c].group === group) return true;
    }
    return false;
  }

  return { CONCEPT_META, PILL_META, ACTION_CELL, rawHits, cellsFor, aggregate, mistakeTouchesGroup };
}));
