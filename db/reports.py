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
    """Upsert the open report for a user and mistake, preserving fixed history.

    kind: 'wrong_text' — the trainer explanation reads wrong for this mistake
    (optional free-text `reason`; `suggested_category` is None for new rows).
    kind: 'complex_gap' — the player's read on a complex card; `reason` is the
    free text and `suggested_category` carries the comma-joined quick-tags.
    """
    if kind not in REPORT_KINDS:
        raise ValueError(f"invalid report kind: {kind!r}")
    row = conn.execute(
        """INSERT INTO category_reports
               (user_id, mistake_id, agree, suggested_category, reason, kind)
           VALUES (?, ?, 0, ?, ?, ?)
           ON CONFLICT(user_id, mistake_id) WHERE fixed_at IS NULL DO UPDATE SET
               agree = 0,
               suggested_category = excluded.suggested_category,
               reason = excluded.reason,
               kind = excluded.kind,
               created_at = CURRENT_TIMESTAMP
           RETURNING id""",
        (user_id, mistake_id, suggested_category, reason, kind),
    ).fetchone()
    conn.commit()
    return row["id"]


def delete_category_report(conn, report_id):
    """Compatibility for old callers: resolve the report instead of deleting it."""
    try:
        with conn:
            return fix_category_report(conn, report_id)["fixed"]
    except LookupError:
        return False


def fix_category_report(conn, report_id, *, fixed_by=None, reason=None):
    """Preserve a completed report. Caller owns the transaction; repeat-safe."""
    if reason is not None and (not isinstance(reason, str) or len(reason) > 500):
        raise ValueError("Fix description must be text of at most 500 characters")
    cur = conn.execute(
        """UPDATE category_reports SET fixed_at = CURRENT_TIMESTAMP, fixed_by = ?, fix_note = ?
           WHERE id = ? AND fixed_at IS NULL""",
        (fixed_by, reason.strip() if reason else None, report_id),
    )
    row = conn.execute(
        "SELECT fixed_at, fixed_by, fix_note FROM category_reports WHERE id = ?", (report_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"Report R-{report_id} not found")
    return {"fixed": cur.rowcount > 0, **dict(row)}


def delete_category_report_for_user(conn, user_id, mistake_id):
    """Delete a user's own report on a given mistake (idempotent — returns
    True if a row was removed, False if there was nothing to remove)."""
    cur = conn.execute(
        "DELETE FROM category_reports WHERE user_id = ? AND mistake_id = ? AND fixed_at IS NULL",
        (user_id, mistake_id),
    )
    conn.commit()
    return cur.rowcount > 0


def list_category_reports(conn, exclude_user_id=None, status="open"):
    """List all category reports with mistake and user context.

    Each row also carries a fully-rehydrated ``mistake`` dict (the same shape
    the games view consumes) so the admin UI can embed the exact same
    mistake-card render the reporting user saw.

    ``exclude_user_id``: if set, omit reports filed by that user — used by the
    admin UI's default "other players" view so the admin's own reports don't
    bloat the initial load.
    """
    if status not in ("open", "fixed", "all"):
        raise ValueError("Report status must be open, fixed, or all")
    clauses = []
    params = []
    if status != "all":
        clauses.append("cr.fixed_at IS " + ("NULL" if status == "open" else "NOT NULL"))
    if exclude_user_id is not None:
        clauses.append("cr.user_id != ?")
        params.append(exclude_user_id)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    rows = conn.execute(
        f"""SELECT cr.id AS id,
                  cr.user_id AS user_id,
                  coins.amount AS awarded_coins,
                  cr.mistake_id AS mistake_id,
                  cr.kind AS kind,
                  cr.suggested_category AS suggested_category,
                  cr.reason AS reason,
                  cr.created_at AS created_at,
                  cr.fixed_at, cr.fixed_by, cr.fix_note,
                  fixer.username AS fixed_by_username,
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
           LEFT JOIN users fixer ON cr.fixed_by = fixer.id
           JOIN mistakes m ON cr.mistake_id = m.id
           JOIN games g ON m.game_id = g.id
           LEFT JOIN community_coins coins ON coins.user_id = cr.user_id
             AND coins.kind = 'report_fix' AND coins.source_key = m.coin_key
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
