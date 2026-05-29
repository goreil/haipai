#!/usr/bin/env python3
"""Tests for db.py advanced surface: trends, summary, annotation, category
reports, weakness snapshots, OAuth lookup/link/create.

Basic CRUD (init, user, game add/get/delete/list) lives in test_db_core.py.
"""

import json
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
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = db.get_db(db_path=path)
    db.init_db(conn)
    yield conn
    conn.close()
    os.unlink(path)


@pytest.fixture
def sample_user(tmp_db):
    uid = db.create_user(tmp_db, "testuser", _gen_pw_hash("testpass"))
    return tmp_db, uid


def _add_game_with_mistake(conn, uid):
    """Insert a game with a '??' severity discard-vs-discard mistake.
    Returns (game_id, mistake_id)."""
    game_dict = make_game(rounds=[make_round(decision_count=8, mistakes=[
        make_mistake(
            hand=["1m", "2m", "3m", "5m", "6m", "7m", "1p", "2p", "3p",
                  "5s", "6s", "7s", "9s"],
            shanten=0,
            actual={"type": "dahai", "pai": "9s"},
            expected={"type": "dahai", "pai": "5m"},
            top_actions=[
                {"action": "dahai 5m", "q_value": 1.0},
                {"action": "dahai 9s", "q_value": 0.5},
            ],
        ),
    ])])
    gid = db.add_game(conn, uid, game_dict)
    mid = conn.execute(
        "SELECT id FROM mistakes WHERE game_id = ?", (gid,)
    ).fetchone()["id"]
    return gid, mid


# --- get_trends ---

class TestGetTrends:
    def test_get_trends_empty(self, sample_user):
        """get_trends returns empty list when user has no games."""
        conn, uid = sample_user
        trends = db.get_trends(conn, uid)
        assert trends == []

    def test_get_trends_with_data(self, sample_user):
        """get_trends returns per-game trend data with stats."""
        conn, uid = sample_user
        game_dict = make_game(
            summary={
                "total_mistakes": 2,
                "total_ev_loss": 1.5,
                "total_decisions": 20,
                "ev_per_decision": 0.075,
                "by_severity": {"??": 1, "???": 1},
            },
            mistakes=[],
        )
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


# --- compute_summary_for_game ---

class TestComputeSummary:
    def test_compute_summary_for_game(self, sample_user):
        """compute_summary_for_game recomputes stats from mistake rows."""
        conn, uid = sample_user
        game_dict = make_game(date="2026-01-20", rounds=[make_round(
            turn_count=15, decision_count=12, mistakes=[
                make_mistake(turn=3, ev_loss=0.10, hand=["1m"], top_actions=[]),
                make_mistake(turn=7, ev_loss=0.80, hand=["5p"], top_actions=[],
                             actual={"type": "dahai", "pai": "5p"},
                             expected={"type": "dahai", "pai": "6p"}),
            ],
        )])
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
        row = conn.execute(
            "SELECT stats_json FROM games WHERE id = ?", (gid,)
        ).fetchone()
        saved = json.loads(row["stats_json"])
        assert saved["total_mistakes"] == 2


# --- annotate_mistake ---

class TestAnnotateMistake:
    def test_annotate_mistake_ownership(self, sample_user):
        """annotate_mistake returns None when user doesn't own the game."""
        conn, uid = sample_user
        other_uid = db.create_user(conn, "otheruser", _gen_pw_hash("pw"))

        game_dict = make_game(date="2026-01-20", mistakes=[
            make_mistake(hand=["1m"], top_actions=[]),
        ])
        gid = db.add_game(conn, uid, game_dict)

        result = db.annotate_mistake(conn, gid, "E1", 5, 0, "test note",
                                     user_id=other_uid)
        assert result is None

    def test_annotate_mistake_update(self, sample_user):
        """annotate_mistake persists the user's note on a valid mistake."""
        conn, uid = sample_user
        game_dict = make_game(date="2026-01-20", mistakes=[
            make_mistake(hand=["1m"], top_actions=[]),
        ])
        gid = db.add_game(conn, uid, game_dict)

        result = db.annotate_mistake(conn, gid, "E1", 5, 0, "defense play",
                                     user_id=uid)
        assert result is True

        row = conn.execute(
            "SELECT note FROM mistakes WHERE game_id = ?", (gid,)
        ).fetchone()
        assert row["note"] == "defense play"

    def test_annotate_mistake_invalid_index(self, sample_user):
        """annotate_mistake returns None for out-of-range index."""
        conn, uid = sample_user
        game_dict = make_game(date="2026-01-20", mistakes=[
            make_mistake(hand=["1m"], top_actions=[]),
        ])
        gid = db.add_game(conn, uid, game_dict)
        result = db.annotate_mistake(conn, gid, "E1", 5, 99, "note",
                                     user_id=uid)
        assert result is None


# --- submit_category_report / list_category_reports ---

class TestCategoryReports:
    def test_submit_category_report(self, sample_user):
        """submit_category_report inserts a report and returns its ID."""
        conn, uid = sample_user
        gid, mid = _add_game_with_mistake(conn, uid)

        report_id = db.submit_category_report(
            conn, uid, mid, kind="wrong_category",
            suggested_category="3A", reason="Should be push/fold")
        assert report_id is not None
        assert isinstance(report_id, int)

        row = conn.execute(
            "SELECT * FROM category_reports WHERE id = ?", (report_id,)
        ).fetchone()
        assert row["user_id"] == uid
        assert row["mistake_id"] == mid
        assert row["kind"] == "wrong_category"
        assert row["agree"] == 0
        assert row["suggested_category"] == "3A"
        assert row["reason"] == "Should be push/fold"

    def test_submit_category_report_wrong_text(self, sample_user):
        """submit_category_report with kind=wrong_text stores reason and no
        suggestion."""
        conn, uid = sample_user
        gid, mid = _add_game_with_mistake(conn, uid)

        report_id = db.submit_category_report(
            conn, uid, mid, kind="wrong_text",
            reason="explanation reads off")
        row = conn.execute(
            "SELECT * FROM category_reports WHERE id = ?", (report_id,)
        ).fetchone()
        assert row["kind"] == "wrong_text"
        assert row["reason"] == "explanation reads off"
        assert row["suggested_category"] is None

    def test_submit_category_report_rejects_agree(self, sample_user):
        """The legacy 'agree' kind has been removed and is rejected."""
        conn, uid = sample_user
        gid, mid = _add_game_with_mistake(conn, uid)
        with pytest.raises(ValueError):
            db.submit_category_report(conn, uid, mid, kind="agree")

    def test_delete_category_report(self, sample_user):
        """delete_category_report removes the row and reports True."""
        conn, uid = sample_user
        gid, mid = _add_game_with_mistake(conn, uid)
        rid = db.submit_category_report(conn, uid, mid, kind="wrong_text",
                                        reason="r")

        assert db.delete_category_report(conn, rid) is True
        assert conn.execute(
            "SELECT COUNT(*) FROM category_reports WHERE id = ?", (rid,)
        ).fetchone()[0] == 0
        # Second delete reports False since the row is gone.
        assert db.delete_category_report(conn, rid) is False

    def test_submit_category_report_upserts(self, sample_user):
        """Re-submitting for the same (user, mistake) replaces the prior
        report."""
        conn, uid = sample_user
        gid, mid = _add_game_with_mistake(conn, uid)

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
        gid, mid = _add_game_with_mistake(conn, uid)
        with pytest.raises(ValueError):
            db.submit_category_report(conn, uid, mid, kind="nope")

    def test_list_category_reports(self, sample_user):
        """list_category_reports returns all reports with context."""
        conn, uid = sample_user
        gid, mid = _add_game_with_mistake(conn, uid)

        db.submit_category_report(conn, uid, mid, kind="wrong_category",
                                  suggested_category="3B",
                                  reason="Defense mistake")

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


# --- weakness_snapshots ---

class TestSnapshots:
    def test_insert_snapshot_basic(self, sample_user):
        """insert_snapshot stores aggregated totals + version + game_count."""
        conn, uid = sample_user
        sid = db.insert_snapshot(
            conn, uid, 1, [10, 20, 30],
            by_category={"P1": {"count": 2, "ev": 1.5}},
            decision_counts={"attack": 100, "defense": 0, "meld": 0,
                             "riichi": 0, "kan": 0},
        )
        assert isinstance(sid, int)
        snaps = db.list_snapshots(conn, uid)
        assert len(snaps) == 1
        s = snaps[0]
        assert s["categorizer_version"] == 1
        assert s["game_count"] == 3
        assert s["game_ids"] == [10, 20, 30]
        assert s["by_category"] == {"P1": {"count": 2, "ev": 1.5}}
        assert s["decision_counts"]["attack"] == 100

    def test_insert_snapshot_dedupes_same_version_and_ids(self, sample_user):
        """Re-saving with the same version + game_id set is a no-op."""
        conn, uid = sample_user
        sid1 = db.insert_snapshot(conn, uid, 1, [1, 2], {}, {"attack": 5})
        sid2 = db.insert_snapshot(conn, uid, 1, [2, 1], {}, {"attack": 5})  # reordered
        assert sid1 is not None
        assert sid2 is None
        assert len(db.list_snapshots(conn, uid)) == 1

    def test_insert_snapshot_dedupe_skipped_on_version_change(self, sample_user):
        """A version bump always writes a new row even if game_ids match."""
        conn, uid = sample_user
        db.insert_snapshot(conn, uid, 1, [1, 2], {}, {"attack": 5})
        sid2 = db.insert_snapshot(conn, uid, 2, [1, 2], {}, {"attack": 5})
        assert sid2 is not None
        assert len(db.list_snapshots(conn, uid)) == 2

    def test_insert_snapshot_dedupe_skipped_on_new_games(self, sample_user):
        """Adding a new game id to the set writes a new row."""
        conn, uid = sample_user
        db.insert_snapshot(conn, uid, 1, [1, 2], {}, {"attack": 5})
        sid2 = db.insert_snapshot(conn, uid, 1, [1, 2, 3], {}, {"attack": 5})
        assert sid2 is not None
        assert len(db.list_snapshots(conn, uid)) == 2

    def test_list_snapshots_newest_first(self, sample_user):
        """list_snapshots returns newest first (most recent created_at)."""
        conn, uid = sample_user
        db.insert_snapshot(conn, uid, 1, [1], {}, {"attack": 5})
        db.insert_snapshot(conn, uid, 2, [1], {}, {"attack": 5})
        snaps = db.list_snapshots(conn, uid)
        assert [s["categorizer_version"] for s in snaps] == [2, 1]

    def test_list_snapshots_per_user(self, tmp_db):
        """Snapshots are scoped per user."""
        u1 = db.create_user(tmp_db, "alice", _gen_pw_hash("a"))
        u2 = db.create_user(tmp_db, "bob", _gen_pw_hash("b"))
        db.insert_snapshot(tmp_db, u1, 1, [1], {}, {"attack": 5})
        db.insert_snapshot(tmp_db, u2, 1, [1], {}, {"attack": 5})
        assert len(db.list_snapshots(tmp_db, u1)) == 1
        assert len(db.list_snapshots(tmp_db, u2)) == 1


# --- OAuth lookup / create / link ---

class TestOAuth:
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
