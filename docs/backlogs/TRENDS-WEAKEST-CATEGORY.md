# Trends: weakest skill area

## Goal

Re-enable the "biggest weakness" callout + per-skill-area EV/D breakdown on
the trends page (`renderTrendRecommendation` + `renderCategoryTrend` in
`static/js/trends.js`, currently hidden around line 146). Ranks the five
skill areas (Attack / Defense / Meld / Riichi / Kan) by aggregated
EV/decision, surfaces the worst one, with drill-down to sub-categories.

Hidden during the backend-to-frontend cutover because backend's
`stats_json.by_category` is built from the stale `mistakes.category` column
(written at ingest, never updated when JS re-categorizes on fetch).

## Approach: browser-side cache, opt-in via button

Categorization rollups are cached client-side per user+game in
`localStorage`. The full panel is gated behind an "Analyze my weak
categories" button — pressing it consumes the cache, fetches anything
missing, then renders. Routine game viewing already runs prep +
categorize, so it opportunistically primes the cache; for active users
the button is usually a no-op.

No backend write path is added. Backend remains category-blind. This is
forward-compatible with eventually dropping `mistakes.category` entirely.

Why not "fetch all games + run prep client-side every trends visit":
1–2 MB and several seconds of prep for an 18-game user, every time.
Defense classification needs `dealin_rates`, which is computed from
mortal_data and not persisted — so any approach without caching pays
the full prep cost on every visit.

## Cache design

- **Storage**: `localStorage`. Payload is ~200 bytes/game; 100 games is
  ~20 KB. No need for IndexedDB.
- **Key**: `haipai:cat:<userId>:<gameId>`.
- **Value**:
  ```json
  {
    "version": "<CATEGORIZE_VERSION>",
    "by_category": { "P2": { "count": 4, "ev": 12.3 }, ... }
  }
  ```
- **Invalidation**: bump `CATEGORIZE_VERSION` constant in
  `static/js/categorize.js` whenever the decision tree or RULES change.
  Entries with a non-matching version are treated as cache misses.
- **Per-user safety**: keys include `userId` so a different login on the
  same browser doesn't see the prior user's cache. Best-effort — don't
  block on it.
- **Graceful degradation**: wrap reads/writes in try/catch. If
  `localStorage` is full or disabled, the feature still works — the
  button just recomputes from scratch every press.

## Cache lifecycle

1. **Opportunistic write on every fetchGame.** In `game-list.js`, after
   the *final* `recategorizeGameInPlace` pass (inside
   `refreshPrepAndRecategorize`, post-prep), build `by_category` from
   `game.rounds[*].mistakes[*]` and persist it. Skip the first
   optimistic pass — only write the post-prep result.
2. **Button-driven backfill.** Pressing "Analyze my weak categories"
   collects the trend game IDs, partitions into hit / miss against the
   cache, then fetches each miss via `/api/games/<id>` (which triggers
   the normal prep + categorize path) and writes the result into the
   cache as it goes. Shows progress ("Analyzing 5 of 18 games…").
3. **Cancel**: a Cancel button stops further fetches. Whatever's
   cached so far still renders, with a coverage note ("Based on N/M
   games").
4. **No explicit eviction**: orphan entries (game deleted server-side)
   are harmless — trends only iterates games returned by `/api/trends`,
   so the orphan is never read. Size is bounded by the user's own game
   count.

## Frontend tasks

- [ ] **New module `static/js/trends-cache.js`**: thin localStorage
  wrapper.
  - `getCategorySummary(userId, gameId): {by_category} | null` — null
    on miss or version mismatch.
  - `setCategorySummary(userId, gameId, by_category)`.
  - `summarizeFromGame(game): by_category` — sum count + ev per
    `m.category` across `game.rounds[*].mistakes[*]`.
  - Exposes the active `CATEGORIZE_VERSION` (imported from
    `categorize.js`).

- [ ] **`static/js/categorize.js`**: export a `CATEGORIZE_VERSION`
  constant (e.g. `"2026-05"`). Bump whenever rules change.

- [ ] **`static/js/game-list.js`**: after the post-prep
  `recategorizeGameInPlace` in `refreshPrepAndRecategorize`, call
  `setCategorySummary(currentUserId, gameId, summarizeFromGame(game))`.
  Need access to `currentUserId` — read from wherever the JS already
  knows the logged-in user (likely `state.user` or a `<meta>` tag; if
  not exposed yet, expose it).

- [ ] **`static/js/trends.js`**: replace the hidden-panel comment block
  with a button-driven section.
  - Default state: a single button "Analyze my weak categories" + one-
    line explainer ("Computes your weakest skill area across all
    games. May take a few seconds the first time.").
  - On click: partition `games` into hit/miss against the cache, run
    sequential `/api/games/<id>` fetches for misses (with Cancel
    available), update progress text, then render
    `renderTrendRecommendation(games)` + `renderCategoryTrend(games)`
    using the cached `by_category` for each game.
  - **Plumb cached `by_category` into the existing helpers**:
    `trendAggregateAll` currently reads `g.by_category` from the API
    payload. Change it to take `(games, cacheLookup)` so it pulls from
    cache instead of the API field. Games still missing after the
    backfill (e.g. user cancelled) get skipped, mirroring the existing
    `decision_counts` skip.

- [ ] **Cache-hit coverage note**: when fewer than all games are in
  cache, render the existing coverage line ("Based on N/M games") with
  a "Refresh older games" affordance to retry.

## Backend tasks

- [ ] **Stop writing `by_category`** in
  `db/games.py::compute_summary_for_game`. Other rollups (severity,
  ev_per_decision, decision_counts) stay.
- [ ] **Drop `by_category` from `get_trends`** in `db/games.py` — no
  consumer once the frontend uses the cache.
- [ ] **No new endpoints.** `/api/games/<id>` already returns
  everything needed for the backfill loop.

## Verification

- Open a game, then open trends → press button → confirm zero network
  fetches for that game (cache hit). Weakness ranking matches what
  you'd compute by hand-summing per-mistake EV from the open game view.
- Cold cache (clear localStorage, open trends) → press button →
  progress ticks through every game, ranking appears at the end. Cancel
  mid-way → partial render with coverage note.
- Bump `CATEGORIZE_VERSION` → press button → all entries treated as
  miss, full re-fetch.
- Log out and log in as different user → cache from prior session
  doesn't bleed into new user's ranking (per-user keying).
- `localStorage` disabled (private window in some browsers) → button
  still works, just slow on every press.

## Out of scope (separate tickets)

- Dropping the `mistakes.category` column entirely. Still read by
  `routes/game.py::api_annotate` (manual category override) and
  `routes/pages.py::api_top_mistakes` (group filter). Removing it means
  rewiring those paths.
- Migrating `stats_json.by_severity` to the cache. Severity is set by
  the parser, not the categorizer, so the cached server value is
  correct.
- Cross-device cache sync. Each browser computes its own cache on
  first use — acceptable degradation.
