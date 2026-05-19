"""Mistake-row helpers: serialization + per-row updates.

`MISTAKE_COLUMNS` is the source of truth for which mistake keys are
promoted to dedicated SQL columns; everything else lives inside
`data_json`. Both `mistake_to_row` (insert path, used by `add_game`)
and `update_mistake_data` (in-place patch) read this set.
"""

import json


# Fields stored as columns (not in data_json)
MISTAKE_COLUMNS = {"ev_loss", "turn", "note"}


def mistake_to_row(mistake, game_id, round_name, round_idx, mistake_idx):
    """Convert a mistake dict to DB row values."""
    # Separate column fields from the data blob
    data = {k: v for k, v in mistake.items() if k not in MISTAKE_COLUMNS}
    return {
        "game_id": game_id,
        "round_name": round_name,
        "round_idx": round_idx,
        "mistake_idx": mistake_idx,
        "data_json": json.dumps(data, ensure_ascii=False),
        "ev_loss": mistake.get("ev_loss"),
        "turn": mistake.get("turn"),
        "note": mistake.get("note"),
    }


def row_to_mistake(row):
    """Convert a DB row back to a mistake dict."""
    m = json.loads(row["data_json"])
    m["id"] = row["id"]
    m["ev_loss"] = row["ev_loss"]
    m["turn"] = row["turn"]
    m["note"] = row["note"]
    return m


def annotate_mistake(conn, game_id, round_name, turn, index, note, user_id=None):
    """Update the note on a specific mistake. Returns True if a row matched.

    Category is no longer persisted server-side — the JS categorizer is the
    source of truth and recomputes on every fetch. The annotate endpoint
    only stores the user's free-form note.
    """
    # Verify game ownership
    if user_id is not None:
        owner = conn.execute("SELECT user_id FROM games WHERE id = ?", (game_id,)).fetchone()
        if not owner or owner["user_id"] != user_id:
            return None

    # Find the mistake
    rows = conn.execute(
        "SELECT id FROM mistakes WHERE game_id = ? AND round_name = ? AND turn = ? ORDER BY mistake_idx",
        (game_id, round_name, turn),
    ).fetchall()

    if index >= len(rows):
        return None

    mistake_id = rows[index]["id"]
    conn.execute(
        "UPDATE mistakes SET note = ? WHERE id = ?",
        (note if note else None, mistake_id),
    )
    conn.commit()
    return True


def update_mistake_data(conn, mistake_id, updates):
    """Update columns and/or data_json fields on a mistake.

    `updates` can contain column names (ev_loss, turn, note) and data
    fields (best_discard, discard_stats, safety_ratings, etc.).
    Uses SQLite json_set() for atomic data_json updates to avoid
    read-modify-write races.
    """
    col_updates = {}
    data_updates = {}
    for k, v in updates.items():
        if k in MISTAKE_COLUMNS:
            col_updates[k] = v
        else:
            data_updates[k] = v

    if data_updates:
        # Atomic merge using json_set — no read-modify-write needed
        json_expr = "data_json"
        params = []
        for key, val in data_updates.items():
            json_expr = f"json_set({json_expr}, '$.{key}', json(?))"
            params.append(json.dumps(val, ensure_ascii=False))
        col_updates["data_json"] = None  # placeholder, handled by raw SQL below

    set_parts = []
    params_final = []
    for k, v in col_updates.items():
        if k == "data_json" and data_updates:
            set_parts.append(f"data_json = {json_expr}")
            params_final.extend(params)
        else:
            set_parts.append(f"{k} = ?")
            params_final.append(v)

    if set_parts:
        sql = f"UPDATE mistakes SET {', '.join(set_parts)} WHERE id = ?"
        params_final.append(mistake_id)
        conn.execute(sql, params_final)
        conn.commit()
