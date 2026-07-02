// Presentation layer for the game list/detail flow: sidebar list with date
// separators + ratings, game-detail render (rounds + summary tabs),
// mistake/category-group rendering, view-toggle helpers, and the
// navigate-home action that wipes the detail pane and re-renders the list.

// --- Game rating ---
// Thresholds + sevTier/sevClass/sevLabel/sevTooltip live in
// static/js/severity.js. gameRating() converts the threshold pair into the
// star icon + tooltip used in the sidebar list.

function gameRating(summary) {
  if (!summary || !summary.total_decisions) return { icon: "", label: "", cls: "" };
  const evpt = summary.ev_per_decision;
  if (evpt == null) return { icon: "", label: "", cls: "" };

  const th = computeThresholds(state.games);
  // Top 25%: excellent
  if (evpt <= th.p25) return { icon: "★", label: "One of your best", cls: "rating-excellent" };
  // Top 50%: good
  if (evpt <= th.p50) return { icon: "☆", label: "Above your average", cls: "rating-great" };
  return { icon: "", label: "", cls: "" };
}

// --- Render: Game List ---

function renderGameList() {
  const list = document.getElementById("game-list");
  const sorted = [...state.games].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  let lastDate = "";
  list.innerHTML = sorted.map(g => {
    const s = g.summary || {};
    const active = g.id === state.currentGame ? "active" : "";
    const rating = gameRating(s);
    const dateObj = new Date(g.date + "T00:00:00");
    const shortDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    let sep = "";
    if (g.date !== lastDate) {
      lastDate = g.date;
      sep = `<div class="date-separator">${shortDate}</div>`;
    }
    return `${sep}
      <div class="game-item ${active}" data-action="fetchGame" data-game-id="${g.id}">
        <div class="date"><a class="dev-id" href="#g${g.id}" data-action="openHash" title="Deep-link to this game">#g${g.id}</a>${rating.icon ? ` <span class="game-rating-icon" title="${rating.label}">${rating.icon}</span>` : ""} ${
          s.total_mistakes || 0} mistakes &middot; ${(s.total_ev_loss || 0).toFixed(2)} EV${
          s.total_decisions ? ` &middot; ${s.ev_per_decision.toFixed(4)}/D` : ""}</div>
      </div>
    `;
  }).join("");
}

// --- Render: Game Detail ---

// Group key → { label, color } for every pill the breakdown can render: the
// win-vector groups (compare-dimensions.GROUP_META) plus the category/shape
// pills the aggregator adds (haipaiConceptBreakdown.PILL_META). Merged here so
// the breakdown rows, the rounds filter banner, and the summary-bar headline all
// resolve colours the same way.
function conceptMetaMap() {
  const gm = (typeof haipaiCompareDimensions !== "undefined"
    && haipaiCompareDimensions.GROUP_META) || {};
  const pm = (typeof haipaiConceptBreakdown !== "undefined"
    && haipaiConceptBreakdown.PILL_META) || {};
  return Object.assign({}, gm, pm);
}

// The single biggest concept-GROUP leak across both ledgers — feeds the
// summary-bar headline. Groups are deduped (Dora + Dora acceptance = one Value
// hit), so this is the double-count-safe view the per-dim rows are not.
function conceptTopGroup(agg) {
  if (!agg) return null;
  const gm = conceptMetaMap();
  let best = null;
  for (const side of ["missed", "you"]) {
    for (const g of Object.values(agg.groups[side])) {
      if (!best || g.ev > best.ev) best = Object.assign({ side: side }, g);
    }
  }
  if (!best) return null;
  return Object.assign({}, best, { meta: gm[best.group] || { label: best.group, color: "var(--accent)" } });
}

// Summary-bar stat for the top concept group (only the single leader is shown).
function renderTopGroupStat(agg) {
  const tg = conceptTopGroup(agg);
  if (!tg) return "";
  const word = tg.side === "missed" ? "under-using" : "over-valuing";
  return `<div class="stat" title="Your biggest concept-group EV leak this game. Pills are rolled up by category and de-duplicated (Dora + Dora acceptance count once); you’re ${word} this group.">
    <span class="value" style="color:${tg.meta.color}">${tg.meta.label}</span>
    <span class="label">Top leak &middot; ${tg.ev.toFixed(2)} EV</span>
  </div>`;
}

// Concept-level EV ledger shown at the top of a game (see
// game-concept-breakdown.js). Two columns: concepts the AI won (you under-used
// them) and concepts you won on a losing play (you over-prioritized them). Rows
// are the deduped GROUP rollup — ukeire + shanten roll into "Efficiency", dora +
// dora acceptance into "Value" — so each group counts a mistake once. The first
// column is the group as a colour pill, then the severity split, then summed EV
// flush-right so every EV lines up in one vertical column regardless of how many
// severity chips a row has. Takes the precomputed aggregate so renderGame can reuse it for
// the summary-bar headline.
function renderConceptBreakdown(agg, boxes) {
  if (!agg || typeof haipaiCompareDimensions === "undefined") return "";

  const gm = conceptMetaMap();
  const TIER_CHIPS = [
    ["severe", "sev-major", "Severe"],
    ["mistake", "sev-medium", "Mistake"],
    ["light", "sev-light", "Light"],
    ["unsure", "sev-minor", "Unsure"],
  ];
  const tierChips = (t) => TIER_CHIPS
    .filter(([k]) => t[k])
    .map(([k, cls, lbl]) => `<span class="tier-count ${cls}" title="${lbl}">${t[k]}</span>`)
    .join("");

  // A filter is active somewhere: dim the non-selected pills so the chosen ones
  // read as the active filter rather than just more rows.
  const filtering = state.conceptFilters.length > 0;

  const ledgerHtml = (title, sub, led, side) => {
    const rows = Object.values(led).sort((a, b) => b.ev - a.ev);
    if (!rows.length) return "";
    const verb = side === "missed" ? "under-using" : "over-prioritizing";
    let h = `<div class="concept-ledger">
      <div class="concept-ledger-head">
        <span class="concept-ledger-title">${title}</span>
        <span class="concept-ledger-sub">${sub}</span>
      </div>`;
    for (const e of rows) {
      const meta = gm[e.group] || { label: e.group, color: "var(--text)" };
      const isActive = conceptFilterActive(side, e.group, null);
      const cls = "concept-pill concept-pill-btn"
        + (isActive ? " concept-pill-active" : (filtering ? " concept-pill-dim" : ""));
      // Per-dim sub-pills (Yaku → Tanyao/Yakuhai…, Value → Dora/Dora acceptance),
      // each carrying its own EV and clickable as its own narrower filter. Group
      // colour, sorted by EV. Action/shape groups (Riichi/Meld/Kan/Complex) have
      // no finer dims, so this stays empty for them.
      const subs = Object.values(e.subs || {}).sort((a, b) => b.ev - a.ev);
      const subsHtml = subs.length
        ? `<div class="concept-subs">` + subs.map((s) => {
            const subActive = conceptFilterActive(side, e.group, s.dim);
            const subCls = "concept-sub concept-sub-btn"
              + (subActive ? " concept-sub-active" : (filtering ? " concept-sub-dim" : ""));
            return `<span class="${subCls}" style="--grp:${meta.color}" role="button" tabindex="0"`
              + ` title="${subActive ? "Click to clear this filter" : `Show only rounds ${verb} ${s.label}`}"`
              + ` data-action="filterConcept" data-concept-side="${side}" data-concept-group="${e.group}" data-concept-dim="${s.dim}">`
              + `<span class="concept-sub-label">${s.label}</span>`
              + `<span class="concept-sub-ev">${s.ev.toFixed(2)}</span></span>`;
          }).join("")
          + `</div>`
        : "";
      h += `<div class="concept-row">
        <span class="${cls}" style="--grp:${meta.color}" role="button" tabindex="0"
          title="${isActive ? "Click to clear this filter" : `Show only rounds where you’re ${verb} ${meta.label}`}"
          data-action="filterConcept" data-concept-side="${side}" data-concept-group="${e.group}">${meta.label}</span>
        <span class="concept-tiers">${tierChips(e.tiers)}</span>
        <span class="concept-ev">${e.ev.toFixed(2)} EV</span>
      </div>${subsHtml}`;
    }
    return h + `</div>`;
  };

  const missed = ledgerHtml("Losing points here",
    "The better play held this edge — you’re under-using these", agg.groups.missed, "missed");
  const boxesHtml = renderTradeoffBoxes(boxes, gm);
  if (!missed && !boxesHtml) return "";
  const note = `<div class="concept-note">A single mistake can carry more than one concept, so its EV is counted toward each — these panels don’t add up to the game’s total EV loss.</div>`;
  return `<div class="concept-breakdown">${missed}${boxesHtml}${note}</div>`;
}

// The trade-off boxes that replace the old "Overvaluing these" ledger. Each box
// is one trade-off axis (Push vs. Fold / Speed vs. Value / Other) and lists the
// individual over-favoring mistakes on it: what your play favoured (left) vs what
// the better play favoured (right), the EV lost, and a jump-to-mistake button
// (reuses the #m<id> deep-link router → switches to rounds view + scrolls). See
// haipaiConceptBreakdown.tradeoffBoxes for the bucketing.
function renderTradeoffBoxes(boxes, gm) {
  if (!boxes || !boxes.length) return "";
  gm = gm || conceptMetaMap();
  const canPill = typeof renderWinFeatPill === "function";

  // An action pill (bad/missed riichi·call·kan) — the action decisions don't
  // appear in the win-vector, so they get a group-coloured chip that reads like
  // a feat-pill. `side` is "you" (Bad …) or "better" (Missed …).
  const ACT_WORD = { Riichi: "riichi", Meld: "call", Kan: "kan" };
  const actionPill = (group, side) => {
    const meta = gm[group] || { label: group, color: "var(--text)" };
    const label = (side === "you" ? "Bad " : "Missed ") + (ACT_WORD[group] || meta.label.toLowerCase());
    return `<span class="feat-pill feat-pill-grp" style="--feat-grp:${meta.color}">`
      + `<span class="feat-pill-label">${label}</span></span>`;
  };

  // One pole of a mistake row: every concrete win pill for that side (identical
  // to the EV-table summary), plus an action pill when relevant. When a pole has
  // no pills at all it falls back to the compared tile, then a dash — so a row is
  // never blank.
  const poleHtml = (wins, action, tile, oya, side) => {
    let pills = canPill ? wins.map((w) => renderWinFeatPill(w, oya)).join("") : "";
    if (action) pills += actionPill(action, side);
    if (!pills) pills = tile ? renderTile(tile, "tile-sm") : `<span class="to-pole-empty">—</span>`;
    return `<span class="to-pole to-pole-${side}">${pills}</span>`;
  };

  // Mistake tier (severe/mistake/light/unsure) → the EV colour var.
  const TIER_COLOR = {
    severe: "var(--sev-major)", mistake: "var(--sev-medium)",
    light: "var(--sev-light)", unsure: "var(--sev-minor)",
  };

  const boxHtml = (box) => {
    const rows = box.mistakes.map((m) => {
      const evStyle = TIER_COLOR[m.tier] ? ` style="color:${TIER_COLOR[m.tier]}"` : "";
      const goto = m.id
        ? `<a class="to-goto" href="#m${m.id}" data-action="openHash" title="Go to this mistake">→</a>`
        : `<span class="to-goto to-goto-off" title="No detail to jump to">→</span>`;
      return `<div class="tradeoff-row">
        ${poleHtml(m.youWins, m.youAction, m.youTile, m.oya, "you")}
        <span class="to-vs">vs</span>
        ${poleHtml(m.betterWins, m.betterAction, m.betterTile, m.oya, "better")}
        <span class="to-ev"${evStyle}>${m.ev.toFixed(2)}</span>
        ${goto}
      </div>`;
    }).join("");
    return `<div class="tradeoff-box">
      <div class="tradeoff-box-head">
        <span class="tradeoff-box-title">${box.title}</span>
        <span class="tradeoff-box-ev">${box.ev.toFixed(2)} EV</span>
      </div>
      <div class="tradeoff-box-sub"><span class="to-legend-you">Your play</span> vs <span class="to-legend-better">better play</span></div>
      ${rows}
    </div>`;
  };

  return `<div class="tradeoff-boxes">${boxes.map(boxHtml).join("")}</div>`;
}

// Does a mistake clear the severity slider? Cumulative: shown when its tier rank
// is at or above the slider threshold (state.sevLevel 0..3 over SEV_ORDER).
function sliderVisible(m) {
  return sevRank(sevTier(m.ev_loss)) <= state.sevLevel;
}

// Combined rounds-view visibility for a mistake: the severity slider AND, when
// any concept pills are selected, a match against ANY of them (additive / OR).
function mistakeVisible(m) {
  if (!sliderVisible(m)) return false;
  const cfs = state.conceptFilters;
  if (cfs && cfs.length
      && typeof haipaiConceptBreakdown !== "undefined"
      && typeof haipaiCompareDimensions !== "undefined") {
    const cd = haipaiCompareDimensions.compareDimensions;
    if (!cfs.some(f => haipaiConceptBreakdown.mistakeTouchesConcept(m, cd, f))) return false;
  }
  return true;
}

// True when `f` is already in the active concept-filter set.
function conceptFilterActive(side, group, dim) {
  return state.conceptFilters.some(
    f => f.side === side && f.group === group && (f.dim || null) === (dim || null));
}

// Toggle one concept-breakdown pill in/out of the additive filter set. Clicking
// an active pill removes it; clicking a new one adds it (OR semantics). Filtering
// only makes sense in the rounds view, so adding one snaps there.
function toggleConceptFilter(side, group, dim) {
  if (!side) return; // defensive; "Show all" uses clearConceptFilters
  dim = dim || null;
  const cfs = state.conceptFilters;
  const idx = cfs.findIndex(
    f => f.side === side && f.group === group && (f.dim || null) === dim);
  if (idx >= 0) {
    cfs.splice(idx, 1);
  } else {
    cfs.push({ side, group, dim });
    if (state.gameView !== "rounds") state.gameView = "rounds";
  }
  renderGame();
}

function clearConceptFilters() {
  state.conceptFilters = [];
  renderGame();
}

// Severity slider input handler: clamp to 0..3 and re-render.
function onSevSlider(el) {
  const v = parseInt(el.value, 10);
  state.sevLevel = Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 3;
  renderGame();
}

// Jump the slider to a specific level (clicking a tier label is a shortcut for
// dragging the slider there).
function setSevLevel(level) {
  state.sevLevel = Math.max(0, Math.min(3, level));
  renderGame();
}

// The "Filters" panel at the top of a game: a section heading, the cumulative
// severity slider, and the tier labels under it (Severe is always on; deeper
// tiers light up as the slider deepens). Tier labels double as click targets.
function renderFiltersPanel() {
  const TIERS = [
    ["Severe", "var(--sev-major)"],
    ["Mistake", "var(--sev-medium)"],
    ["Light", "var(--sev-light)"],
    ["Unsure", "var(--sev-minor)"],
  ];
  const ticks = TIERS.map(([label, color], rank) => {
    const on = rank <= state.sevLevel;
    return `<span class="sev-tick${on ? " on" : ""}" style="--tick:${color}"
      role="button" tabindex="0" data-action="setSevLevel" data-level="${rank}"
      title="Show down to ${label.toLowerCase()}">${label}</span>`;
  }).join("");
  return `<div class="filters-panel">
    <div class="filters-head">Filters</div>
    <div class="filters-row">
      <input type="range" class="sev-slider" min="0" max="3" step="1" value="${state.sevLevel}"
        aria-label="Severity threshold" data-change-action="onSevSlider">
      <div class="sev-ticks">${ticks}</div>
    </div>
  </div>`;
}

function renderGame() {
  const game = state.currentGameData;
  if (!game) return;
  const content = document.getElementById("content");

  const s = game.summary || {};

  // Recount by UI tier (server-side by_severity only has 3 buckets). `total`
  // counts everything; `vis` only the tiers the severity slider currently shows
  // — the summary bar reflects the slider, so it tallies the visible set.
  const tierCounts = { severe: 0, mistake: 0, light: 0, unsure: 0 };
  let visCount = 0, visEv = 0;
  for (const rnd of game.rounds) {
    for (const mi of rnd.mistakes) {
      tierCounts[sevTier(mi.ev_loss)]++;
      if (sliderVisible(mi)) { visCount++; visEv += mi.ev_loss || 0; }
    }
  }
  // Which severity stats to surface: severe is always on, deeper tiers appear
  // only once the slider reaches them (TIER_SLOTS index = SEV_ORDER rank).
  const TIER_SLOTS = [
    ["severe", "var(--sev-major)", "Severe", "EV loss > 1.0"],
    ["mistake", "var(--sev-medium)", "Mistake", "EV loss 0.5–1.0"],
    ["light", "var(--sev-light)", "Light", "EV loss 0.2–0.5"],
    ["unsure", "var(--sev-minor)", "Unsure", "EV loss < 0.2 — AI not confident"],
  ];

  // Concept aggregate, computed once over the slider-visible mistakes (so the
  // ledgers + summary headline track the slider too): the summary-bar headline
  // (top group) and the breakdown ledgers below both read it.
  const conceptReady = (typeof haipaiConceptBreakdown !== "undefined"
      && typeof haipaiCompareDimensions !== "undefined");
  const conceptAgg = conceptReady
    ? haipaiConceptBreakdown.aggregate(game, haipaiCompareDimensions.compareDimensions, sevTier, sliderVisible)
    : null;
  const tradeoffBoxes = conceptReady
    ? haipaiConceptBreakdown.tradeoffBoxes(game, haipaiCompareDimensions.compareDimensions,
        haipaiCompareDimensions.comparedTiles, sevTier, sliderVisible)
    : null;

  const dateObj = new Date(game.date + "T00:00:00");
  const displayDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  let html = `
    <div class="game-header">
      <h2>${displayDate}<a class="dev-id" href="#g${state.currentGame}" data-action="openHash" title="Deep-link to this game">#g${state.currentGame}</a>
        <button class="btn btn-delete" data-action="deleteGame" title="Delete game">Delete</button>
      </h2>
      ${game.log_url ? `<div class="log-link"><a href="${game.log_url}" target="_blank">${game.log_url}</a></div>` : ""}
    </div>


    ${renderFiltersPanel()}

    <div class="summary-bar">
      <div class="stat" title="Mistakes shown at the current severity level."><span class="value">${visCount}</span><span class="label">Mistakes</span></div>
      <div class="stat" title="Expected value lost across the shown mistakes, compared to Mortal's (the AI) preferred plays."><span class="value">${visEv.toFixed(2)}</span><span class="label">EV Loss</span></div>
      ${s.total_decisions ? `<div class="stat" title="How many of your decisions Mortal reviewed this game."><span class="value">${s.total_decisions}</span><span class="label">Decisions</span></div>
      <div class="stat" title="Average expected value lost per decision — lower is better."><span class="value">${s.ev_per_decision.toFixed(4)}</span><span class="label">EV/Decision</span></div>` : ""}
      ${TIER_SLOTS.filter((_, rank) => rank <= state.sevLevel).map(([key, color, label, tip]) =>
        `<div class="stat" title="${tip}"><span class="value" style="color:${color}">${tierCounts[key]}</span><span class="label">${label}</span></div>`).join("")}
      ${renderTopGroupStat(conceptAgg)}
    </div>
  `;

  // Concept-level EV ledger, top of the game (under the summary bar).
  html += renderConceptBreakdown(conceptAgg, tradeoffBoxes);

  // JS prep banner. Categorization itself runs in JS at render time
  // (see recategorizeGameInPlace); the only progress worth showing is the
  // ~700 ms async re-prep on the live mortal_data. _updatePrepBannerDOM
  // ticks the bar in place without re-rendering the whole game body.
  if (state.prepProgress) {
    const p = state.prepProgress;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    html += `<div id="prep-progress-banner" class="categorization-banner pending">
      <span class="prep-progress-label">Re-analyzing categories… ${p.done}/${p.total} rounds</span>
      <div class="cat-progress-bar"><div class="cat-progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  // Positive feedback banner
  const rating = gameRating(s);
  if (rating.icon) {
    const cleanRounds = game.rounds.filter(r => r.mistakes.length === 0).length;
    html += `<div class="game-rating ${rating.cls}">
      <span class="game-rating-star">${rating.icon}</span>
      <span>${rating.label}</span>
      ${cleanRounds > 0 ? `<span class="game-rating-detail">${cleanRounds}/${game.rounds.length} clean rounds</span>` : ""}
    </div>`;
  }

  // Concept-filter banner: shown when one or more breakdown pills are selected.
  // It owns the messaging while active (the severity banner is suppressed) so the
  // two filters don't show conflicting "X of Y" counts. Pills are additive (OR),
  // so the banner lists every selected concept.
  const cfs = state.conceptFilters;
  if (cfs.length && state.gameView === "rounds") {
    const gm = conceptMetaMap();
    const subMeta = (typeof haipaiConceptBreakdown !== "undefined" && haipaiConceptBreakdown.CONCEPT_META) || {};
    const matched = game.rounds.reduce((sum, r) => sum + r.mistakes.filter(mistakeVisible).length, 0);
    const pills = cfs.map((f) => {
      const meta = gm[f.group] || { label: f.group, color: "var(--text)" };
      const label = f.dim ? ((subMeta[f.dim] || {}).label || f.dim) : meta.label;
      return `<span class="concept-pill" style="--grp:${meta.color}">${label}</span>`;
    }).join("");
    const lead = cfs.length === 1 ? "matching" : "matching any of";
    html += `<div class="filter-banner concept-filter-banner">
      <span class="concept-filter-text">Showing the ${matched} mistake${matched === 1 ? "" : "s"} ${lead}</span>
      ${pills}
      <button class="concept-filter-clear" data-action="clearConceptFilters">Show all</button>
    </div>`;
  } else {
    // Filter banner (7b): show when severity filters hide some mistakes
    const totalMistakes = game.rounds.reduce((sum, r) => sum + r.mistakes.length, 0);
    const visibleMistakes = game.rounds.reduce((sum, r) => sum + r.mistakes.filter(mistakeVisible).length, 0);
    if (totalMistakes > 0 && visibleMistakes < totalMistakes && state.gameView === "rounds") {
      const hidden = totalMistakes - visibleMistakes;
      html += `<div class="filter-banner">Showing ${visibleMistakes} of ${totalMistakes} mistakes. ${hidden} hidden by the severity slider.</div>`;
    }
  }

  // View tabs
  html += `<div class="game-tabs">
    <button class="game-tab ${state.gameView === "rounds" ? "active" : ""}" data-action="switchGameView" data-view="rounds">Rounds</button>
    <button class="game-tab ${state.gameView === "summary" ? "active" : ""}" data-action="switchGameView" data-view="summary">Summary</button>
  </div>`;

  if (state.gameView === "rounds") {
  // Rounds
  for (const rnd of game.rounds) {
    const visible = rnd.mistakes.filter(mistakeVisible);
    // With a concept filter active a clean/non-matching round carries nothing to
    // show, so drop it entirely rather than render an empty "Clean" card.
    if (state.conceptFilters.length && visible.length === 0) continue;

    const outcomeStr = rnd.outcome ? (OUTCOME_EMOJI[rnd.outcome] || rnd.outcome) : "";
    // Prefer the decision count; old games stored before it existed only
    // have turn_count, so fall back to that.
    const nDec = rnd.decision_count || 0;
    const countStr = nDec
      ? `${nDec} decision${nDec === 1 ? "" : "s"}`
      : (rnd.turn_count ? `${rnd.turn_count} turn${rnd.turn_count === 1 ? "" : "s"}` : "");

    const isClean = rnd.mistakes.length === 0;
    html += `<div class="round${isClean ? " round-clean" : ""}">`;
    html += `<div class="round-header">
      <span>${formatRoundLabel(rnd.round)}${countStr ? ` <span class="round-count" title="How many of your decisions Mortal reviewed in this round.">&middot; ${countStr}</span>` : ""}</span>
      ${outcomeStr ? `<span class="outcome">${outcomeStr}</span>` : ""}
      ${isClean ? '<span class="clean-badge">Clean</span>' : ""}
      ${!isClean && visible.length !== rnd.mistakes.length ?
        `<span style="font-size:12px;color:var(--text-dim)">(${visible.length}/${rnd.mistakes.length})</span>` : ""}
    </div>`;

    // Track turn index for duplicate turn disambiguation
    const turnCounts = {};
    for (const m of rnd.mistakes) {
      const key = m.turn;
      turnCounts[key] = (turnCounts[key] || 0) + 1;
    }
    const turnSeen = {};

    for (const m of rnd.mistakes) {
      const turnKey = m.turn;
      const idx = turnSeen[turnKey] = (turnSeen[turnKey] || 0);
      turnSeen[turnKey]++;

      if (!mistakeVisible(m)) continue;

      const sc = sevClass(m);
      const dataAttrs = `data-game="${state.currentGame}" data-round="${rnd.round}" data-turn="${m.turn}" data-index="${idx}"`;
      const midAttr = m.id ? ` data-mid="${m.id}"` : "";
      const catGrpColor = m.skillArea ? skillAreaColor(m.skillArea) : null;
      const cardStyle = catGrpColor ? ` style="border-left-color:${catGrpColor}"` : "";

      // Arm the ambient active-dora set up front so the action chips below
      // (renderAction) and every later renderTile() in this card auto-highlight
      // dora.
      setActiveDora(getDoraTiles(m.board_state));
      html += `<div class="mistake ${sc}" ${dataAttrs}${midAttr}${cardStyle}>`;
      html += `<div class="mistake-top">`;
      if (m.is_all_last) {
        html += `<span class="all-last-badge" title="Final round of the hand — placement matters more than raw EV here.">All last</span>`;
      }
      html += formatTurnBadge(m.turn);
      if (m.id) html += `<a class="dev-id" href="#m${m.id}" data-action="openHash" title="Deep-link to this mistake">#m${m.id}</a>`;
      html += `<span class="severity ${sc}" title="${sevTooltip(m)}">${sevLabel(m)}</span>`;
      html += `<span class="ev-loss" title="${EV_LOSS_TOOLTIP}">${m.ev_loss.toFixed(2)} EV</span>`;
      const badge = mistakeBadge(m);
      if (badge) {
        html += `<span class="cat-badge" style="background:${badge.color}20;color:${badge.color};border:1px solid ${badge.color}40" title="${badge.desc}">${badge.label}</span>`;
      }
      if (m.bad_riichi_reason === "furiten") {
        const tip = (m.furiten_tiles || []).length
          ? `Already discarded ${m.furiten_tiles.join(", ")} — can't ron.`
          : "Wait includes a tile you've already discarded — can't ron.";
        html += `<span class="furiten-badge" title="${tip}">Furiten</span>`;
      }
      const raised = mortalRaisedShanten(m);
      if (raised) {
        const tip = `Your ${raised.userTile} keeps ${raised.userSh}-shanten; Mortal's ${raised.mortalTile} goes to ${raised.mortalSh}-shanten — Mortal is breaking up the hand for a strategic reason (likely yaku or value), not for tile efficiency.`;
        html += `<span class="raised-shanten-badge" title="${tip}">Mortal raised shanten</span>`;
      }
      if (m.shanten != null) {
        html += `<span class="shanten">${m.shanten}-shanten</span>`;
      }
      if (m.actual && m.expected) {
        const actStr = formatAction(m.actual);
        const expStr = formatAction(m.expected);
        if (actStr !== expStr) {
          html += `<span class="discard-comparison">
            <span class="played">${renderAction(m.actual, "played")}</span>
            <span class="arrow">&rarr;</span>
            <span class="ai">${renderAction(m.expected, "ai")}</span>
          </span>`;
        }
      }
      html += `</div>`;

      // Hand + melds on same row
      if (m.hand && m.hand.length) {
        const doraTiles = getDoraTiles(m.board_state);
        html += `<div class="hand-row">
          <span class="label">Hand</span>
                    <span class="tiles">${renderHand(m.hand, m.draw, m, doraTiles)}</span>`;
        if (m.melds && m.melds.length) {
          const playerSeat = m.actual ? m.actual.actor : null;
          const oya = mistakeOya(m);
          html += `<span class="inline-melds">`;
          for (const meld of m.melds) {
            html += renderMeld(meld, "action-tile-sm", playerSeat, doraTiles, oya) + " ";
          }
          html += `</span>`;
        }
        html += `</div>`;
      }

      // Board context (dora, winds, all discards, scores, opponent melds)
      html += renderBoardContext(m);
      html += renderTenpaiWaitsRow(m);

      // EV Comparison table (Mortal vs local shanten/ukeire)
      if (m.top_actions && m.top_actions.length && m.discard_stats && m.discard_stats.length) {
        html += renderEvComparison(m);
      } else if (m.top_actions && m.top_actions.length) {
        // Fallback: just show mortal top actions
        html += `<div class="top-actions">`;
        for (const a of m.top_actions) {
          html += `<span class="top-action">${renderAction(a.action)} <b>${a.q_value.toFixed(2)}</b></span>`;
        }
        html += `</div>`;
      }

      // Trainer bubble: explanation + (on complex cards) the embedded
      // complex-gap feedback funnel.
      html += trainerBubbleHtml(m);

      // Note input (always visible)
      {
        html += `<div class="note-row">
          <input type="text" class="note-input" placeholder="Add a note..." value="${(m.note || "").replace(/"/g, "&quot;")}"
                 data-change-action="onAnnotate" ${dataAttrs}>
          <span class="save-indicator">Saved</span>
        </div>`;
      }

      // Category feedback (one-click agree / two disagreement kinds).
      if (m.id) {
        html += renderReportRow(m);
      }

      html += `</div>`; // .mistake
    }

    html += `</div>`; // .round
  }
  } // end if rounds view

  if (state.gameView === "summary") {
  // Category summary - grouped by skill area, scoped to this game
  {
    // Collect all mistakes from this game — and remember each one's round
    // name + per-turn index so the summary-view note/report inputs know where
    // to write via the shared annotate handler.
    const allMistakes = [];
    const mistakeLoc = new Map();  // mistake obj -> {round, index}
    for (const rnd of game.rounds || []) {
      const byTurn = {};
      for (const m of rnd.mistakes || []) {
        const idx = byTurn[m.turn] || 0;
        byTurn[m.turn] = idx + 1;
        m.round_name = rnd.round;
        allMistakes.push(m);
        mistakeLoc.set(m, {round: rnd.round, index: idx});
      }
    }

    // Roll mistakes up by skill area, then split each into facets (shape for
    // discards, action label for meld/riichi/kan). No category codes — the
    // grouping mirrors the {skill area} × {shape} card identity.
    const groups = {};
    for (const m of allMistakes) {
      const sa = m.skillArea;
      if (!sa) continue;
      if (!groups[sa]) groups[sa] = { count: 0, ev: 0, subs: {}, mistakes: [] };
      groups[sa].count += 1;
      groups[sa].ev = Math.round((groups[sa].ev + (m.ev_loss || 0)) * 100) / 100;
      groups[sa].mistakes.push(m);
      const facet = mistakeFacet(m);
      const fkey = facet.key || "—";
      if (!groups[sa].subs[fkey]) {
        groups[sa].subs[fkey] = { label: facet.label || "Other", desc: facet.desc, count: 0, ev: 0, mistakes: [] };
      }
      const sub = groups[sa].subs[fkey];
      sub.count += 1;
      sub.ev = Math.round((sub.ev + (m.ev_loss || 0)) * 100) / 100;
      sub.mistakes.push(m);
    }

    if (Object.keys(groups).length) {
      html += `<div class="game-summary"><h3>Mistake Breakdown</h3>`;

      html += `<div class="category-groups">`;
      for (const [sa, data] of Object.entries(groups).sort((a, b) => b[1].ev - a[1].ev)) {
        const color = skillAreaColor(sa);
        const grpName = skillAreaLabel(sa);
        const grpId = sa.replace(/[\s_]/g, "-").toLowerCase();
        html += `<div class="cat-group" style="border-left: 3px solid ${color}">
          <div class="cat-group-header" data-action="toggleGameMistakes" data-group-id="${grpId}" style="cursor:pointer">
            <span class="cat-group-name" style="color:${color}">${grpName}</span>
            <span class="cat-group-stat">${data.count} mistakes &middot; ${data.ev.toFixed(2)} EV <span class="cat-expand">&#9660;</span></span>
          </div>`;
        // Facets (shape / action label)
        const subs = Object.entries(data.subs).sort((a, b) => b[1].ev - a[1].ev);
        for (const [, sub] of subs) {
          const tiers = { severe: 0, mistake: 0, light: 0, unsure: 0 };
          for (const m of sub.mistakes) tiers[sevTier(m.ev_loss)]++;
          html += `<div class="cat-sub" title="${sub.desc || ""}">
            <span class="cat-sub-label">${sub.label}</span>
            <span class="cat-sub-count">${sub.count}</span>
            <span class="cat-sub-ev">${sub.ev.toFixed(2)} EV</span>
            <span class="tier-count sev-major" title="Severe">${tiers.severe} Severe</span>
            <span class="tier-count sev-medium" title="Mistake">${tiers.mistake} Mistake</span>
            <span class="tier-count sev-light" title="Light">${tiers.light} Light</span>
            <span class="tier-count sev-minor" title="Unsure">${tiers.unsure} Unsure</span>
          </div>`;
        }
        // Inline mistake list (hidden by default) with explanatory text
        const sorted = [...data.mistakes].sort((a, b) => (b.ev_loss || 0) - (a.ev_loss || 0));
        let panelHtml = sorted.map(m => {
          const explSpan = trainerBubbleHtml(m);
          const loc = mistakeLoc.get(m) || {};
          const cardOpts = {
            annotate: true,
            gameId: state.currentGame,
            round: loc.round,
            index: loc.index,
          };
          return renderMistakeCard(m, cardOpts) + explSpan;
        }).join("");
        html += `<div id="game-mistakes-${grpId}" class="top-mistakes-panel" style="display:none">${panelHtml}</div>`;
        html += `</div>`;
      }
      html += `</div></div>`;
    }
  }
  } // end if summary view

  content.innerHTML = html;

  // Re-highlight active game in sidebar
  renderGameList();

  // Honour a pending scroll-to-mistake request from the #m<id>
  // deep-link router. Only scrolls in the rounds view — the summary view
  // collapses cards into expandable groups, so there's nothing to scroll to.
  // The flag is intentionally NOT cleared here: a deep-link load renders once
  // immediately and again after prep reflows the page, and we want the second
  // render to re-scroll to the settled position. The caller that set the flag
  // clears it once the view is settled (fetchGame after prep, applyHashRoute
  // for the already-loaded case).
  if (state.scrollToMistakeId && state.gameView === "rounds") {
    const target = state.scrollToMistakeId;
    requestAnimationFrame(() => {
      const el = document.querySelector(`.mistake[data-mid="${target}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("mistake-flash");
      setTimeout(() => el.classList.remove("mistake-flash"), 2000);
    });
  }
}

function switchGameView(view) {
  state.gameView = view;
  // The concept filters only govern the rounds view; leaving the Summary tab
  // would otherwise keep stale pills lit with nothing to filter.
  if (view !== "rounds") state.conceptFilters = [];
  renderGame();
}

// --- Toggles for group panels (game-summary + trends + top-mistakes) ---

function toggleGameMistakes(grpId) {
  const panel = document.getElementById(`game-mistakes-${grpId}`);
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "" : "none";
}

// Trends drill-down: panel content is pre-rendered by renderCategoryTrend —
// this is just a show/hide toggle. (`group` kept as arg for the onclick
// signature used in trends-analysis.js even though it's unused here.)
function toggleTrendMistakes(group, grpId) {
  const panel = document.getElementById(grpId);
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "" : "none";
}

function navigateHome() {
  state.currentGame = null;
  state.currentGameData = null;
  if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  renderGameList();
  document.getElementById("content").innerHTML = '<div class="empty-state">Select a game to review</div>';
}
