#!/usr/bin/env python3
"""Tests for /login, /register, /logout routes and their edge cases.

Shared `client` fixture and `insert_game` helper live in conftest.py.

Registration now requires an email and gates login behind clicking the
verification link (MAILBOX_USERNAME/PASSWORD aren't set in the test env, so
the send itself silently no-ops — `_verify` reads the token straight out of
the DB instead of an inbox).
"""

import db


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


def _register(client, username, password, email=None):
    return client.post("/register", data={
        "username": username,
        "password": password,
        "email": email or f"{username}@example.com",
    }, follow_redirects=True)


def _verify(client, username):
    """Fetch the pending verification token straight from the DB and visit it."""
    conn = db.get_db()
    row = db.get_user_by_username(conn, username)
    conn.close()
    return client.get(f"/verify-email/{row['email_verify_token']}", follow_redirects=True)


# --- /login ---

class TestAuth:
    def test_login_wrong_password(self, client):
        res = client.post("/login", data={
            "username": "testuser", "password": "wrongpass",
        })
        assert res.status_code == 200
        assert b"Invalid" in res.data

    def test_login_nonexistent_user(self, client):
        res = client.post("/login", data={
            "username": "noone", "password": "testpass1",
        })
        assert res.status_code == 200
        assert b"Invalid" in res.data

    def test_login_success_redirects(self, client):
        res = client.post("/login", data={
            "username": "testuser", "password": "testpass1",
        })
        assert res.status_code == 302

    def test_login_already_authenticated_redirects(self, client):
        _login(client)
        res = client.get("/login")
        assert res.status_code == 302

    def test_logout(self, client):
        _login(client)
        res = client.get("/logout")
        assert res.status_code == 302
        # After logout, API should be 401
        res2 = client.get("/api/games")
        assert res2.status_code == 401


# --- /register ---

class TestRegistration:
    def test_register_success(self, client):
        res = client.post("/register", data={
            "username": "newuser", "password": "longpassword", "email": "newuser@example.com",
        })
        assert res.status_code == 200  # stays on the "check your email" page, no auto-login
        assert b"Check your email" in res.data

    def test_register_short_password(self, client):
        res = _register(client, "newuser", "short")
        assert b"at least 8" in res.data

    def test_register_empty_fields(self, client):
        res = _register(client, "", "longpassword")
        assert b"required" in res.data

    def test_register_missing_email(self, client):
        res = client.post("/register", data={"username": "noemail", "password": "longpassword"})
        assert b"required" in res.data

    def test_register_invalid_email(self, client):
        res = _register(client, "bademail", "longpassword", email="not-an-email")
        assert b"valid email" in res.data

    def test_register_duplicate_username(self, client):
        res = _register(client, "testuser", "longpassword")
        assert b"already in use" in res.data

    def test_register_already_authenticated_redirects(self, client):
        _login(client)
        res = client.get("/register")
        assert res.status_code == 302


# --- Auth edge cases ---

class TestAuthEdgeCases:
    def test_login_wrong_password(self, client):
        res = client.post("/login", data={
            "username": "testuser", "password": "wrongpassword",
        })
        assert res.status_code == 200
        assert b"Invalid" in res.data

    def test_login_empty_username(self, client):
        res = client.post("/login", data={
            "username": "", "password": "testpass1",
        })
        assert res.status_code == 200
        assert b"Invalid" in res.data

    def test_register_short_password(self, client):
        res = _register(client, "shortpw", "1234567")
        assert res.status_code == 200
        assert b"at least 8" in res.data

    def test_register_duplicate_username(self, client):
        res = _register(client, "testuser", "longpassword")
        assert res.status_code == 200
        assert b"already in use" in res.data

    def test_register_missing_username(self, client):
        res = _register(client, "", "longpassword")
        assert res.status_code == 200
        assert b"required" in res.data

    def test_register_missing_password(self, client):
        res = _register(client, "newuser", "")
        assert res.status_code == 200
        assert b"required" in res.data

    def test_register_boundary_password_length(self, client):
        """8-char password should succeed (but still needs verification, no auto-login)."""
        res = client.post("/register", data={
            "username": "exact8pw", "password": "12345678", "email": "exact8pw@example.com",
        })
        assert res.status_code == 200
        assert b"Check your email" in res.data

    def test_login_blocked_before_verification(self, client):
        """Registering doesn't log you in, and logging in is blocked until verified."""
        _register(client, "newuser2", "longpassword")
        res = _login(client, "newuser2", "longpassword")
        assert b"verify your email" in res.data
        me = client.get("/api/me")
        assert me.status_code == 401

    def test_login_after_verification(self, client):
        """Register, click the verification link, then log in with new credentials."""
        _register(client, "newuser3", "longpassword")
        _verify(client, "newuser3")
        client.get("/logout")
        res = _login(client, "newuser3", "longpassword")
        me = client.get("/api/me")
        assert me.status_code == 200
        assert me.get_json()["username"] == "newuser3"

    def test_verify_email_invalid_token(self, client):
        res = client.get("/verify-email/not-a-real-token", follow_redirects=True)
        assert res.status_code == 200
        assert b"Invalid or already-used" in res.data

    def test_resend_verification(self, client):
        _register(client, "newuser4", "longpassword")
        res = client.post("/resend-verification", data={"username": "newuser4"}, follow_redirects=True)
        assert res.status_code == 200
        assert b"sent a new link" in res.data
        _verify(client, "newuser4")
        me = client.get("/api/me")
        assert me.status_code == 200
