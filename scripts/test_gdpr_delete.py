#!/usr/bin/env python3
"""Smoke test for db.delete_user_cascade against the local games.db.

Creates a throwaway user "gdpr_throwaway", seeds rows in every table that
references users(id) (directly or indirectly), runs the cascade, and asserts
every trace is gone — without touching real users' data.

Run from repo root:  .venv/bin/python scripts/test_gdpr_delete.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db


THROWAWAY = "gdpr_throwaway"


def snapshot_other_users(conn, exclude_id):
    """Return a dict counting other users' rows so we can verify they survive."""
    return {
        "users": conn.execute("SELECT COUNT(*) FROM users WHERE id != ?", (exclude_id,)).fetchone()[0],
        "games": conn.execute("SELECT COUNT(*) FROM games WHERE user_id != ?", (exclude_id,)).fetchone()[0],
        "mistakes": conn.execute(
            "SELECT COUNT(*) FROM mistakes m JOIN games g ON m.game_id = g.id WHERE g.user_id != ?",
            (exclude_id,),
        ).fetchone()[0],
        "category_reports": conn.execute(
            "SELECT COUNT(*) FROM category_reports WHERE user_id != ?", (exclude_id,)
        ).fetchone()[0],
    }


def seed(conn):
    # Clean up any leftover from a prior run.
    leftover = conn.execute("SELECT id FROM users WHERE username = ?", (THROWAWAY,)).fetchone()
    if leftover:
        db.delete_user_cascade(conn, leftover["id"])

    user_id = db.create_user(conn, THROWAWAY, "x")

    # Game with a mistake
    game_id = db.add_game(conn, user_id, {
        "date": "2026-05-03",
        "log_url": None,
        "mortal_file": None,
        "summary": {"total_mistakes": 1, "total_ev_loss": 0.5},
        "rounds": [{
            "round": "E1", "honba": 0, "turn_count": 5, "decision_count": 4, "outcome": None,
            "mistakes": [{
                "turn": 3, "ev_loss": 0.5, "note": None,
                "hand": ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
                         "1p", "2p", "3p", "4p"],
                "melds": [], "shanten": 1, "draw": "4m",
                "actual": {"type": "dahai", "pai": "1m"},
                "expected": {"type": "dahai", "pai": "3m"},
                "top_actions": [
                    {"type": "dahai", "pai": "3m", "q_value": 1.0},
                    {"type": "dahai", "pai": "1m", "q_value": 0.5},
                ],
            }],
        }],
    })
    mistake_id = conn.execute(
        "SELECT id FROM mistakes WHERE game_id = ?", (game_id,)
    ).fetchone()["id"]

    # Category report on their own mistake
    db.submit_category_report(
        conn, user_id, mistake_id,
        kind="wrong_text", suggested_category=None, reason="seed",
    )

    conn.commit()
    return user_id, game_id, mistake_id


def assert_empty(conn, user_id, game_id, mistake_id):
    failures = []

    def check(label, sql, params):
        n = conn.execute(sql, params).fetchone()[0]
        if n != 0:
            failures.append(f"{label}: expected 0 rows, found {n}")

    check("users", "SELECT COUNT(*) FROM users WHERE id = ?", (user_id,))
    check("games", "SELECT COUNT(*) FROM games WHERE id = ?", (game_id,))
    check("mistakes", "SELECT COUNT(*) FROM mistakes WHERE id = ?", (mistake_id,))
    check("category_reports", "SELECT COUNT(*) FROM category_reports WHERE user_id = ?", (user_id,))
    return failures


def main():
    conn = db.get_db()
    user_id, game_id, mistake_id = seed(conn)

    pre = snapshot_other_users(conn, user_id)
    print(f"seeded user_id={user_id} game_id={game_id} mistake_id={mistake_id}")
    print(f"other-users snapshot (expected to be unchanged): {pre}")

    counts = db.delete_user_cascade(conn, user_id)
    print(f"delete_user_cascade returned: {counts}")

    failures = assert_empty(conn, user_id, game_id, mistake_id)
    post = snapshot_other_users(conn, user_id)
    if post != pre:
        failures.append(f"other-users counts changed: pre={pre} post={post}")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("\nOK — throwaway user fully wiped, other users intact")


if __name__ == "__main__":
    main()
