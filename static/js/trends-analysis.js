// Trends page — analysis pipeline + aggregation + recommendation + per-skill-
// area breakdown.
//
// Phase 3.3 split of the legacy static/js/trends.js. This file owns the async
// worker pool that re-categorizes games in place, the aggregation helpers
// that roll per-game stats into totals, and the recommendation / category-
// breakdown panels that consume those totals. Charts come from
// trends-charts.js; the orchestrator/view lives in trends-view.js.

// In-memory cache of the last weakness analysis: { gameIds, games }, or null.
// The `games` array carries `by_category` rolled up from JS-categorized
// mistakes; renderCategoryTrend / renderTrendRecommendation consume it.
// Stays alive across navigations within the SPA but is cleared on page reload
// — see docs/backlogs/TRENDS-WEAKEST-CATEGORY.md.
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
  // Defensive: the trigger button is removed while the analysis is frozen
  // (Phase −1, see WEAKNESS_ANALYSIS_ENABLED in trends-view.js), but never run
  // even if an action somehow fires.
  if (typeof WEAKNESS_ANALYSIS_ENABLED !== "undefined" && !WEAKNESS_ANALYSIS_ENABLED) return;
  const trendsGames = await fetchTrends();
  const ids = trendsGames.map(g => g.id);
  const gen = ++trendsAnalysisGen;
  const analyzedIds = new Set();
  trendsCurrentAnalysis = { gen, games: trendsGames, analyzedIds };

  const section = document.getElementById("weakness-section");
  if (section) {
    section.innerHTML = `
      <h3>Weakest Skill Area</h3>
      <p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">Analyzing your games to find your weakest skill area…</p>
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
              if (!m.category) continue;
              if (!byCat[m.category]) byCat[m.category] = { count: 0, ev: 0 };
              byCat[m.category].count += 1;
              byCat[m.category].ev += m.ev_loss || 0;
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
          analyzedIds.add(trendsEntry.id);
        }
      } catch (e) {
        console.warn("Trends analysis: skipping game", trendsEntry.id, e);
      }
      done += 1;
      updateProgress();
    }
  }

  const concurrency = Math.min(3, trendsGames.length);
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
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
  const byCat = {};                 // facet key -> {count, ev} (historical snapshots: old codes; live: action codes)
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

// --- U-02 personalized recommendation block ---

function renderTrendRecommendation(games) {
  const { byCat, decCounts } = trendAggregateAll(games);
  if (!decCounts) return "";  // No decision_counts available — skip silently

  // Rank skill areas (not sub-categories) by aggregated EV/D. Ranking at
  // the skill-area level keeps signal concentrated — sub-category ranking
  // would dilute areas that happen to be split into more buckets.
  const totals = trendSkillAreaTotals(byCat, decCounts);
  const ranked = [];
  for (const sa of TREND_SKILL_AREAS) {
    const t = totals[sa.key];
    if (t.decisions < TREND_MIN_DECISIONS) continue;
    ranked.push({ sa, evPerD: t.ev / t.decisions, ev: t.ev, decisions: t.decisions });
  }
  if (ranked.length < 1) {
    return `<div class="trend-chart-card"><h3>Haipai Trainer</h3>
      <div class="mascot-speech">
        <img src="/static/mascot.svg" class="mascot-avatar" alt="">
        <div class="speech-bubble">Not enough data yet for a personalized recommendation — play more games to unlock.</div>
      </div>
    </div>`;
  }
  ranked.sort((a, b) => b.evPerD - a.evPerD);
  const w = ranked[0];
  const sa = w.sa;

  return `<div class="trend-chart-card"><h3>Haipai Trainer</h3>
    <div class="mascot-speech">
      <img src="/static/mascot.svg" class="mascot-avatar" alt="">
      <div class="speech-bubble">
        <span class="trigger-line">Your biggest weakness: <strong style="color:${sa.color}">${sa.label}</strong> at ${w.evPerD.toFixed(4)} EV/decision.</span>
        ${sa.intro}
        <div style="margin-top:6px;font-size:11.5px">Focus: ${sa.study}.</div>
      </div>
    </div>
  </div>`;
}

// --- Skill-area bar chart with per-sub-category drill-down ---

function renderCategoryTrend(games) {
  const { byCat, decCounts, gamesIncluded, gamesTotal } = trendAggregateAll(games);
  const totals = trendSkillAreaTotals(byCat, decCounts);

  // One row per skill area, ranked by EV/D desc (most critical first).
  // Areas with no decisions sink to the bottom; areas with neither mistakes
  // nor decisions drop out.
  const rows = TREND_SKILL_AREAS
    .map(sa => {
      const t = totals[sa.key];
      return {
        sa,
        ev: t.ev,
        count: t.count,
        decisions: t.decisions,
        evPerD: t.decisions > 0 ? t.ev / t.decisions : null,
      };
    })
    .filter(r => r.ev > 0 || r.count > 0 || r.decisions > 0)
    .sort((a, b) => (b.evPerD ?? -1) - (a.evPerD ?? -1));
  if (rows.length === 0) return "";

  const maxEvPerD = Math.max(...rows.map(r => r.evPerD || 0)) || 1;
  const coverage = (gamesIncluded != null && gamesIncluded < gamesTotal)
    ? ` <span style="color:var(--sev-medium)">Based on ${gamesIncluded}/${gamesTotal} games — older games need a decision-count backfill.</span>`
    : ` Based on ${gamesIncluded}/${gamesTotal} games.`;

  let html = `<div class="trend-chart-card"><h3>EV Loss per Decision by Skill Area (All Games)</h3><p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">Sorted by most critical. Click a row for the per-category breakdown.${coverage}</p><div class="trend-bars">`;
  for (const r of rows) {
    const sa = r.sa;
    const pct = r.evPerD != null ? (r.evPerD / maxEvPerD * 100).toFixed(0) : 0;
    const rowId = "trend-" + sa.key;
    const primary = r.evPerD != null ? `${r.evPerD.toFixed(4)} EV/D` : "—";
    html += `<div class="trend-bar-row" data-action="toggleTrendMistakes" data-sa-label="${sa.label}" data-row-id="${rowId}" style="cursor:pointer">
      <span class="trend-bar-label" style="color:${sa.color}">${sa.short || sa.label}</span>
      <div class="trend-bar-track">
        <div class="trend-bar-fill" style="width:${pct}%;background:${sa.color}"></div>
      </div>
      <span class="trend-bar-primary">${primary}</span>
      <span class="trend-bar-breakdown">(${r.ev.toFixed(1)} EV · ${r.count} in ${r.decisions} decisions)</span>
    </div>
    <div id="${rowId}" class="trend-mistakes-panel" style="display:none">${renderTrendGroupBreakdown(sa.key, byCat, decCounts)}</div>`;
  }
  html += `</div></div>`;

  html += `<div class="trend-chart-card"><h3>Skill Area per Game</h3><div class="trend-chart">`;
  html += renderGroupStackedChart(games);
  html += `</div></div>`;

  return html;
}

// Drill-down for one skill area: lists sub-categories with EV, count, and
// EV/D (using the skill-area denominator — same one as the parent row).
function renderTrendGroupBreakdown(saKey, byCat, decCounts) {
  const sa = trendSkillAreaInfo(saKey);
  if (!sa) return "";
  const denom = decCounts ? (decCounts[saKey] || 0) : 0;

  // CORE Phase 3 stub: the category-code registry (CATEGORY_INFO) is gone, so
  // the per-sub-category drill-down is rebuilt against {skill area} × {shape}
  // in EXTRAS-C (when the weakness-analysis freeze lifts). Until then we list
  // whatever facet keys are present in `byCat` for this skill area — historical
  // snapshots carry the old P/D/OD codes; live data carries action codes.
  const entries = [];
  for (const [cat, data] of Object.entries(byCat)) {
    if (trendSkillAreaFor(cat) !== saKey) continue;
    if (!data || data.count === 0) continue;
    entries.push({
      cat,
      label: cat,
      desc: "",
      study: sa.study,
      ev: data.ev,
      count: data.count,
      evPerD: denom > 0 ? data.ev / denom : null,
    });
  }
  entries.sort((a, b) => b.ev - a.ev);

  const totalEv = entries.reduce((s, e) => s + e.ev, 0);
  const evPerD = denom > 0 ? totalEv / denom : null;
  const summary = evPerD != null
    ? `You lose <strong style="color:${sa.color}">${evPerD.toFixed(4)} EV/Decision</strong> when ${sa.situation}. In total there were <strong>${denom}</strong> decisions and your total EV loss in these categories is <strong>${totalEv.toFixed(1)}</strong>.`
    : `Not enough decisions recorded to compute EV/Decision when ${sa.situation}.`;

  let html = `<div style="padding:10px 12px">`;
  html += `<div class="mascot-speech" style="margin-bottom:14px">
    <img src="/static/mascot.svg" class="mascot-avatar" alt="">
    <div class="speech-bubble">${summary} <span style="opacity:0.75">Reference: ${sa.study}.</span></div>
  </div>`;
  html += `<div class="trend-bars" style="gap:12px">`;
  for (const e of entries) {
    const primary = e.evPerD != null ? `${e.evPerD.toFixed(4)} EV/D` : "—";
    const studyStr = e.study ? ` <span style="opacity:0.7">— ${e.study}</span>` : "";
    html += `<div style="display:flex;flex-direction:column;gap:3px">
      <div class="trend-bar-row">
        <span class="trend-bar-label" style="color:${sa.color};min-width:140px">${e.label}</span>
        <span class="trend-bar-value" style="flex:1">${primary} <span class="trend-bar-count">(${e.ev.toFixed(1)} EV · ${e.count})</span></span>
      </div>
      ${e.desc ? `<div style="color:var(--text-dim);font-size:11.5px;line-height:1.45;padding-left:4px">${e.desc}${studyStr}</div>` : ""}
    </div>`;
  }
  html += `</div></div>`;
  return html;
}
