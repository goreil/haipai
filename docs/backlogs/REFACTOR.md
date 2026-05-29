# Haipai Cleanup Refactor — Plan

Draft: 2026-05-29. Follow `REFACTOR-GUIDELINES.md` (delete before reshape, no
file >~600 LOC, schema is a wall, one canonical place per concept).

## Inventory snapshot (2026-05-29)

Files over the 600 LOC ceiling (non-vendor, non-test count separately):

| File                              | LOC  |
|-----------------------------------|------|
| `static/style.css`                | 3367 |
| `static/js/board.js`              |  960 |
| `static/js/trends.js`             |  823 |
| `static/js/categorize-view.js`    |  813 |
| `tests/test_core.py`              |  774 |
| `static/js/game-list.js`          |  688 |
| `tests/test_api.py`               |  687 |
| `static/js/prep/board.js`         |  638 |

Recent prune passes (4339038, 73d77ab, 9c99b04, f6c50a3) already shed dead
CSS, the unloaded `prep/efficiency.js`, stale Python routes/helpers/migrations,
and the legacy `data_json` fields. Expect *low-density* dead code left;
remaining wins are split + de-duplicate.

---

## Phase 1 — Delete before reshape

Cheapest, lowest-risk PRs. Ship each as its own commit so a regression bisects
cleanly.

### 1.1 Drop dead Python (~94 LOC) — DONE
- **`lib/tiles.py`** — deleted (34 LOC). The `TestTileConversion` class in
  `tests/test_core.py` covered JS-mirrored logic and was removed with it.
- **`lib/parse.py`** `print_text()` + `main()` — deleted, along with the now
  unused `argparse`/`json`/`sys` imports. CLAUDE.md's stale
  `python3 -m lib.parse analysis.json` example removed in the same commit.

### 1.2 Verify before deleting
The earlier prune commits aggressively cleaned routes, helpers, and CSS, so
re-run lightweight checks before each delete:
- `rg <symbol>` across all of `static/`, `templates/`, `routes/`, `scripts/`
- For routes: also check JS `fetch(` and `<form action=` references
- For CSS: check both templates and any JS that injects classes via `className`

**Sweep done (2026-05-29):** Applied this methodology repo-wide as Phase 1's
last delete pass.
- **Found and removed:** `dealinClass()` in `static/js/ev-table.js` (4 LOC).
  The CSS class strings it returned were hardcoded inline at the only would-be
  call site; `dealinColor()` / `dealinLabelText()` next to it are live.
- **Clean:** all Flask routes (reachable via JS `fetch` or templates), all
  `db/` exports, remaining `lib/parse.py` helpers, every `<script>`-loaded JS
  module, every `static/style.css` class (415+ checked), all
  `render_template`'d HTML files, and the three `scripts/` tools.
- Don't re-run this pass before Phase 2/3 unless those phases add new
  candidates; the corpus is at the bottom of useful-grep territory.

---

## Phase 2 — Collapse duplicate concepts

Each item is one canonical place per concept.

### 2.1 Tile base normalization — DONE
- `static/js/tiles.js` `tileBase()` is now the general `.endsWith("r")` form;
  `normalizeRed()` deleted. `ev-table.js` (5 call sites) switched to `tileBase`.
- `categorize.js` keeps an IIFE-private copy with identical logic, commented as
  intentionally duplicated for standalone vm loading by
  `scripts/verify_categorize_js.mjs` / `scripts/snapshot_categorize_fixture.mjs`.
  The unused `tileBase` entry in the `haipaiCategorize` export object is gone.

### 2.2 Severity/EV thresholds — DONE
- New `static/js/severity.js` owns `sevTier`/`sevClass`/`sevLabel`/
  `sevTooltip` and `computeThresholds(games)`. categorize-view.js no longer
  defines them; game-list.js dropped its local `computeRatingThresholds`
  and calls `computeThresholds(state.games)` from `gameRating`.
- Trends.js was not a consumer (it reads server-side `by_severity`), so it
  was left untouched.

### 2.3 Skill-area metadata — DONE
- New `static/js/skill-areas.js` owns `TREND_SKILL_AREAS`,
  `TREND_MIN_DECISIONS`, `trendSkillAreaFor`, `trendSkillAreaInfo`. trends.js
  removed its local copy.
- The plan note that game-list.js queried these was outdated — game-list.js
  uses `catGroup`/`GROUP_COLORS` instead, which is a different concept and
  stays where it is until 2.4.

### 2.4 Suit/tile helpers (cross-language and cross-file) — DONE
- `SUIT_NAME` / `SUIT_TILE` moved from `static/js/board.js` to
  `static/js/tiles.js` so the Phase 3.2 board.js split inherits one
  definition. categorize-view.js never actually had them despite the
  original plan note — verified via grep.
- `_base_mjai()` in `static/js/prep/board.js` promoted to `base_mjai()` in
  `static/js/prep/tiles.js` (the prep-namespace canonical home, twin of the
  integer-level `tile_id_to_base`). prep/board.js now destructures it.
- No re-export from `categorize.js` was needed — no caller hid suit helpers
  behind that namespace.

### 2.5 Test fixture factories — DONE
- New `tests/fixtures.py` exports `make_mistake()`, `make_round()`, and
  `make_game()`. Each takes keyword overrides; sensible defaults cover the
  common "one round, one mistake" shape with no args.
- `test_core.py` and `test_api.py` both import. Across the two modules: 139
  lines of fixture boilerplate deleted, 61 added (net −78). All 135 tests
  still pass.

---

## Phase 3 — Split oversized files — DONE

All eight splits shipped 2026-05-29. New module names match concepts so
`grep`/`rg` for the right noun lands on the first try. Actual line counts
are in parentheses; the plan's estimates were loose, the splits are real.

### 3.1 `static/style.css` (3367 → 4 files) — DONE
- `style-theme.css` (65) — :root tokens incl. new `--sev-tint-*`,
  `.sev-*` modifier rules exposing `--sev-color`/`--sev-tint`, body
  typography, scrollbar, responsive.
- `style-layout.css` (1242) — app shell, sidebar, toolbar, content,
  tabs, modals/forms, account, trends layout, help, landing, admin,
  mailbox.
- `style-game-detail.css` (1781) — game header, summary bar, round /
  mistake cards, yaku panels (yakuhai/sanshoku/ittsuu/dead) + popovers,
  action pills, top actions, EV table, suji, dev IDs, furiten,
  all-last, tenpai-waits, note row, category feedback, summary view,
  mascot, defense-context, shanten hint, ukeire-inline, dead-wait
  chips, furiten-overlap, bad-riichi EV bars, category-report cards.
- `style-board-display.css` (282) — hand display (with `.tile` sized
  via `--tile-size`), riichi tile, skipped-turn placeholder,
  safe-from-riichi hover, board context (winds/dora/scores), discard
  rows, inline melds, threat pills, ghost tile, KD safety.

Dedup applied: 14 `.{severity,mistake,tier-count}.sev-*` rules → 5
`.sev-*` modifier rules in theme. `.tile`, `.tile-sm`, `.action-tile`,
`.action-tile-sm` now share one base block driven by `--tile-size`.

`style-game-detail.css` (1781) and `style-layout.css` (1242) still
cross the 600-LOC ceiling — but no obvious finer-grained boundary
exists today (these are flat sequences of small unrelated rules).
Revisit only if a concept inside them grows enough to factor out.

### 3.2 `static/js/board.js` (959 → 3 files) — DONE
- `board-melds.js` (157) — `renderMeld`, `meldDoraCount`,
  `formatAction`, `renderAction`.
- `board-yaku-panel.js` (429) — `YAKU_META`, new shared `YAKU_STATES`,
  yakuhai/honitsu/chanta renderers, sanshoku + ittsuu via shared
  `renderRunCandidateDetail`, `renderYakuPill` /
  `renderDeadYakuhaiPill` / `collectDeadPills` / `renderYakuStrip`,
  dead-toggle click handler.
- `board-discards.js` (371) — `WIND_DISPLAY`, `SEAT_NAMES`,
  `mistakeActorSeat` / `mistakeOya`, `renderHand`,
  `renderTenpaiWaitsRow` / `tenpaiWaitTiles`, `renderBoardContext`.

Extracted `YAKU_STATES` (replaces 3 inline locked/close/dead literals)
and `renderRunCandidateDetail` (shared sanshoku/ittsuu popover).

### 3.3 `static/js/trends.js` (784 → 3 files) — DONE
- `trends-charts.js` (196) — SVG renderers, no state: `trendChartWidth`,
  `renderLineChart`, `renderStackedBarChart`, `renderGroupStackedChart`.
- `trends-analysis.js` (334) — worker pool (`trendsStash`,
  `startWeaknessAnalysis`, `cancelWeaknessAnalysis`,
  `_saveSnapshotFromAnalysis`), aggregation, recommendation,
  per-skill-area breakdown.
- `trends-view.js` (275) — fetch + page render orchestrator,
  snapshots history, toggles.

### 3.4 `static/js/categorize-view.js` (770 → 3 files) — DONE
- `categorize-metadata.js` (52) — `CATEGORIES`, `CATEGORY_INFO`,
  `GROUP_COLORS`, `OUTCOME_EMOJI`, `catLabel` / `catGroup` / `catDesc`.
- `categorize-yaku.js` (159) — `_mjaiToRiichiTile`, `_windToKazeInt`,
  `_formatRiichiHandStr`, `_SITUATIONAL_YAKU`, `_YAKU_LABEL`,
  `detectClosedHandYaku`.
- `categorize-explanations.js` (588) — `generateExplanation` and all
  nested defense/standing helpers.

(After Phase 2.2 there was no severity logic left to wrap; metadata is
pure data — no need for the planned thin-wrapper file.)

### 3.5 `static/js/game-list.js` (679 → 3 files) — DONE
- `game-fetch.js` (104) — `fetchGames`, `fetchGame`, `saveAnnotation`,
  `addGameWithProgress`, `deleteGame`, `showOnboarding`.
- `game-render.js` (434) — `gameRating`, `renderGameList`,
  `setSeverityFiltersVisible`, `renderGame`, `switchGameView`,
  `toggleGameMistakes`, `toggleTrendMistakes`, `navigateHome`.
- `game-prep.js` (148) — prep progress tracking, in-place
  recategorize / summary recompute, severity auto-set + checkbox sync.

### 3.6 `static/js/prep/board.js` (632 → 2 files) — DONE
- `prep-board-state.js` (206) — `decrement_wall`,
  `reconstruct_context`, `extract_board_state`,
  `subtract_hand_from_wall`. Exposed as `haipaiPrepBoardState`.
- `prep-board-yaku.js` (450) — `compute_yaku_panel`. Exposed as
  `haipaiPrepBoardYaku`. The two modules don't import from each other;
  both only need `haipaiPrepTiles` (yaku also needs nothing else,
  state additionally needs `haipaiPrepParse`).

### 3.7 `tests/test_core.py` (691 → merged + 2 files) — DONE
- `TestParsing` merged into `test_parse.py` alongside the existing
  parse-error and decision-counts tests. No name collisions.
- `test_db_core.py` (94) — init, user CRUD, game CRUD, list.
- `test_db_advanced.py` (~330) — trends, summary, annotate, reports,
  snapshots, OAuth.
- `TestAPI` + `TestAddGamePipeline` from `test_core.py` absorbed into
  the 3.8 split files (duplicate `/login` + `/api/games` tests dropped;
  unique `/api/categories`, annotate-validation, snapshots, and
  upload-pipeline tests landed in `test_api_game.py`).

### 3.8 `tests/test_api.py` (669 → 3 files) — DONE
- `test_api_auth.py` (175) — `TestAuth`, `TestRegistration`,
  `TestAuthEdgeCases`.
- `test_api_game.py` (~290) — `/api/me`, `/api/games` CRUD,
  `/api/trends`, `/api/trends/snapshot[s]`, `/api/categories`,
  `/api/games/<id>/annotate`, upload-pipeline round-trip.
- `test_api_reports.py` (~310) — `/api/mistakes/<id>/report` and
  `/api/admin/users/<id>` GDPR wipe.
- `_insert_game` helper promoted to `tests/conftest.py` as
  `insert_game` so both consumers share one fixture shape.

135 → 131 tests; the 4-test delta is duplicate names dropped during
the merge (no coverage loss).

---

## Phase 4 — Findability tweaks (rename / move)

Only the leftover oddities; most names are already concept-matched.

- After Phase 1.1, `static/js/prep/tiles.js` is the canonical tile module;
  consider whether `static/js/tiles.js` (rendering helpers) and the prep
  module want suffixes (`tiles-render.js` vs `tiles-mjai.js`) so a grep for
  "tiles" doesn't ambiguously land. Decide during Phase 2.4.
- `scripts/show_reports.py` and `scripts/leave_message.py` are tools, fine
  where they are. `scripts/test_gdpr_delete.py` despite the name is a manual
  smoke runner — leave a one-line comment noting it is *not* a pytest target.

---

## Hard constraints (repeated for the future-me reading this)

- **Schema is a wall.** `games.db` is live production. Nothing in this plan
  touches it.
- **`data_json` is purged** — do not re-introduce stored derivative fields.
  All categorization/prep recomputes live in the frontend.
- **Categorization** is 100% client-side in `static/js/categorize.js`. Do
  not resurrect `lib/categorize.py`.

---

## Execution order

1. Phase 1 (deletes) — single PR per item, can land in a day.
2. Phase 2 (de-duplicate) — order: 2.1 → 2.2 → 2.3 → 2.4 → 2.5. Each lands
   independently; the splits in Phase 3 depend on these constants existing.
3. Phase 3 (splits) — DONE 2026-05-29.
4. Phase 4 (renames) — only after callers have stabilized post-Phase 3.

Add the prep skill `verify` after every PR that touches rendering code:
hot-reload alone won't catch a stale `<script>` reference.
