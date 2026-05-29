// Trends page — SVG chart renderers (pure render helpers).
//
// Phase 3.3 split of the legacy static/js/trends.js. Charts have no state of
// their own; they take a `games` array and return an SVG string. Load order:
// this file → trends-analysis.js → trends-view.js (the view orchestrates).

// Pixel width the SVG charts should render at, matching the current content
// area so the 700px hardcoded viewBox doesn't leave a blank gutter on wide
// laptops. Subtracts .content padding (20*2) and .trend-chart-card padding
// (16*2). Floored at 700 so narrow screens keep the old layout + scroll.
function trendChartWidth() {
  const content = document.getElementById("content");
  if (!content) return 700;
  return Math.max(700, content.clientWidth - 40 - 32);
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
