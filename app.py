#!/usr/bin/env python3
"""Flask app factory: extensions wiring (CSRF, login, OAuth, limiter) +
blueprint registration. Routes live in `routes/`."""

from flask import Flask, g, jsonify, redirect, request, url_for
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_login import LoginManager, UserMixin
from flask_wtf.csrf import CSRFProtect
from authlib.integrations.flask_client import OAuth
from pathlib import Path
import os
import sys

import db

DIR = Path(__file__).parent

app = Flask(__name__, static_folder="static", template_folder="templates")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
_secret = os.environ.get("SECRET_KEY")
if not _secret:
    print("WARNING: SECRET_KEY not set, using random key (sessions won't persist across restarts)", file=sys.stderr)
    import secrets
    _secret = secrets.token_hex(32)
app.secret_key = _secret
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_ENV") != "development"
app.config["REMEMBER_COOKIE_DURATION"] = 30 * 24 * 60 * 60  # 30 days
# Game id shown at /demo for logged-out visitors, via a public share link
# generated on first visit. Unset disables /demo (404).
_demo_game_id = os.environ.get("DEMO_GAME_ID")
app.config["DEMO_GAME_ID"] = int(_demo_game_id) if _demo_game_id else None

csrf = CSRFProtect(app)

limiter = Limiter(get_remote_address, app=app, default_limits=["200 per minute"],
                  storage_uri="memory://")

# --- OAuth ---

oauth = OAuth(app)

_discord_id = os.environ.get("DISCORD_CLIENT_ID")
_discord_secret = os.environ.get("DISCORD_CLIENT_SECRET")
if _discord_id and _discord_secret:
    oauth.register(
        name="discord",
        client_id=_discord_id,
        client_secret=_discord_secret,
        authorize_url="https://discord.com/api/oauth2/authorize",
        access_token_url="https://discord.com/api/oauth2/token",
        api_base_url="https://discord.com/api/",
        client_kwargs={"scope": "identify"},
    )

_google_id = os.environ.get("GOOGLE_CLIENT_ID")
_google_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
if _google_id and _google_secret:
    oauth.register(
        name="google",
        client_id=_google_id,
        client_secret=_google_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile"},
    )

# --- Auth ---

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "auth.login"


class User(UserMixin):
    def __init__(self, id, username):
        self.id = id
        self.username = username


@login_manager.user_loader
def load_user(user_id):
    conn = db.get_db()
    row = db.get_user_by_id(conn, int(user_id))
    if row:
        return User(row["id"], row["username"])
    return None


@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Login required"}), 401
    return redirect(url_for("auth.login"))


# --- Error handling ---

@app.errorhandler(Exception)
def handle_exception(e):
    """Return JSON error for API routes, generic 500 otherwise.
    HTTPException subclasses (CSRF 400, 404, 405, ...) keep their real status."""
    if isinstance(e, HTTPException):
        if request.path.startswith("/api/"):
            return jsonify({"error": e.description}), e.code
        return e
    import traceback
    print(f"Unhandled error on {request.path}: {e}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    if request.path.startswith("/api/"):
        return jsonify({"error": "Internal server error"}), 500
    return "Internal server error", 500


# --- Database connection per request ---

def get_conn():
    if "db_conn" not in g:
        g.db_conn = db.get_db()
    return g.db_conn


@app.teardown_appcontext
def close_conn(_exception):
    conn = g.pop("db_conn", None)
    if conn is not None:
        conn.close()


# --- Register blueprints ---

from routes.auth import auth_bp
from routes.pages import pages_bp
from routes.game import games_bp
from routes.admin import admin_bp
from routes.mailbox import mailbox_bp
from routes.waits import waits_bp
from routes.defense import defense_bp
from routes.efficiency import efficiency_bp

app.register_blueprint(auth_bp)
app.register_blueprint(pages_bp)
app.register_blueprint(games_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(mailbox_bp)
app.register_blueprint(waits_bp)
app.register_blueprint(defense_bp)
app.register_blueprint(efficiency_bp)

# Per-route rate limits applied post-registration so the auth blueprint stays
# decoupled from the limiter at import time.
limiter.limit("10 per minute")(app.view_functions["auth.login"])
limiter.limit("5 per minute")(app.view_functions["auth.register"])
limiter.limit("10 per minute")(app.view_functions["auth.auth_discord"])
limiter.limit("10 per minute")(app.view_functions["auth.auth_discord_callback"])
limiter.limit("10 per minute")(app.view_functions["auth.auth_google"])
limiter.limit("10 per minute")(app.view_functions["auth.auth_google_callback"])
limiter.limit("10 per minute")(app.view_functions["auth.verify_email"])
limiter.limit("5 per minute")(app.view_functions["auth.resend_verification"])

# CSRF exemption for /api/me (read-only JSON returning the CSRF token itself).
csrf.exempt(app.view_functions["auth.api_me"])

# CSRF exempt for the upload endpoint, which has two callers that cannot
# produce a CSRF token: the bookmarklet (Bearer token, cross-origin from
# mjai.ekyu.moe) and the browser extension's service worker (session cookie —
# flask-wtf's WTF_CSRF_SSL_STRICT demands a Referer that an extension worker
# is not allowed to send).
#
# Exempting a route that accepts a *cookie* is only safe because three things
# hold together; see api_upload's docstring before touching any of them:
#   - SESSION_COOKIE_SAMESITE = "Lax" keeps the cookie off cross-site POSTs,
#   - _cors_headers() sends no Access-Control-Allow-Credentials,
#   - api_upload refuses cookie auth from any non-extension foreign Origin.
csrf.exempt(app.view_functions["games.api_upload"])
csrf.exempt(app.view_functions["games.api_upload_preflight"])


# --- Init ---

def init_app():
    """Initialize database. Called once on startup."""
    conn = db.get_db()
    db.init_db(conn)
    conn.close()


# Auto-init when imported by gunicorn (not in Flask reloader parent)
if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or "gunicorn" in os.environ.get("SERVER_SOFTWARE", ""):
    init_app()


if __name__ == "__main__":
    # Dev server: init in reloader child only
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        pass  # already initialized above
    elif not app.debug:
        init_app()
    app.run(debug=os.environ.get("FLASK_ENV") == "development", port=5000)
