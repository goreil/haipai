"""Admin-only helpers (privilege check + user dashboard stats)."""


def is_admin(conn, user_id):
    """Check if a user has admin privileges."""
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    return bool(row and row["is_admin"])


def admin_user_stats(conn):
    """Get per-user game counts + latest submission for the admin dashboard.

    ``latest_game`` is the most recent game's ``created_at`` (submission time),
    or NULL for users who have never submitted a game. ``games_last_30d`` counts
    games submitted in the trailing 30 days, used by the UI to derive a
    recent-cadence "games/day" figure (lifetime average would dilute long-tenured
    but currently-dormant accounts). Default order is by game count desc; the
    admin UI can re-sort by any column client-side.
    """
    rows = conn.execute(
        """SELECT u.id, u.username, u.created_at,
                  COUNT(g.id) as game_count,
                  MAX(g.created_at) as latest_game,
                  SUM(CASE WHEN g.created_at >= datetime('now', '-30 days')
                           THEN 1 ELSE 0 END) as games_last_30d
           FROM users u LEFT JOIN games g ON u.id = g.user_id
           GROUP BY u.id ORDER BY game_count DESC, u.created_at""",
    ).fetchall()
    return [dict(r) for r in rows]


def admin_mau_stats(conn):
    """Monthly active user stats for the admin dashboard.

    ``mau`` is the count of distinct users who submitted >=1 game in the
    trailing 30 days. ``trend`` is that same "submitted a game" activity
    bucketed by calendar month for the last 6 months (oldest first),
    zero-filled for months with no activity, for a quick trend view.
    """
    mau = conn.execute(
        """SELECT COUNT(DISTINCT user_id) FROM games
           WHERE created_at >= datetime('now', '-30 days')""",
    ).fetchone()[0]

    rows = conn.execute(
        """SELECT strftime('%Y-%m', created_at) as month,
                  COUNT(DISTINCT user_id) as active_users
           FROM games
           WHERE created_at >= datetime('now', '-5 months', 'start of month')
           GROUP BY month""",
    ).fetchall()
    counts = {r["month"]: r["active_users"] for r in rows}

    from datetime import date
    today = date.today()
    months = []
    for i in range(5, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            m += 12
            y -= 1
        key = f"{y:04d}-{m:02d}"
        months.append({"month": key, "active_users": counts.get(key, 0)})

    return {"mau": mau, "trend": months}
