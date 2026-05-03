#!/usr/bin/env python3
"""Admin routes: user stats, feedback management, GitHub issue creation, impersonation."""

from flask import Blueprint, jsonify, request, session
from flask_login import current_user, login_required, login_user
from functools import wraps
import os

import db
import requests as http_requests

admin_bp = Blueprint("admin", __name__)

IMPERSONATOR_SESSION_KEY = "impersonator_id"


def _effective_admin_id(conn):
    """Return the admin user id driving the session — either the logged-in admin,
    or the original admin if currently impersonating someone else. Returns
    ``None`` if no admin context."""
    imp_id = session.get(IMPERSONATOR_SESSION_KEY)
    if imp_id and db.is_admin(conn, imp_id):
        return imp_id
    if current_user.is_authenticated and db.is_admin(conn, current_user.id):
        return current_user.id
    return None


def require_admin(f):
    """Decorator that checks the session is driven by an admin (directly or
    via impersonation)."""
    @wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        from app import get_conn
        conn = get_conn()
        if _effective_admin_id(conn) is None:
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


# --- User feedback submission ---

@admin_bp.route("/api/feedback", methods=["POST"])
@login_required
def api_feedback():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    body = request.json or {}
    fb_type = body.get("type", "general")
    if fb_type not in ("bug", "feature", "general"):
        return jsonify({"error": "type must be bug, feature, or general"}), 400
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is required"}), 400
    if len(message) > 2000:
        return jsonify({"error": "Message too long (max 2000 chars)"}), 400
    conn.execute(
        "INSERT INTO feedback (user_id, type, message) VALUES (?, ?, ?)",
        (uid, fb_type, message),
    )
    conn.commit()

    # Discord webhook notification
    discord_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if discord_url:
        try:
            http_requests.post(discord_url, json={
                "content": f"**New feedback** ({fb_type}) from {current_user.username}:\n>>> {message[:500]}"
            }, timeout=5)
        except Exception:
            pass  # Non-critical

    return jsonify({"ok": True})


@admin_bp.route("/api/feedback/mine")
@login_required
def api_feedback_mine():
    from app import get_conn
    conn = get_conn()
    items = db.get_user_feedback(conn, current_user.id)
    return jsonify(items)


# --- Admin endpoints ---

@admin_bp.route("/api/admin/stats")
@require_admin
def api_admin_stats():
    from app import get_conn
    conn = get_conn()
    users = db.admin_user_stats(conn)
    return jsonify({"users": users, "total_users": len(users)})


@admin_bp.route("/api/admin/category-reports")
@require_admin
def api_admin_category_reports():
    from app import get_conn
    conn = get_conn()
    reports = db.list_category_reports(conn)
    return jsonify(reports)


@admin_bp.route("/api/admin/feedback")
@require_admin
def api_admin_feedback():
    from app import get_conn
    conn = get_conn()
    status = request.args.get("status")
    fb_type = request.args.get("type")
    items = db.list_feedback(conn, status=status, fb_type=fb_type)
    return jsonify(items)


@admin_bp.route("/api/admin/feedback/<int:feedback_id>", methods=["POST"])
@require_admin
def api_admin_feedback_update(feedback_id):
    from app import get_conn
    conn = get_conn()
    body = request.json or {}
    status = body.get("status")
    admin_note = body.get("admin_note")

    if status and status not in ("new", "in-progress", "resolved"):
        return jsonify({"error": "Invalid status"}), 400
    if admin_note is not None and len(admin_note) > 2000:
        return jsonify({"error": "Note too long"}), 400

    updates = {}
    if status:
        updates["status"] = status
    if admin_note is not None:
        updates["admin_note"] = admin_note

    if not updates:
        return jsonify({"error": "Nothing to update"}), 400

    item = db.get_feedback_item(conn, feedback_id)
    if not item:
        return jsonify({"error": "Feedback not found"}), 404

    db.update_feedback(conn, feedback_id, **updates)
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/feedback/<int:feedback_id>/create-issue", methods=["POST"])
@require_admin
def api_admin_create_issue(feedback_id):
    from app import get_conn
    conn = get_conn()
    item = db.get_feedback_item(conn, feedback_id)
    if not item:
        return jsonify({"error": "Feedback not found"}), 404
    if item.get("github_issue_url"):
        return jsonify({"error": "Issue already created", "url": item["github_issue_url"]}), 409

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return jsonify({"error": "GITHUB_TOKEN not configured"}), 500

    repo = os.environ.get("GITHUB_REPO", "goreil/haipai-mahjong")

    label_map = {"bug": "bug", "feature": "enhancement", "general": "feedback"}
    labels = ["feedback"]
    type_label = label_map.get(item["type"])
    if type_label and type_label != "feedback":
        labels.append(type_label)

    title = f"[feedback] {item['type']}: {item['message'][:60]}"
    body = (
        f"**From**: {item['username']}\n"
        f"**Type**: {item['type']}\n"
        f"**Date**: {item['created_at']}\n\n"
        f"---\n\n{item['message']}\n\n"
        f"---\n*Feedback ID: {feedback_id}*"
    )

    try:
        resp = http_requests.post(
            f"https://api.github.com/repos/{repo}/issues",
            headers={
                "Authorization": f"token {token}",
                "Accept": "application/vnd.github.v3+json",
            },
            json={"title": title, "body": body, "labels": labels},
            timeout=10,
        )
        resp.raise_for_status()
        issue_url = resp.json().get("html_url", "")
    except http_requests.RequestException as e:
        return jsonify({"error": f"GitHub API error: {e}"}), 502

    db.update_feedback(conn, feedback_id, github_issue_url=issue_url, status="in-progress")
    return jsonify({"ok": True, "url": issue_url})


# --- Impersonation ---

@admin_bp.route("/api/admin/impersonate/<int:user_id>", methods=["POST"])
@require_admin
def api_admin_impersonate(user_id):
    """Log the admin in as another user. The admin's own id is stashed in the
    session so /api/admin/impersonate/stop can swap back. Admins cannot nest
    impersonations — callers must stop first."""
    from app import get_conn, User
    conn = get_conn()

    stashed = session.get(IMPERSONATOR_SESSION_KEY)
    if stashed:
        # Recover from an inconsistent session: if the current user IS the
        # stashed admin (e.g. they logged out mid-impersonation and logged
        # back in without hitting /stop), the key is stale — just clear it.
        if stashed == current_user.id:
            session.pop(IMPERSONATOR_SESSION_KEY, None)
        else:
            return jsonify({"error": "Already impersonating — stop first"}), 409

    # _effective_admin_id == current_user.id here (no active impersonation)
    admin_id = current_user.id

    target = db.get_user_by_id(conn, user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if target["id"] == admin_id:
        return jsonify({"error": "Cannot impersonate yourself"}), 400

    session[IMPERSONATOR_SESSION_KEY] = admin_id
    login_user(User(target["id"], target["username"]))
    return jsonify({"ok": True, "impersonating": target["username"]})


@admin_bp.route("/api/admin/impersonate/stop", methods=["POST"])
@login_required
def api_admin_impersonate_stop():
    """Return the session to the original admin user."""
    from app import get_conn, User
    conn = get_conn()

    admin_id = session.get(IMPERSONATOR_SESSION_KEY)
    if not admin_id:
        return jsonify({"error": "Not impersonating"}), 400

    admin_row = db.get_user_by_id(conn, admin_id)
    if not admin_row or not db.is_admin(conn, admin_id):
        # Admin account vanished / demoted mid-session. Wipe the session key
        # and log out to avoid a stuck impersonation.
        session.pop(IMPERSONATOR_SESSION_KEY, None)
        return jsonify({"error": "Original admin no longer valid"}), 403

    session.pop(IMPERSONATOR_SESSION_KEY, None)
    login_user(User(admin_row["id"], admin_row["username"]))
    return jsonify({"ok": True, "username": admin_row["username"]})
