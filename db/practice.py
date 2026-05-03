"""Practice mode: result logging, weighted problem picking, trends.

`get_practice_problem` weights candidates by user history (unseen
+ previously-wrong x3, mastered x0.5). `get_public_practice_problem`
serves the opted-in cross-user pool with no spaced-repetition
weighting. `get_trends` rolls per-game `stats_json` blobs into the
trend-chart shape the frontend consumes.
"""

import json
import random

from db.mistakes import row_to_mistake


def record_practice_result(conn, user_id, mistake_id, correct):
    """Record a practice attempt. Validates mistake belongs to user."""
    owner = conn.execute(
        "SELECT g.user_id FROM mistakes m JOIN games g ON m.game_id = g.id WHERE m.id = ?",
        (mistake_id,),
    ).fetchone()
    if not owner or owner["user_id"] != user_id:
        return False
    conn.execute(
        "INSERT INTO practice_results (user_id, mistake_id, correct) VALUES (?, ?, ?)",
        (user_id, mistake_id, 1 if correct else 0),
    )
    conn.commit()
    return True


def get_practice_stats(conn, user_id):
    """Get practice accuracy stats by category group."""
    from lib.categories import CATEGORY_INFO
    rows = conn.execute(
        """SELECT m.category, pr.correct, COUNT(*) as cnt
           FROM practice_results pr
           JOIN mistakes m ON pr.mistake_id = m.id
           WHERE pr.user_id = ?
           GROUP BY m.category, pr.correct""",
        (user_id,),
    ).fetchall()
    groups = {}
    for row in rows:
        cat = row["category"] or "Unknown"
        grp = CATEGORY_INFO.get(cat, {}).get("group", "Other")
        if grp not in groups:
            groups[grp] = {"correct": 0, "total": 0}
        groups[grp]["total"] += row["cnt"]
        if row["correct"]:
            groups[grp]["correct"] += row["cnt"]
    return groups


def get_practice_problem(conn, user_id, severity=None, group=None, defense_only=False,
                         calc_agree=False):
    """Get a weighted-random eligible practice problem.

    Weighting: unseen problems x3, previously wrong x3, right once x1, right 2+ times x0.5.
    """
    from lib.categories import CATEGORY_INFO

    where = ["g.user_id = ?", "m.severity IN ('??', '???' )"]
    params = [user_id]

    if severity:
        where.append("m.severity = ?")
        params.append(severity)

    if calc_agree:
        where.append("m.category IN ('1A','1B','1C','1D','1E','P1','P2','P3')")

    rows = conn.execute(
        f"""SELECT m.*, g.date as game_date, g.id as gid
            FROM mistakes m JOIN games g ON m.game_id = g.id
            WHERE {' AND '.join(where)}""",
        params,
    ).fetchall()

    # Get practice history for this user
    history = {}
    hist_rows = conn.execute(
        "SELECT mistake_id, correct FROM practice_results WHERE user_id = ? ORDER BY created_at",
        (user_id,),
    ).fetchall()
    for hr in hist_rows:
        mid = hr["mistake_id"]
        if mid not in history:
            history[mid] = {"attempts": 0, "correct": 0, "last_correct": None}
        history[mid]["attempts"] += 1
        if hr["correct"]:
            history[mid]["correct"] += 1
        history[mid]["last_correct"] = bool(hr["correct"])

    # Filter and weight candidates
    candidates = []
    weights = []
    for row in rows:
        data = json.loads(row["data_json"])
        actual = data.get("actual") or {}
        expected = data.get("expected") or {}
        if actual.get("type") != "dahai" or expected.get("type") != "dahai":
            continue
        if not data.get("hand"):
            continue
        if defense_only and not data.get("safety_ratings"):
            continue
        if group:
            cat = row["category"] or ""
            cat_group = CATEGORY_INFO.get(cat, {}).get("group", "")
            if cat_group != group:
                continue

        mid = row["id"]
        h = history.get(mid)
        if h is None:
            w = 3.0  # never seen
        elif h["last_correct"] is False:
            w = 3.0  # got wrong last time
        elif h["correct"] >= 2:
            w = 0.5  # mastered
        else:
            w = 1.0  # seen, got right once

        candidates.append({
            "game_id": row["gid"],
            "game_date": row["game_date"],
            "round": row["round_name"],
            "mistake": row_to_mistake(row),
            "mistake_id": mid,
        })
        weights.append(w)

    if not candidates:
        return None

    pick = random.choices(candidates, weights=weights, k=1)[0]
    pick["pool_size"] = len(candidates)
    return pick


def get_public_practice_problem(conn, severity=None, group=None, defense_only=False,
                                calc_agree=False):
    """Get a random practice problem from opted-in users' games, anonymized.

    No spaced repetition — uniform random selection.
    Only includes games from users with practice_opt_in=1.
    Strips user-identifying info (notes, game dates).
    """
    from lib.categories import CATEGORY_INFO

    where = ["m.severity IN ('??', '???' )", "u.practice_opt_in = 1"]
    params = []

    if severity:
        where.append("m.severity = ?")
        params.append(severity)

    if calc_agree:
        where.append("m.category IN ('1A','1B','1C','1D','1E','P1','P2','P3')")

    rows = conn.execute(
        f"""SELECT m.*, g.id as gid
            FROM mistakes m
            JOIN games g ON m.game_id = g.id
            JOIN users u ON g.user_id = u.id
            WHERE {' AND '.join(where)}""",
        params,
    ).fetchall()

    candidates = []
    for row in rows:
        data = json.loads(row["data_json"])
        actual = data.get("actual") or {}
        expected = data.get("expected") or {}
        if actual.get("type") != "dahai" or expected.get("type") != "dahai":
            continue
        if not data.get("hand"):
            continue
        if defense_only and not data.get("safety_ratings"):
            continue
        if group:
            cat = row["category"] or ""
            cat_group = CATEGORY_INFO.get(cat, {}).get("group", "")
            if cat_group != group:
                continue

        mistake = row_to_mistake(row)
        mistake["note"] = None  # strip user annotation
        mistake.pop("actual", None)  # don't reveal original play

        # For community problems, show 1st-vs-2nd EV gap (decision difficulty)
        # instead of 1st-vs-actual (how bad the player was)
        top_actions = data.get("top_actions") or []
        if len(top_actions) >= 2:
            gap = round(top_actions[0].get("q_value", 0) - top_actions[1].get("q_value", 0), 2)
            mistake["ev_loss"] = gap

        candidates.append({
            "game_id": row["gid"],
            "round": row["round_name"],
            "mistake": mistake,
            "mistake_id": row["id"],
            "is_community": True,
        })

    if not candidates:
        return None

    pick = random.choice(candidates)
    pick["pool_size"] = len(candidates)
    return pick


def get_trends(conn, user_id):
    """Get per-game trend data.

    Emits raw per-category stats (`by_category`) and per-skill-area decision
    counts (`decision_counts`). Display-layer shaping (bar order, colors,
    advice strings) lives in the frontend.
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
            "by_category": s.get("by_category", {}),
            "decision_counts": s.get("decision_counts"),
        })
    return games
