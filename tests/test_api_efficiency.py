#!/usr/bin/env python3
"""Tests for the Efficiency Trainer minigame API (/api/efficiency/*).

Covers the self-reported-score gate in `routes/efficiency.py`, the shape of
the leaderboard, and that the board is per-player-best (not per-run).
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


def _submit(client, score, best_streak, hands_cleared):
    return client.post("/api/efficiency/scores", json={
        "score": score,
        "best_streak": best_streak,
        "hands_cleared": hands_cleared,
    })


class TestSubmitScore:
    def test_requires_login(self, client):
        """Playing needs no account; putting a run on the board does."""
        assert _submit(client, 25, 3, 4).status_code == 401

    def test_records_a_run(self, client):
        _login(client)
        res = _submit(client, 60, 3, 4)
        assert res.status_code == 200
        body = res.get_json()
        assert body["recorded"] is True
        assert body["leaderboard"]["top"][0]["score"] == 60
        assert body["leaderboard"]["top"][0]["is_you"] is True

    def test_scoreless_run_is_accepted_but_not_stored(self, client):
        """A 0-point run is legitimate — it just doesn't belong on the board."""
        _login(client)
        res = _submit(client, 0, 0, 0)
        assert res.status_code == 200
        assert res.get_json()["recorded"] is False
        assert res.get_json()["leaderboard"]["top"] == []

    def test_rejects_score_above_the_richest_possible_hand(self, client):
        # A hand tops out at 45 (3-shanten cleared in three shots).
        _login(client)
        assert _submit(client, 46, 1, 1).status_code == 400
        assert _submit(client, 45, 1, 1).status_code == 200

    def test_rejects_score_below_the_cheapest_possible_hand(self, client):
        # Every cleared hand is worth at least 5.
        _login(client)
        assert _submit(client, 14, 0, 3).status_code == 400
        assert _submit(client, 15, 0, 3).status_code == 200

    def test_rejects_streak_above_hands_cleared(self, client):
        _login(client)
        assert _submit(client, 40, 5, 4).status_code == 400

    def test_rejects_negative_and_non_integer(self, client):
        _login(client)
        assert _submit(client, -5, 0, 0).status_code == 400
        assert _submit(client, "lots", 1, 1).status_code == 400


class TestLeaderboard:
    def test_keeps_only_each_players_best_run(self, client):
        _login(client)
        _submit(client, 30, 2, 3)
        _submit(client, 120, 7, 9)
        _submit(client, 55, 3, 5)

        board = client.get("/api/efficiency/leaderboard").get_json()
        assert len(board["top"]) == 1          # three runs, one player
        assert board["top"][0]["score"] == 120
        assert board["top"][0]["runs"] == 3
        assert board["players"] == 1
        # The bare columns must describe the winning run, not another one.
        assert board["top"][0]["best_streak"] == 7
        assert board["top"][0]["hands_cleared"] == 9

    def test_ranks_players_and_flags_you(self, client):
        _add_user("rival")
        _login(client, "rival")
        _submit(client, 300, 12, 20)
        client.get("/logout")

        _login(client)
        _submit(client, 60, 3, 4)

        board = client.get("/api/efficiency/leaderboard").get_json()
        assert [r["username"] for r in board["top"]] == ["rival", "testuser"]
        assert [r["rank"] for r in board["top"]] == [1, 2]
        assert [r["is_you"] for r in board["top"]] == [False, True]
        assert board["players"] == 2
        assert board["you"]["score"] == 60
        assert board["you"]["rank"] == 2

    def test_you_is_reported_from_outside_the_top_slice(self, client):
        """A player below the cut still gets their own rank back."""
        for i in range(11):
            name = f"player{i}"
            _add_user(name)
            _login(client, name)
            _submit(client, 500 - i, 10, 40)
            client.get("/logout")

        _login(client)
        _submit(client, 5, 1, 1)
        board = client.get("/api/efficiency/leaderboard").get_json()

        assert len(board["top"]) == 10                    # LEADERBOARD_LIMIT
        assert all(not r["is_you"] for r in board["top"])
        assert board["you"]["rank"] == 12
        assert board["you"]["score"] == 5
        assert board["you"]["username"] == "testuser"

    def test_is_public_so_guests_see_what_they_are_playing_for(self, client):
        """The minigame is playable logged-out (/play), so the board is too."""
        _login(client)
        _submit(client, 60, 3, 4)
        client.get("/logout")

        res = client.get("/api/efficiency/leaderboard")
        assert res.status_code == 200
        board = res.get_json()
        assert [r["username"] for r in board["top"]] == ["testuser"]
        assert all(not r["is_you"] for r in board["top"])
        assert board["you"] is None
        assert board["players"] == 1

    def test_never_played_has_no_you_row(self, client):
        _login(client)
        board = client.get("/api/efficiency/leaderboard").get_json()
        assert board["top"] == []
        assert board["you"] is None
        assert board["players"] == 0
