#!/usr/bin/env python3
"""Sample N games from games.db and dump per-mistake fixtures
for the JS-categorizer parity check.

For every categorized mistake in the sample, the fixture stores:
- ``inputs``: the mistake dict as returned by db.get_game (i.e. what the
  frontend sees over the API). Includes hand/melds/actual/expected,
  discard_stats, dealin_rates, board_state, labels, etc.
- ``expected``: {category, categorize_data, labels} — the Python
  categorizer's stored output.

Run inside the Docker container so the DB and mortal_files line up.
"""

import argparse
import json
import os
import random
import sqlite3
import sys
from pathlib import Path

# Add /app to sys.path so `import db` works when invoked from /app.
sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).parent.parent))

import db as dbmod  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/app/data/games.db",
                    help="SQLite DB path (default: prod path inside Docker)")
    ap.add_argument("--n", type=int, default=50, help="Number of games")
    ap.add_argument("--out", default="tests/fixtures/categorize_parity.json",
                    help="Output fixture path")
    ap.add_argument("--seed", type=int, default=20260505)
    args = ap.parse_args()

    random.seed(args.seed)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    game_ids = [r["id"] for r in conn.execute(
        "SELECT id FROM games WHERE mortal_file IS NOT NULL "
        "AND categorization_status = 'done'"
    ).fetchall()]
    if len(game_ids) < args.n:
        print(f"warn: only {len(game_ids)} games available", file=sys.stderr)
        sample_ids = game_ids
    else:
        sample_ids = random.sample(game_ids, args.n)

    fixtures = []
    skipped = 0
    for gid in sample_ids:
        game = dbmod.get_game(conn, gid)
        if not game:
            continue
        for rnd in game["rounds"]:
            for m in rnd["mistakes"]:
                if not m.get("category"):
                    skipped += 1
                    continue
                expected = {
                    "category": m["category"],
                    "categorize_data": m.get("categorize_data") or {},
                    "labels": m.get("labels") or [],
                }
                inputs = {k: v for k, v in m.items()
                          if k not in ("category", "categorize_data",
                                       "labels", "id", "my_report",
                                       "severity", "ev_loss", "note")}
                fixtures.append({
                    "mistake_id": m["id"],
                    "game_id": gid,
                    "inputs": inputs,
                    "expected": expected,
                })

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "seed": args.seed,
        "n_games": len(sample_ids),
        "n_mistakes": len(fixtures),
        "fixtures": fixtures,
    }, ensure_ascii=False))

    print(f"wrote {len(fixtures)} fixtures from {len(sample_ids)} games "
          f"({skipped} uncategorized mistakes skipped) -> {out}")
    by_cat = {}
    for f in fixtures:
        c = f["expected"]["category"]
        by_cat[c] = by_cat.get(c, 0) + 1
    for c in sorted(by_cat):
        print(f"  {c}: {by_cat[c]}")


if __name__ == "__main__":
    main()
