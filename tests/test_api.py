#!/usr/bin/env python3
"""Tests for API routes: auth, registration, trends, game endpoints.

The `client` fixture itself lives in `tests/conftest.py` so other HTTP-level
test modules (e.g. `test_snapshots.py`) can share it.
"""

import json

import pytest

import db


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


# --- Auth tests ---

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


# --- Registration tests ---

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


# --- API /api/me tests ---

class TestApiMe:
    def test_me_unauthenticated(self, client):
        res = client.get("/api/me")
        assert res.status_code == 401

    def test_me_authenticated(self, client):
        _login(client)
        res = client.get("/api/me")
        assert res.status_code == 200
        data = res.get_json()
        assert data["username"] == "testuser"


# --- Trends tests ---

class TestTrends:
    def test_trends_empty(self, client):
        _login(client)
        res = client.get("/api/trends")
        assert res.status_code == 200
        assert res.get_json() == []

    def test_trends_unauthenticated(self, client):
        res = client.get("/api/trends")
        assert res.status_code == 401


# --- Game endpoints tests ---

class TestGameEndpoints:
    def test_get_nonexistent_game(self, client):
        _login(client)
        res = client.get("/api/games/99999")
        assert res.status_code == 404

    def test_delete_nonexistent_game(self, client):
        _login(client)
        res = client.delete("/api/games/99999")
        assert res.status_code == 404

    def test_games_list_empty(self, client):
        _login(client)
        res = client.get("/api/games")
        assert res.status_code == 200
        assert res.get_json() == []

    def test_add_game_no_data(self, client):
        _login(client)
        res = client.post("/api/games/add", json={})
        assert res.status_code == 400

    def test_health_endpoint(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        assert res.get_json()["status"] == "ok"


# --- Helper to insert a game directly into the DB ---

def _insert_game(user_id, with_mistakes=True):
    """Insert a game directly into the DB and return (game_id, mistake_id or None)."""
    conn = db.get_db()
    game_dict = {
        "date": "2026-01-15",
        "log_url": None,
        "mortal_file": None,
        "summary": {"total_mistakes": 1 if with_mistakes else 0,
                     "total_ev_loss": 0.50 if with_mistakes else 0,
                     "by_severity": {"??": 1} if with_mistakes else {},
                     "by_category": {"1A": {"count": 1, "ev": 0.50}} if with_mistakes else {}},
        "rounds": [{
            "round": "E1",
            "honba": 0,
            "turn_count": 10,
            "decision_count": 8,
            "outcome": None,
            "mistakes": [{
                "turn": 5,
                "ev_loss": 0.50,
                "category": "1A",
                "note": None,
                "hand": ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
                         "1p", "2p", "3p", "4p"],
                "melds": [],
                "shanten": 1,
                "draw": "4m",
                "actual": {"type": "dahai", "pai": "1m"},
                "expected": {"type": "dahai", "pai": "3m"},
                "top_actions": [
                    {"type": "dahai", "pai": "3m", "q_value": 1.0},
                    {"type": "dahai", "pai": "1m", "q_value": 0.5},
                ],
            }] if with_mistakes else [],
        }],
    }
    game_id = db.add_game(conn, user_id, game_dict)
    mistake_id = None
    if with_mistakes:
        row = conn.execute(
            "SELECT id FROM mistakes WHERE game_id = ?", (game_id,)
        ).fetchone()
        mistake_id = row["id"]
    conn.close()
    return game_id, mistake_id


# --- GET /api/games/<id> tests ---

class TestGetGame:
    def test_get_nonexistent_game(self, client):
        _login(client)
        res = client.get("/api/games/99999")
        assert res.status_code == 404
        assert "error" in res.get_json()

    def test_get_valid_game(self, client):
        _login(client)
        # Figure out user id
        me = client.get("/api/me").get_json()
        game_id, _ = _insert_game(me["id"], with_mistakes=True)

        res = client.get(f"/api/games/{game_id}")
        assert res.status_code == 200
        data = res.get_json()
        assert data["id"] == game_id
        assert data["date"] == "2026-01-15"
        assert len(data["rounds"]) == 1
        mistakes = data["rounds"][0]["mistakes"]
        assert len(mistakes) == 1
        assert mistakes[0]["turn"] == 5
        assert mistakes[0]["category"] == "1A"

    def test_get_game_wrong_user(self, client):
        """A user cannot access another user's game."""
        _login(client)
        # Create a second user and insert a game for them
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "otheruser", generate_password_hash("otherpass1"))
        conn.close()
        game_id, _ = _insert_game(uid2)

        res = client.get(f"/api/games/{game_id}")
        assert res.status_code == 404

    def test_get_game_unauthenticated(self, client):
        res = client.get("/api/games/1")
        assert res.status_code == 401


# --- DELETE /api/games/<id> tests ---

class TestDeleteGame:
    def test_delete_own_game(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = _insert_game(me["id"])

        res = client.delete(f"/api/games/{game_id}")
        assert res.status_code == 200
        data = res.get_json()
        assert data["ok"] is True
        assert "remaining" in data

        # Verify it's gone
        res2 = client.get(f"/api/games/{game_id}")
        assert res2.status_code == 404

    def test_delete_other_users_game(self, client):
        """Cannot delete a game belonging to another user."""
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "victim", generate_password_hash("longpassword"))
        conn.close()
        game_id, _ = _insert_game(uid2)

        res = client.delete(f"/api/games/{game_id}")
        assert res.status_code == 404

    def test_delete_nonexistent_game(self, client):
        _login(client)
        res = client.delete("/api/games/99999")
        assert res.status_code == 404

    def test_delete_unauthenticated(self, client):
        res = client.delete("/api/games/1")
        assert res.status_code == 401


# --- GET /api/trends tests ---

class TestTrendsDetailed:
    def test_trends_empty(self, client):
        _login(client)
        res = client.get("/api/trends")
        assert res.status_code == 200
        assert res.get_json() == []

    def test_trends_with_data(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _insert_game(me["id"], with_mistakes=True)

        res = client.get("/api/trends")
        assert res.status_code == 200
        data = res.get_json()
        assert len(data) == 1
        entry = data[0]
        assert "date" in entry
        assert "total_mistakes" in entry
        assert "total_ev_loss" in entry
        assert "by_severity" in entry
        assert "by_category" in entry
        assert "decision_counts" in entry

    def test_trends_multiple_games(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _insert_game(me["id"], with_mistakes=True)
        _insert_game(me["id"], with_mistakes=False)

        res = client.get("/api/trends")
        assert res.status_code == 200
        data = res.get_json()
        assert len(data) == 2

    def test_trends_unauthenticated(self, client):
        res = client.get("/api/trends")
        assert res.status_code == 401


# --- POST /api/mistakes/<id>/report tests ---

class TestCategoryReport:
    def test_report_legacy_agree_rejected(self, client):
        """The legacy 'agree' kind is no longer accepted."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "agree",
        })
        assert res.status_code == 400

    def test_report_valid_wrong_category(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_category",
            "suggested_category": "3A",
            "reason": "This is clearly a push/fold decision",
        })
        assert res.status_code == 200
        assert res.get_json()["ok"] is True

    def test_report_valid_wrong_text(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text",
            "reason": "Explanation reads like it applies to a different hand",
        })
        assert res.status_code == 200
        assert res.get_json()["ok"] is True

    def test_report_missing_kind(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={})
        assert res.status_code == 400
        assert "kind" in res.get_json()["error"]

    def test_report_invalid_kind(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "maybe",
        })
        assert res.status_code == 400

    def test_report_wrong_category_requires_suggestion(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_category",
        })
        assert res.status_code == 400

    def test_report_nonexistent_mistake(self, client):
        _login(client)
        res = client.post("/api/mistakes/99999/report", json={"kind": "wrong_text"})
        assert res.status_code == 404

    def test_report_other_users_mistake(self, client):
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "stranger", generate_password_hash("longpassword"))
        conn.close()
        _, mistake_id = _insert_game(uid2, with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={"kind": "wrong_text"})
        assert res.status_code == 404

    def test_report_reason_too_long(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text",
            "reason": "x" * 501,
        })
        assert res.status_code == 400
        assert "too long" in res.get_json()["error"]

    def test_report_unauthenticated(self, client):
        res = client.post("/api/mistakes/1/report", json={"kind": "wrong_text"})
        assert res.status_code == 401

    def test_report_upsert_replaces_prior(self, client):
        """Re-reporting the same mistake replaces the earlier report."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_category", "suggested_category": "3A",
        })
        client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text", "reason": "changed my mind",
        })

        conn = db.get_db()
        rows = conn.execute(
            "SELECT kind, reason FROM category_reports WHERE mistake_id = ? AND user_id = ?",
            (mistake_id, me["id"])
        ).fetchall()
        conn.close()
        assert len(rows) == 1
        assert rows[0]["kind"] == "wrong_text"
        assert rows[0]["reason"] == "changed my mind"


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


# --- DELETE /api/admin/users/<id> (GDPR wipe) tests ---

class TestAdminDeleteUser:
    @staticmethod
    def _promote(user_id):
        conn = db.get_db()
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()

    @staticmethod
    def _csrf(client):
        return client.get("/api/me").get_json()["csrf_token"]

    def test_delete_unauthenticated(self, client):
        res = client.delete("/api/admin/users/1")
        assert res.status_code == 401

    def test_delete_non_admin_forbidden(self, client):
        _login(client)  # testuser, not admin
        res = client.delete(
            "/api/admin/users/999",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 403

    def test_delete_self_rejected(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])
        res = client.delete(
            f"/api/admin/users/{me['id']}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 400
        assert "own account" in res.get_json()["error"]

    def test_delete_nonexistent(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])
        res = client.delete(
            "/api/admin/users/99999",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 404

    def test_delete_other_admin_allowed_when_not_last(self, client):
        """Deleting an admin is fine as long as another admin remains."""
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])

        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        other_admin = db.create_user(conn, "other_admin", generate_password_hash("longpassword"))
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (other_admin,))
        conn.commit()
        conn.close()

        res = client.delete(
            f"/api/admin/users/{other_admin}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 200

    def test_delete_wipes_all_user_data(self, client):
        """Happy path: admin deletes a user with games, mistakes, and a
        category report — all gone."""
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])

        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        victim = db.create_user(conn, "victim_user", generate_password_hash("longpassword"))
        conn.close()

        game_id, mistake_id = _insert_game(victim, with_mistakes=True)

        conn = db.get_db()
        db.submit_category_report(conn, victim, mistake_id, kind="wrong_text",
                                  suggested_category=None, reason="example")
        conn.commit()
        conn.close()

        res = client.delete(
            f"/api/admin/users/{victim}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["ok"] is True
        assert data["username"] == "victim_user"
        d = data["deleted"]
        assert d["users"] == 1
        assert d["games"] == 1
        assert d["mistakes"] == 1
        assert d["category_reports"] == 1

        # Verify everything is actually gone.
        conn = db.get_db()
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (victim,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM games WHERE user_id = ?", (victim,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM mistakes WHERE id = ?", (mistake_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM category_reports WHERE user_id = ?", (victim,)).fetchone()[0] == 0
        # The admin (testuser) is untouched.
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (me["id"],)).fetchone()[0] == 1
        conn.close()

    def test_delete_blocked_while_impersonating(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])

        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        target = db.create_user(conn, "imp_target", generate_password_hash("longpassword"))
        victim = db.create_user(conn, "imp_victim", generate_password_hash("longpassword"))
        conn.close()

        # Begin impersonation.
        res = client.post(
            f"/api/admin/impersonate/{target}",
            headers={"X-CSRFToken": self._csrf(client)},
            json={},
        )
        assert res.status_code == 200

        # Now any delete attempt should be 409.
        res = client.delete(
            f"/api/admin/users/{victim}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 409
        assert "impersonating" in res.get_json()["error"].lower()
