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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    used_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP,
    FOREIGN KEY (used_by) REFERENCES users(id)
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

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    admin_note TEXT,
    github_issue_url TEXT,
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
    severity TEXT,
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
    related_feedback_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audience_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (related_feedback_id) REFERENCES feedback(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS message_reads (
    user_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, message_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

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
    for col, typedef in [("status", "TEXT NOT NULL DEFAULT 'new'"),
                         ("admin_note", "TEXT"),
                         ("github_issue_url", "TEXT")]:
        if not _has_column("feedback", col):
            conn.execute(f"ALTER TABLE feedback ADD COLUMN {col} {typedef}")
            altered = True
    if not _has_column("games", "categorization_status"):
        conn.execute("ALTER TABLE games ADD COLUMN categorization_status TEXT NOT NULL DEFAULT 'done'")
        altered = True
    for col in ("discord_id", "google_id"):
        if not _has_column("users", col):
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
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
    if altered:
        conn.commit()
