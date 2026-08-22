// Entry point: shared mutable state, init/router on DOMContentLoaded.
//
// Note on cross-script globals: this codebase loads as plain (non-module)
// <script> tags from index.html. Top-level `var` declarations and
// `function` declarations become properties of the global object. We
// therefore declare the shared mutable state with `var` so every other
// file can read/write it without imports.

var csrfToken = "";

// Re-fetch /api/me (CSRF-exempt, @login_required) purely for a fresh
// csrf_token. Used both as a periodic keep-alive and as csrfFetch's (api.js)
// reactive retry on an expired-token 400. A 401 here means the *session*
// itself expired, not just the CSRF token — that needs a real re-login.
async function refreshCsrfToken() {
  try {
    const res = await fetch("/api/me");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) return;
    const me = await res.json();
    csrfToken = me.csrf_token || csrfToken;
  } catch (e) {
    // Network hiccup — leave the existing token; next action retries.
  }
}

var state = {
  games: [],
  currentGame: null,
  currentGameData: null,
  // True only on the public shared/demo view (see shared-view.js) — hides
  // every write control (notes, reports, delete, share) and skips the
  // sidebar re-render that assumes an authenticated shell.
  readOnly: false,
  // Severity slider: a single cumulative threshold 0..3 over SEV_ORDER
  // (0 = severe only, 1 = +mistake, 2 = +light, 3 = +unsure). Set per game by
  // autoSetSeverityFilters; the summary bar + concept ledgers reflect it too.
  sevLevel: 3,
  gameView: "rounds", // "rounds" or "summary"
  // Concept-breakdown pill filters (additive / OR). Array of
  // {side:"missed"|"you", group, dim:null|<win-vector dim>}. Empty = no filter;
  // a mistake shows when it touches ANY selected pill.
  conceptFilters: [],
  // Trends-only: which "Losing points here" ledger rows have their per-dim
  // sub-pills expanded (see trendsConceptExpandedActive in trends-analysis.js).
  // Array of {scope, side, group} — scope is "live" for the current weakness
  // panel or "snap-<id>" for a past-analysis row, so expand state never leaks
  // between them. Collapsed by default. The per-game view (game-render.js)
  // shows sub-pills inline unconditionally and has no expand state of its own.
  trendsConceptExpanded: [],
};

// --- Init ---

document.addEventListener("DOMContentLoaded", async () => {
  // Load user info
  const meRes = await fetch("/api/me");
  if (meRes.status === 401) {
    window.location.href = "/login";
    return;
  }
  const me = await meRes.json();
  window._meData = me;
  csrfToken = me.csrf_token || "";
  document.getElementById("user-info").innerHTML =
    `${me.username} <a href="/logout">logout</a>`;

  // Show admin button only for admins
  const adminBtn = document.getElementById("admin-btn");
  if (adminBtn && me.is_admin) adminBtn.style.display = "";

  renderImpersonateBanner(me);
  if (typeof mailboxInit === "function") mailboxInit();

  // Proactively renew the CSRF token well inside its 1h expiry so an idle
  // tab never hits it; csrfFetch (api.js) also refreshes+retries reactively
  // as a fallback (e.g. the computer slept through the interval below).
  setInterval(refreshCsrfToken, 20 * 60 * 1000);

  await fetchGames();

  // Deep-link to a specific game via #g<id> or to a specific mistake via
  // #m<id>. After fetchGames so the sidebar is populated regardless
  // of whether the deep-link target loads.
  await applyHashRoute();

  window.addEventListener("hashchange", () => { applyHashRoute(); });
});

// Returns the integer game id from `#g<id>`, or null if the hash is
// missing/malformed/non-positive. The legacy `#game=<id>` form is still
// accepted so old upload bookmarklets (which redirect to `#game=<id>`)
// keep deep-linking correctly.
function parseGameHash() {
  const m = (window.location.hash || "").match(/^#g(?:ame=)?(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Returns the integer mistake id from `#m<id>`, or null otherwise. The legacy
// `#mistake=<id>` form is still accepted for backwards compatibility.
function parseMistakeHash() {
  const m = (window.location.hash || "").match(/^#m(?:istake=)?(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Top-level views that own a hash (game/mistake hashes are handled separately
// above). Maps the hash slug to the function that renders the view.
var TAB_ROUTES = {
  trends: () => showTrends(),
  admin: () => showAdmin(),
  help: () => showHelp(),
  account: () => showAccount(),
  "waits-trainer": () => showWaitsTrainer(),
};

// Returns the tab slug from `#trends`/`#admin`/`#help`/`#account`/
// `#waits-trainer`, or null.
function parseTabHash() {
  const m = (window.location.hash || "").match(/^#(trends|admin|help|account|waits-trainer)$/);
  return m ? m[1] : null;
}

// Navigate to a top-level tab. Assigning location.hash pushes a history entry
// and fires hashchange (→ applyHashRoute → render). Re-assigning the current
// hash fires no event, so re-render directly in that case.
function navTab(slug) {
  if (parseTabHash() === slug) TAB_ROUTES[slug]();
  else window.location.hash = slug;
}

// Route the current location.hash to a game load. #m<id> resolves to a
// game via /api/mistakes/<id>/locate, stashes the target mistake id so
// renderGame can scroll to it, and (in summary view) bounces to rounds so the
// target card is actually on screen.
async function applyHashRoute() {
  const mistakeId = parseMistakeHash();
  if (mistakeId != null) {
    const res = await fetch(`/api/mistakes/${mistakeId}/locate`);
    if (!res.ok) {
      // Admin deep-link to another user's mistake: impersonate owner + reload.
      if (await tryAdminImpersonateForDeepLink("mistake", mistakeId)) return;
      // Drop the hash so the listener doesn't refire on history changes.
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }
    const loc = await res.json();
    state.scrollToMistakeId = mistakeId;
    if (state.gameView !== "rounds") state.gameView = "rounds";
    if (loc.game_id !== state.currentGame) {
      await fetchGame(loc.game_id);
    } else {
      // Same game already loaded — just scroll. Still force the target
      // mistake's tier on in case the user had it filtered out. Prep already
      // ran (no reflow), so one render scrolls correctly; clear the flag
      // afterwards since renderGame no longer self-clears it.
      ensureMistakeVisible(state.currentGameData, mistakeId);
      renderGame();
      state.scrollToMistakeId = null;
    }
    return;
  }
  const tab = parseTabHash();
  if (tab) {
    TAB_ROUTES[tab]();
    return;
  }
  const gameId = parseGameHash();
  if (gameId == null) {
    if (state.currentGame != null) navigateHome();
  } else if (gameId !== state.currentGame) {
    await fetchGame(gameId);
  }
}
