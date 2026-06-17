"""Admin-only helpers (privilege check + user dashboard stats)."""


def is_admin(conn, user_id):
    """Check if a user has admin privileges."""
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    return bool(row and row["is_admin"])


def admin_user_stats(conn):
    """Get per-user game counts + latest submission for the admin dashboard.

    ``latest_game`` is the most recent game's ``created_at`` (submission time),
    or NULL for users who have never submitted a game. Default order is by game
    count desc; the admin UI can re-sort by any column client-side.
    """
    rows = conn.execute(
        """SELECT u.id, u.username, u.created_at,
                  COUNT(g.id) as game_count,
                  MAX(g.created_at) as latest_game
           FROM users u LEFT JOIN games g ON u.id = g.user_id
           GROUP BY u.id ORDER BY game_count DESC, u.created_at""",
    ).fetchall()
    return [dict(r) for r in rows]
