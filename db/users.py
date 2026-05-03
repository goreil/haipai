"""Users + invite codes + OAuth linking."""

import secrets


# --- Users ---

def create_user(conn, username, password_hash, invite_code=None):
    """Create a new user. Returns user_id or raises on duplicate."""
    cur = conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, password_hash),
    )
    user_id = cur.lastrowid

    if invite_code:
        conn.execute(
            "UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?",
            (user_id, invite_code),
        )

    conn.commit()
    return user_id


def get_user_by_username(conn, username):
    """Get user row by username."""
    return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def get_user_by_id(conn, user_id):
    """Get user row by id."""
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_oauth(conn, provider, oauth_id):
    """Get user row by OAuth provider ID (discord_id or google_id)."""
    col = f"{provider}_id"
    if col not in ("discord_id", "google_id"):
        return None
    return conn.execute(f"SELECT * FROM users WHERE {col} = ?", (oauth_id,)).fetchone()


def create_oauth_user(conn, provider, oauth_id, username):
    """Create a new user from OAuth login. Returns user_id."""
    col = f"{provider}_id"
    if col not in ("discord_id", "google_id"):
        raise ValueError(f"Unknown provider: {provider}")
    # Generate a unique username if collision
    base = username
    suffix = 0
    while conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
        suffix += 1
        username = f"{base}_{suffix}"
    cur = conn.execute(
        f"INSERT INTO users (username, password_hash, {col}) VALUES (?, ?, ?)",
        (username, "", oauth_id),
    )
    conn.commit()
    return cur.lastrowid, username


def link_oauth(conn, user_id, provider, oauth_id):
    """Link an OAuth provider to an existing user account."""
    col = f"{provider}_id"
    if col not in ("discord_id", "google_id"):
        return False
    conn.execute(f"UPDATE users SET {col} = ? WHERE id = ?", (oauth_id, user_id))
    conn.commit()
    return True


def set_practice_opt_in(conn, user_id, opt_in):
    """Set whether a user's games are available in the public practice pool."""
    conn.execute("UPDATE users SET practice_opt_in = ? WHERE id = ?",
                 (1 if opt_in else 0, user_id))
    conn.commit()


def delete_user_cascade(conn, user_id):
    """GDPR-style hard delete: wipe a user and every row tied to them.

    Wraps everything in a single transaction. Tables without ON DELETE
    cascades on `users(id)` are cleared explicitly first; `games` deletion
    then cascades through `mistakes` (and onwards to `practice_results` /
    `category_reports` rows attached to those mistakes via mistake_id).

    Returns a dict of per-table row counts removed, or ``None`` if the
    user did not exist.
    """
    if not conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
        return None

    counts = {}
    try:
        # Rows that reference users(id) directly with no ON DELETE behavior.
        for table, col in (
            ("practice_results", "user_id"),
            ("feedback", "user_id"),
            ("category_reports", "user_id"),
            ("invite_codes", "used_by"),
        ):
            cur = conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (user_id,))
            counts[table] = cur.rowcount

        # Count mistakes that will cascade-delete with the games, so the
        # response can report them honestly.
        counts["mistakes"] = conn.execute(
            "SELECT COUNT(*) FROM mistakes m JOIN games g ON m.game_id = g.id WHERE g.user_id = ?",
            (user_id,),
        ).fetchone()[0]

        cur = conn.execute("DELETE FROM games WHERE user_id = ?", (user_id,))
        counts["games"] = cur.rowcount

        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        counts["users"] = cur.rowcount

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return counts


# --- Invite codes ---

def create_invite_codes(conn, n):
    """Generate n invite codes. Returns list of code strings."""
    codes = []
    for _ in range(n):
        code = secrets.token_urlsafe(8)
        conn.execute("INSERT INTO invite_codes (code) VALUES (?)", (code,))
        codes.append(code)
    conn.commit()
    return codes


def list_invite_codes(conn):
    """List all invite codes with status."""
    return conn.execute(
        """SELECT ic.code, ic.created_at, ic.used_at, u.username as used_by_name
           FROM invite_codes ic LEFT JOIN users u ON ic.used_by = u.id
           ORDER BY ic.created_at""",
    ).fetchall()


def validate_invite_code(conn, code):
    """Check if an invite code is valid (exists and unused). Returns True/False."""
    row = conn.execute(
        "SELECT used_by FROM invite_codes WHERE code = ?", (code,)
    ).fetchone()
    return row is not None and row["used_by"] is None
