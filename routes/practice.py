#!/usr/bin/env python3
"""Practice mode routes: problems, results, stats."""

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

import db

practice_bp = Blueprint("practice", __name__)


@practice_bp.route("/api/practice")
@login_required
def api_practice():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    sev = request.args.get("severity")
    group = request.args.get("group")
    defense = request.args.get("defense") == "1"
    calc_agree = request.args.get("calc_agree") == "1"

    pick = db.get_practice_problem(conn, uid, severity=sev, group=group,
                                   defense_only=defense, calc_agree=calc_agree)
    if not pick:
        return jsonify({"error": "No matching practice problems"}), 404
    return jsonify(pick)


@practice_bp.route("/api/practice/public")
def api_practice_public():
    from app import get_conn
    conn = get_conn()
    sev = request.args.get("severity")
    group = request.args.get("group")
    defense = request.args.get("defense") == "1"
    calc_agree = request.args.get("calc_agree") == "1"

    pick = db.get_public_practice_problem(conn, severity=sev, group=group,
                                          defense_only=defense, calc_agree=calc_agree)
    if not pick:
        return jsonify({"error": "No matching practice problems"}), 404
    return jsonify(pick)


@practice_bp.route("/api/practice/result", methods=["POST"])
@login_required
def api_practice_result():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    body = request.json
    if not body:
        return jsonify({"error": "JSON body required"}), 400
    mistake_id = body.get("mistake_id")
    correct = body.get("correct", False)
    if not isinstance(mistake_id, int):
        return jsonify({"error": "mistake_id (int) required"}), 400
    if not db.record_practice_result(conn, uid, mistake_id, correct):
        return jsonify({"error": "Mistake not found"}), 404
    return jsonify({"ok": True})


@practice_bp.route("/api/practice/stats")
@login_required
def api_practice_stats():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    return jsonify(db.get_practice_stats(conn, uid))
