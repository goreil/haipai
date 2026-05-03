"""User feedback CRUD (bug reports + admin triage)."""


def list_feedback(conn, status=None, fb_type=None):
    """List all feedback with optional filters. Returns list of dicts."""
    where = []
    params = []
    if status:
        where.append("f.status = ?")
        params.append(status)
    if fb_type:
        where.append("f.type = ?")
        params.append(fb_type)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(
        f"""SELECT f.*, u.username FROM feedback f
            JOIN users u ON f.user_id = u.id
            {where_sql}
            ORDER BY f.created_at DESC""",
        params,
    ).fetchall()
    return [dict(r) for r in rows]


def get_feedback_item(conn, feedback_id):
    """Get a single feedback item with username."""
    row = conn.execute(
        """SELECT f.*, u.username FROM feedback f
           JOIN users u ON f.user_id = u.id
           WHERE f.id = ?""",
        (feedback_id,),
    ).fetchone()
    return dict(row) if row else None


def update_feedback(conn, feedback_id, **kwargs):
    """Update feedback fields (status, admin_note, github_issue_url)."""
    ALLOWED = {"status", "admin_note", "github_issue_url"}
    updates = {k: v for k, v in kwargs.items() if k in ALLOWED}
    if not updates:
        return False
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    conn.execute(
        f"UPDATE feedback SET {set_clause} WHERE id = ?",
        list(updates.values()) + [feedback_id],
    )
    conn.commit()
    return True


def get_user_feedback(conn, user_id):
    """Get feedback submitted by a specific user."""
    rows = conn.execute(
        """SELECT id, type, message, status, admin_note, created_at
           FROM feedback WHERE user_id = ? ORDER BY created_at DESC""",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]
