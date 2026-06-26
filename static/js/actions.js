// Central event-delegation registry. CSP hardening (docs/backlogs/CSP-HARDENING.md):
// the app used to carry inline on*= handler attributes, which force
// `script-src 'unsafe-inline'`. Nonces/hashes can't whitelist on*= attributes
// per CSP spec, so the fix is to remove them. Every former inline handler is
// now a `data-action` (click) or `data-change-action` (change) attribute,
// dispatched here through two document-level listeners.
//
// Why delegation rather than per-element addEventListener: most of these
// handlers live in HTML built as strings and injected via innerHTML, so the
// elements come and go on every render. A single delegated listener on
// `document` catches clicks on nodes that didn't exist when it was attached —
// no rebinding after each render.
//
// Loaded FIRST in index.html. The handler bodies reference global functions
// (fetchGame, onAnnotate, …) by name, resolved lazily at event time, so those
// functions only need to exist when the user actually clicks — not now.

// name -> fn(el, event). `el` is the nearest ancestor carrying the data-action.
var HAIPAI_CLICK_ACTIONS = {
  // --- shell / index.html ---
  navigateHome: () => navigateHome(),
  showAddModal: () => showAddModal(),
  toggleSidebar: () => toggleSidebar(),
  // Tab nav goes through the URL hash (not a direct show*() call) so the view
  // survives reload and the back button steps between tabs. applyHashRoute()
  // turns the resulting hashchange into the actual render. See main.js.
  showTrends: () => navTab("trends"),
  toggleMenu: (el) => el.parentElement.classList.toggle("open"),
  showAccount: () => navTab("account"),
  showHelp: () => navTab("help"),
  showAdmin: () => navTab("admin"),
  adminStopImpersonate: () => adminStopImpersonate(),
  openExternal: (el) => window.open(el.dataset.href, "_blank"),
  hideAddModal: () => hideAddModal(),
  // Backdrop click: only close when the click landed on the overlay itself,
  // not on the modal it contains (matches the old `event.target===this`).
  closeAddModalBackdrop: (el, e) => { if (e.target === el) hideAddModal(); },
  submitAddGame: () => submitAddGame(),
  preventDefault: (el, e) => e.preventDefault(),
  switchTutorial: (el) => switchTutorial(el, el.dataset.tutorialKey),
  regenerateUploadToken: (el, e) => { e.preventDefault(); regenerateUploadToken(); },

  // --- game list / detail (game-render, game-fetch, mistake-card) ---
  fetchGame: (el) => fetchGame(+el.dataset.gameId),
  // Deep-link badge (#g<id> / #m<id>): route through the hash router exactly
  // once. Carrying its own data-action stops the click from also firing a
  // parent's fetchGame (the delegate runs only the closest action), and
  // preventDefault suppresses the raw jump so we drive applyHashRoute via the
  // hash assignment — re-rendering in place when the hash is already current.
  openHash: (el, e) => {
    e.preventDefault();
    const h = el.getAttribute("href");
    if (window.location.hash === h) applyHashRoute();
    else window.location.hash = h;
  },
  deleteGame: () => deleteGame(state.currentGame),
  switchGameView: (el) => switchGameView(el.dataset.view),
  filterConcept: (el) => toggleConceptFilter(el.dataset.conceptSide, el.dataset.conceptGroup, el.dataset.conceptDim),
  clearConceptFilters: () => clearConceptFilters(),
  setSevLevel: (el) => setSevLevel(parseInt(el.dataset.level, 10)),
  toggleGameMistakes: (el) => toggleGameMistakes(el.dataset.groupId),
  onReportClick: (el) => onReportClick(el, +el.dataset.mid, el.dataset.kind),
  onReportClear: (el) => onReportClear(+el.dataset.mid),
  onComplexTag: (el) => onComplexTag(el, +el.dataset.mid),

  // --- ev table ---
  toggleShared: (el) => toggleShared(el),

  // --- account ---
  linkOAuth: (el) => linkOAuth(el.dataset.provider),
  unlinkOAuth: (el) => unlinkOAuth(el.dataset.provider),

  // --- admin ---
  adminSortUsers: (el) => adminSortUsers(el.dataset.col),
  adminImpersonate: (el) => adminImpersonate(+el.dataset.userId),
  adminDeleteUser: (el) => adminDeleteUser(+el.dataset.userId),
  adminDeleteReport: (el) => adminDeleteReport(+el.dataset.reportId),
  computeCategorySnapshot: () => computeCategorySnapshot(),
  saveCategorySnapshot: () => saveCategorySnapshot(),

  // --- trends ---
  startWeaknessAnalysis: () => startWeaknessAnalysis(),
  cancelWeaknessAnalysis: () => cancelWeaknessAnalysis(),
  toggleSnapshotPanel: (el) => toggleSnapshotPanel(el.dataset.panelId),
  toggleTrendMistakes: (el) => toggleTrendMistakes(el.dataset.saLabel, el.dataset.rowId),
};

// name -> fn(el, event), for the `change` event (selects, checkboxes).
var HAIPAI_CHANGE_ACTIONS = {
  onAnnotate: (el) => onAnnotate(el),
  onReportDetails: (el) => onReportDetails(el, +el.dataset.mid),
  onComplexReason: (el) => onComplexReason(+el.dataset.mid),
  reloadAdminReports: (el) => reloadAdminReports(el.value),
  adminReportKind: (el) => { adminState.reportKind = el.value; renderAdmin(); },
  onSevSlider: (el) => onSevSlider(el),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = HAIPAI_CLICK_ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change-action]");
  if (!el) return;
  const fn = HAIPAI_CHANGE_ACTIONS[el.dataset.changeAction];
  if (fn) fn(el, e);
});
