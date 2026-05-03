#!/usr/bin/env python3
"""Auth routes: login/register/logout, OAuth (discord + google), /api/me + /api/me/*."""

from flask import Blueprint, jsonify, redirect, render_template, request, session
from flask_login import current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash, generate_password_hash
import os

import db

auth_bp = Blueprint("auth", __name__)


# --- Login / register / logout ---

@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    from app import User, get_conn, oauth

    if current_user.is_authenticated:
        return redirect("/")
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        conn = get_conn()
        user_row = db.get_user_by_username(conn, username)
        # Always hash to prevent timing-based username enumeration
        pw_hash = user_row["password_hash"] if user_row else "pbkdf2:sha256:dummy"
        valid = check_password_hash(pw_hash, password)
        if user_row and valid:
            remember = bool(request.form.get("remember"))
            login_user(User(user_row["id"], user_row["username"]), remember=remember)
            return redirect("/")
        error = "Invalid username or password"
    return render_template("login.html", title="Login", error=error, register=False,
                           has_discord="discord" in oauth._clients,
                           has_google="google" in oauth._clients)


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    from app import User, get_conn, oauth

    if current_user.is_authenticated:
        return redirect("/")
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        conn = get_conn()

        if not username or not password:
            error = "Username and password required"
        elif len(password) < 8:
            error = "Password must be at least 8 characters"
        else:
            try:
                pw_hash = generate_password_hash(password)
                user_id = db.create_user(conn, username, pw_hash)
                login_user(User(user_id, username))
                return redirect("/")
            except Exception:
                error = "Username already taken"
    return render_template("login.html", title="Register", error=error, register=True,
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
        "practice_opt_in": bool(user_row["practice_opt_in"]) if user_row else False,
        "has_password": bool(user_row["password_hash"]) if user_row else False,
        "discord_linked": bool(user_row["discord_id"]) if user_row else False,
        "google_linked": bool(user_row["google_id"]) if user_row else False,
        "csrf_token": generate_csrf(),
    })


@auth_bp.route("/api/me/practice-opt-in", methods=["POST"])
@login_required
def api_practice_opt_in():
    from app import get_conn
    conn = get_conn()
    body = request.json or {}
    opt_in = bool(body.get("opt_in"))
    db.set_practice_opt_in(conn, current_user.id, opt_in)
    return jsonify({"ok": True, "practice_opt_in": opt_in})


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
