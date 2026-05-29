// Trends view + line/bar/stacked-bar charts.

// In-memory cache of the last weakness analysis: { gameIds, games }, or null.
// The `games` array carries `by_category` rolled up from JS-categorized
// mistakes; renderCategoryTrend / renderTrendRecommendation consume it.
// Stays alive across navigations within the SPA but is cleared on page reload
// — see docs/backlogs/TRENDS-WEAKEST-CATEGORY.md.
var trendsStash = null;
// Persisted past snapshots loaded from /api/trends/snapshots. Cached for the
// SPA session; refreshed after a fresh analysis auto-saves a new row.
var trendsSnapshots = null;
// Bumped on cancel or new run. In-flight workers compare against this and
// stop attaching results once they've been superseded.
var trendsAnalysisGen = 0;
// Active-run handle: { gen, games, analyzedIds } during analysis, null otherwise.
// Cancel uses this to render the partial result.
var trendsCurrentAnalysis = null;

// TREND_SKILL_AREAS / TREND_MIN_DECISIONS / trendSkillAreaFor /
// trendSkillAreaInfo moved to static/js/skill-areas.js.

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

// Pixel width the SVG charts should render at, matching the current content
// area so the 700px hardcoded viewBox doesn't leave a blank gutter on wide
// laptops. Subtracts .content padding (20*2) and .trend-chart-card padding
// (16*2). Floored at 700 so narrow screens keep the old layout + scroll.
function trendChartWidth() {
  const content = document.getElementById("content");
  if (!content) return 700;
  return Math.max(700, content.clientWidth - 40 - 32);
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

function _idsMatch(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

async function startWeaknessAnalysis() {
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
        <button class="btn" onclick="cancelWeaknessAnalysis()">Cancel</button>
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
        const res = await fetch(`/api/games/${trendsEntry.id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const full = await res.json();
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

function renderLineChart(games, field, opts) {
  const W = trendChartWidth(), H = 200, PAD = { top: 20, right: 20, bottom: 40, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = games.map(g => g[field]);
  const minV = Math.min(...values) * 0.85;
  const maxV = Math.max(...values) * 1.1;
  const range = maxV - minV || 1;

  // Compute 3-game moving average
  const avg = [];
  for (let i = 0; i < values.length; i++) {
    const window = values.slice(Math.max(0, i - 2), i + 1);
    avg.push(window.reduce((a, b) => a + b, 0) / window.length);
  }

  function x(i) { return PAD.left + (i / (games.length - 1)) * plotW; }
  function y(v) { return PAD.top + plotH - ((v - minV) / range) * plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg">`;

  // Y grid lines
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = minV + (range * i / yTicks);
    const yy = y(val);
    svg += `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="var(--border)" stroke-width="0.5"/>`;
    svg += `<text x="${PAD.left - 8}" y="${yy + 4}" text-anchor="end" fill="var(--text-dim)" font-size="10">${opts.format(val)}</text>`;
  }

  // Moving average area
  if (avg.length >= 2) {
    let areaPath = `M${x(0)},${y(avg[0])}`;
    for (let i = 1; i < avg.length; i++) areaPath += ` L${x(i)},${y(avg[i])}`;
    svg += `<polyline points="${avg.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="${opts.avgColor}" stroke-width="2" stroke-dasharray="4,3"/>`;
  }

  // Main line
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  svg += `<polyline points="${points}" fill="none" stroke="${opts.color}" stroke-width="2"/>`;

  // Dots + labels
  for (let i = 0; i < games.length; i++) {
    const cx = x(i), cy = y(values[i]);
    svg += `<circle cx="${cx}" cy="${cy}" r="4" fill="${opts.color}" stroke="var(--bg)" stroke-width="1.5"/>`;
    // X label (date)
    const dateLabel = games[i].date.slice(5); // MM-DD
    svg += `<text x="${cx}" y="${H - 5}" text-anchor="middle" fill="var(--text-dim)" font-size="9" transform="rotate(-30,${cx},${H - 5})">${dateLabel}</text>`;
  }

  // Y axis label
  svg += `<text x="12" y="${PAD.top + plotH / 2}" text-anchor="middle" fill="var(--text-dim)" font-size="10" transform="rotate(-90,12,${PAD.top + plotH / 2})">${opts.yLabel}</text>`;

  svg += `</svg>`;
  return svg;
}

function renderStackedBarChart(games) {
  const W = trendChartWidth(), H = 200, PAD = { top: 20, right: 20, bottom: 40, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const sevKeys = ["???", "??", "?"];
  const sevColors = { "???": "var(--sev-major)", "??": "var(--sev-medium)", "?": "var(--sev-minor)" };

  const maxTotal = Math.max(...games.map(g => {
    const sev = g.by_severity || {};
    return (sev["???"] || 0) + (sev["??"] || 0) + (sev["?"] || 0);
  }));

  const barW = Math.min(30, (plotW / games.length) * 0.7);
  const gap = plotW / games.length;

  function y(v) { return PAD.top + plotH - (v / (maxTotal || 1)) * plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg">`;

  // Y grid
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round(maxTotal * i / yTicks);
    const yy = y(val);
    svg += `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="var(--border)" stroke-width="0.5"/>`;
    svg += `<text x="${PAD.left - 8}" y="${yy + 4}" text-anchor="end" fill="var(--text-dim)" font-size="10">${val}</text>`;
  }

  // Bars
  for (let i = 0; i < games.length; i++) {
    const sev = games[i].by_severity || {};
    const cx = PAD.left + gap * i + gap / 2;
    let bottom = PAD.top + plotH;

    for (const key of sevKeys) {
      const count = sev[key] || 0;
      if (count === 0) continue;
      const barH = (count / (maxTotal || 1)) * plotH;
      const top = bottom - barH;
      svg += `<rect x="${cx - barW / 2}" y="${top}" width="${barW}" height="${barH}" fill="${sevColors[key]}" rx="2" opacity="0.85"/>`;
      if (barH > 14) {
        svg += `<text x="${cx}" y="${top + barH / 2 + 4}" text-anchor="middle" fill="var(--bg)" font-size="9" font-weight="700">${count}</text>`;
      }
      bottom = top;
    }

    // X label
    const dateLabel = games[i].date.slice(5);
    svg += `<text x="${cx}" y="${H - 5}" text-anchor="middle" fill="var(--text-dim)" font-size="9" transform="rotate(-30,${cx},${H - 5})">${dateLabel}</text>`;
  }

  // Legend
  const sevLegend = { "???": "Severe", "??": "Mistake", "?": "Light+" };
  let lx = W - PAD.right - 180;
  for (const key of sevKeys) {
    svg += `<rect x="${lx}" y="5" width="10" height="10" fill="${sevColors[key]}" rx="2"/>`;
    svg += `<text x="${lx + 14}" y="14" fill="var(--text-dim)" font-size="10">${sevLegend[key]}</text>`;
    lx += 58;
  }

  svg += `</svg>`;
  return svg;
}

// --- Aggregation helpers for the trends category panel ---

// Roll per-game stats into totals across all games.
// Only counts games that have `decision_counts` populated, so the EV
// numerator and the decision-count denominator come from the same set —
// otherwise old games (parsed before U-04) contribute EV with no
// matching denominator and inflate EV/D ~10x.
function trendAggregateAll(games) {
  const byCat = {};                 // {P1: {count, ev}, ...}
  const decCounts = { attack: 0, defense: 0, riichi: 0, meld: 0, kan: 0 };
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
    html += `<div class="trend-bar-row" onclick="toggleTrendMistakes('${sa.label}', '${rowId}')" style="cursor:pointer">
      <span class="trend-bar-label" style="color:${sa.color}">${sa.label}</span>
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

  const entries = [];
  for (const [cat, info] of Object.entries(CATEGORY_INFO)) {
    if (info.group !== sa.catGroup) continue;
    const data = byCat[cat];
    if (info.legacy && (!data || data.count === 0)) continue;
    entries.push({
      cat,
      label: info.label,
      desc: info.desc,
      study: info.study,
      ev: data ? data.ev : 0,
      count: data ? data.count : 0,
      evPerD: denom > 0 && data ? data.ev / denom : null,
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
        <span class="trend-bar-label" style="color:${sa.color};min-width:140px">${e.cat} · ${e.label}</span>
        <span class="trend-bar-value" style="flex:1">${primary} <span class="trend-bar-count">(${e.ev.toFixed(1)} EV · ${e.count})</span></span>
      </div>
      ${e.desc ? `<div style="color:var(--text-dim);font-size:11.5px;line-height:1.45;padding-left:4px">${e.desc}${studyStr}</div>` : ""}
    </div>`;
  }
  html += `</div></div>`;
  return html;
}

function renderGroupStackedChart(games) {
  const W = trendChartWidth(), H = 200, PAD = { top: 20, right: 20, bottom: 40, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Per-game EV split across the 5 skill areas.
  const perGame = games.map(g => {
    const totals = {};
    for (const sa of TREND_SKILL_AREAS) totals[sa.key] = 0;
    for (const [cat, data] of Object.entries(g.by_category || {})) {
      const k = trendSkillAreaFor(cat);
      if (k != null && totals[k] != null) totals[k] += data.ev;
    }
    return totals;
  });

  const maxEv = Math.max(1, ...games.map(g => g.total_ev_loss || 0));
  const barW = Math.min(30, (plotW / games.length) * 0.7);
  const gap = plotW / games.length;

  function y(v) { return PAD.top + plotH - (v / maxEv) * plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg">`;

  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxEv * i / yTicks).toFixed(0);
    const yy = y(parseFloat(val));
    svg += `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="var(--border)" stroke-width="0.5"/>`;
    svg += `<text x="${PAD.left - 8}" y="${yy + 4}" text-anchor="end" fill="var(--text-dim)" font-size="10">${val}</text>`;
  }

  for (let i = 0; i < games.length; i++) {
    const cx = PAD.left + gap * i + gap / 2;
    let bottom = PAD.top + plotH;
    for (const sa of TREND_SKILL_AREAS) {
      const ev = perGame[i][sa.key];
      if (!ev || ev <= 0) continue;
      const barH = (ev / maxEv) * plotH;
      const top = bottom - barH;
      svg += `<rect x="${cx - barW / 2}" y="${top}" width="${barW}" height="${barH}" fill="${sa.color}" rx="1" opacity="0.8"/>`;
      bottom = top;
    }
    const dateLabel = games[i].date.slice(5);
    svg += `<text x="${cx}" y="${H - 5}" text-anchor="middle" fill="var(--text-dim)" font-size="9" transform="rotate(-30,${cx},${H - 5})">${dateLabel}</text>`;
  }

  let lx = PAD.left;
  for (const sa of TREND_SKILL_AREAS) {
    svg += `<rect x="${lx}" y="4" width="10" height="10" fill="${sa.color}" rx="2"/>`;
    svg += `<text x="${lx + 13}" y="13" fill="var(--text-dim)" font-size="9">${sa.label}</text>`;
    lx += sa.label.length * 7 + 22;
  }

  svg += `</svg>`;
  return svg;
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
