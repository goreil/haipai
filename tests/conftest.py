"""Shared pytest configuration.

Adds the project root to sys.path so test modules can import top-level packages
(`db`, `app`, `lib.*`, `routes.*`) without each file repeating the boilerplate.
Also provides a shared Flask `client` fixture so HTTP-level tests don't each
rebuild the app + temp-db setup.
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


