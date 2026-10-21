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
  const values = games.map(g => g[field]);
  const best = Math.min(...values), worst = Math.max(...values);
  // Keep every subgrade between the best and worst selected games. Include
  // each whole grade band so even a constant series has useful context.
  const gradeBands = Array.from({ length: 17 }, (_, i) => {
    const index = 17 - i;
    return {
      lower: index === 17 ? 0 : gameRatingBoundary(index + 0.5),
      upper: index === 1 ? Infinity : gameRatingBoundary(index - 0.5),
    };
  }).filter(band => best <= band.upper && worst >= band.lower);
  const lower = gradeBands[0].lower;
  const lastBand = gradeBands[gradeBands.length - 1];
  // E has no upper bound; extend just far enough to contain the selected data.
  const upper = Number.isFinite(lastBand.upper) ? lastBand.upper
    : Math.max(worst * 1.05, lastBand.lower + gameRatingBoundary(1.5) - gameRatingBoundary(2.5));
  const margin = (upper - lower) * 0.05;
  const minV = Math.max(0, lower - margin), maxV = upper + margin;
  const range = maxV - minV;
  const W = trendChartWidth(), H = Math.max(280, gradeBands.length * 44 + 60);
  const PAD = { top: 20, right: 20, bottom: 40, left: 90 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  function x(i) { return PAD.left + (games.length > 1 ? i / (games.length - 1) : 0.5) * plotW; }
  function y(v) { return PAD.top + plotH - ((v - minV) / range) * plotH; }

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg">`;

  // Boundary lines mark exact thresholds; the real ranking badges label
  // the grade bands between them, using the shared game-card renderer/styles.
  const boundaries = [lower, ...gradeBands.map(band => Math.min(band.upper, upper))];
  for (const value of boundaries) {
    const yy = y(value);
    svg += `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="var(--border)" stroke-width="0.5"/>`;
  }
  for (const band of gradeBands) {
    const midpoint = (band.lower + Math.min(band.upper, upper)) / 2;
    const badge = renderRanking({ total_ev_loss: midpoint, total_decisions: 1 }, "ranking-trend");
    svg += `<foreignObject x="28" y="${y(midpoint) - 16}" width="52" height="32"><div xmlns="http://www.w3.org/1999/xhtml" class="trend-grade-label">${badge}</div></foreignObject>`;
  }

  // Main line
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  svg += `<polyline points="${points}" fill="none" stroke="${opts.color}" stroke-width="2"/>`;

  // Keep date labels readable when displaying 50 games.
  const labelStep = Math.max(1, Math.ceil(games.length / Math.floor(plotW / 48)));

  // Dots + labels
  for (let i = 0; i < games.length; i++) {
    const cx = x(i), cy = y(values[i]);
    svg += `<circle cx="${cx}" cy="${cy}" r="4" fill="${opts.color}" stroke="var(--bg)" stroke-width="1.5"><title>${games[i].date}: ${values[i].toFixed(4)} EV/Decision</title></circle>`;
    if (i % labelStep !== 0 && i !== games.length - 1) continue;
    // X label (date)
    const dateLabel = games[i].date.slice(5); // MM-DD
    svg += `<text x="${cx}" y="${H - 5}" text-anchor="middle" fill="var(--text-dim)" font-size="9" transform="rotate(-30,${cx},${H - 5})">${dateLabel}</text>`;
  }

  // Y axis label
  svg += `<text x="12" y="${PAD.top + plotH / 2}" text-anchor="middle" fill="var(--text-dim)" font-size="10" transform="rotate(-90,12,${PAD.top + plotH / 2})">${opts.yLabel}</text>`;

  svg += `</svg>`;
  return svg;
}

