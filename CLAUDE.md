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

# Lower-level
python3 -m lib.parse analysis.json
```

## Important notes

- Downloads from `mjai.ekyu.moe` must be done manually due to cloudflare
- `SECRET_KEY` must be set via `.env` or environment variable. No insecure default is provided.
- Debug mode requires `FLASK_ENV=development` (off by default).
- Frontend should handle most categorization logic, backend handles shanten/ukeire calc but that's subject to change.


## Data storage

SQLite database at `games.db`. — read it there rather than duplicating here.

## Further context

- Tile notation (mjai format vs. SVG filenames) → `.claude/skills/tile-notation/SKILL.md`
