"""Per-user mailbox API: list visible messages, mark single/all read.

There's no admin compose endpoint here on purpose — messages are created
out-of-band via CLI tooling that calls `db.create_message` directly.
"""

from flask import Blueprint, jsonify
from flask_login import current_user, login_required

import db

mailbox_bp = Blueprint("mailbox", __name__)


@mailbox_bp.route("/api/mailbox")
@login_required
def list_messages():
    from app import get_conn
    conn = get_conn()
    rows = db.list_messages_for_user(conn, current_user.id)
    for r in rows:
        r["unread"] = bool(r["unread"])
    return jsonify(rows)


@mailbox_bp.route("/api/mailbox/<int:message_id>/read", methods=["POST"])
@login_required
def mark_read(message_id):
    from app import get_conn
    conn = get_conn()
    if not db.mark_message_read(conn, current_user.id, message_id):
        return jsonify({"error": "Message not found"}), 404
    return jsonify({"ok": True})


@mailbox_bp.route("/api/mailbox/read-all", methods=["POST"])
@login_required
def mark_all_read():
    from app import get_conn
    conn = get_conn()
    db.mark_all_messages_read(conn, current_user.id)
    return jsonify({"ok": True})
