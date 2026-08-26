#!/usr/bin/env python3
"""Tests for the leaderboard nickname (/api/me/display-name).

The nickname is deliberately narrow: it changes what the minigame boards
print and nothing else — login, uniqueness and the admin views all still key
on `username`. These tests pin both halves (the endpoint's validation, and
that the boards actually read the nickname).
"""

import db
from werkzeug.security import generate_password_hash


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


def _add_user(username, password="testpass1"):
    conn = db.get_db()
    db.create_user(conn, username, generate_password_hash(password))
    uid = db.get_user_by_username(conn, username)["id"]
    conn.close()
    return uid


def _set(client, name):
    return client.post("/api/me/display-name", json={"display_name": name})


class TestSetDisplayName:
    def test_requires_login(self, client):
        assert _set(client, "Kanata").status_code == 401

    def test_sets_and_reports_it(self, client):
        _login(client)
        res = _set(client, "Kanata")
        assert res.status_code == 200
        assert res.get_json()["display_name"] == "Kanata"
        assert client.get("/api/me").get_json()["display_name"] == "Kanata"

    def test_login_still_uses_the_username(self, client):
        _login(client)
        _set(client, "Kanata")
        client.get("/logout")
        assert _login(client, "Kanata").status_code == 200
        # Not logged in — the nickname is not a login credential.
        assert client.get("/api/me").status_code == 401
        assert _login(client, "testuser").status_code == 200
        assert client.get("/api/me").get_json()["username"] == "testuser"

    def test_empty_clears_it(self, client):
        _login(client)
        _set(client, "Kanata")
        res = _set(client, "   ")
        assert res.status_code == 200
        assert res.get_json()["display_name"] is None
        assert res.get_json()["leaderboard_name"] == "testuser"

    def test_trims_whitespace(self, client):
        _login(client)
        assert _set(client, "  Kanata  ").get_json()["display_name"] == "Kanata"

    def test_rejects_too_short_and_too_long(self, client):
        _login(client)
        assert _set(client, "x").status_code == 400
        assert _set(client, "x" * 25).status_code == 400

    def test_rejects_control_characters(self, client):
        """A newline or a bidi override would scramble the board row."""
        _login(client)
        assert _set(client, "Kan\nata").status_code == 400
        assert _set(client, "Kan‮ata").status_code == 400

    def test_rejects_a_name_another_user_took(self, client):
        _add_user("other")
        _login(client, "other")
        assert _set(client, "Kanata").status_code == 200
        client.get("/logout")
        _login(client)
        assert _set(client, "kanata").status_code == 409

    def test_rejects_someone_elses_username(self, client):
        """Otherwise a nickname could impersonate another account."""
        _add_user("other")
        _login(client)
        assert _set(client, "other").status_code == 409

    def test_reclaiming_your_own_username_stores_null(self, client):
        _login(client)
        res = _set(client, "TestUser")
        assert res.status_code == 200
        assert res.get_json()["display_name"] is None

    def test_resetting_your_own_name_is_not_a_collision(self, client):
        _login(client)
        _set(client, "Kanata")
        assert _set(client, "Kanata").status_code == 200


class TestLeaderboardName:
    def test_board_shows_the_nickname(self, client):
        _login(client)
        _set(client, "Kanata")
        client.post("/api/waits/scores",
                    json={"score": 12, "best_combo": 6, "hands_cleared": 8})
        board = client.get("/api/waits/leaderboard").get_json()
        assert board["top"][0]["username"] == "Kanata"
        assert board["you"]["username"] == "Kanata"

    def test_defense_board_shows_the_nickname(self, client):
        _login(client)
        _set(client, "Kanata")
        client.post("/api/defense/scores",
                    json={"score": 12, "best_streak": 4, "steps_cleared": 4})
        board = client.get("/api/defense/leaderboard").get_json()
        assert board["top"][0]["username"] == "Kanata"

    def test_falls_back_to_username(self, client):
        _login(client)
        client.post("/api/waits/scores",
                    json={"score": 12, "best_combo": 6, "hands_cleared": 8})
        assert client.get("/api/waits/leaderboard").get_json()["top"][0]["username"] == "testuser"

    def test_your_own_row_outside_the_top_uses_the_nickname(self, client):
        """`you` comes from a different query than the board rows — pin both."""
        _add_user("rival")
        _login(client, "rival")
        client.post("/api/waits/scores",
                    json={"score": 40, "best_combo": 10, "hands_cleared": 10})
        client.get("/logout")

        _login(client)
        _set(client, "Kanata")
        client.post("/api/waits/scores",
                    json={"score": 1, "best_combo": 0, "hands_cleared": 1})
        board = client.get("/api/waits/leaderboard").get_json()
        you = board["you"]
        assert you["username"] == "Kanata"
        assert you["rank"] == 2
