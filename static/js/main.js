// Entry point: shared mutable state, init/router on DOMContentLoaded.
//
// Note on cross-script globals: this codebase loads as plain (non-module)
// <script> tags from index.html. Top-level `var` declarations and
// `function` declarations become properties of the global object. We
// therefore declare the shared mutable state with `var` so every other
// file can read/write it without imports.

var csrfToken = "";

var state = {
  games: [],
  currentGame: null,
  currentGameData: null,
  showUnsure: false,
  showLight: false,
  showMistake: false,
  gameView: "rounds", // "rounds" or "summary"
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

  const catRes = await fetch("/api/categories");
  CATEGORY_INFO = await catRes.json();
  await fetchGames();

  // Deep-link to a specific game via #g<id> or to a specific mistake via
  // #m<id>. After fetchGames so the sidebar is populated regardless
  // of whether the deep-link target loads.
  await applyHashRoute();

  window.addEventListener("hashchange", () => { applyHashRoute(); });
});

// Returns the integer game id from `#g<id>`, or null if the hash is
// missing/malformed/non-positive.
function parseGameHash() {
  const m = (window.location.hash || "").match(/^#g(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Returns the integer mistake id from `#m<id>`, or null otherwise.
function parseMistakeHash() {
  const m = (window.location.hash || "").match(/^#m(\d+)$/);
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
};

// Returns the tab slug from `#trends`/`#admin`/`#help`/`#account`, or null.
function parseTabHash() {
  const m = (window.location.hash || "").match(/^#(trends|admin|help|account)$/);
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
      // mistake's tier on in case the user had it filtered out.
      ensureMistakeVisible(state.currentGameData, mistakeId);
      renderGame();
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
