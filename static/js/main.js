// Entry point: shared mutable state, init/router on DOMContentLoaded.
//
// Note on cross-script globals: this codebase loads as plain (non-module)
// <script> tags from index.html. Top-level `var` declarations and
// `function` declarations become properties of the global object. We
// therefore declare the shared mutable state with `var` so every other
// file can read/write it without imports.

var csrfToken = "";
var isAnonymous = false;
var practiceOptIn = false;
var practiceSource = "all"; // "mine" or "all"

var state = {
  games: [],
  currentGame: null,
  currentGameData: null,
  showUnsure: false,
  showLight: false,
  showMistake: false,
  gameView: "rounds", // "rounds" or "summary"
};

var practice = {
  problem: null,
  answered: false,
  userPick: null,
  correct: 0,
  total: 0,
  poolSize: 0,
  filterSeverity: "",
  filterGroup: "",
  filterDefense: false,
  filterCalcAgree: false,
};

// --- Init ---

document.addEventListener("DOMContentLoaded", async () => {
  const onPracticePage = window.location.pathname === "/practice";

  // Load user info
  const meRes = await fetch("/api/me");
  if (meRes.status === 401) {
    if (onPracticePage) {
      // Anonymous practice mode
      isAnonymous = true;
      document.getElementById("user-info").innerHTML =
        `<a href="/login">Log in</a> | <a href="/register">Register</a>`;
      // Hide authenticated-only UI
      document.querySelector('.sidebar-header button[onclick="showAddModal()"]').style.display = "none";
      for (const id of ["trends-btn", "help-btn"]) {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = "none";
      }
      document.querySelector('button[onclick="showMyFeedback()"]').style.display = "none";
      document.querySelector('button[onclick="showFeedbackModal()"]').style.display = "none";
    } else {
      window.location.href = "/login";
      return;
    }
  } else {
    const me = await meRes.json();
    window._meData = me;
    csrfToken = me.csrf_token || "";
    practiceOptIn = !!me.practice_opt_in;
    document.getElementById("user-info").innerHTML =
      `${me.username} <a href="/logout">logout</a>`;

    // Show admin button only for admins
    const adminBtn = document.getElementById("admin-btn");
    if (adminBtn && me.is_admin) adminBtn.style.display = "";

    renderImpersonateBanner(me);
    if (typeof mailboxInit === "function") mailboxInit();
  }

  const catRes = await fetch("/api/categories");
  CATEGORY_INFO = await catRes.json();
  if (isAnonymous) {
    showPractice();
  } else {
    fetchGames();
  }
});
