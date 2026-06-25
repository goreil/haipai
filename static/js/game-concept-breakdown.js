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

  // Walk every mistake, run the shared comparator, and tally winning pills per
  // (side, group), deduped per mistake — the per-seat deal_in vector can emit
  // the same group twice for one decision, and a Value mistake can emit both
  // dora_kept and dora_acceptance; neither should double-count. Returns
  // { groups: {missed, you} } (each value a {group->entry} map) or null when
  // nothing qualifies. `tier()` is injected so this stays decoupled from
  // severity.js for tests.
  function aggregate(game, compareDimensions, tier) {
    if (typeof compareDimensions !== "function") return null;
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
        var seenGroup = {};
        for (var w = 0; w < wins.length; w++) {
          var win = wins[w];
          if (!win || win.suppressed) continue;
          if (win.winner !== "you" && win.winner !== "mortal") continue;
          if (!CONCEPT_META[win.dim]) continue;
          var side = win.winner === "mortal" ? "missed" : "you";
          var grp = win.group || "Other";
          // make() runs synchronously inside tally this iteration, so the loop
          // `var grp` is captured correctly — no IIFE needed.
          tally(groups[side], grp, seenGroup, ev, t, function () {
            return { group: grp, count: 0, ev: 0, tiers: emptyTiers() };
          });
          any = true;
        }
      }
    }
    return any ? { groups: groups } : null;
  }

  return { CONCEPT_META, aggregate };
}));
