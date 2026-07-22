// Bootstrap for the public read-only shared/demo game view (static/shared.html).
// Mirrors the relevant slice of main.js + game-fetch.js's fetchGame(), but
// against the unauthenticated /api/shared/<token> endpoint instead of a
// session-scoped /api/games/<id>, and with no sidebar/toolbar/mailbox/admin
// to boot. state.readOnly=true is read by game-render.js/mistake-card.js to
// hide every write control (notes, reports, delete, share, complex-gap
// funnel).

var csrfToken = "";

var state = {
  games: [],
  currentGame: null,
  currentGameData: null,
  sevLevel: 3,
  gameView: "rounds",
  conceptFilters: [],
  conceptExpanded: [],
  readOnly: true,
};

// Safety net: mistake-card.js/game-render.js render a few `data-action="openHash"`
// dev-id badges (#g<id>/#m<id>) that call this when the clicked hash already
// matches the address bar. There's no router on this page — clicking one just
// updates the URL, which is harmless — but the handler must exist so a
// same-hash click doesn't throw.
function applyHashRoute() {}

function parseShareToken() {
  const m = window.location.pathname.match(/^\/shared\/([^/]+)$/);
  return m ? m[1] : null;
}

async function fetchSharedGame() {
  const content = document.getElementById("content");
  const token = parseShareToken();
  if (!token) {
    content.innerHTML = '<div class="empty-state">Bad share link.</div>';
    return;
  }

  const res = await fetch(`/api/shared/${token}`);
  if (!res.ok) {
    content.innerHTML = '<div class="empty-state">This share link is invalid or has been revoked.</div>';
    return;
  }
  state.currentGameData = await res.json();
  state.currentGame = state.currentGameData.id;

  // First render uses stored fields (advisory) + JS categorize so the visitor
  // sees the game immediately; refreshPrepAndRecategorize then re-runs prep
  // on the live mortal_data (JS prep is authoritative) and re-renders.
  recategorizeGameInPlace(state.currentGameData);
  state.currentGameData.summary = recomputeSummaryByCategory(state.currentGameData);
  state.prepProgress = _prepProgressInitial(state.currentGameData);
  autoSetSeverityFilters(state.currentGameData);
  renderGame();
  await refreshPrepAndRecategorize(state.currentGameData, state.currentGame);
}

document.addEventListener("DOMContentLoaded", fetchSharedGame);
