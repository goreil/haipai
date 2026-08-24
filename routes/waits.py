"""Waits Trainer minigame API: submit a finished run, read the leaderboard.

The minigame is entirely client-side (`static/js/waits-trainer.js`), so a
submitted score is self-reported — there is no server-side replay to check
it against. `_validated_run` therefore gates on the only thing the server
knows for certain: the game's own points arithmetic. Every cleared hand is
worth 1, 2 or 4 points, so a run's score must sit between `hands_cleared`
and `4 * hands_cleared`, and the combo can never exceed the hands cleared.
That rejects careless or accidental garbage; it does not stop someone who
deliberately crafts a consistent tuple, and it isn't meant to — the stakes
are a fun board, and the alternative (running the game server-side) buys
very little for its cost.
"""

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

import db

waits_bp = Blueprint("waits", __name__)

# Board size. Users outside it still get their own row via `you`.
LEADERBOARD_LIMIT = 10
# Loose ceiling, purely so a typo/overflow can't wedge the board's sort.
MAX_SCORE = 1_000_000


def _validated_run(data):
    """Coerce a submitted run to ints, or return (None, error message)."""
    try:
        score = int(data.get("score"))
        best_combo = int(data.get("best_combo", 0))
        hands_cleared = int(data.get("hands_cleared", 0))
    except (TypeError, ValueError):
        return None, "score, best_combo and hands_cleared must be integers"

    if min(score, best_combo, hands_cleared) < 0:
        return None, "negative values are not a thing"
    if score > MAX_SCORE or hands_cleared > MAX_SCORE or best_combo > MAX_SCORE:
        return None, "value out of range"
    if best_combo > hands_cleared:
        return None, "combo cannot exceed hands cleared"
    # 1, 2 or 4 points per cleared hand — see the module docstring.
    if not (hands_cleared <= score <= 4 * hands_cleared):
        return None, "score is inconsistent with hands cleared"
    return {"score": score, "best_combo": best_combo,
            "hands_cleared": hands_cleared}, None


@waits_bp.route("/api/waits/scores", methods=["POST"])
@login_required
def submit_score():
    """Record one finished run for the logged-in user.

    A scoreless run (nothing cleared) is accepted but not stored — it would
    only add noise to a board keyed on each player's best.
    """
    from app import get_conn
    run, err = _validated_run(request.get_json(silent=True) or {})
    if err:
        return jsonify({"error": err}), 400

    conn = get_conn()
    recorded = run["score"] > 0
    if recorded:
        db.submit_waits_score(conn, current_user.id, run["score"],
                              run["best_combo"], run["hands_cleared"])
    board = db.get_waits_leaderboard(conn, current_user.id, LEADERBOARD_LIMIT)
    return jsonify({"ok": True, "recorded": recorded, "leaderboard": board})


@waits_bp.route("/api/waits/leaderboard")
def leaderboard():
    """Top runs plus the caller's own best, so the UI needs a single call.

    Deliberately public: the minigame itself is playable without an account
    (`/play`), and a guest who can see what the board looks like has a reason
    to want a row on it. For an anonymous caller `you` comes back None — the
    user-scoped lookups match no rows — and no per-user data leaks either way,
    since a leaderboard is public information by construction.
    """
    from app import get_conn
    conn = get_conn()
    uid = current_user.id if current_user.is_authenticated else None
    return jsonify(db.get_waits_leaderboard(conn, uid,
                                            LEADERBOARD_LIMIT))
