// Single-mistake card: header + hand + board + EV table + annotation note +
// category-report row. Used by game-list (filtered & rounds views), trends
// (top-mistakes panel), and the "open as user" admin flow.

// Expand a stored round name ("E1", "S3-2") into beginner-friendly text
// ("East 1", "South 3 (repeat 2)"). Display only — round names stay in
// their compact form everywhere they act as keys (data-round, annotation
// saves, deep links).
const ROUND_WIND_NAMES = { E: "East", S: "South", W: "West", N: "North" };

function formatRoundLabel(name) {
  if (!name) return "";
  const mt = /^([ESWN])(\d+)(?:-(\d+))?$/.exec(name);
  if (!mt) return name;
  let label = `${ROUND_WIND_NAMES[mt[1]]} ${mt[2]}`;
  if (mt[3] && mt[3] !== "0") label += ` (repeat ${mt[3]})`;
  return label;
}

// Mistake turns are junme = the player's draw count at decision time, so the
// first discard cycle is already 1. A junme of 0 is a call decision on an
// opponent's discard before the player's first draw — still the round's
// first go-around, so clamp it up to 1 for display.
function formatTurnNumber(turn) {
  return Math.max(turn, 1);
}

function formatTurnBadge(turn) {
  return `<span class="turn-num" title="The discard cycle this happened on — turn 1 is the round's first go-around.">Turn ${formatTurnNumber(turn)}</span>`;
}

const EV_LOSS_TOOLTIP = "Expected value lost: how far this play falls below Mortal's (the AI) best option, in points of expected score. Bigger = more costly.";

// True when Mortal's recommended discard leaves the hand at a worse
// (higher) shanten than the user's actual discard. Comparing ukeire across
// different shanten levels is meaningless, so the categorizer skips P2
// here — surface that fact in the UI so the student knows Mortal's pick
// isn't a tile-efficiency call. Returns the per-tile shanten data when it
// fires, null otherwise.
//
// Also fires for 5A (Bad Riichi): if the player declared riichi but Mortal
// recommends a dahai that *raises* shanten, Mortal isn't just suggesting
// dama — it would rather break tenpai for a better wait, value, or safer
// shape. The user's effective discard is the tile they threw with riichi
// (stored on the mistake as `actual_riichi_tile`).
function mortalRaisedShanten(m) {
  if (!m || !m.discard_stats || !m.actual || !m.expected) return null;
  let userTile = null;
  let mortalTile = null;
  if (m.actual.type === "dahai" && m.expected.type === "dahai") {
    userTile = m.actual.pai;
    mortalTile = m.expected.pai;
  } else if (m.actual.type === "reach" && m.expected.type === "dahai") {
    // Bad riichi — the riichi tile is the user's effective discard.
    userTile = m.actual_riichi_tile || m.actual.pai;
    mortalTile = m.expected.pai;
  } else {
    return null;
  }
  if (!userTile || !mortalTile) return null;
  const find = (t) => {
    const base = t.replace(/r$/, "");
    for (const s of m.discard_stats) {
      const sb = s.tile.replace(/r$/, "");
      if (s.tile === t || sb === base) return s;
    }
    return null;
  };
  const u = find(userTile);
  const ml = find(mortalTile);
  if (!u || !ml) return null;
  if (u.shanten == null || ml.shanten == null) return null;
  if (ml.shanten <= u.shanten) return null;
  return { userTile, mortalTile, userSh: u.shanten, mortalSh: ml.shanten };
}

var handComparisonContexts = new Map();
var handComparisonKey = 0;
var handComparisonCleanupPending = false;

function registerHandComparison(m) {
  const key = ++handComparisonKey;
  handComparisonContexts.set(String(key), m);
  if (!handComparisonCleanupPending && typeof requestAnimationFrame === "function") {
    handComparisonCleanupPending = true;
    requestAnimationFrame(() => {
      const mounted = new Set([...document.querySelectorAll('[data-comparison-key]')]
        .map(el => el.dataset.comparisonKey));
      for (const oldKey of handComparisonContexts.keys()) {
        if (!mounted.has(oldKey)) handComparisonContexts.delete(oldKey);
      }
      handComparisonCleanupPending = false;
    });
  }
  return key;
}

function selectHandComparison(el) {
  const m = handComparisonContexts.get(el.dataset.comparisonKey);
  const card = el.closest('.mistake');
  const comparison = card?.querySelector('.ev-comparison');
  const tile = el.dataset.choiceTile;
  if (!m || !comparison || !m.hand.includes(tile)) return;
  const actualTile = m.actual?.type === "reach" ? m.actual_riichi_tile || m.actual.pai : m.actual?.pai;
  const selectedTile = tile === actualTile ? null : tile;
  comparison.outerHTML = renderEvComparison(m, { selectedTile });
  const handRow = card.querySelector(".hand-row");
  if (handRow) handRow.dataset.selectedTile = selectedTile || "";
  for (const button of card.querySelectorAll('.hand-choice-button')) {
    button.setAttribute('aria-pressed', String(selectedTile != null && button.dataset.choiceTile === tile));
  }
}

function renderMistakeCard(m, opts = {}) {
  const blockChoices = typeof haipaiBlockViewPrep !== "undefined" && haipaiBlockViewPrep.canGroup(m);
  const selectableHand = m.top_actions?.length && m.discard_stats?.length
    && m.actual?.type !== "hora" && m.expected?.type !== "hora";
  const comparisonKey = blockChoices || selectableHand ? registerHandComparison(m) : null;
  const showDate = opts.gameDate;
  const showLink = opts.gameId && !opts.inline;
  const sc = sevClass(m);
  const doraTiles = getDoraTiles(m.board_state);
  // Arm the ambient active-dora set for the whole card so every renderTile()
  // here — action chips, hand, melds, board, EV table — auto-highlights dora.
  setActiveDora(doraTiles, m.board_state);

  // Outline colour follows the skill area (Attack/Defense/Open Defense/Meld/
  // Riichi/Kan) instead of severity — tells the student at a glance which skill
  // area the card is about. Severity stays visible via the tier badge + EV
  // number.
  const catGrpColor = m.skillArea ? skillAreaColor(m.skillArea) : null;
  const cardStyle = catGrpColor ? ` style="border-left-color:${catGrpColor}"` : "";
  const locationAttrs = opts.inline
    ? ` data-game="${opts.gameId}" data-round="${escapeHtml(opts.round)}" data-turn="${m.turn}" data-index="${opts.index}"` : "";
  let html = `<div class="mistake ${sc}"${cardStyle}${locationAttrs}${m.id ? ` data-mid="${m.id}"` : ""}>`;
  html += `<div class="mistake-top">`;
  if (showDate) {
    const d = new Date(showDate + "T00:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric"});
    html += `<span class="mistake-date">${d}</span>`;
  }
  const roundName = opts.round || m.round_name;
  if (roundName) html += `<span class="round-label">${escapeHtml(formatRoundLabel(roundName))}</span>`;
  if (m.is_all_last) {
    html += `<span class="all-last-badge" title="Final round of the hand — placement matters more than raw EV here.">All last</span>`;
  }
  html += formatTurnBadge(m.turn);
  html += `<span class="severity ${sc}" title="${EV_LOSS_TOOLTIP} ${sevTooltip(m)}">${m.ev_loss.toFixed(2)} EV (${sevLabel(m)})</span>`;
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
  if (m.id) {
    html += `<a class="dev-id mistake-permalink" href="#m${m.id}" data-action="openHash" title="Deep-link to this mistake">#m${m.id}</a>`;
  }
  if (showLink && !m.id) {
    // Cards without a stored mistake ID can still open their game.
    html += `<span class="mistake-link" data-action="fetchGame" data-game-id="${opts.gameId}">View game</span>`;
  }
  html += `</div>`;

  if (m.hand && m.hand.length) {
    html += `<div class="hand-row${m.win_context ? " win-opportunity-hand" : ""}"`
      + (comparisonKey ? ` data-comparison-key="${comparisonKey}"` : "") + ` role="group" aria-label="Hand">`;
    if (blockChoices) html += renderHandBlockControls();
    html += `<span class="tiles hand-normal-tiles">${renderHand(m.hand, m.draw, m,
      selectableHand ? comparisonKey : null)}</span>`;
    if (blockChoices) html += `<div class="block-view-body" hidden aria-live="polite"></div>`;
    if (m.win_context && !m.win_context.tsumo) {
      html += `<span class="win-incoming"><span class="label">Opponent discard</span>`
        + renderTile(m.win_context.tile) + `</span>`;
    }
    if (m.melds && m.melds.length) {
      const playerSeat = mistakeActorSeat(m);
      const oya = mistakeOya(m);
      html += `<span class="inline-melds">`;
      for (const meld of m.melds) html += renderMeld(meld, "action-tile-sm", playerSeat, doraTiles, oya) + " ";
      html += `</span>`;
    }
    html += renderDoraSection(m.board_state);
    html += `</div>`;
  } else {
    html += renderDoraSection(m.board_state);
  }
  html += renderBoardContext(m);
  html += renderTenpaiWaitsRow(m);
  if (m.top_actions && m.top_actions.length
      && (m.discard_stats?.length || m.actual?.type === "hora" || m.expected?.type === "hora")) {
    html += renderEvComparison(m);
  } else if (m.top_actions && m.top_actions.length) {
    html += `<div class="top-actions">`;
    for (const a of m.top_actions) {
      html += `<span class="top-action">${renderAction(a.action)} <b>${a.q_value.toFixed(2)}</b></span>`;
    }
    html += `</div>`;
  }

  if (opts.inline) html += trainerBubbleHtml(m);

  // Note input + report row — shared between filtered and rounds views.
  // Both read/write the same mistake objects via state.currentGameData,
  // so edits in one view propagate to the other on re-render.
  if (opts.annotate && opts.gameId && opts.round != null && opts.index != null) {
    const attrs = `data-game="${opts.gameId}" data-round="${opts.round}" data-turn="${m.turn}" data-index="${opts.index}"`;
    html += `<div class="note-row">
      <input type="text" class="note-input" placeholder="Add a note..."
             value="${(m.note || "").replace(/"/g, "&quot;")}"
             data-change-action="onAnnotate" ${attrs}>
      <span class="save-indicator">Saved</span>
    </div>`;
    if (m.id) html += renderReportRow(m);
  }

  html += `</div>`;
  return html;
}

// --- Annotation handler ---

var annotateTimers = {};

function onAnnotate(el) {
  const gameId = parseInt(el.dataset.game);
  const round = el.dataset.round;
  const turn = parseInt(el.dataset.turn);
  const index = parseInt(el.dataset.index);
  const key = `${gameId}-${round}-${turn}-${index}`;

  // Find note input
  const row = el.closest(".note-row");
  const input = row.querySelector("input");
  const indicator = row.querySelector(".save-indicator");

  // Debounce
  clearTimeout(annotateTimers[key]);
  annotateTimers[key] = setTimeout(async () => {
    const note = input.value;

    const rnd = state.currentGameData.rounds.find(r => r.round === round);
    if (rnd) {
      const candidates = rnd.mistakes.filter(m => m.turn === turn);
      if (candidates[index]) {
        candidates[index].note = note || null;
      }
    }

    await saveAnnotation(gameId, round, turn, index, note);
    indicator.classList.add("show");
    setTimeout(() => indicator.classList.remove("show"), 1200);
  }, 400);
}

// --- Category report handlers ---

// Quick-tags offered on the complex-gap funnel (EXTRAS-A). Keys are stored
// comma-joined in the report's `suggested_category` column; labels are the
// candidate dimensions a clustered backlog would build next.
const COMPLEX_GAP_TAGS = [
  { key: "wait_quality", label: "Wait quality" },
  { key: "score_pressure", label: "Score pressure" },
  { key: "safe_tile_mgmt", label: "Safe-tile mgmt" },
  { key: "shape", label: "Shape" },
];

// The mistake-correctness report row (the `wrong_text` kind — the explanation
// reads wrong). Complex cards get no row here: their EXTRAS-A feedback funnel
// lives inside the trainer's speech bubble instead (`renderComplexGapFunnel`,
// embedded by `trainerBubbleHtml`), where it's far more visible. The old
// `wrong_category` kind retired with the category codes (CORE Phase 3); existing
// rows stay readable in admin as historical text.
function renderReportRow(m) {
  if (m.shape === "complex") return "";
  const rep = m.my_report || null;
  const kind = rep ? rep.kind : null;
  const detailsOpen = kind === "wrong_text";
  const reason = (rep && rep.reason) || "";

  function btn(k, label, tip) {
    const active = kind === k ? " active" : "";
    return `<button type="button" class="report-btn report-btn-${k}${active}"
                    data-mid="${m.id}" data-kind="${k}"
                    title="${tip}"
                    data-action="onReportClick">${label}</button>`;
  }

  // "Undo" only shows once a report exists — gives misclickers an explicit
  // out without cluttering the row before they've reported anything.
  const undoBtn = rep
    ? `<button type="button" class="report-undo" data-mid="${m.id}"
               title="Remove this report"
               data-action="onReportClear">Undo</button>`
    : "";
  let html = `<div class="report-row" data-mid="${m.id}">
    <span class="report-ask">Was this explanation right?</span>
    ${btn("wrong_text", "Explanation wrong", "The explanation is off for this mistake")}
    ${undoBtn}
    <span class="report-status"></span>
    <div class="report-details" style="display:${detailsOpen ? "" : "none"}">`;

  html += `<input type="text" class="report-reason"
                  placeholder="Why? (optional)" maxlength="500"
                  value="${reason.replace(/"/g, "&quot;")}"
                  data-mid="${m.id}" data-change-action="onReportDetails">`;
  html += `</div></div>`;
  return html;
}

// The Haipai trainer's speech bubble: the teaching text plus, on complex cards,
// the embedded complex-gap feedback funnel. A complex card is where our visible
// stats can't explain Mortal's pick — so right where the trainer admits that,
// we ask the player to teach us. Only the game-detail render paths use this;
// admin / trends build their own non-interactive bubbles.
function trainerBubbleHtml(m) {
  const explanation = generateExplanation(m);
  const funnel = (!state.readOnly && m.shape === "complex" && m.id) ? renderComplexGapFunnel(m) : "";
  if (!explanation && !funnel) return "";
  return `<div class="mascot-speech">`
    + `<img src="/static/mascot.svg" class="mascot-avatar" alt="">`
    + `<div class="speech-bubble">${explanation}${funnel}</div></div>`;
}

// The complex-gap feedback funnel (EXTRAS-A.1), embedded in the trainer bubble
// just under the "the stats don't explain it — trust the read" line. Multi-select
// quick-tags + free text, written to `category_reports` under the `complex_gap`
// kind (tags ride in `suggested_category`, free text in `reason`). The container
// keeps the `report-row` class so the shared save/clear handlers (which key off
// `.report-row[data-mid]`) work unchanged.
function renderComplexGapFunnel(m) {
  const rep = (m.my_report && m.my_report.kind === "complex_gap") ? m.my_report : null;
  const activeTags = new Set(
    (rep && rep.suggested_category ? rep.suggested_category.split(",") : [])
      .map(s => s.trim()).filter(Boolean)
  );
  const reason = (rep && rep.reason) || "";
  const undoBtn = rep
    ? `<button type="button" class="report-undo" data-mid="${m.id}"
               title="Remove this feedback"
               data-action="onReportClear">Undo</button>`
    : "";

  let html = `<div class="report-row complex-gap-row" data-mid="${m.id}">
    <div class="complex-gap-prompt">We can't pin down what Mortal read here — can
      you? <span class="complex-gap-help">Tag it or tell us; it helps us build the
      stat we're missing.</span></div>
    <div class="complex-gap-tags">`;
  for (const t of COMPLEX_GAP_TAGS) {
    const active = activeTags.has(t.key) ? " active" : "";
    html += `<button type="button" class="complex-tag${active}"
                     data-mid="${m.id}" data-tag="${t.key}"
                     data-action="onComplexTag">${t.label}</button>`;
  }
  html += `</div>
    <div class="complex-gap-input">
      <input type="text" class="report-reason complex-gap-reason"
             placeholder="Your read (optional)…" maxlength="500"
             value="${reason.replace(/"/g, "&quot;")}"
             data-mid="${m.id}" data-change-action="onComplexReason">
      ${undoBtn}
      <span class="report-status"></span>
    </div>
  </div>`;
  return html;
}

function _findMistakeById(mid) {
  if (typeof coinGain !== "undefined") {
    const hand = coinGain.hands.find(h => h.id === mid);
    if (hand) return hand.mistake;
  }
  if (!state.currentGameData) return null;
  for (const rnd of state.currentGameData.rounds || []) {
    for (const m of rnd.mistakes || []) {
      if (m.id === mid) return m;
    }
  }
  return null;
}

function _complexGapState(mid) {
  const row = document.querySelector(`.report-row[data-mid="${mid}"]`);
  if (!row) return null;
  const tags = [...row.querySelectorAll(".complex-tag.active")].map(b => b.dataset.tag);
  const reason = row.querySelector(".complex-gap-reason")?.value?.trim() || "";
  return { row, tags, reason };
}

// Persist (or clear) the funnel. An empty funnel — no tags, no text — stores
// nothing: if a report already exists we delete it, otherwise we no-op.
async function saveComplexGap(mid) {
  const st = _complexGapState(mid);
  if (!st) return;
  if (!st.tags.length && !st.reason) {
    if (_findMistakeById(mid)?.my_report) await onReportClear(mid);
    return;
  }
  const suggested = st.tags.join(",");
  const ok = await saveReport(mid, "complex_gap", suggested, st.reason || null);
  if (ok) {
    // Mirror the save into state so a re-render (tab switch) keeps the
    // selection and the Undo button without a server round-trip.
    const m = _findMistakeById(mid);
    if (m) m.my_report = { kind: "complex_gap", suggested_category: suggested, reason: st.reason || null };
    if (!st.row.querySelector(".report-undo")) {
      const status = st.row.querySelector(".report-status");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "report-undo";
      btn.title = "Remove this feedback";
      btn.dataset.mid = mid;
      btn.dataset.action = "onReportClear";
      btn.textContent = "Undo";
      status.parentNode.insertBefore(btn, status);
    }
  }
}

function onComplexTag(btn, mid) {
  btn.classList.toggle("active");
  saveComplexGap(mid);
}

function onComplexReason(mid) {
  saveComplexGap(mid);
}

async function saveReport(mistakeId, kind, suggested, reason) {
  const row = document.querySelector(`.report-row[data-mid="${mistakeId}"]`);
  const status = row && row.querySelector(".report-status");
  if (status) { status.textContent = "Saving…"; status.className = "report-status saving"; }
  try {
    const res = await apiPost(`/api/mistakes/${mistakeId}/report`,
      {kind, suggested_category: suggested || null, reason: reason || null});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) { status.textContent = body.error || "Error"; status.className = "report-status err"; }
      return false;
    }
    updateCoinBalance(body.balance);
    if (status) {
      status.innerHTML = body.coins_earned > 0
        ? `Saved · <span aria-label="${body.coins_earned.toLocaleString()} community coins">+${body.coins_earned.toLocaleString()} ${coinMark()}</span>` : "Saved";
      status.className = "report-status ok";
    }
    return true;
  } catch (e) {
    if (status) { status.textContent = "Network error"; status.className = "report-status err"; }
    return false;
  }
}

function _reportState(mid) {
  const row = document.querySelector(`.report-row[data-mid="${mid}"]`);
  if (!row) return null;
  const active = row.querySelector(".report-btn.active");
  const suggested = row.querySelector(".report-category")?.value || "";
  const reason = row.querySelector(".report-reason")?.value?.trim() || "";
  return { row, kind: active ? active.dataset.kind : null, suggested, reason };
}

async function onReportClick(btn, mid, kind) {
  const st = _reportState(mid);
  if (!st) return;
  st.row.querySelectorAll(".report-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const details = st.row.querySelector(".report-details");
  if (kind === "wrong_text") {
    details.style.display = "";
    await saveReport(mid, "wrong_text", null, st.reason || null);
  }
}

async function onReportDetails(el, mid) {
  const st = _reportState(mid);
  if (!st || !st.kind) return;
  await saveReport(mid, st.kind, null, st.reason || null);
}

async function onReportClear(mid) {
  const row = document.querySelector(`.report-row[data-mid="${mid}"]`);
  const status = row && row.querySelector(".report-status");
  if (status) { status.textContent = "Clearing…"; status.className = "report-status saving"; }
  try {
    const res = await apiDelete(`/api/mistakes/${mid}/report`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (status) { status.textContent = body.error || "Error"; status.className = "report-status err"; }
      return;
    }
  } catch (e) {
    if (status) { status.textContent = "Network error"; status.className = "report-status err"; }
    return;
  }
  const mistake = _findMistakeById(mid);
  if (mistake) mistake.my_report = null;
  // Drop the report from the in-memory mistake so re-renders match the new state.
  if (state.currentGameData) {
    for (const rnd of state.currentGameData.rounds || []) {
      for (const m of rnd.mistakes || []) {
        if (m.id === mid) m.my_report = null;
      }
    }
  }
  if (row) {
    row.querySelectorAll(".report-btn, .complex-tag").forEach(b => b.classList.remove("active"));
    const details = row.querySelector(".report-details");
    if (details) details.style.display = "none";
    const reasonInput = row.querySelector(".complex-gap-reason");
    if (reasonInput) reasonInput.value = "";
    const undo = row.querySelector(".report-undo");
    if (undo) undo.remove();
  }
  if (status) { status.textContent = "Removed"; status.className = "report-status ok"; }
}

// Severity filtering now lives in the rendered "Filters" panel (the slider in
// game-render.js::renderFiltersPanel), not in toolbar checkboxes.
