#!/usr/bin/env python3
"""Tests for API routes: auth, registration, practice, trends, game endpoints.

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


# --- Practice endpoint tests ---

class TestPractice:
    def test_practice_no_problems(self, client):
        _login(client)
        res = client.get("/api/practice")
        assert res.status_code in (200, 404)  # 404 when no eligible problems

    def test_practice_stats_empty(self, client):
        _login(client)
        res = client.get("/api/practice/stats")
        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, dict)

    def test_practice_result_invalid_id(self, client):
        _login(client)
        res = client.post("/api/practice/result", json={
            "mistake_id": "not-an-int",
            "correct": True,
        })
        assert res.status_code == 400

    def test_practice_result_nonexistent_mistake(self, client):
        _login(client)
        res = client.post("/api/practice/result", json={
            "mistake_id": 99999,
            "correct": True,
        })
        # Should fail ownership check
        assert res.status_code in (400, 403, 404)

    def test_practice_unauthenticated(self, client):
        res = client.get("/api/practice")
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
                "severity": "??",
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


# --- GET /api/practice tests ---

class TestPracticeDetailed:
    def test_practice_empty_no_problems(self, client):
        _login(client)
        res = client.get("/api/practice")
        assert res.status_code == 404
        assert "error" in res.get_json()

    def test_practice_unauthenticated(self, client):
        res = client.get("/api/practice")
        assert res.status_code == 401

    def test_practice_with_eligible_problem(self, client):
        """Practice should return a problem when eligible mistakes exist."""
        _login(client)
        me = client.get("/api/me").get_json()
        _insert_game(me["id"], with_mistakes=True)

        res = client.get("/api/practice")
        assert res.status_code == 200
        data = res.get_json()
        assert "mistake_id" in data
        assert "mistake" in data
        assert "game_id" in data

    def test_practice_with_severity_filter(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _insert_game(me["id"], with_mistakes=True)

        # The inserted mistake has severity "??" so filtering by "???" should yield nothing
        res = client.get("/api/practice?severity=???")
        # Could be 404 (no match) or 200 depending on data
        assert res.status_code in (200, 404)


# --- POST /api/practice/result tests ---

class TestPracticeResult:
    def test_result_missing_body(self, client):
        _login(client)
        res = client.post("/api/practice/result",
                          data="not json",
                          content_type="text/plain")
        # Non-JSON content type triggers 500 via generic error handler
        assert res.status_code in (400, 415, 500)

    def test_result_invalid_mistake_id_type(self, client):
        _login(client)
        res = client.post("/api/practice/result", json={
            "mistake_id": "abc",
            "correct": True,
        })
        assert res.status_code == 400
        assert "mistake_id" in res.get_json()["error"]

    def test_result_nonexistent_mistake(self, client):
        _login(client)
        res = client.post("/api/practice/result", json={
            "mistake_id": 99999,
            "correct": True,
        })
        assert res.status_code == 404

    def test_result_wrong_user_mistake(self, client):
        """Cannot record result for another user's mistake."""
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "other2", generate_password_hash("longpassword"))
        conn.close()
        _, mistake_id = _insert_game(uid2, with_mistakes=True)

        res = client.post("/api/practice/result", json={
            "mistake_id": mistake_id,
            "correct": True,
        })
        assert res.status_code == 404

    def test_result_valid(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post("/api/practice/result", json={
            "mistake_id": mistake_id,
            "correct": True,
        })
        assert res.status_code == 200
        assert res.get_json()["ok"] is True

    def test_result_unauthenticated(self, client):
        res = client.post("/api/practice/result", json={
            "mistake_id": 1, "correct": True,
        })
        assert res.status_code == 401


# --- GET /api/practice/stats tests ---

class TestPracticeStats:
    def test_stats_empty(self, client):
        _login(client)
        res = client.get("/api/practice/stats")
        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, dict)
        assert len(data) == 0  # no practice results yet

    def test_stats_after_practice(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        # Record a practice result
        client.post("/api/practice/result", json={
            "mistake_id": mistake_id,
            "correct": True,
        })

        res = client.get("/api/practice/stats")
        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, dict)
        assert len(data) > 0
        # Should have stats grouped by category group
        for group_name, stats in data.items():
            assert "correct" in stats
            assert "total" in stats

    def test_stats_unauthenticated(self, client):
        res = client.get("/api/practice/stats")
        assert res.status_code == 401


# --- POST /api/mistakes/<id>/report tests ---

class TestCategoryReport:
    def test_report_valid_agree(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "agree",
        })
        assert res.status_code == 200
        data = res.get_json()
        assert data["ok"] is True
        assert "id" in data

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
        res = client.post("/api/mistakes/99999/report", json={"kind": "agree"})
        assert res.status_code == 404

    def test_report_other_users_mistake(self, client):
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "stranger", generate_password_hash("longpassword"))
        conn.close()
        _, mistake_id = _insert_game(uid2, with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={"kind": "agree"})
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
        res = client.post("/api/mistakes/1/report", json={"kind": "agree"})
        assert res.status_code == 401

    def test_report_upsert_replaces_prior(self, client):
        """Re-reporting the same mistake replaces the earlier report."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = _insert_game(me["id"], with_mistakes=True)

        client.post(f"/api/mistakes/{mistake_id}/report", json={"kind": "agree"})
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
