# Backend-to-frontend categorization

## Status (2026-05-18)

**Shipped.** Prep + categorization run entirely in `static/js/prep/` +
`static/js/categorize.js` on every `fetchGame`. Backend ingest only
parses, persists, and ships the slim `mortal_data` payload from
`/api/games/<id>`. Categorize/backfill endpoints (`POST
/api/games/<id>/categorize`, `POST /api/games/backfill-{board-state,
discard-stats,safety-ratings}`), the background prep thread, and
`lib/{categorize,shanten,defense,defense_kd,board,furiten}.py` were
deleted in the Step 7 cutover; `mahjong` was dropped from
`requirements.txt`. `games.categorization_status` survives in the
schema (always written `done`) for the rare admin query that still
reads it.

The legacy `mistakes.severity` column was dropped in the Step 8
cutover: the parser no longer writes it, the JOIN/SELECT paths
(`db/games.py`, `db/reports.py`, `routes/auth.py`, the report scripts)
were trimmed, and the schema migration uses `ALTER TABLE DROP COLUMN`.
The frontend recomputes severity tiers from `ev_loss`
(`static/js/categorize-view.js::sevTier`), and `stats_json.by_severity`
is now derived server-side via `lib.parse.severity()` from the same
`ev_loss` values.

**Step 9 (2026-05-19):** `mistakes.category` removed. The JS
categorizer is the only source of truth — `recategorizeGameInPlace`
in `static/js/game-list.js` had been overwriting the server-stored
category on every fetch, so the column carried no information that
the frontend trusted. The annotate endpoint now persists only the
free-form note, `compute_summary_for_game` and `get_trends` no longer
emit `by_category` (the trends page computes it from the cache that
`docs/backlogs/TRENDS-WEAKEST-CATEGORY.md` covers), and the dormant
`GET /api/top-mistakes` endpoint plus its `toggleTopMistakes` caller
were deleted alongside the column. The migration drops the column and
strips the now-stale `stats_json.by_category` key from existing rows.

## Verification

- `tests/fixtures/categorize_parity.json` — 2,121 mistakes from 50
  random games with the JS categorizer's expected output. The original
  Python sampler (`scripts/sample_categorize_fixture.py`) was removed
  in the Step 9 column drop; refresh via
  `scripts/resnap_prep_in_fixture.mjs` (re-prep) +
  `scripts/snapshot_categorize_fixture.mjs` (re-snap expected).
- `scripts/verify_categorize_js.mjs` — diff JS output against the
  fixture. Run it after any change to `static/js/categorize.js`.

## Deferred (still applicable)

- **Trends per-category aggregate** — planned in
  `docs/backlogs/TRENDS-WEAKEST-CATEGORY.md` (option C: cache the JS
  categorization output per game in `stats_json.by_category`, drive
  the rollup from there). `renderCategoryTrend` in `trends.js`
  remains hidden until that lands.
