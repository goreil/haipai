// Post-load handling for a fetched game: pick a sensible default severity
// slider level, force the slider deep enough for deep-linked mistakes, drive
// the async JS-prep banner, and re-run categorize/summary once prep finishes.
// fetchGame() in game-fetch.js wires the entry points.

// Pick a default severity slider level for the loaded game: severe is always
// shown, then deepen the threshold (Mistake → Light → Unsure) until at least 5
// cards are visible. The user can still drag it afterwards — this just avoids
// the case where a quiet game shows only 1-2 severe cards by default.
function autoSetSeverityFilters(game) {
  const counts = { severe: 0, mistake: 0, light: 0, unsure: 0 };
  for (const rnd of game.rounds || []) {
    for (const m of rnd.mistakes || []) counts[sevTier(m.ev_loss)]++;
  }
  let visible = counts.severe;
  let level = 0;
  if (visible < 5) { level = 1; visible += counts.mistake; }
  if (visible < 5) { level = 2; visible += counts.light; }
  if (visible < 5) { level = 3; }
  state.sevLevel = level;
}

// Raise the slider deep enough that `mistakeId`'s tier is visible so a #m<id>
// deep-link can't land on a hidden card. Severe is always visible, so no-op
// when the target is severe (or shallower than the current level).
function ensureMistakeVisible(game, mistakeId) {
  if (!game || mistakeId == null) return;
  let target = null;
  for (const rnd of game.rounds || []) {
    for (const m of rnd.mistakes || []) {
      if (m.id === mistakeId) { target = m; break; }
    }
    if (target) break;
  }
  if (!target) return;
  state.sevLevel = Math.max(state.sevLevel, sevRank(sevTier(target.ev_loss)));
}

function _prepProgressInitial(game) {
  if (!game || typeof haipaiPrep === "undefined" || !game.mortal_data) return null;
  const kyokus = ((game.mortal_data.review || {}).kyokus) || [];
  if (!kyokus.length) return null;
  return { done: 0, total: kyokus.length };
}

// Async refresh: re-run JS prep on the live mortal_data, ticking the banner
// per kyoku. When prep completes, re-categorize, recompute summary, drop the
// banner, and re-render. Bails out if the user navigates to a different game
// mid-flight (a stale prep result must not overwrite the new game's state).
async function refreshPrepAndRecategorize(game, gameId) {
  if (!game || typeof haipaiPrep === "undefined" || !game.mortal_data) {
    state.prepProgress = null;
    return;
  }
  try {
    await haipaiPrep.prepGameAsync(game, game.mortal_data, (done, total) => {
      if (state.currentGame !== gameId) return;
      state.prepProgress = { done, total };
      _updatePrepBannerDOM();
    });
  } finally {
    if (state.currentGame === gameId) {
      recategorizeGameInPlace(game);
      game.summary = recomputeSummaryByCategory(game);
      state.prepProgress = null;
      renderGame();
    }
  }
}

// In-place DOM update for the prep progress bar — avoids re-rendering the
// entire game body on every kyoku tick (rounds + mistake cards are expensive
// to rebuild). Falls through silently if the banner isn't on screen, since
// re-render will pick up the latest state.prepProgress anyway.
function _updatePrepBannerDOM() {
  const banner = document.getElementById("prep-progress-banner");
  if (!banner) return;
  const p = state.prepProgress;
  if (!p) {
    banner.style.display = "none";
    return;
  }
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const label = banner.querySelector(".prep-progress-label");
  const fill = banner.querySelector(".cat-progress-fill");
  if (label) label.textContent = `Re-analyzing categories… ${p.done}/${p.total} rounds`;
  if (fill) fill.style.width = pct + "%";
}

// Run the JS categorizer over every mistake, writing its result fields in
// place. skillArea + shape (the {skill area} × {shape} card identity) and the
// win-vector are the live model; category survives only for action decisions.
// Downstream renderers (badge, board, trends) read these off the mistake.
function recategorizeGameInPlace(game) {
  if (!game || !game.rounds) return;
  if (typeof haipaiCategorize === "undefined") return;
  for (const rnd of game.rounds) {
    for (const m of rnd.mistakes || []) {
      const out = haipaiCategorize.categorize(m);
      m.category = out.category;
      m.skillArea = out.skillArea;
      m.shape = out.shape;
      m.wins = out.wins;
      m.categorize_data = out.categorize_data;
      m.labels = out.labels;
    }
  }
}

// Recompute summary.by_category from the JS-categorized mistakes so
// per-game stats line up with what the user sees. The backend's
// stored stats_json was written off the (now potentially stale)
// server-side categories.
function recomputeSummaryByCategory(game) {
  const summary = { ...(game.summary || {}) };
  const byCat = {};
  let total = 0, evLoss = 0;
  for (const rnd of game.rounds || []) {
    for (const m of rnd.mistakes || []) {
      total++;
      const ev = m.ev_loss || 0;
      evLoss += ev;
      if (m.category) {
        if (!byCat[m.category]) byCat[m.category] = { count: 0, ev: 0 };
        byCat[m.category].count++;
        byCat[m.category].ev = +(byCat[m.category].ev + ev).toFixed(2);
      }
    }
  }
  summary.by_category = byCat;
  summary.total_mistakes = total;
  summary.total_ev_loss = +evLoss.toFixed(2);
  return summary;
}
