#!/usr/bin/env python3
"""Tests for db.py basics: schema init, user create/lookup, game add/get/
delete, list_games.

Advanced surface (trends, summary, annotation, category reports, snapshots,
OAuth) lives in test_db_advanced.py.
"""

import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from werkzeug.security import generate_password_hash as _gen_pw_hash
except ImportError:
    def _gen_pw_hash(pw):
        return f"fakehash:{pw}"

import db
from tests.fixtures import make_game, make_mistake, make_round


@pytest.fixture
def tmp_db():
    """Create a temporary SQLite database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = db.get_db(db_path=path)
    db.init_db(conn)
    yield conn
    conn.close()
    os.unlink(path)


@pytest.fixture
def sample_user(tmp_db):
    """Create a test user and return (conn, user_id)."""
    uid = db.create_user(tmp_db, "testuser", _gen_pw_hash("testpass"))
    return tmp_db, uid


class TestDatabaseCore:
    def test_init_db(self, tmp_db):
        tables = tmp_db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {r["name"] for r in tables}
        assert "users" in table_names
        assert "games" in table_names
        assert "mistakes" in table_names

    def test_create_user(self, tmp_db):
        uid = db.create_user(tmp_db, "alice", _gen_pw_hash("pw"))
        assert uid is not None
        user = db.get_user_by_username(tmp_db, "alice")
        assert user is not None
        assert user["username"] == "alice"

    def test_add_and_get_game(self, sample_user):
        conn, uid = sample_user
        game_dict = make_game(
            date="2026-01-01",
            log_url=None,
            mortal_file=None,
            summary={"total_mistakes": 1, "total_ev_loss": 0.5},
            mistakes=[make_mistake(hand=["1m", "2m", "3m"], top_actions=[])],
        )
        gid = db.add_game(conn, uid, game_dict)
        assert gid is not None

        game = db.get_game(conn, gid, user_id=uid)
        assert game is not None
        assert game["date"] == "2026-01-01"
        assert len(game["rounds"]) == 1
        assert len(game["rounds"][0]["mistakes"]) == 1
        assert game["rounds"][0]["mistakes"][0]["turn"] == 5

    def test_delete_game(self, sample_user):
        conn, uid = sample_user
        game_dict = make_game(date="2026-01-01",
                              rounds=[make_round(turn_count=5, mistakes=[])])
        gid = db.add_game(conn, uid, game_dict)
        assert db.delete_game(conn, gid, user_id=uid) is True
        assert db.get_game(conn, gid, user_id=uid) is None

    def test_list_games(self, sample_user):
        conn, uid = sample_user
        for i in range(3):
            db.add_game(conn, uid, make_game(
                date=f"2026-01-0{i+1}",
                rounds=[make_round(turn_count=5, mistakes=[])],
            ))
        games = db.list_games(conn, uid)
        assert len(games) == 3
