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

## Phase 3 — Split oversized files

Each split is its own PR. The new module names match the concept so a `grep`
or `rg` for the right noun lands on the first try.

### 3.1 `static/style.css` (3367 → 4 files)
- `style-theme.css` (~150) — vars, typography, dark theme.
- `style-layout.css` (~400) — sidebar, toolbar, content/tabs, modals/forms.
- `style-game-detail.css` (~800) — header, summary bar, round/mistake cards,
  tiles, EV table, yaku panels (yakuhai/sanshoku/ittsuu/dead) and popovers.
- `style-board-display.css` (~900) — board context (winds/dora/scores),
  discard rows, threat pills, hand-tile safety coloring, melds, actions.

Internal duplication to flatten while splitting:
- Severity-badge color classes — consolidate to a shared pattern.
- Tile sizing classes (`.tile`, `.tile-sm`, `.action-tile`, `.action-tile-sm`)
  — drive sizes from CSS custom properties.

### 3.2 `static/js/board.js` (960 → 3 files)
- `board-melds.js` (~120) — `renderMeld()`, `meldDoraCount()`.
- `board-yaku-panel.js` (~380) — yakuhai/honitsu/chanta/tanyao/toitoi
  helpers, sanshoku Variant B+D, ittsuu, `renderYakuPill()`, dead-pill, strip
  assembly, dead-toggle handler.
- `board-discards.js` (~280) — turn-sequence reconstruction, discard rows
  (you/danger/riichi), inline melds, safe-from-riichi hover, scores bar.

While splitting, extract a `YAKU_STATES` constant for the `locked/possible/
close/dead` metadata that currently lives inline in three places, and a
popover-builder helper shared by sanshoku and ittsuu.

### 3.3 `static/js/trends.js` (823 → 3 files)
- `trends-charts.js` (~180) — SVG line chart with MA, stacked-bar, grouped
  stacked, width helper.
- `trends-analysis.js` (~320) — async worker pool, progress, categorize in
  place, snapshot autosave, cancel handler, aggregation helpers,
  recommendation, per-skill-area breakdown.
- `trends-view.js` (~320) — fetch, page render, cache validation,
  snapshots history, toggle handlers.

### 3.4 `static/js/categorize-view.js` (813 → 3 files)
- `categorize-explanations.js` (~480) — `generateExplanation()` and all
  per-category blocks (4A/4B/4C, 5A/5B, 6A/6B, D1/D2/D3, P1-P4, legacy 1A-3B)
  plus the nested defense/standing helpers.
- `categorize-yaku.js` (~200) — `detectClosedHandYaku()`, riichi-calculator
  tile/wind converters, situational yaku filter, yaku label map.
- `categorize-metadata.js` (~130) — category labels/groups/descriptions,
  group colors, outcome emoji, severity tier mapping (after Phase 2.2 this
  becomes a thin wrapper).

### 3.5 `static/js/game-list.js` (688 → 3 files)
- `game-fetch.js` (~120) — fetch, addGameWithProgress, saveAnnotation.
- `game-render.js` (~350) — sidebar list with date separators + ratings,
  game detail render (rounds view + summary view), mistake/category-group
  rendering.
- `game-prep.js` (~120) — prep progress tracking, in-place
  recategorize/summary recompute, severity auto-set + checkbox sync.

### 3.6 `static/js/prep/board.js` (638 → 2 files)
- `prep-board-state.js` (~250) — context reconstruction, main
  `extract_board_state()`, wall manipulation.
- `prep-board-yaku.js` (~380) — shape yaku (tanyao/toitoi/chanta/honitsu
  with chinitsu/junchan upgrades), sanshoku candidates, shared tile/suit
  helpers.

### 3.7 `tests/test_core.py` (774 → 3 files)
- `test_parse.py` already exists at 216 LOC; **merge** the parsing tests
  here, do not create a second file. Confirm names don't collide.
- `test_db_core.py` (~180) — init, user CRUD, game CRUD, list.
- `test_db_advanced.py` (~200) — trends, summary, annotation, reports,
  snapshots, OAuth.

### 3.8 `tests/test_api.py` (687 → 3 files)
- `test_api_auth.py` (~140) — login/logout/register/edge cases.
- `test_api_game.py` (~220) — `/api/me`, game CRUD, get/delete.
- `test_api_reports.py` (~150) — category reports + admin GDPR wipe.

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
3. Phase 3 (splits) — order by risk: tests first (3.7, 3.8), then CSS (3.1),
   then JS by leaf-first dependency (3.6 prep/board → 3.4 categorize-view →
   3.2 board → 3.3 trends → 3.5 game-list).
4. Phase 4 (renames) — only after callers have stabilized post-Phase 3.

Add the prep skill `verify` after every PR that touches rendering code:
hot-reload alone won't catch a stale `<script>` reference.
