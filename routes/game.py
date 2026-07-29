#!/usr/bin/env python3
"""Game CRUD routes: list, get, delete, add, annotate, backfill."""

from flask import Blueprint, jsonify, make_response, request
from flask_login import current_user, login_required
from pathlib import Path
import json

import db
from lib.parse import parse_game, compute_summary

DIR = Path(__file__).parent.parent
games_bp = Blueprint("games", __name__)

# Origin allowed to POST games via the bookmarklet upload endpoint.
UPLOAD_ALLOWED_ORIGIN = "https://mjai.ekyu.moe"

# Origin schemes allowed to use the *cookie* half of api_upload. A browser
# extension's service worker sends its own extension origin (or, depending on
# the browser, none at all); an ordinary web page always sends the page's
# origin. So anything else is a cross-site caller.
EXTENSION_ORIGIN_SCHEMES = (
    "chrome-extension://",
    "moz-extension://",
    "safari-web-extension://",
)


@games_bp.route("/api/games")
@login_required
def api_games():
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    return jsonify(db.list_games(conn, uid))


@games_bp.route("/api/games/<int:game_id>")
@login_required
def api_game(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    game = db.get_game(conn, game_id, user_id=uid)
    if not game:
        return jsonify({"error": "Game not found"}), 404
    return jsonify(game)


@games_bp.route("/api/games/<int:game_id>/mortal")
@login_required
def api_game_mortal(game_id):
    """Slim mortal_data, split out of /api/games/<id> so the browser can
    cache it. A game's mortal_file is set once at ingest and the file is
    content-hashed, so this URL's payload is immutable — long max-age +
    ETag make repeat fetches (game revisits, trends re-analysis) free.
    """
    from app import get_conn
    conn = get_conn()
    row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ? AND user_id = ?",
        (game_id, current_user.id),
    ).fetchone()
    if not row:
        return jsonify({"error": "Game not found"}), 404

    # The filename is the content hash — use it as the ETag so
    # revalidations are answered without reading the file.
    etag = Path(row["mortal_file"]).stem if row["mortal_file"] else None
    if etag and etag in request.if_none_match:
        resp = make_response("", 304)
        resp.set_etag(etag)
        return resp

    md = load_slim_mortal_data(row["mortal_file"])
    if md is None:
        return jsonify({"error": "No mortal data for this game"}), 404
    resp = jsonify(md)
    resp.set_etag(etag)
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    # The cache entry is keyed by URL; vary on Cookie so a different
    # account in the same browser can't read a cached copy of this game.
    resp.headers["Vary"] = "Cookie"
    return resp


@games_bp.route("/api/shared/<token>")
def api_shared_game(token):
    """Public, unauthenticated read-only game view for a share link. No
    session/CSRF involved — the token itself is the credential, same model as
    the upload-token bookmarklet auth (routes/game.py `api_upload`).

    Returns the same shape /api/games/<id> + /api/games/<id>/mortal combine
    into client-side, in one response, since the shared page has no per-user
    cache concerns that would justify splitting them.
    """
    from app import get_conn
    conn = get_conn()
    game = db.get_game_by_share_token(conn, token)
    if not game:
        return jsonify({"error": "Game not found"}), 404
    game["mortal_data"] = load_slim_mortal_data(game.get("mortal_file"))
    return jsonify(game)


@games_bp.route("/api/games/<int:game_id>/share-token", methods=["GET"])
@login_required
def api_get_share_token(game_id):
    """Get-or-create the game's public share token."""
    from app import get_conn
    conn = get_conn()
    token = db.get_or_create_share_token(conn, game_id, current_user.id)
    if not token:
        return jsonify({"error": "Game not found"}), 404
    return jsonify({"share_token": token, "share_url": f"{request.url_root.rstrip('/')}/shared/{token}"})


@games_bp.route("/api/games/<int:game_id>/share-token/regenerate", methods=["POST"])
@login_required
def api_regenerate_share_token(game_id):
    """Rotate the game's share token, invalidating any previously shared link."""
    from app import get_conn
    conn = get_conn()
    token = db.regenerate_share_token(conn, game_id, current_user.id)
    if not token:
        return jsonify({"error": "Game not found"}), 404
    return jsonify({"share_token": token, "share_url": f"{request.url_root.rstrip('/')}/shared/{token}"})


@games_bp.route("/api/games/<int:game_id>/share-token", methods=["DELETE"])
@login_required
def api_revoke_share_token(game_id):
    """Turn off sharing for a game."""
    from app import get_conn
    conn = get_conn()
    ok = db.revoke_share_token(conn, game_id, current_user.id)
    if not ok:
        return jsonify({"error": "Game not found"}), 404
    return jsonify({"ok": True})


def _read_mortal_json(mortal_file):
    """Load a Mortal analysis JSON by relative-to-DIR path, returning the raw
    dict or ``None`` (missing, outside DIR, or unreadable). Path is resolved +
    bounded to DIR to prevent escaping the app root via traversal."""
    if not mortal_file:
        return None
    mortal_path = (DIR / mortal_file).resolve()
    if not str(mortal_path).startswith(str(DIR.resolve())):
        return None
    if not mortal_path.exists():
        return None
    try:
        with open(mortal_path) as f:
            return json.load(f)
    except (ValueError, OSError):
        return None


def load_slim_mortal_data(mortal_file):
    """Slim Mortal analysis JSON (only the fields JS prep + the skill-area
    classifier need). Returns the slim dict or ``None``."""
    md = _read_mortal_json(mortal_file)
    return _slim_mortal_data(md) if md is not None else None


def load_full_mortal_data(mortal_file):
    """Full Mortal analysis JSON, no slimming. Used where prep needs the
    complete per-entry payload — the slim copy drops fields prep can't
    reconstruct for ~10% of games (see the admin category snapshot)."""
    return _read_mortal_json(mortal_file)


def _slim_mortal_data(md):
    """Return only the fields JS prep needs. The retained per-entry shape
    is tiles_left/junme/is_equal plus the action-type fields the JS
    skill-area classifier needs (`actual.type`, `expected.type`,
    `details[].action.type`). The discarded fields (model probabilities,
    scores, ratings) aren't consumed by static/js/prep/."""

    def _entry_slim(e):
        actual = e.get("actual") or {}
        expected = e.get("expected") or {}
        details = e.get("details") or []
        return {
            "tiles_left": e.get("tiles_left"),
            "junme": e.get("junme"),
            "is_equal": e.get("is_equal"),
            "actual": {"type": actual.get("type")} if actual else None,
            "expected": {"type": expected.get("type")} if expected else None,
            "details": [
                {"action": {"type": ((d.get("action") or {}).get("type"))}}
                for d in details
            ],
        }

    kyokus = ((md.get("review") or {}).get("kyokus") or [])
    return {
        "player_id": md.get("player_id"),
        "mjai_log": md.get("mjai_log", []),
        "review": {
            "kyokus": [
                {"entries": [_entry_slim(e) for e in (k.get("entries") or [])]}
                for k in kyokus
            ],
        },
    }


@games_bp.route("/api/games/<int:game_id>", methods=["DELETE"])
@login_required
def api_delete_game(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    if not db.delete_game(conn, game_id, user_id=uid):
        return jsonify({"error": "Game not found"}), 404
    remaining = conn.execute(
        "SELECT COUNT(*) FROM games WHERE user_id = ?", (uid,)
    ).fetchone()[0]
    return jsonify({"ok": True, "remaining": remaining})


@games_bp.route("/api/games/<int:game_id>/annotate", methods=["POST"])
@login_required
def api_annotate(game_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    body = request.json
    if not body:
        return jsonify({"error": "JSON body required"}), 400
    round_name = body.get("round")
    turn = body.get("turn")
    index = body.get("index", 0)
    note = body.get("note")

    if not isinstance(round_name, str) or not isinstance(turn, int):
        return jsonify({"error": "round (string) and turn (int) required"}), 400
    if note is not None and not isinstance(note, str):
        return jsonify({"error": "note must be a string"}), 400
    if note and len(note) > 1000:
        return jsonify({"error": "note too long (max 1000 chars)"}), 400

    result = db.annotate_mistake(conn, game_id, round_name, turn, index, note, user_id=uid)
    if not result:
        return jsonify({"error": "Mistake not found"}), 404

    stats = db.compute_summary_for_game(conn, game_id)
    return jsonify({"ok": True, "summary": stats})


@games_bp.route("/api/mistakes/<int:mistake_id>/locate")
@login_required
def api_locate_mistake(mistake_id):
    """Resolve a mistake_id to the game it belongs to so deep-links like
    `#m<id>` can fetch the right game. Returns 404 if the mistake
    doesn't exist or belongs to another user."""
    from app import get_conn
    conn = get_conn()
    uid = current_user.id
    row = conn.execute(
        "SELECT m.game_id, m.round_name, m.turn, m.mistake_idx, g.user_id "
        "FROM mistakes m JOIN games g ON m.game_id = g.id WHERE m.id = ?",
        (mistake_id,),
    ).fetchone()
    if not row or row["user_id"] != uid:
        return jsonify({"error": "Mistake not found"}), 404
    return jsonify({
        "game_id": row["game_id"],
        "round_name": row["round_name"],
        "turn": row["turn"],
        "mistake_idx": row["mistake_idx"],
    })


@games_bp.route("/api/mistakes/<int:mistake_id>/report", methods=["POST"])
@login_required
def api_report_category(mistake_id):
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    # Verify the mistake belongs to the user
    owner = conn.execute(
        "SELECT g.user_id FROM mistakes m JOIN games g ON m.game_id = g.id WHERE m.id = ?",
        (mistake_id,),
    ).fetchone()
    if not owner or owner["user_id"] != uid:
        return jsonify({"error": "Mistake not found"}), 404

    body = request.json or {}
    kind = body.get("kind")
    if kind not in db.REPORT_KINDS:
        return jsonify({"error": f"kind must be one of {list(db.REPORT_KINDS)}"}), 400

    suggested = body.get("suggested_category")
    reason = body.get("reason")
    if suggested is not None and not isinstance(suggested, str):
        return jsonify({"error": "suggested_category must be a string"}), 400
    if reason is not None and not isinstance(reason, str):
        return jsonify({"error": "reason must be a string"}), 400
    if reason and len(reason) > 500:
        return jsonify({"error": "reason too long (max 500 chars)"}), 400
    if suggested and len(suggested) > 200:
        return jsonify({"error": "suggested_category too long (max 200 chars)"}), 400

    # `complex_gap` rides its quick-tags in `suggested_category`; `wrong_text`
    # never sends one (the legacy category-code path is gone), so it stays None.
    stored_suggested = suggested if kind == "complex_gap" else None
    report_id = db.submit_category_report(conn, uid, mistake_id,
                                          kind=kind, suggested_category=stored_suggested,
                                          reason=reason)
    return jsonify({"ok": True, "id": report_id})


@games_bp.route("/api/mistakes/<int:mistake_id>/report", methods=["DELETE"])
@login_required
def api_unreport_category(mistake_id):
    """Clear the caller's own report on this mistake — used by the in-card
    "Undo" button so a misclick on the report row can be reverted. Idempotent:
    returns ok=True with removed indicating whether a row was actually deleted."""
    from app import get_conn
    conn = get_conn()
    uid = current_user.id

    owner = conn.execute(
        "SELECT g.user_id FROM mistakes m JOIN games g ON m.game_id = g.id WHERE m.id = ?",
        (mistake_id,),
    ).fetchone()
    if not owner or owner["user_id"] != uid:
        return jsonify({"error": "Mistake not found"}), 404

    removed = db.delete_category_report_for_user(conn, uid, mistake_id)
    return jsonify({"ok": True, "removed": removed})


def _ingest_mortal(conn, uid, mortal_data, game_date):
    """Parse + persist a Mortal analysis JSON for `uid`. Returns (status, payload)
    where status is the HTTP code and payload the JSON body. JS prep runs
    client-side on fetch (see static/js/prep/), so no background work fires
    here."""
    from datetime import date
    if not mortal_data or not isinstance(mortal_data, dict):
        return 400, {"error": "mortal_data is required (Mortal analysis JSON)"}

    game_date = game_date or date.today().isoformat()

    # Save Mortal JSON to disk — /api/games/<id> ships a slim copy to the
    # frontend so JS prep can reconstruct walls without a per-mistake fetch.
    import hashlib
    mortal_dir = DIR / "mortal_analysis"
    mortal_dir.mkdir(exist_ok=True)
    mortal_bytes = json.dumps(mortal_data, ensure_ascii=False).encode()
    filename = hashlib.sha256(mortal_bytes).hexdigest()[:16] + ".json"
    dest = mortal_dir / filename
    if not dest.exists():
        dest.write_bytes(mortal_bytes)

    try:
        game_dict = parse_game(mortal_data, game_date=game_date)
    except (ValueError, KeyError, IndexError, TypeError) as e:
        return 400, {"error": f"Failed to parse Mortal data: {e}"}
    game_dict["mortal_file"] = str(dest.relative_to(DIR))
    compute_summary(game_dict)

    game_dict["categorization_status"] = "done"
    game_id = db.add_game(conn, uid, game_dict)

    return 200, {"ok": True, "game_id": game_id, "summary": game_dict.get("summary", {})}


@games_bp.route("/api/games/add", methods=["POST"])
@login_required
def api_add():
    from app import get_conn
    body = request.json or {}
    status, payload = _ingest_mortal(get_conn(), current_user.id,
                                     body.get("mortal_data"), body.get("date"))
    return jsonify(payload), status


@games_bp.route("/api/upload-token", methods=["GET"])
@login_required
def api_upload_token():
    """Return the user's bookmarklet upload token, generating one on first call."""
    from app import get_conn
    token = db.get_or_create_upload_token(get_conn(), current_user.id)
    return jsonify({"token": token})


@games_bp.route("/api/upload-token/regenerate", methods=["POST"])
@login_required
def api_regenerate_upload_token():
    """Rotate the user's upload token, invalidating any installed bookmarklets."""
    from app import get_conn
    token = db.regenerate_upload_token(get_conn(), current_user.id)
    return jsonify({"token": token})


def _cors_headers():
    # No Access-Control-Allow-Credentials, on purpose: adding it would let a
    # page on the allowed origin make a *cookie*-authenticated upload, which is
    # exactly what api_upload's CSRF exemption relies on being impossible.
    return {
        "Access-Control-Allow-Origin": UPLOAD_ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    }


@games_bp.route("/api/games/upload", methods=["OPTIONS"])
def api_upload_preflight():
    resp = ("", 204)
    headers = _cors_headers()
    from flask import make_response
    r = make_response(*resp)
    for k, v in headers.items():
        r.headers[k] = v
    return r


def _cookie_origin_ok(origin):
    """True if `origin` may authenticate by session cookie on api_upload.

    Cross-site guard for the cookie path, which is CSRF-exempt (see app.py).
    An absent Origin is allowed because extension workers may omit it; a real
    web page never can, so a page on another site is always caught here.
    """
    if not origin:
        return True
    if origin.startswith(EXTENSION_ORIGIN_SCHEMES):
        return True
    from urllib.parse import urlsplit
    return urlsplit(origin).netloc == request.host


@games_bp.route("/api/games/upload", methods=["POST"])
def api_upload():
    """Game upload for the bookmarklet and the browser extension.

    Two ways in:

    * `Authorization: Bearer <upload_token>` — the bookmarklet, which runs as a
      page on mjai.ekyu.moe and so can never have a haipai session cookie.
    * The ordinary haipai session cookie — the extension, whose service worker
      *does* get SameSite=Lax cookies attached when it holds host permissions
      for the target (measured; see docs/backlogs/Browser-extension-spec.md).
      The extension therefore needs no credential of its own: being logged in
      to haipai in that browser is the authorization.

    Flask-Login's @login_required is deliberately not used — a missing cookie
    must fall through to the Bearer check rather than 401 immediately.

    The cookie path is what makes this endpoint's CSRF exemption load-bearing,
    so it carries its own cross-site guard (`_cookie_origin_ok`) instead. Two
    further things keep a hostile page out, and both must stay true:

    * `_cors_headers()` omits Access-Control-Allow-Credentials, so a
      preflighted credentialed POST from any page is abandoned before it is
      sent. Do not add that header.
    * SESSION_COOKIE_SAMESITE = "Lax" keeps the cookie off cross-site POSTs,
      which covers the preflight-free "simple request" shape as well.
    """
    from app import get_conn
    conn = get_conn()

    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""

    if token:
        user = db.get_user_by_upload_token(conn, token)
        if not user:
            return _json_with_cors({"error": "Invalid upload token"}, 401)
    elif current_user.is_authenticated:
        if not _cookie_origin_ok(request.headers.get("Origin")):
            return _json_with_cors({"error": "Cross-site upload rejected"}, 403)
        user = db.get_user_by_id(conn, current_user.id)
        if not user:
            return _json_with_cors({"error": "Not signed in"}, 401)
    else:
        return _json_with_cors({"error": "Not signed in"}, 401)

    body = request.get_json(silent=True) or {}
    status, payload = _ingest_mortal(conn, user["id"],
                                     body.get("mortal_data"), body.get("date"))
    return _json_with_cors(payload, status)


def _json_with_cors(payload, status):
    resp = jsonify(payload)
    resp.status_code = status
    for k, v in _cors_headers().items():
        resp.headers[k] = v
    return resp
