#!/usr/bin/env python3
"""Sample N games and dump a prep-layer parity fixture for the JS port.

For every non-equal review entry in the sampled games we replay the
production prep pipeline (``lib.categorize.prepare_mistake_data``) and
record everything the JS side needs to recompute the same patch:

- ``mortal_data`` — full Mortal JSON for the game (per-game, not per-mistake)
- ``mistake`` — raw inputs (``hand``, ``melds``, ``actual``, ``expected``,
  ``turn``); deliberately *no* pre-prepped fields like ``discard_stats``.
- ``kyoku_idx`` + ``entry`` — what the prep code keys off
- ``expected_prep`` — the Python patch

``scripts/verify_prep_js.mjs`` consumes this fixture and runs JS
``prepMistake`` against every record.

Run inside the Docker app container so ``mortal_files`` paths line up
with the prod DB:

    docker compose exec app python scripts/sample_prep_fixture.py \
        --n 50 --out tests/fixtures/prep_parity.json

The fixture targets ~5 MB for 50 games. Mortal JSONs are inlined per
game so the verifier does not need disk access.
"""

import argparse
import json
import random
import sqlite3
import sys
from pathlib import Path

# /app is the Docker path; the repo root is the dev path.
sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).parent.parent))

import db as dbmod  # noqa: E402
from lib.categorize import prepare_mistake_data  # noqa: E402
from lib.parse import flatten_mjai_log, round_header  # noqa: E402


def _slim_mistake_inputs(m):
    """Strip pre-prepped fields so JS recomputes from scratch."""
    keep = {"hand", "melds", "actual", "expected", "turn", "round_name"}
    return {k: m[k] for k in keep if k in m}


def sample_game(conn, game_id, repo_root):
    """Replay prep for every non-equal entry in a game. Returns the
    per-game fixture record or ``None`` if the mortal file is missing.
    """
    game_row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if not game_row or not game_row["mortal_file"]:
        return None
    mortal_path = repo_root / game_row["mortal_file"]
    if not mortal_path.exists():
        return None
    with open(mortal_path) as f:
        mortal_data = json.load(f)

    kyokus = mortal_data["review"]["kyokus"]
    events = flatten_mjai_log(mortal_data["mjai_log"])
    start_events = [e for e in events if e.get("type") == "start_kyoku"]
    start_positions = [i for i, e in enumerate(events)
                       if e.get("type") == "start_kyoku"]
    player_id = mortal_data["player_id"]

    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? "
        "ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()
    rounds = {}
    for mr in mistake_rows:
        rounds.setdefault(mr["round_name"], []).append(mr)

    out_mistakes = []
    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_header = round_header(start)
        db_mistakes = rounds.get(rnd_header, [])
        if not db_mistakes:
            continue

        start_pos = start_positions[kyoku_idx]
        end_pos = (start_positions[kyoku_idx + 1]
                   if kyoku_idx + 1 < len(start_positions) else len(events))
        defense_ctx = {
            "mjai_events": events,
            "start_pos": start_pos,
            "end_pos": end_pos,
            "player_id": player_id,
        }

        mistake_idx = 0
        for entry in kyoku["entries"]:
            if entry["is_equal"]:
                continue
            while (mistake_idx < len(db_mistakes)
                   and db_mistakes[mistake_idx]["turn"] != entry["junme"]):
                mistake_idx += 1
            if mistake_idx >= len(db_mistakes):
                break
            mr = db_mistakes[mistake_idx]
            mistake_idx += 1

            m = dbmod.row_to_mistake(mr)
            try:
                expected_prep = prepare_mistake_data(
                    m, mortal_data, kyoku_idx, entry, defense_ctx,
                )
            except Exception as e:
                expected_prep = {"__error__": repr(e)}

            out_mistakes.append({
                "mistake_id": mr["id"],
                "kyoku_idx": kyoku_idx,
                "entry": entry,
                "mistake": _slim_mistake_inputs(m),
                "expected_prep": expected_prep,
            })

    if not out_mistakes:
        return None
    return {
        "game_id": game_id,
        "mortal_data": mortal_data,
        "mistakes": out_mistakes,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/app/data/games.db",
                    help="SQLite DB path (default: prod path inside Docker)")
    ap.add_argument("--n", type=int, default=50, help="Number of games")
    ap.add_argument("--out", default="tests/fixtures/prep_parity.json",
                    help="Output fixture path")
    ap.add_argument("--seed", type=int, default=20260515)
    ap.add_argument("--repo-root", default="/app",
                    help="Root for resolving mortal_file paths")
    args = ap.parse_args()

    random.seed(args.seed)
    repo_root = Path(args.repo_root)

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

    games_out = []
    total_mistakes = 0
    skipped_games = 0
    for gid in sample_ids:
        rec = sample_game(conn, gid, repo_root)
        if rec is None:
            skipped_games += 1
            continue
        games_out.append(rec)
        total_mistakes += len(rec["mistakes"])

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "seed": args.seed,
        "n_games": len(games_out),
        "n_mistakes": total_mistakes,
        "games": games_out,
    }, ensure_ascii=False))
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"wrote {total_mistakes} mistakes across {len(games_out)} games "
          f"({skipped_games} skipped) -> {out} [{size_mb:.1f} MB]")

    # Surface coverage of the branches JS prep needs to handle.
    branches = {"dahai_dahai": 0, "reach_dahai_5A": 0, "dahai_reach_5B": 0,
                "other_non_dahai": 0, "errored": 0, "empty": 0}
    has_safety = 0
    has_kd = 0
    for g in games_out:
        for m in g["mistakes"]:
            ep = m["expected_prep"]
            if isinstance(ep, dict) and "__error__" in ep:
                branches["errored"] += 1
                continue
            at = (m["mistake"].get("actual") or {}).get("type")
            et = (m["mistake"].get("expected") or {}).get("type")
            if at == "dahai" and et == "dahai":
                branches["dahai_dahai"] += 1
            elif at == "reach" and et == "dahai":
                branches["reach_dahai_5A"] += 1
            elif at == "dahai" and et == "reach":
                branches["dahai_reach_5B"] += 1
            else:
                branches["other_non_dahai"] += 1
            if not ep:
                branches["empty"] += 1
            if "safety_ratings" in ep:
                has_safety += 1
            if "dealin_rates" in ep:
                has_kd += 1
    for k, v in branches.items():
        print(f"  {k}: {v}")
    print(f"  with safety_ratings: {has_safety}")
    print(f"  with dealin_rates:   {has_kd}")


if __name__ == "__main__":
    main()
