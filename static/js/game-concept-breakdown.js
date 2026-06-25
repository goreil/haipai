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
// Each concept row carries the mistake count, the summed EV loss, and a
// severity split — mirroring the Summary tab's per-facet stats. A mistake's
// full ev_loss is attributed to every concept it touches (one mistake can be
// both "overvalued dora" and "missed defense"), so the two ledgers are an
// attribution view, not a partition of total EV.

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
    dora_kept:       { label: "Dora" },
    dora_acceptance: { label: "Dora acceptance" },
    deal_in:         { label: "Defense (deal-in)" },
  };

  function emptyTiers() {
    return { severe: 0, mistake: 0, light: 0, unsure: 0 };
  }

  // Add one mistake's EV/tier into a {key->entry} ledger, once per key.
  // `seen` guards the per-mistake dedup; `make` builds a fresh entry.
  function tally(ledger, key, seen, ev, t, make) {
    if (seen[key]) return false;
    seen[key] = true;
    var e = ledger[key];
    if (!e) { e = ledger[key] = make(); }
    e.count += 1;
    e.ev += ev;
    e.tiers[t] += 1;
    return true;
  }

  // Walk every mistake, run the shared comparator, and tally pills two ways:
  //   dims   — per (side, dim): the detailed breakdown rows.
  //   groups — per (side, group): the rolled-up view for the top-summary. This
  //            is where the double-count is resolved — a mistake winning both
  //            `dora_kept` and `dora_acceptance` on one side is TWO dim rows but
  //            ONE "Value" group hit.
  // Each dim entry carries its `group` so the renderer can colour it. Returns
  // { dims: {missed,you}, groups: {missed,you} } or null when nothing qualifies.
  // `tier()` is injected so this stays decoupled from severity.js for tests.
  function aggregate(game, compareDimensions, tier) {
    if (typeof compareDimensions !== "function") return null;
    var dims = { missed: {}, you: {} };
    var groups = { missed: {}, you: {} };
    var any = false;
    var rounds = (game && game.rounds) || [];
    for (var r = 0; r < rounds.length; r++) {
      var mistakes = rounds[r].mistakes || [];
      for (var i = 0; i < mistakes.length; i++) {
        var m = mistakes[i];
        var wins = compareDimensions(m) || [];
        var ev = m.ev_loss || 0;
        var t = tier(m.ev_loss);
        // Per-mistake dedup keys: the per-seat deal_in vector can emit the same
        // dim+winner twice for one decision, and a Value mistake can emit two
        // dims — neither should inflate its count.
        var seenDim = {};
        var seenGroup = {};
        for (var w = 0; w < wins.length; w++) {
          var win = wins[w];
          if (!win || win.suppressed) continue;
          if (win.winner !== "you" && win.winner !== "mortal") continue;
          if (!CONCEPT_META[win.dim]) continue;
          var side = win.winner === "mortal" ? "missed" : "you";
          var dim = win.dim, grp = win.group || "Other";
          (function (dim, grp) {
            tally(dims[side], dim, seenDim, ev, t, function () {
              return { dim: dim, group: grp, count: 0, ev: 0, tiers: emptyTiers() };
            });
            tally(groups[side], grp, seenGroup, ev, t, function () {
              return { group: grp, count: 0, ev: 0, tiers: emptyTiers() };
            });
          })(dim, grp);
          any = true;
        }
      }
    }
    return any ? { dims: dims, groups: groups } : null;
  }

  return { CONCEPT_META, aggregate };
}));
