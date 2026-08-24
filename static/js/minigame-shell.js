// Shared plumbing for the minigames' two homes: the authenticated SPA
// (index.html) and the public arcade shell (static/play.html, served at
// /play).
//
// Guests can play both trainers in full. The only thing an account buys is
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
