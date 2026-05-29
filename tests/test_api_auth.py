#!/usr/bin/env python3
"""Tests for /login, /register, /logout routes and their edge cases.

Shared `client` fixture and `insert_game` helper live in conftest.py.
"""


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


def _register(client, username, password):
    return client.post("/register", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


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
            "username": "newuser", "password": "longpassword",
        })
        assert res.status_code == 302  # redirect on success

    def test_register_short_password(self, client):
        res = _register(client, "newuser", "short")
        assert b"at least 8" in res.data

    def test_register_empty_fields(self, client):
        res = _register(client, "", "longpassword")
        assert b"required" in res.data

    def test_register_duplicate_username(self, client):
        res = _register(client, "testuser", "longpassword")
        assert b"already taken" in res.data

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
        assert b"already taken" in res.data

    def test_register_missing_username(self, client):
        res = _register(client, "", "longpassword")
        assert res.status_code == 200
        assert b"required" in res.data

    def test_register_missing_password(self, client):
        res = _register(client, "newuser", "")
        assert res.status_code == 200
        assert b"required" in res.data

    def test_register_boundary_password_length(self, client):
        """8-char password should succeed."""
        res = client.post("/register", data={
            "username": "exact8pw", "password": "12345678",
        })
        assert res.status_code == 302  # redirect on success

    def test_login_after_register(self, client):
        """Register, logout, then log in with new credentials."""
        _register(client, "newuser2", "longpassword")
        client.get("/logout")
        res = _login(client, "newuser2", "longpassword")
        me = client.get("/api/me")
        assert me.status_code == 200
        assert me.get_json()["username"] == "newuser2"
