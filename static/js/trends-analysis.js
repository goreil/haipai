// Trends page — analysis pipeline + aggregation + recommendation + per-skill-
// area breakdown.
//
// Phase 3.3 split of the legacy static/js/trends.js. This file owns the async
// worker pool that re-categorizes games in place, the aggregation helpers
// that roll per-game stats into totals, and the recommendation / category-
// breakdown panels that consume those totals. Charts come from
// trends-charts.js; the orchestrator/view lives in trends-view.js.

// In-memory cache of the last weakness analysis: { gameIds, games }, or null.
// Each entry in `games` carries `by_category`/`decision_counts` (feeds the
// skill-area-per-game chart + saved snapshots) and `_conceptAgg`/
// `_conceptBoxTotals` (the win-vector rollup — feeds renderConceptWeaknessPanels,
// the same ledger/trade-off-totals shape as a single game's summary). Stays
// alive across navigations within the SPA but is cleared on page reload — see
// docs/backlogs/MISTAKE-DIMENSIONS-EXTRAS.md (EXTRAS-C).
var trendsStash = null;
// Bumped on cancel or new run. In-flight workers compare against this and
// stop attaching results once they've been superseded.
var trendsAnalysisGen = 0;
// Active-run handle: { gen, games, analyzedIds } during analysis, null otherwise.
// Cancel uses this to render the partial result.
var trendsCurrentAnalysis = null;
// { games, analyzedIds } from the most recent CANCELLED run, or null. A
// cancelled run never populates trendsStash (that only happens on a full
// completion), but its partial panel is still on screen and its expand
// toggles still need something to re-render from — see _rerenderTrendsScope.
var trendsLastPartial = null;

// TREND_SKILL_AREAS / TREND_MIN_DECISIONS / trendSkillAreaFor /
// trendSkillAreaInfo moved to static/js/skill-areas.js.

function _idsMatch(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function startWeaknessAnalysis() {
  const trendsGames = await fetchTrends();
  const ids = trendsGames.map(g => g.id);
  const gen = ++trendsAnalysisGen;
  const analyzedIds = new Set();
  trendsCurrentAnalysis = { gen, games: trendsGames, analyzedIds };

  const section = document.getElementById("weakness-section");
  if (section) {
    section.innerHTML = `
      <h3>Weakest Concepts</h3>
      <p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">Analyzing your games to find your biggest concept-level EV leaks…</p>
      <div style="display:flex;align-items:center;gap:12px;margin-top:8px">
        <span id="weakness-progress-text">Analyzing 0/${trendsGames.length}…</span>
        <button class="btn" data-action="cancelWeaknessAnalysis">Cancel</button>
      </div>
    `;
  }

  let done = 0;
  const queue = [...trendsGames];
  const updateProgress = () => {
    if (trendsAnalysisGen !== gen) return;
    const el = document.getElementById("weakness-progress-text");
    if (el) el.textContent = `Analyzing ${done}/${trendsGames.length}…`;
  };

  async function worker() {
    while (true) {
      if (trendsAnalysisGen !== gen) return;
      const trendsEntry = queue.shift();
      if (!trendsEntry) return;
      try {
        // mortal_data comes from its own immutable-cached endpoint — on a
        // re-run only the game payloads transfer; the heavy mjai logs are
        // served from the browser cache.
        const [res, mres] = await Promise.all([
          fetch(`/api/games/${trendsEntry.id}`),
          fetch(`/api/games/${trendsEntry.id}/mortal`),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const full = await res.json();
        if (mres.ok) full.mortal_data = await mres.json();
        if (full && full.mortal_data && typeof haipaiPrep !== "undefined") {
          await haipaiPrep.prepGameAsync(full, full.mortal_data);
          recategorizeGameInPlace(full);
          const byCat = {};
          // Skill area -> facet (action code for meld/riichi/kan, shape for
          // attack/defense/open_defense) -> totals. Same facet key as the
          // per-game Summary tab (categorize-metadata.js::mistakeFacet), so
          // the trends breakdown below can reuse its cat-group/cat-sub markup
          // instead of the old bars-over-time chart.
          const bySkillFacet = {};
          for (const rnd of full.rounds || []) {
            for (const m of rnd.mistakes || []) {
              // category survives only for action decisions (meld/riichi/kan);
              // dahai mistakes (attack/defense/open_defense) carry no category
              // since Phase 3, so fall back to skillArea or they'd never be
              // counted at all.
              const key = m.category || m.skillArea;
              if (!key) continue;
              if (!byCat[key]) byCat[key] = { count: 0, ev: 0 };
              byCat[key].count += 1;
              byCat[key].ev += m.ev_loss || 0;

              const sa = m.skillArea;
              if (!sa) continue;
              const facet = mistakeFacet(m);
              const fkey = facet.key || "—";
              if (!bySkillFacet[sa]) bySkillFacet[sa] = {};
              if (!bySkillFacet[sa][fkey]) {
                bySkillFacet[sa][fkey] = {
                  label: facet.label || "Other", desc: facet.desc || "",
                  count: 0, ev: 0, tiers: { severe: 0, mistake: 0, light: 0, unsure: 0 },
                };
              }
              const sub = bySkillFacet[sa][fkey];
              sub.count += 1;
              sub.ev += m.ev_loss || 0;
              sub.tiers[sevTier(m.ev_loss)] += 1;
            }
          }
          if (trendsAnalysisGen !== gen) return;
          trendsEntry.by_category = byCat;
          trendsEntry.by_skill_facet = bySkillFacet;
          // Recompute per-skill-area denominators from mortal_data so the
          // trends panel is self-contained — no dependency on server-side
          // backfills of stats_json.decision_counts.
          if (typeof haipaiPrepParse !== "undefined"
              && haipaiPrepParse.decision_counts_for_game) {
            const dc = haipaiPrepParse.decision_counts_for_game(full.mortal_data);
            if (dc) trendsEntry.decision_counts = dc;
          }
          // Win-vector rollup for this game — same source as the single-game
          // concept breakdown (game-concept-breakdown.js). boxTotals() collapses
          // each box to {ev,count} immediately so the merge below never holds a
          // per-mistake row per game across the whole analysis.
          if (typeof haipaiConceptBreakdown !== "undefined" && typeof haipaiCompareDimensions !== "undefined") {
            const cd = haipaiCompareDimensions.compareDimensions;
            trendsEntry._conceptAgg = haipaiConceptBreakdown.aggregate(full, cd, sevTier, null);
            trendsEntry._conceptBoxTotals = haipaiConceptBreakdown.boxTotals(
              full, cd, haipaiCompareDimensions.comparedTiles, sevTier, null);
          }
          analyzedIds.add(trendsEntry.id);
        }
      } catch (e) {
        console.warn("Trends analysis: skipping game", trendsEntry.id, e);
      }
      done += 1;
      updateProgress();
    }
  }

  // Sequential (concurrency 1) — NOT a perf choice. Running games 2-3 at a time
  // reliably corrupted the shanten/wall-tracking recursion in the prep pipeline
  // for a subset of real games (repeated "Negative wall count, clamping"
  // warnings escalating into an uncaught `RangeError: Maximum call stack size
  // exceeded`), hanging the whole analysis partway through — reproduced on
  // production data both with and without this feature's concept-agg additions,
  // so it's pre-existing in prepGameAsync/recategorizeGameInPlace, not
  // introduced here. Verified sequential processing gets through all 148 games
  // on a real account with zero errors where concurrency 3 stalled at ~54.
  // Root cause (something recursion-depth-sensitive that only misbehaves under
  // concurrent async interleaving) is unfixed — revisit if this still needs to
  // be faster than one game at a time.
  const workers = [worker()];
  await Promise.all(workers);

  if (trendsAnalysisGen !== gen) return;  // cancelled while finishing up
  trendsCurrentAnalysis = null;
  trendsLastPartial = null;
  trendsStash = { gameIds: ids, games: trendsGames };
  _replaceWeaknessSection(trendsGames, null);
  // Auto-save the aggregated totals as a snapshot. Only save when at least
  // one game contributed decision_counts — otherwise the snapshot has no
  // EV/D denominator and would render as "—" forever.
  _saveSnapshotFromAnalysis(trendsGames, Array.from(analyzedIds));
}

async function _saveSnapshotFromAnalysis(games, analyzedGameIds) {
  if (typeof haipaiCategorize === "undefined" || !haipaiCategorize.CATEGORIZER_VERSION) return;
  const analyzedSet = new Set(analyzedGameIds);
  const analyzed = games.filter(g => analyzedSet.has(g.id));
  if (analyzed.length === 0) return;
  const { byCat, decCounts } = trendAggregateAll(analyzed);
  if (!decCounts) return;
  const { bySkillFacet } = trendAggregateSkillFacets(analyzed);
  // Same merged shapes the live "Haipai Trainer" panel renders from — saving
  // them (not just by_category/decision_counts) so a past analysis can be
  // re-rendered exactly as it looked live, not just as skill-area totals.
  const conceptAgg = (typeof haipaiConceptBreakdown !== "undefined")
    ? haipaiConceptBreakdown.mergeAggregates(analyzed.map(g => g._conceptAgg || null))
    : null;
  const conceptBoxes = (typeof haipaiConceptBreakdown !== "undefined")
    ? haipaiConceptBreakdown.mergeBoxTotals(analyzed.map(g => g._conceptBoxTotals || []))
    : [];
  try {
    const res = await apiPost("/api/trends/snapshot", {
      categorizer_version: haipaiCategorize.CATEGORIZER_VERSION,
      game_ids: analyzedGameIds,
      by_category: byCat,
      decision_counts: decCounts,
      by_skill_facet: bySkillFacet,
      concept_agg: conceptAgg,
      concept_boxes: conceptBoxes,
    });
    if (!res.ok) return;
    trendsSnapshots = await fetchSnapshots();
    const section = document.getElementById("snapshots-history");
    if (section) section.innerHTML = renderSnapshotsHistory(trendsSnapshots);
  } catch (e) {
    console.warn("Trends snapshot save failed", e);
  }
}

function cancelWeaknessAnalysis() {
  if (!trendsCurrentAnalysis) return;
  const { games, analyzedIds } = trendsCurrentAnalysis;
  trendsAnalysisGen += 1;  // supersede the in-flight workers
  trendsCurrentAnalysis = null;
  trendsLastPartial = { games, analyzedIds };
  _replaceWeaknessSection(games, analyzedIds);
}

// --- Aggregation helpers for the trends category panel ---

// Roll per-game stats into totals across all games.
// Only counts games that have `decision_counts` populated, so the EV
// numerator and the decision-count denominator come from the same set —
// otherwise old games (parsed before U-04) contribute EV with no
// matching denominator and inflate EV/D ~10x.
function trendAggregateAll(games) {
  const byCat = {};                 // facet key -> {count, ev} (historical snapshots: retired P/D/OD codes; live: action codes for meld/riichi/kan, skillArea for attack/defense/open_defense)
  const decCounts = { attack: 0, defense: 0, open_defense: 0, riichi: 0, meld: 0, kan: 0 };
  let gamesIncluded = 0;
  for (const g of games) {
    if (!g.decision_counts) continue;
    gamesIncluded++;
    for (const [cat, data] of Object.entries(g.by_category || {})) {
      if (!byCat[cat]) byCat[cat] = { count: 0, ev: 0 };
      byCat[cat].count += data.count;
      byCat[cat].ev += data.ev;
    }
    for (const k of Object.keys(decCounts)) decCounts[k] += g.decision_counts[k] || 0;
  }
  return {
    byCat,
    decCounts: gamesIncluded > 0 ? decCounts : null,
    gamesIncluded,
    gamesTotal: games.length,
  };
}

// Same gating as trendAggregateAll (only games with decision_counts, so the
// breakdown never mixes in games with no denominator), but merges the nested
// skill-area -> facet tally (by_skill_facet) instead of the flat by_category
// map — this is what feeds the cat-group/cat-sub "Skill Area Breakdown"
// panel, which needs shape-level facets under attack/defense/open_defense,
// not just the skill-area totals by_category collapses them to.
function trendAggregateSkillFacets(games) {
  const bySkillFacet = {};
  let gamesIncluded = 0;
  for (const g of games) {
    if (!g.decision_counts) continue;
    gamesIncluded++;
    for (const [sa, facets] of Object.entries(g.by_skill_facet || {})) {
      if (!bySkillFacet[sa]) bySkillFacet[sa] = {};
      for (const [fkey, f] of Object.entries(facets)) {
        if (!bySkillFacet[sa][fkey]) {
          bySkillFacet[sa][fkey] = {
            label: f.label, desc: f.desc, count: 0, ev: 0,
            tiers: { severe: 0, mistake: 0, light: 0, unsure: 0 },
          };
        }
        const dst = bySkillFacet[sa][fkey];
        dst.count += f.count;
        dst.ev += f.ev;
        for (const tk of Object.keys(f.tiers || {})) dst.tiers[tk] += f.tiers[tk] || 0;
      }
    }
  }
  return { bySkillFacet, gamesIncluded, gamesTotal: games.length };
}

// Per skill area (attack/defense/meld/riichi/kan): total EV, mistake count,
// and decision-count denominator. Keyed by TREND_SKILL_AREAS[*].key.
function trendSkillAreaTotals(byCat, decCounts) {
  const out = {};
  for (const sa of TREND_SKILL_AREAS) {
    out[sa.key] = { ev: 0, count: 0, decisions: decCounts ? (decCounts[sa.key] || 0) : 0 };
  }
  for (const [cat, data] of Object.entries(byCat)) {
    const k = trendSkillAreaFor(cat);
    if (!k || !out[k]) continue;
    out[k].ev += data.ev;
    out[k].count += data.count;
  }
  return out;
}

// --- Concept-level weakness panels (EXTRAS-C) ---
//
// Same top-leak stat + trainer tip + ledger/trade-off-totals as a single
// game's concept breakdown (game-render.js/game-concept-breakdown.js),
// aggregated over every analyzed game via mergeAggregates()/mergeBoxTotals().
// Trade-off boxes show TOTALS ONLY (no per-mistake rows) — across all games
// that list could run into the hundreds, unlike the per-game view.

function renderConceptWeaknessPanels(games) {
  if (typeof haipaiConceptBreakdown === "undefined") return "";
  const agg = haipaiConceptBreakdown.mergeAggregates(games.map(g => g._conceptAgg || null));
  const boxes = haipaiConceptBreakdown.mergeBoxTotals(games.map(g => g._conceptBoxTotals || []));

  if (!agg && !boxes.length) {
    return `<div class="trend-chart-card"><h3>Haipai Trainer</h3>
      <div class="mascot-speech">
        <img src="/static/mascot.svg" class="mascot-avatar" alt="">
        <div class="speech-bubble">Not enough data yet for a personalized recommendation — play more games to unlock.</div>
      </div>
    </div>`;
  }

  let html = `<div class="trend-chart-card">
    <h3>Haipai Trainer</h3>
    <div class="summary-bar" style="margin:-4px 0 10px">${renderTopGroupStat(agg, boxes, "across your games")}</div>
    ${renderTrainerTip(agg, boxes, "across your games")}
  </div>`;
  html += renderConceptLedgers(agg, boxes, "live");
  return html;
}

// True when this ledger row's sub-pills (the finer per-dim breakdown, e.g.
// Yaku → Tanyao/Yakuhai) are expanded, into their own vertical rows with a
// severity split. Collapsed by default so a many-game aggregate opens as a
// scannable list of group pills, not a wall of sub-rows. `scope` namespaces
// the expand state — "live" for the current weakness panel, "snap-<id>" for
// a past-analysis row in the snapshot history — so expanding one never
// affects the other. Unlike the per-game view (game-render.js, which always
// shows sub-pills inline since a single game rarely has more than a handful),
// trends aggregates can pile up many sub-dims across hundreds of games, so
// this stays collapsed-by-default + explicit expand.
function trendsConceptExpandedActive(scope, side, group) {
  return state.trendsConceptExpanded.some(f => f.scope === scope && f.side === side && f.group === group);
}

function toggleTrendsConceptExpand(scope, side, group) {
  const exp = state.trendsConceptExpanded;
  const idx = exp.findIndex(f => f.scope === scope && f.side === side && f.group === group);
  if (idx >= 0) exp.splice(idx, 1);
  else exp.push({ scope, side, group });
  _rerenderTrendsScope(scope);
}

// The ledger head's "Expand all" / "Collapse all" toggle — flips every group
// in `groupsCsv` (the comma-joined list of groups that actually have sub-dims,
// baked in at render time) to match whichever state isn't unanimous yet, so
// one click clears an entire ledger instead of clicking each row's own toggle.
function toggleTrendsConceptExpandAll(scope, side, groupsCsv) {
  const groups = (groupsCsv || "").split(",").filter(Boolean);
  const exp = state.trendsConceptExpanded;
  const allExpanded = groups.length > 0 && groups.every(g => trendsConceptExpandedActive(scope, side, g));
  if (allExpanded) {
    state.trendsConceptExpanded = exp.filter(f => !(f.scope === scope && f.side === side && groups.includes(f.group)));
  } else {
    for (const g of groups) {
      if (!trendsConceptExpandedActive(scope, side, g)) exp.push({ scope, side, group: g });
    }
  }
  _rerenderTrendsScope(scope);
}

// Redraw just the panel a given expand toggle lives in, without recomputing
// charts or re-fetching anything — "live" replaces the weakness section from
// the already-analyzed trendsStash.games, "snap-<id>" re-renders that one
// snapshot-history row from the already-fetched trendsSnapshots.
function _rerenderTrendsScope(scope) {
  if (scope === "live") {
    if (trendsStash) _replaceWeaknessSection(trendsStash.games, null);
    else if (trendsLastPartial) _replaceWeaknessSection(trendsLastPartial.games, trendsLastPartial.analyzedIds);
    return;
  }
  const m = /^snap-(.+)$/.exec(scope);
  if (m && typeof trendsSnapshots !== "undefined") {
    const snap = (trendsSnapshots || []).find(s => String(s.id) === m[1]);
    const el = document.getElementById(scope);
    if (snap && el) el.innerHTML = renderSnapshotDetail(snap);
  }
}

// The ledger + trade-off-totals cards themselves — same CSS classes and pill
// styling as the per-game renderConceptBreakdown (static/style-game-detail.css
// .concept-*). Group pills are plain colour chips (trends has no rounds view
// underneath to filter into), but the "Losing points here" ledger's per-dim
// sub-rows ARE interactive: each row expands independently, plus a ledger-wide
// "Expand all" toggle, since an all-games aggregate can carry far more sub-dims
// than a single game. `scope` namespaces that expand state — see
// trendsConceptExpandedActive.
function renderConceptLedgers(agg, boxes, scope) {
  scope = scope || "live";
  const gm = conceptMetaMap();
  const TIER_CHIPS = [
    ["severe", "sev-major", "Severe"],
    ["mistake", "sev-medium", "Mistake"],
    ["light", "sev-light", "Light"],
    ["unsure", "sev-minor", "Unsure"],
  ];
  const tierChips = (t) => TIER_CHIPS
    .filter(([k]) => t && t[k])
    .map(([k, cls, lbl]) => `<span class="tier-count ${cls}" title="${lbl}">${t[k]}</span>`)
    .join("");

  let missedHtml = "";
  const missedRows = agg ? Object.values(agg.groups.missed).sort((a, b) => b.ev - a.ev) : [];
  if (missedRows.length) {
    const groupsWithSubs = missedRows.filter(e => Object.keys(e.subs || {}).length).map(e => e.group);
    const allExpanded = groupsWithSubs.length > 0
      && groupsWithSubs.every(g => trendsConceptExpandedActive(scope, "missed", g));
    const expandAllHtml = groupsWithSubs.length
      ? `<span class="concept-expand-all" role="button" tabindex="0"
           data-action="toggleTrendsExpandAll" data-scope="${scope}" data-side="missed"
           data-groups="${groupsWithSubs.join(",")}">${allExpanded ? "Collapse all" : "Expand all"}</span>`
      : "";
    missedHtml = `<div class="concept-ledger">
      <div class="concept-ledger-head-row">
        <span class="concept-ledger-head-text">
          <span class="concept-ledger-title">Losing points here</span>
          <span class="concept-ledger-sub">The better play held this edge — you’re under-using these, across all games</span>
        </span>
        ${expandAllHtml}
      </div>`;
    for (const e of missedRows) {
      const meta = gm[e.group] || { label: e.group, color: "var(--text)" };
      const subs = Object.values(e.subs || {}).sort((a, b) => b.ev - a.ev);
      const expanded = trendsConceptExpandedActive(scope, "missed", e.group);
      const toggleHtml = !subs.length ? "" : `<span class="concept-expand-toggle" role="button" tabindex="0"
            title="${expanded ? "Hide" : "Show"} the ${subs.length} finer breakdown${subs.length === 1 ? "" : "s"} behind ${meta.label}"
            data-action="toggleTrendsConceptExpand" data-scope="${scope}" data-concept-side="missed" data-concept-group="${e.group}"
          >${expanded ? "▾" : "▸"} ${subs.length}</span>`;
      // Expanded sub-dims get their own vertical row (label, severity split,
      // EV) instead of the per-game view's inline pills — an all-games total
      // can have enough sub-dims that a wrapped pill strip stops scanning well.
      const subRowsHtml = !subs.length || !expanded ? "" : `<div class="concept-subrows">` + subs.map(s => `
        <div class="concept-subrow">
          <span class="concept-subrow-label" style="--grp:${meta.color}">${s.label}</span>
          <span class="concept-tiers">${tierChips(s.tiers)}</span>
          <span class="concept-ev">${s.ev.toFixed(2)} EV</span>
        </div>`).join("") + `</div>`;
      missedHtml += `<div class="concept-row">
        <span class="concept-row-left">
          <span class="concept-pill" style="--grp:${meta.color}">${meta.label}</span>
          ${toggleHtml}
        </span>
        <span class="concept-tiers">${tierChips(e.tiers)}</span>
        <span class="concept-ev">${e.ev.toFixed(2)} EV</span>
      </div>${subRowsHtml}`;
    }
    missedHtml += `</div>`;
  }

  let boxesHtml = "";
  if (boxes.length) {
    boxesHtml = `<div class="concept-ledger">
      <div class="concept-ledger-head">
        <span class="concept-ledger-title">Where you're over-committing</span>
        <span class="concept-ledger-sub">Trade-off axes where you favored the wrong side, across all games</span>
      </div>`;
    for (const box of boxes) {
      const color = BOX_COLOR[box.key] || "var(--accent)";
      boxesHtml += `<div class="concept-row">
        <span class="concept-row-left"><span class="concept-pill" style="--grp:${color}">${box.title}</span></span>
        <span class="concept-tiers"><span class="trend-bar-count">${box.count} mistake${box.count === 1 ? "" : "s"}</span></span>
        <span class="concept-ev">${box.ev.toFixed(2)} EV</span>
      </div>`;
    }
    boxesHtml += `</div>`;
  }

  if (!missedHtml && !boxesHtml) return "";
  const note = `<div class="concept-note">Aggregated across all analyzed games — a single mistake can carry more than one concept, so its EV is counted toward each of these.</div>`;
  return `<div class="concept-breakdown">${missedHtml}${boxesHtml}${note}</div>`;
}

// --- Skill Area Breakdown ---
//
// cat-group/cat-sub cards — the SAME markup and classes as a single game's
// Summary tab (game-render.js renderGame's `state.gameView === "summary"`
// branch), just aggregated across every analyzed game instead of one. This
// replaced an SVG stacked-bar-over-time chart that split EV across the 5
// skill areas per game — accurate but hard to read at a glance and visually
// inconsistent with the rest of the page. There's no per-mistake expand here
// (unlike the per-game Summary tab): the analysis only keeps aggregated
// facet totals, not every mistake object, across potentially hundreds of games.

// One cat-group per skill area (attack/defense/open_defense/meld/riichi/kan),
// sorted by EV desc, each with its cat-sub facet rows (shape for dahai,
// action label for meld/riichi/kan — see categorize-metadata.js::mistakeFacet)
// also sorted by EV desc. Returns "" when there's nothing to show.
function renderSkillAreaGroups(bySkillFacet) {
  const groups = Object.entries(bySkillFacet || {})
    .map(([sa, facets]) => {
      const totals = Object.values(facets).reduce(
        (acc, f) => ({ count: acc.count + f.count, ev: acc.ev + f.ev }), { count: 0, ev: 0 });
      return { sa, facets, count: totals.count, ev: totals.ev };
    })
    .filter(g => g.count > 0)
    .sort((a, b) => b.ev - a.ev);
  if (!groups.length) return "";

  let html = `<div class="category-groups">`;
  for (const g of groups) {
    const color = skillAreaColor(g.sa);
    const name = skillAreaLabel(g.sa);
    html += `<div class="cat-group" style="border-left: 3px solid ${color}">
      <div class="cat-group-header">
        <span class="cat-group-name" style="color:${color}">${name}</span>
        <span class="cat-group-stat">${g.count} mistake${g.count === 1 ? "" : "s"} &middot; ${g.ev.toFixed(2)} EV</span>
      </div>`;
    const subs = Object.values(g.facets).filter(f => f.label).sort((a, b) => b.ev - a.ev);
    for (const sub of subs) {
      html += `<div class="cat-sub" title="${sub.desc || ""}">
        <span class="cat-sub-label">${sub.label}</span>
        <span class="cat-sub-count">${sub.count}</span>
        <span class="cat-sub-ev">${sub.ev.toFixed(2)} EV</span>
        <span class="tier-count sev-major" title="Severe">${sub.tiers.severe} Severe</span>
        <span class="tier-count sev-medium" title="Mistake">${sub.tiers.mistake} Mistake</span>
        <span class="tier-count sev-light" title="Light">${sub.tiers.light} Light</span>
        <span class="tier-count sev-minor" title="Unsure">${sub.tiers.unsure} Unsure</span>
      </div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function renderSkillAreaBreakdown(games) {
  const { bySkillFacet, gamesIncluded, gamesTotal } = trendAggregateSkillFacets(games);
  const body = renderSkillAreaGroups(bySkillFacet);
  if (!body) return "";
  const coverage = (gamesIncluded != null && gamesIncluded < gamesTotal)
    ? ` <span style="color:var(--sev-medium)">Based on ${gamesIncluded}/${gamesTotal} games — older games need a decision-count backfill.</span>`
    : ` Based on ${gamesIncluded}/${gamesTotal} games.`;
  return `<div class="trend-chart-card"><h3>Skill Area Breakdown</h3>
    <p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">${coverage}</p>
    ${body}
  </div>`;
}
