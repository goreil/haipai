"""SQLite schema + migration steps for the games.db database.

Schema-preserving: any change here ripples to live production.
Migrations are forward-only; additive steps (`ALTER TABLE ADD COLUMN`
/ `CREATE INDEX IF NOT EXISTS`) are the default. Destructive steps
(drop table, drop column) require an explicit, idempotent migration
block — see the practice-mode removal below for the pattern.
"""

# Updated with the Haipai grading formula. UTC, from commit 9f1ba75.
HAIPAI_RANK_UPDATED_AT = "2026-09-22 19:12:18"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    upload_token TEXT,
    email TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    email_verify_token TEXT,
    email_verify_expires TIMESTAMP,
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
    maka_ratings_json TEXT,
    maka_ratings_added_at_json TEXT,
    categorization_status TEXT NOT NULL DEFAULT 'done',
    share_token TEXT,
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

-- Award sources are snapshots: deleting a game/report must not erase earned coins.
CREATE TABLE IF NOT EXISTS community_coins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('report_fix', 'report_submit', 'maka_grade')),
    source_key TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount >= 0),
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    game_id INTEGER,
    mistake_id INTEGER,
    report_id INTEGER,
    message_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, kind, source_key)
);
CREATE INDEX IF NOT EXISTS idx_community_coins_user ON community_coins(user_id, id DESC);

CREATE TABLE IF NOT EXISTS weakness_snapshots (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    categorizer_version INTEGER NOT NULL,
    game_count INTEGER NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Global (all-users) snapshots of the mistake shape-bucket distribution,
-- captured from the admin dashboard. Unlike weakness_snapshots these are not
-- per-user: one row = one full-corpus tally tagged with the categorizer
-- version that produced it, so the "complex" bucket can be tracked as the
-- categorizer evolves. summary_json holds { by_shape, by_skill_shape,
-- total_mistakes, total_ev }.
CREATE TABLE IF NOT EXISTS category_snapshots (
    id INTEGER PRIMARY KEY,
    categorizer_version INTEGER NOT NULL,
    game_count INTEGER NOT NULL,
    mistake_count INTEGER NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS waits_scores (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    best_combo INTEGER NOT NULL DEFAULT 0,
    hands_cleared INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS defense_scores (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    best_streak INTEGER NOT NULL DEFAULT 0,
    steps_cleared INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS efficiency_scores (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    best_streak INTEGER NOT NULL DEFAULT 0,
    hands_cleared INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_upload_token
    ON users(upload_token) WHERE upload_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_game_id ON mistakes(game_id);
CREATE INDEX IF NOT EXISTS idx_category_reports_mistake ON category_reports(mistake_id);
CREATE INDEX IF NOT EXISTS idx_weakness_snapshots_user ON weakness_snapshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_category_snapshots_created ON category_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_audience ON messages(audience_user_id);
CREATE INDEX IF NOT EXISTS idx_waits_scores_user ON waits_scores(user_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_efficiency_scores_user ON efficiency_scores(user_id, score DESC);
"""


def migrate(conn):
    """Add columns that may be missing on older databases."""
    def _has_column(table, column):
        cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(c["name"] == column for c in cols)

    # SQLite CHECK constraints require rebuilding the ledger to add an award kind.
    ledger_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'community_coins'"
    ).fetchone()
    if ledger_sql and "'report_submit'" not in ledger_sql["sql"]:
        with conn:
            # Start before DDL so a failed rebuild rolls the rename back too.
            conn.execute("SAVEPOINT expand_report_rewards")
            sequence = conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'community_coins'").fetchone()
            conn.execute("ALTER TABLE community_coins RENAME TO community_coins_old")
            conn.execute(ledger_sql["sql"].replace(
                "'report_fix', 'maka_grade'", "'report_fix', 'report_submit', 'maka_grade'"))
            conn.execute("INSERT INTO community_coins SELECT * FROM community_coins_old")
            conn.execute("DROP TABLE community_coins_old")
            if sequence:
                conn.execute("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'community_coins'",
                             (sequence["seq"],))
            conn.execute("CREATE INDEX idx_community_coins_user ON community_coins(user_id, id DESC)")
            conn.execute("RELEASE SAVEPOINT expand_report_rewards")

    altered = False
    for table in ('games', 'mistakes'):
        if not _has_column(table, 'coin_key'):
            conn.execute(f'ALTER TABLE {table} ADD COLUMN coin_key TEXT')
            altered = True
    if not _has_column("games", "maka_ratings_json"):
        conn.execute("ALTER TABLE games ADD COLUMN maka_ratings_json TEXT")
        altered = True
    if not _has_column("games", "maka_ratings_added_at_json"):
        import json

        conn.execute("ALTER TABLE games ADD COLUMN maka_ratings_added_at_json TEXT")
        # A grade on a game uploaded after the last ranking change must have
        # been added after that change. Earlier uploads have no reliable grade
        # save date, so leave their existing grades explicitly undated.
        for row in conn.execute(
            "SELECT id, created_at, maka_ratings_json FROM games "
            "WHERE maka_ratings_json IS NOT NULL AND created_at >= ?",
            (HAIPAI_RANK_UPDATED_AT,),
        ).fetchall():
            ratings = json.loads(row["maka_ratings_json"])
            added = {
                "overall": row["created_at"] if ratings.get("overall") else None,
                "matches": [row["created_at"] if grade else None for grade in ratings.get("matches", [])],
            }
            conn.execute(
                "UPDATE games SET maka_ratings_added_at_json = ? WHERE id = ?",
                (json.dumps(added), row["id"]),
            )
        altered = True
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
    if not _has_column("games", "share_token"):
        conn.execute("ALTER TABLE games ADD COLUMN share_token TEXT")
        altered = True
    if not _has_column("users", "email"):
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
        conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE users ADD COLUMN email_verify_token TEXT")
        conn.execute("ALTER TABLE users ADD COLUMN email_verify_expires TIMESTAMP")
        # Email verification postdates these accounts entirely — grandfather
        # them in rather than locking every existing user out on next login.
        conn.execute("UPDATE users SET email_verified = 1")
        altered = True
    # Leaderboard nickname. NULL means "use the username" — the boards read
    # COALESCE(display_name, username), so nothing needs backfilling.
    if not _has_column("users", "display_name"):
        conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
        altered = True
    # These three indexes stay outside their _has_column gates (unlike
    # upload_token's index above) so they also run for fresh installs, where
    # executescript(SCHEMA) already created the column and the gate is
    # skipped — the top-level SCHEMA string deliberately omits them, since on
    # an existing prod DB they'd run (via executescript) before the ALTER
    # TABLE above ever does.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_games_share_token "
        "ON games(share_token) WHERE share_token IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email "
        "ON users(email) WHERE email IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_verify_token "
        "ON users(email_verify_token) WHERE email_verify_token IS NOT NULL"
    )
    # Case-insensitive: two players called "Kanata" would make the board
    # unreadable, so a nickname is claimed exactly once (usernames are checked
    # in db.users.set_display_name, which SQLite can't express as an index).
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name "
        "ON users(lower(display_name)) WHERE display_name IS NOT NULL"
    )
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
    # Keep resolved reports as history; only an open report can be edited.
    for column, definition in (("fixed_at", "TIMESTAMP"),
                               ("fixed_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL"),
                               ("fix_note", "TEXT")):
        if not _has_column("category_reports", column):
            conn.execute(f"ALTER TABLE category_reports ADD COLUMN {column} {definition}")
            altered = True
    conn.execute("DROP INDEX IF EXISTS idx_category_reports_user_mistake")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_category_reports_open_user_mistake "
        "ON category_reports(user_id, mistake_id) WHERE fixed_at IS NULL"
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
    # Drop every pre-cutover-stored data_json field that the frontend now
    # rebuilds on each fetch. `static/js/prep/prep.js` recomputes the board /
    # discard / defense fields; `static/js/categorize.js` recomputes the
    # categorizer output. Anything in this list is dead weight, and stale
    # copies cause regressions (e.g. mistake #3986 was rendering the legacy
    # 0-15 Safety column because `safety_ratings` lingered after the kyoku's
    # riichi went away). The canonical Mortal-emitted fields (hand, melds,
    # shanten, draw, actual, expected, top_actions) are left alone.
    _LEGACY_DATA_JSON_FIELDS = (
        # prep.js: board + discard
        "board_state", "discard_stats", "best_discard",
        # prep.js: KD defense (and the legacy 0-15 scale that fell back to it)
        "safety_ratings", "dealin_rates", "wait_breakdowns",
        "suji_partners", "per_threat", "opponent_discards",
        # prep.js: 5A/5B riichi patches
        "tenpai_waits", "actual_riichi_tile", "bad_riichi_reason",
        "furiten_tiles", "prior_own_discards",
        # categorize.js: categorizer output
        "categorize_data", "labels",
        # pre-cutover speed-calculator copies (prep.js recomputes both)
        "cpp_best", "cpp_stats",
        # pre-cutover defense labels (defense-labels.js derives them live)
        "safety_labels", "safety_label_text",
    )
    _remove_args = ", ".join(f"'$.{f}'" for f in _LEGACY_DATA_JSON_FIELDS)
    _where_clause = " OR ".join(
        f"json_type(data_json, '$.{f}') IS NOT NULL"
        for f in _LEGACY_DATA_JSON_FIELDS
    )
    stripped = conn.execute(
        f"UPDATE mistakes SET data_json = json_remove(data_json, {_remove_args}) "
        f"WHERE {_where_clause}"
    )
    if stripped.rowcount:
        altered = True
    # Drop legacy mistakes.category column. The JS categorizer is the source
    # of truth and recomputes on every fetch; user annotations only persist
    # the free-form note. See docs/backlogs/BACKEND-TO-FRONTEND.md.
    if _has_column("mistakes", "category"):
        conn.execute("ALTER TABLE mistakes DROP COLUMN category")
        # stats_json.by_category is also stale once category is gone;
        # strip it so trends doesn't read pre-cutover aggregates.
        conn.execute(
            "UPDATE games SET stats_json = json_remove(stats_json, '$.by_category') "
            "WHERE stats_json IS NOT NULL AND json_valid(stats_json) "
            "AND json_type(stats_json, '$.by_category') IS NOT NULL"
        )
        altered = True
    if altered:
        conn.commit()
