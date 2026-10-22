"""Calibration holds out whole games and checkpoints only reviewed grade slots."""

import json
import sqlite3
import subprocess

import pytest

from db.admin import admin_maka_rank_stats
from db.maka import grade_snapshot, latest_review, record_review
from db.schema import HAIPAI_RANK_UPDATED_AT, SCHEMA
from scripts.analyze_maka_ranks import analyze, evaluate, rank


@pytest.fixture
def calibration_db(tmp_path):
    path = tmp_path / "calibration.db"
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    for i in range(1, 5):
        conn.execute(
            "INSERT INTO games (id,user_id,date,stats_json,rounds_json,maka_ratings_json,"
            "maka_ratings_added_at_json) VALUES (?,1,'2026-10-22',?,?,?,?)",
            (i, json.dumps({"total_decisions": 10, "total_ev_loss": i}),
             json.dumps([{"decision_count": 10}, {}]),
             json.dumps({"overall": "A", "matches": ["B", "C"]}),
             json.dumps({"overall": "2026-10-22 10:00:00", "matches": [None, None]})),
        )
    conn.commit()
    yield conn, path
    conn.close()


def complete(conn):
    report, snapshot, previous = analyze(conn)
    review_id = record_review(conn, captured_at=report["captured_at"], snapshot=snapshot,
                              analysis=report, conclusion="Keep thresholds", previous_review_id=previous)
    return report, review_id


def test_review_clears_dated_and_legacy_grades_without_changing_threshold_date(calibration_db):
    conn, _ = calibration_db
    before = admin_maka_rank_stats(conn)
    assert (before["count"], before["undated"], before["reviewed"]) == (4, 8, False)
    report, review_id = complete(conn)
    assert report["reported_grades"] == 12
    assert report["usable_grades"] == 8
    assert report["unusable_grades"] == 4
    after = admin_maka_rank_stats(conn)
    assert (after["count"], after["overall"], after["hand"]) == (0, 0, 0)
    assert after["reviewed"] is True
    assert after["rank_updated_at"] == HAIPAI_RANK_UPDATED_AT
    assert after["reviewed_grades"] == 8
    assert latest_review(conn)["id"] == review_id


def test_new_and_edited_grades_during_analysis_stay_pending_even_with_same_save_date(calibration_db):
    conn, _ = calibration_db
    report, snapshot, previous = analyze(conn)
    # New slot with the same second as an already reviewed slot; date cutoffs
    # alone cannot distinguish these. Also edit a legacy (undated) grade.
    conn.execute("UPDATE games SET maka_ratings_json=?, maka_ratings_added_at_json=? WHERE id=1", (
        json.dumps({"overall": "S", "matches": ["A", "C", "B"]}),
        json.dumps({"overall": "2026-10-22 10:00:00", "matches": [None, None, "2026-10-22 10:00:00"]}),
    ))
    conn.commit()
    record_review(conn, captured_at=report["captured_at"], snapshot=snapshot, analysis=report,
                  conclusion="Keep thresholds", previous_review_id=previous)
    after = admin_maka_rank_stats(conn)
    assert (after["count"], after["overall"], after["hand"]) == (3, 1, 2)
    complete(conn)
    assert admin_maka_rank_stats(conn)["count"] == 0
    # Clearing and re-entering an unchanged reviewed value is not a new grade.
    saved = conn.execute("SELECT maka_ratings_json FROM games WHERE id=1").fetchone()[0]
    conn.execute("UPDATE games SET maka_ratings_json=NULL WHERE id=1")
    conn.commit()
    assert admin_maka_rank_stats(conn)["count"] == 0
    conn.execute("UPDATE games SET maka_ratings_json=? WHERE id=1", (saved,))
    conn.commit()
    assert admin_maka_rank_stats(conn)["count"] == 0


def test_stale_review_cannot_overwrite_a_newer_completed_review(calibration_db):
    conn, _ = calibration_db
    report, snapshot, previous = analyze(conn)
    _, first_id = complete(conn)
    with pytest.raises(ValueError, match="Another review"):
        record_review(conn, captured_at=report["captured_at"], snapshot=snapshot, analysis=report,
                      conclusion="Stale", previous_review_id=previous)
    assert latest_review(conn)["id"] == first_id


def test_analysis_is_read_only_and_records_shared_separate_and_hybrid_metrics(calibration_db):
    conn, path = calibration_db
    before = list(conn.iterdump())
    result = subprocess.run(
        [".venv/bin/python", "scripts/analyze_maka_ranks.py", "--db", str(path), "--json"],
        capture_output=True, text=True, check=True,
    )
    report = json.loads(result.stdout)
    assert set(report["scopes"]) == {"overall", "hand", "combined"}
    assert {"current", "sqrt", "separate_sqrt", "overall_only_sqrt"} <= set(
        report["scopes"]["combined"]["models"])
    assert report["scopes"]["overall"]["pending_usable"] == 4
    assert report["scopes"]["hand"]["pending_usable"] == 0
    assert list(conn.iterdump()) == before
    # The same CLI completes the review and verifies the actual admin count.
    result = subprocess.run(
        [".venv/bin/python", "scripts/analyze_maka_ranks.py", "--db", str(path), "--json",
         "--record-review", "--conclusion", "Keep thresholds"],
        capture_output=True, text=True, check=True,
    )
    result = json.loads(result.stdout)
    assert result["admin_after"]["count"] == 0
    assert result["review_id"] == latest_review(conn)["id"]


def test_holdouts_exclude_every_grade_of_the_tested_game_and_separate_kinds(monkeypatch):
    import scripts.analyze_maka_ranks as calibration

    samples = [{"game": game, "kind": kind, "ev": game, "grade": intercept - game}
               for game in range(1, 5) for kind, intercept in (("overall", 17), ("hand", 12))]
    original = calibration.fit_curve
    calls = []

    def spy(training, transform):
        calls.append(training)
        return original(training, transform)

    monkeypatch.setattr(calibration, "fit_curve", spy)
    assert evaluate(samples, lambda x: x, separate=True)[0] == 0
    for row, training in zip(samples, calls):
        assert len(training) == 3
        assert all(r["game"] != row["game"] and r["kind"] == row["kind"] for r in training)
    assert evaluate(samples, lambda x: x)[0] > 0
    assert evaluate(samples[:2], lambda x: x) is None
    assert evaluate([]) is None


def test_browser_half_step_rounding_and_empty_review_guard(calibration_db):
    assert rank(12.5) == 13
    assert rank(13.5) == 14
    assert rank(-1) == 1
    assert rank(25) == 17
    conn, _ = calibration_db
    with pytest.raises(ValueError, match="without usable grades"):
        record_review(conn, captured_at="2026-10-22", snapshot=grade_snapshot(conn),
                      analysis={"usable_grades": 0}, conclusion="No data", previous_review_id=None)
    assert latest_review(conn) is None
