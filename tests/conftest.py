"""Shared pytest configuration.

Adds the project root to sys.path so test modules can import top-level packages
(`db`, `app`, `lib.*`, `routes.*`) without each file repeating the boilerplate.
Also provides a shared Flask `client` fixture and an `insert_game` helper so
HTTP-level test modules don't each rebuild the app + temp-db + game setup.
"""

import importlib
import os
import sys

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


@pytest.fixture
def client(tmp_path):
    """Flask test client backed by a fresh temporary SQLite DB + seed user."""
    import db

    db_path = tmp_path / "test.db"
    os.environ["DB_PATH"] = str(db_path)
    os.environ["SECRET_KEY"] = "test-secret"

    importlib.reload(db)

    conn = db.get_db()
    db.init_db(conn)
    from werkzeug.security import generate_password_hash
    db.create_user(conn, "testuser", generate_password_hash("testpass1"))
    conn.close()

    import app as app_module
    importlib.reload(app_module)
    app_module.app.config["TESTING"] = True
    app_module.app.config["WTF_CSRF_ENABLED"] = False

    with app_module.app.test_client() as c:
        yield c


def insert_game(user_id, with_mistakes=True):
    """Insert a game directly into the DB and return (game_id, mistake_id or None).

    Used by both test_api_game.py and test_api_reports.py — kept here so the
    two consumers stay in lockstep on the fixture shape.
    """
    import db
    from tests.fixtures import make_game, make_mistake, make_round

    summary = ({"total_mistakes": 1, "total_ev_loss": 0.50, "by_severity": {"??": 1}}
               if with_mistakes
               else {"total_mistakes": 0, "total_ev_loss": 0, "by_severity": {}})
    game_dict = make_game(
        log_url=None,
        mortal_file=None,
        summary=summary,
        rounds=[make_round(
            decision_count=8,
            mistakes=[make_mistake()] if with_mistakes else [],
        )],
    )
    conn = db.get_db()
    game_id = db.add_game(conn, user_id, game_dict)
    mistake_id = None
    if with_mistakes:
        row = conn.execute(
            "SELECT id FROM mistakes WHERE game_id = ?", (game_id,)
        ).fetchone()
        mistake_id = row["id"]
    conn.close()
    return game_id, mistake_id


