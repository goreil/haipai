// Presentation layer for the game list/detail flow: sidebar list with date
// separators + ratings, game-detail render (saved filters + rounds),
// mistake/category-group rendering, view-toggle helpers, and the
// navigate-home action that wipes the detail pane and re-renders the list.

// Shared fixed scale for games and hands; always uses all evaluated mistakes.
function gameRating(summary) {
  if (!summary || !Number.isFinite(summary.total_decisions) || summary.total_decisions <= 0
      || !Number.isFinite(summary.total_ev_loss) || summary.total_ev_loss < 0) return null;
  const index = Math.max(1, Math.min(17, Math.round(
    21.124813514948926 - 24.895305056375324 * Math.sqrt(summary.total_ev_loss / summary.total_decisions)
  )));
  const letters = ["E", "D", "C", "B", "A", "S"];
  const letter = letters[Math.floor(index / 3)];
  const modifier = ["−", "", "+"][index % 3];
  // Half-step boundaries invert the same curve used above, including the capped ends.
  const boundary = value => ((21.124813514948926 - value) / 24.895305056375324) ** 2;
  const threshold = index === 17 ? `≤ ${boundary(16.5).toFixed(4)}`
    : index === 1 ? `> ${boundary(1.5).toFixed(4)}`
    : `${boundary(index + 0.5).toFixed(4)}–${boundary(index - 0.5).toFixed(4)}`;
  return { letter, modifier, grade: letter + modifier, threshold };
}

function renderRanking(summary, size = "") {
  const rating = gameRating(summary);
  if (!rating) return `<span class="ranking ranking-unavailable ${size}" title="No reviewed decisions available" aria-label="Ranking unavailable">—</span>`;
  return `<span class="ranking ranking-${rating.letter.toLowerCase()} ${size}"
    title="${rating.grade}: ${rating.threshold} EV/D (approx.)"
    aria-label="Ranking ${rating.grade}"><span class="ranking-letter">${rating.letter}</span><sup>${rating.modifier}</sup></span>`;
}

// --- Render: Game List ---

function renderGameList() {
  const list = document.getElementById("game-list");
  const sorted = [...state.games].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  let lastDate = "";
  list.innerHTML = sorted.map(g => {
    const s = g.summary || {};
    const active = g.id === state.currentGame ? "active" : "";
    const evPerDecision = Number.isFinite(s.total_decisions) && s.total_decisions > 0
      && Number.isFinite(s.total_ev_loss) && s.total_ev_loss >= 0
      ? (s.total_ev_loss / s.total_decisions).toFixed(4) : "—";
    const dateObj = new Date(g.date + "T00:00:00");
    const shortDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    let sep = "";
    if (g.date !== lastDate) {
      lastDate = g.date;
      sep = `<div class="date-separator">${shortDate}</div>`;
    }
    return `${sep}
      <div class="game-item ${active}" data-action="fetchGame" data-game-id="${g.id}">
        <div class="date"><a class="dev-id" href="#g${g.id}" data-action="openHash" title="Deep-link to this game">#g${g.id}</a> · ${evPerDecision} EV/D</div>
        ${renderRanking(s, "ranking-sidebar")}
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

// Colour for the top-leak headline when the leader is a trade-off box rather
// than a "Losing points here" group (those resolve via GROUP_META/PILL_META).
// Box titles come from the boxes themselves (haipaiConceptBreakdown.BOX_DEFS)
// so there's one source of truth for the label text.
const BOX_COLOR = {
  push_fold: "#ff6b6b",    // matches Defense red — this box IS defense trades
  speed_value: "#a78bfa",
  other: "#94a3b8",
};

// The single biggest concept-group EV leak across everything actually shown
// on the game page — feeds the summary-bar headline. Candidates are the
// "Losing points here" ledger rows (missed side; under-using a concept) AND
// the trade-off boxes (Push vs. Fold / Speed vs. Value / Other; over-favoring
// mistakes, bucketed by axis — these replaced the old flat "you" ledger, so
// the headline must read from them too or it drifts from what the boxes below
// actually show). Groups/boxes are each already deduped internally.
function conceptTopGroup(agg, boxes) {
  const gm = conceptMetaMap();
  let best = null;
  if (agg) {
    for (const g of Object.values(agg.groups.missed)) {
      if (!best || g.ev > best.ev) best = Object.assign({ side: "missed" }, g);
    }
  }
  if (boxes) {
    for (const box of boxes) {
      if (!best || box.ev > best.ev) best = { side: "box", group: box.key, ev: box.ev, label: box.title };
    }
  }
  if (!best) return null;
  const meta = best.side === "box"
    ? { label: best.label, color: BOX_COLOR[best.group] || "var(--accent)" }
    : (gm[best.group] || { label: best.group, color: "var(--accent)" });
  return Object.assign({}, best, { meta });
}

// Summary-bar stat for the top concept group (only the single leader is shown).
// `scope` overrides the "this game" phrasing (e.g. for the trends cross-game
// rollup, which reuses this unchanged).
function renderTopGroupStat(agg, boxes, scope) {
  const tg = conceptTopGroup(agg, boxes);
  if (!tg) return "";
  scope = scope || "this game";
  const tip = tg.side === "missed"
    ? `Your biggest concept-group EV leak ${scope}. Pills are rolled up by category and de-duplicated (Dora + Dora acceptance count once); you’re under-using this group.`
    : `Your biggest concept-group EV leak ${scope} — the trade-off axis where you most often favored the wrong side.`;
  return `<div class="stat" title="${tip}">
    <span class="value" style="color:${tg.meta.color}">${tg.meta.label}</span>
    <span class="label">Top leak &middot; ${tg.ev.toFixed(2)} EV</span>
  </div>`;
}

// One-line coaching tip per top-leak group, keyed by the internal group key
// (compare-dimensions.GROUP_META keys Speed/Yaku/Dora/Defense, the
// category/shape pill keys Riichi/Meld/Kan/Complex, plus the trade-off box
// keys push_fold/speed_value/other) — same keyspace conceptTopGroup()
// resolves against. Efficiency and defense get external study links per
// product decision; the rest are short in-house tips.
// {{scope}} is substituted by renderTrainerTip — "this game" for the per-game
// card, "across your games" for the trends cross-game rollup.
const TRAINER_TIPS = {
  Speed: `Your biggest leak {{scope}} was efficiency — hand speed and tile acceptance (ukeire). For theory, read <a href="https://ooyamaneko.net/en/download/download.php?file=/download/mahjong/riichi/Daina_Chiba_-_Riichi_Book_1_en.pdf" target="_blank" rel="noopener">Riichi Book 1, Chapter 2</a>. For practice, drill it at <a href="https://trainer-haipai.ylue.de/" target="_blank" rel="noopener">trainer-haipai.ylue.de</a>.`,
  Yaku: `Your biggest leak {{scope}} was yaku — you're missing or undervaluing ways to make your hand cheaply. Before you discard, check whether keeping a tile or two keeps a yaku alive that you're about to lose. For theory, read <a href="https://ooyamaneko.net/en/download/download.php?file=/download/mahjong/riichi/Daina_Chiba_-_Riichi_Book_1_en.pdf" target="_blank" rel="noopener">Riichi Book 1, Chapter 5 (Pursuing Yaku)</a>.`,
  Dora: `Your biggest leak {{scope}} was hand value — dora tiles are worth holding onto. Weigh a dora's value against its acceptance before cutting it for shape.`,
  Defense: `Your biggest leak {{scope}} was push/fold judgment — before committing to a discard, check its danger against any live riichi or open hand. For theory, read <a href="https://ooyamaneko.net/en/download/download.php?file=/download/mahjong/riichi/Daina_Chiba_-_Riichi_Book_1_en.pdf" target="_blank" rel="noopener">Riichi Book 1, Chapter 8</a>. For practice, drill it at <a href="https://trainer-haipai.ylue.de/#defense" target="_blank" rel="noopener">trainer-haipai.ylue.de</a>.`,
  Riichi: `Your biggest leak {{scope}} was riichi timing — declare when your wait and value clearly justify the risk, and hold back when they don't. For theory, read <a href="https://ooyamaneko.net/en/download/download.php?file=/download/mahjong/riichi/Daina_Chiba_-_Riichi_Book_1_en.pdf" target="_blank" rel="noopener">Riichi Book 1, Chapter 7 (Riichi Judgement)</a>.`,
  Meld: `Your biggest leak {{scope}} was calling — only call a tile when it clearly speeds up your hand or secures a yaku, not just because it's available. For theory, read <a href="https://ooyamaneko.net/en/download/download.php?file=/download/mahjong/riichi/Daina_Chiba_-_Riichi_Book_1_en.pdf" target="_blank" rel="noopener">Riichi Book 1, Chapter 9 (Melding Judgement)</a>.`,
  Kan: `Your biggest leak {{scope}} was kan calls — a kan reveals information and adds danger, so make sure the speed or value gain is worth it first.`,
  Complex: `Your biggest leak {{scope}} was in complex shapes — these are the hands where the stats alone don't explain the right play, so review the flagged hands closely to build a feel for them.`,
  push_fold: `Your biggest leak {{scope}} was push/fold judgment — before committing to a discard, check its danger against any live riichi or open hand. For theory, read <a href="https://ooyamaneko.net/en/download/download.php?file=/download/mahjong/riichi/Daina_Chiba_-_Riichi_Book_1_en.pdf" target="_blank" rel="noopener">Riichi Book 1, Chapter 8</a>. For practice, drill it at <a href="https://trainer-haipai.ylue.de/#defense" target="_blank" rel="noopener">trainer-haipai.ylue.de</a>.`,
  speed_value: `Your biggest leak {{scope}} was trading off speed against hand value — weigh what a dora or yaku is actually worth against the tile acceptance you're giving up to keep it.`,
  other: `Your biggest leak {{scope}} was in mixed trade-offs — review the flagged hands below to see exactly which edge you gave up.`,
};

// Trainer speech-bubble tip for the single biggest leak (see conceptTopGroup),
// shown once under the summary bar. Reuses the same mascot-speech/speech-bubble
// look as the per-mistake trainer bubbles (mistake-card.js's trainerBubbleHtml)
// so it reads as the same character. `scope` overrides "this game" — see
// renderTopGroupStat.
function renderTrainerTip(agg, boxes, scope) {
  const tg = conceptTopGroup(agg, boxes);
  const raw = tg && TRAINER_TIPS[tg.group];
  if (!raw) return "";
  const tip = raw.replace("{{scope}}", scope || "this game");
  return `<div class="mascot-speech trainer-tip">
    <img src="/static/mascot.svg" class="mascot-avatar" alt="">
    <div class="speech-bubble">${tip}</div>
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
      const groupHint = groupHints[e.group];
      const groupFilterMsg = isActive ? "Click to clear this filter" : `Show only rounds where you’re ${verb} ${meta.label}`;
      const groupTitle = groupHint ? `${groupHint}\n\n${groupFilterMsg}` : groupFilterMsg;
      // Per-dim sub-pills (Yaku → Tanyao/Yakuhai…, Value → Dora/Dora acceptance),
      // each carrying its own EV and clickable as its own narrower filter. Group
      // colour, sorted by EV. Action/shape groups (Riichi/Meld/Kan/Complex) have
      // no finer dims, so this stays empty for them.
      const subs = Object.values(e.subs || {}).sort((a, b) => b.ev - a.ev);
      const subsHtml = subs.map((s) => {
        const subActive = conceptFilterActive(side, e.group, s.dim);
        const subCls = "concept-sub concept-sub-btn"
          + (subActive ? " concept-sub-active" : (filtering ? " concept-sub-dim" : ""));
        const subHint = (conceptHints[s.dim] || {}).hint;
        const subFilterMsg = subActive ? "Click to clear this filter" : `Show only rounds ${verb} ${s.label}`;
        const subTitle = subHint ? `${subHint}\n\n${subFilterMsg}` : subFilterMsg;
        return `<span class="${subCls}" style="--grp:${meta.color}" role="button" tabindex="0"`
          + ` title="${subTitle}"`
          + ` data-action="filterConcept" data-concept-side="${side}" data-concept-group="${e.group}" data-concept-dim="${s.dim}">`
          + `<span class="concept-sub-label">${s.label}</span>`
          + `<span class="concept-sub-ev">${s.ev.toFixed(2)}</span></span>`;
      }).join("");
      h += `<div class="concept-row">
        <span class="concept-row-left">
          <span class="${cls}" style="--grp:${meta.color}" role="button" tabindex="0"
            title="${groupTitle}"
            data-action="filterConcept" data-concept-side="${side}" data-concept-group="${e.group}">${meta.label}</span>
          ${subsHtml}
        </span>
        <span class="concept-tiers">${tierChips(e.tiers)}</span>
        <span class="concept-ev">${e.ev.toFixed(2)} EV</span>
      </div>`;
    }
    return h + `</div>`;
  };

  const groupHints = (typeof haipaiConceptBreakdown !== "undefined" && haipaiConceptBreakdown.GROUP_HINT) || {};
  const conceptHints = (typeof haipaiConceptBreakdown !== "undefined" && haipaiConceptBreakdown.CONCEPT_META) || {};

  const missed = ledgerHtml("Losing points here",
    "The better play held this edge — you’re under-using these", agg.groups.missed, "missed");
  const boxesHtml = renderTradeoffBoxes(boxes, gm);
  if (!missed && !boxesHtml) return "";
  const note = `<div class="concept-note">A single mistake can carry more than one concept, so its EV is counted toward each — these panels don’t add up to the game’s total EV loss.</div>`;
  return `<div class="concept-breakdown">${missed}${boxesHtml}${note}</div>`;
}

// Compact trade-off ledger using the same additive filters as the concept ledger.
function renderTradeoffBoxes(boxes, gm) {
  if (!boxes || !boxes.length) return "";
  gm = gm || conceptMetaMap();
  const definitions = {
    push_fold: { color: (gm.Defense || {}).color, labels: ["Should push", "Should fold"] },
    speed_value: { color: (gm.Speed || {}).color, labels: ["Should favor speed", "Should favor value"] },
    other: { color: "var(--text-dim)", labels: ["Other trade-offs"] },
  };
  const filtering = state.conceptFilters.length > 0;
  const rows = boxes.map(box => {
    const def = definitions[box.key] || definitions.other;
    const color = def.color || "var(--accent)";
    const groups = def.labels.map(label => ({ label, ev: 0, mistakes: [] }));
    const tiers = {};
    for (const mistake of box.mistakes) {
      const direction = haipaiConceptBreakdown.tradeoffDirection(box.key, mistake.betterWins);
      const group = groups.find(group => group.label === direction);
      group.ev += mistake.ev;
      group.mistakes.push(mistake);
      tiers[mistake.tier] = (tiers[mistake.tier] || 0) + 1;
    }
    const subs = groups.filter(group => group.mistakes.length).map(group => {
      const active = conceptFilterActive("tradeoff", box.key, group.label);
      const cls = "concept-sub concept-sub-btn"
        + (active ? " concept-sub-active" : (filtering ? " concept-sub-dim" : ""));
      return `<span class="${cls}" style="--grp:${color}" role="button" tabindex="0"
        title="${active ? "Click to clear this filter" : "Show only rounds: " + group.label}"
        data-action="filterConcept" data-concept-side="tradeoff" data-concept-group="${box.key}"
        data-concept-dim="${group.label}">
          <span class="concept-sub-label">${group.label}</span>
          <span class="concept-sub-ev">${group.ev.toFixed(2)}</span>
      </span>`;
    }).join("");
    const active = conceptFilterActive("tradeoff", box.key, null);
    const cls = "concept-pill concept-pill-btn"
      + (active ? " concept-pill-active" : (filtering ? " concept-pill-dim" : ""));
    const chips = [["severe", "sev-major", "Severe"], ["mistake", "sev-medium", "Mistake"],
      ["light", "sev-light", "Light"], ["unsure", "sev-minor", "Unsure"]]
      .filter(([key]) => tiers[key])
      .map(([key, cls, label]) => `<span class="tier-count ${cls}" title="${label}">${tiers[key]}</span>`)
      .join("");
    return `<div class="concept-row">
      <div class="concept-row-left">
        <span class="${cls}" style="--grp:${color}" role="button" tabindex="0"
          title="${active ? "Click to clear this filter" : "Show only rounds: " + box.title}"
          data-action="filterConcept" data-concept-side="tradeoff" data-concept-group="${box.key}">${box.title}</span>${subs}
      </div>
      <span class="concept-tiers">${chips}</span>
      <span class="concept-ev">${box.ev.toFixed(2)} EV</span>
    </div>`;
  }).join("");
  return `<div class="concept-ledger">
    <div class="concept-ledger-head">
      <span class="concept-ledger-title">Trade-offs</span>
      <span class="concept-ledger-sub">What the better play favored — select a pill to filter rounds</span>
    </div>${rows}</div>`;
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

// Changes are saved directly to the active filter tab.
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
  }
  saveActiveReviewFilter({ topics: cfs, topGroup: false });
  renderGame();
}

function clearConceptFilters() {
  state.conceptFilters = [];
  saveActiveReviewFilter({ topics: [], topGroup: false });
  renderGame();
}

function showAllReviewItems() {
  state.sevLevel = 3;
  state.conceptFilters = [];
  state.reviewLimit = 0;
  saveActiveReviewFilter({ severity: 3, topics: [], topGroup: false, limit: 0 });
  renderGame();
}

// Severity slider input handler: clamp to 0..3 and re-render.
function onSevSlider(el) {
  const v = parseInt(el.value, 10);
  state.sevLevel = Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 3;
  saveActiveReviewFilter({ severity: state.sevLevel });
  renderGame();
}

// Jump the slider to a specific level (clicking a tier label is a shortcut for
// dragging the slider there).
function setSevLevel(level) {
  state.sevLevel = Math.max(0, Math.min(3, level));
  saveActiveReviewFilter({ severity: state.sevLevel });
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
    <div class="filters-head">Severity · include these levels</div>
    <div class="filters-row">
      <input type="range" class="sev-slider" min="0" max="3" step="1" value="${state.sevLevel}"
        aria-label="Severity threshold" data-change-action="onSevSlider">
      <div class="sev-ticks">${ticks}</div>
    </div>
  </div>`;
}

// Final scores for the game, straight off mjai_log — no backend field
// carries them (routes/game.py's _slim_mortal_data forwards mjai_log
// unslimmed for exactly this kind of read). Starts from the last kyoku's
// `scores` and replays the riichi sticks (-1000 to the declaring seat, since
// reach cost isn't reflected in the deltas) plus the hora/ryukyoku deltas
// after it, to land on the true end-of-game total.
//
// Two spellings/edge cases this got wrong before, both re-verified by
// replaying all 622 prod games against every `start_kyoku`'s own `scores`
// (0 mismatches):
//   - The mjai event is `ryukyoku`, ONE u. Spelling it `ryuukyoku` silently
//     drops the deltas of any game ending in an exhaustive draw — that's how
//     a below-zero noten payment left the panel showing pre-draw scores.
//   - A riichi stick is paid when the declaration discard PASSES, so charging
//     on `reach` overcounts (154/622 games) whenever the declaration tile is
//     ronned, which cancels the riichi. But charging only on `reach_accepted`
//     undercounts (2/622), because mjai emits no `reach_accepted` when the
//     declaration discard is the hand's last and the kyoku ends in a draw —
//     the riichi IS established there. Hence: hold the reach pending, and on
//     the terminating hora/ryukyoku charge it unless a hora targets the
//     declarer (i.e. the declaration tile was ronned).
//
// Finally, riichi sticks still on the table when the game ends go to the
// 1st-place player (Tenhou and MJS both). That only ever happens when the
// game ends in a draw — a hora collects every stick, and its deltas already
// include them. The count is the last kyoku's carried `kyotaku` plus the
// riichi established in it; validated against the next `start_kyoku`'s own
// `kyotaku` across the corpus. Without this the four scores sum to less than
// the 100k they started with.
//
// Returns seats sorted by score (descending, ties to the seat closest to
// starting East), each `{seat, score, wind, you, kyotakuBonus}`, or null if
// mjai_log/scores aren't available.
function computeFinalScores(mortalData) {
  const log = mortalData && mortalData.mjai_log;
  if (!log || !log.length || typeof haipaiPrepParse === "undefined") return null;
  const events = haipaiPrepParse.flatten_mjai_log(log);
  const startPositions = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "start_kyoku") startPositions.push(i);
  }
  if (!startPositions.length) return null;
  const firstStart = events[startPositions[0]];
  const lastStartPos = startPositions[startPositions.length - 1];
  const lastStart = events[lastStartPos];
  const scores = (lastStart.scores || []).slice();
  if (!scores.length) return null;
  let pendingReach = null; // declared, not yet known to have passed
  let sticks = lastStart.kyotaku || 0; // riichi sticks on the table
  for (let i = lastStartPos + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === "reach" && e.actor != null) {
      pendingReach = e.actor;
    } else if (e.type === "reach_accepted" && e.actor != null) {
      scores[e.actor] -= 1000;
      sticks += 1;
      pendingReach = null;
    } else if ((e.type === "hora" || e.type === "ryukyoku") && e.deltas) {
      if (pendingReach != null) {
        // Ron on the declaration tile cancels the riichi; anything else
        // (notably a draw on that discard) means the stick was paid.
        if (!(e.type === "hora" && e.target === pendingReach)) {
          scores[pendingReach] -= 1000;
          sticks += 1;
        }
        pendingReach = null;
      }
      for (let s = 0; s < scores.length; s++) scores[s] += e.deltas[s] || 0;
      // The winner sweeps the table, and the deltas already paid it out.
      if (e.type === "hora") sticks = 0;
    }
  }
  const WINDS = ["E", "S", "W", "N"];
  const oya1 = firstStart.oya || 0;
  const seats = scores.map((score, seat) => ({
    seat,
    score,
    wind: WINDS[(seat - oya1 + 4) % 4],
    windIdx: (seat - oya1 + 4) % 4,
    you: seat === mortalData.player_id,
    kyotakuBonus: 0,
  }));
  // Ties go to the seat closest to starting East, so the wind index (already
  // measured from the first oya) is the tiebreak.
  seats.sort((a, b) => b.score - a.score || a.windIdx - b.windIdx);
  if (sticks > 0) {
    seats[0].kyotakuBonus = sticks * 1000;
    seats[0].score += seats[0].kyotakuBonus;
  }
  return seats;
}

function renderFinalScores(mortalData) {
  const seats = computeFinalScores(mortalData);
  if (!seats) return "";
  const PLACE = ["1st", "2nd", "3rd", "4th"];
  const cells = seats.map((s, rank) => {
    // Explain the leftover-riichi-stick award, otherwise 1st place just reads
    // 1000 higher than the last hand's arithmetic suggests.
    const bonus = s.kyotakuBonus
      ? ` title="Includes +${s.kyotakuBonus.toLocaleString()} from ${s.kyotakuBonus / 1000} riichi stick${s.kyotakuBonus === 1000 ? "" : "s"} left on the table"`
      : "";
    return `
    <span class="final-score-seat place-${rank + 1}${s.you ? " final-score-you" : ""}"${bonus}>
      <span class="final-score-place">${PLACE[rank]}</span>
      <span class="final-score-label">${s.you ? "You" : s.wind}</span>
      <span class="final-score-pts">${s.score.toLocaleString()}</span>
    </span>`;
  }).join("");
  return `<div class="final-scores" title="Final scores for this game">${cells}</div>`;
}

// Always summarize all mistakes, independently of the active display filters.
function renderMistakeStats(mistakes) {
  const tierCounts = { severe: 0, mistake: 0, light: 0, unsure: 0 };
  for (const mistake of mistakes) tierCounts[sevTier(mistake.ev_loss)]++;
  const tiers = [
    ["severe", "var(--sev-major)", "Severe", "EV loss > 1.0"],
    ["mistake", "var(--sev-medium)", "Mistake", "EV loss 0.5–1.0"],
    ["light", "var(--sev-light)", "Light", "EV loss 0.2–0.5"],
    ["unsure", "var(--sev-minor)", "Unsure", "EV loss < 0.2 — AI not confident"],
  ];
  return tiers.map(([key, color, label, tip]) =>
    `<div class="stat" title="${tip}"><span class="value" style="color:${color}">${tierCounts[key]}</span><span class="label">${label}</span></div>`).join("");
}

// Keep the navigation marker on the last section heading above the reading line.
// A stable listener reads the current markup, so re-renders cannot stack handlers.
function syncGameToc() {
  const content = document.getElementById("content");
  const toc = content.querySelector(".game-toc");
  if (!toc || !window.matchMedia("(min-width: 1100px)").matches) return;
  const buttons = [...toc.querySelectorAll(".game-toc-item")];
  const readingLine = content.getBoundingClientRect().top + 64;
  let current = buttons[0];
  for (const button of buttons) {
    const section = document.getElementById(button.dataset.target);
    if (section && section.getBoundingClientRect().top <= readingLine) current = button;
    else break;
  }
  if (content.scrollTop > 0 && content.scrollTop + content.clientHeight >= content.scrollHeight - 1) {
    current = buttons[buttons.length - 1];
  }
  if (toc.querySelector('[aria-current="location"]') === current) return;
  for (const button of buttons) {
    if (button === current) button.setAttribute("aria-current", "location");
    else button.removeAttribute("aria-current");
  }

  // Long games can overflow the small floating panel; keep its marker visible.
  const rounds = toc.querySelector(".game-toc-rounds");
  if (!rounds || !rounds.contains(current)) return;
  const viewport = rounds.getBoundingClientRect();
  const item = current.getBoundingClientRect();
  if (item.top < viewport.top) rounds.scrollTop += item.top - viewport.top;
  else if (item.bottom > viewport.bottom) rounds.scrollTop += item.bottom - viewport.bottom;
}

// Expansion belongs to the loaded game, so it survives re-renders without
// carrying round indexes into another game's review.
const expandedHandMistakes = new WeakMap();
const gameReviewPanels = new WeakMap();

function gamePanelOpen(game, panel) {
  return gameReviewPanels.get(game)?.has(panel) || false;
}

function reviewTopGroupFilter(topGroup) {
  // The Defense preset reviews deal-in decisions. Safe-spare comparisons on
  // Attack cards belong to the broader concept filter, not this focused preset.
  const dim = topGroup.side === "missed" && topGroup.group === "Defense" ? "deal_in" : null;
  return { side: topGroup.side === "box" ? "tradeoff" : topGroup.side, group: topGroup.group, dim };
}

function reviewTopGroup(game, agg, boxes) {
  if (!agg?.groups.missed.Defense) return conceptTopGroup(agg, boxes);
  const filter = reviewTopGroupFilter({ side: "missed", group: "Defense" });
  const defenseMistakes = game.rounds.flatMap(round => round.mistakes).filter(m =>
    haipaiConceptBreakdown.mistakeTouchesConcept(m, haipaiCompareDimensions.compareDimensions, filter));
  // Rank the preset using the same membership it will display. In particular,
  // a game with only safe-spare comparisons must not get an empty Defense tab.
  const missed = { ...agg.groups.missed };
  if (defenseMistakes.length) {
    missed.Defense = { ...missed.Defense, ev: defenseMistakes.reduce((sum, m) => sum + m.ev_loss, 0) };
  } else {
    delete missed.Defense;
  }
  return conceptTopGroup({ groups: { ...agg.groups, missed } }, boxes);
}

function openReviewFilters() {
  const game = state.currentGameData;
  let panels = gameReviewPanels.get(game);
  if (!panels) gameReviewPanels.set(game, panels = new Set());
  panels.add("filters");
}

function reviewRoundLayout() {
  return (state.reviewSort || "round") === "round" && !state.reviewLimit;
}

// Assign annotation indexes before filtering/sorting: two decisions may share a turn.
function reviewEntries(game) {
  const entries = [];
  for (const [roundIndex, round] of game.rounds.entries()) {
    const seen = {};
    for (const [position, mistake] of round.mistakes.entries()) {
      const index = seen[mistake.turn] || 0;
      seen[mistake.turn] = index + 1;
      if (mistakeVisible(mistake)) entries.push({ mistake, round: round.round, roundIndex, index, position });
    }
  }
  if (activeReviewTab()?.topGroup && !state.conceptFilters.length) return [];
  // A limit always means the highest-EV matches; sorting only changes their display order.
  entries.sort((a, b) => (b.mistake.ev_loss || 0) - (a.mistake.ev_loss || 0)
    || a.roundIndex - b.roundIndex || a.mistake.turn - b.mistake.turn || a.position - b.position);
  const selected = state.reviewLimit ? entries.slice(0, state.reviewLimit) : entries;
  if ((state.reviewSort || "round") === "round") {
    selected.sort((a, b) => a.roundIndex - b.roundIndex || a.mistake.turn - b.mistake.turn || a.position - b.position);
  }
  return selected;
}

function renderGameReviewCard(entry) {
  return renderMistakeCard(entry.mistake, {
    inline: true, annotate: !state.readOnly, gameId: state.currentGame,
    round: entry.round, index: entry.index,
  });
}

// Toggle filters in place without rebuilding cards or losing notes.
function toggleGamePanel(button) {
  const game = state.currentGameData;
  const panel = document.getElementById(button.getAttribute("aria-controls"));
  if (!game || !panel) return;
  let open = gameReviewPanels.get(game);
  if (!open) gameReviewPanels.set(game, open = new Set());
  const key = button.dataset.panel;
  if (open.has(key)) open.delete(key);
  else open.add(key);
  panel.hidden = !open.has(key);
  button.setAttribute("aria-expanded", String(open.has(key)));
  requestAnimationFrame(syncGameToc);
}

function reviewItemCounts(game) {
  if (!reviewRoundLayout()) {
    return { total: game.rounds.reduce((sum, round) => sum + round.mistakes.length, 0),
      shown: reviewEntries(game).length, revealed: 0 };
  }
  let total = 0, shown = 0, revealed = 0;
  for (const [index, round] of game.rounds.entries()) {
    total += round.mistakes.length;
    for (const mistake of round.mistakes) {
      if (mistakeVisible(mistake)) shown++;
      else if (handMistakesExpanded(game, index)) { shown++; revealed++; }
    }
  }
  return { total, shown, revealed };
}

function reviewTopicLabel(filter) {
  const groups = conceptMetaMap();
  const dimensions = (typeof haipaiConceptBreakdown !== "undefined"
    && haipaiConceptBreakdown.CONCEPT_META) || {};
  const trades = { push_fold: "Push vs. Fold", speed_value: "Speed vs. Value", other: "Other trade-offs" };
  const group = filter.side === "tradeoff" ? trades[filter.group] : groups[filter.group]?.label;
  return filter.dim ? (dimensions[filter.dim]?.label || filter.dim) : (group || filter.group);
}

function renderReviewControls(game, agg, boxes) {
  if (state.reviewLinkedMistake) return '<p class="review-summary-scope">Viewing a linked mistake. Select a filter tab to return to your filters.</p>';
  if (!activeReviewTab()) return '<p class="review-empty">No filters yet. Use + to add a standard filter or create your own.</p>';
  const { total, shown, revealed } = reviewItemCounts(game);
  const filters = state.conceptFilters;
  const severity = ["Severe only", "Severe + Mistake", "Severe + Mistake + Light", "All severity levels"][state.sevLevel];
  const topics = filters.length ? filters.map(reviewTopicLabel).map(escapeHtml).join(", ") : "All topics";
  const metadata = conceptMetaMap();
  const tradeoffColors = {
    push_fold: metadata.Defense?.color,
    speed_value: metadata.Speed?.color,
    other: "var(--text-dim)",
  };
  const choices = [
    ...Object.entries(agg?.groups.missed || {}).map(([group, entry]) =>
      ({ side: "missed", group, ev: entry.ev, color: metadata[group]?.color })),
    ...(boxes || []).map(box =>
      ({ side: "tradeoff", group: box.key, ev: box.ev, color: tradeoffColors[box.key] })),
  ].sort((a, b) => b.ev - a.ev);
  // Keep saved topics removable even when this game has no matching mistakes.
  for (const filter of filters) {
    if (!choices.some(f => f.side === filter.side && f.group === filter.group && (f.dim || null) === (filter.dim || null))) {
      const ev = game.rounds.flatMap(round => round.mistakes).filter(m =>
        haipaiConceptBreakdown.mistakeTouchesConcept(m, haipaiCompareDimensions.compareDimensions, filter))
        .reduce((sum, m) => sum + m.ev_loss, 0);
      choices.push({ ...filter, ev });
    }
  }
  const topicButtons = choices.map(filter => `<button type="button" class="review-topic"
    style="--topic-color:${filter.color || "var(--text-dim)"}"
    data-action="filterConcept" data-concept-side="${filter.side}" data-concept-group="${escapeHtml(filter.group)}"
    ${filter.dim ? `data-concept-dim="${escapeHtml(filter.dim)}"` : ""}
    title="Total EV loss across this game. Topics can overlap."
    aria-pressed="${conceptFilterActive(filter.side, filter.group, filter.dim || null)}">
      <span>${escapeHtml(reviewTopicLabel(filter))}</span>
      <span class="review-topic-ev">${filter.ev.toFixed(2)} EV</span>
    </button>`).join("");
  const open = gamePanelOpen(game, "filters");
  const sortLabel = state.reviewSort === "ev" ? "Highest EV first" : "Round order";
  return `<div class="review-controls">
    <div class="review-scope">
      <strong>Showing ${shown} of ${total} review items</strong>
      <span class="review-active-filters">${severity} · ${topics} · ${sortLabel}${state.reviewLimit ? ` · Top ${state.reviewLimit}` : ""}</span>
      ${revealed ? `<span class="review-active-filters">Includes ${revealed} item${revealed === 1 ? "" : "s"} revealed in individual hands.</span>` : ""}
    </div>
    <div class="review-control-actions">
      <button type="button" class="review-disclosure" data-action="toggleGamePanel" data-panel="filters"
        aria-controls="game-review-filters" aria-expanded="${open}">Filters</button>
      <button type="button" class="review-link" data-action="showAllReviewItems"
        ${state.sevLevel === 3 && !filters.length && !state.reviewLimit ? "disabled" : ""}>Show all review items</button>
    </div>
  </div>
  <div id="game-review-filters" class="review-filter-panel" ${open ? "" : "hidden"}>
    <div class="review-filter-options">
      <label>Sort
        <select data-change-action="changeReviewOption" data-review-option="sort">
          <option value="ev" ${state.reviewSort === "ev" ? "selected" : ""}>EV loss · highest first</option>
          <option value="round" ${state.reviewSort !== "ev" ? "selected" : ""}>Round · chronological</option>
        </select>
      </label>
      <label>Results
        <select data-change-action="changeReviewOption" data-review-option="limit">
          ${[[0, "All matching mistakes"], [5, "Top 5 by EV"], [10, "Top 10 by EV"], [20, "Top 20 by EV"]]
            .map(([value, label]) => `<option value="${value}" ${(state.reviewLimit || 0) === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    </div>
    ${renderFiltersPanel()}
    <div class="review-topics">
      <div class="filters-head">Topics · match any selected topic</div>
      <div class="review-topic-options">${topicButtons || '<span>No topics at this severity level.</span>'}</div>
      ${filters.length ? '<button type="button" class="review-link" data-action="clearConceptFilters">Clear topic filter</button>' : ""}
    </div>
    <p class="review-active-filters review-filter-hint">Changes save to this tab automatically in this browser. Double-click its name to rename it.</p>
  </div>
  ${!shown ? `<p class="review-empty">${total ? 'No review items match this filter. Adjust the topics or severity, or choose “Show all review items”.' : "No mistakes to review in this game."}</p>` : ""}`;
}

function handMistakesExpanded(game, roundIndex) {
  return expandedHandMistakes.get(game)?.has(roundIndex) || false;
}

function toggleHandMistakes(roundIndex) {
  const game = state.currentGameData;
  if (!game || !game.rounds[roundIndex]) return;
  let expanded = expandedHandMistakes.get(game);
  if (!expanded) expandedHandMistakes.set(game, expanded = new Set());
  if (expanded.has(roundIndex)) expanded.delete(roundIndex);
  else expanded.add(roundIndex);
  const content = document.getElementById("content");
  const scrollTop = content.scrollTop;
  renderGame();
  content.scrollTop = scrollTop;
  document.querySelector(`[data-action="toggleHandMistakes"][data-round-index="${roundIndex}"]`)
    ?.focus({ preventScroll: true });
}

function renderGame() {
  const game = state.currentGameData;
  if (!game) return;
  const content = document.getElementById("content");
  // Filters rebuild the page. Keep keyboard users on the control they used.
  const active = document.activeElement;
  const renaming = active?.dataset.renameReviewTab ? {
    id: active.dataset.renameReviewTab, value: active.value,
    start: active.selectionStart, end: active.selectionEnd,
  } : null;
  const reviewFocus = active?.closest(".review-controls, .review-filter-panel, .game-review-nav, .filters-panel")
    ? Object.entries(active.dataset) : null;

  const s = game.summary || {};
  const tocItems = [];

  // Rank the leading group across the entire game, independent of tab filters.
  const conceptReady = (typeof haipaiConceptBreakdown !== "undefined"
      && typeof haipaiCompareDimensions !== "undefined");
  const conceptAgg = conceptReady
    ? haipaiConceptBreakdown.aggregate(game, haipaiCompareDimensions.compareDimensions, sevTier)
    : null;
  const tradeoffBoxes = conceptReady
    ? haipaiConceptBreakdown.tradeoffBoxes(game, haipaiCompareDimensions.compareDimensions,
        haipaiCompareDimensions.comparedTiles, sevTier)
    : null;

  const topGroup = reviewTopGroup(game, conceptAgg, tradeoffBoxes);
  syncReviewFilter(topGroup);
  const hasReview = state.reviewLinkedMistake || !!activeReviewTab();
  const roundLayout = hasReview && reviewRoundLayout();

  const dateObj = new Date(game.date + "T00:00:00");
  const displayDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  let html = `
    <div class="game-header game-header-compact" id="game-overview">
      <h2>${displayDate}</h2>
      <div class="game-header-actions">
        ${state.readOnly ? "" : '<button type="button" class="btn" data-action="showShareModal">Share</button>'}
        ${!state.readOnly || game.log_url ? `<details class="game-actions-menu">
          <summary aria-label="More game actions" title="More game actions">⋯</summary>
          <div class="game-actions-popover">
            ${game.log_url ? `<a href="${escapeHtml(game.log_url)}" target="_blank" rel="noopener">Original game ↗</a>` : ""}
            ${state.readOnly ? "" : `<a href="#g${state.currentGame}" data-action="openHash">Game #${state.currentGame}</a>
              <button type="button" class="btn-delete" data-action="deleteGame">Delete game</button>`}
          </div>
        </details>` : ""}
      </div>
    </div>
    <button type="button" class="review-disclosure review-overview-toggle" data-action="toggleGamePanel"
      data-panel="overview" aria-controls="game-review-overview" aria-expanded="${gamePanelOpen(game, "overview")}">Game overview</button>
    <section id="game-review-overview" class="game-review-overview" aria-label="Game overview"
      ${gamePanelOpen(game, "overview") ? "" : "hidden"}>
      ${renderFinalScores(game.mortal_data)}
      <div class="summary-bar">
        <div class="stat ranking-stat">${renderRanking(s, "ranking-large")}<span class="label">Ranking</span></div>
        ${s.total_decisions ? `<div class="stat" title="How many of your decisions Mortal reviewed this game."><span class="value">${s.total_decisions}</span><span class="label">Decisions</span></div>
        <div class="stat" title="Average expected value lost per decision — lower is better."><span class="value">${s.ev_per_decision.toFixed(4)}</span><span class="label">EV/Decision</span></div>` : ""}
        ${renderMistakeStats(game.rounds.flatMap(rnd => rnd.mistakes))}
        ${renderTopGroupStat(conceptAgg, tradeoffBoxes)}
      </div>
      ${renderTrainerTip(conceptAgg, tradeoffBoxes)}
      <p class="review-summary-scope">Game totals and concept breakdowns include all review items.</p>
      ${renderConceptBreakdown(conceptAgg, tradeoffBoxes)}
    </section>
    ${renderReviewTabs(topGroup)}
    ${renderReviewControls(game, conceptAgg, tradeoffBoxes)}
  `;

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

  if (roundLayout) {
  // Rounds
  for (const [roundIndex, rnd] of game.rounds.entries()) {
    const visible = rnd.mistakes.filter(mistakeVisible);
    const expanded = handMistakesExpanded(game, roundIndex);
    const hiddenCount = rnd.mistakes.length - visible.length;

    const outcomeStr = rnd.outcome ? (OUTCOME_EMOJI[rnd.outcome] || rnd.outcome) : "";
    // Prefer the decision count; old games stored before it existed only
    // have turn_count, so fall back to that.
    const nDec = rnd.decision_count || 0;
    const countStr = nDec
      ? `${nDec} decision${nDec === 1 ? "" : "s"}`
      : (rnd.turn_count ? `${rnd.turn_count} turn${rnd.turn_count === 1 ? "" : "s"}` : "");

    const isClean = rnd.mistakes.length === 0;
    const roundId = `game-round-${roundIndex}`;
    html += `<div class="round${isClean ? " round-clean" : ""}" id="${roundId}">`;
    const handSummary = {
      total_decisions: rnd.decision_count,
      total_ev_loss: rnd.mistakes.reduce((sum, m) => sum + (m.ev_loss || 0), 0),
    };
    tocItems.push({ id: roundId, label: rnd.round, summary: handSummary });
    html += `<div class="round-header">
      ${renderRanking(handSummary, "ranking-hand")}
      <span>${formatRoundLabel(rnd.round)}${countStr ? ` <span class="round-count" title="How many of your decisions Mortal reviewed in this round.">&middot; ${countStr}</span>` : ""}</span>
      ${outcomeStr ? `<span class="outcome">${outcomeStr}</span>` : ""}
      ${isClean ? '<span class="clean-badge">Clean</span>' : ""}
      <div class="round-mistake-summary">${renderMistakeStats(rnd.mistakes)}</div>
      ${hiddenCount ? `<button type="button" class="round-expand" data-action="toggleHandMistakes"
        data-round-index="${roundIndex}" aria-expanded="${expanded}"
        title="${expanded ? "Hide mistakes excluded by the filters" : `Show ${hiddenCount} more mistake${hiddenCount === 1 ? "" : "s"} hidden by the filters`}">
        ${expanded ? "Show less" : "Show all"}<span class="round-expand-chevron" aria-hidden="true"></span></button>` : ""}
    </div>`;

    const turnSeen = {};
    for (const m of rnd.mistakes) {
      const index = turnSeen[m.turn] || 0;
      turnSeen[m.turn] = index + 1;
      if (!expanded && !mistakeVisible(m)) continue;
      html += renderGameReviewCard({ mistake: m, round: rnd.round, index });
    }

    html += `</div>`; // .round
  }
  } // end if rounds view

  if (hasReview && !roundLayout) {
    html += `<div class="review-mistake-list">${reviewEntries(game).map(renderGameReviewCard).join("")}</div>`;
  }

  if (!state.readOnly) html += renderMakaRatings(game);

  if (roundLayout) {
    const toc = `<nav class="game-toc" aria-label="Game contents">
      <div class="game-toc-heading">Contents</div>
      <button type="button" class="game-toc-item game-toc-overview" data-action="scrollGameSection" data-target="game-overview">
        <span>The game</span>${renderRanking(s, "ranking-toc")}
      </button>
      ${tocItems.length ? `<div class="game-toc-columns" aria-hidden="true"><span>Round</span><span>Rank</span></div>
      <div class="game-toc-rounds"><div class="game-toc-list">${tocItems.map(item => `<button type="button" class="game-toc-item" data-action="scrollGameSection"
        data-target="${item.id}" aria-label="${formatRoundLabel(item.label)}, ranking ${gameRating(item.summary)?.grade || "unavailable"}"
        title="${formatRoundLabel(item.label)}"><span>${item.label}</span>${renderRanking(item.summary, "ranking-toc")}</button>`).join("")}</div></div>` : ""}
    </nav>`;
    html = `<div class="game-detail-layout"><div class="game-detail-body">${html}</div>${toc}</div>`;
  }
  content.innerHTML = html;
  if (renaming) {
    beginReviewRename(renaming.id);
    const input = document.querySelector("[data-rename-review-tab]");
    if (input) {
      input.value = renaming.value;
      input.setSelectionRange(renaming.start, renaming.end);
    }
  }
  if (reviewFocus?.length && !renaming) {
    const controls = content.querySelectorAll(".review-controls button, .review-filter-panel [data-action], .review-filter-panel [data-change-action], .review-filter-panel [data-input-action], .filters-panel [data-action], .filters-panel input, .game-review-nav button");
    const replacement = [...controls].find(el => reviewFocus.every(([key, value]) => el.dataset[key] === value));
    // Reset/clear controls can disappear or become disabled after use.
    const target = replacement && !replacement.disabled ? replacement : content.querySelector('[data-panel="filters"]');
    target?.focus({ preventScroll: true });
  }
  content.removeEventListener("scroll", syncGameToc);
  if (roundLayout) {
    content.addEventListener("scroll", syncGameToc, { passive: true });
    requestAnimationFrame(syncGameToc);
  }
  if (!state.readOnly) bindMakaRatings(game);

  // Re-highlight active game in sidebar. Not applicable on the read-only
  // shared/demo page — there's no sidebar and state.games is never populated.
  if (!state.readOnly) renderGameList();

  // Honour a pending scroll-to-mistake request from the #m<id>
  // deep-link router. Deep links switch to the rounds preset before rendering.
  // The flag is intentionally NOT cleared here: a deep-link load renders once
  // immediately and again after prep reflows the page, and we want the second
  // render to re-scroll to the settled position. The caller that set the flag
  // clears it once the view is settled (fetchGame after prep, applyHashRoute
  // for the already-loaded case).
  if (state.scrollToMistakeId && state.reviewLinkedMistake) {
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

// --- Toggles for group panels (trends + top-mistakes) ---

function toggleGameMistakes(grpId) {
  const panel = document.getElementById(`game-mistakes-${grpId}`);
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
