"""Efficiency Trainer minigame API: submit a finished run, read the leaderboard.

The minigame is entirely client-side (`static/js/efficiency-trainer.js`), so a
submitted score is self-reported — there is no server-side replay to check it
against. `_validated_run` therefore gates on the only thing the server knows
for certain: the game's own points arithmetic. A cleared hand is worth
`5 * starting_shanten` plus 5 per action saved under that hand's par, and the
three tiers are (shanten 1, par 5), (2, 7) and (3, 9). The cheapest possible
clear is therefore 5 points (a 1-shanten hand taken at or over par) and the
richest is 45 (a 3-shanten hand cleared in the theoretical minimum three
shots: 15 + 5 * 6). Only cleared hands score, and the streak counts hands
cleared at or under par, so it can never exceed the hands cleared either.

That rejects careless or accidental garbage; it does not stop someone who
deliberately crafts a consistent tuple, and it isn't meant to — the stakes are
a fun board, and the alternative (running the game server-side) buys very
little for its cost. Same trade, same reasoning as `routes/waits.py`.
"""

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

import db

efficiency_bp = Blueprint("efficiency", __name__)

# Board size. Users outside it still get their own row via `you`.
LEADERBOARD_LIMIT = 10
# Loose ceiling, purely so a typo/overflow can't wedge the board's sort.
MAX_SCORE = 1_000_000
# Points per cleared hand, floor and ceiling — see the module docstring. Keep
# these in step with EF_HAND_TIERS / EF_BASE_PER_SHANTEN / EF_SAVE_BONUS in
# static/js/efficiency-trainer.js.
MIN_HAND_POINTS = 5
MAX_HAND_POINTS = 45


def _validated_run(data):
    """Coerce a submitted run to ints, or return (None, error message)."""
    try:
        score = int(data.get("score"))
        best_streak = int(data.get("best_streak", 0))
        hands_cleared = int(data.get("hands_cleared", 0))
    except (TypeError, ValueError):
        return None, "score, best_streak and hands_cleared must be integers"

    if min(score, best_streak, hands_cleared) < 0:
        return None, "negative values are not a thing"
    if max(score, best_streak, hands_cleared) > MAX_SCORE:
        return None, "value out of range"
    if best_streak > hands_cleared:
        return None, "streak cannot exceed hands cleared"
    if not (MIN_HAND_POINTS * hands_cleared <= score <= MAX_HAND_POINTS * hands_cleared):
        return None, "score is inconsistent with hands cleared"
    return {"score": score, "best_streak": best_streak,
            "hands_cleared": hands_cleared}, None


@efficiency_bp.route("/api/efficiency/scores", methods=["POST"])
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
        db.submit_efficiency_score(conn, current_user.id, run["score"],
                                   run["best_streak"], run["hands_cleared"])
    board = db.get_efficiency_leaderboard(conn, current_user.id, LEADERBOARD_LIMIT)
    return jsonify({"ok": True, "recorded": recorded, "leaderboard": board})


@efficiency_bp.route("/api/efficiency/leaderboard")
def leaderboard():
    """Top runs plus the caller's own best, so the UI needs a single call.

    Deliberately public, for the same reason as the other two trainers': the
    minigame itself is playable without an account (`/play`), and a guest who
    can see what the board looks like has a reason to want a row on it. For an
    anonymous caller `you` comes back None.
    """
    from app import get_conn
    conn = get_conn()
    uid = current_user.id if current_user.is_authenticated else None
    return jsonify(db.get_efficiency_leaderboard(conn, uid, LEADERBOARD_LIMIT))
