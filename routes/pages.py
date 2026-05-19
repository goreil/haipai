#!/usr/bin/env python3
"""Top-level pages + miscellaneous APIs: index, tile assets, health,
trends, categories registry."""

from flask import Blueprint, jsonify, send_from_directory
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
