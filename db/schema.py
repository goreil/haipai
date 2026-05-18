"""SQLite schema + migration steps for the games.db database.

Schema-preserving: any change here ripples to live production.
Migrations are forward-only; additive steps (`ALTER TABLE ADD COLUMN`
/ `CREATE INDEX IF NOT EXISTS`) are the default. Destructive steps
(drop table, drop column) require an explicit, idempotent migration
block — see the practice-mode removal below for the pattern.
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    upload_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    log_url TEXT,
    mortal_file TEXT,
    stats_json TEXT,
    rounds_json TEXT,
    categorization_status TEXT NOT NULL DEFAULT 'done',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL,
    round_name TEXT NOT NULL,
    round_idx INTEGER NOT NULL,
    mistake_idx INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    category TEXT,
    ev_loss REAL,
    turn INTEGER,
    note TEXT,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    mistake_id INTEGER NOT NULL,
    agree INTEGER NOT NULL,
    suggested_category TEXT,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('feature','thanks')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audience_user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audience_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_reads (
    user_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, message_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_upload_token
    ON users(upload_token) WHERE upload_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_game_id ON mistakes(game_id);
CREATE INDEX IF NOT EXISTS idx_category_reports_mistake ON category_reports(mistake_id);
CREATE INDEX IF NOT EXISTS idx_messages_audience ON messages(audience_user_id);
"""


def migrate(conn):
    """Add columns that may be missing on older databases."""
    def _has_column(table, column):
        cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(c["name"] == column for c in cols)

    altered = False
    if not _has_column("users", "is_admin"):
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        altered = True
    if not _has_column("games", "categorization_status"):
        conn.execute("ALTER TABLE games ADD COLUMN categorization_status TEXT NOT NULL DEFAULT 'done'")
        altered = True
    for col in ("discord_id", "google_id"):
        if not _has_column("users", col):
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
            altered = True
    if not _has_column("users", "upload_token"):
        conn.execute("ALTER TABLE users ADD COLUMN upload_token TEXT")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_upload_token "
            "ON users(upload_token) WHERE upload_token IS NOT NULL"
        )
        altered = True
    if not _has_column("category_reports", "kind"):
        conn.execute("ALTER TABLE category_reports ADD COLUMN kind TEXT")
        # Backfill kind from legacy agree column: agree=1 -> 'agree',
        # agree=0 with suggested_category -> 'wrong_category', else 'wrong_text'
        conn.execute(
            """UPDATE category_reports SET kind = CASE
                   WHEN agree = 1 THEN 'agree'
                   WHEN suggested_category IS NOT NULL AND suggested_category != '' THEN 'wrong_category'
                   ELSE 'wrong_text'
               END WHERE kind IS NULL"""
        )
        altered = True
    # The 'agree' kind was removed; purge any rows that still carry it.
    cur = conn.execute("DELETE FROM category_reports WHERE kind = 'agree'")
    if cur.rowcount:
        altered = True
    # One report per user per mistake, so we can upsert on edit.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_category_reports_user_mistake "
        "ON category_reports(user_id, mistake_id)"
    )
    # Drop legacy practice-mode artifacts. Idempotent: skipped on fresh DBs.
    if conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='practice_results'"
    ).fetchone():
        conn.execute("DROP TABLE practice_results")
        altered = True
    if _has_column("users", "practice_opt_in"):
        conn.execute("ALTER TABLE users DROP COLUMN practice_opt_in")
        altered = True
    # Invite codes were retired; drop the table on older DBs that still have it.
    if conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='invite_codes'"
    ).fetchone():
        conn.execute("DROP TABLE invite_codes")
        altered = True
    # The user-feedback feature was removed; drop the table and the
    # messages.related_feedback_id column that referenced it. Idempotent.
    # The column carries a FK to feedback(id), which SQLite refuses to
    # drop in place, so the messages table is rebuilt to shed both the
    # column and its foreign key.
    if _has_column("messages", "related_feedback_id"):
        conn.executescript("""
            CREATE TABLE messages_new (
                id INTEGER PRIMARY KEY,
                type TEXT NOT NULL CHECK(type IN ('feature','thanks')),
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                audience_user_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (audience_user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            INSERT INTO messages_new (id, type, title, body, audience_user_id, created_at)
                SELECT id, type, title, body, audience_user_id, created_at FROM messages;
            DROP TABLE messages;
            ALTER TABLE messages_new RENAME TO messages;
        """)
        altered = True
    if conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'"
    ).fetchone():
        conn.execute("DROP TABLE feedback")
        altered = True
    # Drop legacy mistakes.severity column. Backend categorization no longer
    # writes it; the frontend recomputes severity tiers from ev_loss.
    if _has_column("mistakes", "severity"):
        conn.execute("ALTER TABLE mistakes DROP COLUMN severity")
        altered = True
    if altered:
        conn.commit()
