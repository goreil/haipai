# Backend-to-frontend categorization

## Status (2026-05-15)

**Steps 1–6 are shipped.** The JS prep + categorize pipeline runs on every
`fetchGame`: the API attaches a slim `mortal_data` to `/api/games/<id>`,
`prepGameInPlace` derives `discard_stats` / `safety_ratings` /
`dealin_rates` / 5A-5B patches client-side, then
`recategorizeGameInPlace` rewrites `m.category` / `m.categorize_data` /
`m.labels`. The same flow runs at the end of `pollCategorization`.

Backend still owns prep at ingest (`lib/categorize/prepare_game_data` in
`_prepare_data_background`) so freshly-uploaded games have data_json
populated for any non-fetch consumer; on fetch JS prep is authoritative
and overwrites in memory.

**Step 7 (retire backend prep) is the remaining cutover** — gated on
≥1 prod week of JS prep running authoritatively.

## Step 3 — Move input prep to the frontend (plan, 2026-05-12)

Goal: retire `lib/categorize/` entirely. Frontend computes
`discard_stats`, `dealin_rates`, `safety_ratings`, `opponent_discards`,
`board_state`, and the 5A/5B patches from the raw Mortal JSON.

**Scope:** only rule logic moves. Storage, ingest, and the
`/api/games/...` endpoints stay on the backend — games remain
server-owned so admin views and future cross-user sharing still work.
The frontend just re-derives categories from the raw replay on fetch.

Why feasible: the `killer_mortal_gui/` submodule is the upstream JS
that `lib/defense_kd.py` and `lib/shanten.py` were ported FROM. We
extract it back, not rewrite from scratch.

### Dependency
`/api/games/<id>` currently returns parsed `rounds_json` only; the
Mortal JSON sits on disk and the server reads it on demand. The
frontend needs `mjai_log` (and per-kyoku metadata) to do wall
reconstruction. Ship it in the game endpoint payload.

### Steps

**1. Extract algorithm modules into `static/js/`**
- `shanten.js` ← `killer_mortal_gui/shanten.js` (188 lines, ES module,
  drop-in).
- `efficiency.js` ← `killer_mortal_gui/efficiency.js` (402 lines,
  exports `calculateUkeire`, drop-in).
- `defense_kd.js` ← extract `generateWaits`, `calcCombos`, and the
  `C_ccw_*` tuning constants from `killer_mortal_gui/index.js`. Lift
  out of `GlobalState`; pass dependencies as function arguments. Use
  `lib/defense_kd.py` as the call-shape spec.

**2. Port glue modules**
- `tiles.js` — extend the existing partial twin of `lib/tiles.py`
  (mjai ↔ tenhou ↔ RT IDs, `NEXT_TILE_MJAI`, red-five helpers).
- `board.js` ← `lib/board.py`. Pure event walk over `mjai_log`.
- `parse.js` — port `walk_kyoku` and `flatten_mjai_log` from
  `lib/parse.py` (per-turn riichi state, open melds).
- `furiten.js` ← `lib/furiten.py` (trivial once shanten exists).

**3. Port prep glue**
- `prep.js` ← `lib/categorize/__init__.py`. Two entry points:
  - `prepMistake(mistake, mortalData, kyokuIdx, entry, defenseCtx)`
  - `prepGame(mortalData, mistakesByRound)`
- Include 5A/5B branches (`_compute_bad_riichi_reason`,
  `_compute_missed_riichi_patch`).

**4. Parity fixture for prep layer**
- `scripts/sample_prep_fixture.py` — dump 50 random games' per-mistake
  `{inputs, expected_prep}` from current Python prep.
- `scripts/verify_prep_js.mjs` — JS prep vs fixture. Target 100%.

**5. Ship Mortal JSON to the frontend**
- `routes/game.py:get_game` attaches `mortal_data` (or slim
  `{mjai_log, review.kyokus[*].tiles_left, player_id}`) to the
  response.

**6. Wire JS prep into fetch path**
- `static/js/game-list.js`: `prepGameInPlace(game)` runs before
  `recategorizeGameInPlace(game)`. Always re-prep (one source of
  truth); stored prep fields become advisory.

**7. Retire backend prep (after ~1 week prod parity)**
- Delete `lib/categorize/`, `lib/shanten.py`, `lib/defense_kd.py`,
  `lib/defense.py`, `lib/board.py`, `lib/furiten.py`. Verify
  `lib/parse.py:parse_game` is still needed by `_ingest_mortal`; keep
  what is.
- Drop `mahjong==1.2.1` from `requirements.txt`. Rebuild Docker and
  hit `/health` per CLAUDE.local.md.
- Drop endpoints: `POST /api/games/<id>/categorize`,
  `POST /api/games/backfill-{board-state,discard-stats,safety-ratings}`.
- Rewrite or drop `tests/test_core.py::TestAddGamePipeline`. Stop
  polling in `pollCategorization`.
- Schema-preserving: keep `mistakes.category` (manual annotations),
  `mistakes.data_json`, `games.categorization_status` (write "done"
  on insert or stop reading it).

**8. Stored `data_json` prep fields**
- Leave them. JS prep on fetch overwrites in memory; rows stay
  untouched. No migration script.

**9. Doc cleanup**
- Delete the shipped Step 3 section per backlog-pruning rule.

### Order / risk
Steps 1–4 are reversible local work. Step 5 is additive. Step 6 is
the cutover — parity fixture is the gate. Step 7 deletes the safety
net; needs ≥1 prod week of JS prep authoritative first.

### Step 1 progress (2026-05-12)
Algorithm modules extracted into `static/js/prep/`:
- `shanten.js` — KD's solver, uses KD's `7 - uniqueTiles` chiitoitsu
  penalty (more accurate than the `mahjong` Python lib's `6 - pairs`
  on concentrated hands). Affects 5/1615 mistakes in the parity
  corpus, 0 category shifts.
- `efficiency.js` — `calculateUkeire` / `calculateDiscardUkeire`.
- `defense_kd.js` — `generateWaits`, `calcCombos`,
  `dealinProbability`, `dealinToSafety` + `WEIGHTS` constants.
- Smoke test: `scripts/smoke_step1.mjs` (1615/1615 parity).
- Snapshot helpers: `scripts/resnap_prep_in_fixture.mjs` (regenerates
  `inputs.discard_stats` / `inputs.best_discard` using JS), then
  re-run `scripts/snapshot_categorize_fixture.mjs` to refresh
  `expected`. Use this whenever an intentional JS prep change shifts
  outputs.

Defense module not smoke-tested yet — needs threat extraction
(`walk_kyoku`) from Step 2.

### Step 3 progress (2026-05-14)
Prep glue ported into `static/js/prep/`:
- `shanten_calc.js` — `calculate(hand_mjai, melds_mjai, wall)` wrapper
  around `prep/shanten.js` that matches the response shape of
  `lib/shanten.py:calculate`. Open hands extend the KD array with
  `meld_count` virtual triplets in slots beyond the honor range; KD's
  recursive solver discovers each as a complete set, naturally
  enforcing the partial-set cap Python's `mahjong` lib applies via
  `init_mentsu`. A raw `-2 * meld_count` adjustment to the standard
  shanten skips the cap and over-counts excess partials, so the
  padding approach is the correct port.
- `defense.js` — `compute_kd_defense_data` + `get_opponent_discards`
  + `get_tile_safety_for_mistake`. Twin of the adapter half of
  `lib/defense_kd.py` plus `lib/defense.py`. The algorithmic core
  (`generateWaits`, `calcCombos`, …) stays in `prep/defense_kd.js`.
- `prep.js` — `prepMistake(mistake, mortalData, kyokuIdx, entry,
  defenseCtx)` + `prepGame(game, mortalData)`. Twin of
  `lib/categorize/__init__.py`. Includes the 5A
  (`_compute_bad_riichi_reason`) and 5B (`_compute_missed_riichi_patch`)
  branches.
- Smoke test: `scripts/smoke_step3.mjs` (34/34 parity on
  `tests/fixtures/game_short.json` + `game_multi_mistake.json`, every
  non-equal entry's `prepMistake` patch diffed against Python's
  `prepare_mistake_data`). Exercises dahai/dahai (29), non-dahai
  meld branches (4), and the 5A bad-riichi branch (1). 5B and
  multi-threat coverage hangs on later games once
  `/api/games/<id>` ships `mortal_data` (step 5).
- `shanten_calc.js` also self-checks: 1615/1615 parity on
  `tests/fixtures/categorize_parity.json` against the stored
  `discard_stats` for every dahai-vs-dahai mistake with melds.

### Step 5 progress (2026-05-15)
JS prep wired into the live fetch path:
- `routes/game.py:api_game` reads the mortal file from disk and attaches a
  slim `mortal_data` to the response. The slim payload is
  `{player_id, mjai_log, review.kyokus[*].entries[*].{tiles_left, junme,
  is_equal}}` — every other Mortal field (model probabilities, scores,
  ratings, dora details on entries) is dropped. Measured at ~25% of the
  full file (30 KB vs 133 KB on a sample 4-kyoku game; 54 KB vs ~150 KB
  on a 9-kyoku game).
- `static/index.html` loads the prep UMD modules in dependency order
  ahead of `categorize.js`. `efficiency.js` is intentionally not in the
  page bundle — nothing on the runtime prep path requires it; it ships
  only for parity tests run in Node.
- `static/js/game-list.js`:
  - `prepGameInPlace(game)` calls `haipaiPrep.prepGame(game,
    game.mortal_data)` when mortal_data is present (early-returns
    silently otherwise — older games could in principle lack
    `mortal_file`, though prod has none).
  - `fetchGame` runs prep before `recategorizeGameInPlace`. The polling
    path (`pollCategorization`) does the same on the freshly-fetched
    game once `categorization_status` leaves `pending`. JS prep is
    always authoritative — stored prep fields on `mistakes.data_json`
    are now advisory, overwritten in memory on every fetch.
- Slim vs full parity (Node, against `tests/fixtures/prep_parity.json`):
  2007/2007 mistakes produce byte-identical `prepGame` output. The
  trimmed entry fields aren't consumed by any prep path.
- Live end-to-end against the running Docker app (`/api/games/3`, ylue
  user): 42 mistakes across 9 rounds prep cleanly; categorize.js
  produces the same category distribution previously stored
  server-side. Apparent diffs against the stored `discard_stats` are
  cosmetic — same fields, different key-insertion order in the JSON.

### Step 4 progress (2026-05-15)
Prep-layer parity fixture wired up against the prod DB:
- `scripts/sample_prep_fixture.py` — sample N games from `games.db`
  inside Docker, replay `prepare_mistake_data` on every non-equal review
  entry, dump `{mistake_id, kyoku_idx, entry, mistake, expected_prep}`
  per mistake plus the per-game `mortal_data`. Default output
  `tests/fixtures/prep_parity.json` (~30 MB, gitignored — regenerate via
  `docker compose exec app python scripts/sample_prep_fixture.py …` then
  `docker compose cp app:/app/tests/fixtures/prep_parity.json
  tests/fixtures/prep_parity.json`).
- `scripts/verify_prep_js.mjs` — loads the fixture, runs JS
  `prepMistake` against every record, diffs each top-level field
  independently so one bad field can't hide another. Tolerates ~0.01
  float drift on safety/dealin rates.
- Coverage on the 50-game seed=20260515 sample: 2007 mistakes,
  dahai_dahai=1788, reach_dahai_5A=44, dahai_reach_5B=16,
  other_non_dahai=159, 284 with riichi-threat defense data.
- Parity: **2005/2007 = 99.90%**. The 2 outliers are KD-vs-`mahjong`
  shanten-solver drift on concentrated hands (same family Step 1 noted);
  feeding both prep outputs through `categorize.js` produces identical
  `category` + `labels`, so no user-visible shift.
- Bug surfaced + fixed during this step: `walk_kyoku` opponents were
  keyed by integer-coerced strings, so JS iterated them in numeric
  order while Python (insertion-ordered dict) emitted first-seen order.
  Added an explicit `opponent_order` array to `walk_kyoku`'s return so
  `get_opponent_discards` and `_extract_threats` (which feeds
  `per_threat`) can iterate in Python-matching order. Without this fix
  parity was 99.50%.

### Step 2 progress (2026-05-14)
Glue modules ported into `static/js/prep/`:
- `tiles.js` — canonical mjai/RT/tenhou ID maps, `mjai_to_tile_id`,
  `tile_id_to_base`, `dora_indicator_to_dora_mjai`,
  `is_red_five_mjai`, `is_honor_mjai`. Twin of `lib/tiles.py`. Kept
  separate from the rendering-only `static/js/tiles.js` so the prep
  pipeline can be required in Node without dragging in DOM helpers.
- `parse.js` — `flatten_mjai_log` + `walk_kyoku` (per-kyoku event
  walker that feeds defense / decision-state tracking on the JS
  side). Same return shape as `lib/parse.py:walk_kyoku`.
- `board.js` — `reconstruct_context`, `extract_board_state`,
  `subtract_hand_from_wall`, `decrement_wall`. Same BoardState shape
  as `lib/board.py`.
- `furiten.js` — `tenpai_waits`, `tenpai_wait_tiles`, `is_furiten`,
  `find_discard_history_for_turn`, `find_riichi_context`. Twin of
  `lib/furiten.py`, depends only on `prep/shanten.js`.
- Smoke test: `scripts/smoke_step2.mjs` (389/389 parity across
  `tests/fixtures/game_short.json` and `game_multi_mistake.json` at
  every entry's tiles_left checkpoint + a few coarse ones, plus 5
  hand-crafted furiten cases).

### Deferred (still applicable)
- **Trends per-category aggregate** — `renderCategoryTrend` in
  `trends.js` is hidden client-side; server's
  `compute_summary_for_game` still writes a `by_category` blob from
  the (stale-on-new-games) `category` column. Decide later: bring
  back, recompute server-side, or drop.

## Verification

- `tests/fixtures/categorize_parity.json` — 2,121 mistakes from 50
  random games with the Python categorizer's stored output. Built by
  `scripts/sample_categorize_fixture.py` (run inside Docker against
  the prod DB).
- `scripts/verify_categorize_js.mjs` — diff JS output against the
  fixture. Run it after any change to `static/js/categorize.js`.
  Current parity: 100% on `category`, `categorize_data`, and `labels`.
  Re-snapshot with `scripts/snapshot_categorize_fixture.mjs` when an
  intentional change shifts outputs.
- `tests/test_core.py::TestAddGamePipeline` pins the prep contract
  (every dahai-vs-dahai mistake gets `discard_stats`, status reaches
  `done`, etc.). No backend assertion on `category` column anymore.
