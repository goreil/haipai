"""Weakness-analysis snapshots: per-user history of trends-page analyses.

Each row stores the aggregated totals (by_category + decision_counts) for
the games included in one analysis run, tagged with the categorizer
version that produced them. The trends page lists past snapshots so the
user can see how their weakness profile has shifted as they play more or
as the categorizer logic evolves.
"""

import json


def insert_snapshot(conn, user_id, categorizer_version, game_ids,
                    by_category, decision_counts):
    """Insert a snapshot row, deduping against the most recent one.

    Skip the insert if the latest snapshot for this user has the same
    categorizer_version AND the same set of game_ids — re-opening the
    trends page without new games shouldn't pile up identical rows.

    Returns the new snapshot id, or None if deduped.
    """
    ids_sorted = sorted(int(i) for i in game_ids)

    latest = conn.execute(
        "SELECT summary_json, categorizer_version "
        "FROM weakness_snapshots WHERE user_id = ? "
        "ORDER BY created_at DESC, id DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if latest and latest["categorizer_version"] == categorizer_version:
        try:
            prev = json.loads(latest["summary_json"])
            prev_ids = sorted(int(i) for i in (prev.get("game_ids") or []))
            if prev_ids == ids_sorted:
                return None
        except (ValueError, TypeError):
            pass

    summary = {
        "game_ids": ids_sorted,
        "by_category": by_category or {},
        "decision_counts": decision_counts or {},
    }
    cur = conn.execute(
        "INSERT INTO weakness_snapshots "
        "(user_id, categorizer_version, game_count, summary_json) "
        "VALUES (?, ?, ?, ?)",
        (user_id, categorizer_version, len(ids_sorted),
         json.dumps(summary, ensure_ascii=False)),
    )
    conn.commit()
    return cur.lastrowid


def list_snapshots(conn, user_id):
    """List snapshots for a user, newest first. Each row carries the parsed
    summary_json so the frontend can re-render past panels without a second
    round-trip."""
    rows = conn.execute(
        "SELECT id, created_at, categorizer_version, game_count, summary_json "
        "FROM weakness_snapshots WHERE user_id = ? "
        "ORDER BY created_at DESC, id DESC",
        (user_id,),
    ).fetchall()
    out = []
    for r in rows:
        try:
            summary = json.loads(r["summary_json"])
        except (ValueError, TypeError):
            summary = {}
        out.append({
            "id": r["id"],
            "created_at": r["created_at"],
            "categorizer_version": r["categorizer_version"],
            "game_count": r["game_count"],
            "by_category": summary.get("by_category") or {},
            "decision_counts": summary.get("decision_counts") or {},
            "game_ids": summary.get("game_ids") or [],
        })
    return out
