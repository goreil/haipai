"""Game-row CRUD: list/get/add/delete + stats roll-up.

`add_game` is the canonical insert path: it consumes the parser's
output dict (rounds + mistakes), wraps everything in a single
transaction, and rolls back as a unit if any mistake insert fails.
`compute_summary_for_game` recomputes the per-game `stats_json` blob
from the mistakes + per-round decision counts. `get_trends` rolls
those per-game `stats_json` blobs into the trend-chart shape the
frontend consumes.
"""

import json

from db.mistakes import mistake_to_row, row_to_mistake


def list_games(conn, user_id):
    """List all games for a user (summary info for sidebar)."""
    rows = conn.execute(
        "SELECT id, date, log_url, stats_json, categorization_status FROM games WHERE user_id = ? ORDER BY date DESC, id DESC",
        (user_id,),
    ).fetchall()
    result = []
    for row in rows:
        stats = json.loads(row["stats_json"]) if row["stats_json"] else {}
        total = conn.execute(
            "SELECT COUNT(*) FROM mistakes WHERE game_id = ?",
            (row["id"],),
        ).fetchone()[0]
        result.append({
            "id": row["id"],
            "date": row["date"],
            "log_url": row["log_url"],
            "summary": stats,
            "total": total,
            "categorization_status": row["categorization_status"],
        })
    return result


def get_game(conn, game_id, user_id=None):
    """Get full game data with rounds and mistakes (for detail view)."""
    where = "id = ?"
    params = [game_id]
    if user_id is not None:
        where += " AND user_id = ?"
        params.append(user_id)

    game_row = conn.execute(
        f"SELECT * FROM games WHERE {where}", params
    ).fetchone()
    if not game_row:
        return None

    stats = json.loads(game_row["stats_json"]) if game_row["stats_json"] else {}
    rounds_meta = json.loads(game_row["rounds_json"]) if game_row["rounds_json"] else []

    # Load mistakes grouped by round
    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()

    # Load the viewer's own category reports for these mistakes, indexed by id.
    my_reports = {}
    if user_id is not None and mistake_rows:
        mids = [mr["id"] for mr in mistake_rows]
        placeholders = ",".join("?" * len(mids))
        for r in conn.execute(
            f"SELECT mistake_id, kind, suggested_category, reason "
            f"FROM category_reports WHERE user_id = ? AND mistake_id IN ({placeholders})",
            [user_id, *mids],
        ).fetchall():
            my_reports[r["mistake_id"]] = {
                "kind": r["kind"],
                "suggested_category": r["suggested_category"],
                "reason": r["reason"],
            }

    # Build rounds structure
    rounds_map = {}
    for mr in mistake_rows:
        ri = mr["round_idx"]
        if ri not in rounds_map:
            rounds_map[ri] = {
                "round": mr["round_name"],
                "mistakes": [],
            }
        mk = row_to_mistake(mr)
        if mr["id"] in my_reports:
            mk["my_report"] = my_reports[mr["id"]]
        rounds_map[ri]["mistakes"].append(mk)

    # Merge with round metadata (outcome, turn_count)
    rounds = []
    for idx, meta in enumerate(rounds_meta):
        rnd = rounds_map.get(idx, {"round": meta["round_name"], "mistakes": []})
        rnd["round"] = meta["round_name"]
        rnd["outcome"] = meta.get("outcome")
        rnd["turn_count"] = meta.get("turn_count")
        rnd["decision_count"] = meta.get("decision_count")
        rounds.append(rnd)

    # Add any rounds that have mistakes but no metadata (shouldn't happen but be safe)
    for idx in sorted(rounds_map.keys()):
        if idx >= len(rounds):
            rounds.append(rounds_map[idx])

    return {
        "id": game_row["id"],
        "date": game_row["date"],
        "log_url": game_row["log_url"],
        "mortal_file": game_row["mortal_file"],
        "summary": stats,
        "rounds": rounds,
        "categorization_status": game_row["categorization_status"],
    }


def add_game(conn, user_id, game_dict):
    """Insert a full game dict (as produced by mj_parse.parse_game).

    All inserts are wrapped in a transaction — if any mistake insert fails,
    the entire game (including the games row) is rolled back.

    Returns the new game_id.
    """
    # Build rounds metadata
    rounds_meta = []
    for rnd in game_dict.get("rounds", []):
        rounds_meta.append({
            "round_name": rnd["round"],
            "outcome": rnd.get("outcome"),
            "turn_count": rnd.get("turn_count"),
            "decision_count": rnd.get("decision_count"),
        })

    try:
        cat_status = game_dict.get("categorization_status", "done")
        cur = conn.execute(
            """INSERT INTO games (user_id, date, log_url, mortal_file, stats_json, rounds_json, categorization_status)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                game_dict.get("date"),
                game_dict.get("log_url"),
                game_dict.get("mortal_file"),
                json.dumps(game_dict.get("summary") or {}, ensure_ascii=False),
                json.dumps(rounds_meta, ensure_ascii=False),
                cat_status,
            ),
        )
        game_id = cur.lastrowid

        # Insert mistakes
        for round_idx, rnd in enumerate(game_dict.get("rounds", [])):
            for mistake_idx, m in enumerate(rnd.get("mistakes", [])):
                row = mistake_to_row(m, game_id, rnd["round"], round_idx, mistake_idx)
                conn.execute(
                    """INSERT INTO mistakes
                       (game_id, round_name, round_idx, mistake_idx, data_json,
                        ev_loss, turn, note)
                       VALUES (:game_id, :round_name, :round_idx, :mistake_idx, :data_json,
                               :ev_loss, :turn, :note)""",
                    row,
                )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return game_id


def delete_game(conn, game_id, user_id=None):
    """Delete a game and its mistakes. Returns True if deleted."""
    where = "id = ?"
    params = [game_id]
    if user_id is not None:
        where += " AND user_id = ?"
        params.append(user_id)

    cur = conn.execute(f"DELETE FROM games WHERE {where}", params)
    conn.commit()
    return cur.rowcount > 0


def update_game_stats(conn, game_id, stats):
    """Update the stats_json for a game."""
    conn.execute(
        "UPDATE games SET stats_json = ? WHERE id = ?",
        (json.dumps(stats, ensure_ascii=False), game_id),
    )
    conn.commit()


def compute_summary_for_game(conn, game_id):
    """Recompute stats from mistakes and update the game row. Returns the stats dict.

    No server-side `by_category`: the JS categorizer is authoritative, and
    the trends page caches its rollups client-side (see
    docs/backlogs/TRENDS-WEAKEST-CATEGORY.md).
    """
    from lib.parse import severity
    rows = conn.execute(
        "SELECT ev_loss FROM mistakes WHERE game_id = ?",
        (game_id,),
    ).fetchall()

    total = len(rows)
    ev = sum(r["ev_loss"] for r in rows if r["ev_loss"])
    by_sev = {}
    for r in rows:
        s = severity(r["ev_loss"] or 0)
        by_sev[s] = by_sev.get(s, 0) + 1

    # Get total decisions from rounds_json (fall back to turn_count for old data)
    # and aggregate per-category denominators for U-04 mistakes-per-decision.
    game_row = conn.execute("SELECT rounds_json FROM games WHERE id = ?", (game_id,)).fetchone()
    total_decisions = None
    decision_counts = {"attack": 0, "defense": 0, "riichi": 0, "meld": 0, "kan": 0}
    has_decision_counts = False
    if game_row and game_row["rounds_json"]:
        rounds = json.loads(game_row["rounds_json"])
        decisions = [r.get("decision_count") or r.get("turn_count") for r in rounds]
        decisions = [d for d in decisions if d]
        if decisions:
            total_decisions = sum(decisions)
        for rnd in rounds:
            per_cat = rnd.get("decision_counts")
            if per_cat:
                has_decision_counts = True
                for k, v in per_cat.items():
                    decision_counts[k] = decision_counts.get(k, 0) + v

    stats = {
        "total_mistakes": total,
        "total_ev_loss": round(ev, 2),
        "total_decisions": total_decisions,
        "ev_per_decision": round(ev / total_decisions, 4) if total_decisions else None,
        "by_severity": by_sev,
        "decision_counts": decision_counts if has_decision_counts else None,
    }

    update_game_stats(conn, game_id, stats)
    return stats


def get_trends(conn, user_id):
    """Get per-game trend data.

    Emits per-skill-area decision counts (`decision_counts`) and severity
    rollups. Per-category aggregates are computed client-side from the
    JS-categorized mistakes — see docs/backlogs/TRENDS-WEAKEST-CATEGORY.md.
    """
    rows = conn.execute(
        "SELECT id, date, stats_json FROM games WHERE user_id = ? ORDER BY date, id",
        (user_id,),
    ).fetchall()
    games = []
    for row in rows:
        s = json.loads(row["stats_json"]) if row["stats_json"] else {}
        games.append({
            "id": row["id"],
            "date": row["date"],
            "total_mistakes": s.get("total_mistakes", 0),
            "total_ev_loss": s.get("total_ev_loss", 0),
            "total_decisions": s.get("total_decisions"),
            "ev_per_decision": s.get("ev_per_decision"),
            "by_severity": s.get("by_severity", {}),
            "decision_counts": s.get("decision_counts"),
        })
    return games
