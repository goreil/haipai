#!/usr/bin/env python3
"""Top-level pages + miscellaneous APIs: index, tile assets, health,
trends, top-mistakes, categories registry."""

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


@pages_bp.route("/api/top-mistakes")
@login_required
def api_top_mistakes():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    group = request.args.get("group")
    limit = min(int(request.args.get("limit", 5)), 20)
    games_limit = min(int(request.args.get("games", 10)), 50)

    # Get recent game IDs
    game_ids = [r["id"] for r in conn.execute(
        "SELECT id FROM games WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?",
        (uid, games_limit),
    ).fetchall()]
    if not game_ids:
        return jsonify([])

    placeholders = ",".join("?" * len(game_ids))
    where = f"m.game_id IN ({placeholders}) AND m.category IS NOT NULL"
    params = list(game_ids)

    if group:
        # Map group name to category prefixes
        GROUP_PREFIXES = {
            "Attack": ["P1", "P2", "P3", "P4", "1A", "2A", "3A", "3C"],
            "Defense": ["D1", "D2", "D3", "3B"],
            "Meld": ["4A", "4B", "4C"],
            "Riichi": ["5A", "5B"], "Kan": ["6A", "6B"],
            # Legacy group names
            "Push": ["P1", "P2", "P3", "P4", "1A", "2A", "3A", "3C"],
            "Efficiency": ["1A", "P1", "P2"], "Value Tiles": ["2A", "P3"],
            "Strategy": ["3A", "3B", "3C", "P4", "D1", "D2", "D3"],
        }
        cats = GROUP_PREFIXES.get(group, [])
        if cats:
            cat_ph = ",".join("?" * len(cats))
            where += f" AND m.category IN ({cat_ph})"
            params.extend(cats)

    rows = conn.execute(
        f"""SELECT m.*, g.date FROM mistakes m
            JOIN games g ON m.game_id = g.id
            WHERE {where}
            ORDER BY m.ev_loss DESC LIMIT ?""",
        params + [limit],
    ).fetchall()

    results = []
    for r in rows:
        m = db.row_to_mistake(r)
        m["game_id"] = r["game_id"]
        m["game_date"] = r["date"]
        m["round_name"] = r["round_name"]
        results.append(m)
    return jsonify(results)
