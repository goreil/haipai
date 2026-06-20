// EV-comparison table + safety/dealin lookup helpers + wait-breakdown
// rendering. Read by mistake-card.js as the core "discard pick analysis"
// widget.

// Speed ("fastest to tenpai") pick: standalone calc row + "Speed" marker are
// hidden for now so the table collapses to just You / AI — two rows, ready for
// the two-column AI-vs-You flip (docs/backlogs/UI-COMPARISON-REDESIGN.md). The
// best_discard logic below still computes (speedStat/tiesSpeed) so flipping
// this flag back on fully restores the marker and the third row.
const SHOW_SPEED_ROW = false;

// Shanten pill colour: a continuous grey→gold gradient keyed on the shanten
// value, rather than a 3-state gold/grey/red split. Tenpai (0) lands exactly on
// the "Mortal raised shanten" badge's gold/orange; each higher shanten steps
// further toward neutral grey. Raises get no special (red) treatment anymore —
// the distance is conveyed purely by where the colour sits on the ramp.
const SHANTEN_PILL_RAMP = 4; // shanten that reaches the fully-grey end
function shantenPillStyle(shanten) {
  const t = Math.max(0, Math.min(1, shanten / SHANTEN_PILL_RAMP));
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  // Gold end (t=0): text #ffcb80, bg orange@0.12, border orange@0.5 — matches
  // .raised-shanten-badge. Grey end (t=1): text --text-dim #8892a4, bg white@.08.
  const tr = lerp(255, 136), tg = lerp(203, 146), tb = lerp(128, 164); // text
  const br = lerp(255, 255), bg = lerp(165, 255), bb = lerp(0, 255);   // fill/border hue
  const fillA = (0.12 + (0.08 - 0.12) * t).toFixed(3);
  const lineA = (0.5 + (0.18 - 0.5) * t).toFixed(3);
  return `color:rgb(${tr},${tg},${tb});`
    + `background:rgba(${br},${bg},${bb},${fillA});`
    + `border:1px solid rgba(${br},${bg},${bb},${lineA});`;
}

function renderEvComparison(m, options) {
  options = options || {};
  // Multi-threat view: when per_threat has multiple entries (riichi and/or
  // open-defense threats), the user can toggle between "combined" (default,
  // aggregated deal-in %) and a specific opponent's seat. The toggle swaps
  // dealin_rates + wait_breakdowns locally for the duration of the render.
  const ukeireDora = getDoraTiles(m.board_state);
  // A tile is dora if it's a red five or sits in the active indicator-dora set.
  const isDoraTile = (t) => !!t && (/^5[mps]r$/.test(t) || ukeireDora.has(tileBase(t)));
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
  const useKd = displayDealin && Object.keys(displayDealin).length > 0;

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
    // Cross-alias red/regular fives. shanten_calc emits one stat per base
    // tile, keyed "5pr" when the hand holds the red copy and "5p" otherwise
    // — but a discard of the other copy is still the same per-base-tile
    // decision. Without the alias, a "5p" discard against a "5pr"-keyed
    // stat (or vice versa) misses the lookup and the row's shanten /
    // tile-acceptance disappear.
    if (/^5[mps]r$/.test(s.tile)) statMap[s.tile.slice(0, -1)] = s;
    else if (/^5[mps]$/.test(s.tile)) statMap[s.tile + "r"] = s;
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
    ? (statMap[m.best_discard] || statMap[tileBase(m.best_discard)])
    : null;
  const actualStat = actualTile
    ? (statMap[actualTile] || statMap[tileBase(actualTile)])
    : null;
  const expectedStat = expectedTile
    ? (statMap[expectedTile] || statMap[tileBase(expectedTile)])
    : null;
  const tiesSpeed = (s) => s && speedStat
    && s.shanten === speedStat.shanten
    && s.necessary_count === speedStat.necessary_count;
  const speedAbsorbedByActual = tiesSpeed(actualStat);
  const speedAbsorbedByExpected = tiesSpeed(expectedStat);
  if (SHOW_SPEED_ROW && m.best_discard && !speedAbsorbedByActual && !speedAbsorbedByExpected) {
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
  // (P1-P4, legacy 1A/2A/3A) and Defense categories (D1-D3, OD1-OD3). The
  // delta view keeps the row compact enough that it no longer clutters the
  // defense cards (the original reason it was hidden), so it earns its place
  // back as a quick read on what acceptance the safe discard gives up.
  const cat = m.category || "";
  const ukeireDefaultShown = cat.startsWith("P") || cat.startsWith("D") || cat.startsWith("OD")
    || cat === "1A" || cat === "2A" || cat === "3A";
  const ukeireHiddenClass = ukeireDefaultShown ? "" : " ukeire-hidden";

  // Pre-compute diff across the important picks (You / AI / Speed) that have
  // ukeire data. With 2+ rows we render the design-2 diff view (common bar
  // + per-row gains); a single-row case falls back to the legacy full row.
  const diffSource = [];
  for (const t of tiles) {
    const ca = statMap[t] || statMap[tileBase(t)];
    const isImportant = t === actualTile || t === expectedTile || t === m.best_discard;
    if (isImportant && ca && ca.necessary_tiles && ca.necessary_tiles.length) {
      diffSource.push({ tile: t, ca });
    }
  }
  // Tile-acceptance diff view: shown whenever 2+ important picks have ukeire
  // data, regardless of whether the picks sit at the same shanten. The diff's
  // compact "+N gains / N shared" framing reads fine across shanten — and the
  // Shanten row right below makes any shanten gap explicit, so there's no need
  // to suppress the comparison. (We used to retire it on a shanten mismatch;
  // the diff framing unclutters enough that it earns its place back.)
  const diffEnabled = diffSource.length >= 2;
  const diff = diffEnabled ? computeUkeireDiff(diffSource.map(d => d.ca)) : null;
  const diffByTile = {};
  if (diff) diff.perRow.forEach((r, i) => { diffByTile[diffSource[i].tile] = r; });

  // Always give a container ID so switchThreatView can re-render in place.
  const containerId = options.containerId || _registerEvContainer(m, options);
  const modeClass = diffEnabled ? " ukeire-mode-diff" : "";
  let html = `<div class="ev-comparison${ukeireHiddenClass}${modeClass}" id="${containerId}" data-threat-view="${activeView}">`;
  // Acceptance toolbar: the Hide/Show toggle always applies. The "Show all
  // ukeire" diff switch only appears when the diff view is active — never when
  // shanten diverges, since diffEnabled is false there.
  html += `<div class="ukeire-toolbar">`;
  html += `<button type="button" class="ukeire-toggle" data-action="toggleUkeire">`;
  html += ukeireDefaultShown ? "Hide tile acceptance" : "Show tile acceptance";
  html += `</button>`;
  if (diffEnabled) {
    html += `<span class="ukeire-mode-switch" data-action="toggleUkeireMode" role="switch" aria-checked="false" tabindex="0">`;
    html += `<span class="sw"></span><span class="sw-label">Show all ukeire</span>`;
    html += `</span>`;
  }
  html += `</div>`;

  // Multi-threat pill toggle — only shown with 2+ simultaneous threats (any
  // mix of riichi and open-defense opponents). Each pill re-renders this
  // ev-comparison with a different threat view.
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
      + ` data-action="switchThreatView" data-container-id="${containerId}" data-view="combined">Combined</button>`;
    m.per_threat.forEach((pt, i) => {
      const active = activeView === i ? " active" : "";
      const title = pt.kind === "open"
        ? `Open hand — ${pt.open_melds || 0} call${pt.open_melds === 1 ? "" : "s"}`
        : `Riichi tile: ${pt.riichi_tile || '?'}`;
      html += `<button type="button" class="threat-pill${active}"`
        + ` data-action="switchThreatView" data-container-id="${containerId}" data-view="${i}"`
        + ` title="${title}">`
        + `vs ${seatWindFor(pt.seat)}</button>`;
    });
    html += `</div>`;
  }

  // Transposed layout: each shown pick (You / AI) becomes a COLUMN; the
  // attributes (acceptance, EV, shanten, deal-in, type, waits) become rows.
  // Order columns You-then-AI so the left→right read matches the
  // "played → AI" arrow in the card header. Any extra picks (e.g. Speed,
  // when SHOW_SPEED_ROW is on) trail after in their q-sorted order.
  const colTiles = [...tiles].sort((a, b) => {
    const rank = (t) => t === actualTile ? 0 : t === expectedTile ? 1 : 2;
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return tiles.indexOf(a) - tiles.indexOf(b);
  });

  // Build one descriptor per column up front, then emit the attribute rows
  // by reading across the descriptors. Keeps the per-tile cell logic in one
  // place and the row emission a simple map.
  const cols = colTiles.map(tile => {
    const ma = mortalMap[tile];
    const ca = statMap[tile] || statMap[tileBase(tile)];
    const isActual = actualTile === tile;
    const isExpected = expectedTile === tile;
    const isBestDiscard = m.best_discard === tile;

    let colClass = "ev-col";
    if (isActual) colClass += " col-actual";
    else if (isExpected) colClass += " col-expected";

    const markers = [];
    if (isActual) markers.push('<span class="marker played">You</span>');
    if (isExpected) markers.push('<span class="marker ai">AI</span>');
    const showSpeedMarker = SHOW_SPEED_ROW && (isBestDiscard
      || (isActual && speedAbsorbedByActual)
      || (isExpected && speedAbsorbedByExpected));
    if (showSpeedMarker) markers.push('<span class="marker speed" title="The tile that reaches tenpai fastest (most tile acceptance, ignoring hand value and defense)">Speed</span>');

    // Tile-acceptance cell. Diff mode shows the bare "+N" this pick gains
    // over the other discards plus the unique tiles (empty when it gains
    // nothing — no "+0"). "Show all ukeire" mode swaps to the full per-row
    // acceptance list. Both versions live in the cell; CSS shows whichever
    // matches the current mode. When diff is disabled (only one pick has
    // data) the full list is the only listing.
    const hasUkeire = (isActual || isExpected || isBestDiscard)
      && ca && ca.necessary_tiles && ca.necessary_tiles.length;
    let acc = "";
    if (hasUkeire) {
      acc += `<span class="ukeire-acc full-only">`;
      acc += `<span class="ukeire-acc-total" title="Tiles that would improve your hand">${ca.necessary_count} tiles</span>`;
      acc += `<span class="ukeire-inline-tiles">${renderUkeireTiles(ca.necessary_tiles, ukeireDora)}</span>`;
      acc += `</span>`;
      if (diffEnabled) {
        const g = diffByTile[tile];
        if (g && g.gains.length > 0) {
          acc += `<span class="ukeire-acc diff-only">`;
          acc += `<span class="ukeire-gain" title="Tiles this discard accepts that the other picks don't">+${g.gainTotal}</span>`;
          acc += `<span class="ukeire-inline-tiles">${renderUkeireTiles(g.gains, ukeireDora)}</span>`;
          acc += `</span>`;
        }
      }
    }

    // Mortal EV Δ cell.
    let mortal;
    if (ma) {
      const delta = ma.q_value - bestMortalQ;
      const isBest = delta >= -0.0001;
      const qClass = isBest ? "best-val" : "";
      const display = isBest ? "0.00" : delta.toFixed(2);
      mortal = `<span class="${qClass}" title="Absolute Mortal Q: ${ma.q_value.toFixed(3)}">${display}</span>`;
    } else {
      mortal = `<span class="dim">-</span>`;
    }

    const shanten = ca ? `${ca.shanten}` : `<span class="dim">-</span>`;

    // Deal-in % + Type cells, plus the wait breakdown (only with KD data).
    let dealin = `<span class="dim">-</span>`;
    let typeCell = `<span class="dim">-</span>`;
    let dealinStyle = "";
    let dealinCls = "";
    let waits = "";
    const dealinRate = useKd ? getFieldForTile(displayDealin, tile) : null;
    if (useKd) {
      const rate = dealinRate;
      const coarseLabel = coarseSafetyLabelForTile(m, tile);
      const fineLabel = fineLabelForTile(m, tile);
      if (rate != null && coarseLabel) {
        // 0% deal-in = genuinely safe against every live wait. My fine
        // label classifier only tags strict genbutsu (tile physically in
        // opponent's discards), so it can miss tiles safe for other reasons
        // (dead wait, all copies visible). Trust the deal-in rate here — if
        // it's 0, call it Safe no matter what the label says.
        // Safe cells keep the bold-green class; everything else gets a smooth
        // HSL gradient driven by the deal-in rate itself — 0% → green,
        // ~7.5% → yellow, 15%+ → red — anchored on the observed DB
        // distribution across our defense rows.
        const isSafe = rate === 0 || coarseLabel === "genbutsu" || fineLabel === "genbutsu";
        const gradientColor = isSafe ? null : dealinColor(rate);
        dealinCls = isSafe ? "dealin-genbutsu dealin-cell" : "dealin-cell";
        dealinStyle = gradientColor ? ` style="color:${gradientColor}"` : "";
        dealin = `<span class="${dealinCls}"${dealinStyle}>${rate.toFixed(1)}%</span>`;
        const display = isSafe ? "Safe" : (fineLabel || dealinLabelText(coarseLabel));
        typeCell = `<span class="${dealinCls}"${dealinStyle}>${display}</span>`;
      }
      if (displayBreakdowns) {
        // KD wait breakdown: which opponent wait shapes contribute to this
        // tile's deal-in rate. Mirrors mjai's dealin-rate detail panel.
        const w = getFieldForTile(displayBreakdowns, tile);
        if (Array.isArray(w) && w.length) {
          const suji = sujiStatusForTile(tile, displaySujiPartners);
          const sujiBadge = suji
            ? `<span class="waits-suji-badge waits-suji-${suji.kind === "half-suji" ? "half" : "full"}" title="${suji.kind === "half-suji" ? "Only one of the two suji partners has been discarded — partial protection." : "Suji partner is in the opponent's discard pool."}">`
              + `<span class="waits-suji-label">${suji.kind === "half-suji" ? "Half-suji" : "Suji"}</span>`
              + suji.tiles.map(t => renderTile(t, "tile-sm waits-tile-img")).join("")
              + `</span>`
            : "";
          waits = `<span class="waits-row-list">${sujiBadge}${renderWaitBreakdown(w)}</span>`;
        }
      }
    }

    const shantenVal = ca && ca.shanten != null ? ca.shanten : null;

    // Feature-summary inputs (rendered into the bottom Summary row). Each is
    // computed independently of the others — unlike the categorizer, which
    // short-circuits on a shanten > ukeire > dora precedence, the summary
    // always evaluates every feature so the full picture is visible.
    const ukeireCount = ca && ca.necessary_count != null ? ca.necessary_count : null;
    const discardIsDora = isDoraTile(tile);
    // A necessary tile yields a dora if its base sits in the indicator-dora set
    // (every copy counts) OR it's a five with a live red copy still drawable
    // (aka_count — only the red copies count). Without the aka_count branch a
    // wait that accepts e.g. a red 5m/5s but no indicator-dora was dropped.
    const indicatorDora = (nt) => ukeireDora.has(tileBase(nt.tile));
    // Source from this pick's *gains* (tiles the other picks don't accept) when
    // the diff is active — a dora both picks accept is shared, not a reason to
    // prefer this pick, so it shouldn't surface as "+dora accept". Falls back to
    // the full wait when there's no diff (single-pick view).
    const doraSource = (diffEnabled && diffByTile[tile])
      ? diffByTile[tile].gains
      : (ca && ca.necessary_tiles) || [];
    const doraWaitEntries = doraSource
      .filter(nt => indicatorDora(nt) || (nt.aka_count || 0) > 0);
    const doraWaitCount = doraWaitEntries.reduce((s, nt) =>
      s + (indicatorDora(nt) ? (nt.count || 0) : (nt.aka_count || 0)), 0);
    // For the pill display, a non-indicator-dora five contributes only its red
    // copies — clamp count to aka_count so renderUkeireTiles drops the plain
    // (non-dora) chip and shows just the red one. Indicator dora keeps every copy.
    const doraWaitDisplay = doraWaitEntries.map(nt =>
      indicatorDora(nt) ? nt : { ...nt, count: nt.aka_count || 0 });

    return { tile, colClass, markers, acc, mortal, shanten, shantenVal, dealin, typeCell, waits,
             ukeireCount, discardIsDora, doraWaitEntries, doraWaitDisplay, doraWaitCount, dealinRate };
  });

  // Feature-summary pills. For each column, compare its feature values against
  // the best value among the OTHER columns and emit a pill for every dimension
  // where this pick wins (or, for shanten, loses). Positive dimensions:
  // ukeire, dora kept, dora acceptance, safety. The lone negative: shanten.
  const featPill = (kind, label, title, tilesHtml = "") =>
    `<span class="feat-pill feat-pill-${kind}" title="${title}">`
    + `<span class="feat-pill-label">${label}</span>`
    + (tilesHtml ? `<span class="feat-pill-tiles">${tilesHtml}</span>` : "")
    + `</span>`;

  const featCells = cols.map((col, i) => {
    const others = cols.filter((_, j) => j !== i);
    const pills = [];

    // -shanten (negative): this pick sits at a worse (higher) shanten than the
    // best other pick.
    if (col.shantenVal != null) {
      const os = others.map(o => o.shantenVal).filter(v => v != null);
      if (os.length) {
        const best = Math.min(...os);
        if (col.shantenVal > best) {
          pills.push(featPill("neg", `+${col.shantenVal - best} shanten`,
            "Sits at a worse (higher) shanten than the other pick"));
        }
      }
    }

    // +ukeire: accepts more tiles than the other pick.
    if (col.ukeireCount != null) {
      const os = others.map(o => o.ukeireCount).filter(v => v != null);
      if (os.length) {
        const best = Math.max(...os);
        if (col.ukeireCount > best) {
          pills.push(featPill("pos", `+${col.ukeireCount - best} ukeire`,
            "Accepts more tiles than the other pick"));
        }
      }
    }

    // +dora: keeps a dora the other pick throws away. The kept dora is the
    // other pick's discarded tile — show it in the pill.
    if (!col.discardIsDora) {
      const thrown = [...new Set(others.filter(o => o.discardIsDora).map(o => o.tile))];
      if (thrown.length) {
        const tilesHtml = thrown.map(t => renderTile(t, "tile-sm ukeire-tile-img dora-highlight")).join("");
        pills.push(featPill("pos", "+dora", "Keeps a dora the other pick discards", tilesHtml));
      }
    }

    // +dora acceptance: its wait accepts more live dora than the other pick —
    // show the dora tiles its wait keeps.
    if (col.doraWaitCount > 0) {
      const best = Math.max(0, ...others.map(o => o.doraWaitCount || 0));
      if (col.doraWaitCount > best) {
        pills.push(featPill("pos", "+dora accept",
          "Its wait accepts more live dora than the other pick",
          renderUkeireTiles(col.doraWaitDisplay, ukeireDora)));
      }
    }

    // +safety: deals in less often than the other pick (KD threat data only).
    if (useKd && col.dealinRate != null) {
      const os = others.map(o => o.dealinRate).filter(v => v != null);
      if (os.length) {
        const worst = Math.max(...os);
        if (col.dealinRate < worst) {
          pills.push(featPill("pos", "+safety",
            `Deals in ${(worst - col.dealinRate).toFixed(1)}% less often than the other pick`));
        }
      }
    }

    return pills.join("");
  });
  const anyFeat = featCells.some(s => s);

  // "(N shared)" rides along on the acceptance row's label — only meaningful,
  // and only shown, in diff mode.
  const sharedNote = diffEnabled
    ? `<span class="ukeire-shared-count diff-only"> (${diff.commonTotal} shared)</span>`
    : "";
  // Shanten now rides as a pill to the left of each discard glyph in the
  // header (always shown). Its colour is a grey→gold gradient keyed on the
  // shanten value (see shantenPillStyle) — closer to tenpai reads more gold.

  // Each attribute is a row; cells read across the column descriptors. The
  // first cell is the axis label. Rows that carry no data for the current
  // category are omitted (deal-in / type / waits only with KD threats).
  const rowFor = (label, labelAttrs, cls, pick) => {
    let r = `<tr class="${cls}">`;
    r += `<th class="ev-axis"${labelAttrs || ""}>${label}</th>`;
    for (const c of cols) r += `<td class="${c.colClass}">${pick(c)}</td>`;
    r += `</tr>`;
    return r;
  };

  html += `<table class="ev-table ev-table-cols">`;
  // Header row: tile glyph + You/AI marker per column.
  html += `<thead><tr><th class="ev-axis"></th>`;
  for (const c of cols) {
    const tenpai = c.shantenVal === 0;
    const pillText = tenpai ? "tenpai" : `${c.shantenVal}-shanten`;
    const pillTitle = tenpai ? "Tenpai" : `${c.shantenVal}-shanten`;
    const pill = c.shantenVal != null
      ? `<span class="shanten-pill" style="${shantenPillStyle(c.shantenVal)}" title="${pillTitle}">${pillText}</span>`
      : "";
    html += `<th class="${c.colClass} ev-col-head"><span class="tile-cell">${pill}${renderTile(c.tile, "ev-tile")} ${c.markers.join("")}</span></th>`;
  }
  html += `</tr></thead><tbody>`;

  html += rowFor(
    `Tile acceptance${sharedNote}`,
    ` title="Tiles that would improve your hand. Diff view shows only what this discard gains over the others; flip &quot;Show all ukeire&quot; for the full list."`,
    "ukeire-col ukeire-acc-row",
    c => `<div class="ukeire-acc-cell">${c.acc}</div>`,
  );
  // Mortal EV Δ is intentionally omitted here — the mistake card's top row
  // already shows the EV loss, so a per-pick EV row just repeats it. (The
  // per-column `c.mortal` is still computed in case it's needed elsewhere.)
  if (useKd) {
    // Single Deal-in row: the rate on top, the wait breakdown stacked beneath
    // it per column. The "Type" row is hidden for now (c.typeCell still
    // computed in case it's wanted back).
    html += rowFor(
      "Deal-in",
      ` title="Probability this tile deals in — aggregated across all riichi threats — with the contributing wait shapes beneath."`,
      "dealin-col",
      c => {
        let s = `<div class="dealin-stack">`;
        s += `<div class="dealin-rate-line">${c.dealin}</div>`;
        if (c.waits) s += `<div class="dealin-waits-line">${c.waits}</div>`;
        s += `</div>`;
        return s;
      },
    );
  }

  // Feature summary: a final row of pills per pick summarising every dimension
  // we gather — ukeire, dora kept, dora acceptance, safety (all positive) plus
  // shanten (the lone negative). Shown only when at least one pick has a pill.
  if (anyFeat) {
    html += `<tr class="feat-summary-row">`;
    html += `<th class="ev-axis" title="Every feature this pick wins (or, for shanten, loses) versus the other pick.">Summary</th>`;
    for (let i = 0; i < cols.length; i++) {
      const inner = featCells[i] || `<span class="dim">—</span>`;
      html += `<td class="${cols[i].colClass}"><div class="feat-pills">${inner}</div></td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}

function getFieldForTile(dict, tile) {
  if (!dict) return null;
  if (dict[tile] != null) return dict[tile];
  const normalized = tileBase(tile);
  if (normalized !== tile && dict[normalized] != null) return dict[normalized];
  if (tile && tile.match(/^5[mps]$/)) {
    const red = tile + "r";
    if (dict[red] != null) return dict[red];
  }
  return null;
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

// "Show all ukeire" switch: flip between the diff view (common bar + per-row
// gains) and the legacy full per-row acceptance. Both versions of each row
// are in the DOM; CSS shows whichever matches the current mode.
function toggleUkeireMode(el) {
  const wrap = el.closest(".ev-comparison");
  if (!wrap) return;
  const inDiffMode = wrap.classList.toggle("ukeire-mode-diff");
  el.setAttribute("aria-checked", String(!inDiffMode));
  el.classList.toggle("on", !inDiffMode);
}

// Diff helper: given the per-tile-acceptance objects for the important picks,
// compute the tiles every row shares (the "common" set, counts from row 0)
// and each row's gains (its accepted tiles not in the common set).
// Caller passes ca objects: { tile, necessary_count, necessary_tiles[{tile,count}] }
function computeUkeireDiff(rows) {
  const sets = rows.map(r => new Set(r.necessary_tiles.map(t => tileBase(t.tile))));
  const commonBases = [...sets[0]].filter(c => sets.every(s => s.has(c)));
  const commonBaseSet = new Set(commonBases);
  // Common counts taken from the first row's entries (red fives collapse to
  // their base when forming the set, but we keep the original entry for
  // rendering so the chip shows the right SVG).
  const baseMap = {};
  for (const t of rows[0].necessary_tiles) {
    const base = tileBase(t.tile);
    if (commonBaseSet.has(base) && baseMap[base] == null) baseMap[base] = t;
  }
  const common = commonBases
    .map(b => baseMap[b])
    .filter(Boolean);
  const commonTotal = common.reduce((s, t) => s + t.count, 0);
  const perRow = rows.map(r => {
    const gains = r.necessary_tiles.filter(t => !commonBaseSet.has(tileBase(t.tile)));
    const gainTotal = gains.reduce((s, t) => s + t.count, 0);
    return { gains, gainTotal };
  });
  return { common, commonTotal, perRow };
}
