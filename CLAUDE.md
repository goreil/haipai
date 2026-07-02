# CLAUDE.md

Guidance for Claude Code working in the Haipai repo.

## What this is

Riichi mahjong game analysis web app. Analyzes Tenhou/MJS replays via Mortal AI, auto-categorizes mistakes using a local pure-Python shanten/ukeire library, and serves a web UI for review, annotation, and trend tracking. 

## Commands

The project uses a venv at `.venv/`. Invoke its binaries directly (`.venv/bin/python`, `.venv/bin/pytest`) — system `python3` does not have `mahjong` or the Flask deps installed.


```bash
# Web UI (dev server)
FLASK_ENV=development .venv/bin/python app.py       # http://localhost:5000

# Tests
.venv/bin/pytest tests/ -v

# Docker (production)
# Source dirs (static/, templates/, app.py, db/, lib/, routes/, scripts/) are
# bind-mounted and gunicorn runs --reload, so code/static/template edits go live
# on the next request — no restart needed. Rebuild only when deps/image change.
docker-compose up -d --build      # after requirements/Dockerfile/compose changes
docker-compose restart app        # rarely needed; only to force a clean reload
docker-compose logs -f app
```

## Important notes

- Downloads from `mjai.ekyu.moe` must be done manually due to cloudflare
- `SECRET_KEY` must be set via `.env` or environment variable. No insecure default is provided.
- Debug mode requires `FLASK_ENV=development` (off by default).
- Frontend should handle most categorization logic, backend handles shanten/ukeire calc but that's subject to change.


## Data storage

SQLite database at `games.db`. — read it there rather than duplicating here.

## Where things live

User-visible concepts that span more than one file. Start here before
grepping. If you change a concept that isn't listed, add it.

**Frontend — features**
- Concept-level EV breakdown (top of a game): a **left ledger** ("Losing points here" = concepts the AI won / under-used) beside a **right column of trade-off boxes** (which replaced the old "Overvaluing these" ledger). Aggregator `static/js/game-concept-breakdown.js`. The ledger side: `aggregate()` re-buckets the `compare-dimensions.js` win-vector per side×**group**, deduped per mistake so deal_in's per-seat vector and dora_kept+dora_acceptance each count once; attributes full `ev_loss` to every group a mistake touches → columns don't sum to total EV, hence the `.concept-note` disclaimer. The **trade-off boxes**: `tradeoffBoxes()` buckets every *over-favoring* mistake (≥1 you-side win or bad-action pill) into exactly ONE axis by priority — **Push vs. Fold** (any Defense/deal_in pole), else **Speed vs. Value** (Speed on one side, Yaku/Dora on the other), else **Other** (catch-all: yaku-vs-dora, single-pole, bad riichi/call/kan). Each box lists per-mistake rows: your play's winning pills (left) vs the better play's (right), tier-coloured EV, and a `→` jump button (reuses the `#m<id>` deep-link router). Both are rendered by `renderConceptBreakdown` (ledger) + `renderTradeoffBoxes` (boxes) + `renderTopGroupStat` (summary-bar "Top leak") in `static/js/game-render.js`. **Row pills are the SAME concrete chips as the EV-table summary** ("+5 ukeire", "+dora 🀋", "-2.6% deal-in") via the shared `renderWinFeatPill(w, oya)` extracted to `static/js/ev-table.js` (top-level; consumed by both `renderEvComparison` and `renderTradeoffBoxes`). Group taxonomy/colour (Efficiency=blue, Yaku=cyan, Value=gold, Defense=red — hues align with the skill-area card palette) is the single shared source `haipaiCompareDimensions.GROUP_META` (`compare-dimensions.js`), consumed by the feat-pills (`.feat-pill-grp` via `--feat-grp`) AND the ledger's group pills (`.concept-pill` via `--grp`). On top of the win-vector groups the ledger adds **category/shape pills** off the categorized mistake (`ACTION_CELL`/`PILL_META` in `game-concept-breakdown.js`, deduped via `cellsFor`): Riichi (purple) / Meld (pink) / Kan (green) split Missed→ledger vs Bad→boxes off `m.category` (5A/5B, 4A-4C, 6A/6B); Complex (grey) is missed-side ledger only off `m.shape`. `game-render.js` resolves palettes via `conceptMetaMap()`. Styles `.concept-breakdown` / `.tradeoff-box` / `.feat-pill-grp` in `static/style-game-detail.css`
- Dora highlighting (the orange tile border): single source of truth in `static/js/tiles.js` — `renderTile()` auto-adds `.dora-highlight` from an ambient active-dora set (`setActiveDora()`). Card/board renderers arm the set (`renderMistakeCard`, `renderBoardContext`, the `game-render.js` card loop, `renderEvComparison`, `generateExplanation`); every tile then highlights automatically, including future features. Red fives always highlight. Opt out via `no-dora` / `dora-indicator` / `wind-tile` classes (reference glyphs + the opponent yaku panel). Style: `.tile.dora-highlight` in `static/style-board-display.css`.
- Yaku panel (opponent open-hand pill strip): `static/js/board-yaku-panel.js` (render), `static/js/prep/prep-board-yaku.js` (compute), `static/style-game-detail.css` (style)
- Discard rows (you / danger / riichi) + safe-tile hover: `static/js/board-discards.js`, `static/style-board-display.css`
- Meld rendering: `static/js/board-melds.js`
- Categorization (the live, client-side engine — there is no `lib/categorize.py`): `static/js/categorize.js` (entry), `static/js/categorize-metadata.js` (category labels/groups/colors), `static/js/categorize-yaku.js` (closed-hand yaku detection), `static/js/categorize-explanations.js` (per-category explanation blocks). Before/after changing any of these, benchmark with `scripts/category_bench.mjs` → `.claude/skills/categorize-bench/SKILL.md`
- Mistake card (per-round entry on game detail): `static/js/mistake-card.js`
- Complex-gap feedback funnel (EXTRAS-A): on **complex**-shape cards, embedded
  INSIDE the trainer's speech bubble (under the "stats don't explain it — trust
  the read" line), a "We can't pin down what Mortal read — can you?" CTA with
  multi-select quick-tags + free text. Complex cards get NO `wrong_text` report
  row (the funnel replaces it). The bubble is built by `trainerBubbleHtml(m)`
  (`static/js/mistake-card.js`) — used by both game-detail render paths in
  `static/js/game-render.js` (rounds + summary); admin/trends build their own
  non-interactive bubbles via `generateExplanation` directly, so the funnel never
  leaks there. Funnel render/handlers `renderComplexGapFunnel`/`saveComplexGap`/
  `onComplexTag`/`onComplexReason` (`static/js/mistake-card.js`), actions in
  `static/js/actions.js`, styles `.complex-gap-*` (`static/style-game-detail.css`).
  Stored in `category_reports` under kind `complex_gap` (tags comma-joined in
  `suggested_category`, free text in `reason`; no schema change): `db/reports.py`
  `REPORT_KINDS` + the report route in `routes/game.py`. Read path:
  `scripts/show_reports.py` (`--kind complex_gap`, tag tally) + admin reports
  (`static/js/admin.js`).
- EV / severity tier coloring: `static/js/severity.js` (shared helpers), `static/js/ev-table.js`; importers: `static/js/trends-charts.js`, `static/js/game-render.js`, `static/js/categorize-explanations.js`
- Skill-area metadata (push/defense/riichi labels): `static/js/skill-areas.js`; importers: `static/js/trends-*.js`, `static/js/game-render.js`
- Trends page: `static/js/trends-view.js` (page shell + fetch), `static/js/trends-charts.js` (SVG charts), `static/js/trends-analysis.js` (worker pool + aggregations)
- Game list + game detail: `static/js/game-fetch.js` (load + annotation save), `static/js/game-render.js` (sidebar + detail render), `static/js/game-prep.js` (prep progress + recategorize)
- Defense (riichi safety): `static/js/prep/defense.js` (classic suji), `static/js/prep/defense_kd.js` (KillerDucky port — riichi threats only, see [[defense_open_meld_deferred]]), `static/js/defense-labels.js` (UI label map)
- Soft-safe open defense (`Safe*` — tsumogiri-extended genbutsu): open-threat tiles that passed while the opp's wait was frozen (since their last tedashi) mark safe but never seed suji. `parse.js` (`flow_pos_at_last_tedashi`), `defense.js` (`soft_safe` set, deal-in→0), `defense-labels.js` (`softSafeForTile`), rendered as `Safe*` in `board-discards.js` + `ev-table.js`, board hover anchor on the last tedashi in `ui.js`. Rationale (esp. why no suji): `docs/backlogs/SOFT-SAFE-OPEN-DEFENSE.md`
- Bad-riichi visualization: `static/js/bad-riichi-bars.js`
- Tile rendering vs. mjai-base helpers: `static/js/tiles.js` (SVG render + `tileBase()`), `static/js/prep/tiles.js` (mjai pid/suit helpers used by the prep pipeline)
- Prep pipeline (shanten/ukeire/board reconstruction; runs client-side as a worker): `static/js/prep/prep.js` (orchestrator), `static/js/prep/prep-board-state.js` (context reconstruction), `static/js/prep/prep-board-yaku.js` (shape yaku), `static/js/prep/shanten.js` + `shanten_calc.js`, `static/js/prep/furiten.js`, `static/js/prep/parse.js`
- WASM shanten/ukeire kernel (on by default for everyone; JS is the fallback): adapter `static/js/prep/shanten_calc_wasm.js`, async bootstrap `static/js/prep/wasm-bootstrap.js`, served assets `static/wasm/` (rebuild via `scripts/wasm_build_web.sh`), Rust in `wasm/haipai-shanten/`. Opt out in-browser with `?wasm_shanten=0`. Full status + remaining work: `docs/backlogs/WASM-SHANTEN.md`
- Auth / account / admin UI: `static/js/account.js`, `static/js/admin.js`, `templates/login.html`
- Category snapshot (admin dashboard panel tracking the global mistake **shape** distribution — obvious / trade-off / complex / n/a — with `complex` as the headline bucket to drive down): the categorizer is client-side only and the container has no Node, so the admin browser runs the same prep + categorize the games view uses (`prepGameAsync` + `recategorizeGameInPlace`) over every game and tallies by shape. Panel + compute loop `snapshotPanelHtml`/`computeCategorySnapshot`/`saveCategorySnapshot` (`static/js/admin.js`), actions in `static/js/actions.js`, styles `.snapshot-*` (`static/style-layout.css`). Cross-user data endpoints `/api/admin/snapshot/game-ids` + `/api/admin/snapshot/game/<id>` and save/list `/api/admin/category-snapshots` (`routes/admin.py`); persisted in the global (no user_id) `category_snapshots` table (`db/schema.py`) via `insert_category_snapshot`/`list_category_snapshots` (`db/snapshots.py`). Mirrors the offline `scripts/category_stats.mjs` headline (same `categorize.js`). NB: distinct from the per-user `weakness_snapshots` (`insert_snapshot`).
- Mailbox messages: `static/js/mailbox.js`
- API client + shell: `static/js/api.js`, `static/js/main.js`, `static/js/ui.js`, `static/index.html`

**Frontend — CSS (split by visual scope, not by JS module)**
- `static/style-theme.css` — vars, typography, dark theme
- `static/style-layout.css` — sidebar, toolbar, tabs, modals, forms
- `static/style-game-detail.css` — game header, round/mistake cards, EV table, yaku panels
- `static/style-board-display.css` — board context, discards, threat pills, hand safety, melds

**Backend**
- Routes (Flask blueprints): `routes/auth.py`, `routes/game.py`, `routes/pages.py`, `routes/admin.py`, `routes/mailbox.py`
- DB layer (one file per table-group): `db/users.py`, `db/games.py`, `db/mistakes.py`, `db/reports.py`, `db/snapshots.py`, `db/messages.py`, `db/admin.py`, `db/schema.py`
- MJAI log parsing (round walking, action formatting, severity): `lib/parse.py`
- Backend category metadata reference (NOT the categorizer): `lib/categories.py`
- App entry: `app.py`

## Further context

- Tile notation (mjai format vs. SVG filenames) → `.claude/skills/tile-notation/SKILL.md`
- Why this section exists + alternatives considered → `docs/backlogs/FINDABILITY.md`
