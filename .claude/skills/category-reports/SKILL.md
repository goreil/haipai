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

The dump is sorted newest-first and includes the mistake's current category, severity, ev_loss, and the user's suggested category / reason.

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

To pull the full data_json (discard_stats, labels, categorize_data) for a reported mistake:

```bash
docker exec haipai-app-1 python3 -c "
import sqlite3, json
conn = sqlite3.connect('/app/data/games.db')
conn.row_factory = sqlite3.Row
r = dict(conn.execute('SELECT * FROM mistakes WHERE id = 5747').fetchone())
dj = json.loads(r['data_json'] or '{}')
print('actual:', dj.get('actual'), 'expected:', dj.get('expected'))
print('category:', r['category'], 'labels:', dj.get('labels'))
for s in (dj.get('discard_stats') or [])[:6]:
    print(' ', s.get('tile'), 'sh=', s.get('shanten'), 'nec=', s.get('necessary_count'))
"
```

## Backfill after a categorization fix

When a fix changes how mistakes are categorized, re-run the categorizer over the whole DB so existing rows pick up the new labels:

```bash
bash scripts/recategorize_all.sh
```
