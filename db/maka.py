"""Maka calibration checkpoints, independent of grading formula changes."""

import json


def grade_snapshot(conn):
    """Identify filled slots by value and first-save date, including legacy grades."""
    snapshot = {}
    for row in conn.execute(
        "SELECT id, maka_ratings_json, maka_ratings_added_at_json FROM games WHERE maka_ratings_json IS NOT NULL"
    ):
        game_id, ratings_json, dates_json = row
        ratings = json.loads(ratings_json)
        dates = json.loads(dates_json or "{}")
        grades = [ratings.get("overall"), *ratings.get("matches", [])]
        added = [dates.get("overall"), *dates.get("matches", [])]
        for i, grade in enumerate(grades):
            if grade:
                snapshot[f"{game_id}:{i}"] = [grade, added[i] if i < len(added) else None]
    return snapshot


def latest_review(conn):
    # Read-only analysis also works before this additive table is deployed.
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'maka_rank_reviews'").fetchone():
        return None
    row = conn.execute(
        "SELECT id, captured_at, completed_at, conclusion, snapshot_json, analysis_json "
        "FROM maka_rank_reviews ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    keys = ("id", "captured_at", "completed_at", "conclusion", "snapshot", "analysis")
    review = dict(zip(keys, row))
    for key in ("snapshot", "analysis"):
        review[key] = json.loads(review[key])
    return review


def record_review(conn, *, captured_at, snapshot, analysis, conclusion, previous_review_id):
    """Checkpoint exactly the analyzed snapshot; concurrent submissions remain pending."""
    if not conclusion.strip():
        raise ValueError("A completed review needs a conclusion")
    if not analysis.get("usable_grades"):
        raise ValueError("Cannot complete a review without usable grades")
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        latest = latest_review(conn)
        if (latest["id"] if latest else None) != previous_review_id:
            raise ValueError("Another review completed during analysis; rerun before recording")
        cursor = conn.execute(
            "INSERT INTO maka_rank_reviews (captured_at, conclusion, snapshot_json, analysis_json) VALUES (?, ?, ?, ?)",
            (captured_at, conclusion.strip(), json.dumps(snapshot), json.dumps(analysis)),
        )
        return cursor.lastrowid
