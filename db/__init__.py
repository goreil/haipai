"""SQLite database package for mahjong game review data.

`db.py` was split into per-concept submodules; `import db` still
exposes the same flat public surface so callsites do not move.
Submodule layout (see `docs/backlogs/REFACTOR-TARGET.md`):

- `db.schema`    — SCHEMA string + `migrate(conn)`
- `db.mistakes`  — `MISTAKE_COLUMNS`, `mistake_to_row`, `row_to_mistake`,
                   `annotate_mistake`, `update_mistake_data`
- `db.games`     — list/get/add/delete + `compute_summary_for_game`
- `db.practice`  — practice picker, stats, trends
- `db.users`     — users, OAuth linking, invite codes
- `db.feedback`  — bug-report CRUD
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
    list_games,
    update_game_stats,
)
from db.practice import (
    get_practice_problem,
    get_practice_stats,
    get_public_practice_problem,
    get_trends,
    record_practice_result,
)
from db.users import (
    create_invite_codes,
    create_oauth_user,
    create_user,
    get_user_by_id,
    get_user_by_oauth,
    get_user_by_username,
    link_oauth,
    list_invite_codes,
    set_practice_opt_in,
    validate_invite_code,
)
from db.feedback import (
    get_feedback_item,
    get_user_feedback,
    list_feedback,
    update_feedback,
)
from db.reports import (
    REPORT_KINDS,
    get_report_for_mistake,
    list_category_reports,
    submit_category_report,
)
from db.admin import admin_user_stats, is_admin

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
    "list_games",
    "update_game_stats",
    # practice
    "get_practice_problem",
    "get_practice_stats",
    "get_public_practice_problem",
    "get_trends",
    "record_practice_result",
    # users
    "create_invite_codes",
    "create_oauth_user",
    "create_user",
    "get_user_by_id",
    "get_user_by_oauth",
    "get_user_by_username",
    "link_oauth",
    "list_invite_codes",
    "set_practice_opt_in",
    "validate_invite_code",
    # feedback
    "get_feedback_item",
    "get_user_feedback",
    "list_feedback",
    "update_feedback",
    # reports
    "REPORT_KINDS",
    "get_report_for_mistake",
    "list_category_reports",
    "submit_category_report",
    # admin
    "admin_user_stats",
    "is_admin",
]
