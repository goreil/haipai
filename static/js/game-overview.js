// Game-entry state is separate from render/prep state: refreshes never open a
// dismissed overview or reselect the default filter.
const reviewOpeningCache = new Map();

function reviewOpeningPreferences() {
  const key = `${reviewStorageKey()}:opening`;
  if (!reviewOpeningCache.has(key)) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch (_) {}
    reviewOpeningCache.set(key, {
      skipOverview: saved?.skipOverview === true,
      defaultFilter: typeof saved?.defaultFilter === "string" ? saved.defaultFilter : "top5",
    });
  }
  const prefs = reviewOpeningCache.get(key);
  if (!reviewTabs().some(tab => tab.id === prefs.defaultFilter)) prefs.defaultFilter = "top5";
  return prefs;
}

function saveReviewOpeningPreferences(changes) {
  const prefs = reviewOpeningPreferences();
  Object.assign(prefs, changes);
  try {
    localStorage.setItem(`${reviewStorageKey()}:opening`, JSON.stringify(prefs));
    state.reviewOpeningError = "";
  } catch (_) {
    state.reviewOpeningError = "Applied for this session. This browser could not save your preferences.";
  }
}

function changeReviewOpeningPreference(el) {
  saveReviewOpeningPreferences(el.dataset.preference === "skip"
    ? { skipOverview: el.checked } : { defaultFilter: el.value });
  const status = document.getElementById("overview-preference-status");
  if (status) status.textContent = state.reviewOpeningError || "";
}

function beginGameReview(linkedMistake = false) {
  const prefs = reviewOpeningPreferences();
  state.gameView = linkedMistake ? null : prefs.defaultFilter;
  state.reviewLinkedMistake = linkedMistake;
  state.reviewNavigation = null;
  state.overviewOpen = !linkedMistake && !prefs.skipOverview;
}

function openGameOverview() {
  state.overviewOpen = true;
  updateGameOverview();
}

function closeGameOverview(restoreFocus = true) {
  state.overviewOpen = false;
  const dialog = document.getElementById("game-overview-dialog");
  dialog?.close();
  dialog?.remove();
  if (restoreFocus) document.querySelector('[data-action="openGameOverview"]')?.focus({ preventScroll: true });
}

function gameOverviewData(game) {
  const entries = allReviewEntries(game);
  entries.sort(compareReviewEv);
  const rounds = game.rounds.map((round, roundIndex) => ({
    round: round.round, roundIndex,
    ev: round.mistakes.reduce((sum, mistake) => sum + (mistake.ev_loss || 0), 0),
    count: round.mistakes.length,
    decisions: round.decision_count,
  }));
  const worst = rounds.filter(round => round.count).sort((a, b) => b.ev - a.ev || a.roundIndex - b.roundIndex)[0];
  return { top: entries.slice(0, 1), worst };
}

function renderGameOverview(game, topGroup) {
  const { top, worst } = gameOverviewData(game);
  const entry = top[0];
  const badge = entry && mistakeBadge(entry.mistake);
  const custom = reviewTabs().find(tab => !isStandardReviewFilter(tab));
  const prefs = reviewOpeningPreferences();
  // Use the same leader and membership as the Top category tab, including
  // its focused Defense rule. Keep the existing trainer copy and study links.
  const tipAgg = topGroup?.side === "missed" ? { groups: { missed: { [topGroup.group]: topGroup } } } : null;
  const tipBoxes = topGroup?.side === "box"
    ? [{ key: topGroup.group, title: topGroup.meta.label, ev: topGroup.ev }] : [];
  return `<header class="overview-heading">
      <h2 id="overview-title">Game overview</h2>
      <div class="overview-heading-actions">
        <button type="button" class="overview-close" data-action="closeGameOverview" aria-label="Close game overview" autofocus>×</button>
      </div>
    </header>
    ${renderTrainerTip(tipAgg, tipBoxes)}
    <div class="overview-summary">
      <div class="overview-grade"><span>Grade</span>${renderRanking(game.summary, "ranking-large")}</div>
      <div class="overview-highlights">
      ${entry ? `<button type="button" class="overview-mistake overview-choice overview-target"
        style="--overview-color:${escapeHtml(badge?.color || "var(--accent)")}"
        data-action="overviewNavigate" data-view="top5" data-round-index="${entry.roundIndex}" data-position="${entry.position}">
        <span class="overview-choice-main"><span class="overview-label">Worst mistake</span>
          ${badge ? `<span class="cat-badge" style="background:${badge.color}20;color:${badge.color};border:1px solid ${badge.color}40"
            title="${escapeHtml(badge.desc || "")}">${escapeHtml(badge.label)}</span>` : '<strong>Unclassified mistake</strong>'}
          <span class="overview-mistake-location">${escapeHtml(formatRoundLabel(entry.round))} · Turn ${entry.mistake.turn}</span>
        </span>
        <span class="overview-choice-result"><span class="severity ${sevClass(entry.mistake)}" title="${escapeHtml(sevTooltip(entry.mistake))}">${(entry.mistake.ev_loss || 0).toFixed(2)} EV (${sevLabel(entry.mistake)})</span><span aria-hidden="true">›</span></span>
      </button>` : '<div class="overview-choice"><span class="overview-choice-main"><span class="overview-label">Worst mistake</span><span class="overview-empty">No mistakes to review in this game.</span></span></div>'}
      ${topGroup ? `<button type="button" class="overview-category overview-choice overview-target"
        style="--overview-color:${escapeHtml(topGroup.meta.color || "var(--accent)")}"
        data-action="overviewNavigate" data-view="top-group">
        <span class="overview-choice-main"><span class="overview-label">Worst category</span>
          <strong class="overview-category-name">${escapeHtml(topGroup.meta.label)}</strong></span>
        <span class="overview-choice-result"><strong>${topGroup.ev.toFixed(2)} EV</strong><span aria-hidden="true">›</span></span>
      </button>` : '<div class="overview-choice"><span class="overview-choice-main"><span class="overview-label">Worst category</span><span class="overview-empty">No category data yet.</span></span></div>'}
      ${worst ? `<button type="button" class="overview-round overview-choice overview-target" data-action="overviewNavigate"
        data-view="rounds" data-round-index="${worst.roundIndex}">
        <span class="overview-choice-main"><span class="overview-label">Worst round</span><strong>${escapeHtml(formatRoundLabel(worst.round))}</strong></span>
        <span class="overview-choice-result"><span class="overview-round-grade"><span class="overview-label">Grade</span>
          ${renderRanking({ total_decisions: worst.decisions, total_ev_loss: worst.ev }, "ranking-hand")}</span>
          <strong>${worst.ev.toFixed(2)} EV</strong><span aria-hidden="true">›</span></span>
      </button>` : '<div class="overview-choice"><span class="overview-choice-main"><span class="overview-label">Worst round</span><span class="overview-empty">No round with mistakes.</span></span></div>'}
    </div>
    </div>
    ${custom ? `<div class="overview-shortcuts"><button type="button" class="overview-shortcut overview-target" data-action="overviewNavigate" data-view="${escapeHtml(custom.id)}">
      <span><span class="overview-label">Custom filter</span><strong>${escapeHtml(custom.name)}</strong></span><span aria-hidden="true">›</span>
    </button></div>` : ""}
    <footer class="overview-preferences">
      <label class="overview-skip"><input type="checkbox" data-change-action="changeReviewOpeningPreference" data-preference="skip"
        ${prefs.skipOverview ? "checked" : ""}> Skip overview when opening games</label>
      <label class="overview-default">Default filter
        <select data-change-action="changeReviewOpeningPreference" data-preference="default">
          ${reviewTabs().map(tab => `<option value="${escapeHtml(tab.id)}" ${tab.id === prefs.defaultFilter ? "selected" : ""}>${escapeHtml(reviewTabName(tab))}</option>`).join("")}
        </select>
      </label>
      <p id="overview-preference-status" role="status">${escapeHtml(state.reviewOpeningError || "")}</p>
    </footer>`;
}

function updateGameOverview() {
  if (!state.overviewOpen) {
    closeGameOverview(false);
    return;
  }
  let dialog = document.getElementById("game-overview-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "game-overview-dialog";
    dialog.className = "game-overview-dialog";
    dialog.setAttribute("aria-labelledby", "overview-title");
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeGameOverview();
    });
    document.body.append(dialog);
  }
  const active = dialog.contains(document.activeElement) ? document.activeElement : null;
  const identity = active ? JSON.stringify(active.dataset) : null;
  const scrollTop = dialog.scrollTop;
  dialog.innerHTML = renderGameOverview(state.currentGameData, state.reviewTopGroup);
  if (!dialog.open) dialog.showModal();
  else if (identity) {
    const replacement = [...dialog.querySelectorAll("button, input, select, a")]
      .find(el => JSON.stringify(el.dataset) === identity);
    (replacement || dialog.querySelector("button"))?.focus({ preventScroll: true });
  }
  dialog.scrollTop = scrollTop;
}

function overviewNavigate(el) {
  const view = el.dataset.view;
  if (!reviewTabs().some(tab => tab.id === view)) return;
  closeGameOverview(false);
  state.gameView = view;
  state.reviewLinkedMistake = false;
  state.reviewNavigation = null;
  expandedHandMistakes.delete(state.currentGameData);
  if (view === "rounds") {
    // Keep this visit chronological/unlimited across prep refreshes. Switching
    // tabs or editing options ends the override; saved Rounds settings survive.
    state.reviewNavigation = { view, sort: "round", limit: 0, roundIndex: Number(el.dataset.roundIndex), pending: true };
  } else if (view === "top5" && el.dataset.position != null) {
    state.reviewNavigation = {
      view, sort: activeReviewTab().sort, limit: activeReviewTab().limit,
      roundIndex: Number(el.dataset.roundIndex), position: Number(el.dataset.position), pending: true,
    };
  }
  renderGame();
  focusReviewTab(view);
}

function scrollReviewNavigation() {
  const nav = state.reviewNavigation;
  if (!nav?.pending || nav.roundIndex == null) return;
  requestAnimationFrame(() => {
    if (state.reviewNavigation !== nav) return;
    const entry = nav.position == null ? null : allReviewEntries(state.currentGameData)
      .find(item => item.roundIndex === nav.roundIndex && item.position === nav.position);
    const target = entry
      ? [...document.querySelectorAll(".mistake[data-round]")]
        .find(el => el.dataset.round === entry.round && Number(el.dataset.turn) === entry.mistake.turn
          && Number(el.dataset.index) === entry.index)
      : document.getElementById(`game-round-${nav.roundIndex}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!state.prepProgress) nav.pending = false;
  });
}
