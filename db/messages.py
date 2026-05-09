"""Per-user mailbox messages.

Messages are either broadcasts (`audience_user_id IS NULL`) visible to every
user, or directed at a single recipient. Read state lives in `message_reads`
so the same broadcast row can be unread for one user and read for another.
"""


def list_for_user(conn, user_id):
    """Return all messages visible to `user_id`, newest first.

    Each row carries an `unread` boolean derived from `message_reads`. The
    `id` is returned as a string to match the design's id format and avoid
    JS number coercion surprises in dataset attributes.
    """
    rows = conn.execute(
        """SELECT m.id, m.type, m.title, m.body, m.created_at,
                  CASE WHEN r.message_id IS NULL THEN 1 ELSE 0 END AS unread
             FROM messages m
             LEFT JOIN message_reads r
                    ON r.message_id = m.id AND r.user_id = ?
            WHERE m.audience_user_id IS NULL OR m.audience_user_id = ?
            ORDER BY m.created_at DESC, m.id DESC""",
        (user_id, user_id),
    ).fetchall()
    return [dict(r) for r in rows]


def mark_read(conn, user_id, message_id):
    """Mark a single message as read for this user.

    Returns False if the message doesn't exist or isn't visible to the user.
    """
    visible = conn.execute(
        """SELECT 1 FROM messages
            WHERE id = ?
              AND (audience_user_id IS NULL OR audience_user_id = ?)""",
        (message_id, user_id),
    ).fetchone()
    if not visible:
        return False
    conn.execute(
        """INSERT OR IGNORE INTO message_reads (user_id, message_id)
           VALUES (?, ?)""",
        (user_id, message_id),
    )
    conn.commit()
    return True


def mark_all_read(conn, user_id):
    """Mark every message visible to this user as read."""
    conn.execute(
        """INSERT OR IGNORE INTO message_reads (user_id, message_id)
           SELECT ?, m.id FROM messages m
            WHERE m.audience_user_id IS NULL OR m.audience_user_id = ?""",
        (user_id, user_id),
    )
    conn.commit()


def create_message(conn, *, type, title, body, audience_user_id=None):
    """Insert a new message. Used from CLI / admin tooling, not the API."""
    if type not in ("feature", "thanks"):
        raise ValueError(f"invalid message type: {type!r}")
    cur = conn.execute(
        """INSERT INTO messages (type, title, body, audience_user_id)
           VALUES (?, ?, ?, ?)""",
        (type, title, body, audience_user_id),
    )
    conn.commit()
    return cur.lastrowid
