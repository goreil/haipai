"""Authentication stays tied to an account even when SQLite reuses its ID."""

from concurrent.futures import ThreadPoolExecutor

import db
import pytest
from flask_login.utils import encode_cookie
from werkzeug.security import generate_password_hash


@pytest.mark.parametrize("remember_only", [False, True])
def test_deleted_account_session_cannot_access_reused_id(client, remember_only):
    conn = db.get_db()
    user_id = db.create_user(conn, "old", generate_password_hash("password"))
    assert client.post("/login", data={"username": "old", "password": "password", "remember": "1"}).status_code == 302
    assert client.get("/api/me").get_json()["id"] == user_id
    old_identity = db.get_user_by_id(conn, user_id)["auth_identity"]
    db.delete_user_cascade(conn, user_id)
    replacement = db.create_user(conn, "replacement", generate_password_hash("password"))
    assert replacement == user_id  # exercise the vulnerable SQLite behavior
    assert db.get_user_by_id(conn, replacement)["auth_identity"] != old_identity
    conn.close()

    if remember_only:
        client.delete_cookie("session")
    assert client.get("/api/me").status_code == 401
    assert client.get_cookie("remember_token") is None
    assert client.post("/login", data={"username": "replacement", "password": "password"}).status_code == 302
    assert client.get("/api/me").get_json()["username"] == "replacement"


@pytest.mark.parametrize("remember_only", [False, True])
def test_legacy_numeric_session_and_remember_are_rejected_and_cleared(client, remember_only):
    if remember_only:
        from app import app
        with app.app_context():
            cookie = encode_cookie("1")
        client.set_cookie("remember_token", cookie)
    else:
        with client.session_transaction() as session:
            session["_user_id"] = "1"
    assert client.get("/api/me").status_code == 401
    assert client.get_cookie("remember_token") is None
    with client.session_transaction() as session:
        assert "_user_id" not in session


def test_remember_cookie_restores_current_account(client):
    assert client.post("/login", data={"username": "testuser", "password": "testpass1", "remember": "1"}).status_code == 302
    client.delete_cookie("session")
    assert client.get("/api/me").get_json()["username"] == "testuser"


def test_oauth_registration_and_login_use_account_identity(client):
    from app import app
    from routes.auth import _oauth_login_or_create

    with app.test_request_context():
        _oauth_login_or_create("discord", "new-discord-account", "oauth-user")
        from flask import session
        conn = db.get_db()
        row = db.get_user_by_username(conn, "oauth-user")
        assert session["_user_id"] == row["auth_identity"]
        assert app.login_manager._user_callback(session["_user_id"]).id == row["id"]
        conn.close()


def test_deleted_impersonator_cannot_regain_admin_by_id_reuse(client):
    conn = db.get_db()
    # The admin must be the largest ID, so deleting it makes that ID reusable.
    admin_id = db.create_user(conn, "admin", generate_password_hash("password"))
    conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (admin_id,))
    conn.commit()
    client.post("/login", data={"username": "admin", "password": "password"})
    assert client.post("/api/admin/impersonate/1").status_code == 200
    db.delete_user_cascade(conn, admin_id)
    replacement = db.create_user(conn, "newadmin", "unused")
    assert replacement == admin_id
    conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (replacement,))
    conn.commit()
    conn.close()
    assert client.get("/api/admin/stats").status_code == 403
    assert client.post("/api/admin/impersonate/stop").status_code == 403


def test_admin_can_stop_impersonation(client):
    conn = db.get_db()
    conn.execute("UPDATE users SET is_admin = 1 WHERE id = 1")
    target = db.create_user(conn, "target", "unused")
    conn.close()
    client.post("/login", data={"username": "testuser", "password": "testpass1"})
    assert client.post(f"/api/admin/impersonate/{target}").status_code == 200
    assert client.get("/api/me").get_json()["username"] == "target"
    assert client.post("/api/admin/impersonate/stop").status_code == 200
    assert client.get("/api/me").get_json()["username"] == "testuser"


def test_concurrent_account_creation_gets_distinct_authentication_identities(client):
    def create(i):
        c = db.get_db()
        try:
            user_id = db.create_user(c, f"concurrent-{i}", "unused")
            return db.get_user_by_id(c, user_id)["auth_identity"]
        finally:
            c.close()

    with ThreadPoolExecutor(max_workers=8) as pool:
        identities = list(pool.map(create, range(16)))
    assert len(set(identities)) == 16


def test_migration_assigns_stable_unique_identities_under_concurrent_startup(tmp_path):
    path = tmp_path / "legacy.db"
    conn = db.get_db(path)
    db.init_db(conn)
    db.create_user(conn, "first", "unused")
    db.create_user(conn, "second", "unused")
    conn.execute("DROP TRIGGER users_generate_auth_identity")
    conn.execute("DROP INDEX idx_users_auth_identity")
    conn.execute("ALTER TABLE users DROP COLUMN auth_identity")
    conn.commit()
    conn.close()

    def migrate(_):
        c = db.get_db(path)
        try:
            db.init_db(c)
        finally:
            c.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(migrate, range(2)))
    conn = db.get_db(path)
    identities = [r[0] for r in conn.execute("SELECT auth_identity FROM users ORDER BY id")]
    assert len(set(identities)) == 2
    assert all(i.startswith("v1_") and len(i) == 67 for i in identities)
    db.init_db(conn)
    assert [r[0] for r in conn.execute("SELECT auth_identity FROM users ORDER BY id")] == identities
    conn.execute("INSERT INTO users (username, password_hash) VALUES ('direct', 'unused')")
    assert db.get_user_by_username(conn, "direct")["auth_identity"].startswith("v1_")
    conn.close()
