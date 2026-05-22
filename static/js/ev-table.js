// EV-comparison table + safety/dealin lookup helpers + wait-breakdown
// rendering. Read by mistake-card.js as the core "discard pick analysis"
// widget.

function renderEvComparison(m, options) {
  options = options || {};
  // Multi-riichi view: when per_threat has multiple entries, the user can
  // toggle between "combined" (default, aggregated deal-in %) and a specific
  // opponent's seat. The toggle swaps dealin_rates + wait_breakdowns locally
  // for the duration of the render.
  const threatCount = Array.isArray(m.per_threat) ? m.per_threat.length : 0;
  const rawView = options.threatView;  // "combined" | integer index | undefined
  const threatIdx = (typeof rawView === "number" && rawView >= 0 && rawView < threatCount)
    ? rawView
    : null;
  const activeView = threatIdx == null ? "combined" : threatIdx;
  const displayDealin = threatIdx != null
    ? m.per_threat[threatIdx].dealin_rates
    : m.dealin_rates;
  const displayBreakdowns = threatIdx != null
    ? (m.per_threat[threatIdx].wait_breakdowns || m.wait_breakdowns)
    : m.wait_breakdowns;
  const displaySujiPartners = threatIdx != null
    ? (m.per_threat[threatIdx].suji_partners || m.suji_partners)
    : m.suji_partners;
  const hasDealin = displayDealin && Object.keys(displayDealin).length > 0;
  const hasSafety = m.safety_ratings && Object.keys(m.safety_ratings).length > 0;
  const useKd = hasDealin;  // KD fields take over the safety columns when present

  // A reach action has no pai of its own — the riichi tile is the next
  // dahai by the same player in the mjai log. For 5A the backend stores it
  // as `actual_riichi_tile`; for 5B (player silently discarded when they
  // should have reached) we use actual.pai as the tile for both rows
  // (Mortal's reach would have dropped the same tile).
  const actualTile = (m.actual && m.actual.pai)
    || (m.actual && m.actual.type === "reach" ? m.actual_riichi_tile : null);
  const expectedTile = (m.expected && m.expected.pai)
    || (m.expected && m.expected.type === "reach" ? actualTile : null);

  // Build a unified list of tiles from mortal top_actions and discard_stats
  const mortalMap = {};
  for (const a of m.top_actions) {
    const tile = a.action.pai || a.action.type;
    mortalMap[tile] = a;
  }

  const statMap = {};
  for (const s of m.discard_stats) {
    statMap[s.tile] = s;
  }

  // Review view is decluttered: just the three decisions the user cares about
  // (you / mortal / calc).
  const shown = new Set();
  if (actualTile) shown.add(actualTile);
  if (expectedTile) shown.add(expectedTile);

  // Speed (calculator) row: only worth its own row when it strictly beats
  // both user and AI choices on (shanten, ukeire). If either choice ties
  // it, the "Speed" marker is applied to that row instead — and if both
  // tie, both get the marker. Avoids a redundant third row when the
  // student's pick is already the fastest.
  const speedStat = m.best_discard
    ? (statMap[m.best_discard] || statMap[normalizeRed(m.best_discard)])
    : null;
  const actualStat = actualTile
    ? (statMap[actualTile] || statMap[normalizeRed(actualTile)])
    : null;
  const expectedStat = expectedTile
    ? (statMap[expectedTile] || statMap[normalizeRed(expectedTile)])
    : null;
  const tiesSpeed = (s) => s && speedStat
    && s.shanten === speedStat.shanten
    && s.necessary_count === speedStat.necessary_count;
  const speedAbsorbedByActual = tiesSpeed(actualStat);
  const speedAbsorbedByExpected = tiesSpeed(expectedStat);
  if (m.best_discard && !speedAbsorbedByActual && !speedAbsorbedByExpected) {
    shown.add(m.best_discard);
  }

  // (Historical note: previously we pinned the highest-dealin hand tile as
  // a "Threat" row on genbutsu-vs-genbutsu defense mistakes. Removed — added
  // clutter more often than context, and the Deal-in waits section below the
  // table already surfaces the threat via per-tile breakdowns when needed.)

  // Sort: mortal best first, then by mortal q_value desc, then exp_score desc
  const tiles = [...shown].sort((a, b) => {
    const ma = mortalMap[a], mb = mortalMap[b];
    const ca = statMap[a], cb = statMap[b];
    const qa = ma ? ma.q_value : -999;
    const qb = mb ? mb.q_value : -999;
    return qb - qa;
  });

  // Find best values for highlighting
  const bestMortalQ = Math.max(...m.top_actions.map(a => a.q_value));

  // Tile-acceptance rows default to shown for Basic Strategy categories
  // (P1-P4, legacy 1A/2A/3A), hidden for Defense (D1-D3) and other
  // categories to keep those cards focused on their primary concern.
  const cat = m.category || "";
  const ukeireDefaultShown = cat.startsWith("P") || cat === "1A" || cat === "2A" || cat === "3A";
  const ukeireHiddenClass = ukeireDefaultShown ? "" : " ukeire-hidden";

  // Always give a container ID so switchThreatView can re-render in place.
  const containerId = options.containerId || _registerEvContainer(m, options);
  let html = `<div class="ev-comparison${ukeireHiddenClass}" id="${containerId}" data-threat-view="${activeView}">`;
  html += `<button type="button" class="ukeire-toggle" onclick="toggleUkeire(this)">`;
  html += ukeireDefaultShown ? "Hide tile acceptance" : "Show tile acceptance";
  html += `</button>`;

  // Multi-riichi pill toggle — only shown when 2+ opponents are in riichi.
  // Each pill re-renders this ev-comparison with a different threat view.
  if (threatCount >= 2) {
    // Labels follow the kyoku's actual winds, not absolute seat order.
    // Derive oya from (hero_actor, hero_seat_wind) so "vs West" matches the
    // opponent the student sees in the discards view.
    const WINDS = ["E", "S", "W", "N"];
    const heroActor = m.actual && m.actual.actor;
    const heroWind = m.board_state && m.board_state.seat_wind;
    let oya = null;
    if (heroActor != null && heroWind) {
      const pw = WINDS.indexOf(heroWind);
      if (pw >= 0) oya = ((heroActor - pw) % 4 + 4) % 4;
    }
    const seatWindFor = (seat) => oya == null
      ? (SEAT_NAMES[seat] || `Seat ${seat}`)
      : WIND_DISPLAY[WINDS[(seat - oya + 4) % 4]];

    html += `<div class="threat-toggle">`;
    html += `<span class="threat-toggle-label">View:</span>`;
    const combinedActive = activeView === "combined" ? " active" : "";
    html += `<button type="button" class="threat-pill${combinedActive}"`
      + ` onclick="switchThreatView('${containerId}', 'combined')">Combined</button>`;
    m.per_threat.forEach((pt, i) => {
      const active = activeView === i ? " active" : "";
      html += `<button type="button" class="threat-pill${active}"`
        + ` onclick="switchThreatView('${containerId}', ${i})"`
        + ` title="Riichi tile: ${pt.riichi_tile || '?'}">`
        + `vs ${seatWindFor(pt.seat)}</button>`;
    });
    html += `</div>`;
  }

  html += `<table class="ev-table">`;
  html += `<thead><tr>
    <th>Tile</th>
    <th class="mortal-col" title="EV loss vs Mortal's best pick. 0.00 = Mortal's top choice. Negative values = how much EV this row costs relative to the best. Gap: &gt;1 severe, 0.5–1 mistake, 0.2–0.5 light, &lt;0.2 AI not confident.">Mortal EV Δ</th>
    <th class="shanten-col">Shanten</th>
    ${useKd ? '<th class="dealin-col" title="Probability this tile deals in — aggregated across all riichi threats">Deal-in</th><th class="dealin-col" title="Finer safety category (last honor, no-suji 4-6, etc.). Shows &quot;Safe&quot; when the deal-in rate is 0% — the tile can\'t possibly be the winning wait.">Type</th>' : (hasSafety ? '<th class="safety-col">Safety</th>' : '')}
  </tr></thead><tbody>`;

  for (const tile of tiles) {
    const ma = mortalMap[tile];
    const ca = statMap[tile] || statMap[normalizeRed(tile)];
    const isActual = actualTile === tile;
    const isExpected = expectedTile === tile;
    const isBestDiscard = m.best_discard === tile;

    let rowClass = "";
    if (isActual) rowClass = "row-actual";
    else if (isExpected) rowClass = "row-expected";

    const markers = [];
    if (isActual) markers.push('<span class="marker played">You</span>');
    if (isExpected) markers.push('<span class="marker ai">AI</span>');
    const showSpeedMarker = isBestDiscard
      || (isActual && speedAbsorbedByActual)
      || (isExpected && speedAbsorbedByExpected);
    if (showSpeedMarker) markers.push('<span class="marker speed" title="The tile that reaches tenpai fastest (most tile acceptance, ignoring hand value and defense)">Speed</span>');

    html += `<tr class="${rowClass}">`;
    html += `<td class="tile-cell">${renderTile(tile, "ev-tile")} ${markers.join("")}</td>`;

    if (ma) {
      const delta = ma.q_value - bestMortalQ;
      const isBest = delta >= -0.0001;
      const qClass = isBest ? "best-val" : "";
      const display = isBest ? "0.00" : delta.toFixed(2);
      html += `<td class="mortal-col ${qClass}" title="Absolute Mortal Q: ${ma.q_value.toFixed(3)}">${display}</td>`;
    } else {
      html += `<td class="mortal-col dim">-</td>`;
    }

    if (ca) {
      html += `<td class="shanten-col">${ca.shanten}</td>`;
    } else {
      html += `<td class="shanten-col dim">-</td>`;
    }

    if (useKd) {
      const rate = getFieldForTile(displayDealin, tile);
      const coarseLabel = coarseSafetyLabelForTile(m, tile);
      const fineLabel = fineLabelForTile(m, tile);
      if (rate != null && coarseLabel) {
        // 0% deal-in = genuinely safe against every live wait. My fine
        // label classifier only tags strict genbutsu (tile physically in
        // opponent's discards), so it can miss tiles that are safe for
        // other reasons (dead wait, all copies visible). Trust the
        // deal-in rate here — if it's 0, call it Safe no matter what
        // the label says.
        // Safe cells keep the bold-green class. Everything else gets a
        // smooth HSL gradient driven by the deal-in rate itself —
        // 0% → green, ~7.5% → yellow, 15%+ → red — anchored on the
        // observed distribution across our DB's defense rows.
        const isSafe = rate === 0 || coarseLabel === "genbutsu" || fineLabel === "genbutsu";
        const gradientColor = isSafe ? null : dealinColor(rate);
        const cls = isSafe ? "dealin-genbutsu dealin-cell" : "dealin-cell";
        const style = gradientColor ? ` style="color:${gradientColor}"` : "";
        html += `<td class="dealin-col ${cls}"${style}>${rate.toFixed(1)}%</td>`;
        const display = isSafe
          ? "Safe"
          : (fineLabel || dealinLabelText(coarseLabel));
        html += `<td class="dealin-col ${cls}"${style}>${display}</td>`;
      } else {
        html += `<td class="dealin-col dim">-</td><td class="dealin-col dim">-</td>`;
      }
    } else if (hasSafety) {
      const sr = getSafetyRating(m.safety_ratings, tile);
      if (sr != null) {
        html += `<td class="safety-col ${safetyClass(sr)}" title="${sr}/15">${safetyLabel(sr)}</td>`;
      } else {
        html += `<td class="safety-col dim">-</td>`;
      }
    }

    html += `</tr>`;

    // Column count drives the colspan for the ukeire / wait-breakdown rows.
    // 3 base columns: Tile, Mortal EV, Shanten (Exp Score removed 2026-04-20).
    const defenseCols = useKd ? 2 : (hasSafety ? 1 : 0);
    const colspan = 3 + defenseCols;

    // Under each "important" pick (AI / player / calc best), show its ukeire
    // tiles if we have per-tile data. Saves space vs a separate block and
    // puts the tile list right next to the choice it describes.
    const showUkeire = (isActual || isExpected || isBestDiscard)
                       && ca && ca.necessary_tiles && ca.necessary_tiles.length;
    if (showUkeire) {
      html += `<tr class="ukeire-row ${rowClass}">`;
      html += `<td colspan="${colspan}" class="ukeire-row-cell">`;
      html += `<span class="ukeire-row-label" title="Tiles that would improve your hand">Tile acceptance (${ca.necessary_count}):</span>`;
      html += `<span class="ukeire-row-tiles">${renderUkeireTiles(ca.necessary_tiles)}</span>`;
      html += `</td></tr>`;
    }

    // KD wait breakdown: which opponent wait shapes contribute to this
    // tile's deal-in rate. Mirrors mjai's dealin-rate detail panel.
    // Rendered for any tile in the table that has live waits — not just the
    // you/mortal/calc picks — so Defense mistakes where all three are
    // genbutsu still show the biggest threat's wait composition (paired with
    // the worst-dealin tile added to `shown` above).
    if (useKd && displayBreakdowns) {
      const waits = getFieldForTile(displayBreakdowns, tile);
      if (Array.isArray(waits) && waits.length) {
        const suji = sujiStatusForTile(tile, displaySujiPartners);
        const sujiBadge = suji
          ? `<span class="waits-suji-badge waits-suji-${suji.kind === "half-suji" ? "half" : "full"}" title="${suji.kind === "half-suji" ? "Only one of the two suji partners has been discarded — partial protection." : "Suji partner is in the opponent's discard pool."}">`
            + `<span class="waits-suji-label">${suji.kind === "half-suji" ? "Half-suji" : "Suji"}</span>`
            + suji.tiles.map(t => renderTile(t, "tile-sm waits-tile-img")).join("")
            + `</span>`
          : "";
        html += `<tr class="waits-row ${rowClass}">`;
        html += `<td colspan="${colspan}" class="waits-row-cell">`;
        html += `<span class="waits-row-label">Deal-in waits:</span>`;
        html += `<span class="waits-row-list">${sujiBadge}${renderWaitBreakdown(waits)}</span>`;
        html += `</td></tr>`;
      }
    }
  }

  html += `</tbody></table></div>`;
  return html;
}

function getSafetyRating(safetyRatings, tile) {
  if (!safetyRatings) return null;
  if (safetyRatings[tile] != null) return safetyRatings[tile];
  const normalized = normalizeRed(tile);
  if (normalized !== tile && safetyRatings[normalized] != null) return safetyRatings[normalized];
  if (tile.match(/^5[mps]$/)) {
    const red = tile + "r";
    if (safetyRatings[red] != null) return safetyRatings[red];
  }
  return null;
}

function safetyClass(rating) {
  if (rating == null) return "";
  if (rating >= 10) return "safety-safe";
  if (rating >= 6) return "safety-caution";
  return "safety-danger";
}

function getFieldForTile(dict, tile) {
  if (!dict) return null;
  if (dict[tile] != null) return dict[tile];
  const normalized = normalizeRed(tile);
  if (normalized !== tile && dict[normalized] != null) return dict[normalized];
  if (tile && tile.match(/^5[mps]$/)) {
    const red = tile + "r";
    if (dict[red] != null) return dict[red];
  }
  return null;
}

function dealinClass(label) {
  if (label === "genbutsu") return "dealin-genbutsu";
  if (label === "suji") return "dealin-suji";
  return "dealin-no-suji";
}

// Map a deal-in rate (0-100%) to an HSL colour. Green is reserved for
// 0% (genuine Safe) and handled by the caller via the .dealin-genbutsu
// class — so any nonzero rate starts at yellow and walks down to red.
// Anchors: 0.1%+ → yellow (60°), ~7.5% → orange (30°), 15%+ → red (0°).
// Calibrated against the live DB distribution across defense mistakes.
function dealinColor(rate) {
  if (rate == null || rate <= 0) return null;
  const t = Math.min(1, rate / 15);
  const hue = 60 * (1 - t);  // 60° yellow → 0° red
  return `hsl(${hue}, 75%, 55%)`;
}

function dealinLabelText(label) {
  if (label === "genbutsu") return "Safe";
  if (label === "suji") return "Suji";
  if (label === "no-suji") return "No-suji";
  return label;
}

var WAIT_TYPE_TOOLTIP = {
  ryanmen: "Side wait (ryanmen)",
  kanchan: "Middle wait (kanchan)",
  penchan: "Edge wait (penchan)",
  tanki: "Single wait (tanki)",
  shanpon: "Dual pair wait (shanpon)",
};

// Read the backend's suji_partners lookup (CS-01): mjai tile -> list of
// partner mjai tiles that appear in the relevant threat's genbutsu. One
// partner for edge tiles (1-3, 7-9); up to two for middle tiles (4/5/6).
// Half-suji is a rendering rule — middle tile with only one partner matched.
// Returns null for tiles with no matching partners (honors, no threat, etc.).
function sujiStatusForTile(tile, partnersDict) {
  if (!partnersDict) return null;
  const matched = getFieldForTile(partnersDict, tile);
  if (!Array.isArray(matched) || !matched.length) return null;
  const base = tileBase(tile);
  if (!base || base.length !== 2) return null;
  const n = parseInt(base[0], 10);
  if (!n) return null;
  const isMiddle = n >= 4 && n <= 6;
  const isHalf = isMiddle && matched.length < 2;
  return { kind: isHalf ? "half-suji" : "suji", tiles: matched };
}

function renderWaitBreakdown(waits) {
  // Show every wait shape we computed — including zero-combo ones so a fully
  // dealt-away partner tile is visible as "0×3  0.0%". Cap at 15 for safety.
  const shown = waits.slice(0, 15);
  return shown.map(w => {
    const partnerTiles = (w.tiles || []).map(t => renderTile(t, "tile-sm waits-tile-img")).join("");
    // "Left": combinations the opponent could still be holding for this wait.
    // Shanpon pairs multiply (3×2), ryanmen/kanchan show unseen per side,
    // tanki is a single number.
    const leftParts = (w.left || []).filter(n => n != null);
    const leftStr = leftParts.length ? leftParts.join("×") : "";
    const tooltip = WAIT_TYPE_TOOLTIP[w.type] || w.type;
    const isDead = w.rate < 0.1;
    const leftCls = isDead ? "waits-left waits-dead" : "waits-left";
    const rateCls = isDead ? "waits-rate waits-dead" : "waits-rate";
    return `<span class="waits-entry${isDead ? " waits-entry-dead" : ""}" title="${tooltip}">`
      + `<span class="waits-cluster">`
      +   `<span class="${leftCls}">${leftStr || "&nbsp;"}</span>`
      +   (partnerTiles ? `<span class="waits-tiles">${partnerTiles}</span>` : "")
      + `</span>`
      + `<span class="${rateCls}">${w.rate.toFixed(1)}%</span>`
      + `</span>`;
  }).join("");
}

// Long-form 0-15 suji safety label — used by the EV table's Safety column
// and renderHand's tooltip when the legacy safety_ratings field is present
// (before KD deal-in rates were backfilled).
function safetyLabel(rating) {
  if (rating == null) return "";
  if (rating >= 15) return "Genbutsu";
  if (rating >= 14) return "Suji terminal / dead honor";
  if (rating >= 13) return "Honor (1 left) / suji terminal";
  if (rating >= 11) return "Suji terminal";
  if (rating >= 10) return "Honor (2 left)";
  if (rating >= 9) return "Suji 4-5-6";
  if (rating >= 8) return "Suji 2/8";
  if (rating >= 7) return "Suji 3/7";
  if (rating >= 6) return "Honor (3 left)";
  if (rating >= 5) return "Non-suji terminal";
  if (rating >= 3) return "Non-suji 2/8";
  if (rating >= 2) return "Non-suji 3/7";
  return "Non-suji 4-5-6";
}

// --- Multi-riichi threat-view toggle ---
// Each rendered ev-comparison registers its mistake object in this map so
// the pill onclick can look it up and re-render with a different threat view
// without re-fetching from the server.
var _evRegistry = new Map();
var _evCounter = 0;

function _registerEvContainer(m, options) {
  const id = `ev-cmp-${++_evCounter}`;
  _evRegistry.set(id, { m, options: { ...(options || {}) } });
  return id;
}

function switchThreatView(containerId, view) {
  const entry = _evRegistry.get(containerId);
  if (!entry) return;
  const newOpts = { ...entry.options, containerId, threatView: view };
  const container = document.getElementById(containerId);
  if (!container) return;
  // Re-register with the updated options so the new pills point back here.
  _evRegistry.set(containerId, { m: entry.m, options: newOpts });
  container.outerHTML = renderEvComparison(entry.m, newOpts);
}

function toggleUkeire(btn) {
  const wrap = btn.closest(".ev-comparison");
  if (!wrap) return;
  const hidden = wrap.classList.toggle("ukeire-hidden");
  btn.textContent = hidden ? "Show tile acceptance" : "Hide tile acceptance";
}
