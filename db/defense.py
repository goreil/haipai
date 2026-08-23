"""Defense Trainer minigame scores + leaderboard.

The same shape as `db.waits`: one row per completed run (game over), so the
leaderboard is "each player's best run" rather than a single mutable
best-score cell, and `runs` shows how much someone has played.

Scores arrive from a client-side game, so they are self-reported by
definition. `routes/defense.py` gates them on the points arithmetic the game
can actually produce; this module just stores what it is handed.
"""


def submit_defense_score(conn, user_id, score, best_streak, steps_cleared):
    """Record one finished run. Returns the new row id."""
    cur = conn.execute(
        """INSERT INTO defense_scores (user_id, score, best_streak, steps_cleared)
           VALUES (?, ?, ?, ?)""",
        (user_id, score, best_streak, steps_cleared),
    )
    conn.commit()
    return cur.lastrowid


def _best_run_rows(conn, limit=None):
    """Each player's best run, best first, ties broken by who got there first.

    Relies on SQLite's documented bare-column behaviour with MAX(): the
    non-aggregated columns come from the row that produced the maximum, so
    best_streak/steps_cleared/created_at describe *that* run and not some
    other one by the same player.
    """
    sql = """SELECT s.user_id AS user_id, u.username AS username,
                    MAX(s.score) AS score, s.best_streak AS best_streak,
                    s.steps_cleared AS steps_cleared, s.created_at AS created_at,
                    COUNT(*) AS runs
               FROM defense_scores s
               JOIN users u ON u.id = s.user_id
              GROUP BY s.user_id
              ORDER BY score DESC, s.created_at ASC"""
    params = ()
    if limit is not None:
        sql += " LIMIT ?"
        params = (limit,)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def get_defense_leaderboard(conn, user_id, limit=10):
    """Top `limit` players plus where `user_id` stands.

    Returns {top: [...], you: {...}|None, players: N}. Every entry carries a
    1-based `rank`; `you` is included even when the user is outside the top
    slice, so the UI can always show "your best" against the board.
    """
    top = _best_run_rows(conn, limit)
    for i, row in enumerate(top, start=1):
        row["rank"] = i
        row["is_you"] = row["user_id"] == user_id

    players = conn.execute(
        "SELECT COUNT(DISTINCT user_id) AS n FROM defense_scores"
    ).fetchone()["n"]

    you = next((r for r in top if r["is_you"]), None)
    if you is None:
        you = get_user_defense_best(conn, user_id)
    return {"top": top, "you": you, "players": players}


def get_user_defense_best(conn, user_id):
    """This user's best run with its board rank, or None if they've never played."""
    row = conn.execute(
        """SELECT user_id, MAX(score) AS score, best_streak, steps_cleared,
                  created_at, COUNT(*) AS runs
             FROM defense_scores WHERE user_id = ?""",
        (user_id,),
    ).fetchone()
    if not row or row["score"] is None:
        return None
    best = dict(row)
    # Rank = how many players have a strictly better best run, plus one.
    ahead = conn.execute(
        """SELECT COUNT(*) AS n FROM (
               SELECT user_id, MAX(score) AS s FROM defense_scores
                GROUP BY user_id HAVING s > ?
           )""",
        (best["score"],),
    ).fetchone()["n"]
    best["rank"] = ahead + 1
    best["is_you"] = True
    username = conn.execute(
        "SELECT username FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    best["username"] = username["username"] if username else "you"
    return best
