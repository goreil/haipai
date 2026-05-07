// Single-mistake card: header + hand + board + EV table + annotation note +
// category-report row. Used by game-list (rounds & summary views), trends
// (top-mistakes panel), and the "open as user" admin flow.

// True when Mortal's recommended discard leaves the hand at a worse
// (higher) shanten than the user's actual discard. Comparing ukeire across
// different shanten levels is meaningless, so the categorizer skips P2
// here — surface that fact in the UI so the student knows Mortal's pick
// isn't a tile-efficiency call. Returns the per-tile shanten data when it
// fires, null otherwise.
function mortalRaisedShanten(m) {
  if (!m || !m.discard_stats || !m.actual || !m.expected) return null;
  if (m.actual.type !== "dahai" || m.expected.type !== "dahai") return null;
  const userTile = m.actual.pai;
  const mortalTile = m.expected.pai;
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
  if (m.round_name) html += `<span class="round-label">${m.round_name}</span>`;
  html += `<span class="turn-num">T${m.turn}</span>`;
  if (m.id) html += `<span class="dev-id" title="mistake id">#${m.id}</span>`;
  html += `<span class="severity ${sc}" title="${sevTooltip(m)}">${sevLabel(m)}</span>`;
  html += `<span class="ev-loss">${m.ev_loss.toFixed(2)} EV</span>`;
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
    const tip = `Your ${raised.userTile} keeps ${raised.userSh}-shanten; Mortal's ${raised.mortalTile} goes to ${raised.mortalSh}-shanten — Mortal is breaking up the hand for a strategic reason (likely yaku or value), not for tile efficiency.`;
    html += `<span class="raised-shanten-badge" title="${tip}">Mortal raised shanten</span>`;
  }
  if (m.shanten != null) html += `<span class="shanten">${m.shanten}-shanten</span>`;
  if (showLink) html += `<span class="mistake-link" onclick="fetchGame(${showLink})">View game</span>`;
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

    // Look up existing category from local state (don't change it)
    let category = null;
    const rnd = state.currentGameData.rounds.find(r => r.round === round);
    if (rnd) {
      const candidates = rnd.mistakes.filter(m => m.turn === turn);
      if (candidates[index]) {
        category = candidates[index].category;
        candidates[index].note = note || null;
      }
    }

    await saveAnnotation(gameId, round, turn, index, category, note);
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

  let html = `<div class="report-row" data-mid="${m.id}">
    <span class="report-ask">Was this right?</span>
    ${btn("wrong_category", "Wrong category", "The category label is wrong")}
    ${btn("wrong_text", "Explanation wrong", "The category is fine but the explanation is off")}
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
