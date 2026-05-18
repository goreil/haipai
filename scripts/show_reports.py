#!/usr/bin/env python3
"""Dump per-mistake wrong-category / wrong-text reports.

Runs against the SQLite DB — locally that's ./games.db, inside the app
container it's /app/data/games.db. Set DB_PATH to override.

Usage:
    python3 scripts/show_reports.py                 # all reports, prod via docker:
    docker exec haipai-app-1 python3 /app/scripts/show_reports.py
    python3 scripts/show_reports.py --kind wrong_category
    python3 scripts/show_reports.py --since 2026-04-01 --json
    python3 scripts/show_reports.py --mistake 4875
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime


def pick_db():
    if os.environ.get("DB_PATH"):
        return os.environ["DB_PATH"]
    for p in ("/app/data/games.db", "games.db"):
        if os.path.exists(p):
            return p
    sys.exit("No DB found. Set DB_PATH or run from the repo root.")


def fetch(db_path, kind=None, since=None, mistake_id=None, user_id=None):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    where = []
    params = []
    if kind:
        where.append("cr.kind = ?")
        params.append(kind)
    if since:
        where.append("cr.created_at >= ?")
        params.append(since)
    if mistake_id is not None:
        where.append("cr.mistake_id = ?")
        params.append(mistake_id)
    if user_id is not None:
        where.append("cr.user_id = ?")
        params.append(user_id)

    sql = """
        SELECT cr.id, cr.user_id, u.username, cr.mistake_id, cr.kind,
               cr.suggested_category, cr.reason, cr.created_at,
               m.game_id, m.category AS current_category,
               m.turn, m.ev_loss, m.note
        FROM category_reports cr
        JOIN users u ON cr.user_id = u.id
        JOIN mistakes m ON cr.mistake_id = m.id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY cr.created_at DESC"

    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def summarize(rows):
    by_kind = {}
    by_category = {}
    for r in rows:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1
        cat = r["current_category"] or "?"
        by_category.setdefault(cat, {"wrong_category": 0, "wrong_text": 0})
        by_category[cat][r["kind"]] = by_category[cat].get(r["kind"], 0) + 1
    return by_kind, by_category


def pretty_print(rows):
    if not rows:
        print("(no reports)")
        return

    by_kind, by_category = summarize(rows)
    print(f"Total: {len(rows)}  |  " + "  ".join(f"{k}={v}" for k, v in by_kind.items()))
    print()
    print("By current category (wrong_cat / wrong_text):")
    for cat in sorted(by_category):
        c = by_category[cat]
        print(f"  {cat:<4}  {c['wrong_category']:>3}  {c['wrong_text']:>3}")
    print()
    print("Reports (newest first):")
    for r in rows:
        ts = r["created_at"]
        head = (f"  #{r['id']:<4} {ts}  u={r['username']}  mistake={r['mistake_id']} "
                f"game={r['game_id']} turn={r['turn']} cat={r['current_category']} "
                f"ev={r['ev_loss']}  kind={r['kind']}")
        print(head)
        if r["suggested_category"]:
            print(f"         suggested: {r['suggested_category']}")
        if r["reason"]:
            print(f"         reason: {r['reason']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--kind", choices=("wrong_category", "wrong_text"),
                    help="Filter by report kind.")
    ap.add_argument("--since", help="ISO date/timestamp, e.g. 2026-04-01.")
    ap.add_argument("--mistake", type=int, help="Filter to a specific mistake id.")
    ap.add_argument("--user", type=int, help="Filter to a specific user id.")
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of a table.")
    args = ap.parse_args()

    if args.since:
        # Accept bare YYYY-MM-DD; SQLite compares lexicographically anyway.
        try:
            datetime.fromisoformat(args.since)
        except ValueError:
            sys.exit(f"--since must be ISO format, got {args.since!r}")

    db_path = pick_db()
    rows = fetch(db_path, kind=args.kind, since=args.since,
                 mistake_id=args.mistake, user_id=args.user)

    if args.json:
        print(json.dumps(rows, indent=2, default=str))
    else:
        print(f"# DB: {db_path}")
        pretty_print(rows)


if __name__ == "__main__":
    main()
