// Trends page — view orchestrator.
//
// Phase 3.3 split of the legacy static/js/trends.js. This file is the entry
// point — it fetches the per-game summaries and snapshot history, renders the
// page shell, decides whether to show the cached weakness panels or the
// opt-in button, and owns the snapshot history UI. Charts come from
// trends-charts.js; analysis/aggregation/recommendation live in
// trends-analysis.js.

// Persisted past snapshots loaded from /api/trends/snapshots. Cached for the
// SPA session; refreshed after a fresh analysis auto-saves a new row.
var trendsSnapshots = null;

async function fetchTrends() {
  const res = await fetch("/api/trends");
  return await res.json();
}

async function fetchSnapshots() {
  try {
    const res = await fetch("/api/trends/snapshots");
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function showTrends() {
  setSeverityFiltersVisible(false);
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");
  content.innerHTML = '<div class="empty-state">Loading trends...</div>';

  const [games, snapshots] = await Promise.all([fetchTrends(), fetchSnapshots()]);
  trendsSnapshots = snapshots;
  if (games.length < 2) {
    content.innerHTML = '<div class="empty-state">Need at least 2 games for trend analysis</div>';
    return;
  }
  renderTrends(games);
}

function renderTrends(games) {
  const content = document.getElementById("content");

  // Compute aggregates
  const totalGames = games.length;
  const totalMistakes = games.reduce((s, g) => s + g.total_mistakes, 0);
  const totalEv = games.reduce((s, g) => s + g.total_ev_loss, 0);
  const gamesWithDecisions = games.filter(g => g.ev_per_decision != null);
  const avgEvPerDecision = gamesWithDecisions.length > 0
    ? gamesWithDecisions.reduce((s, g) => s + g.ev_per_decision, 0) / gamesWithDecisions.length : null;

  // Trend direction (last 5 vs first 5 for ev_per_decision)
  let trendArrow = "";
  if (gamesWithDecisions.length >= 4) {
    const half = Math.floor(gamesWithDecisions.length / 2);
    const firstHalf = gamesWithDecisions.slice(0, half);
    const secondHalf = gamesWithDecisions.slice(-half);
    const avgFirst = firstHalf.reduce((s, g) => s + g.ev_per_decision, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, g) => s + g.ev_per_decision, 0) / secondHalf.length;
    const pctChange = ((avgSecond - avgFirst) / avgFirst * 100).toFixed(0);
    if (avgSecond < avgFirst) {
      trendArrow = `<span class="trend-down">${pctChange}%</span>`;
    } else {
      trendArrow = `<span class="trend-up">+${pctChange}%</span>`;
    }
  }

  let html = `
    <div class="game-header"><h2>Trend Analysis</h2></div>
    <div class="summary-bar">
      <div class="stat"><span class="value">${totalGames}</span><span class="label">Games</span></div>
      <div class="stat"><span class="value">${totalMistakes}</span><span class="label">Total Mistakes</span></div>
      <div class="stat"><span class="value">${totalEv.toFixed(1)}</span><span class="label">Total EV Loss</span></div>
      ${avgEvPerDecision != null ? `<div class="stat"><span class="value">${avgEvPerDecision.toFixed(4)}</span><span class="label">Avg EV/Decision</span></div>` : ""}
      ${trendArrow ? `<div class="stat"><span class="value">${trendArrow}</span><span class="label">EV/Decision Trend</span></div>` : ""}
    </div>
  `;

  // Personal best / recent performance
  if (gamesWithDecisions.length >= 3) {
    const sorted = [...gamesWithDecisions].sort((a, b) => a.ev_per_decision - b.ev_per_decision);
    const best = sorted[0];
    const recent = gamesWithDecisions.slice(-3);
    const recentAvg = recent.reduce((s, g) => s + g.ev_per_decision, 0) / recent.length;
    html += `<div class="summary-bar" style="margin-top:0">
      <div class="stat"><span class="value">${best.ev_per_decision.toFixed(4)}</span><span class="label">Best EV/D (${best.date.slice(5)})</span></div>
      <div class="stat"><span class="value">${recentAvg.toFixed(4)}</span><span class="label">Last 3 Avg</span></div>
      <div class="stat"><span class="value">${games.reduce((s, g) => s + ((g.by_severity || {})["???"] || 0), 0)}</span><span class="label">Total Severe Mistakes</span></div>
    </div>`;
  }

  // Chart 1: EV per decision over time
  if (gamesWithDecisions.length >= 2) {
    html += `<div class="trend-chart-card">
      <h3>EV Loss per Decision</h3>
      <div class="trend-chart">${renderLineChart(gamesWithDecisions, "ev_per_decision", {
        color: "#4fc3f7",
        avgColor: "#4fc3f740",
        format: v => v.toFixed(3),
        yLabel: "EV/Decision",
      })}</div>
    </div>`;
  }

  // Chart 2: Severity breakdown over time
  html += `<div class="trend-chart-card">
    <h3>Mistakes by Severity</h3>
    <div class="trend-chart">${renderStackedBarChart(games)}</div>
  </div>`;

  // Chart 3: Personalized recommendation + per-skill-area breakdown. The
  // per-game `by_category` rollup is computed client-side (the JS categorizer
  // overrides on render), so the panel sits behind an opt-in button — see
  // docs/backlogs/TRENDS-WEAKEST-CATEGORY.md. The button is replaced in place
  // when analysis completes or is cancelled.
  html += renderWeaknessSection(games);

  // Past analyses (auto-saved server-side after each full run). Each row is
  // tagged with the categorizer version that produced it, so users can see
  // how their weakness profile has shifted across versions.
  html += `<div id="snapshots-history">${renderSnapshotsHistory(trendsSnapshots || [])}</div>`;

  content.innerHTML = html;
}

// Wrapper that shows either the stashed analysis panels (cache hit + a
// stale-banner re-run button when new games exist) or an opt-in button.
// A stale stash is still worth showing — the previous analysis is the
// closest thing to current truth until the user opts to refresh.
function renderWeaknessSection(games) {
  const ids = games.map(g => g.id);
  if (trendsStash) {
    const exactMatch = _idsMatch(trendsStash.gameIds, ids);
    if (exactMatch) {
      return `<div id="weakness-section">${_renderAnalyzedPanels(trendsStash.games, null)}</div>`;
    }
    const stashedSet = new Set(trendsStash.gameIds);
    const newCount = ids.filter(id => !stashedSet.has(id)).length;
    const staleBanner = `<div class="trend-chart-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span style="font-size:13px;color:var(--sev-medium)">Showing your last analysis. ${newCount} new game${newCount === 1 ? "" : "s"} since then — re-run to refresh.</span>
      <button class="btn btn-primary" onclick="startWeaknessAnalysis()">Re-analyze</button>
    </div>`;
    return `<div id="weakness-section">${staleBanner}${_renderAnalyzedPanels(trendsStash.games, null)}</div>`;
  }
  return `<div id="weakness-section" class="trend-chart-card">
    <h3>Weakest Skill Area</h3>
    <p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">Computes your weakest skill area across all games. Takes a few seconds.</p>
    <button class="btn btn-primary" onclick="startWeaknessAnalysis()">Analyze my weak categories</button>
  </div>`;
}

// Render the recommendation + bar-chart panels into the wrapper, replacing
// the button. When `analyzedIds` is non-null (partial-cancel render), games
// outside the set have their decision_counts stripped so they count toward
// gamesTotal but not gamesIncluded — giving the existing "Based on N/M" line
// honest coverage. On a full pass, pass null to render unmodified.
function _renderAnalyzedPanels(games, analyzedIds) {
  const renderGames = analyzedIds
    ? games.map(g => analyzedIds.has(g.id) ? g : { ...g, decision_counts: null })
    : games;
  return renderTrendRecommendation(renderGames) + renderCategoryTrend(renderGames);
}

function _replaceWeaknessSection(games, analyzedIds) {
  const section = document.getElementById("weakness-section");
  if (!section) return;
  section.outerHTML = `<div id="weakness-section">${_renderAnalyzedPanels(games, analyzedIds)}</div>`;
}

// --- Snapshots history ---

// Each snapshot row carries pre-aggregated by_category + decision_counts, so
// we can rank skill areas directly without re-fetching games.
function _snapshotSkillAreaTotals(snapshot) {
  return trendSkillAreaTotals(snapshot.by_category || {}, snapshot.decision_counts || {});
}

function _snapshotWeakestArea(snapshot) {
  const totals = _snapshotSkillAreaTotals(snapshot);
  const ranked = TREND_SKILL_AREAS
    .map(sa => ({ sa, t: totals[sa.key] }))
    .filter(r => r.t.decisions >= TREND_MIN_DECISIONS)
    .map(r => ({ sa: r.sa, evPerD: r.t.ev / r.t.decisions }));
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => b.evPerD - a.evPerD);
  return ranked[0];
}

function _formatSnapshotDate(iso) {
  // SQLite CURRENT_TIMESTAMP yields "YYYY-MM-DD HH:MM:SS" in UTC. Render the
  // date + HH:MM for the row label without pulling in a date library.
  if (!iso) return "";
  const t = iso.replace(" ", "T") + "Z";
  const d = new Date(t);
  if (isNaN(d.getTime())) return iso;
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderSnapshotsHistory(snapshots) {
  if (!snapshots || snapshots.length === 0) return "";
  let html = `<div class="trend-chart-card"><h3>Past Analyses</h3>
    <p style="font-size:12px;color:var(--text-dim);margin:-4px 0 10px">Auto-saved each time you run the weakness analysis. The version tag bumps when the categorizer logic changes.</p>
    <div class="trend-bars">`;
  for (const s of snapshots) {
    const weak = _snapshotWeakestArea(s);
    const weakLabel = weak
      ? `<strong style="color:${weak.sa.color}">${weak.sa.label}</strong> · ${weak.evPerD.toFixed(4)} EV/D`
      : `<span style="color:var(--text-dim)">not enough decisions</span>`;
    const date = _formatSnapshotDate(s.created_at);
    const panelId = `snap-${s.id}`;
    html += `<div class="trend-bar-row" onclick="toggleSnapshotPanel('${panelId}')" style="cursor:pointer">
      <span class="trend-bar-label" style="min-width:140px">${date}</span>
      <span class="trend-bar-value" style="flex:1">v${s.categorizer_version} · ${weakLabel}</span>
      <span class="trend-bar-count">${s.game_count} game${s.game_count === 1 ? "" : "s"}</span>
    </div>
    <div id="${panelId}" class="trend-mistakes-panel" style="display:none">${renderSnapshotDetail(s)}</div>`;
  }
  html += `</div></div>`;
  return html;
}

function toggleSnapshotPanel(panelId) {
  const el = document.getElementById(panelId);
  if (!el) return;
  el.style.display = el.style.display === "none" ? "block" : "none";
}

function renderSnapshotDetail(snapshot) {
  const totals = _snapshotSkillAreaTotals(snapshot);
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
  if (rows.length === 0) return `<div style="padding:10px 12px;color:var(--text-dim)">No decisions recorded in this snapshot.</div>`;

  const maxEvPerD = Math.max(...rows.map(r => r.evPerD || 0)) || 1;
  const changelogNote = (typeof haipaiCategorize !== "undefined" && haipaiCategorize.CATEGORIZER_CHANGELOG
    && haipaiCategorize.CATEGORIZER_CHANGELOG[snapshot.categorizer_version]) || null;

  let html = `<div style="padding:10px 12px">`;
  if (changelogNote) {
    html += `<div style="font-size:11.5px;color:var(--text-dim);margin-bottom:10px">v${snapshot.categorizer_version}: ${changelogNote}</div>`;
  }
  html += `<div class="trend-bars">`;
  for (const r of rows) {
    const sa = r.sa;
    const pct = r.evPerD != null ? (r.evPerD / maxEvPerD * 100).toFixed(0) : 0;
    const primary = r.evPerD != null ? `${r.evPerD.toFixed(4)} EV/D` : "—";
    html += `<div class="trend-bar-row">
      <span class="trend-bar-label" style="color:${sa.color}">${sa.label}</span>
      <div class="trend-bar-track">
        <div class="trend-bar-fill" style="width:${pct}%;background:${sa.color}"></div>
      </div>
      <span class="trend-bar-primary">${primary}</span>
      <span class="trend-bar-breakdown">(${r.ev.toFixed(1)} EV · ${r.count} in ${r.decisions} decisions)</span>
    </div>`;
  }
  html += `</div></div>`;
  return html;
}
