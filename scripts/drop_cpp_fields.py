#!/usr/bin/env python3
"""Strip legacy ``cpp_best`` and ``cpp_stats`` from every mistake's data_json.

These were the pre-frontend-categorizer copies of the speed-calculator's best
discard + per-tile stats. No current code reads them: the JS prep step
(``static/js/prep/prep.js``) recomputes ``discard_stats`` / ``best_discard``
fresh at render time, so the stored copies are dead weight that only confuse
anyone inspecting the DB.

Usage:
    .venv/bin/python scripts/drop_cpp_fields.py           # local
    docker compose exec app python scripts/drop_cpp_fields.py
"""

import os
import sqlite3
import sys


def pick_db():
    if os.environ.get("DB_PATH"):
        return os.environ["DB_PATH"]
    for p in ("/app/data/games.db", "games.db"):
        if os.path.exists(p):
            return p
    sys.exit("No DB found. Set DB_PATH or run from the repo root.")


def main():
    db_path = pick_db()
    print(f"DB: {db_path}")
    conn = sqlite3.connect(db_path)

    for field in ("cpp_best", "cpp_stats"):
        before = conn.execute(
            f"SELECT COUNT(*) FROM mistakes "
            f"WHERE json_extract(data_json, '$.{field}') IS NOT NULL"
        ).fetchone()[0]
        conn.execute(
            f"UPDATE mistakes SET data_json = json_remove(data_json, '$.{field}') "
            f"WHERE json_extract(data_json, '$.{field}') IS NOT NULL"
        )
        after = conn.execute(
            f"SELECT COUNT(*) FROM mistakes "
            f"WHERE json_extract(data_json, '$.{field}') IS NOT NULL"
        ).fetchone()[0]
        print(f"  {field}: {before} -> {after}")

    conn.commit()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
