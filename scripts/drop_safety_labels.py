#!/usr/bin/env python3
"""Strip ``safety_labels`` and ``safety_label_text`` from every mistake's
data_json. Both fields are now derived on the client from ``per_threat`` +
board_state; the stored copies are dead weight.

Usage:
    .venv/bin/python scripts/drop_safety_labels.py           # local
    docker compose exec app python scripts/drop_safety_labels.py
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

    for field in ("safety_labels", "safety_label_text"):
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
