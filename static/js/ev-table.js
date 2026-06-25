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

// Hover text for soft-safe (`Safe*`) cells. Mirrors board-discards.js: the
// tile's 0% deal-in is a behavioural tsumogiri-extended-genbutsu read (it
// passed while an open opp's wait was frozen), not a rules-guaranteed safe
// tile — so we mark it `Safe*` and suppress the deal-in equation entirely.
const SOFT_SAFE_TITLE = "Safe* · passed while their wait was frozen "
  + "(a competent opp would have ronned a winning tile) — "
  + "behavioural, not a guaranteed safe tile";
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
  // Keep the ambient active-dora set armed for the EV table's own renderTile()
  // and renderUkeireTiles() calls (the card renderer sets it too; this makes the
  // table self-sufficient if reached standalone).
  setActiveDora(ukeireDora);
  // The per-tile dora / yakuhai / shanten / deal-in comparisons that used to be
  // recomputed here now live in the shared comparator (compare-dimensions.js);
  // the feature pills below read its win-vector. See renderWinPill.
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
          collapsed += `<span class="ukeire-inline-tiles">${renderUkeireTiles(g.gains)}</span>`;
        }
        collapsed += `</span>`;
        let expanded = `<span class="ukeire-acc ukeire-expanded">`;
        expanded += pill(ca.necessary_count, "◂", "true",
          "Collapse back to shared tiles + gains");
        expanded += `<span class="ukeire-inline-tiles">${renderUkeireTiles(ca.necessary_tiles)}</span>`;
        expanded += `</span>`;
        acc = collapsed + expanded;
      } else {
        acc += `<span class="ukeire-acc">`;
        acc += `<span class="ukeire-acc-total" title="Tiles that would improve your hand">${ca.necessary_count} tiles</span>`;
        acc += `<span class="ukeire-inline-tiles">${renderUkeireTiles(ca.necessary_tiles)}</span>`;
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
    let isSoftSafe = false;
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
        // Soft-safe: dealin-0 only by the behavioural tsumogiri-extended-genbutsu
        // read (the tile passed an open opp while their wait was frozen), not a
        // rules-guaranteed safe tile. Mark "Safe*" so it reads distinctly from
        // hard genbutsu — but only when genbutsu isn't already covering it.
        isSoftSafe = isSafe && coarseLabel !== "genbutsu"
          && fineLabel !== "genbutsu" && softSafeForTile(m, tile);
        const gradientColor = isSafe ? null : dealinColor(rate);
        dealinCls = isSafe ? "dealin-genbutsu dealin-cell" : "dealin-cell";
        dealinStyle = gradientColor ? ` style="color:${gradientColor}"` : "";
        // Soft-safe cells read "Safe*" (with the behavioural-safety tooltip)
        // instead of "0.0%" — the wait equation is suppressed downstream too.
        const dealinText = isSoftSafe ? "Safe*" : `${rate.toFixed(1)}%`;
        const dealinTitle = isSoftSafe ? ` title="${SOFT_SAFE_TITLE}"` : "";
        dealin = `<span class="${dealinCls}"${dealinStyle}${dealinTitle}>${dealinText}</span>`;
        const display = isSoftSafe ? "Safe*"
          : (isSafe ? "Safe" : (fineLabel || dealinLabelText(coarseLabel)));
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
        // Soft-safe vs THIS threat: the 0% comes from the behavioural
        // tsumogiri-extended-genbutsu read, not a guaranteed safe tile.
        softSafe: Array.isArray(pt.soft_safe)
          && pt.soft_safe.some(s => tileBase(s) === tileBase(tile)),
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

    // Per-column point scoring for EVERY tenpai pick — not just reach
    // decisions. The reach side of a 5A/5B scores a declared riichi (with the
    // ippatsu/ura tail); every other tenpai column scores a silent dama, which
    // for an attack/defense pick is exactly its win value. Only tenpai columns
    // score: a tenpai hand's ukeire IS its wait, so we feed ca.necessary_tiles
    // straight in. A column that broke tenpai has no winning hand and stays
    // empty. evalDiscardScores folds in any called melds, so an OPEN tenpai
    // scores its full open-hand value too.
    const scoreIsRiichi = reachRole === "riichi";
    let scoreGroups = null;
    if (shantenVal === 0
        && ca && ca.necessary_tiles && ca.necessary_tiles.length
        && typeof evalDiscardScores === "function") {
      scoreGroups = evalDiscardScores(m, tile, ca.necessary_tiles, scoreIsRiichi);
    }

    return { tile, side: spec.side, colClass, markers, reachRole, scoreGroups, scoreIsRiichi,
             acc, mortal, shanten, shantenVal, dealin, typeCell, waits, threatLines, isSoftSafe };
  });

  // Feature-summary pills. The win-vector is now computed once by the shared
  // comparator (static/js/compare-dimensions.js) — the SAME array the
  // categorizer's `shape` derives from — so the pills and the category can no
  // longer drift. Each winning dimension renders a green pill on its winner's
  // column (winner "you" → the played/actual column, "mortal" → the AI/expected
  // column). The lone behavioural change vs the old per-column loop: a
  // cross-shanten ukeire "gain" is `suppressed` and shown as a neutral context
  // pill ("wider, a step slower") instead of a green +ukeire — the old loop
  // fired +ukeire with no shanten gate, which this fixes.
  // A winning pill is tinted by its group's colour (the shared scheme in
  // compare-dimensions.GROUP_META: Efficiency=blue, Yaku=green, Value=gold,
  // Defense=pink). `grpColor` swaps the green `feat-pill-pos` chrome for the
  // group-tinted `feat-pill-grp` (driven by the `--feat-grp` custom property).
  // The suppressed context pill passes no colour and keeps its muted chrome.
  const featPill = (kind, label, title, tilesHtml = "", grpColor = "") =>
    `<span class="feat-pill ${grpColor ? "feat-pill-grp" : "feat-pill-" + kind}" title="${title}"${grpColor ? ` style="--feat-grp:${grpColor}"` : ""}>`
    + `<span class="feat-pill-label">${label}</span>`
    + (tilesHtml ? `<span class="feat-pill-tiles">${tilesHtml}</span>` : "")
    + `</span>`;

  const groupColors = (typeof haipaiCompareDimensions !== "undefined"
    && haipaiCompareDimensions.GROUP_META) || {};

  const renderWinPill = (w) => {
    const c = (groupColors[w.group] || {}).color || "";
    switch (w.dim) {
      case "shanten":
        return featPill("pos", `-${w.magnitude} shanten`,
          "Reaches tenpai sooner (lower shanten) than the other pick", "", c);
      case "ukeire":
        return w.suppressed
          ? featPill("context", w.context || "wider, a step slower",
              "Accepts more tiles, but at a worse shanten — a wide-but-slow shape, not a speed win")
          : featPill("pos", `+${w.magnitude} ukeire`,
              "Accepts more tiles than the other pick", "", c);
      case "yakuhai_kept":
        return featPill("pos", "+yakuhai",
          "Keeps a yakuhai (value honor) the other pick discards",
          (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
      case "dora_kept":
        return featPill("pos", "+dora", "Keeps a dora the other pick discards",
          (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img dora-highlight")).join(""), c);
      case "dora_acceptance":
        return featPill("pos", "+dora accept",
          "Its wait accepts more live dora than the other pick",
          (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img dora-highlight")).join(""), c);
      case "deal_in":
        return w.seat != null
          ? featPill("pos", `-${w.pct.toFixed(1)}% deal-in ${seatWindShort(w.seat)}`,
              `Deals in ${w.pct.toFixed(1)}% less often than the other pick against ${seatWindFor(w.seat)}`, "", c)
          : featPill("pos", `-${w.pct.toFixed(1)}% deal-in`,
              `Deals in ${w.pct.toFixed(1)}% less often than the other pick`, "", c);
      default:
        return "";
    }
  };

  const wins = (typeof haipaiCompareDimensions !== "undefined")
    ? haipaiCompareDimensions.compareDimensions(m) : [];
  const sideForWinner = (w) =>
    w.winner === "you" ? "actual" : w.winner === "mortal" ? "expected" : null;
  const featCells = cols.map((col) => wins
    .filter(w => col.side === sideForWinner(w))
    .map(renderWinPill).join(""));
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

  // Value and Tile acceptance share ONE row: each pick renders whichever suits
  // its shanten. A tenpai pick shows its point-value cell — that cell already
  // lists the wait tiles, so a separate acceptance cell would just repeat them
  // (the reach side of a 5A/5B scores a declared riichi with the ippatsu/ura
  // tail; every other tenpai pick a silent dama / its open-hand value). A pick
  // still short of tenpai shows its tile-acceptance cell instead, keeping the
  // "N shared" expand pill — which belongs only on acceptance cells, never on a
  // value cell. The row label adapts to whichever mix the card carries.
  const isScored = c => c.scoreGroups && c.scoreGroups.length;
  const anyScore = cols.some(isScored);
  const anyAcc = cols.some(c => !isScored(c) && c.acc);
  const valueLabel = anyScore ? (anyAcc ? "Value / acceptance" : "Value") : "Tile acceptance";
  const valueTitle = anyScore
    ? ` title="Tenpai picks show their win value and waits; a pick still short of tenpai shows its tile acceptance instead — its “N shared” pill is the tiles every pick accepts, the “+N” the extra it alone accepts."`
    : ` title="Each cell's “N shared” pill is the tiles every pick accepts; the “+N” beside it is the extra tiles that pick alone accepts. Click the pill to expand the full list."`;
  html += rowFor(
    valueLabel,
    valueTitle,
    "ukeire-col ukeire-acc-row score-col",
    c => isScored(c)
      ? `<div class="rsc-cell">${renderRiichiScoreCell(c.scoreGroups, c.scoreIsRiichi)}</div>`
      : `<div class="ukeire-acc-cell">${c.acc}</div>`,
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
            const rateText = tl.rate == null ? "&ndash;"
              : (tl.rate === 0 ? (tl.softSafe ? "Safe*" : "Safe") : `${tl.rate.toFixed(1)}%`);
            // Soft-safe vs this threat: the 0% is behavioural (its wait was
            // frozen), so we suppress the wait-shape equation and just mark the
            // line Safe* with the explanatory tooltip.
            const rateTitle = tl.softSafe ? ` title="${SOFT_SAFE_TITLE}"` : "";
            const waitsCell = tl.softSafe
              ? `<span class="dealin-threat-none" title="${SOFT_SAFE_TITLE}">wait frozen</span>`
              : (tl.waits || `<span class="dealin-threat-none">no live wait</span>`);
            s += `<div class="dealin-threat-line">`
              +    `<span class="dealin-threat-seat threat-${tl.kind}" title="Deal-in against the ${seatWindFor(tl.seat)} opponent">${tl.wind}</span>`
              +    `<span class="waits-row-list dealin-threat-waits">${waitsCell}</span>`
              +    `<span class="${rateCls}"${rateStyle}${rateTitle}>${rateText}</span>`
              +  `</div>`;
          }
          s += `<div class="dealin-threat-total">`
            +    `<span class="dealin-threat-total-label">all threats</span>`
            +    `<span class="dealin-sum-eq">=</span>`
            +    c.dealin
            +  `</div></div>`;
          return s;
        }
        // Soft-safe (single threat): the 0% is behavioural — the tile passed
        // while the open opp's wait was frozen — not a live-wait calculation.
        // Skip the wait equation and show just the Safe* mark (c.dealin already
        // carries the "Safe*" text and the explanatory tooltip).
        if (c.isSoftSafe) {
          return `<div class="dealin-stack"><div class="dealin-rate-line">${c.dealin}</div></div>`;
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
