"""Admin-only helpers (privilege check + user dashboard stats)."""


def is_admin(conn, user_id):
    """Check if a user has admin privileges."""
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    return bool(row and row["is_admin"])


def admin_user_stats(conn):
    """Get per-user game counts for the admin dashboard."""
    rows = conn.execute(
        """SELECT u.id, u.username, u.created_at,
                  COUNT(g.id) as game_count
           FROM users u LEFT JOIN games g ON u.id = g.user_id
           GROUP BY u.id ORDER BY u.created_at""",
    ).fetchall()
    return [dict(r) for r in rows]
