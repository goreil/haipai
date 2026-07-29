"""Users + OAuth linking."""

import secrets


# --- Users ---

def create_user(conn, username, password_hash, email=None, verify_token=None, verify_expires=None):
    """Create a new user. Returns user_id or raises on duplicate username/email.

    `email`/`verify_token`/`verify_expires` are only set for password-based
    registrations going through email verification (routes/auth.py). OAuth
    accounts (create_oauth_user) and callers that omit them leave `email`
    NULL, which also means the email_verified login gate never applies to
    those accounts.
    """
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, email, email_verify_token, email_verify_expires) "
        "VALUES (?, ?, ?, ?, ?)",
        (username, password_hash, email, verify_token, verify_expires),
    )
    conn.commit()
    return cur.lastrowid


def get_user_by_email(conn, email):
    """Get user row by email."""
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def get_user_by_verify_token(conn, token):
    """Get user row by pending email-verification token."""
    if not token:
        return None
    return conn.execute(
        "SELECT * FROM users WHERE email_verify_token = ?", (token,)
    ).fetchone()


def mark_email_verified(conn, user_id):
    """Mark a user's email verified and clear the now-spent token."""
    conn.execute(
        "UPDATE users SET email_verified = 1, email_verify_token = NULL, "
        "email_verify_expires = NULL WHERE id = ?",
        (user_id,),
    )
    conn.commit()


def set_verify_token(conn, user_id, token, expires):
    """Replace a user's pending email-verification token (e.g. on resend)."""
    conn.execute(
        "UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE id = ?",
        (token, expires, user_id),
    )
    conn.commit()


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


# --- Extension tokens ---
#
# The browser extension gets its own per-install credential instead of the
# shared upload_token, minted by the /extension/authorize consent flow
# (routes/auth.py). One row per connected install so a user can revoke a
# single browser, and so rotating the bookmarklet token leaves extensions
# alone. Rows cascade-delete with the user.

def create_extension_token(conn, user_id, client=None):
    """Mint a fresh extension credential for `user_id`. Returns the token."""
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO extension_tokens (user_id, token, client) VALUES (?, ?, ?)",
        (user_id, token, client),
    )
    conn.commit()
    return token


def get_user_by_extension_token(conn, token):
    """Look up the owning user by extension token, stamping last_used_at.

    Returns the *user* row (same shape as get_user_by_upload_token) or None.
    """
    if not token:
        return None
    row = conn.execute(
        "SELECT id, user_id FROM extension_tokens WHERE token = ?", (token,)
    ).fetchone()
    if not row:
        return None
    conn.execute(
        "UPDATE extension_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
        (row["id"],),
    )
    conn.commit()
    return get_user_by_id(conn, row["user_id"])


def list_extension_tokens(conn, user_id):
    """Connected extension installs for the account settings UI (no secrets)."""
    return conn.execute(
        "SELECT id, client, created_at, last_used_at FROM extension_tokens "
        "WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()


def delete_extension_token(conn, user_id, token_id):
    """Revoke one install. Scoped to user_id so ids can't be probed."""
    cur = conn.execute(
        "DELETE FROM extension_tokens WHERE id = ? AND user_id = ?",
        (token_id, user_id),
    )
    conn.commit()
    return cur.rowcount > 0


def delete_extension_token_by_value(conn, token):
    """Self-revoke: the extension deletes its own credential on sign-out.

    Holding the token is the authorization, so no user_id is needed — it can
    only ever match the row it already belongs to.
    """
    if not token:
        return False
    cur = conn.execute("DELETE FROM extension_tokens WHERE token = ?", (token,))
    conn.commit()
    return cur.rowcount > 0


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
        cur = conn.execute("DELETE FROM category_reports WHERE user_id = ?", (user_id,))
        counts["category_reports"] = cur.rowcount

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
