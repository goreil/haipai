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
- Bad-riichi visualization: `static/js/bad-riichi-bars.js`
- Tile rendering vs. mjai-base helpers: `static/js/tiles.js` (SVG render + `tileBase()`), `static/js/prep/tiles.js` (mjai pid/suit helpers used by the prep pipeline)
- Prep pipeline (shanten/ukeire/board reconstruction; runs client-side as a worker): `static/js/prep/prep.js` (orchestrator), `static/js/prep/prep-board-state.js` (context reconstruction), `static/js/prep/prep-board-yaku.js` (shape yaku), `static/js/prep/shanten.js` + `shanten_calc.js`, `static/js/prep/furiten.js`, `static/js/prep/parse.js`
- WASM shanten/ukeire kernel (opt-in, default JS): adapter `static/js/prep/shanten_calc_wasm.js`, async bootstrap `static/js/prep/wasm-bootstrap.js`, served assets `static/wasm/` (rebuild via `scripts/wasm_build_web.sh`), Rust in `wasm/haipai-shanten/`. Enable in-browser with `?wasm_shanten=1`. Full status + remaining work: `docs/backlogs/WASM-SHANTEN.md`
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
