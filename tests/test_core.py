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
from lib.parse import parse_game, round_header, severity
from lib.tiles import MJAI_TO_ID, ID_TO_MJAI, mjai_to_tile_id, tile_id_to_base


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
                    "ev_loss": 0.50,
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
                "turn": 3, "ev_loss": 0.05, "note": None,
                "hand": ["1m"], "melds": [], "actual": {"type": "dahai", "pai": "1m"},
                "expected": {"type": "dahai", "pai": "2m"}, "top_actions": [],
            }]}],
        }
        gid = db.add_game(conn, uid, game_dict)
        mid = conn.execute("SELECT id FROM mistakes WHERE game_id = ?", (gid,)).fetchone()["id"]

        db.update_mistake_data(conn, mid, {"note": "manual review", "best_discard": "2m"})

        row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mid,)).fetchone()
        assert row["note"] == "manual review"
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
                    "ev_loss": 0.50,
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
        assert "by_category" not in t

    # --- compute_summary_for_game tests ---

    def test_compute_summary_for_game(self, sample_user):
        """compute_summary_for_game recomputes stats from mistake rows."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-20",
            "rounds": [{
                "round": "E1", "honba": 0, "turn_count": 15, "decision_count": 12, "outcome": None,
                "mistakes": [
                    {"turn": 3, "ev_loss": 0.10, "note": None,
                     "hand": ["1m"], "melds": [], "actual": {"type": "dahai", "pai": "1m"},
                     "expected": {"type": "dahai", "pai": "2m"}, "top_actions": []},
                    {"turn": 7, "ev_loss": 0.80, "note": None,
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
        assert "by_category" not in stats
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
                         "mistakes": [{"turn": 5, "ev_loss": 0.5,
                                        "note": None,
                                        "hand": ["1m"], "melds": [],
                                        "actual": {"type": "dahai", "pai": "1m"},
                                        "expected": {"type": "dahai", "pai": "2m"},
                                        "top_actions": []}]}],
        }
        gid = db.add_game(conn, uid, game_dict)

        # Other user should not be able to annotate
        result = db.annotate_mistake(conn, gid, "E1", 5, 0, "test note", user_id=other_uid)
        assert result is None

    def test_annotate_mistake_update(self, sample_user):
        """annotate_mistake persists the user's note on a valid mistake."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-20",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10, "outcome": None,
                         "mistakes": [{"turn": 5, "ev_loss": 0.5,
                                        "note": None,
                                        "hand": ["1m"], "melds": [],
                                        "actual": {"type": "dahai", "pai": "1m"},
                                        "expected": {"type": "dahai", "pai": "2m"},
                                        "top_actions": []}]}],
        }
        gid = db.add_game(conn, uid, game_dict)

        result = db.annotate_mistake(conn, gid, "E1", 5, 0, "defense play", user_id=uid)
        assert result is True

        row = conn.execute(
            "SELECT note FROM mistakes WHERE game_id = ?", (gid,)
        ).fetchone()
        assert row["note"] == "defense play"

    def test_annotate_mistake_invalid_index(self, sample_user):
        """annotate_mistake returns None for out-of-range index."""
        conn, uid = sample_user
        game_dict = {
            "date": "2026-01-20",
            "rounds": [{"round": "E1", "honba": 0, "turn_count": 10, "outcome": None,
                         "mistakes": [{"turn": 5, "ev_loss": 0.5,
                                        "note": None,
                                        "hand": ["1m"], "melds": [],
                                        "actual": {"type": "dahai", "pai": "1m"},
                                        "expected": {"type": "dahai", "pai": "2m"},
                                        "top_actions": []}]}],
        }
        gid = db.add_game(conn, uid, game_dict)
        result = db.annotate_mistake(conn, gid, "E1", 5, 99, "note", user_id=uid)
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
        assert r["game_id"] == gid
        assert r["suggested_category"] == "3B"
        # round_idx + mistake_idx let the admin JS find the right kyoku entry
        # for re-prep. mortal_file is the relative path the admin endpoint
        # loads slim mortal_data from.
        assert r["round_idx"] == 0
        assert r["mistake_idx"] == 0
        assert "mortal_file" in r

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
        # Wrong-typed note still fails validation before the lookup
        res = client.post("/api/games/1/annotate", json={
            "round": "E1", "turn": 1, "note": 42,
        })
        assert res.status_code == 400

# --- Add-game pipeline tests ---
#
# Upload/fetch/delete/trends round-trips through the HTTP + DB layer. The
# shared `client` fixture (tests/conftest.py) seeds a temp DB + logged-in
# testuser; test_snapshots.py covers the upload→fetch shape, so we only
# pin the bits unique to this layer here.

SMALL_MORTAL_FILE = os.path.join(FIXTURES_DIR, "game_short.json")


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
