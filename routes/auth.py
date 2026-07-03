#!/usr/bin/env python3
"""Auth routes: login/register/logout, OAuth (discord + google), /api/me + /api/me/*."""

import json
import os
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, jsonify, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash, generate_password_hash

import db
from lib.mail import send_verification_email

auth_bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
VERIFY_TOKEN_LIFETIME = timedelta(hours=24)


def _utc_now_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _new_verify_expiry():
    return (datetime.now(timezone.utc) + VERIFY_TOKEN_LIFETIME).strftime("%Y-%m-%d %H:%M:%S")


# --- Login / register / logout ---

@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    from app import User, get_conn, oauth

    if current_user.is_authenticated:
        return redirect("/")
    error = None
    unverified_username = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        conn = get_conn()
        user_row = db.get_user_by_username(conn, username)
        # Always hash to prevent timing-based username enumeration
        pw_hash = user_row["password_hash"] if user_row else "pbkdf2:sha256:dummy"
        valid = check_password_hash(pw_hash, password)
        if user_row and valid:
            # OAuth-created accounts have no email on file and are exempt.
            if user_row["email"] and not user_row["email_verified"]:
                error = "Please verify your email address before logging in."
                unverified_username = username
            else:
                remember = bool(request.form.get("remember"))
                login_user(User(user_row["id"], user_row["username"]), remember=remember)
                return redirect("/")
        else:
            error = "Invalid username or password"
    return render_template("login.html", title="Login", error=error, register=False,
                           unverified_username=unverified_username,
                           has_discord="discord" in oauth._clients,
                           has_google="google" in oauth._clients)


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    from app import User, get_conn, oauth

    if current_user.is_authenticated:
        return redirect("/")
    error = None
    info = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        email = request.form.get("email", "").strip().lower()
        conn = get_conn()

        if not username or not password or not email:
            error = "Username, password, and email are required"
        elif len(password) < 8:
            error = "Password must be at least 8 characters"
        elif not EMAIL_RE.match(email):
            error = "Enter a valid email address"
        else:
            try:
                pw_hash = generate_password_hash(password)
                token = secrets.token_urlsafe(32)
                db.create_user(conn, username, pw_hash, email=email,
                               verify_token=token, verify_expires=_new_verify_expiry())
            except Exception:
                error = "Username or email already in use"
            else:
                verify_url = url_for("auth.verify_email", token=token, _external=True)
                if not send_verification_email(email, username, verify_url):
                    print(f"Failed to send verification email to {email!r} for new user {username!r}",
                          file=sys.stderr)
                return render_template("login.html", title="Register", register=True, hide_form=True,
                                       info="Account created! Check your email for a link to activate it.",
                                       has_discord="discord" in oauth._clients,
                                       has_google="google" in oauth._clients)
    return render_template("login.html", title="Register", error=error, info=info, register=True,
                           has_discord="discord" in oauth._clients,
                           has_google="google" in oauth._clients)


@auth_bp.route("/verify-email/<token>")
def verify_email(token):
    from app import User, get_conn, oauth

    if current_user.is_authenticated:
        return redirect("/")
    conn = get_conn()
    user_row = db.get_user_by_verify_token(conn, token)
    error = None
    if not user_row:
        error = "Invalid or already-used verification link."
    elif user_row["email_verify_expires"] and user_row["email_verify_expires"] < _utc_now_str():
        error = "This verification link has expired. Log in and request a new one."
    if error:
        return render_template("login.html", title="Login", error=error, register=False,
                               has_discord="discord" in oauth._clients,
                               has_google="google" in oauth._clients)
    db.mark_email_verified(conn, user_row["id"])
    login_user(User(user_row["id"], user_row["username"]), remember=True)
    return redirect("/")


@auth_bp.route("/resend-verification", methods=["POST"])
def resend_verification():
    from app import get_conn, oauth

    conn = get_conn()
    username = request.form.get("username", "").strip()
    user_row = db.get_user_by_username(conn, username)
    if user_row and user_row["email"] and not user_row["email_verified"]:
        token = secrets.token_urlsafe(32)
        db.set_verify_token(conn, user_row["id"], token, _new_verify_expiry())
        verify_url = url_for("auth.verify_email", token=token, _external=True)
        send_verification_email(user_row["email"], user_row["username"], verify_url)
    # Same response either way — don't reveal whether the account/email exists.
    return render_template("login.html", title="Login", register=False,
                           info="If that account needs verification, we've sent a new link.",
                           has_discord="discord" in oauth._clients,
                           has_google="google" in oauth._clients)


@auth_bp.route("/logout")
def logout():
    # Clear any stashed impersonation so the next login starts fresh.
    from routes.admin import IMPERSONATOR_SESSION_KEY
    session.pop(IMPERSONATOR_SESSION_KEY, None)
    logout_user()
    return redirect("/login")


# --- OAuth ---

def _oauth_login_or_create(provider, oauth_id, display_name):
    """Shared logic: find existing user by OAuth ID, or create one. Log them in."""
    from app import User, get_conn

    conn = get_conn()
    user_row = db.get_user_by_oauth(conn, provider, oauth_id)
    if user_row:
        login_user(User(user_row["id"], user_row["username"]), remember=True)
        return redirect("/")
    # If logged in, link to existing account
    if current_user.is_authenticated:
        db.link_oauth(conn, current_user.id, provider, oauth_id)
        return redirect("/")
    # Create new account
    user_id, username = db.create_oauth_user(conn, provider, oauth_id, display_name)
    login_user(User(user_id, username), remember=True)
    return redirect("/")


@auth_bp.route("/auth/discord")
def auth_discord():
    from flask import url_for
    from app import oauth
    if "discord" not in oauth._clients:
        return "Discord login not configured", 404
    redirect_uri = url_for("auth.auth_discord_callback", _external=True)
    return oauth.discord.authorize_redirect(redirect_uri)


@auth_bp.route("/auth/discord/callback")
def auth_discord_callback():
    from app import oauth
    if "discord" not in oauth._clients:
        return "Discord login not configured", 404
    token = oauth.discord.authorize_access_token()
    resp = oauth.discord.get("users/@me", token=token)
    profile = resp.json()
    discord_id = profile["id"]
    display_name = profile.get("global_name") or profile["username"]
    return _oauth_login_or_create("discord", discord_id, display_name)


@auth_bp.route("/auth/google")
def auth_google():
    from flask import url_for
    from app import oauth
    if "google" not in oauth._clients:
        return "Google login not configured", 404
    redirect_uri = url_for("auth.auth_google_callback", _external=True)
    nonce = os.urandom(16).hex()
    session["google_nonce"] = nonce
    return oauth.google.authorize_redirect(redirect_uri, nonce=nonce)


@auth_bp.route("/auth/google/callback")
def auth_google_callback():
    from app import oauth
    if "google" not in oauth._clients:
        return "Google login not configured", 404
    token = oauth.google.authorize_access_token()
    nonce = session.pop("google_nonce", None)
    user_info = oauth.google.parse_id_token(token, nonce=nonce)
    google_id = user_info["sub"]
    display_name = user_info.get("name") or user_info.get("given_name") or "player"
    return _oauth_login_or_create("google", google_id, display_name)


# --- /api/me + /api/me/* ---

@auth_bp.route("/api/me")
@login_required
def api_me():
    from flask_wtf.csrf import generate_csrf
    from app import get_conn
    from routes.admin import IMPERSONATOR_SESSION_KEY

    conn = get_conn()
    user_row = db.get_user_by_id(conn, current_user.id)
    imp_id = session.get(IMPERSONATOR_SESSION_KEY)
    impersonating = None
    is_admin = db.is_admin(conn, current_user.id)
    # Only treat as actively impersonating when the stashed admin is someone
    # OTHER than the currently-logged-in user. Otherwise the session is a
    # stale leftover (e.g. logout + re-login as the admin) and should be a
    # no-op for the UI.
    if imp_id and imp_id != current_user.id and db.is_admin(conn, imp_id):
        imp_row = db.get_user_by_id(conn, imp_id)
        if imp_row:
            impersonating = {
                "viewing_as": current_user.username,
                "admin_username": imp_row["username"],
            }
            is_admin = True
    elif imp_id == current_user.id:
        # Stale key — clear it so subsequent requests are clean.
        session.pop(IMPERSONATOR_SESSION_KEY, None)
    return jsonify({
        "username": current_user.username,
        "id": current_user.id,
        "is_admin": is_admin,
        "impersonating": impersonating,
        "has_password": bool(user_row["password_hash"]) if user_row else False,
        "discord_linked": bool(user_row["discord_id"]) if user_row else False,
        "google_linked": bool(user_row["google_id"]) if user_row else False,
        "csrf_token": generate_csrf(),
    })


@auth_bp.route("/api/me/link-oauth", methods=["POST"])
@login_required
def api_link_oauth():
    """Redirect to OAuth provider to link account."""
    from flask import url_for
    from app import oauth
    body = request.json or {}
    provider = body.get("provider")
    if provider not in ("discord", "google"):
        return jsonify({"error": "Invalid provider"}), 400
    if provider not in oauth._clients:
        return jsonify({"error": f"{provider} login not configured"}), 404
    # Return the auth URL — frontend will redirect
    if provider == "discord":
        url = url_for("auth.auth_discord", _external=True)
    else:
        url = url_for("auth.auth_google", _external=True)
    return jsonify({"url": url})


@auth_bp.route("/api/me/export")
@login_required
def api_me_export():
    """GDPR data export: stream everything the DB holds about this user as JSON.

    Excludes auth secrets (password hash, upload token). Includes account
    metadata, all games (with mistakes + annotations), category reports, and
    mailbox messages visible to the user with their read state.

    Streamed row-by-row and the per-mistake `data_json` is inlined raw — a
    single user's mistake corpus can hit ~17 MB and re-parsing every blob
    just to re-serialize it OOM-killed the 512 MB container.

    The generator opens its own DB connection because the per-request `g.db_conn`
    is torn down before a streamed response finishes.
    """
    from app import get_conn

    user_id = current_user.id
    user_row = db.get_user_by_id(get_conn(), user_id)
    if not user_row:
        return jsonify({"error": "User not found"}), 404
    username = user_row["username"]

    account = {
        "id": user_row["id"],
        "username": username,
        "is_admin": bool(user_row["is_admin"]),
        "created_at": user_row["created_at"],
        "discord_id": user_row["discord_id"],
        "google_id": user_row["google_id"],
    }

    def dumps(obj):
        return json.dumps(obj, ensure_ascii=False, default=str)

    def generate():
        # Open a dedicated connection — the per-request `g.db_conn` is torn
        # down before a streamed response finishes iterating.
        conn = db.get_db()
        try:
            yield "{\n"
            yield f'"exported_at": {dumps(datetime.now(timezone.utc).isoformat())},\n'
            yield f'"account": {dumps(account)},\n'

            # Games — stream one game (with its mistakes) at a time.
            yield '"games": [\n'
            first_game = True
            for g in conn.execute(
                "SELECT id, date, log_url, mortal_file, categorization_status, created_at, "
                "stats_json, rounds_json FROM games WHERE user_id = ? ORDER BY date, id",
                (user_id,),
            ):
                if not first_game:
                    yield ",\n"
                first_game = False
                game_meta = {
                    "id": g["id"],
                    "date": g["date"],
                    "log_url": g["log_url"],
                    "mortal_file": g["mortal_file"],
                    "categorization_status": g["categorization_status"],
                    "created_at": g["created_at"],
                }
                yield "{"
                for k, v in game_meta.items():
                    yield f"{dumps(k)}: {dumps(v)}, "
                # Embed pre-serialized JSON blobs verbatim — they're already
                # valid JSON in the DB, so re-parsing buys nothing.
                yield f'"stats": {g["stats_json"] or "null"}, '
                yield f'"rounds": {g["rounds_json"] or "null"}, '
                yield '"mistakes": [\n'
                first_m = True
                # Use a separate cursor so it doesn't fight the outer iterator.
                m_cur = conn.execute(
                    "SELECT id, round_name, round_idx, mistake_idx, "
                    "ev_loss, turn, note, data_json FROM mistakes "
                    "WHERE game_id = ? ORDER BY round_idx, mistake_idx",
                    (g["id"],),
                )
                for mr in m_cur:
                    if not first_m:
                        yield ",\n"
                    first_m = False
                    yield "{"
                    for k in ("id", "round_name", "round_idx", "mistake_idx",
                             "ev_loss", "turn", "note"):
                        yield f"{dumps(k)}: {dumps(mr[k])}, "
                    yield f'"data": {mr["data_json"] or "null"}'
                    yield "}"
                yield "]}"
            yield "\n],\n"

            yield '"category_reports": [\n'
            first = True
            for r in conn.execute(
                "SELECT id, mistake_id, kind, suggested_category, reason, created_at "
                "FROM category_reports WHERE user_id = ? ORDER BY created_at, id",
                (user_id,),
            ):
                if not first:
                    yield ",\n"
                first = False
                yield dumps(dict(r))
            yield "\n],\n"

            yield '"messages": [\n'
            first = True
            for r in conn.execute(
                """SELECT m.id, m.type, m.title, m.body, m.audience_user_id,
                          m.created_at, r.read_at
                     FROM messages m
                     LEFT JOIN message_reads r
                            ON r.message_id = m.id AND r.user_id = ?
                    WHERE m.audience_user_id IS NULL OR m.audience_user_id = ?
                    ORDER BY m.created_at, m.id""",
                (user_id, user_id),
            ):
                if not first:
                    yield ",\n"
                first = False
                yield dumps(dict(r))
            yield "\n]\n}\n"
        finally:
            conn.close()

    filename = f"haipai-export-{username}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.json"
    return Response(
        generate(),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@auth_bp.route("/api/me/unlink-oauth", methods=["POST"])
@login_required
def api_unlink_oauth():
    """Unlink an OAuth provider from the current account."""
    from app import get_conn
    conn = get_conn()
    body = request.json or {}
    provider = body.get("provider")
    if provider not in ("discord", "google"):
        return jsonify({"error": "Invalid provider"}), 400
    user_row = db.get_user_by_id(conn, current_user.id)
    if not user_row:
        return jsonify({"error": "User not found"}), 404
    # Prevent unlinking if it's the only auth method
    has_password = bool(user_row["password_hash"])
    has_discord = bool(user_row["discord_id"])
    has_google = bool(user_row["google_id"])
    auth_methods = sum([has_password, has_discord, has_google])
    if auth_methods <= 1:
        return jsonify({"error": "Cannot unlink your only login method"}), 400
    col = f"{provider}_id"
    conn.execute(f"UPDATE users SET {col} = NULL WHERE id = ?", (current_user.id,))
    conn.commit()
    return jsonify({"ok": True})
