#!/usr/bin/env python3
"""Admin routes: user stats, category-report triage, impersonation, GDPR delete."""

from flask import Blueprint, jsonify, request, session
from flask_login import current_user, login_required, login_user
from functools import wraps

import db

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
    """Return reports plus slim mortal_data per game so the admin UI can run
    the same JS prep + categorize the reporter saw. Without mortal_data the
    embedded mistake card would render with no board context and no AI
    category (both are computed client-side after the b2f migration).

    ``?scope=others`` (default) hides the effective admin's own reports so
    the initial load stays small; ``?scope=all`` returns everything.
    """
    from app import get_conn
    from routes.game import load_slim_mortal_data
    conn = get_conn()
    scope = request.args.get("scope", "others")
    exclude_user_id = _effective_admin_id(conn) if scope == "others" else None
    reports = db.list_category_reports(conn, exclude_user_id=exclude_user_id)

    mortal_by_game = {}
    for r in reports:
        gid = r["game_id"]
        if gid in mortal_by_game:
            continue
        md = load_slim_mortal_data(r.pop("mortal_file", None))
        mortal_by_game[gid] = md
    # Strip the mortal_file path from any remaining reports (kept off the wire).
    for r in reports:
        r.pop("mortal_file", None)

    return jsonify({"reports": reports, "mortal_data_by_game": mortal_by_game})


@admin_bp.route("/api/admin/category-reports/<int:report_id>", methods=["DELETE"])
@require_admin
def api_admin_delete_category_report(report_id):
    from app import get_conn
    conn = get_conn()
    if not db.delete_category_report(conn, report_id):
        return jsonify({"error": "Report not found"}), 404
    return jsonify({"ok": True})


# --- Global category-shape snapshot ---
#
# The mistake categorizer is client-side only (static/js/categorize.js) and the
# container has no Node, so the shape distribution can't be tallied in Python.
# Instead the admin browser runs the same prep + categorize the app uses, over
# every game. These endpoints feed that loop (the per-game payload is identical
# in spirit to what /api/games/<id> ships, but cross-user and admin-gated) and
# persist the resulting tally so the "complex" bucket can be tracked over time.

@admin_bp.route("/api/admin/snapshot/game-ids")
@require_admin
def api_admin_snapshot_game_ids():
    """All game ids across all users, for the client-side snapshot loop."""
    from app import get_conn
    conn = get_conn()
    rows = conn.execute("SELECT id FROM games ORDER BY id").fetchall()
    return jsonify({"game_ids": [r["id"] for r in rows]})


@admin_bp.route("/api/admin/snapshot/game/<int:game_id>")
@require_admin
def api_admin_snapshot_game(game_id):
    """One game's rounds+mistakes plus slim mortal_data, regardless of owner,
    so the admin browser can prep + categorize it. Mirrors the per-game fetch
    the trends pipeline does, minus the owner scoping."""
    from app import get_conn
    from routes.game import load_slim_mortal_data
    conn = get_conn()
    game = db.get_game(conn, game_id)  # user_id=None → no owner filter
    if not game:
        return jsonify({"error": "Game not found"}), 404
    row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    mortal_data = load_slim_mortal_data(row["mortal_file"] if row else None)
    return jsonify({"game": game, "mortal_data": mortal_data})


@admin_bp.route("/api/admin/category-snapshots")
@require_admin
def api_admin_list_category_snapshots():
    """History of saved global shape snapshots, newest first."""
    from app import get_conn
    conn = get_conn()
    return jsonify({"snapshots": db.list_category_snapshots(conn)})


@admin_bp.route("/api/admin/category-snapshots", methods=["POST"])
@require_admin
def api_admin_save_category_snapshot():
    """Persist a snapshot the admin browser just computed. Body:
    { categorizer_version, game_count, mistake_count, summary }."""
    from app import get_conn
    conn = get_conn()
    data = request.get_json(silent=True) or {}
    try:
        cv = int(data["categorizer_version"])
        gc = int(data["game_count"])
        mc = int(data["mistake_count"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Missing/invalid snapshot fields"}), 400
    summary = data.get("summary") or {}
    if not isinstance(summary, dict):
        return jsonify({"error": "summary must be an object"}), 400
    snap_id = db.insert_category_snapshot(conn, cv, gc, mc, summary)
    return jsonify({"ok": True, "id": snap_id})


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


def _do_impersonate_owner(conn, owner_id):
    """Switch the session to view as ``owner_id``, driven by the effective admin.

    Unlike ``api_admin_impersonate`` this is idempotent and never errors on a
    pre-existing impersonation: it swaps the target directly (admin → A → B),
    no-ops when already viewing as ``owner_id``, and drops impersonation when
    the owner is the admin themselves. Powers the admin deep-link auto-jump so
    opening another user's game/mistake URL "just works".

    Returns ``(body_dict, http_code)``.
    """
    from app import User
    admin_id = _effective_admin_id(conn)  # the real admin, even mid-impersonation
    if admin_id is None:
        return {"error": "Admin access required"}, 403
    owner = db.get_user_by_id(conn, owner_id)
    if not owner:
        return {"error": "User not found"}, 404
    if owner_id == admin_id:
        # Admin owns the target — clear any active impersonation, view as self.
        if session.get(IMPERSONATOR_SESSION_KEY):
            session.pop(IMPERSONATOR_SESSION_KEY, None)
            admin_row = db.get_user_by_id(conn, admin_id)
            login_user(User(admin_row["id"], admin_row["username"]))
        return {"ok": True, "impersonating": None, "username": owner["username"]}, 200
    session[IMPERSONATOR_SESSION_KEY] = admin_id
    login_user(User(owner["id"], owner["username"]))
    return {"ok": True, "impersonating": owner["username"]}, 200


@admin_bp.route("/api/admin/impersonate-for-game/<int:game_id>", methods=["POST"])
@require_admin
def api_admin_impersonate_for_game(game_id):
    """Impersonate the owner of ``game_id`` so an admin deep-link to another
    user's game resolves on reload. Idempotent — swaps directly between owners."""
    from app import get_conn
    conn = get_conn()
    row = conn.execute("SELECT user_id FROM games WHERE id = ?", (game_id,)).fetchone()
    if not row:
        return jsonify({"error": "Game not found"}), 404
    body, code = _do_impersonate_owner(conn, row["user_id"])
    return jsonify(body), code


@admin_bp.route("/api/admin/impersonate-for-mistake/<int:mistake_id>", methods=["POST"])
@require_admin
def api_admin_impersonate_for_mistake(mistake_id):
    """Impersonate the owner of the game that ``mistake_id`` belongs to, so an
    admin ``#m<id>`` deep-link resolves on reload."""
    from app import get_conn
    conn = get_conn()
    row = conn.execute(
        "SELECT g.user_id FROM mistakes m JOIN games g ON m.game_id = g.id WHERE m.id = ?",
        (mistake_id,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Mistake not found"}), 404
    body, code = _do_impersonate_owner(conn, row["user_id"])
    return jsonify(body), code


# --- GDPR user deletion ---

@admin_bp.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
@require_admin
def api_admin_delete_user(user_id):
    """Hard-delete a user and every row attached to them.

    Refuses while impersonating (the session is in a confused state and the
    target check would compare against the impersonated identity, not the
    admin's). Refuses self-deletion and refuses to remove the last admin.
    """
    from app import get_conn
    conn = get_conn()

    if session.get(IMPERSONATOR_SESSION_KEY):
        return jsonify({"error": "Stop impersonating before deleting users"}), 409

    if user_id == current_user.id:
        return jsonify({"error": "Cannot delete your own account"}), 400

    target = db.get_user_by_id(conn, user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    if target["is_admin"]:
        admin_count = conn.execute(
            "SELECT COUNT(*) FROM users WHERE is_admin = 1"
        ).fetchone()[0]
        if admin_count <= 1:
            return jsonify({"error": "Cannot delete the last admin"}), 400

    counts = db.delete_user_cascade(conn, user_id)
    return jsonify({"ok": True, "username": target["username"], "deleted": counts})


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
