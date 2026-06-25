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
- Concept-level EV breakdown (two ledgers at the top of a game — "Losing points here" = concepts the AI won / under-used; "Overvaluing these" = concepts you won on a losing play / over-prioritized): aggregator `static/js/game-concept-breakdown.js` (re-buckets the `compare-dimensions.js` win-vector per side×**group**, deduped per mistake so deal_in's per-seat vector and dora_kept+dora_acceptance each count once; attributes full `ev_loss` to every group a mistake touches → columns don't sum to total EV, hence the `.concept-note` disclaimer), rendered by `renderConceptBreakdown` + `renderTopGroupStat` in `static/js/game-render.js` (breakdown under the summary bar, rows = group · EV · severity split, no mistake-count column; the single biggest deduped group also shows as a "Top leak" stat IN the summary bar). Group taxonomy/colour scheme (Efficiency=blue, Yaku=cyan, Value=gold, Defense=red — hues align with the skill-area card palette so a concept shares one colour app-wide) is the single shared source `haipaiCompareDimensions.GROUP_META` (`compare-dimensions.js`), consumed by the EV-table feature pills (`.feat-pill-grp` via `--feat-grp` in `ev-table.js`) AND the breakdown's group pills (`.concept-pill` via `--grp`). On top of the win-vector groups the breakdown also adds **category/shape pills** read straight off the categorized mistake (`ACTION_CELL`/`PILL_META` in `game-concept-breakdown.js`, deduped alongside the win-vector cells via `cellsFor`): Riichi (purple) / Meld (pink) / Kan (green) each split Missed→"Losing points here" vs Bad→"Overvaluing these" off `m.category` (5A/5B, 4A-4C, 6A/6B), and Complex (grey) lands missed-side only off `m.shape`. `game-render.js` resolves both palettes through `conceptMetaMap()`. Styles `.concept-breakdown` / `.feat-pill-grp` in `static/style-game-detail.css`
- Dora highlighting (the orange tile border): single source of truth in `static/js/tiles.js` — `renderTile()` auto-adds `.dora-highlight` from an ambient active-dora set (`setActiveDora()`). Card/board renderers arm the set (`renderMistakeCard`, `renderBoardContext`, the `game-render.js` card loop, `renderEvComparison`, `generateExplanation`); every tile then highlights automatically, including future features. Red fives always highlight. Opt out via `no-dora` / `dora-indicator` / `wind-tile` classes (reference glyphs + the opponent yaku panel). Style: `.tile.dora-highlight` in `static/style-board-display.css`.
- Yaku panel (opponent open-hand pill strip): `static/js/board-yaku-panel.js` (render), `static/js/prep/prep-board-yaku.js` (compute), `static/style-game-detail.css` (style)
- Discard rows (you / danger / riichi) + safe-tile hover: `static/js/board-discards.js`, `static/style-board-display.css`
- Meld rendering: `static/js/board-melds.js`
- Categorization (the live, client-side engine — there is no `lib/categorize.py`): `static/js/categorize.js` (entry), `static/js/categorize-metadata.js` (category labels/groups/colors), `static/js/categorize-yaku.js` (closed-hand yaku detection), `static/js/categorize-explanations.js` (per-category explanation blocks). Before/after changing any of these, benchmark with `scripts/category_bench.mjs` → `.claude/skills/categorize-bench/SKILL.md`
- Mistake card (per-round entry on game detail): `static/js/mistake-card.js`
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
