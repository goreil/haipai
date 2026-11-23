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
// value, rather than a 3-state gold/grey/red split. Tenpai (0) lands on
// gold/orange; each higher shanten steps further toward neutral grey. Raises get no special (red) treatment anymore —
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
  // Gold end (t=0): text #ffcb80, bg orange@0.12, border orange@0.5.
  // Grey end (t=1): text --text-dim #8892a4, bg white@.08.
  const tr = lerp(255, 136), tg = lerp(203, 146), tb = lerp(128, 164); // text
  const br = lerp(255, 255), bg = lerp(165, 255), bb = lerp(0, 255);   // fill/border hue
  const fillA = (0.12 + (0.08 - 0.12) * t).toFixed(3);
  const lineA = (0.5 + (0.18 - 0.5) * t).toFixed(3);
  return `color:rgb(${tr},${tg},${tb});`
    + `background:rgba(${br},${bg},${bb},${fillA});`
    + `border:1px solid rgba(${br},${bg},${bb},${lineA});`;
}

// Shares describe weighted Value outcomes, not the chance of winning the hand.
function scoredSharePercent(share) {
  const pct = Math.round(1000 * share) / 10;
  return pct === 0 && share > 0 ? "&lt;0.1%" : pct === 100 && share < 1 ? "&gt;99.9%" : `${pct}%`;
}

// A mistake can appear in more than one card on the page.
let scoreDetailId = 0;
function scoredMetric(label, value, detail) {
  if (!detail) return `<span>${label} <b>${value}</b></span>`;
  const id = `score-detail-${++scoreDetailId}`;
  return `<button type="button" class="score-metric" interestfor="${id}" popovertarget="${id}">${label} <b>${value}</b></button>`
    + `<section popover id="${id}" class="score-detail" aria-label="${label}">${detail}</section>`;
}

function finalWaitLabel(profile) {
  const { minWait, maxWait } = profile;
  return minWait === maxWait ? `${maxWait} ${maxWait === 1 ? "tile" : "tiles"}` : `${minWait}–${maxWait} tiles`;
}

function renderScoredProfile(m, discard, stat, riichi, profile) {
  if (!profile) return `<small class="dim">Value unavailable</small>`;
  const tags = Object.entries(profile.yaku).map(([name, share]) => {
    if (name === "riichi") return "";
    return `<span class="yaku-tag" title="Share of weighted Value outcomes with this yaku">${escapeHtml(name)} ${scoredSharePercent(share)}</span>`;
  }).join("");
  const math = haipaiScoredValue.calculations(m, discard, stat, riichi, profile);
  const equation = text => `<pre>${escapeHtml(text)}</pre>`;
  const tenpai = stat.shanten === 0;
  const finalWaitHint = "How many unseen tiles can win the hand."
    + (profile.minWait === profile.maxWait ? "" : " The range depends on which tile gets you to tenpai.");
  return `<div class="scored-profile">`
    + `<span class="score-metric" title="${finalWaitHint}">Final wait <b>${finalWaitLabel(profile)}</b></span>`
    + scoredMetric("Wait value", Math.round(profile.waitValue).toLocaleString(), equation(math.waitValue))
    + (tenpai ? scoredMetric("Average", `${Math.round(profile.meanPoints).toLocaleString()} pts`, equation(math.meanPoints))
      + scoredMetric("Max", `${profile.maxPoints.toLocaleString()} pts`,
        profile.maxPoints ? renderMaxScoredHand(m, discard, stat, riichi, profile) : "") : "")
    + (tags ? `<div>${tags}</div>` : "")
    + (!profile.maxPoints ? `<small class="dim">No live scoring wins</small>` : "") + `</div>`;
}

// Concrete "feature pill" for a single win-vector entry — the exact chip shown
// in the EV-table summary (e.g. "+5 ukeire", "+dora 🀋", "-12.3% deal-in").
// Shared so the game-detail trade-off boxes (game-render.js) render identical
// pills to the table. `oya` (dealer seat 0-3) is optional: when known, a
// per-seat deal-in pill carries the opponent's kyoku wind; otherwise it
// degrades to a plain % / seat name. Returns "" for a dim it can't describe.
function renderWinFeatPill(w, oya) {
  const WINDS = ["E", "S", "W", "N"];
  const _seatWind = (seat) => (oya == null) ? null : WINDS[(seat - oya + 4) % 4];
  const seatWindShort = (seat) => _seatWind(seat)
    || (typeof SEAT_NAMES !== "undefined" && SEAT_NAMES[seat] ? SEAT_NAMES[seat][0] : `${seat}`);
  const seatWindFor = (seat) => (oya == null)
    ? ((typeof SEAT_NAMES !== "undefined" && SEAT_NAMES[seat]) || `Seat ${seat}`)
    : ((typeof WIND_DISPLAY !== "undefined" && WIND_DISPLAY[_seatWind(seat)]) || _seatWind(seat));
  const groupColors = (typeof haipaiCompareDimensions !== "undefined"
    && haipaiCompareDimensions.GROUP_META) || {};
  const featPill = (kind, label, title, tilesHtml = "", grpColor = "") =>
    `<span class="feat-pill ${grpColor ? "feat-pill-grp" : "feat-pill-" + kind}" title="${title}"${grpColor ? ` style="--feat-grp:${grpColor}"` : ""}>`
    + `<span class="feat-pill-label">${label}</span>`
    + (tilesHtml ? `<span class="feat-pill-tiles">${tilesHtml}</span>` : "")
    + `</span>`;
  const c = (groupColors[w.group] || {}).color || "";
  switch (w.dim) {
    case "shanten":
      return featPill("pos", `-${w.magnitude} shanten`,
        "Reaches tenpai sooner (lower shanten) than the other pick", "", c);
    case "ukeire":
      return featPill("pos", `+${w.magnitude} ukeire`,
        "Accepts more tiles than the other pick", "", c);
    case "versatility_kept":
      return featPill("pos", "+versatility",
        "Same shanten, same ukeire — keeps the more versatile tile. Middle tiles "
          + "(3-7) form protoruns with 4 neighbouring ranks (two ryanmen), 2/8 with "
          + "3, 1/9 with 2 (never ryanmen), honors with none",
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
    case "yakuhai_kept":
      return featPill("pos", w.han === 2 ? "+double yakuhai" : "+yakuhai",
        w.han === 2
          ? "Keeps a double yakuhai wind (both seat and round wind), worth 2 han as a triplet"
          : "Keeps a yakuhai (value honor) the other pick discards",
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
    case "tanyao_kept":
      return featPill("pos", `+tanyao ${w.magnitude}/14`,
        `Cuts a terminal/honor to keep the hand all-simples — ${w.magnitude}/14 tiles toward tanyao; the other pick keeps a non-simple`, "", c);
    case "toitoi_kept":
      return featPill("pos", `+toitoi ${w.magnitude} pairs`,
        `Keeps every triplet candidate for the open toitoi — ${w.magnitude} kinds held as pairs or better; the other pick breaks a needed pair`, "", c);
    case "chiitoi_kept":
      return featPill("pos", `+chiitoi ${w.magnitude}/7`,
        `Keeps all ${w.magnitude} pairs toward seven pairs; the other pick breaks one`, "", c);
    case "chanta_kept":
      return featPill("pos", `+chanta ${w.magnitude}/14`,
        `Cuts a middle tile (4-6) to keep every block terminal-flavored — ${w.magnitude}/14 tiles toward chanta; the other pick keeps a tile no chanta block can use`, "", c);
    case "honitsu_kept": {
      const suitName = { m: "manzu", p: "pinzu", s: "souzu" }[w.suit] || "one suit";
      return featPill("pos", `+honitsu ${w.magnitude}/14`,
        `Cuts an off-suit tile to keep the hand ${suitName} plus honors — ${w.magnitude}/14 tiles toward the flush; the other pick keeps an off-suit tile`,
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
    }
    case "ittsu_kept": {
      const suitName = { m: "manzu", p: "pinzu", s: "souzu" }[w.suit] || "one suit";
      const need = (w.missing || []).map(x => `${x.tile} (${x.left} left)`).join(", ");
      return featPill("pos", `+ittsu ${w.magnitude}/9`,
        `Keeps the straight alive — ${w.magnitude}/9 distinct ranks toward 123-456-789 in ${suitName}`
          + (need ? `; still needs ${need}` : "")
          + `. The other pick throws a rank the run still needs`,
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
    }
    case "safe_spare_kept":
      return featPill("pos", "+safe tile",
        "Same shanten, same ukeire — keeps the safer spare to bail with later. "
          + "Honors/terminals, and tiles with more copies already visible, are "
          + "less likely to deal in when the hand has to fold",
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
    case "furiten_avoided":
      return featPill("pos", "avoids furiten",
        "The other pick's tenpai waits on a tile already in your own discards "
          + "(furiten) — the hand could never ron. This pick keeps a wait that can",
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img")).join(""), c);
    case "scored_value": {
      const [better, other] = w.winner === "you" ? [w.you, w.mortal] : [w.mortal, w.you];
      const yaku = w.yaku.filter(name => name !== "riichi").map(name => featPill("pos",
        `+${scoredSharePercent(better.yaku[name] - (other.yaku[name] || 0))} ${escapeHtml(name)}`,
        "Percentage-point increase in the share of weighted Value outcomes with this yaku", "", c)).join("");
      return featPill("pos", `+${w.magnitude.toLocaleString()} wait value`,
        `${Math.round(better.waitValue).toLocaleString()} − ${Math.round(other.waitValue).toLocaleString()} = ${w.magnitude.toLocaleString()}`, "", c) + yaku;
    }
    case "dora_kept":
      return featPill("pos", "+dora", "Keeps a dora the other pick discards",
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img dora-highlight")).join(""), c);
    case "dora_acceptance":
      return featPill("pos", "+dora accept",
        "Its wait accepts more live dora than the other pick",
        (w.tiles || []).map(t => renderTile(t, "tile-sm ukeire-tile-img dora-highlight")).join(""), c);
    case "deal_in": {
      // Keep the risk and wind visible; disclose the existing hand context on demand.
      const th = w.threat;
      if (th) {
        const dealer = oya != null && th.seat != null
          && (((th.seat - oya + 4) % 4) === 0);
        const seat = th.seat ?? w.seat;
        const windTag = seat != null ? ` (${seatWindShort(seat)})` : "";
        const kindWord = th.kind === "open"
          ? (th.han ? `open ${th.han}han` : "open") : "riichi";
        const ctx = `${dealer ? "dealer " : ""}${kindWord}`;
        return `<details class="feat-pill-disclosure">`
          + `<summary class="feat-pill ${c ? "feat-pill-grp" : "feat-pill-pos"}"`
          + (c ? ` style="--feat-grp:${c}"` : "")
          + ` title="Show or hide opponent details">`
          + `<span class="feat-pill-label">-${w.pct.toFixed(1)}% deal-in${windTag}</span>`
          + `<span class="feat-pill-ctx">${ctx}</span>`
          + `<span class="feat-pill-caret" aria-hidden="true">›</span></summary></details>`;
      }
      return w.seat != null
        ? featPill("pos", `-${w.pct.toFixed(1)}% deal-in (${seatWindShort(w.seat)})`,
            `Deals in ${w.pct.toFixed(1)}% less often than the other pick against ${seatWindFor(w.seat)}`, "", c)
        : featPill("pos", `-${w.pct.toFixed(1)}% deal-in`,
            `Deals in ${w.pct.toFixed(1)}% less often than the other pick`, "", c);
    }
    default:
      return "";
  }
}

function renderEvComparison(m, options) {
  options = options || {};
  const winMistake = m.actual?.type === "hora" || m.expected?.type === "hora" ? m : null;

  if (options.selectedTile) {
    // Keep the stored decision intact; only the exploratory table uses this discard.
    const expectedTile = m.expected?.pai || (m.expected?.type === "reach"
      ? m.actual?.pai || m.actual_riichi_tile : null);
    m = { ...m, actual: { type: "dahai", pai: options.selectedTile, actor: m.actual?.actor },
      expected: { ...m.expected, ...(expectedTile ? { pai: expectedTile } : {}) } };
  }
  // Each opponent gets a separate deal-in value with a persistent wind badge.
  // Expanding a value reveals only that opponent’s wait calculation.
  const ukeireDora = getDoraTiles(m.board_state);
  // Keep the ambient active-dora set armed for the EV table's own renderTile()
  // and renderUkeireTiles() calls (the card renderer sets it too; this makes the
  // table self-sufficient if reached standalone).
  setActiveDora(ukeireDora, m.board_state);
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
  const seatWind = (seat) => WINDS[(seat - (oya ?? 0) + 4) % 4];
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
  const actualTile = (winMistake?.actual?.type === "hora" ? "hora" : null)
    || (m.actual && m.actual.pai)
    || (m.actual && m.actual.type === "reach" ? m.actual_riichi_tile : (winMistake ? m.actual.type : null));
  const expectedTile = (winMistake?.expected?.type === "hora" ? "hora" : null)
    || (m.expected && m.expected.pai)
    || (m.expected && m.expected.type === "reach" ? actualTile : (winMistake ? m.expected.type : null));

  // A riichi-vs-dama comparison still needs two columns when the recommended
  // discard and the declaration tile are identical.
  const reachSameTile = actualTile && actualTile === expectedTile &&
    (m.actual.type === "reach" || m.expected.type === "reach");

  // Build a unified list of tiles from mortal top_actions and discard_stats
  const mortalMap = {};
  for (const a of m.top_actions) {
    const tile = a.action.pai || a.action.type;
    mortalMap[tile] = a;
  }

  const statMap = {};
  for (const s of m.discard_stats || []) {
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

  if (m.passed_win?.waits?.length) {
    statMap.none = { shanten: 0, necessary_tiles: m.passed_win.waits,
      necessary_count: m.passed_win.waits.reduce((sum, w) => sum + w.count, 0) };
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

  let html = `<div class="ev-comparison${winMistake ? " ev-win-comparison" : ""}">`;

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
  const colSpecs = reachSameTile || (options.selectedTile && actualTile === expectedTile)
    ? [{ tile: actualTile, side: "actual" }, { tile: expectedTile, side: "expected" }]
    : colTiles.map(tile => ({
        tile,
        side: tile === actualTile ? "actual"
            : tile === expectedTile ? "expected" : "other",
      }));

  const wins = (typeof haipaiCompareDimensions !== "undefined")
    ? haipaiCompareDimensions.compareDimensions(m).filter(w => !w.suppressed) : [];

  // Build one descriptor per column up front, then emit the attribute rows
  // by reading across the descriptors. Keeps the per-tile cell logic in one
  // place and the row emission a simple map.
  const cols = colSpecs.map(spec => {
    const tile = spec.tile;
    const isWin = !!winMistake && tile === "hora";
    const ma = mortalMap[tile];
    const ca = statMap[tile] || statMap[tileBase(tile)];
    const isActual = spec.side === "actual";
    const isExpected = spec.side === "expected";
    const isBestDiscard = m.best_discard === tile;

    let colClass = "ev-col";
    if (isActual) colClass += " col-actual";
    else if (isExpected) colClass += " col-expected";

    const markers = [];
    if (isActual) markers.push(`<span class="marker played">${options.selectedTile ? "Selected" : "You"}</span>`);
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
    let acc = winMistake && !isWin && !ca
      ? `<span class="rsc-hanfu">${isActual ? "No win taken" : "Continuation unknown"}</span>` : "";
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
    let isGenbutsu = false;
    const dealinRate = useKd ? getFieldForTile(displayDealin, tile) : null;
    if (useKd) {
      const rate = dealinRate;
      const coarseLabel = coarseSafetyLabelForTile(m, tile);
      const fineLabel = fineLabelForTile(m, tile);
      if (rate != null && coarseLabel) {
        // Zero rates keep the safe green color, including dead waits. Only
        // genbutsu gets the Safe label; calculated zeros stay numeric.
        const isSafe = rate === 0 || coarseLabel === "genbutsu" || fineLabel === "genbutsu";
        isGenbutsu = coarseLabel === "genbutsu" || fineLabel === "genbutsu";
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
        const dealinText = isGenbutsu ? "Safe" : (isSoftSafe ? "Safe*" : `${rate.toFixed(1)}%`);
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

    // Use the same per-opponent display for single and multiple threats.
    let threatLines = null;
    if (useKd && threatCount >= 1) {
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
        genbutsu: (pt.genbutsu || []).some(s => tileBase(s) === tileBase(tile)),
        // Soft-safe vs THIS threat: the 0% comes from the behavioural
        // tsumogiri-extended-genbutsu read, not a guaranteed safe tile.
        softSafe: Array.isArray(pt.soft_safe)
          && pt.soft_safe.some(s => tileBase(s) === tileBase(tile)),
        waits: renderWaitsCell(tile, pt.wait_breakdowns, pt.suji_partners),
      })).sort((a, b) => WINDS.indexOf(a.wind) - WINDS.indexOf(b.wind));
    }

    const shantenVal = ca && ca.shanten != null ? ca.shanten : null;

    const reachRole = haipaiScoredValue.reachRole(m, spec.side, shantenVal);

    // Per-column point scoring for EVERY tenpai pick — not just reach
    // decisions. The reach side of a 5A/5B scores a declared riichi (with the
    // ippatsu/ura tail); every other tenpai column scores a silent dama, which
    // for an attack/defense pick is exactly its win value. Only tenpai columns
    // score: a tenpai hand's ukeire IS its wait, so we feed ca.necessary_tiles
    // straight in. A column that broke tenpai has no winning hand and stays
    // empty. evalDiscardScores folds in any called melds, so an OPEN tenpai
    // scores its full open-hand value too.
    const scoreIsRiichi = reachRole === "riichi";
    const scoringMistake = isActual && m.passed_win
      ? { ...m, furiten_kind: m.passed_win.furiten_kind } : m;
    let scoreGroups = null;
    if (shantenVal === 0
        && ca && ca.necessary_tiles && ca.necessary_tiles.length
        && typeof evalDiscardScores === "function") {
      scoreGroups = evalDiscardScores(scoringMistake, tile, ca.necessary_tiles, scoreIsRiichi);
    }

    const winningSnapshot = winMistake;
    const winScore = isWin ? renderWinScore(winningSnapshot) : null;
    const winTile = isWin ? winningSnapshot.win_context?.tile || winningSnapshot.draw : null;
    if (isWin) {
      dealin = '<span class="dealin-genbutsu" title="Winning ends the hand">0.0%</span>';
      dealinCls = "";
      threatLines = null;
    }
    const lookahead = shantenVal === 1 && !winMistake && Array.isArray(ca.necessary_tiles)
      && (isActual ? m.actual.type === "dahai" : isExpected ? m.expected.type === "dahai" : true);
    const action = isActual ? m.actual : isExpected ? m.expected : null;
    const showProfile = !winMistake && (shantenVal === 0 || shantenVal === 1)
      && (action?.type === "dahai" || action?.type === "reach");
    // A tie has no winning dimension, and an unknown opponent is not worth
    // zero points. Still show each eligible column's own Value data.
    const profile = showProfile ? haipaiScoredValue.profile(scoringMistake, tile, ca, scoreIsRiichi) : null;
    const valueSummary = showProfile ? renderScoredProfile(scoringMistake, tile, ca, scoreIsRiichi, profile) : "";
    return { tile, isWin, winScore, winTile, side: spec.side, colClass, markers, reachRole, scoreGroups, scoreIsRiichi,
             acc, lookahead, profile, valueSummary, mortal, shanten, shantenVal, dealin, dealinCls, typeCell, waits, threatLines, isSoftSafe, isGenbutsu };
  });

  // Feature-summary pills. The win-vector is now computed once by the shared
  // comparator (static/js/compare-dimensions.js) — the SAME array the
  // categorizer's `shape` derives from — so the pills and the category can no
  // longer drift. Each winning dimension renders a green pill on its winner's
  // column (winner "you" → the played/actual column, "mortal" → the AI/expected
  // column). The lone behavioural change vs the old per-column loop: a
  // cross-shanten ukeire "gain" is `suppressed` by the comparator (never a real
  // speed win — the old loop fired +ukeire with no shanten gate) and is
  // filtered out here entirely rather than shown as a pill.
  // A winning pill is tinted by its group's colour (the shared scheme in
  // compare-dimensions.GROUP_META: Efficiency=blue, Yaku=cyan, Value=gold,
  // Defense=red). `grpColor` swaps the green `feat-pill-pos` chrome for the
  // group-tinted `feat-pill-grp` (driven by the `--feat-grp` custom property).
  // Delegate to the shared renderer (top-level renderWinFeatPill) so the table
  // and the trade-off boxes stay pixel-identical. `oya` supplies the per-seat
  // deal-in wind label.
  const renderWinPill = (w) => renderWinFeatPill(w, oya);

  const sideForWinner = (w) =>
    w.winner === "you" ? "actual" : w.winner === "mortal" ? "expected" : null;
  const pairedDraws = cols.length === 2 && cols.every(c => c.lookahead);
  const featCells = cols.map((col, i) => {
    const pills = wins.filter(w => col.side === sideForWinner(w)).map(renderWinPill).join("");
    const p = col.profile, other = pairedDraws && cols[1 - i].profile;
    if (!p || !other || (p.minWait <= other.minWait && p.maxWait <= other.maxWait)) return pills;
    const color = haipaiCompareDimensions.GROUP_META.Dora.color;
    return pills + `<span class="feat-pill feat-pill-grp" style="--feat-grp:${color}" title="Final wait compared with ${finalWaitLabel(other)}">`
      + `<span class="feat-pill-label">Final wait ${finalWaitLabel(p)}</span></span>`;
  });

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
  if (options.selectedTile) {
    html += `<caption>Exploring another discard. The mistake and trainer text still refer to your original play.</caption>`;
  }
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
    let choice = renderTile(c.tile, "ev-tile");
    if (c.isWin) {
      const winLabel = winMistake.win_context?.tsumo ? "Tsumo" : "Ron";
      choice = `<span class="action-pill action-win">${winLabel}</span>` + renderTile(c.winTile, "ev-tile");
    } else if (winMistake) {
      const action = c.side === "actual" ? m.actual : m.expected;
      if (action?.type !== "dahai") choice = renderAction(action);
    }
    html += `<th class="${c.colClass} ev-col-head"><span class="tile-cell">${pill}${reachPill}${choice} ${c.markers.join("")}</span></th>`;
  }
  html += `</tr></thead><tbody>`;

  // Keep the shared/gained tile comparison visible even when a column has
  // scored continuations. Win/pass cards describe an action, not two discards.
  if (!winMistake && cols.some(c => c.acc || c.lookahead)) {
    html += rowFor("Tile acceptance",
      ` title="Shared tiles improve every pick; +N shows the additional copies accepted by this pick. Expand shared tiles for the full list."`,
      "ukeire-col ukeire-acc-row", c => `<div class="ukeire-acc-cell">${c.acc || (c.lookahead ? "0 tiles" : "")}</div>`);
  }
  if (winMistake || cols.some(c => c.valueSummary || c.lookahead || c.scoreGroups?.length)) {
    html += rowFor("Value",
      `${pairedDraws ? ' rowspan="2"' : ''} title="Winning tiles and scores. At one shanten, select an improving draw to compare tenpai discards."`,
      "score-col", c => {
        if (winMistake) return c.winScore || c.scoreGroups?.length
          ? `<div class="rsc-cell">${c.winScore || renderRiichiScoreCell(c.scoreGroups, c.scoreIsRiichi)}</div>` : c.acc;
        if (c.lookahead) {
          if (pairedDraws) return c.valueSummary;
          return c.valueSummary + `<haipai-iishanten data-discard="${escapeHtml(c.tile)}"></haipai-iishanten>`;
        }
        return c.valueSummary + (c.scoreGroups?.length
          ? `<div class="rsc-cell">${renderRiichiScoreCell(c.scoreGroups, c.scoreIsRiichi)}</div>` : "");
      });
    if (pairedDraws) {
      html += `<tr class="value-draw-row"><td colspan="2"><haipai-iishanten class="value-draw-grid"`
        + ` data-discard="${escapeHtml(cols[0].tile)}" data-compare-discard="${escapeHtml(cols[1].tile)}">`
        + `</haipai-iishanten></td></tr>`;
    }
  }
  // Mortal EV Δ is intentionally omitted here — the mistake card's top row
  // already shows the EV loss, so a per-pick EV row just repeats it. (The
  // per-column `c.mortal` is still computed in case it's needed elsewhere.)
  if (useKd) {
    // Each opponent’s wind and rate stay visible while its calculation is closed.
    // Native details provides mouse and keyboard activation without extra state.
    html += rowFor(
      "Deal-in",
      ` title="Probability this tile deals in against each opponent. Click a percentage to show or hide its calculation."`,
      "dealin-col",
      c => {
        if (c.threatLines) {
          return `<div class="dealin-opponents">` + c.threatLines.map(tl => {
            const safe = tl.rate === 0 || tl.genbutsu;
            const rateStyle = tl.rate == null || safe ? "" : ` style="color:${dealinColor(tl.rate)}"`;
            const rateCls = "dealin-threat-rate" + (safe ? " dealin-genbutsu" : "");
            const rateText = tl.rate == null ? "&ndash;"
              : (tl.genbutsu ? "Safe" : (safe && tl.softSafe ? "Safe*" : `${tl.rate.toFixed(1)}%`));
            const rateTitle = safe && tl.softSafe && !tl.genbutsu ? ` title="${SOFT_SAFE_TITLE}"` : "";
            const value = `<span class="dealin-threat-seat threat-${tl.kind}" title="Deal-in against the ${seatWindFor(tl.seat)} opponent">${tl.wind}</span>`
              + `<span class="${rateCls}"${rateStyle}${rateTitle}>${rateText}</span>`;
            if (tl.genbutsu || (safe && tl.softSafe)) {
              return `<div class="ukeire-shared-pill dealin-total-pill dealin-safe-value">${value}</div>`;
            }
            const waitsCell = tl.waits || `<span class="dealin-safe-note">${safe
              ? "No live wait." : "No wait breakdown available."}</span>`;
            return `<details class="dealin-details">`
              + `<summary class="ukeire-shared-pill dealin-total-pill" title="Show or hide the deal-in calculation against ${seatWindFor(tl.seat)}">`
              + value
              + `<span class="dealin-details-caret" aria-hidden="true">▸</span></summary>`
              + `<div class="dealin-calculation"><span class="waits-row-list">${waitsCell}</span></div></details>`;
          }).join("") + `</div>`;
        }
        if (!c.dealinCls || c.isGenbutsu || c.isSoftSafe) return c.dealin;
        const calculation = body => `<details class="dealin-details">`
          + `<summary class="ukeire-shared-pill dealin-total-pill" title="Show or hide the deal-in calculation">`
          + c.dealin + `<span class="dealin-details-caret" aria-hidden="true">▸</span></summary>`
          + `<div class="dealin-calculation">${body}</div></details>`;
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
          s += `<div class="dealin-rate-line">${c.dealin}</div>`
            + `<span class="dealin-safe-note">No wait breakdown available.</span>`;
        }
        s += `</div>`;
        return calculation(s);
      },
    );
  }

  if (featCells.some(Boolean)) {
    html += `<tr class="feat-summary-row">`;
    html += `<th class="ev-axis" title="Each pick's advantages over the other.">Summary</th>`;
    for (let i = 0; i < cols.length; i++) {
      const pills = featCells[i] ? `<div class="feat-pills">${featCells[i]}</div>` : "";
      html += `<td class="${cols[i].colClass}">${pills || '<span class="dim">—</span>'}</td>`;
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

// Human-readable "how was this % calculated" breakdown for one wait shape,
// shown as the pill's hover title. Mirrors the KillerDucky algorithm
// (killer_mortal_gui/README.md "Dealin Rate"): raw unseen-tile combinations,
// times an ordered chain of likelihood/reading multipliers (wait.factors, set
// in prep/defense_kd.js::calcCombos), giving the weighted combos that this
// wait contributes; divided by the total weighted combos across every live
// wait against this threat gives the %.
function formatWaitTooltip(w) {
  const lines = [WAIT_TYPE_TOOLTIP[w.type] || w.type];
  const leftParts = (w.left || []).filter(n => n != null);
  const rawNote = leftParts.length > 1 ? ` (${leftParts.join(" × ")} unseen)`
    : (leftParts.length === 1 ? ` (${leftParts[0]} unseen)` : "");
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  if (w.raw != null) lines.push(`${fmt(w.raw)} raw combos${rawNote}`);
  for (const f of (w.factors || [])) {
    lines.push(`× ${fmt(f.mult)}  ${f.label}`);
  }
  if (w.weighted != null) lines.push(`= ${fmt(w.weighted)} weighted combos`);
  if (w.total != null) lines.push(`÷ ${fmt(w.total)} total combos (every live wait vs this threat)`);
  lines.push(`= ${w.rate.toFixed(2)}% deal-in for this wait`);
  return lines.join("\n");
}

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
    const tooltip = formatWaitTooltip(w);
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
