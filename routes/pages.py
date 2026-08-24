#!/usr/bin/env python3
"""Top-level pages + miscellaneous APIs: index, tile assets, health, trends."""

from flask import Blueprint, abort, current_app, jsonify, redirect, request, send_from_directory
from flask_login import current_user, login_required
from pathlib import Path

import db

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


@pages_bp.route("/play")
def play():
    """Public minigame arcade — the Waits and Defense trainers, no account.

    Both trainers are pure client-side games; the only thing a session buys is
    a row on the leaderboard, so there is no reason to gate playing on one.
    `static/play.html` is a deliberately minimal shell (no sidebar, mailbox,
    admin or game list) in the same spirit as `shared.html`: the guest view
    reuses the trainers themselves rather than running the full SPA degraded.

    A logged-in visitor is bounced to the real app instead, so they get the
    trainer with their own leaderboard identity. Browsers carry the fragment
    across a redirect that has none of its own, so `/play#defense-trainer`
    lands on `/#defense-trainer` and the SPA router picks the same trainer.
    """
    if current_user.is_authenticated:
        return redirect("/")
    return send_from_directory("static", "play.html")


@pages_bp.route("/shared/<token>")
def shared_game(token):
    """Public read-only game view. Always served regardless of auth state —
    the token itself is resolved client-side against /api/shared/<token>, so
    a bad/revoked token just renders a not-found state in-page."""
    return send_from_directory("static", "shared.html")


@pages_bp.route("/demo")
def demo():
    """Stable, bookmarkable demo link: redirects to whichever game
    DEMO_GAME_ID designates, generating its share token on first visit.
    Swapping the demo game is a one-line env change, no template edits."""
    demo_game_id = current_app.config.get("DEMO_GAME_ID")
    if not demo_game_id:
        abort(404)
    from app import get_conn
    conn = get_conn()
    row = conn.execute("SELECT user_id FROM games WHERE id = ?", (demo_game_id,)).fetchone()
    if not row:
        abort(404)
    token = db.get_or_create_share_token(conn, demo_game_id, row["user_id"])
    return redirect(f"/shared/{token}")


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

    # Richer, already-merged breakdown (same shapes the live trends page
    # renders from) — optional, so an older client that only ever sends
    # by_category/decision_counts still works.
    by_skill_facet = body.get("by_skill_facet") or {}
    concept_agg = body.get("concept_agg")
    concept_boxes = body.get("concept_boxes") or []
    if not isinstance(by_skill_facet, dict) or not isinstance(concept_boxes, list):
        return jsonify({"error": "by_skill_facet must be an object and concept_boxes a list"}), 400
    if concept_agg is not None and not isinstance(concept_agg, dict):
        return jsonify({"error": "concept_agg must be an object"}), 400

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
        by_skill_facet=by_skill_facet, concept_agg=concept_agg, concept_boxes=concept_boxes,
    )
    return jsonify({"ok": True, "snapshot_id": snapshot_id, "deduped": snapshot_id is None})
