#!/usr/bin/env python3
"""Tests for game-related API surface: /api/me, /api/games (list / get / add /
delete), /api/trends, /api/trends/snapshot[s], /api/categories, and the
annotate endpoint.

Auth tests live in test_api_auth.py; category-report and admin tests live in
test_api_reports.py. Shared `client` and `insert_game` come from conftest.py.
"""

import json
import os

import pytest

import db
from tests.conftest import insert_game


FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
SMALL_MORTAL_FILE = os.path.join(FIXTURES_DIR, "game_short.json")


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


# --- /api/me ---

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


# --- /api/categories (retired in CORE Phase 3) ---

class TestCategoriesApi:
    def test_categories_api_removed(self, client):
        # The category-code registry + its endpoint were deleted; a mistake is
        # now {skillArea, shape, wins}, computed client-side.
        _login(client)
        res = client.get("/api/categories")
        assert res.status_code == 404


# --- /api/trends (basic + with data + multiple games) ---

class TestTrends:
    def test_trends_empty(self, client):
        _login(client)
        res = client.get("/api/trends")
        assert res.status_code == 200
        assert res.get_json() == []

    def test_trends_unauthenticated(self, client):
        res = client.get("/api/trends")
        assert res.status_code == 401

    def test_trends_with_data(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        insert_game(me["id"], with_mistakes=True)

        res = client.get("/api/trends")
        assert res.status_code == 200
        data = res.get_json()
        assert len(data) == 1
        entry = data[0]
        assert "date" in entry
        assert "total_mistakes" in entry
        assert "total_ev_loss" in entry
        assert "by_severity" in entry
        assert "by_category" not in entry
        assert "decision_counts" in entry

    def test_trends_multiple_games(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        insert_game(me["id"], with_mistakes=True)
        insert_game(me["id"], with_mistakes=False)

        res = client.get("/api/trends")
        assert res.status_code == 200
        data = res.get_json()
        assert len(data) == 2


# --- /api/games (list + get + add no-data + health) ---

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


# --- GET /api/games/<id> ---

class TestGetGame:
    def test_get_nonexistent_game(self, client):
        _login(client)
        res = client.get("/api/games/99999")
        assert res.status_code == 404
        assert "error" in res.get_json()

    def test_get_valid_game(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"], with_mistakes=True)

        res = client.get(f"/api/games/{game_id}")
        assert res.status_code == 200
        data = res.get_json()
        assert data["id"] == game_id
        assert data["date"] == "2026-01-15"
        assert len(data["rounds"]) == 1
        mistakes = data["rounds"][0]["mistakes"]
        assert len(mistakes) == 1
        assert mistakes[0]["turn"] == 5
        assert mistakes[0]["ev_loss"] == 0.50

    def test_get_game_wrong_user(self, client):
        """A user cannot access another user's game."""
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "otheruser", generate_password_hash("otherpass1"))
        conn.close()
        game_id, _ = insert_game(uid2)

        res = client.get(f"/api/games/{game_id}")
        assert res.status_code == 404

    def test_get_game_unauthenticated(self, client):
        res = client.get("/api/games/1")
        assert res.status_code == 401


# --- GET /api/games/<id>/mortal ---

class TestGameMortal:
    def test_mortal_unauthenticated(self, client):
        res = client.get("/api/games/1/mortal")
        assert res.status_code == 401

    def test_mortal_nonexistent_game(self, client):
        _login(client)
        res = client.get("/api/games/99999/mortal")
        assert res.status_code == 404

    def test_mortal_no_file(self, client):
        """Games without a mortal_file (legacy/fixture inserts) 404."""
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"])
        res = client.get(f"/api/games/{game_id}/mortal")
        assert res.status_code == 404

    def test_mortal_wrong_user(self, client):
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "otheruser", generate_password_hash("otherpass1"))
        conn.close()
        game_id, _ = insert_game(uid2)
        res = client.get(f"/api/games/{game_id}/mortal")
        assert res.status_code == 404

    def test_mortal_roundtrip_cacheable(self, client):
        """Upload a real game, then: /api/games/<id> no longer inlines
        mortal_data, the /mortal endpoint serves the slim copy with
        immutable cache headers, and revalidation answers 304."""
        _login(client)
        with open(SMALL_MORTAL_FILE) as f:
            mortal_json = json.load(f)
        add = client.post("/api/games/add", json={"mortal_data": mortal_json})
        assert add.status_code == 200
        game_id = add.get_json()["game_id"]

        game = client.get(f"/api/games/{game_id}").get_json()
        assert "mortal_data" not in game

        res = client.get(f"/api/games/{game_id}/mortal")
        assert res.status_code == 200
        md = res.get_json()
        assert "mjai_log" in md
        assert "player_id" in md
        assert "immutable" in res.headers["Cache-Control"]
        assert res.headers["Vary"] == "Cookie"
        etag = res.headers["ETag"]
        assert etag

        res304 = client.get(f"/api/games/{game_id}/mortal",
                            headers={"If-None-Match": etag})
        assert res304.status_code == 304


# --- DELETE /api/games/<id> ---

class TestDeleteGame:
    def test_delete_own_game(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"])

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
        game_id, _ = insert_game(uid2)

        res = client.delete(f"/api/games/{game_id}")
        assert res.status_code == 404

    def test_delete_nonexistent_game(self, client):
        _login(client)
        res = client.delete("/api/games/99999")
        assert res.status_code == 404

    def test_delete_unauthenticated(self, client):
        res = client.delete("/api/games/1")
        assert res.status_code == 401


# --- /api/games/<id>/annotate ---

class TestAnnotateValidation:
    def test_annotate_validation(self, client):
        """Input validation on annotate endpoint."""
        _login(client)
        # Missing required fields
        res = client.post("/api/games/1/annotate", json={})
        assert res.status_code == 400
        # Wrong-typed note still fails validation before the lookup
        res = client.post("/api/games/1/annotate", json={
            "round": "E1", "turn": 1, "note": 42,
        })
        assert res.status_code == 400


# --- /api/trends/snapshot[s] ---

class TestTrendsSnapshots:
    def test_trends_snapshots_empty(self, client):
        _login(client)
        res = client.get("/api/trends/snapshots")
        assert res.status_code == 200
        assert res.get_json() == []

    def test_trends_snapshot_post_requires_owned_games(self, client):
        """game_ids that don't belong to the user are silently filtered;
        if none remain we 400 rather than persist an empty snapshot."""
        _login(client)
        res = client.post("/api/trends/snapshot", json={
            "categorizer_version": 1,
            "game_ids": [9999],
            "by_category": {},
            "decision_counts": {"attack": 10},
        })
        assert res.status_code == 400

    def test_trends_snapshot_validation(self, client):
        _login(client)
        # Missing version
        res = client.post("/api/trends/snapshot", json={"game_ids": [1]})
        assert res.status_code == 400
        # Bad version type
        res = client.post("/api/trends/snapshot", json={
            "categorizer_version": "1", "game_ids": [1],
        })
        assert res.status_code == 400
        # Empty game_ids
        res = client.post("/api/trends/snapshot", json={
            "categorizer_version": 1, "game_ids": [],
        })
        assert res.status_code == 400


# --- Add-game pipeline (upload → fetch → delete → trends) ---
#
# Round-trips through the HTTP + DB layer using the real upload route.
# test_snapshots.py covers the upload→fetch shape; we pin the bits unique
# to this layer here.

class TestAddGamePipeline:
    @pytest.fixture(autouse=True)
    def _login(self, client):
        client.post("/login",
                    data={"username": "testuser", "password": "testpass1"},
                    follow_redirects=True)

    @pytest.fixture
    def mortal_json(self):
        with open(SMALL_MORTAL_FILE) as f:
            return json.load(f)

    def _add_game(self, client, mortal_json):
        res = client.post("/api/games/add", json={"mortal_data": mortal_json},
                          content_type="application/json")
        assert res.status_code == 200, f"Status {res.status_code}: {res.data[:200]}"
        return res.get_json()

    def test_add_game_marks_done(self, client, mortal_json):
        """JS prep is authoritative now — newly-added games skip the
        backend prep thread and ship with categorization_status='done'
        so the frontend doesn't sit on a stale banner."""
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]

        conn = db.get_db()
        row = conn.execute(
            "SELECT categorization_status FROM games WHERE id = ?", (game_id,),
        ).fetchone()
        assert row and row["categorization_status"] == "done"

    def test_delete_game(self, client, mortal_json):
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]
        assert client.delete(f"/api/games/{game_id}").status_code == 200
        assert client.get(f"/api/games/{game_id}").status_code == 404

    def test_trends_after_add(self, client, mortal_json):
        self._add_game(client, mortal_json)
        res = client.get("/api/trends")
        assert res.status_code == 200
        trends = res.get_json()
        assert len(trends) > 0
        assert "date" in trends[0]
        assert "total_ev_loss" in trends[0]
