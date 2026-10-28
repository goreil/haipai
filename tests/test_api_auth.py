#!/usr/bin/env python3
"""Tests for /login, /register, /logout routes and their edge cases.

Shared `client` fixture and `insert_game` helper live in conftest.py.

Existing unverified password accounts can still be verified and used.
"""

import db
from werkzeug.security import generate_password_hash


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


def _create_unverified(username, password):
    conn = db.get_db()
    db.create_user(conn, username, generate_password_hash(password), email=f"{username}@example.com",
                   verify_token=f"token-{username}", verify_expires="2099-01-01 00:00:00")
    conn.close()


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
    def test_registration_only_offers_oauth(self, client, monkeypatch):
        from app import oauth
        monkeypatch.setitem(oauth._clients, "discord", object())
        monkeypatch.setitem(oauth._clients, "google", object())
        res = client.get("/register")
        assert b'href="/auth/discord"' in res.data
        assert b'href="/auth/google"' in res.data
        assert b'name="password"' not in res.data
        assert b'name="email"' not in res.data

    def test_password_registration_is_rejected(self, client):
        res = client.post("/register", data={
            "username": "newuser", "password": "longpassword", "email": "newuser@example.com",
        })
        assert res.status_code == 405
        conn = db.get_db()
        assert db.get_user_by_username(conn, "newuser") is None
        conn.close()

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

    def test_login_blocked_before_verification(self, client):
        """Existing unverified accounts cannot log in until verified."""
        _create_unverified("newuser2", "longpassword")
        res = _login(client, "newuser2", "longpassword")
        assert b"verify your email" in res.data
        me = client.get("/api/me")
        assert me.status_code == 401

    def test_login_after_verification(self, client):
        """Verify an existing account, then log in with its credentials."""
        _create_unverified("newuser3", "longpassword")
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
        _create_unverified("newuser4", "longpassword")
        res = client.post("/resend-verification", data={"username": "newuser4"}, follow_redirects=True)
        assert res.status_code == 200
        assert b"sent a new link" in res.data
        _verify(client, "newuser4")
        me = client.get("/api/me")
        assert me.status_code == 200
