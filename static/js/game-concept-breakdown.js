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

  // Pill dim → display label (+ a one-line `hint` explaining the jargon for the
  // ledger sub-pill tooltip — user feedback flagged "Efficiency (versatility)"
  // as unclear on its own). Order is the fallback sort (ledgers sort by EV
  // first); dims absent here (none today) are skipped so an unmapped future
  // pill never renders blank.
  var CONCEPT_META = {
    shanten:         { label: "Speed (shanten)", hint: "Fewer tiles away from a complete hand." },
    ukeire:          { label: "Efficiency (ukeire)", hint: "More tile types that complete or advance your hand." },
    versatility_kept:{ label: "Efficiency (versatility)", hint: "Keeping a tile that can grow into more wait shapes later (3-7 > 2/8 > 1/9 > honor), even when raw ukeire ties." },
    yakuhai_kept:    { label: "Yakuhai", hint: "Keeping a valuable honor tile that scores a yaku on its own." },
    tanyao_kept:     { label: "Tanyao", hint: "Keeping the hand all-simples (no terminals/honors) for an easy yaku." },
    honitsu_kept:    { label: "Honitsu", hint: "Keeping the hand committed to one suit plus honors." },
    ittsu_kept:      { label: "Ittsu", hint: "Keeping a full 1-9 straight in one suit alive." },
    dora_kept:       { label: "Dora", hint: "Keeping a dora tile for extra hand value." },
    dora_acceptance: { label: "Dora acceptance", hint: "Keeping a wait that can still draw more dora tiles." },
    deal_in:         { label: "Defense (deal-in)", hint: "Risk of dealing into an opponent's hand." },
  };

  // Group key → one-line hint for the ledger's group-level pill tooltip.
  // Separate from compare-dimensions.GROUP_META (which only carries label/color
  // and is shared with the EV-table pills) so this stays a ledger-only concern.
  var GROUP_HINT = {
    Speed:   "Hand speed and tile acceptance.",
    Yaku:    "Ways to make your hand score at all (yaku).",
    Dora:    "Bonus-tile hand value.",
    Defense: "Risk of dealing into an opponent's hand.",
    Riichi:  "Declaring (or holding back) riichi.",
    Meld:    "Calling (or passing on) a tile.",
    Kan:     "Declaring (or holding back) a kan.",
    Complex: "The stats alone don't explain the read — a shape to study by hand.",
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
  function aggregate(game, compareDimensions, tier, predicate) {
    var groups = { missed: {}, you: {} };
    var any = false;
    var rounds = (game && game.rounds) || [];
    for (var r = 0; r < rounds.length; r++) {
      var mistakes = rounds[r].mistakes || [];
      for (var i = 0; i < mistakes.length; i++) {
        var m = mistakes[i];
        if (predicate && !predicate(m)) continue;
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
              if (!s) { s = e.subs[hits[c].dim] = { dim: hits[c].dim, label: hits[c].label, ev: 0, count: 0, tiers: emptyTiers() }; }
              s.ev += ev;
              s.count += 1;
              s.tiers[t] += 1;
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

  // --- Trade-off boxes (replace the old "Overvaluing these" ledger) ----------
  //
  // Instead of one flat "you over-prioritized these concepts" list, group every
  // over-favoring mistake by the TRADE-OFF axis it got wrong. A mistake is a
  // choice between two competing poles: your play favoured one, the better play
  // the other. Each box is one axis and lists the individual mistakes on it,
  // showing what you favoured (left) vs what the better play favoured (right).
  //
  // Assignment is priority-ordered so each mistake lands in exactly ONE box:
  //   1. push_fold   — any Defense (deal_in) pole is present (over-pushed when
  //                    Mortal won safety, over-folded when you did).
  //   2. speed_value — Speed on one side and Value (Yaku or Dora) on the other.
  //   3. other       — catch-all: yaku-vs-dora trades, single-pole over-favoring,
  //                    and bad riichi/call/kan actions.
  // Membership mirrors the old "you" ledger: a mistake must have at least one
  // you-side win (or a bad-action pill) to be an over-favoring mistake at all.
  var BOX_DEFS = [
    { key: "push_fold",   title: "Push vs. Fold" },
    { key: "speed_value", title: "Speed vs. Value" },
    { key: "other",       title: "Other" },
  ];

  // Dealer seat (0-3) for a mistake, derived from (hero actor, hero seat wind)
  // exactly as ev-table.js does — feeds renderWinFeatPill's per-seat deal-in
  // wind label so the box pills match the table. null when unknown.
  function computeOya(m) {
    var WINDS = ["E", "S", "W", "N"];
    var actor = m && m.actual && m.actual.actor;
    var hw = m && m.board_state && m.board_state.seat_wind;
    if (actor == null || !hw) return null;
    var pw = WINDS.indexOf(hw);
    if (pw < 0) return null;
    return ((actor - pw) % 4 + 4) % 4;
  }

  // Which box a mistake belongs to, from the group sets present on each pole.
  // `yg`/`bg` are {group->1} maps for the you / better sides (win-vector groups
  // plus any action group). See BOX_DEFS.
  //
  // A trade-off needs two poles: something you favoured AND something the
  // better play favoured instead. If one side is empty (e.g. you won ukeire
  // AND safety with nothing on the other side explaining the EV loss — the
  // "complex" case), there's no opposing pole to trade against, so it can't
  // be push/fold or speed/value; it falls to the single-pole "other" catch-all.
  function classifyBox(yg, bg) {
    if (isEmptyGroupSet(yg) || isEmptyGroupSet(bg)) return "other";
    if (yg.Defense || bg.Defense) return "push_fold";
    var youValue = yg.Yaku || yg.Dora, betValue = bg.Yaku || bg.Dora;
    if ((yg.Speed && betValue) || (youValue && bg.Speed)) return "speed_value";
    return "other";
  }

  function isEmptyGroupSet(g) {
    for (var k in g) { if (g.hasOwnProperty(k)) return false; }
    return true;
  }

  // Walk every (visible) mistake and bucket the over-favoring ones into trade-off
  // boxes. Returns an ordered array of non-empty boxes:
  //   { key, title, ev, mistakes: [{
  //       id, ev, tier,
  //       youWins, betterWins,   // raw win-vector entries (winner you / mortal),
  //                              // rendered with the SAME concrete pills as the
  //                              // EV-table summary (renderWinFeatPill).
  //       youAction, betterAction, // action group (Riichi/Meld/Kan) when the
  //                              // mistake is a bad/missed call — no win pill.
  //       youTile, betterTile,   // compared discards, shown when a pole has no
  //                              // pills at all so the row is never blank.
  //   }] }
  // A mistake is "over-favoring" (and thus bucketed) iff it has ≥1 you-side win
  // or a bad-action pill — mirrors the old "you" ledger. `comparedTiles`/`tier`
  // are injected to stay decoupled.
  function tradeoffBoxes(game, compareDimensions, comparedTiles, tier, predicate) {
    var boxes = {};
    for (var d = 0; d < BOX_DEFS.length; d++) {
      boxes[BOX_DEFS[d].key] = { key: BOX_DEFS[d].key, title: BOX_DEFS[d].title, ev: 0, mistakes: [] };
    }
    var rounds = (game && game.rounds) || [];
    for (var r = 0; r < rounds.length; r++) {
      var mistakes = rounds[r].mistakes || [];
      for (var i = 0; i < mistakes.length; i++) {
        var m = mistakes[i];
        if (predicate && !predicate(m)) continue;

        var youWins = [], betterWins = [], yg = {}, bg = {};
        if (typeof compareDimensions === "function") {
          var wins = compareDimensions(m) || [];
          for (var w = 0; w < wins.length; w++) {
            var win = wins[w];
            if (!win || win.suppressed) continue;
            if (win.winner === "you") { youWins.push(win); yg[win.group || "Other"] = 1; }
            else if (win.winner === "mortal") { betterWins.push(win); bg[win.group || "Other"] = 1; }
          }
        }
        var cell = m && m.category && ACTION_CELL[m.category];
        var youAction = null, betterAction = null;
        if (cell) {
          if (cell.side === "you") { youAction = cell.group; yg[cell.group] = 1; }
          else { betterAction = cell.group; bg[cell.group] = 1; }
        }

        if (!youWins.length && !youAction) continue; // not an over-favoring mistake

        var key = classifyBox(yg, bg);
        var t = (typeof comparedTiles === "function" && comparedTiles(m)) || {};
        var ev = m.ev_loss || 0;
        boxes[key].mistakes.push({
          id: m.id || null,
          ev: ev,
          tier: tier(m.ev_loss),
          oya: computeOya(m),
          youWins: youWins,
          betterWins: betterWins,
          youAction: youAction,
          betterAction: betterAction,
          youTile: t.actualTile || null,
          betterTile: t.expectedTile || null,
        });
        boxes[key].ev += ev;
      }
    }
    var out = [];
    for (var b = 0; b < BOX_DEFS.length; b++) {
      var box = boxes[BOX_DEFS[b].key];
      if (!box.mistakes.length) continue;
      box.mistakes.sort(function (a, c) { return c.ev - a.ev; });
      out.push(box);
    }
    return out;
  }

  // Does this mistake match a concept filter {side, group, dim}? A group-level
  // filter (dim null/falsy) checks the deduped cells; a sub-pill filter (dim
  // set, e.g. "tanyao_kept") requires a raw win-vector hit with that exact dim
  // on the same side — so clicking "Tanyao" narrows to Tanyao, not all of Yaku.
  function mistakeTouchesConcept(m, compareDimensions, f) {
    if (!f) return false;
    if (!f.dim) return mistakeTouchesGroup(m, compareDimensions, f.side, f.group);
    var hits = rawHits(m, compareDimensions);
    for (var h = 0; h < hits.length; h++) {
      if (hits[h].side === f.side && hits[h].group === f.group && hits[h].dim === f.dim) return true;
    }
    return false;
  }

  // --- Cross-game rollup (trends) ---------------------------------------
  //
  // aggregate()/tradeoffBoxes() already work off a single game's rounds. The
  // trends page needs the same ledger + trade-off shape summed across every
  // analyzed game, but the box list can't carry a full per-mistake row for
  // every mistake in every game (could be thousands) — so trends only ever
  // consumes box TOTALS, not the mistake rows. boxTotals() computes those for
  // one game (discarding the per-mistake array immediately, so a caller
  // merging many games never holds more than the small totals in memory);
  // mergeAggregates()/mergeBoxTotals() then fold per-game results together.

  // Same call signature as tradeoffBoxes(), but returns
  // [{key, title, ev, count}] instead of full mistake lists.
  function boxTotals(game, compareDimensions, comparedTiles, tier, predicate) {
    var boxes = tradeoffBoxes(game, compareDimensions, comparedTiles, tier, predicate);
    var out = [];
    for (var i = 0; i < boxes.length; i++) {
      out.push({ key: boxes[i].key, title: boxes[i].title, ev: boxes[i].ev, count: boxes[i].mistakes.length });
    }
    return out;
  }

  // Merge multiple per-game aggregate() results (nulls allowed — a game with
  // no qualifying mistakes) into one {groups:{missed,you}} structure: count/ev/
  // tiers sum per group, subs merge per dim. Returns null if every input was null.
  function mergeAggregates(list) {
    var out = { groups: { missed: {}, you: {} } };
    var any = false;
    var sides = ["missed", "you"];
    for (var i = 0; i < list.length; i++) {
      var agg = list[i];
      if (!agg) continue;
      any = true;
      for (var s = 0; s < sides.length; s++) {
        var side = sides[s];
        for (var grp in agg.groups[side]) {
          if (!agg.groups[side].hasOwnProperty(grp)) continue;
          var src = agg.groups[side][grp];
          var dst = out.groups[side][grp];
          if (!dst) dst = out.groups[side][grp] = { group: grp, count: 0, ev: 0, tiers: emptyTiers(), subs: {} };
          dst.count += src.count;
          dst.ev += src.ev;
          for (var tk in src.tiers) dst.tiers[tk] += src.tiers[tk];
          for (var dim in src.subs) {
            if (!src.subs.hasOwnProperty(dim)) continue;
            var ss = src.subs[dim];
            var ds = dst.subs[dim];
            if (!ds) ds = dst.subs[dim] = { dim: ss.dim, label: ss.label, ev: 0, count: 0, tiers: emptyTiers() };
            ds.ev += ss.ev;
            ds.count += ss.count;
            // ss.tiers is absent on aggregates from before sub-level tier
            // tracking existed (e.g. stale trends stash held across a deploy);
            // skip rather than throw so an old cache doesn't hard-fail merge.
            if (ss.tiers) { for (var stk in ss.tiers) ds.tiers[stk] += ss.tiers[stk]; }
          }
        }
      }
    }
    return any ? out : null;
  }

  // Merge multiple per-game boxTotals() results into one ordered, non-empty
  // list, sorted by EV desc (the trends "biggest leak first" framing — unlike
  // the per-game boxes, which keep the fixed push_fold/speed_value/other order
  // since that reads top-to-bottom as a page you're already scanning).
  function mergeBoxTotals(list) {
    var totals = {};
    for (var d = 0; d < BOX_DEFS.length; d++) {
      totals[BOX_DEFS[d].key] = { key: BOX_DEFS[d].key, title: BOX_DEFS[d].title, ev: 0, count: 0 };
    }
    for (var i = 0; i < list.length; i++) {
      var arr = list[i] || [];
      for (var b = 0; b < arr.length; b++) {
        var t = totals[arr[b].key];
        if (!t) continue;
        t.ev += arr[b].ev;
        t.count += arr[b].count;
      }
    }
    var out = [];
    for (var k = 0; k < BOX_DEFS.length; k++) {
      if (totals[BOX_DEFS[k].key].count > 0) out.push(totals[BOX_DEFS[k].key]);
    }
    out.sort(function (a, b) { return b.ev - a.ev; });
    return out;
  }

  return {
    CONCEPT_META, GROUP_HINT, PILL_META, ACTION_CELL, rawHits, cellsFor, aggregate, tradeoffBoxes,
    mistakeTouchesGroup, mistakeTouchesConcept, boxTotals, mergeAggregates, mergeBoxTotals,
  };
}));
