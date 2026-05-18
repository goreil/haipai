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

## Verification

- `tests/fixtures/categorize_parity.json` — 2,121 mistakes from 50
  random games with the JS categorizer's expected output. Built by
  `scripts/sample_categorize_fixture.py` (run inside Docker against
  the prod DB) and refreshed via `scripts/resnap_prep_in_fixture.mjs`
  (re-prep) + `scripts/snapshot_categorize_fixture.mjs` (re-snap
  expected).
- `scripts/verify_categorize_js.mjs` — diff JS output against the
  fixture. Run it after any change to `static/js/categorize.js`.

## Deferred (still applicable)

- **Trends per-category aggregate** — planned in
  `docs/backlogs/TRENDS-WEAKEST-CATEGORY.md` (option C: cache the JS
  categorization output per game in `stats_json.by_category`, drive
  the rollup from there). `renderCategoryTrend` in `trends.js`
  remains hidden until that lands.
