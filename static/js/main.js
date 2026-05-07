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
  fetchGames();
});
