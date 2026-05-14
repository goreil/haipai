# Backend-to-frontend categorization

## Status (2026-05-05)

**Step 1 (port to JS) and Step 2 (remove backend categorizer) are shipped.**
The JS categorizer in `static/js/categorize.js` is the sole owner of the
rule-decision logic. The server (`lib/categorize/__init__.py`) only prepares
inputs (`prepare_mistake_data` / `prepare_game_data`) — `discard_stats`,
`dealin_rates`, `safety_ratings`, 5A/5B riichi patches.

Frontend hooks the JS categorizer in `static/js/game-list.js`:
`recategorizeGameInPlace` runs on every `fetchGame` and at the end of
`pollCategorization`, overwriting `m.category` / `m.categorize_data` /
`m.labels` from the API response.

## Step 3 — Move input prep to the frontend (plan, 2026-05-12)

Goal: retire `lib/categorize/` entirely. Frontend computes
`discard_stats`, `dealin_rates`, `safety_ratings`, `opponent_discards`,
`board_state`, and the 5A/5B patches from the raw Mortal JSON.

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
