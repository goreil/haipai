"""Category-report CRUD (per-mistake user feedback on AI categorization)."""

from db.mistakes import row_to_mistake


REPORT_KINDS = ("wrong_category", "wrong_text")


def submit_category_report(conn, user_id, mistake_id, kind, suggested_category=None, reason=None):
    """Upsert a category report for a mistake. One report per user per mistake;
    submitting again replaces the previous one.

    kind: 'wrong_category' (AI picked wrong category, provides
    suggested_category) or 'wrong_text' (category is right but the
    explanation is wrong, provides optional reason).
    """
    if kind not in REPORT_KINDS:
        raise ValueError(f"invalid report kind: {kind!r}")
    cur = conn.execute(
        """INSERT INTO category_reports
               (user_id, mistake_id, agree, suggested_category, reason, kind)
           VALUES (?, ?, 0, ?, ?, ?)
           ON CONFLICT(user_id, mistake_id) DO UPDATE SET
               agree = 0,
               suggested_category = excluded.suggested_category,
               reason = excluded.reason,
               kind = excluded.kind,
               created_at = CURRENT_TIMESTAMP""",
        (user_id, mistake_id, suggested_category, reason, kind),
    )
    conn.commit()
    return cur.lastrowid


def delete_category_report(conn, report_id):
    """Hard-delete a single report row. Returns True if a row was removed."""
    cur = conn.execute("DELETE FROM category_reports WHERE id = ?", (report_id,))
    conn.commit()
    return cur.rowcount > 0


def list_category_reports(conn):
    """List all category reports with mistake and user context.

    Each row also carries a fully-rehydrated ``mistake`` dict (the same shape
    the games view consumes) so the admin UI can embed the exact same
    mistake-card render the reporting user saw.
    """
    rows = conn.execute(
        """SELECT cr.id AS id,
                  cr.user_id AS user_id,
                  cr.mistake_id AS mistake_id,
                  cr.kind AS kind,
                  cr.suggested_category AS suggested_category,
                  cr.reason AS reason,
                  cr.created_at AS created_at,
                  u.username AS username,
                  m.id AS m_id,
                  m.game_id AS game_id,
                  m.round_name AS round_name,
                  m.round_idx AS round_idx,
                  m.mistake_idx AS mistake_idx,
                  m.turn AS turn,
                  m.ev_loss AS ev_loss,
                  m.note AS note,
                  m.data_json AS data_json,
                  g.mortal_file AS mortal_file
           FROM category_reports cr
           JOIN users u ON cr.user_id = u.id
           JOIN mistakes m ON cr.mistake_id = m.id
           JOIN games g ON m.game_id = g.id
           ORDER BY cr.created_at DESC""",
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        mistake_row = {
            "id": d.pop("m_id"),
            "ev_loss": d.pop("ev_loss"),
            "turn": d["turn"],
            "note": d.pop("note"),
            "data_json": d.pop("data_json"),
        }
        d["mistake"] = row_to_mistake(mistake_row)
        out.append(d)
    return out


def get_report_for_mistake(conn, user_id, mistake_id):
    """Check if a user already reported on a specific mistake."""
    row = conn.execute(
        "SELECT * FROM category_reports WHERE user_id = ? AND mistake_id = ?",
        (user_id, mistake_id),
    ).fetchone()
    return dict(row) if row else None
