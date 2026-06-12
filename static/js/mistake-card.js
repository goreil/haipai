// Single-mistake card: header + hand + board + EV table + annotation note +
// category-report row. Used by game-list (rounds & summary views), trends
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

// Mistake turns are junme, 0-indexed (first discard cycle = 0) — show them
// 1-based so "Turn 1" means the first go-around like players expect.
function formatTurnBadge(turn) {
  return `<span class="turn-num" title="The discard cycle this happened on — turn 1 is the round's first go-around.">Turn ${turn + 1}</span>`;
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

function renderMistakeCard(m, opts = {}) {
  const showDate = opts.gameDate;
  const showLink = opts.gameId;
  const sc = sevClass(m);
  const doraTiles = getDoraTiles(m.board_state);

  // Outline colour follows the category group (Attack/Defense/Riichi/Meld/Kan)
  // instead of severity — tells the student at a glance which skill area the
  // card is about. Severity stays visible via the tier badge + EV number.
  const catGrpColor = GROUP_COLORS[catGroup(m.category)] || null;
  const cardStyle = catGrpColor ? ` style="border-left-color:${catGrpColor}"` : "";
  let html = `<div class="mistake ${sc}"${cardStyle}>`;
  html += `<div class="mistake-top">`;
  if (showDate) {
    const d = new Date(showDate + "T00:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric"});
    html += `<span class="mistake-date">${d}</span>`;
  }
  if (m.round_name) html += `<span class="round-label">${formatRoundLabel(m.round_name)}</span>`;
  if (m.is_all_last) {
    html += `<span class="all-last-badge" title="Final round of the hand — placement matters more than raw EV here.">All last</span>`;
  }
  html += formatTurnBadge(m.turn);
  if (m.id) html += `<span class="dev-id" title="mistake id">#${m.id}</span>`;
  html += `<span class="severity ${sc}" title="${sevTooltip(m)}">${sevLabel(m)}</span>`;
  html += `<span class="ev-loss" title="${EV_LOSS_TOOLTIP}">${m.ev_loss.toFixed(2)} EV</span>`;
  if (m.category) {
    const grp = catGroup(m.category);
    const color = GROUP_COLORS[grp] || "#888";
    html += `<span class="cat-badge" style="background:${color}20;color:${color};border:1px solid ${color}40" title="${catDesc(m.category)}">${catLabel(m.category)}</span>`;
  }
  if (m.bad_riichi_reason === "furiten") {
    const tip = (m.furiten_tiles || []).length
      ? `Already discarded ${m.furiten_tiles.join(", ")} — can't ron.`
      : "Wait includes a tile you've already discarded — can't ron.";
    html += `<span class="furiten-badge" title="${tip}">Furiten</span>`;
  }
  const raised = mortalRaisedShanten(m);
  if (raised) {
    const reason = m.category === "5A"
      ? `Your ${raised.userTile} keeps ${raised.userSh}-shanten and declares riichi; Mortal's ${raised.mortalTile} goes to ${raised.mortalSh}-shanten — Mortal would rather break tenpai for a better wait, more hand value, or room to defend than lock the hand with riichi.`
      : `Your ${raised.userTile} keeps ${raised.userSh}-shanten; Mortal's ${raised.mortalTile} goes to ${raised.mortalSh}-shanten — Mortal is breaking up the hand for a strategic reason (likely yaku or value), not for tile efficiency.`;
    html += `<span class="raised-shanten-badge" title="${reason}">Mortal raised shanten</span>`;
  }
  if (m.shanten != null) html += `<span class="shanten">${m.shanten}-shanten</span>`;
  if (showLink) {
    // Prefer a stable deep-link to the mistake when we know its id — that
    // updates location.hash so the browser's back button rewinds the jump,
    // and the rounds view scrolls + flashes the target card. Falls back to a
    // plain game fetch for cards without an id (shouldn't happen for stored
    // mistakes, but keep the link from being a dead end).
    if (m.id) {
      html += `<a class="mistake-link" href="#mistake=${m.id}">View mistake</a>`;
    } else {
      html += `<span class="mistake-link" onclick="fetchGame(${showLink})">View game</span>`;
    }
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

  if (m.hand && m.hand.length) {
    html += `<div class="hand-row">
      <span class="label">Hand</span>
            <span class="tiles">${renderHand(m.hand, m.draw, m, doraTiles)}</span>`;
    if (m.melds && m.melds.length) {
      const playerSeat = m.actual ? m.actual.actor : null;
      const oya = mistakeOya(m);
      html += `<span class="inline-melds">`;
      for (const meld of m.melds) html += renderMeld(meld, "action-tile-sm", playerSeat, doraTiles, oya) + " ";
      html += `</span>`;
    }
    html += `</div>`;
  }
  html += renderBoardContext(m);
  html += renderTenpaiWaitsRow(m);
  if (m.top_actions && m.top_actions.length && m.discard_stats && m.discard_stats.length) {
    html += renderEvComparison(m);
  } else if (m.top_actions && m.top_actions.length) {
    html += `<div class="top-actions">`;
    for (const a of m.top_actions) {
      html += `<span class="top-action">${renderAction(a.action)} <b>${a.q_value.toFixed(2)}</b></span>`;
    }
    html += `</div>`;
  }

  // Note input + report row — shared between the rounds view and the summary
  // view. Both read/write the same mistake objects via state.currentGameData,
  // so edits in one view propagate to the other on re-render.
  if (opts.annotate && opts.gameId && opts.round != null && opts.index != null) {
    const attrs = `data-game="${opts.gameId}" data-round="${opts.round}" data-turn="${m.turn}" data-index="${opts.index}"`;
    html += `<div class="note-row">
      <input type="text" class="note-input" placeholder="Add a note..."
             value="${(m.note || "").replace(/"/g, "&quot;")}"
             onchange="onAnnotate(this)" ${attrs}>
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

var REPORT_CATEGORIES = [
  ["P1", "P1 – Shanten Failure"],
  ["P2", "P2 – Tile Efficiency"],
  ["P3", "P3 – Hand Value"],
  ["P4", "P4 – Complex Decision"],
  ["D1", "D1 – Defend"],
  ["D2", "D2 – Push"],
  ["D3", "D3 – Complex"],
  ["4A", "4A – Bad Call"],
  ["4B", "4B – Missed Call"],
  ["4C", "4C – Wrong Choice"],
  ["5A", "5A – Bad Riichi"],
  ["5B", "5B – Missed Riichi"],
  ["6A", "6A – Bad Kan"],
  ["6B", "6B – Missed Kan"],
];

function renderReportRow(m) {
  const rep = m.my_report || null;
  const kind = rep ? rep.kind : null;
  const detailsOpen = kind === "wrong_category" || kind === "wrong_text";
  const suggested = (rep && rep.suggested_category) || "";
  const reason = (rep && rep.reason) || "";

  function btn(k, label, tip) {
    const active = kind === k ? " active" : "";
    return `<button type="button" class="report-btn report-btn-${k}${active}"
                    data-mid="${m.id}" data-kind="${k}"
                    title="${tip}"
                    onclick="onReportClick(this, ${m.id}, '${k}')">${label}</button>`;
  }

  // "Undo" only shows once a report exists — gives misclickers an explicit
  // out without cluttering the row before they've reported anything.
  const undoBtn = rep
    ? `<button type="button" class="report-undo"
               title="Remove this report"
               onclick="onReportClear(${m.id})">Undo</button>`
    : "";
  let html = `<div class="report-row" data-mid="${m.id}">
    <span class="report-ask">Was this right?</span>
    ${btn("wrong_category", "Wrong category", "The category label is wrong")}
    ${btn("wrong_text", "Explanation wrong", "The category is fine but the explanation is off")}
    ${undoBtn}
    <span class="report-status"></span>
    <div class="report-details" style="display:${detailsOpen ? "" : "none"}">`;

  html += `<div class="report-details-cat" style="display:${kind === "wrong_category" ? "" : "none"}">
    <label class="report-details-label">What should it be?</label>
    <select class="report-category" onchange="onReportDetails(this, ${m.id})">
      <option value="">Select correct category…</option>`;
  for (const [code, label] of REPORT_CATEGORIES) {
    html += `<option value="${code}"${suggested === code ? " selected" : ""}>${label}</option>`;
  }
  html += `</select></div>`;

  html += `<input type="text" class="report-reason"
                  placeholder="Why? (optional)" maxlength="500"
                  value="${reason.replace(/"/g, "&quot;")}"
                  onchange="onReportDetails(this, ${m.id})">`;
  html += `</div></div>`;
  return html;
}

async function saveReport(mistakeId, kind, suggested, reason) {
  const row = document.querySelector(`.report-row[data-mid="${mistakeId}"]`);
  const status = row && row.querySelector(".report-status");
  if (status) { status.textContent = "Saving…"; status.className = "report-status saving"; }
  try {
    const res = await fetch(`/api/mistakes/${mistakeId}/report`, {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken},
      body: JSON.stringify({kind, suggested_category: suggested || null, reason: reason || null}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) { status.textContent = body.error || "Error"; status.className = "report-status err"; }
      return false;
    }
    if (status) { status.textContent = "Saved"; status.className = "report-status ok"; }
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
  // Toggle off if already active (lets the user "unsay" their choice, though
  // right now we just re-click same kind as a no-op since saves are cheap).
  st.row.querySelectorAll(".report-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const details = st.row.querySelector(".report-details");
  const catWrap = st.row.querySelector(".report-details-cat");
  if (kind === "wrong_category") {
    details.style.display = "";
    catWrap.style.display = "";
    // Don't save until a category is picked.
    const cat = st.row.querySelector(".report-category").value;
    if (cat) await saveReport(mid, "wrong_category", cat, st.reason || null);
  } else if (kind === "wrong_text") {
    details.style.display = "";
    catWrap.style.display = "none";
    await saveReport(mid, "wrong_text", null, st.reason || null);
  }
}

async function onReportDetails(el, mid) {
  const st = _reportState(mid);
  if (!st || !st.kind) return;
  if (st.kind === "wrong_category" && !st.suggested) return;
  await saveReport(mid, st.kind, st.suggested || null, st.reason || null);
}

async function onReportClear(mid) {
  const row = document.querySelector(`.report-row[data-mid="${mid}"]`);
  const status = row && row.querySelector(".report-status");
  if (status) { status.textContent = "Clearing…"; status.className = "report-status saving"; }
  try {
    const res = await fetch(`/api/mistakes/${mid}/report`, {
      method: "DELETE",
      headers: {"X-CSRFToken": csrfToken},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (status) { status.textContent = body.error || "Error"; status.className = "report-status err"; }
      return;
    }
  } catch (e) {
    if (status) { status.textContent = "Network error"; status.className = "report-status err"; }
    return;
  }
  // Drop the report from the in-memory mistake so re-renders match the new state.
  if (state.currentGameData) {
    for (const rnd of state.currentGameData.rounds || []) {
      for (const m of rnd.mistakes || []) {
        if (m.id === mid) m.my_report = null;
      }
    }
  }
  if (row) {
    row.querySelectorAll(".report-btn").forEach(b => b.classList.remove("active"));
    const details = row.querySelector(".report-details");
    if (details) details.style.display = "none";
    const undo = row.querySelector(".report-undo");
    if (undo) undo.remove();
  }
  if (status) { status.textContent = "Removed"; status.className = "report-status ok"; }
}

// --- Filter handlers (severity checkboxes in the toolbar) ---

function onToggleMistake(cb) {
  state.showMistake = cb.checked;
  if (state.currentGameData) renderGame();
}

function onToggleLight(cb) {
  state.showLight = cb.checked;
  if (state.currentGameData) renderGame();
}

function onToggleUnsure(cb) {
  state.showUnsure = cb.checked;
  if (state.currentGameData) renderGame();
}
