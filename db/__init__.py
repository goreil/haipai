"""SQLite database package for mahjong game review data.

`db.py` was split into per-concept submodules; `import db` still
exposes the same flat public surface so callsites do not move.
Submodule layout (see `docs/backlogs/REFACTOR-TARGET.md`):

- `db.schema`    — SCHEMA string + `migrate(conn)`
- `db.mistakes`  — `MISTAKE_COLUMNS`, `mistake_to_row`, `row_to_mistake`,
                   `annotate_mistake`, `update_mistake_data`
- `db.games`     — list/get/add/delete + `compute_summary_for_game`,
                   `get_trends`
- `db.users`     — users, OAuth linking
- `db.reports`   — category-report CRUD
- `db.admin`     — `is_admin`, `admin_user_stats`
"""

import os
import sqlite3
from pathlib import Path

from db.schema import SCHEMA, migrate as _migrate
from db.mistakes import (
    MISTAKE_COLUMNS,
    annotate_mistake,
    mistake_to_row,
    row_to_mistake,
    update_mistake_data,
)
from db.games import (
    add_game,
    compute_summary_for_game,
    delete_game,
    get_game,
    get_trends,
    list_games,
    update_game_stats,
)
from db.users import (
    create_oauth_user,
    create_user,
    delete_user_cascade,
    get_or_create_upload_token,
    get_user_by_id,
    get_user_by_oauth,
    get_user_by_upload_token,
    get_user_by_username,
    link_oauth,
    regenerate_upload_token,
)
from db.reports import (
    REPORT_KINDS,
    delete_category_report,
    get_report_for_mistake,
    list_category_reports,
    submit_category_report,
)
from db.admin import admin_user_stats, is_admin
from db.snapshots import insert_snapshot, list_snapshots
from db.messages import (
    create_message,
    list_for_user as list_messages_for_user,
    mark_all_read as mark_all_messages_read,
    mark_read as mark_message_read,
)

DIR = Path(__file__).parent.parent
DB_FILE = Path(os.environ.get("DB_PATH", DIR / "games.db"))


def get_db(db_path=None):
    """Get a database connection."""
    path = db_path or DB_FILE
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn):
    """Create tables if they don't exist, then run migrations for new columns."""
    conn.executescript(SCHEMA)
    conn.commit()
    _migrate(conn)


__all__ = [
    # connection / init
    "DB_FILE",
    "SCHEMA",
    "get_db",
    "init_db",
    # mistakes
    "MISTAKE_COLUMNS",
    "annotate_mistake",
    "mistake_to_row",
    "row_to_mistake",
    "update_mistake_data",
    # games
    "add_game",
    "compute_summary_for_game",
    "delete_game",
    "get_game",
    "get_trends",
    "list_games",
    "update_game_stats",
    # users
    "create_oauth_user",
    "create_user",
    "delete_user_cascade",
    "get_or_create_upload_token",
    "get_user_by_id",
    "get_user_by_oauth",
    "get_user_by_upload_token",
    "get_user_by_username",
    "link_oauth",
    "regenerate_upload_token",
    # reports
    "REPORT_KINDS",
    "delete_category_report",
    "get_report_for_mistake",
    "list_category_reports",
    "submit_category_report",
    # admin
    "admin_user_stats",
    "is_admin",
    # snapshots
    "insert_snapshot",
    "list_snapshots",
    # messages (mailbox)
    "create_message",
    "list_messages_for_user",
    "mark_all_messages_read",
    "mark_message_read",
]
