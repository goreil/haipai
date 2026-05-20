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

  // Deep-link to a specific game via #game=<id> or to a specific mistake via
  // #mistake=<id>. After fetchGames so the sidebar is populated regardless
  // of whether the deep-link target loads.
  await applyHashRoute();

  window.addEventListener("hashchange", () => { applyHashRoute(); });
});

// Returns the integer game id from `#game=<id>`, or null if the hash is
// missing/malformed/non-positive.
function parseGameHash() {
  const m = (window.location.hash || "").match(/^#game=(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Returns the integer mistake id from `#mistake=<id>`, or null otherwise.
function parseMistakeHash() {
  const m = (window.location.hash || "").match(/^#mistake=(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Route the current location.hash to a game load. #mistake=<id> resolves to a
// game via /api/mistakes/<id>/locate, stashes the target mistake id so
// renderGame can scroll to it, and (in summary view) bounces to rounds so the
// target card is actually on screen.
async function applyHashRoute() {
  const mistakeId = parseMistakeHash();
  if (mistakeId != null) {
    const res = await fetch(`/api/mistakes/${mistakeId}/locate`);
    if (!res.ok) {
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
  const gameId = parseGameHash();
  if (gameId == null) {
    if (state.currentGame != null) navigateHome();
  } else if (gameId !== state.currentGame) {
    await fetchGame(gameId);
  }
}
