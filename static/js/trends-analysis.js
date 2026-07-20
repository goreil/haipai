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
            }
          }
          if (trendsAnalysisGen !== gen) return;
          trendsEntry.by_category = byCat;
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
  try {
    const res = await apiPost("/api/trends/snapshot", {
      categorizer_version: haipaiCategorize.CATEGORIZER_VERSION,
      game_ids: analyzedGameIds,
      by_category: byCat,
      decision_counts: decCounts,
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
  html += renderConceptLedgers(agg, boxes);
  return html;
}

// The ledger + trade-off-totals cards themselves — same CSS classes and pill
// styling as the per-game renderConceptBreakdown (static/style-game-detail.css
// .concept-*), but non-interactive: trends has no rounds view underneath to
// filter into, so pills are plain colour chips, not click targets.
function renderConceptLedgers(agg, boxes) {
  const gm = conceptMetaMap();
  const TIER_CHIPS = [
    ["severe", "sev-major", "Severe"],
    ["mistake", "sev-medium", "Mistake"],
    ["light", "sev-light", "Light"],
    ["unsure", "sev-minor", "Unsure"],
  ];
  const tierChips = (t) => TIER_CHIPS
    .filter(([k]) => t[k])
    .map(([k, cls, lbl]) => `<span class="tier-count ${cls}" title="${lbl}">${t[k]}</span>`)
    .join("");

  let missedHtml = "";
  const missedRows = agg ? Object.values(agg.groups.missed).sort((a, b) => b.ev - a.ev) : [];
  if (missedRows.length) {
    missedHtml = `<div class="concept-ledger">
      <div class="concept-ledger-head">
        <span class="concept-ledger-title">Losing points here</span>
        <span class="concept-ledger-sub">The better play held this edge — you’re under-using these, across all games</span>
      </div>`;
    for (const e of missedRows) {
      const meta = gm[e.group] || { label: e.group, color: "var(--text)" };
      const subs = Object.values(e.subs || {}).sort((a, b) => b.ev - a.ev);
      const subsHtml = subs.map(s => `<span class="concept-sub" style="--grp:${meta.color}">
        <span class="concept-sub-label">${s.label}</span><span class="concept-sub-ev">${s.ev.toFixed(2)}</span></span>`).join("");
      missedHtml += `<div class="concept-row">
        <span class="concept-row-left">
          <span class="concept-pill" style="--grp:${meta.color}">${meta.label}</span>
          ${subsHtml}
        </span>
        <span class="concept-tiers">${tierChips(e.tiers)}</span>
        <span class="concept-ev">${e.ev.toFixed(2)} EV</span>
      </div>`;
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

// --- Skill-area-per-game chart ---

function renderSkillAreaChart(games) {
  const { gamesIncluded, gamesTotal } = trendAggregateAll(games);
  const coverage = (gamesIncluded != null && gamesIncluded < gamesTotal)
    ? ` <span style="color:var(--sev-medium)">Based on ${gamesIncluded}/${gamesTotal} games — older games need a decision-count backfill.</span>`
    : ` Based on ${gamesIncluded}/${gamesTotal} games.`;
  return `<div class="trend-chart-card"><h3>Skill Area per Game</h3>
    <p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">${coverage}</p>
    <div class="trend-chart">${renderGroupStackedChart(games)}</div>
  </div>`;
}
