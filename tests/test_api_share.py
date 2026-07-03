#!/usr/bin/env python3
"""Tests for the public game-sharing surface: /api/games/<id>/share-token
(get-or-create / regenerate / revoke, all owner-only) and the unauthenticated
/api/shared/<token> read.
"""

from werkzeug.security import generate_password_hash

import db
from tests.conftest import insert_game


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


def _other_user(username="otheruser"):
    conn = db.get_db()
    uid = db.create_user(conn, username, generate_password_hash("otherpass1"))
    conn.close()
    return uid


class TestGetShareToken:
    def test_unauthenticated(self, client):
        res = client.get("/api/games/1/share-token")
        assert res.status_code == 401

    def test_creates_and_is_idempotent(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"])

        res1 = client.get(f"/api/games/{game_id}/share-token")
        assert res1.status_code == 200
        body1 = res1.get_json()
        assert body1["share_token"]
        assert body1["share_url"].endswith(f"/shared/{body1['share_token']}")

        res2 = client.get(f"/api/games/{game_id}/share-token")
        assert res2.get_json()["share_token"] == body1["share_token"]

    def test_wrong_user(self, client):
        _login(client)
        uid2 = _other_user()
        game_id, _ = insert_game(uid2)

        res = client.get(f"/api/games/{game_id}/share-token")
        assert res.status_code == 404

    def test_nonexistent_game(self, client):
        _login(client)
        res = client.get("/api/games/99999/share-token")
        assert res.status_code == 404


class TestRegenerateShareToken:
    def test_rotates_token_and_invalidates_old(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"])
        old_token = client.get(f"/api/games/{game_id}/share-token").get_json()["share_token"]

        res = client.post(f"/api/games/{game_id}/share-token/regenerate")
        assert res.status_code == 200
        new_token = res.get_json()["share_token"]
        assert new_token != old_token

        assert client.get(f"/api/shared/{old_token}").status_code == 404
        assert client.get(f"/api/shared/{new_token}").status_code == 200

    def test_wrong_user(self, client):
        _login(client)
        uid2 = _other_user()
        game_id, _ = insert_game(uid2)
        res = client.post(f"/api/games/{game_id}/share-token/regenerate")
        assert res.status_code == 404


class TestRevokeShareToken:
    def test_revoke_disables_link(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"])
        token = client.get(f"/api/games/{game_id}/share-token").get_json()["share_token"]

        res = client.delete(f"/api/games/{game_id}/share-token")
        assert res.status_code == 200
        assert res.get_json()["ok"] is True

        assert client.get(f"/api/shared/{token}").status_code == 404

    def test_wrong_user(self, client):
        _login(client)
        uid2 = _other_user()
        game_id, _ = insert_game(uid2)
        res = client.delete(f"/api/games/{game_id}/share-token")
        assert res.status_code == 404


class TestPublicSharedGame:
    def test_no_login_required(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"], with_mistakes=True)
        token = client.get(f"/api/games/{game_id}/share-token").get_json()["share_token"]

        # Fresh, logged-out client hitting the same Flask app/db.
        client.delete_cookie("session")
        res = client.get(f"/api/shared/{token}")
        assert res.status_code == 200
        data = res.get_json()
        assert data["id"] == game_id
        assert "mortal_data" in data

    def test_strips_private_note(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, mistake_id = insert_game(me["id"], with_mistakes=True)
        # Set a private note on the mistake the way the annotate endpoint would.
        conn = db.get_db()
        conn.execute("UPDATE mistakes SET note = ? WHERE id = ?", ("private note", mistake_id))
        conn.commit()
        conn.close()

        token = client.get(f"/api/games/{game_id}/share-token").get_json()["share_token"]
        res = client.get(f"/api/shared/{token}")
        mistakes = res.get_json()["rounds"][0]["mistakes"]
        assert mistakes[0].get("note") is None

    def test_bad_token(self, client):
        res = client.get("/api/shared/not-a-real-token")
        assert res.status_code == 404


class TestDemoRedirect:
    def test_disabled_without_env(self, client):
        res = client.get("/demo")
        assert res.status_code == 404

    def test_redirects_to_share_link(self, client, monkeypatch):
        _login(client)
        me = client.get("/api/me").get_json()
        game_id, _ = insert_game(me["id"])

        import app as app_module
        app_module.app.config["DEMO_GAME_ID"] = game_id

        res = client.get("/demo")
        assert res.status_code == 302
        assert res.headers["Location"].startswith(f"/shared/")
