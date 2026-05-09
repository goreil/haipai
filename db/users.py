"""Users + OAuth linking."""

import secrets


# --- Users ---

def create_user(conn, username, password_hash):
    """Create a new user. Returns user_id or raises on duplicate."""
    cur = conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, password_hash),
    )
    conn.commit()
    return cur.lastrowid


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


def get_or_create_upload_token(conn, user_id):
    """Return the user's upload token, generating one on first request."""
    row = conn.execute(
        "SELECT upload_token FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if row and row["upload_token"]:
        return row["upload_token"]
    token = secrets.token_urlsafe(32)
    conn.execute("UPDATE users SET upload_token = ? WHERE id = ?", (token, user_id))
    conn.commit()
    return token


def regenerate_upload_token(conn, user_id):
    """Replace the user's upload token, invalidating any existing bookmarklets."""
    token = secrets.token_urlsafe(32)
    conn.execute("UPDATE users SET upload_token = ? WHERE id = ?", (token, user_id))
    conn.commit()
    return token


def get_user_by_upload_token(conn, token):
    """Look up user by upload token. Returns row or None."""
    if not token:
        return None
    return conn.execute(
        "SELECT * FROM users WHERE upload_token = ?", (token,)
    ).fetchone()


def delete_user_cascade(conn, user_id):
    """GDPR-style hard delete: wipe a user and every row tied to them.

    Wraps everything in a single transaction. Tables without ON DELETE
    cascades on `users(id)` are cleared explicitly first; `games` deletion
    then cascades through `mistakes` (and onwards to `category_reports`
    rows attached to those mistakes via mistake_id).

    Returns a dict of per-table row counts removed, or ``None`` if the
    user did not exist.
    """
    if not conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
        return None

    counts = {}
    try:
        # Rows that reference users(id) directly with no ON DELETE behavior.
        for table, col in (
            ("feedback", "user_id"),
            ("category_reports", "user_id"),
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
