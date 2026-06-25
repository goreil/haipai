"""Category-report CRUD (per-mistake user feedback on AI categorization)."""

from db.mistakes import row_to_mistake


# Live report kinds (mistake-dimensions CORE Phase 3 + EXTRAS-A):
#   'wrong_text'  — the trainer explanation reads wrong for this mistake.
#   'complex_gap' — EXTRAS-A funnel: on a *complex* card (our visible stats
#                   can't explain Mortal's pick) the player tells us what they
#                   think Mortal read. Quick-tags ride in `suggested_category`
#                   (comma-joined keys), free text in `reason`.
# 'wrong_category' retired with the category codes (CORE Phase 3); existing
# rows + their suggested_category stay readable as historical text.
REPORT_KINDS = ("wrong_text", "complex_gap")


def submit_category_report(conn, user_id, mistake_id, kind, suggested_category=None, reason=None):
    """Upsert a category report for a mistake. One report per user per mistake;
    submitting again replaces the previous one.

    kind: 'wrong_text' — the trainer explanation reads wrong for this mistake
    (optional free-text `reason`; `suggested_category` is None for new rows).
    kind: 'complex_gap' — the player's read on a complex card; `reason` is the
    free text and `suggested_category` carries the comma-joined quick-tags.
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


def delete_category_report_for_user(conn, user_id, mistake_id):
    """Delete a user's own report on a given mistake (idempotent — returns
    True if a row was removed, False if there was nothing to remove)."""
    cur = conn.execute(
        "DELETE FROM category_reports WHERE user_id = ? AND mistake_id = ?",
        (user_id, mistake_id),
    )
    conn.commit()
    return cur.rowcount > 0


def list_category_reports(conn, exclude_user_id=None):
    """List all category reports with mistake and user context.

    Each row also carries a fully-rehydrated ``mistake`` dict (the same shape
    the games view consumes) so the admin UI can embed the exact same
    mistake-card render the reporting user saw.

    ``exclude_user_id``: if set, omit reports filed by that user — used by the
    admin UI's default "other players" view so the admin's own reports don't
    bloat the initial load.
    """
    where = ""
    params = ()
    if exclude_user_id is not None:
        where = "WHERE cr.user_id != ?"
        params = (exclude_user_id,)
    rows = conn.execute(
        f"""SELECT cr.id AS id,
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
           {where}
           ORDER BY cr.created_at DESC""",
        params,
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
