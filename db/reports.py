"""Category-report CRUD (per-mistake user feedback on AI categorization)."""


REPORT_KINDS = ("agree", "wrong_category", "wrong_text")


def submit_category_report(conn, user_id, mistake_id, kind, suggested_category=None, reason=None):
    """Upsert a category report for a mistake. One report per user per mistake;
    submitting again replaces the previous one.

    kind: 'agree' (thumbs up), 'wrong_category' (AI picked wrong category,
    provides suggested_category), or 'wrong_text' (category is right but the
    explanation is wrong, provides optional reason).
    """
    if kind not in REPORT_KINDS:
        raise ValueError(f"invalid report kind: {kind!r}")
    agree = 1 if kind == "agree" else 0
    cur = conn.execute(
        """INSERT INTO category_reports
               (user_id, mistake_id, agree, suggested_category, reason, kind)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, mistake_id) DO UPDATE SET
               agree = excluded.agree,
               suggested_category = excluded.suggested_category,
               reason = excluded.reason,
               kind = excluded.kind,
               created_at = CURRENT_TIMESTAMP""",
        (user_id, mistake_id, agree, suggested_category, reason, kind),
    )
    conn.commit()
    return cur.lastrowid


def list_category_reports(conn):
    """List all category reports with mistake and user context."""
    rows = conn.execute(
        """SELECT cr.*, u.username, m.category, m.round_name, m.turn, m.game_id
           FROM category_reports cr
           JOIN users u ON cr.user_id = u.id
           JOIN mistakes m ON cr.mistake_id = m.id
           ORDER BY cr.created_at DESC""",
    ).fetchall()
    return [dict(r) for r in rows]


def get_report_for_mistake(conn, user_id, mistake_id):
    """Check if a user already reported on a specific mistake."""
    row = conn.execute(
        "SELECT * FROM category_reports WHERE user_id = ? AND mistake_id = ?",
        (user_id, mistake_id),
    ).fetchone()
    return dict(row) if row else None
