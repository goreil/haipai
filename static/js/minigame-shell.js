// Shared plumbing for the minigames' two homes: the authenticated SPA
// (index.html) and the public arcade shell (static/play.html, served at
// /play).
//
// Guests can play every trainer in full. The only thing an account buys is
// the leaderboard — so rather than hiding the board or silently dropping the
// run, a finished guest run is stashed in localStorage and the game-over
// panel offers a sign-up. The next time that browser opens the trainer while
// logged in, the stashed run is submitted (`mgTakeRun`), which makes
// "register to keep your score" literally true across the whole
// register -> verify-email -> log-in detour rather than just aspirational.
//
// Only the best pending run per game is kept: a guest who plays ten rounds
// before signing up gets their best one on the board, not ten rows of noise.

// True only on the public arcade shell — play-view.js sets it. The SPA never
// touches it, so `false` (this default) means "there is a session".
var mgGuest = false;

// --- The minigame roster ---------------------------------------------------
//
// The one place that knows which minigames exist. Adding a fourth trainer
// means adding a row here: both shells' hash routers (main.js, play-view.js),
// the SPA's "Minigames" toolbar dropdown and the arcade's tab strip are all
// built from this list, so none of them can fall out of step with another.
//
// `show` is an arrow rather than a direct reference because this file loads
// BEFORE the trainers do — the name is resolved when the tab is opened, not
// now. Same lazy-resolution trick the action registry uses (actions.js).
//
// `hidden: true` takes a trainer out of both shells' menus (the SPA's
// Minigames dropdown and the arcade's tab strip) while leaving it loaded and
// routable — `/#defense-trainer` and `/play#efficiency-trainer` still open
// it, so an unpolished game can be worked on and demoed without being
// advertised. Delete the flag to ship it.
var MG_GAMES = [
  {
    slug: "waits-trainer",
    label: "Waits",
    title: "Waits Trainer",
    blurb: "Read every wait before the hand hits the floor",
    show: () => showWaitsTrainer(),
  },
  {
    slug: "defense-trainer",
    label: "Defense",
    title: "Defense Trainer",
    blurb: "Remember which tiles are safe against a riichi",
    hidden: true,
    show: () => showDefenseTrainer(),
  },
  {
    slug: "efficiency-trainer",
    label: "Efficiency",
    title: "Efficiency Trainer",
    blurb: "Shoot tiles into a hand until it reaches tenpai",
    hidden: true,
    show: () => showEfficiencyTrainer(),
  },
];

// The advertised subset — what the menus offer. Routing deliberately uses the
// full roster instead, so a hidden trainer stays reachable by hash.
function mgVisibleGames() {
  return MG_GAMES.filter((g) => !g.hidden);
}

// The roster as TAB_ROUTES entries, to be spread into each shell's own table.
function mgTabRoutes() {
  const routes = {};
  for (const g of MG_GAMES) routes[g.slug] = g.show;
  return routes;
}

// The roster as a regex alternation, for the shells' parseTabHash().
function mgSlugPattern() {
  return MG_GAMES.map((g) => g.slug).join("|");
}

// The SPA's "Minigames" toolbar dropdown. One category button instead of one
// button per trainer — the toolbar does not grow every time a game is added.
function mgMenuHtml() {
  return mgVisibleGames().map((g) =>
    `<button data-action="navMinigame" data-mg-slug="${g.slug}" title="${g.blurb}">${g.title}</button>`
  ).join("");
}

// The public arcade's tab strip. `data-play-tab` is what applyPlayRoute()
// marks active.
function mgPlayTabsHtml() {
  return mgVisibleGames().map((g) =>
    `<button type="button" class="btn" data-play-tab="${g.slug}" data-action="navMinigame" data-mg-slug="${g.slug}" title="${g.blurb}">${g.label}</button>`
  ).join("");
}

var MG_PENDING_KEY = "haipai.minigame.pendingRun";

// { waits: {...run}, defense: {...run} }. Absent/corrupt storage reads as {}
// so a private-mode browser degrades to "play, but nothing is kept" instead
// of throwing mid-render.
function mgReadPending() {
  try {
    const raw = localStorage.getItem(MG_PENDING_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

function mgWritePending(all) {
  try { localStorage.setItem(MG_PENDING_KEY, JSON.stringify(all)); } catch (e) { /* private mode */ }
}

// Remember a guest's finished run under `game` ("waits" / "defense"), keeping
// whichever of the stored and incoming runs scored higher. `run` is the exact
// body the game's POST endpoint takes, so the flush below needs no mapping.
function mgStashRun(game, run) {
  if (!run || !(run.score > 0)) return;   // a scoreless run isn't stored either
  const all = mgReadPending();
  const prev = all[game];
  if (prev && prev.score >= run.score) return;
  all[game] = run;
  mgWritePending(all);
}

// Read and clear the pending run for `game`, or null. Clearing up front means
// a failed submit drops the run rather than retrying forever — the score is a
// nice-to-have, and a stuck one would resubmit on every visit.
function mgTakeRun(game) {
  const all = mgReadPending();
  const run = all[game] || null;
  if (run) {
    delete all[game];
    mgWritePending(all);
  }
  return run;
}

// Game-over CTA for guests. `what` names the run in the sentence ("run",
// "board") so each trainer can phrase it in its own terms.
function mgSignupCtaHtml(what) {
  return `<div class="mg-cta">
    <p class="mg-cta-lead">Want this ${what || "run"} on the leaderboard?</p>
    <p class="mg-cta-sub">Create a free account and we'll save your best score from this session.</p>
    <div class="mg-cta-row">
      <a class="btn btn-primary" href="/register">Create account</a>
      <a class="btn btn-secondary" href="/login">Log in</a>
    </div>
  </div>`;
}

// Intro-panel footnote, so the trade is clear before the first run rather
// than only after it.
function mgGuestNoteHtml() {
  return `<p class="mg-guest-note">Playing as a guest — <a href="/register">sign up</a> to join the leaderboard.</p>`;
}

// Called by each trainer when it mounts in the authenticated shell: submits
// whatever the guest left behind and returns the run (so the panel can say so),
// or null. `report` is the trainer's own submit function.
function mgFlushPendingRun(game, report) {
  if (mgGuest) return null;
  const run = mgTakeRun(game);
  if (run) report(run);
  return run;
}
