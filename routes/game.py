#!/usr/bin/env python3
"""Game CRUD routes: list, get, delete, add, annotate, categorize, backfill."""

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pathlib import Path
import json
import sys
import threading

import db
from lib.parse import parse_game
from lib.categories import compute_summary

DIR = Path(__file__).parent.parent
games_bp = Blueprint("games", __name__)


@games_bp.route("/api/games")
@login_required
def api_games():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    return jsonify(db.list_games(conn, uid))


@games_bp.route("/api/games/<int:game_id>")
@login_required
def api_game(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    game = db.get_game(conn, game_id, user_id=uid)
    if not game:
        return jsonify({"error": "Game not found"}), 404
    return jsonify(game)


@games_bp.route("/api/games/<int:game_id>", methods=["DELETE"])
@login_required
def api_delete_game(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    if not db.delete_game(conn, game_id, user_id=uid):
        return jsonify({"error": "Game not found"}), 404
    remaining = conn.execute(
        "SELECT COUNT(*) FROM games WHERE user_id = ?", (uid,)
    ).fetchone()[0]
    return jsonify({"ok": True, "remaining": remaining})


@games_bp.route("/api/games/<int:game_id>/annotate", methods=["POST"])
@login_required
def api_annotate(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    body = request.json
    if not body:
        return jsonify({"error": "JSON body required"}), 400
    round_name = body.get("round")
    turn = body.get("turn")
    index = body.get("index", 0)
    category = body.get("category")
    note = body.get("note")

    if not isinstance(round_name, str) or not isinstance(turn, int):
        return jsonify({"error": "round (string) and turn (int) required"}), 400
    if category is not None and not isinstance(category, str):
        return jsonify({"error": "category must be a string"}), 400
    if note is not None and not isinstance(note, str):
        return jsonify({"error": "note must be a string"}), 400
    if note and len(note) > 1000:
        return jsonify({"error": "note too long (max 1000 chars)"}), 400

    VALID_CATEGORIES = {"", "P1", "P2", "P3", "P4", "D1", "D2", "D3",
                        "1A", "2A", "3A", "3B", "3C",
                        "4A", "4B", "4C", "5A", "5B", "6A", "6B"}
    if category and category not in VALID_CATEGORIES:
        return jsonify({"error": f"Invalid category: {category}"}), 400

    result = db.annotate_mistake(conn, game_id, round_name, turn, index, category, note, user_id=uid)
    if not result:
        return jsonify({"error": "Mistake not found"}), 404

    stats = db.compute_summary_for_game(conn, game_id)
    return jsonify({"ok": True, "summary": stats})


@games_bp.route("/api/mistakes/<int:mistake_id>/report", methods=["POST"])
@login_required
def api_report_category(mistake_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    # Verify the mistake belongs to the user
    owner = conn.execute(
        "SELECT g.user_id FROM mistakes m JOIN games g ON m.game_id = g.id WHERE m.id = ?",
        (mistake_id,),
    ).fetchone()
    if not owner or owner["user_id"] != uid:
        return jsonify({"error": "Mistake not found"}), 404

    body = request.json or {}
    kind = body.get("kind")
    if kind not in db.REPORT_KINDS:
        return jsonify({"error": f"kind must be one of {list(db.REPORT_KINDS)}"}), 400

    suggested = body.get("suggested_category")
    reason = body.get("reason")
    if suggested is not None and not isinstance(suggested, str):
        return jsonify({"error": "suggested_category must be a string"}), 400
    if reason is not None and not isinstance(reason, str):
        return jsonify({"error": "reason must be a string"}), 400
    if reason and len(reason) > 500:
        return jsonify({"error": "reason too long (max 500 chars)"}), 400

    if kind == "wrong_category" and not suggested:
        return jsonify({"error": "suggested_category required for wrong_category"}), 400

    report_id = db.submit_category_report(conn, uid, mistake_id,
                                          kind=kind, suggested_category=suggested,
                                          reason=reason)
    return jsonify({"ok": True, "id": report_id})


@games_bp.route("/api/games/<int:game_id>/categorize", methods=["POST"])
@login_required
def api_categorize(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    game = db.get_game(conn, game_id, user_id=uid)
    if not game:
        return jsonify({"error": "Game not found"}), 404

    body = request.json or {}
    force = body.get("force", False)

    # Set status to pending and run in background
    conn.execute(
        "UPDATE games SET categorization_status = 'pending' WHERE id = ?",
        (game_id,),
    )
    conn.commit()

    threading.Thread(
        target=_prepare_data_background,
        args=(game_id, force),
        daemon=True,
    ).start()

    return jsonify({"ok": True, "status": "pending"})


@games_bp.route("/api/games/backfill-board-state", methods=["POST"])
@login_required
def api_backfill_board_state():
    """Populate board_state on all mistakes missing it (no API calls needed)."""
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    game_ids = [r["id"] for r in conn.execute(
        "SELECT id FROM games WHERE user_id = ?", (uid,)
    ).fetchall()]

    from lib.categorize import backfill_board_state_db
    total_updated = 0
    for gid in game_ids:
        total_updated += backfill_board_state_db(conn, gid)
    return jsonify({"ok": True, "games_processed": len(game_ids), "updated": total_updated})


@games_bp.route("/api/games/backfill-discard-stats", methods=["POST"])
@login_required
def api_backfill_discard_stats():
    """Re-fetch discard_stats for dahai-vs-dahai mistakes so they include per-tile
    necessary_tiles (needed by the ukeire visualization). Preserves category
    and note annotations — only discard_stats and best_discard are rewritten.

    Accepts {"game_id": int} to target a single game, or runs on all of the
    user's games when omitted. {"force": true} re-runs even when the stored
    discard_stats already has necessary_tiles.
    """
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    body = request.json or {}
    force = bool(body.get("force", False))
    game_id = body.get("game_id")

    if game_id is not None:
        game = db.get_game(conn, int(game_id), user_id=uid)
        if not game:
            return jsonify({"error": "Game not found"}), 404
        game_ids = [int(game_id)]
    else:
        game_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM games WHERE user_id = ?", (uid,)
        ).fetchall()]

    from lib.categorize import backfill_discard_stats_db
    total_updated = 0
    for gid in game_ids:
        total_updated += backfill_discard_stats_db(conn, gid, force=force)
    return jsonify({"ok": True, "games_processed": len(game_ids),
                    "updated": total_updated})


@games_bp.route("/api/games/backfill-safety", methods=["POST"])
@login_required
def api_backfill_safety():
    """Compute safety_ratings + opponent_discards for defense-relevant mistakes
    (riichi OR 3+ open-meld threats).

    Accepts {"game_id": int} to target one game (default: all of the user's
    games) and {"force": true} to re-compute even when safety is already set.
    """
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    body = request.json or {}
    force = bool(body.get("force", False))
    game_id = body.get("game_id")

    if game_id is not None:
        game = db.get_game(conn, int(game_id), user_id=uid)
        if not game:
            return jsonify({"error": "Game not found"}), 404
        game_ids = [int(game_id)]
    else:
        game_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM games WHERE user_id = ?", (uid,)
        ).fetchall()]

    from lib.categorize import backfill_safety_ratings_db
    total_updated = 0
    for gid in game_ids:
        total_updated += backfill_safety_ratings_db(conn, gid, force=force)
    return jsonify({"ok": True, "games_processed": len(game_ids),
                    "updated": total_updated})


@games_bp.route("/api/games/backfill-decisions", methods=["POST"])
@login_required
def api_backfill_decisions():
    """Backfill decision_count and per-category decision_counts from mortal
    files, then recompute stats. Skips games that already have both fields
    on every round."""
    from app import get_conn
    from lib.parse import _decision_counts_for_kyoku, flatten_mjai_log
    conn = get_conn()
    uid = current_user.id

    games = conn.execute(
        "SELECT id, mortal_file, rounds_json FROM games WHERE user_id = ?", (uid,)
    ).fetchall()

    updated = 0
    for g in games:
        rounds = json.loads(g["rounds_json"]) if g["rounds_json"] else []
        if not rounds or not g["mortal_file"]:
            continue
        fully_populated = all(
            r.get("decision_count") and r.get("decision_counts") for r in rounds
        )
        if fully_populated:
            db.compute_summary_for_game(conn, g["id"])
            continue

        mortal_path = (DIR / g["mortal_file"]).resolve()
        if not str(mortal_path).startswith(str(DIR.resolve())):
            continue
        if not mortal_path.exists():
            continue

        with open(mortal_path) as f:
            mortal_data = json.load(f)

        kyokus = mortal_data.get("review", {}).get("kyokus", [])
        flat_events = flatten_mjai_log(mortal_data.get("mjai_log", []))
        start_positions = [
            i for i, e in enumerate(flat_events) if e.get("type") == "start_kyoku"
        ]
        player_id = mortal_data.get("player_id")

        for i, rnd in enumerate(rounds):
            if i >= len(kyokus):
                continue
            entries = kyokus[i].get("entries", [])
            if not rnd.get("decision_count"):
                rnd["decision_count"] = len(entries)
            if (not rnd.get("decision_counts")
                    and player_id is not None
                    and i < len(start_positions)):
                start_pos = start_positions[i]
                end_pos = (start_positions[i + 1]
                           if i + 1 < len(start_positions) else len(flat_events))
                rnd["decision_counts"] = _decision_counts_for_kyoku(
                    entries, start_pos, end_pos, flat_events, player_id,
                )

        conn.execute(
            "UPDATE games SET rounds_json = ? WHERE id = ?",
            (json.dumps(rounds), g["id"]),
        )
        db.compute_summary_for_game(conn, g["id"])
        updated += 1

    return jsonify({"ok": True, "updated": updated, "total": len(games)})


@games_bp.route("/api/games/add", methods=["POST"])
@login_required
def api_add():
    from datetime import date
    from app import get_conn

    conn = get_conn()
    uid = current_user.id

    body = request.json
    mortal_data = body.get("mortal_data")
    game_date = body.get("date") or date.today().isoformat()

    if not mortal_data or not isinstance(mortal_data, dict):
        return jsonify({"error": "mortal_data is required (Mortal analysis JSON)"}), 400

    # Save Mortal JSON to disk (needed by categorizer for wall reconstruction)
    import hashlib
    mortal_dir = DIR / "mortal_analysis"
    mortal_dir.mkdir(exist_ok=True)
    mortal_bytes = json.dumps(mortal_data, ensure_ascii=False).encode()
    filename = hashlib.sha256(mortal_bytes).hexdigest()[:16] + ".json"
    dest = mortal_dir / filename
    if not dest.exists():
        dest.write_bytes(mortal_bytes)

    try:
        game_dict = parse_game(mortal_data, game_date=game_date)
    except (ValueError, KeyError, IndexError, TypeError) as e:
        return jsonify({"error": f"Failed to parse Mortal data: {e}"}), 400
    game_dict["mortal_file"] = str(dest.relative_to(DIR))
    compute_summary(game_dict)

    game_dict["categorization_status"] = "pending"
    game_id = db.add_game(conn, uid, game_dict)

    # Kick off categorization in background thread
    threading.Thread(
        target=_prepare_data_background,
        args=(game_id,),
        daemon=True,
    ).start()

    return jsonify({"ok": True, "game_id": game_id, "summary": game_dict.get("summary", {})})


def _prepare_data_background(game_id, force=False):
    """Run mistake input-prep in a background thread with its own DB connection.

    Categorization itself is JS-side; this only computes the inputs the
    frontend categorizer reads (discard_stats, defense_kd payload, 5A/5B
    riichi patches). The `categorization_status` column is reused to
    signal "data is ready".
    """
    from lib.categorize import prepare_game_data
    conn = db.get_db()
    try:
        prepare_game_data(conn, game_id, force=force)
        db.compute_summary_for_game(conn, game_id)
        conn.execute(
            "UPDATE games SET categorization_status = 'done' WHERE id = ?",
            (game_id,),
        )
        conn.commit()
    except Exception as e:
        conn.execute(
            "UPDATE games SET categorization_status = 'failed' WHERE id = ?",
            (game_id,),
        )
        conn.commit()
        print(f"Background categorization failed for game {game_id}: {e}", file=sys.stderr)
    finally:
        conn.close()
