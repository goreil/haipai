#!/usr/bin/env python3
"""Tests for core functionality: parsing, categorization, database, and API routes."""

import json
import os
import sys
import tempfile

import pytest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from werkzeug.security import generate_password_hash as _gen_pw_hash
except ImportError:
    def _gen_pw_hash(pw):
        return f"fakehash:{pw}"

import db
from lib.parse import flatten_mjai_log, parse_game, round_header, severity
from lib.tiles import MJAI_TO_ID, ID_TO_MJAI, mjai_to_tile_id, tile_id_to_base
from lib.board import (
    extract_board_state, reconstruct_context, subtract_hand_from_wall,
)


# --- Fixtures ---

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


FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


@pytest.fixture
def mortal_data():
    """Load a sample Mortal analysis JSON (multi-kyoku, has riichi + multiple mistake types)."""
    path = os.path.join(FIXTURES_DIR, "game_multi_mistake.json")
    with open(path) as f:
        return json.load(f)


# --- mj_parse tests ---

class TestParsing:
    def test_severity_levels(self):
        assert severity(0.01) == "?"
        assert severity(0.49) == "?"
        assert severity(0.50) == "??"
        assert severity(1.00) == "??"
        assert severity(1.01) == "???"

    def test_round_header(self):
        assert round_header({"bakaze": "E", "kyoku": 1, "honba": 0}) == "E1"
        assert round_header({"bakaze": "S", "kyoku": 3, "honba": 2}) == "S3-2"

    def test_parse_game_structure(self, mortal_data):
        game = parse_game(mortal_data, game_date="2026-01-01")
        assert game["date"] == "2026-01-01"
        assert isinstance(game["rounds"], list)
        assert len(game["rounds"]) > 0

        rnd = game["rounds"][0]
        assert "round" in rnd
        assert isinstance(rnd["mistakes"], list)

    def test_parse_game_mistakes(self, mortal_data):
        game = parse_game(mortal_data, game_date="2026-01-01")
        # Find a round with mistakes
        mistakes = [m for rnd in game["rounds"] for m in rnd["mistakes"]]
        assert len(mistakes) > 0

        m = mistakes[0]
        assert "turn" in m
        assert "severity" in m
        assert "ev_loss" in m
        assert "hand" in m
        assert isinstance(m["hand"], list)
        assert "actual" in m
        assert "expected" in m
        assert "top_actions" in m


# --- mj_categorize tests ---

class TestTileConversion:
    def test_mjai_to_id_basic(self):
        assert mjai_to_tile_id("1m") == 0
        assert mjai_to_tile_id("9s") == 26
        assert mjai_to_tile_id("E") == 27
        assert mjai_to_tile_id("C") == 33
        assert mjai_to_tile_id("5mr") == 34

    def test_id_to_mjai_roundtrip(self):
        for mjai, tid in MJAI_TO_ID.items():
            assert ID_TO_MJAI[tid] == mjai

    def test_tile_id_to_base(self):
        assert tile_id_to_base(4) == 4   # 5m base
        assert tile_id_to_base(34) == 4  # 5mr -> 5m
        assert tile_id_to_base(35) == 13  # 5pr -> 5p
        assert tile_id_to_base(36) == 22  # 5sr -> 5s
        assert tile_id_to_base(27) == 27  # E stays E


class TestBoardState:
    def test_extract_board_state(self, mortal_data):
        kyokus = mortal_data["review"]["kyokus"]
        entry = next(e for e in kyokus[0]["entries"] if not e["is_equal"])

        board = extract_board_state(mortal_data, 0, entry["tiles_left"])
        assert "dora_indicators" in board
        assert isinstance(board["dora_indicators"], list)
        assert len(board["dora_indicators"]) >= 1

        assert board["seat_wind"] in ("E", "S", "W", "N")
        assert board["round_wind"] in ("E", "S")

        assert isinstance(board["scores"], list)
        assert len(board["scores"]) == 4

        assert isinstance(board["all_discards"], list)
        assert len(board["all_discards"]) == 4
        for d in board["all_discards"]:
            assert "seat" in d
            assert "discards" in d
            assert "riichi_idx" in d

        # tiles_left is the canonical wall-position. extract_board_state
        # walks until tiles_left <= target, so the post-walk value matches
        # the caller's request when the kyoku hasn't already ended.
        assert board["tiles_left"] == entry["tiles_left"]

    def test_board_state_late_game(self, mortal_data):
        """Board state with more events should have more discards."""
        kyokus = mortal_data["review"]["kyokus"]
        for ki in range(len(kyokus)):
            for entry in kyokus[ki]["entries"]:
                if not entry["is_equal"] and entry["tiles_left"] < 50:
                    board = extract_board_state(mortal_data, ki, entry["tiles_left"])
                    total_discards = sum(len(d["discards"]) for d in board["all_discards"])
                    assert total_discards > 0
                    return
        pytest.skip("No late-game mistakes found")


# --- db tests ---

class TestDatabase:
    def test_init_db(self, tmp_db):
        tables = tmp_db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {r["name"] for r in tables}
        assert "users" in table_names
        assert "games" in table_names
        assert "mistakes" in table_names
        assert "feedback" in table_names

    def test_create_user(self, tmp_db):
        uid = db.create_user(tmp_db, "alice", _gen_pw_hash("pw"))
        assert uid is not None
        user = db.get_user_by_username(tmp_db, "alice")
        assert user is not None
        assert user["username"] == "alice"

    def test_add_and_get_game(self, sample_user):
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-01",
            "log_url": None,
            "mortal_file": None,
            "summary": {"total_mistakes": 1, "total_ev_loss": 0.5},
            "rounds": [{
                "round": "E1",
                "honba": 0,
                "turn_count": 10,
                "outcome": None,
                "mistakes": [{
                    "turn": 5,
                    "severity": "??",
                    "ev_loss": 0.50,
                    "category": "1A",
                    "note": None,
                    "hand": ["1m", "2m", "3m"],
                    "melds": [],
                    "shanten": 1,
                    "draw": "4m",
                    "actual": {"type": "dahai", "pai": "1m"},
                    "expected": {"type": "dahai", "pai": "3m"},
                    "top_actions": [],
                }],
            }],
        }
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
        game_dict = {
            "date": "2026-01-01",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 5,
                         "outcome": None, "mistakes": []}],
        }
        gid = db.add_game(conn, uid, game_dict)
        assert db.delete_game(conn, gid, user_id=uid) is True
        assert db.get_game(conn, gid, user_id=uid) is None

    def test_update_mistake_data(self, sample_user):
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-01",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10,
                         "outcome": None, "mistakes": [{
                "turn": 3, "severity": "?", "ev_loss": 0.05,
                "category": None, "note": None,
                "hand": ["1m"], "melds": [], "actual": {"type": "dahai", "pai": "1m"},
                "expected": {"type": "dahai", "pai": "2m"}, "top_actions": [],
            }]}],
        }
        gid = db.add_game(conn, uid, game_dict)
        mid = conn.execute("SELECT id FROM mistakes WHERE game_id = ?", (gid,)).fetchone()["id"]

        db.update_mistake_data(conn, mid, {"category": "1A", "best_discard": "2m"})

        row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
        assert row["category"] == "1A"
        data = json.loads(row["data_json"])
        assert data["best_discard"] == "2m"

    def test_list_games(self, sample_user):
        conn, uid = sample_user
        for i in range(3):
            db.add_game(conn, uid, {
                "date": f"2026-01-0{i+1}",
                "rounds": [{"round": "E1", "honba": 0, "turn_count": 5,
                             "outcome": None, "mistakes": []}],
            })
        games = db.list_games(conn, uid)
        assert len(games) == 3

    def test_feedback_insertion(self, sample_user):
        conn, uid = sample_user
        conn.execute(
            "INSERT INTO feedback (user_id, type, message) VALUES (?, ?, ?)",
            (uid, "bug", "Something is broken"),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM feedback WHERE user_id = ?", (uid,)).fetchone()
        assert row["type"] == "bug"
        assert row["message"] == "Something is broken"

    # --- Helper to insert a game with a discard mistake ---

    def _add_game_with_mistake(self, conn, uid):
        """Insert a game with a '??' severity discard-vs-discard mistake."""
        game_dict = {
            "date": "2026-01-15",
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
                    "hand": ["1m", "2m", "3m", "5m", "6m", "7m", "1p", "2p", "3p", "5s", "6s", "7s", "9s"],
                    "melds": [],
                    "shanten": 0,
                    "draw": "4m",
                    "actual": {"type": "dahai", "pai": "9s"},
                    "expected": {"type": "dahai", "pai": "5m"},
                    "top_actions": [
                        {"action": "dahai 5m", "q_value": 1.0},
                        {"action": "dahai 9s", "q_value": 0.5},
                    ],
                }],
            }],
        }
        gid = db.add_game(conn, uid, game_dict)
        mid = conn.execute("SELECT id FROM mistakes WHERE game_id = ?", (gid,)).fetchone()["id"]
        return gid, mid

    # --- get_trends tests ---

    def test_get_trends_empty(self, sample_user):
        """get_trends returns empty list when user has no games."""
        conn, uid = sample_user
        trends = db.get_trends(conn, uid)
        assert trends == []

    def test_get_trends_with_data(self, sample_user):
        """get_trends returns per-game trend data with stats."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-15",
            "summary": {
                "total_mistakes": 2,
                "total_ev_loss": 1.5,
                "total_decisions": 20,
                "ev_per_decision": 0.075,
                "by_severity": {"??": 1, "???": 1},
                "by_category": {"1A": {"count": 1, "ev": 0.5}, "3A": {"count": 1, "ev": 1.0}},
            },
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10, "outcome": None, "mistakes": []}],
        }
        db.add_game(conn, uid, game_dict)

        trends = db.get_trends(conn, uid)
        assert len(trends) == 1
        t = trends[0]
        assert t["date"] == "2026-01-15"
        assert t["total_mistakes"] == 2
        assert t["total_ev_loss"] == 1.5
        assert t["total_decisions"] == 20
        assert t["ev_per_decision"] == 0.075
        assert t["by_severity"] == {"??": 1, "???": 1}
        assert t["by_category"] == {"1A": {"count": 1, "ev": 0.5}, "3A": {"count": 1, "ev": 1.0}}

    # --- compute_summary_for_game tests ---

    def test_compute_summary_for_game(self, sample_user):
        """compute_summary_for_game recomputes stats from mistake rows."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-20",
            "rounds": [{
                "round": "E1", "honba": 0, "turn_count": 15, "decision_count": 12, "outcome": None,
                "mistakes": [
                    {"turn": 3, "severity": "?", "ev_loss": 0.10, "category": "1A", "note": None,
                     "hand": ["1m"], "melds": [], "actual": {"type": "dahai", "pai": "1m"},
                     "expected": {"type": "dahai", "pai": "2m"}, "top_actions": []},
                    {"turn": 7, "severity": "??", "ev_loss": 0.80, "category": "3A", "note": None,
                     "hand": ["5p"], "melds": [], "actual": {"type": "dahai", "pai": "5p"},
                     "expected": {"type": "dahai", "pai": "6p"}, "top_actions": []},
                ],
            }],
        }
        gid = db.add_game(conn, uid, game_dict)

        stats = db.compute_summary_for_game(conn, gid)
        assert stats["total_mistakes"] == 2
        assert stats["total_ev_loss"] == 0.90
        assert stats["by_severity"]["?"] == 1
        assert stats["by_severity"]["??"] == 1
        assert stats["by_category"]["1A"]["count"] == 1
        assert stats["by_category"]["3A"]["count"] == 1
        assert stats["total_decisions"] == 12
        assert stats["ev_per_decision"] is not None

        # Verify it was persisted
        row = conn.execute("SELECT stats_json FROM games WHERE id = ?", (gid,)).fetchone()
        saved = json.loads(row["stats_json"])
        assert saved["total_mistakes"] == 2

    # --- annotate_mistake tests ---

    def test_annotate_mistake_ownership(self, sample_user):
        """annotate_mistake returns None when user doesn't own the game."""
        conn, uid = sample_user
        other_uid = db.create_user(conn, "otheruser", _gen_pw_hash("pw"))

        game_dict = {
            "date": "2026-01-20",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10, "outcome": None,
                         "mistakes": [{"turn": 5, "severity": "??", "ev_loss": 0.5,
                                        "category": "1A", "note": None,
                                        "hand": ["1m"], "melds": [],
                                        "actual": {"type": "dahai", "pai": "1m"},
                                        "expected": {"type": "dahai", "pai": "2m"},
                                        "top_actions": []}]}],
        }
        gid = db.add_game(conn, uid, game_dict)

        # Other user should not be able to annotate
        result = db.annotate_mistake(conn, gid, "E1", 5, 0, "3A", "test note", user_id=other_uid)
        assert result is None

    def test_annotate_mistake_update(self, sample_user):
        """annotate_mistake updates category and note on a valid mistake."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-20",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10, "outcome": None,
                         "mistakes": [{"turn": 5, "severity": "??", "ev_loss": 0.5,
                                        "category": "1A", "note": None,
                                        "hand": ["1m"], "melds": [],
                                        "actual": {"type": "dahai", "pai": "1m"},
                                        "expected": {"type": "dahai", "pai": "2m"},
                                        "top_actions": []}]}],
        }
        gid = db.add_game(conn, uid, game_dict)

        result = db.annotate_mistake(conn, gid, "E1", 5, 0, "3B", "defense play", user_id=uid)
        assert result is True

        row = conn.execute(
            "SELECT category, note FROM mistakes WHERE game_id = ?", (gid,)
        ).fetchone()
        assert row["category"] == "3B"
        assert row["note"] == "defense play"

    def test_annotate_mistake_invalid_index(self, sample_user):
        """annotate_mistake returns None for out-of-range index."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-20",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10, "outcome": None,
                         "mistakes": [{"turn": 5, "severity": "??", "ev_loss": 0.5,
                                        "category": "1A", "note": None,
                                        "hand": ["1m"], "melds": [],
                                        "actual": {"type": "dahai", "pai": "1m"},
                                        "expected": {"type": "dahai", "pai": "2m"},
                                        "top_actions": []}]}],
        }
        gid = db.add_game(conn, uid, game_dict)
        result = db.annotate_mistake(conn, gid, "E1", 5, 99, "3B", "note", user_id=uid)
        assert result is None

    # --- submit_category_report / list_category_reports tests ---

    def test_submit_category_report(self, sample_user):
        """submit_category_report inserts a report and returns its ID."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)

        report_id = db.submit_category_report(conn, uid, mid, kind="wrong_category",
                                               suggested_category="3A", reason="Should be push/fold")
        assert report_id is not None
        assert isinstance(report_id, int)

        # Verify it's in the DB
        row = conn.execute("SELECT * FROM category_reports WHERE id = ?", (report_id,)).fetchone()
        assert row["user_id"] == uid
        assert row["mistake_id"] == mid
        assert row["kind"] == "wrong_category"
        assert row["agree"] == 0
        assert row["suggested_category"] == "3A"
        assert row["reason"] == "Should be push/fold"

    def test_submit_category_report_wrong_text(self, sample_user):
        """submit_category_report with kind=wrong_text stores reason and no suggestion."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)

        report_id = db.submit_category_report(conn, uid, mid, kind="wrong_text",
                                              reason="explanation reads off")
        row = conn.execute("SELECT * FROM category_reports WHERE id = ?", (report_id,)).fetchone()
        assert row["kind"] == "wrong_text"
        assert row["reason"] == "explanation reads off"
        assert row["suggested_category"] is None

    def test_submit_category_report_rejects_agree(self, sample_user):
        """The legacy 'agree' kind has been removed and is rejected."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)
        with pytest.raises(ValueError):
            db.submit_category_report(conn, uid, mid, kind="agree")

    def test_delete_category_report(self, sample_user):
        """delete_category_report removes the row and reports True."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)
        rid = db.submit_category_report(conn, uid, mid, kind="wrong_text", reason="r")

        assert db.delete_category_report(conn, rid) is True
        assert conn.execute(
            "SELECT COUNT(*) FROM category_reports WHERE id = ?", (rid,)
        ).fetchone()[0] == 0
        # Second delete reports False since the row is gone.
        assert db.delete_category_report(conn, rid) is False

    def test_submit_category_report_upserts(self, sample_user):
        """Re-submitting for the same (user, mistake) replaces the prior report."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)

        db.submit_category_report(conn, uid, mid, kind="wrong_category",
                                   suggested_category="3A", reason="first")
        db.submit_category_report(conn, uid, mid, kind="wrong_text",
                                   reason="second")

        rows = conn.execute(
            "SELECT kind, reason, suggested_category FROM category_reports "
            "WHERE user_id = ? AND mistake_id = ?", (uid, mid)
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["kind"] == "wrong_text"
        assert rows[0]["reason"] == "second"
        assert rows[0]["suggested_category"] is None

    def test_submit_category_report_invalid_kind(self, sample_user):
        """An unknown kind raises ValueError."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)
        with pytest.raises(ValueError):
            db.submit_category_report(conn, uid, mid, kind="nope")

    def test_list_category_reports(self, sample_user):
        """list_category_reports returns all reports with context."""
        conn, uid = sample_user
        gid, mid = self._add_game_with_mistake(conn, uid)

        db.submit_category_report(conn, uid, mid, kind="wrong_category",
                                   suggested_category="3B", reason="Defense mistake")

        reports = db.list_category_reports(conn)
        assert len(reports) == 1
        r = reports[0]
        assert r["username"] == "testuser"
        assert r["category"] == "1A"  # the mistake's current category
        assert r["game_id"] == gid
        assert r["suggested_category"] == "3B"

    def test_list_category_reports_empty(self, tmp_db):
        """list_category_reports returns empty list when no reports exist."""
        reports = db.list_category_reports(tmp_db)
        assert reports == []

    # --- get_user_by_oauth tests ---

    def test_get_user_by_oauth_not_found(self, tmp_db):
        """get_user_by_oauth returns None when no matching user."""
        result = db.get_user_by_oauth(tmp_db, "discord", "nonexistent_id")
        assert result is None

    def test_get_user_by_oauth_invalid_provider(self, tmp_db):
        """get_user_by_oauth returns None for invalid provider."""
        result = db.get_user_by_oauth(tmp_db, "twitter", "some_id")
        assert result is None

    def test_get_user_by_oauth_found(self, tmp_db):
        """get_user_by_oauth finds a user by their OAuth ID."""
        uid, _ = db.create_oauth_user(tmp_db, "discord", "disc_123", "oauthuser")
        result = db.get_user_by_oauth(tmp_db, "discord", "disc_123")
        assert result is not None
        assert result["id"] == uid

    # --- create_oauth_user tests ---

    def test_create_oauth_user(self, tmp_db):
        """create_oauth_user creates a user with OAuth provider ID."""
        uid, username = db.create_oauth_user(tmp_db, "discord", "disc_456", "newuser")
        assert uid is not None
        assert username == "newuser"

        user = db.get_user_by_id(tmp_db, uid)
        assert user["username"] == "newuser"
        assert user["discord_id"] == "disc_456"
        assert user["password_hash"] == ""

    def test_create_oauth_user_collision(self, tmp_db):
        """create_oauth_user appends suffix when username collides."""
        db.create_user(tmp_db, "taken", _gen_pw_hash("pw"))

        uid, username = db.create_oauth_user(tmp_db, "google", "goog_789", "taken")
        assert username == "taken_1"
        user = db.get_user_by_id(tmp_db, uid)
        assert user["username"] == "taken_1"
        assert user["google_id"] == "goog_789"

    def test_create_oauth_user_multiple_collisions(self, tmp_db):
        """create_oauth_user increments suffix on repeated collisions."""
        db.create_user(tmp_db, "user", _gen_pw_hash("pw"))
        db.create_user(tmp_db, "user_1", _gen_pw_hash("pw"))

        uid, username = db.create_oauth_user(tmp_db, "discord", "disc_multi", "user")
        assert username == "user_2"

    def test_create_oauth_user_invalid_provider(self, tmp_db):
        """create_oauth_user raises ValueError for unknown provider."""
        with pytest.raises(ValueError):
            db.create_oauth_user(tmp_db, "twitter", "tw_123", "someone")

    # --- link_oauth tests ---

    def test_link_oauth(self, sample_user):
        """link_oauth links an OAuth provider to an existing user."""
        conn, uid = sample_user
        result = db.link_oauth(conn, uid, "discord", "disc_link_001")
        assert result is True

        user = db.get_user_by_id(conn, uid)
        assert user["discord_id"] == "disc_link_001"

    def test_link_oauth_google(self, sample_user):
        """link_oauth works with the google provider."""
        conn, uid = sample_user
        result = db.link_oauth(conn, uid, "google", "goog_link_001")
        assert result is True

        user = db.get_user_by_id(conn, uid)
        assert user["google_id"] == "goog_link_001"

    def test_link_oauth_invalid_provider(self, sample_user):
        """link_oauth returns False for invalid provider."""
        conn, uid = sample_user
        result = db.link_oauth(conn, uid, "twitter", "tw_123")
        assert result is False

    def test_link_oauth_then_lookup(self, sample_user):
        """After link_oauth, get_user_by_oauth should find the user."""
        conn, uid = sample_user
        db.link_oauth(conn, uid, "discord", "disc_roundtrip")

        found = db.get_user_by_oauth(conn, "discord", "disc_roundtrip")
        assert found is not None
        assert found["id"] == uid
        assert found["username"] == "testuser"


# --- API route tests ---

class TestAPI:
    @pytest.fixture
    def client(self, tmp_path):
        """Create a Flask test client with a temporary database."""
        db_path = tmp_path / "test.db"
        os.environ["DB_PATH"] = str(db_path)
        os.environ["SECRET_KEY"] = "test-secret"

        # Re-import to pick up new DB_PATH
        import importlib
        importlib.reload(db)

        conn = db.get_db()
        db.init_db(conn)

        db.create_user(conn, "testuser", _gen_pw_hash("testpass"))
        conn.close()

        # Import app after DB setup
        import app as app_module
        importlib.reload(app_module)
        app_module.app.config["TESTING"] = True
        app_module.app.config["WTF_CSRF_ENABLED"] = False

        with app_module.app.test_client() as client:
            yield client

    def _login(self, client):
        return client.post("/login", data={
            "username": "testuser",
            "password": "testpass",
        }, follow_redirects=True)

    def test_login_required(self, client):
        res = client.get("/api/games")
        assert res.status_code == 401

    def test_login_and_games(self, client):
        self._login(client)
        res = client.get("/api/games")
        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, list)

    def test_feedback_api(self, client):
        self._login(client)
        res = client.post("/api/feedback", json={
            "type": "bug",
            "message": "Test feedback",
        })
        assert res.status_code == 200
        data = res.get_json()
        assert data["ok"] is True

    def test_feedback_validation(self, client):
        self._login(client)
        res = client.post("/api/feedback", json={"type": "bug", "message": ""})
        assert res.status_code == 400

    def test_categories_api(self, client):
        self._login(client)
        res = client.get("/api/categories")
        assert res.status_code == 200
        data = res.get_json()
        assert "1A" in data

    def test_annotate_validation(self, client):
        """Input validation on annotate endpoint."""
        self._login(client)
        # Missing required fields
        res = client.post("/api/games/1/annotate", json={})
        assert res.status_code == 400
        # Invalid category
        res = client.post("/api/games/1/annotate", json={
            "round": "E1", "turn": 1, "category": "INVALID"
        })
        assert res.status_code == 400

    def test_feedback_type_validation(self, client):
        """Feedback type must be bug/feature/general."""
        self._login(client)
        res = client.post("/api/feedback", json={
            "type": "malicious",
            "message": "test",
        })
        assert res.status_code == 400

# --- Wall reconstruction tests ---

class TestWallReconstruction:
    def test_wall_no_negatives(self, mortal_data):
        """Wall values should not go negative after subtracting hand."""
        kyokus = mortal_data["review"]["kyokus"]
        events = flatten_mjai_log(mortal_data["mjai_log"])
        start_events = [e for e in events if e.get("type") == "start_kyoku"]

        for ki, kyoku in enumerate(kyokus):
            for entry in kyoku["entries"]:
                if entry["is_equal"]:
                    continue
                hand = [t for t in entry["state"]["tehai"] if t != "?"]
                if not hand:
                    continue
                wall, _, _, _, _ = reconstruct_context(mortal_data, ki, entry["tiles_left"])
                wall2 = subtract_hand_from_wall(wall, hand)
                for i, v in enumerate(wall2):
                    assert v >= -1, f"kyoku={ki} tiles_left={entry['tiles_left']} wall[{i}]={v}"

    def test_wall_hand_consistency(self, mortal_data):
        """For each tile, wall + hand should not exceed 4 (or 1 for red fives)."""
        kyokus = mortal_data["review"]["kyokus"]

        kyoku = kyokus[0]
        entry = kyoku["entries"][0]
        hand = [t for t in entry["state"]["tehai"] if t != "?"]

        wall, _, _, _, _ = reconstruct_context(mortal_data, 0, entry["tiles_left"])
        wall2 = subtract_hand_from_wall(wall, hand)

        hand_ids = [mjai_to_tile_id(t) for t in hand]
        for i in range(34):
            in_hand = sum(1 for h in hand_ids if tile_id_to_base(h) == i)
            # Wall + hand should not exceed total copies (4)
            assert wall2[i] + in_hand <= 4, f"tile {i}: wall={wall2[i]} hand={in_hand}"

    def test_wall_excludes_own_dahai_at_decision_turn(self):
        """Regression: the player's own decision-turn dahai must not be
        counted as visible. That tile is still in the 14-tile hand passed to
        subtract_hand_from_wall, so counting it in `visible` would
        double-subtract the remaining copies.

        Reproducer shaped after prod mistake 4875: seat 0 discards one C,
        seat 2 (the player) tsumos and has a C in hand. Wall[C] at the
        decision point should be 3 (only seat 0's C is visible). The player's
        own C dahai that follows must NOT be counted.
        """
        mortal_data = {
            "player_id": 2,
            "mjai_log": [
                {"type": "start_kyoku", "bakaze": "E", "kyoku": 1, "honba": 0,
                 "oya": 0, "dora_marker": "1m", "scores": [25000] * 4,
                 "tehais": [["?"] * 13] * 4},
                # Seat 0 draws and discards C → 1 C visible.
                {"type": "tsumo", "actor": 0, "pai": "C"},
                {"type": "dahai", "actor": 0, "pai": "C", "tsumogiri": True},
                {"type": "tsumo", "actor": 1, "pai": "1s"},
                {"type": "dahai", "actor": 1, "pai": "1s", "tsumogiri": True},
                # Seat 2 (player) draws — decision point. tiles_left: 70→69→68→67.
                {"type": "tsumo", "actor": 2, "pai": "C"},
                # Player's own dahai of C — must NOT land in `visible`.
                {"type": "dahai", "actor": 2, "pai": "C", "tsumogiri": False},
                {"type": "tsumo", "actor": 3, "pai": "9m"},
            ],
        }
        wall, _, _, _, _ = reconstruct_context(mortal_data, 0, 67)
        # Only seat 0's C is visible; wall[C=33] = 4 - 1 = 3.
        assert wall[33] == 3, f"wall[C] expected 3, got {wall[33]}"

        # After subtracting a 14-tile hand containing 1 C, wall[C] must be 2.
        hand = ["C"] + ["1m"] * 13
        w2 = subtract_hand_from_wall(wall, hand)
        assert w2[33] == 2, f"wall[C] after hand-subtract expected 2, got {w2[33]}"


# --- Add game pipeline tests ---

SMALL_MORTAL_FILE = os.path.join(FIXTURES_DIR, "game_short.json")


class TestAddGamePipeline:
    """End-to-end: add a game via the API and verify categorization results in DB."""

    @pytest.fixture
    def client(self, tmp_path):
        db_path = tmp_path / "test.db"
        os.environ["DB_PATH"] = str(db_path)
        os.environ["SECRET_KEY"] = "test-secret"

        import importlib
        importlib.reload(db)

        conn = db.get_db()
        db.init_db(conn)
        db.create_user(conn, "testuser", _gen_pw_hash("testpass"))
        conn.close()

        import app as app_module
        importlib.reload(app_module)
        app_module.app.config["TESTING"] = True
        app_module.app.config["WTF_CSRF_ENABLED"] = False

        with app_module.app.test_client() as client:
            # Login
            client.post("/login", data={"username": "testuser", "password": "testpass"},
                        follow_redirects=True)
            yield client

    @pytest.fixture
    def mortal_json(self):
        with open(SMALL_MORTAL_FILE) as f:
            return json.load(f)

    def _add_game(self, client, mortal_json):
        """Post a game and return the JSON result."""
        res = client.post("/api/games/add", json={"mortal_data": mortal_json},
                          content_type="application/json")
        assert res.status_code == 200, f"Status {res.status_code}: {res.data[:200]}"
        return res.get_json()

    def _wait_for_categorization(self, game_id, timeout=10):
        """Block until the game's background categorization reaches a terminal
        state (`done` or `failed`). Categorization is async and every test
        that reads categories, board_state, or summary totals needs this."""
        import time
        deadline = time.time() + timeout
        while time.time() < deadline:
            conn = db.get_db()
            row = conn.execute(
                "SELECT categorization_status FROM games WHERE id = ?", (game_id,),
            ).fetchone()
            if row and row["categorization_status"] != "pending":
                return row["categorization_status"]
            time.sleep(0.1)
        pytest.fail(f"categorization did not complete within {timeout}s for game {game_id}")

    def test_add_game_returns_json(self, client, mortal_json):
        """POST /api/games/add should return JSON with ok and game_id."""
        data = self._add_game(client, mortal_json)
        assert data.get("ok") is True
        assert "game_id" in data
        assert isinstance(data["game_id"], int)

    def test_add_game_prepares_inputs(self, client, mortal_json):
        """Every dahai-vs-dahai mistake should have discard_stats populated
        after the background prep step. This is the JS categorizer's main
        input — if it's missing, mistake cards render without an EV table.
        Backend categorization itself was moved to JS in step 2, so the
        `category` column is no longer expected to be populated here."""
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]
        self._wait_for_categorization(game_id)

        conn = db.get_db()
        rows = conn.execute(
            "SELECT id, data_json FROM mistakes WHERE game_id = ?",
            (game_id,),
        ).fetchall()
        assert len(rows) > 0, "No mistakes in DB after add"

        missing_stats = []
        for r in rows:
            d = json.loads(r["data_json"])
            actual = d.get("actual") or {}
            expected = d.get("expected") or {}
            if actual.get("type") == "dahai" and expected.get("type") == "dahai":
                if not d.get("discard_stats"):
                    missing_stats.append(r["id"])
        assert not missing_stats, (
            f"{len(missing_stats)}/{len(rows)} dahai-vs-dahai mistakes "
            f"missing discard_stats (ids: {missing_stats[:5]})"
        )

    def test_add_game_has_summary(self, client, mortal_json):
        """Added game should have a computed summary with EV stats."""
        data = self._add_game(client, mortal_json)
        summary = data.get("summary", {})
        assert summary.get("total_mistakes", 0) > 0
        assert "total_ev_loss" in summary
        assert "by_severity" in summary

    def test_add_game_has_board_state(self, client, mortal_json):
        """Each mistake should have board_state populated."""
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]
        self._wait_for_categorization(game_id)

        conn = db.get_db()
        rows = conn.execute(
            "SELECT data_json FROM mistakes WHERE game_id = ?", (game_id,),
        ).fetchall()
        for row in rows:
            mdata = json.loads(row["data_json"])
            assert "board_state" in mdata, f"Missing board_state in mistake"

    def test_add_game_status_done(self, client, mortal_json):
        """Background prep should reach `done` status, signalling the
        frontend that data_json is ready for the JS categorizer."""
        data = self._add_game(client, mortal_json)
        assert data.get("ok") is True
        status = self._wait_for_categorization(data["game_id"])
        assert status == "done", f"prep status: {status!r}"

        conn = db.get_db()
        total = conn.execute(
            "SELECT COUNT(*) FROM mistakes WHERE game_id = ?", (data["game_id"],),
        ).fetchone()[0]
        assert total > 0

    def test_get_game_after_add(self, client, mortal_json):
        """GET /api/games/<id> should return the added game with mistakes."""
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]

        res2 = client.get(f"/api/games/{game_id}")
        assert res2.status_code == 200
        game = res2.get_json()
        assert game["id"] == game_id
        assert len(game.get("rounds", [])) > 0
        all_mistakes = [m for r in game["rounds"] for m in r.get("mistakes", [])]
        assert len(all_mistakes) > 0

    def test_delete_game(self, client, mortal_json):
        """DELETE /api/games/<id> should remove the game."""
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]

        res2 = client.delete(f"/api/games/{game_id}")
        assert res2.status_code == 200

        res3 = client.get(f"/api/games/{game_id}")
        assert res3.status_code == 404

    def test_categorize_endpoint(self, client, mortal_json):
        """POST /api/games/<id>/categorize should re-run the input prep.
        (Endpoint URL retained from the categorizer era; under the hood
        it now calls prepare_game_data.)"""
        data = self._add_game(client, mortal_json)
        game_id = data["game_id"]
        # Wait for the initial background prep to finish so the re-run
        # doesn't race against it.
        self._wait_for_categorization(game_id)

        res2 = client.post(f"/api/games/{game_id}/categorize",
                           json={"force": True}, content_type="application/json")
        assert res2.status_code == 200
        data = res2.get_json()
        assert data.get("ok") is True
        assert data.get("status") == "pending"

        status = self._wait_for_categorization(game_id)
        assert status == "done"

    def test_trends_after_add(self, client, mortal_json):
        """GET /api/trends should include data after adding a game."""
        data = self._add_game(client, mortal_json)
        self._wait_for_categorization(data["game_id"])

        res = client.get("/api/trends")
        assert res.status_code == 200
        trends = res.get_json()
        assert len(trends) > 0
        assert "date" in trends[0]
        assert "total_ev_loss" in trends[0]
