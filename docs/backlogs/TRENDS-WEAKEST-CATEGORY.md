# Trends: weakest skill area

## Goal

Re-enable the "biggest weakness" callout + per-skill-area EV/D breakdown
on the trends page (`renderTrendRecommendation` + `renderCategoryTrend`
in `static/js/trends.js`, currently hidden around line 146). Ranks the
five skill areas (Attack / Defense / Meld / Riichi / Kan) by aggregated
EV/decision, surfaces the worst one, with drill-down to sub-categories.

Hidden during the backend-to-frontend cutover because backend's
`stats_json.by_category` was built from the (now-dropped)
`mistakes.category` column. Step 9 of BACKEND-TO-FRONTEND removed both
the column and the rollup from `compute_summary_for_game` /
`get_trends`, so the panel is currently inert — re-enabling it is what
this doc covers.

## Approach: opt-in button, in-memory result for the session

A user hits the trends page roughly once per 20 games played, so it's
fine to recompute the per-game `by_category` from scratch on the first
press of a session. No cache layer, no version constants, no
opportunistic priming.

The analyzed result *does* stay in the trends layer once computed:
stash the analyzed games array (with `by_category` attached) in a
module-level variable in `trends.js`. When the user navigates away to a
game and returns to trends, the previous result re-renders without a
re-run. The stash is invalidated when the game-id set changes (new
upload, deletion) — in that case the button reappears with a "X new
games since last analysis" hint. A full page reload clears the stash
and the user re-presses; acceptable at this usage frequency.

Default state on the trends page (no stash): a single button "Analyze
my weak categories" + one-line explainer. On press, loop the games
returned by `/api/trends`, fetch each via `/api/games/<id>`, run the
existing client-side prep + categorize pipeline, build `by_category`
from the resulting mistakes, attach it to the per-game record, and
call the existing `renderTrendRecommendation` +
`renderCategoryTrend` helpers.

For an 18-game user, expect 2-4s with 3-wide concurrency (KD defense
prep dominates). A spinner + "Analyzing N/M…" counter is enough UX.

## Frontend tasks

- [ ] **`static/js/trends.js`**: replace the hidden-panel comment block
  with a button + container, plus a module-level stash for the last
  analyzed result.
  - Module-level state: `lastAnalysis = { gameIds: [...], games: [...] }`
    or `null`.
  - In `showTrends()`, after fetching `/api/trends`, compare its game
    ids against `lastAnalysis.gameIds`. On exact match, re-render the
    weak-category panels from the stashed `games` instead of the
    button.
  - When ids differ but a stash exists, render the button with a hint
    like "X new games since your last analysis."
  - Default state (no stash, or stale): button "Analyze my weak
    categories" + one-line explainer ("Computes your weakest skill
    area across all games. Takes a few seconds.").
  - On click: disable button, show "Analyzing N/M…" + Cancel.
  - For each game in `games`, fetch `/api/games/<id>`, run
    `haipaiPrep.prepGameAsync` + `recategorizeGameInPlace`, build
    `by_category` by summing count + ev per `m.category` across
    `rounds[*].mistakes[*]`, assign it onto the corresponding entry in
    `games`.
  - Run with a small concurrency cap (e.g. 3) — sequential is fine but
    noticeably slower on bigger histories.
  - Cancel: stop scheduling new fetches; render with whatever has
    landed, including the existing coverage line ("Based on N/M
    games"). Do not stash a partial result.
  - Once a full pass completes, stash the games array and append
    `renderTrendRecommendation(games)` + `renderCategoryTrend(games)`.
  - On retry (button pressed again after a partial cancel), recompute
    everything from scratch.

`trendAggregateAll` already reads `g.by_category` off each game record,
so attaching the computed rollup is all that's needed on the consumer
side.

## Backend tasks

- [x] **Stop writing `by_category`** in
  `db/games.py::compute_summary_for_game`. *(Done in Step 9.)*
- [x] **Drop `by_category` from `get_trends`** in `db/games.py`.
  *(Done in Step 9.)*
- [ ] **No new endpoints.** `/api/games/<id>` already returns
  everything needed.

## Verification

- Cold press on an 18-game account: progress counter ticks through
  every game, ranking + bar chart appear at the end. Weakness ranking
  matches what you'd compute by hand-summing per-mistake EV from one
  open game.
- Open a game from the trends panel, then navigate back to trends:
  result re-renders instantly, no button, no re-run.
- Upload a new game and revisit trends: button reappears with the "X
  new games" hint; pressing it re-runs across the new total.
- Cancel mid-way: partial render with coverage note ("Based on N/M
  games"). Navigate away + back: button is shown again (no stash from
  a partial run).
- Full page reload: button reappears (in-memory stash cleared).
- Network failure on one game in the middle: that game is skipped, the
  rest still render with the coverage note reflecting the skip. Not
  stashed (treated like a cancel for stash purposes).

## Out of scope

- Persisting the analyzed result across page reloads. In-memory is
  enough at this usage frequency — revisit if users complain about
  re-running after refresh.
- Migrating `stats_json.by_severity` off the backend. Severity is set
  by the parser, not the categorizer, so the cached server value is
  correct.
