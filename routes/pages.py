#!/usr/bin/env python3
"""Top-level pages + miscellaneous APIs: index, tile assets, health,
trends, categories registry."""

from flask import Blueprint, jsonify, request, send_from_directory
from flask_login import current_user, login_required
from pathlib import Path

import db
from lib.categories import CATEGORY_INFO

DIR = Path(__file__).parent.parent
pages_bp = Blueprint("pages", __name__)


@pages_bp.route("/health")
def health():
    return {"status": "ok"}


@pages_bp.route("/")
def index():
    if not current_user.is_authenticated:
        return send_from_directory("static", "landing.html")
    return send_from_directory("static", "index.html")


@pages_bp.route("/impressum")
def impressum_de():
    return send_from_directory("static", "impressum-de.html")


@pages_bp.route("/imprint")
def impressum_en():
    return send_from_directory("static", "impressum-en.html")


@pages_bp.route("/datenschutz")
def datenschutz_de():
    return send_from_directory("static", "datenschutz-de.html")


@pages_bp.route("/privacy")
def datenschutz_en():
    return send_from_directory("static", "datenschutz-en.html")


@pages_bp.route("/tiles/<filename>")
def tiles(filename):
    return send_from_directory(DIR / "riichi-mahjong-tiles" / "Regular", filename)


@pages_bp.route("/api/categories")
def api_categories():
    return jsonify(CATEGORY_INFO)


@pages_bp.route("/api/trends")
@login_required
def api_trends():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    return jsonify(db.get_trends(conn, uid))


@pages_bp.route("/api/trends/snapshots")
@login_required
def api_trends_snapshots():
    from app import get_conn
    conn = get_conn()
    return jsonify(db.list_snapshots(conn, current_user.id))


@pages_bp.route("/api/trends/snapshot", methods=["POST"])
@login_required
def api_trends_snapshot():
    """Auto-saved after a trends weakness analysis completes. Dedupes when
    the previous snapshot has the same categorizer_version + game_id set."""
    from app import get_conn
    conn = get_conn()
    body = request.json or {}

    version = body.get("categorizer_version")
    if not isinstance(version, int) or version < 1:
        return jsonify({"error": "categorizer_version (positive int) required"}), 400

    game_ids = body.get("game_ids")
    if not isinstance(game_ids, list) or not all(isinstance(i, int) for i in game_ids):
        return jsonify({"error": "game_ids (list of int) required"}), 400
    if not game_ids:
        return jsonify({"error": "game_ids must be non-empty"}), 400

    by_category = body.get("by_category") or {}
    decision_counts = body.get("decision_counts") or {}
    if not isinstance(by_category, dict) or not isinstance(decision_counts, dict):
        return jsonify({"error": "by_category and decision_counts must be objects"}), 400

    # Confine game_ids to ones the caller actually owns. Silently filters
    # rather than 403s — the analysis runs over /api/trends, which is
    # already user-scoped, so a mismatch means stale local state, not abuse.
    owned = {
        r["id"] for r in conn.execute(
            "SELECT id FROM games WHERE user_id = ?", (current_user.id,)
        ).fetchall()
    }
    game_ids = [i for i in game_ids if i in owned]
    if not game_ids:
        return jsonify({"error": "no matching games"}), 400

    snapshot_id = db.insert_snapshot(
        conn, current_user.id, version, game_ids, by_category, decision_counts,
    )
    return jsonify({"ok": True, "snapshot_id": snapshot_id, "deduped": snapshot_id is None})
