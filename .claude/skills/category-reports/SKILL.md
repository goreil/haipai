---
name: category-reports
description: Read user-submitted category-correctness reports (agree / wrong_category / wrong_text) for the Haipai mistake categorizer. Use when the user asks to "check the category reports", investigate a categorization complaint, or wants the latest user feedback on mistakes. Reports live in the `category_reports` SQLite table.
---

# Category reports

Production reports live only in the Docker DB at `/app/data/games.db`. The local `games.db` typically has none.

## Read the most recent reports

```bash
docker exec haipai-app-1 python3 /app/scripts/show_reports.py
```

The dump is sorted newest-first and includes the mistake's ev_loss and turn, plus the report's kind and the user's suggested category / reason. (Category is **not** stored on the mistake — it's recomputed client-side, so the dump can't show a "current category".)

## Useful filters

```bash
# Only wrong_category reports
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --kind wrong_category

# Since a date
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --since 2026-04-01

# Single mistake (when the user references one)
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --mistake 5747

# Machine-readable
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --json
```

`--kind` is one of `agree`, `wrong_category`, `wrong_text`.

## Inspecting the underlying mistake

The `mistakes` row stores only `data_json` (TEXT) plus `ev_loss`, `turn`, `note`
— there is **no `category` column** (`r['category']` will KeyError). Category is
recomputed client-side from `data_json`; to see what category a mistake *gets*,
trace `data_json` through `static/js/categorize.js`. Live `data_json` keys:
`actual`, `expected`, `draw`, `shanten`, `hand`, `melds`, `top_actions`,
`labels` (all rows); `board_state` (most); `opponent_discards` +
`safety_ratings` (defense rows only). Discard stats are **not** stored — the
frontend recomputes them via backend shanten/ukeire endpoints.

```bash
docker exec haipai-app-1 python3 -c "
import sqlite3, json
conn = sqlite3.connect('/app/data/games.db')
conn.row_factory = sqlite3.Row
r = dict(conn.execute('SELECT * FROM mistakes WHERE id = 5747').fetchone())
dj = json.loads(r['data_json'] or '{}')
print('actual:', dj.get('actual'), 'expected:', dj.get('expected'))
print('labels:', dj.get('labels'), 'ev_loss:', r['ev_loss'])
"
```

## After a categorization fix — no backfill

Categorization is **100% client-side** (`static/js/categorize.js`) and recomputed
on every fetch; the category is never persisted. So a categorizer fix needs **no
DB backfill** — there is no `recategorize_all.sh` (it was removed). Just ship the
`categorize.js` change and bump `CATEGORIZER_VERSION` + its changelog. (Backfills
are only for changes that alter stored `data_json` fields — see the parse/defense
backfill functions, not categorization.)
