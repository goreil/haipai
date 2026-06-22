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
  // Deal-in defense always shows the combined picture: the aggregated deal-in %
  // per discard, decomposed into one row per live opponent inside the Deal-in
  // cell (see threatLines below). The old per-seat view toggle was retired once
  // that per-opponent breakdown made it redundant.
  const ukeireDora = getDoraTiles(m.board_state);
  // A tile is dora if it's a red five or sits in the active indicator-dora set.
  const isDoraTile = (t) => !!t && (/^5[mps]r$/.test(t) || ukeireDora.has(tileBase(t)));
  // A tile is a yakuhai (value honor) for the hero if it's a dragon, the round
  // wind, or the hero's seat wind. Reuse categorize.js's trigger so the pill and
  // the hand-value category stay in lockstep (it owns the yakuhai definition).
  const roundWind = (m.board_state && m.board_state.round_wind) || null;
  const heroSeatWind = (m.board_state && m.board_state.seat_wind) || null;
  const isYakuhaiTile = (t) => !!t && typeof haipaiCategorize !== "undefined"
    && haipaiCategorize.tileIsYakuhai(t, roundWind, heroSeatWind);
  const threatCount = Array.isArray(m.per_threat) ? m.per_threat.length : 0;
  const displayDealin = m.dealin_rates;
  const displayBreakdowns = m.wait_breakdowns;
  const displaySujiPartners = m.suji_partners;
  const useKd = displayDealin && Object.keys(displayDealin).length > 0;

  // Seat → kyoku-wind helpers for the per-opponent deal-in breakdown. Derive
  // oya from (hero_actor, hero_seat_wind) so a seat's wind matches what the
  // student sees in the discards view; fall back to absolute seat order if
  // unknown.
  const WINDS = ["E", "S", "W", "N"];
  const heroActor = m.actual && m.actual.actor;
  const heroWind = m.board_state && m.board_state.seat_wind;
  let oya = null;
  if (heroActor != null && heroWind) {
    const pw = WINDS.indexOf(heroWind);
    if (pw >= 0) oya = ((heroActor - pw) % 4 + 4) % 4;
  }
  const seatWind = (seat) => oya == null ? null : WINDS[(seat - oya + 4) % 4];
  const seatWindShort = (seat) => seatWind(seat)
    || (SEAT_NAMES[seat] ? SEAT_NAMES[seat][0] : `${seat}`);
  const seatWindFor = (seat) => oya == null
    ? (SEAT_NAMES[seat] || `Seat ${seat}`)
    : WIND_DISPLAY[seatWind(seat)];

  // A reach action has no pai of its own — the riichi tile is the next
  // dahai by the same player in the mjai log. For 5A the backend stores it
  // as `actual_riichi_tile`; for 5B (player silently discarded when they
  // should have reached) we use actual.pai as the tile for both rows
  // (Mortal's reach would have dropped the same tile).
  const actualTile = (m.actual && m.actual.pai)
    || (m.actual && m.actual.type === "reach" ? m.actual_riichi_tile : null);
  const expectedTile = (m.expected && m.expected.pai)
    || (m.expected && m.expected.type === "reach" ? actualTile : null);

  // Riichi-vs-dama decisions. 5A (Bad Riichi): you reached, AI says dahai.
  // 5B (Missed Riichi): you dahai'd, AI says reach. The reach side is the
  // "riichi" pick; the dahai side is "dama". `reachSide` names which column
  // (You = actual / AI = expected) declared the riichi. When both land on the
  // SAME tile (e.g. #m19830 — AI agrees on the tile but not the call) the tile
  // dedup below collapses them to one column; reachSameTile forces two columns
  // instead so the riichi-vs-dama contrast stays visible.
  const reachSide = (m.actual && m.expected)
    ? (m.actual.type === "reach" && m.expected.type === "dahai" ? "actual"
      : m.actual.type === "dahai" && m.expected.type === "reach" ? "expected"
      : null)
    : null;
  const reachSameTile = !!reachSide && !!actualTile && actualTile === expectedTile;

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

  // Tile acceptance is always shown now — the delta ("+N gains" per pick plus
  // the expandable "N shared" pill) is compact enough that it no longer clutters
  // any card, so the old per-category hide default and its toggle button are gone.

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

  let html = `<div class="ev-comparison">`;

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

  // Column specs: normally one per shown tile, tagged as the You (actual) /
  // AI (expected) / other pick. For a same-tile riichi decision we emit two
  // specs sharing the tile so You and AI each get their own column.
  const colSpecs = reachSameTile
    ? [{ tile: actualTile, side: "actual" }, { tile: expectedTile, side: "expected" }]
    : colTiles.map(tile => ({
        tile,
        side: tile === actualTile ? "actual"
            : tile === expectedTile ? "expected" : "other",
      }));

  // Build one descriptor per column up front, then emit the attribute rows
  // by reading across the descriptors. Keeps the per-tile cell logic in one
  // place and the row emission a simple map.
  const cols = colSpecs.map(spec => {
    const tile = spec.tile;
    const ma = mortalMap[tile];
    const ca = statMap[tile] || statMap[tileBase(tile)];
    const isActual = spec.side === "actual";
    const isExpected = spec.side === "expected";
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

    // Tile-acceptance cell. In diff mode (2+ picks) the cell shows only the
    // bare "+N" tiles this pick gains over the others (empty when it gains
    // nothing — no "+0"); the tiles every pick shares are lifted out into the
    // expandable "N shared" pill on the row label. When diff is disabled (only
    // one pick has data) the full acceptance list is shown instead.
    const hasUkeire = (isActual || isExpected || isBestDiscard)
      && ca && ca.necessary_tiles && ca.necessary_tiles.length;
    let acc = "";
    if (hasUkeire) {
      if (diffEnabled) {
        const g = diffByTile[tile];
        // Each acceptance cell now carries its own shared pill on the left.
        // Collapsed: "N shared ▸" + this pick's "+M" gains over the others.
        // Expanded (whole row toggles together): "T ◂" + this pick's full
        // acceptance list, where T is the pick's total ukeire count.
        const pill = (n, caret, expanded, title) =>
          `<button type="button" class="ukeire-shared-pill" data-action="toggleShared" aria-expanded="${expanded}" title="${title}">${n}<span class="ukeire-shared-caret">${caret}</span></button>`;
        let collapsed = `<span class="ukeire-acc ukeire-collapsed">`;
        collapsed += pill(`${diff.commonTotal} shared`, "▸", "false",
          "Tiles every pick accepts — click to expand this pick's full acceptance");
        if (g && g.gains.length > 0) {
          collapsed += `<span class="ukeire-gain" title="Tiles this discard accepts that the other picks don't">+${g.gainTotal}</span>`;
          collapsed += `<span class="ukeire-inline-tiles">${renderUkeireTiles(g.gains, ukeireDora)}</span>`;
        }
        collapsed += `</span>`;
        let expanded = `<span class="ukeire-acc ukeire-expanded">`;
        expanded += pill(ca.necessary_count, "◂", "true",
          "Collapse back to shared tiles + gains");
        expanded += `<span class="ukeire-inline-tiles">${renderUkeireTiles(ca.necessary_tiles, ukeireDora)}</span>`;
        expanded += `</span>`;
        acc = collapsed + expanded;
      } else {
        acc += `<span class="ukeire-acc">`;
        acc += `<span class="ukeire-acc-total" title="Tiles that would improve your hand">${ca.necessary_count} tiles</span>`;
        acc += `<span class="ukeire-inline-tiles">${renderUkeireTiles(ca.necessary_tiles, ukeireDora)}</span>`;
        acc += `</span>`;
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
        waits = renderWaitsCell(tile, displayBreakdowns, displaySujiPartners);
      }
    }

    // Multi-threat decomposition: with 2+ live opponents, break the tile's
    // deal-in into one line per opponent (seat wind + that opponent's wait
    // shapes + its deal-in %), so "defense against all" is visible at once
    // instead of only the most-dangerous threat. Single-opponent picks keep the
    // plain wait equation below.
    let threatLines = null;
    if (useKd && threatCount >= 2) {
      threatLines = m.per_threat.map(pt => ({
        seat: pt.seat,
        wind: seatWindShort(pt.seat),
        // Wind-box tint matches the discard-row danger pill for this threat:
        // riichi → red, open → amber, open with a locked-in ≥2-han floor
        // (the strong band, "open with dora") → solid amber.
        kind: pt.kind === "open"
          ? ((pt.guaranteed_han || 0) >= 2 ? "open-dora" : "open")
          : "riichi",
        rate: getFieldForTile(pt.dealin_rates, tile),
        waits: renderWaitsCell(tile, pt.wait_breakdowns, pt.suji_partners),
      })).sort((a, b) => WINDS.indexOf(a.wind) - WINDS.indexOf(b.wind));
    }

    const shantenVal = ca && ca.shanten != null ? ca.shanten : null;

    // Riichi/dama pill role (5A/5B only). The reach side is "riichi"; the other
    // side is "dama" — but only when it's genuinely tenpai, since a dahai that
    // breaks tenpai isn't a dama option to weigh against riichi.
    let reachRole = null;
    if (reachSide) {
      if (spec.side === reachSide) reachRole = "riichi";
      else if ((spec.side === "actual" || spec.side === "expected") && shantenVal === 0) reachRole = "dama";
    }

    // Per-column riichi/dama point scoring (5A/5B). The reach side scores a
    // declared riichi, the dama side a silent dama — each from its OWN discard
    // tile and waits. Only tenpai columns score: a tenpai hand's ukeire IS its
    // wait, so we feed ca.necessary_tiles straight in. A column that broke
    // tenpai has no winning hand and stays empty (reachRole is null there).
    let scoreGroups = null;
    if (reachRole && shantenVal === 0
        && ca && ca.necessary_tiles && ca.necessary_tiles.length
        && typeof evalDiscardScores === "function") {
      scoreGroups = evalDiscardScores(m, tile, ca.necessary_tiles, reachRole === "riichi");
    }

    // Feature-summary inputs (rendered into the bottom Summary row). Each is
    // computed independently of the others — unlike the categorizer, which
    // short-circuits on a shanten > ukeire > dora precedence, the summary
    // always evaluates every feature so the full picture is visible.
    const ukeireCount = ca && ca.necessary_count != null ? ca.necessary_count : null;
    const discardIsDora = isDoraTile(tile);
    const discardIsYakuhai = isYakuhaiTile(tile);
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

    return { tile, colClass, markers, reachRole, scoreGroups, acc, mortal, shanten, shantenVal, dealin, typeCell, waits,
             threatLines, ukeireCount, discardIsDora, discardIsYakuhai, doraWaitEntries, doraWaitDisplay, doraWaitCount, dealinRate };
  });

  // Feature-summary pills. For each column, compare its feature values against
  // the best value among the OTHER columns and emit a green pill for every
  // dimension where this pick wins. We only surface positive attributes per
  // column now: ukeire, dora kept, dora acceptance, lower shanten, lower deal-in.
  const featPill = (kind, label, title, tilesHtml = "", style = "") =>
    `<span class="feat-pill feat-pill-${kind}" title="${title}"${style ? ` style="${style}"` : ""}>`
    + `<span class="feat-pill-label">${label}</span>`
    + (tilesHtml ? `<span class="feat-pill-tiles">${tilesHtml}</span>` : "")
    + `</span>`;

  const featCells = cols.map((col, i) => {
    const others = cols.filter((_, j) => j !== i);
    const pills = [];

    // -shanten (positive): this pick reaches tenpai sooner (lower shanten) than
    // the best other pick. The advantage rides on the *better* side as a green
    // pill — we only surface positive attributes per column now.
    if (col.shantenVal != null) {
      const os = others.map(o => o.shantenVal).filter(v => v != null);
      if (os.length) {
        const bestOther = Math.min(...os);
        if (col.shantenVal < bestOther) {
          pills.push(featPill("pos", `-${bestOther - col.shantenVal} shanten`,
            "Reaches tenpai sooner (lower shanten) than the other pick"));
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

    // +yakuhai: keeps a yakuhai (value honor) the other pick throws away. Mirrors
    // categorize.js's yakuhaiApplies trigger (one side keeps a yakuhai while the
    // other doesn't). The kept yakuhai is the other pick's discard — show it.
    if (!col.discardIsYakuhai) {
      const thrown = [...new Set(others.filter(o => o.discardIsYakuhai).map(o => o.tile))];
      if (thrown.length) {
        const tilesHtml = thrown.map(t => renderTile(t, "tile-sm ukeire-tile-img")).join("");
        pills.push(featPill("pos", "+yakuhai", "Keeps a yakuhai (value honor) the other pick discards", tilesHtml));
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

    // -deal-in: deals in LESS often than the other pick (KD threat data only).
    // The advantage rides on the *safer* side now as a green pill — the
    // percentage-point gap under the riskiest other pick. No gradient for now;
    // plain green chrome like the other positive attributes.
    //
    // With 2+ live opponents the advantage is broken out per direction: a pick
    // can be safer against one threat yet riskier against another, and a single
    // aggregate nets those out and hides the trade-off. So we compare each
    // opponent's deal-in rate independently against the safest other pick for
    // *that same opponent*, and emit one pill — tagged with the seat wind — per
    // direction where this pick wins. Single-opponent picks keep the lone
    // aggregate pill.
    if (useKd) {
      if (threatCount >= 2 && col.threatLines) {
        for (const tl of col.threatLines) {
          if (tl.rate == null) continue;
          const os = others
            .map(o => (o.threatLines || []).find(x => x.seat === tl.seat))
            .filter(x => x && x.rate != null)
            .map(x => x.rate);
          if (!os.length) continue;
          const bestOther = Math.min(...os);
          if (tl.rate < bestOther) {
            const diff = bestOther - tl.rate;
            pills.push(featPill("pos", `-${diff.toFixed(1)}% deal-in ${tl.wind}`,
              `Deals in ${diff.toFixed(1)}% less often than the other pick against ${seatWindFor(tl.seat)}`));
          }
        }
      } else if (col.dealinRate != null) {
        const os = others.map(o => o.dealinRate).filter(v => v != null);
        if (os.length) {
          const bestOther = Math.min(...os);
          if (col.dealinRate < bestOther) {
            const diff = bestOther - col.dealinRate;
            pills.push(featPill("pos", `-${diff.toFixed(1)}% deal-in`,
              `Deals in ${diff.toFixed(1)}% less often than the other pick`));
          }
        }
      }
    }

    return pills.join("");
  });
  const anyFeat = featCells.some(s => s);

  // The tiles every pick accepts are common ground — each acceptance cell shows
  // the shared count as a pill on its left (built per-column above), expanding in
  // place to that pick's full acceptance via toggleShared. Only meaningful in
  // diff mode.
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
    const reachPill = c.reachRole === "riichi"
      ? `<span class="reach-pill reach-pill-riichi" title="Riichi declared — hand locked, +1 han plus ippatsu/ura chances">riichi</span>`
      : c.reachRole === "dama"
      ? `<span class="reach-pill reach-pill-dama" title="Dama — stay closed at tenpai without declaring riichi">dama</span>`
      : "";
    html += `<th class="${c.colClass} ev-col-head"><span class="tile-cell">${pill}${reachPill}${renderTile(c.tile, "ev-tile")} ${c.markers.join("")}</span></th>`;
  }
  html += `</tr></thead><tbody>`;

  // Riichi decisions (5A/5B) swap the tile-acceptance row for a per-column
  // point-value row: the riichi column shows the value of declaring riichi, the
  // dama column the value of staying closed — each scored from its own waits.
  // Only tenpai columns carry a score; a column that broke tenpai stays blank.
  const anyScore = !!reachSide && cols.some(c => c.scoreGroups && c.scoreGroups.length);
  if (anyScore) {
    html += rowFor(
      `Value`,
      ` title="Hand value for each call: the riichi column scores a declared riichi (with the ippatsu/ura EV tail), the dama column a silent tenpai. Only the tenpai side is scored."`,
      "score-col",
      c => c.scoreGroups
        ? `<div class="rsc-cell">${renderRiichiScoreCell(c.scoreGroups, c.reachRole === "riichi")}</div>`
        : `<span class="dim">&mdash;</span>`,
    );
  } else {
    html += rowFor(
      `Tile acceptance`,
      ` title="Each cell's “N shared” pill is the tiles every pick accepts; the “+N” beside it is the extra tiles that pick alone accepts. Click the pill to expand the full list."`,
      "ukeire-col ukeire-acc-row",
      c => `<div class="ukeire-acc-cell">${c.acc}</div>`,
    );
  }
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
        // Multi-threat combined view: one row per opponent — seat wind, that
        // opponent's wait shapes, and its own deal-in % — stacked, with the
        // aggregated total on the "=" line at the bottom. Lets the student read
        // the defense against every live threat at once.
        if (c.threatLines) {
          let s = `<div class="dealin-stack dealin-multi">`;
          for (const tl of c.threatLines) {
            const safe = tl.rate == null || tl.rate === 0;
            const rateColor = safe ? null : dealinColor(tl.rate);
            const rateStyle = rateColor ? ` style="color:${rateColor}"` : "";
            const rateCls = safe ? "dealin-threat-rate dealin-genbutsu" : "dealin-threat-rate";
            const rateText = tl.rate == null ? "&ndash;" : (tl.rate === 0 ? "Safe" : `${tl.rate.toFixed(1)}%`);
            s += `<div class="dealin-threat-line">`
              +    `<span class="dealin-threat-seat threat-${tl.kind}" title="Deal-in against the ${seatWindFor(tl.seat)} opponent">${tl.wind}</span>`
              +    `<span class="waits-row-list dealin-threat-waits">${tl.waits || `<span class="dealin-threat-none">no live wait</span>`}</span>`
              +    `<span class="${rateCls}"${rateStyle}>${rateText}</span>`
              +  `</div>`;
          }
          s += `<div class="dealin-threat-total">`
            +    `<span class="dealin-threat-total-label">all threats</span>`
            +    `<span class="dealin-sum-eq">=</span>`
            +    c.dealin
            +  `</div></div>`;
          return s;
        }
        // When wait shapes exist, render the deal-in cell as an equation:
        // the per-wait pills are addends (pill + pill + …) and the tile's total
        // deal-in rate is the sum after the "=". With no pills, fall back to the
        // bare rate (e.g. "0%" / "Safe") as before.
        let s = `<div class="dealin-stack">`;
        if (c.waits) {
          s += `<div class="dealin-waits-line">`
            +    `<span class="waits-row-list dealin-sum">`
            +      c.waits
            +      `<span class="dealin-sum-eq">=</span>`
            +      c.dealin
            +    `</span>`
            +  `</div>`;
        } else {
          s += `<div class="dealin-rate-line">${c.dealin}</div>`;
        }
        s += `</div>`;
        return s;
      },
    );
  }

  // Feature summary: a final row of pills per pick summarising every dimension
  // we gather — ukeire, dora kept, dora acceptance (positive) plus shanten and
  // deal-in (negative). Shown only when at least one pick has a pill.
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

// Render the wait-shape breakdown for a tile against one threat's data: an
// optional suji/half-suji badge followed by the per-wait pills. Returns "" when
// the tile has no live wait against that threat.
function renderWaitsCell(tile, breakdowns, sujiPartners) {
  if (!breakdowns) return "";
  const w = getFieldForTile(breakdowns, tile);
  if (!Array.isArray(w) || !w.length) return "";
  const suji = sujiStatusForTile(tile, sujiPartners);
  const sujiBadge = suji
    ? `<span class="waits-suji-badge waits-suji-${suji.kind === "half-suji" ? "half" : "full"}" title="${suji.kind === "half-suji" ? "Only one of the two suji partners has been discarded — partial protection." : "Suji partner is in the opponent's discard pool."}">`
      + `<span class="waits-suji-label">${suji.kind === "half-suji" ? "Half-suji" : "Suji"}</span>`
      + suji.tiles.map(t => renderTile(t, "tile-sm waits-tile-img")).join("")
      + `</span>`
    : "";
  return `${sujiBadge}${renderWaitBreakdown(w)}`;
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
  }).join(`<span class="dealin-sum-op">+</span>`);
}

// Expand/collapse the acceptance cells in place: collapsed shows each pick's
// "N shared" pill + its "+M" gains; expanded swaps every cell to its full ukeire
// list with a collapse caret. Toggling any cell's pill flips the whole row.
function toggleShared(btn) {
  const wrap = btn.closest(".ev-comparison");
  if (!wrap) return;
  const open = wrap.classList.toggle("shared-expanded");
  btn.setAttribute("aria-expanded", String(open));
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
