#!/usr/bin/env bash
# Re-categorize every game in the DB using the current categorize.py logic.
#
# Run this after a backend category change (e.g. the 2026-04-20 defense
# overhaul that redefined D1/D2/D3 semantics) so existing rows pick up
# the new labels. Idempotent — each game is re-categorized with force=True.
#
# Usage, from the repo root on the server:
#     bash scripts/recategorize_all.sh
#
# Progress is printed per game. A failure on one game does not abort
# the loop; the script reports the failed game ids at the end.

set -u

COMPOSE="docker compose"

$COMPOSE exec -T app python3 <<'PY'
import sqlite3, sys, traceback
sys.path.insert(0, "/app")

import db
from lib.categorize import categorize_game_db

conn = db.get_db()
rows = conn.execute(
    "SELECT id FROM games WHERE mortal_file IS NOT NULL ORDER BY id"
).fetchall()

total = len(rows)
ok = 0
failed = []

print(f"Re-categorizing {total} games...")
for i, r in enumerate(rows, 1):
    gid = r["id"]
    try:
        n, calls, fails = categorize_game_db(conn, gid, force=True)
        conn.commit()
        suffix = f", {fails} failed" if fails else ""
        print(f"  [{i}/{total}] game {gid}: {n} mistakes ({calls} shanten calls{suffix})")
        ok += 1
    except Exception as e:
        conn.rollback()
        print(f"  [{i}/{total}] game {gid}: FAILED — {e}", file=sys.stderr)
        failed.append(gid)

# Recompute summary stats so the UI reflects the new categories.
print("\nRecomputing per-game summary stats...")
for r in rows:
    try:
        db.compute_summary_for_game(conn, r["id"])
    except Exception as e:
        print(f"  summary for game {r['id']} failed: {e}", file=sys.stderr)
conn.commit()

print(f"\nDone. {ok}/{total} games re-categorized; {len(failed)} failed.")
if failed:
    print("Failed game ids:", failed)
    sys.exit(1)
PY
