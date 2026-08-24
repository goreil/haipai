// Bootstrap for the public minigame arcade (static/play.html, served at
// /play). The same relationship to main.js that shared-view.js has: it
// provides the handful of globals the trainers reach for, and a hash router
// over just the two trainer tabs — no session, no game list, no API client
// beyond the public leaderboard GET the trainers do themselves.
//
// `mgGuest = true` (minigame-shell.js) is what turns a finished run into a
// stashed one plus a sign-up CTA instead of a POST. /play is only ever served
// to logged-out visitors (routes/pages.py bounces the rest), so this is a
// constant rather than something to detect.

mgGuest = true;

// Never used on this page — no run is ever POSTed from here — but apiPost
// reads it, so it exists to keep that path from throwing if it is ever hit.
var csrfToken = "";

// The trainers touch these three on mount (they clear whatever game the SPA
// had open). Minimal stand-ins so neither needs a "am I in the SPA?" branch.
var state = {
  currentGame: null,
  currentGameData: null,
  readOnly: true,
};

function renderGameList() {}

var TAB_ROUTES = {
  "waits-trainer": () => showWaitsTrainer(),
  "defense-trainer": () => showDefenseTrainer(),
};

var PLAY_DEFAULT_TAB = "waits-trainer";

function parseTabHash() {
  const m = (window.location.hash || "").match(/^#(waits-trainer|defense-trainer)$/);
  return m ? m[1] : null;
}

// Same contract as main.js's: assigning the hash fires hashchange (→ render);
// re-assigning the current one fires nothing, so re-render directly. Shared so
// the toolbar buttons can use the existing showWaitsTrainer/showDefenseTrainer
// actions unchanged.
function navTab(slug) {
  if (parseTabHash() === slug) TAB_ROUTES[slug]();
  else window.location.hash = slug;
}

function applyPlayRoute() {
  const tab = parseTabHash() || PLAY_DEFAULT_TAB;
  document.querySelectorAll("[data-play-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.playTab === tab));
  TAB_ROUTES[tab]();
}

document.addEventListener("DOMContentLoaded", () => {
  applyPlayRoute();
  window.addEventListener("hashchange", applyPlayRoute);
});
