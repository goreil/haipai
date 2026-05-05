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

## Open items

### Decided to defer (per user, 2026-05-05)
- **Practice mode** — being removed soon, so don't move its
  `WHERE m.category IN (…)` filter to JS. It returns 0 hits on
  new-game mistakes today; that's fine until removal.
- **Trends per-category aggregate** — the panel
  (`renderCategoryTrend` in `trends.js`) is hidden client-side and the
  server's `compute_summary_for_game` still writes a `by_category`
  blob from the (now-stale-on-new-games) `category` column. Decide
  later whether to bring the panel back, recompute server-side, or
  drop entirely.

### Known minor degradations (worth fixing eventually)
- **`threatening_opponent` scene flag** is no longer set. Previously the
  Python categorizer flagged "opponent has 3+ open melds without
  riichi"; JS can't derive this from `data_json` alone. The UI text
  variants in `categorize-view.js` that read `defense_trigger ===
  "open_melds"` are now dead paths. Harmless — falls through to the
  generic "an opponent is threatening" line.
- **Dora label parity bug carried over from Python** — kan-revealed
  dora aren't tagged on labels because the original Python only passed
  the opening indicator to `compute_labels`. JS mirrors that for
  parity (`board_state.dora_tiles[0]` only). To fix: read all of
  `dora_tiles` in `static/js/categorize.js::categorize`. Comment in
  the file flags the spot.

### Lingering naming after the refactor (separate axis, do later)
- `lib/categorize/` is now an input-prep package, not a categorizer.
  Rename to e.g. `lib/mistake_data/` once paired with a wider rename
  pass. `categorize_mistake` / `categorize_game_db` are already gone;
  the surviving names (`prepare_mistake_data`, `prepare_game_data`)
  reflect the new role.
- `mistakes.category` column and `games.categorization_status` column
  both still exist — schema-preserving per refactor guidelines.
  `category` is now used only by manual annotations
  (`db.annotate_mistake`); `categorization_status` reflects prep
  status. Don't drop without an explicit schema-change plan.
- HTTP endpoint `POST /api/games/<id>/categorize` retained for client
  compatibility; under the hood it calls `prepare_game_data`.

## Verification

- `tests/fixtures/categorize_parity.json` — 2,121 mistakes from 50
  random games with the Python categorizer's stored output. Built by
  `scripts/sample_categorize_fixture.py` (run inside Docker against
  the prod DB).
- `scripts/verify_categorize_js.mjs` — diff JS output against the
  fixture. Run it after any change to `static/js/categorize.js`.
  Current parity: 100% on `category` and `labels`; 97.31% on
  `categorize_data` (the gap is the dropped `threatening_opponent`
  flag — intentional).
- `tests/test_core.py::TestAddGamePipeline` pins the prep contract
  (every dahai-vs-dahai mistake gets `discard_stats`, status reaches
  `done`, etc.). No backend assertion on `category` column anymore.
