// Browser-local filters. Standards stay first and only their count/sort are editable.
// Only preferences are persisted, never game data.
const REVIEW_STANDARD_NAMES = { top5: "Top 5 mistakes", "top-group": "Top category", rounds: "Rounds" };
let reviewTabCache = null;
let reviewTabCacheKey = null;
let reviewLastTabClick = null;
let reviewTabDrag = null;
let reviewDragSuppressUntil = 0;

function reviewStorageKey(version = 2) {
  const user = window._meData;
  return `haipai.review-filters.v${version}:${user?.id || user?.username || "guest"}`;
}

function standardReviewFilter(kind, id = kind) {
  return {
    id, name: REVIEW_STANDARD_NAMES[kind], severity: kind === "rounds" ? null : 3,
    sort: kind === "rounds" ? "round" : "ev", limit: kind === "rounds" ? 0 : 5,
    topics: [], topGroup: kind === "top-group",
  };
}

function validReviewFilter(f) {
  return f && typeof f.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(f.id)
    && typeof f.name === "string" && !!f.name.trim() && f.name.length <= 48
    && (f.severity === null || (Number.isInteger(f.severity) && f.severity >= 0 && f.severity <= 3))
    && ["round", "ev"].includes(f.sort) && [0, 5, 10, 20].includes(f.limit)
    && typeof f.topGroup === "boolean" && Array.isArray(f.topics) && f.topics.length <= 100
    && f.topics.every(t => t && ["missed", "you", "tradeoff"].includes(t.side)
      && typeof t.group === "string" && t.group.length <= 80
      && (t.dim == null || (typeof t.dim === "string" && t.dim.length <= 80)));
}

function reviewTabs() {
  const key = reviewStorageKey();
  if (reviewTabCacheKey === key && reviewTabCache) return reviewTabCache;
  reviewTabCacheKey = key;
  reviewTabCache = Object.keys(REVIEW_STANDARD_NAMES).map(kind => standardReviewFilter(kind));
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null && stored !== undefined) {
      const tabs = JSON.parse(stored);
      if (!Array.isArray(tabs)) return reviewTabCache;
      const ids = new Set();
      reviewTabCache = tabs.filter(f => {
        if (!validReviewFilter(f) || ids.has(f.id)) return false;
        ids.add(f.id);
        return true;
      }).slice(0, 53); // Up to 50 legacy tabs plus three restored standards.
    } else {
      // Keep existing custom filters when upgrading from the previous UI.
      const old = JSON.parse(localStorage.getItem(reviewStorageKey(1)) || "[]");
      if (Array.isArray(old)) {
        const ids = new Set(reviewTabCache.map(f => f.id));
        for (const f of old) {
          const migrated = { ...f, id: `saved-${f?.id}`, topGroup: false };
          if (!validReviewFilter(migrated) || ids.has(migrated.id)) continue;
          ids.add(migrated.id);
          reviewTabCache.push(migrated);
          if (reviewTabCache.length === 50) break;
        }
      }
    }
  } catch (_) {
    // Keep this session usable if storage is unavailable or contains bad JSON.
  }
  // Restore missing standards and their fixed rules without losing custom tabs.
  // Existing standard IDs retain only the two settings that remain editable.
  const standards = Object.keys(REVIEW_STANDARD_NAMES).map(kind => {
    const saved = reviewTabCache.find(f => f.id === kind);
    return { ...standardReviewFilter(kind), ...(saved ? { sort: saved.sort, limit: saved.limit } : {}) };
  });
  reviewTabCache = [...standards, ...reviewTabCache.filter(f => !isStandardReviewFilter(f))];
  return reviewTabCache;
}

function isStandardReviewFilter(tab) {
  return !!tab && Object.hasOwn(REVIEW_STANDARD_NAMES, tab.id);
}

function resetStandardReviewFilter() {
  const tab = activeReviewTab();
  if (!isStandardReviewFilter(tab)) return;
  state.reviewNavigation = null;
  const defaults = standardReviewFilter(tab.id);
  saveActiveReviewFilter({ sort: defaults.sort, limit: defaults.limit });
  renderGame();
}

function persistReviewTabs() {
  try {
    localStorage.setItem(reviewStorageKey(), JSON.stringify(reviewTabs()));
    state.reviewFilterError = "";
  } catch (_) {
    state.reviewFilterError = "Changes apply for this session, but this browser could not save your tabs.";
  }
}

function activeReviewTab() {
  return reviewTabs().find(f => f.id === state.gameView) || null;
}

function syncReviewFilter(topGroup) {
  state.reviewTopGroup = topGroup;
  if (state.reviewLinkedMistake) {
    state.sevLevel = 3;
    state.reviewSort = "round";
    state.reviewLimit = 0;
    state.conceptFilters = [];
    return;
  }
  let tab = activeReviewTab();
  if (!tab) {
    tab = reviewTabs()[0];
    state.gameView = tab?.id || null;
  }
  if (!tab) return;
  state.sevLevel = tab.severity ?? 3;
  if (tab.severity === null) autoSetSeverityFilters(state.currentGameData);
  if (state.reviewNavigation?.topics) state.sevLevel = 3;
  state.reviewSort = state.reviewNavigation?.view === tab.id ? state.reviewNavigation.sort : tab.sort;
  state.reviewLimit = state.reviewNavigation?.view === tab.id ? state.reviewNavigation.limit : tab.limit;
  state.conceptFilters = state.reviewNavigation?.topics || (tab.topGroup
    ? (topGroup ? [reviewTopGroupFilter(topGroup)] : [])
    : tab.topics.map(f => ({ ...f })));
}

function saveActiveReviewFilter(changes) {
  const tab = activeReviewTab();
  if (!tab) return;
  if (isStandardReviewFilter(tab)) {
    if (["ev", "round"].includes(changes.sort)) tab.sort = changes.sort;
    if ([0, 5, 10, 20].includes(changes.limit)) tab.limit = changes.limit;
  } else {
    Object.assign(tab, changes);
    if (changes.topics) tab.topics = changes.topics.map(f => ({ ...f }));
  }
  expandedHandMistakes.delete(state.currentGameData);
  persistReviewTabs();
}

function changeReviewOption(el) {
  state.reviewNavigation = null;
  if (el.dataset.reviewOption === "sort") {
    state.reviewSort = el.value === "round" ? "round" : "ev";
    saveActiveReviewFilter({ sort: state.reviewSort });
  }
  if (el.dataset.reviewOption === "limit") {
    const limit = Number(el.value);
    state.reviewLimit = [0, 5, 10, 20].includes(limit) ? limit : 0;
    saveActiveReviewFilter({ limit: state.reviewLimit });
  }
  renderGame();
}

function switchGameView(view) {
  if (!reviewTabs().some(f => f.id === view)) return;
  if (view === state.gameView && !state.reviewLinkedMistake && !state.reviewNavigation) return;
  state.reviewNavigation = null;
  state.gameView = view;
  state.reviewLinkedMistake = false;
  expandedHandMistakes.delete(state.currentGameData);
  renderGame();
}

function reviewTabName(tab) {
  if (tab.id === "top5") return tab.limit ? `Top ${tab.limit} mistakes` : "Top mistakes · All";
  return tab.name;
}

function addReviewFilter(kind) {
  if (kind !== "new") return;
  if (reviewTabs().length >= 50) {
    state.reviewFilterError = "You can keep up to 50 filters. Remove one to add another.";
    renderGame();
    return;
  }
  const id = crypto.randomUUID();
  const tab = { id, name: "New filter", severity: 3, sort: "round", limit: 0, topics: [], topGroup: false };
  reviewTabs().push(tab);
  persistReviewTabs();
  state.gameView = id;
  state.reviewLinkedMistake = false;
  state.reviewNavigation = null;
  openReviewFilters();
  renderGame();
  beginReviewRename(id);
}

function deleteReviewFilter(id) {
  const tabs = reviewTabs();
  const index = tabs.findIndex(f => f.id === id);
  if (index < 0 || isStandardReviewFilter(tabs[index])) return;
  const wasDefault = reviewOpeningPreferences().defaultFilter === id;
  tabs.splice(index, 1);
  if (wasDefault) saveReviewOpeningPreferences({ defaultFilter: "top5" });
  if (state.gameView === id) state.gameView = tabs[Math.min(index, tabs.length - 1)]?.id || null;
  persistReviewTabs();
  renderGame();
  focusReviewTab(state.gameView);
}

function moveReviewTab(id, targetId, after = false) {
  const tabs = reviewTabs();
  const from = tabs.findIndex(f => f.id === id);
  if (from < 0 || id === targetId || isStandardReviewFilter(tabs[from])
      || !tabs.some(f => f.id === targetId && !isStandardReviewFilter(f))) return;
  const [tab] = tabs.splice(from, 1);
  const to = tabs.findIndex(f => f.id === targetId) + (after ? 1 : 0);
  tabs.splice(to, 0, tab);
  persistReviewTabs();
  renderGame();
  focusReviewTab(id);
}

function focusReviewTab(id) {
  const tab = document.querySelector(`[data-action="selectReviewTab"][data-view="${id}"]`);
  (tab || document.querySelector('[data-action="addReviewFilter"]'))?.focus({ preventScroll: true });
}

function selectReviewTab(el, event) {
  if (Date.now() < reviewDragSuppressUntil) return;
  const id = el.dataset.view;
  const now = Date.now();
  // Switching tabs re-renders the label between clicks. Remember its identity
  // so a double-click also renames an initially inactive tab.
  if (event.detail === 2 || (event.detail && reviewLastTabClick?.id === id && now - reviewLastTabClick.time < 400)) {
    reviewLastTabClick = null;
    beginReviewRename(id);
    return;
  }
  reviewLastTabClick = event.detail ? { id, time: now } : null;
  switchGameView(id);
}

function beginReviewRename(id) {
  const tab = reviewTabs().find(f => f.id === id);
  if (isStandardReviewFilter(tab)) return;
  if (tab && (state.gameView !== id || state.reviewLinkedMistake)) switchGameView(id);
  const button = document.querySelector(`[data-action="selectReviewTab"][data-view="${id}"]`);
  if (!tab || !button) return;
  const input = document.createElement("input");
  input.type = "text";
  input.value = tab.name;
  input.maxLength = 48;
  input.className = "review-tab-name-input";
  input.dataset.renameReviewTab = id;
  input.setAttribute("aria-label", "Filter name");
  button.replaceWith(input);
  input.focus();
  input.select();
}

function finishReviewRename(input, cancel = false, blurred = false) {
  if (!input.isConnected) return;
  const tab = reviewTabs().find(f => f.id === input.dataset.renameReviewTab);
  const name = input.value.trim();
  if (tab && !isStandardReviewFilter(tab) && name && !cancel) {
    tab.name = name;
    persistReviewTabs();
  }
  // Mark it finished before rebuilding the page, which can trigger blur.
  delete input.dataset.renameReviewTab;
  if (blurred && tab) {
    // Keep the clicked control connected: rebuilding the nav on blur would
    // swallow a following click on another tab, its ×, or New filter.
    const template = document.createElement("template");
    template.innerHTML = renderReviewTabs(state.reviewTopGroup);
    const next = template.content.querySelector(`[data-action="selectReviewTab"][data-view="${tab.id}"]`);
    input.replaceWith(next);
    const close = next.closest(".review-tab").querySelector(".review-tab-close");
    close.setAttribute("aria-label", `Delete ${reviewTabName(tab)}`);
    const nav = document.querySelector(".game-review-nav");
    const notice = nav.nextElementSibling?.matches(".review-filter-error") ? nav.nextElementSibling : null;
    if (state.reviewFilterError) {
      const message = notice || document.createElement("p");
      message.className = "review-filter-error";
      message.setAttribute("role", "alert");
      message.textContent = state.reviewFilterError;
      if (!notice) nav.after(message);
    } else {
      notice?.remove();
    }
    return;
  }
  renderGame();
  focusReviewTab(tab?.id);
}

function renderReviewTabs(topGroup) {
  const tabs = reviewTabs();
  return `<nav class="game-review-nav" aria-label="Mistake filters"><div class="game-tabs">
    ${tabs.map(tab => {
      const name = escapeHtml(reviewTabName(tab, topGroup));
      const id = escapeHtml(tab.id);
      const active = !state.reviewLinkedMistake && state.gameView === tab.id;
      return `<div class="review-tab ${active ? "active" : ""}" data-review-tab="${id}">
        ${isStandardReviewFilter(tab) ? "" : `<button type="button" class="review-tab-handle" aria-label="Reorder ${name}"
          title="Drag to reorder. Alt + Left or Right also moves this tab." data-reorder-review-tab="${id}">⠿</button>`}
        <button type="button" class="game-tab" data-action="selectReviewTab" data-view="${id}"
          ${active ? 'aria-current="page"' : ""}
          title="${isStandardReviewFilter(tab) ? "Standard filter: edit count and sorting in Filters." : "Double-click to rename; F2 also works."}">${name}</button>
        ${isStandardReviewFilter(tab) ? "" : `<button type="button" class="review-tab-close" data-action="deleteReviewFilter" data-view="${id}"
          aria-label="Delete ${name}" title="Delete filter">×</button>`}
      </div>`;
    }).join("")}
    <button type="button" class="game-tab review-add-new"
      data-action="addReviewFilter" data-kind="new">+ New filter</button>
  </div></nav>
  ${state.reviewFilterError ? `<p class="review-filter-error" role="alert">${escapeHtml(state.reviewFilterError)}</p>` : ""}`;
}

function reviewTabPointerDown(event) {
  const tab = event.target.closest(".review-tab");
  if (!tab || isStandardReviewFilter({ id: tab.dataset.reviewTab }) || event.button !== 0
      || event.isPrimary === false || event.target.closest("input, .review-tab-close")) return;
  if (event.pointerType !== "mouse" && !event.target.closest(".review-tab-handle")) return;
  reviewTabDrag = { id: tab.dataset.reviewTab, element: tab, pointerId: event.pointerId,
    x: event.clientX, y: event.clientY, moving: false };
}

function reviewTabPointerMove(event) {
  const drag = reviewTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moving && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
  if (!drag.moving) {
    drag.moving = true;
    drag.element.setPointerCapture(event.pointerId);
    drag.element.classList.add("review-tab-dragging");
  }
  event.preventDefault();
  document.querySelectorAll(".review-tab-drop-before, .review-tab-drop-after")
    .forEach(el => el.classList.remove("review-tab-drop-before", "review-tab-drop-after"));
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".review-tab");
  drag.targetId = null;
  if (!target || target === drag.element || isStandardReviewFilter({ id: target.dataset.reviewTab })) return;
  const rect = target.getBoundingClientRect();
  drag.targetId = target.dataset.reviewTab;
  drag.after = event.clientX > rect.left + rect.width / 2;
  target.classList.add(drag.after ? "review-tab-drop-after" : "review-tab-drop-before");
}

function reviewTabPointerEnd(event) {
  const drag = reviewTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  reviewTabDrag = null;
  drag.element.classList.remove("review-tab-dragging");
  document.querySelectorAll(".review-tab-drop-before, .review-tab-drop-after")
    .forEach(el => el.classList.remove("review-tab-drop-before", "review-tab-drop-after"));
  if (!drag.moving) return;
  reviewDragSuppressUntil = Date.now() + 400;
  if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
  if (event.type !== "pointercancel" && drag.targetId) moveReviewTab(drag.id, drag.targetId, drag.after);
}
