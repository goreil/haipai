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

// Every minigame, and nothing else — this page IS the minigames category.
var TAB_ROUTES = mgTabRoutes();

var PLAY_DEFAULT_TAB = MG_GAMES[0].slug;

var TAB_HASH_RE = new RegExp(`^#(${mgSlugPattern()})$`);

function parseTabHash() {
  const m = (window.location.hash || "").match(TAB_HASH_RE);
  return m ? m[1] : null;
}

// Same contract as main.js's: assigning the hash fires hashchange (→ render);
// re-assigning the current one fires nothing, so re-render directly. Shared so
// the tab strip can use the same `navMinigame` action the SPA's Minigames
// dropdown does.
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
  // Built from the roster, same as the SPA's dropdown, so the arcade always
  // offers exactly the games that exist.
  const tabs = document.getElementById("play-tabs");
  if (tabs) tabs.innerHTML = mgPlayTabsHtml();
  applyPlayRoute();
  window.addEventListener("hashchange", applyPlayRoute);
});
