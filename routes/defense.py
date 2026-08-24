"""Defense Trainer minigame API: submit a finished run, read the leaderboard.

The minigame is entirely client-side (`static/js/defense-trainer.js`, playing
the static board pack `static/data/defense-puzzles.json`), so a submitted
score is self-reported — there is no server-side replay to check it against.
`_validated_run` therefore gates on the only thing the server knows for
certain: the game's own points arithmetic. Clearing a step is worth exactly
the number of safe tiles it asked for, and only cleared steps score, so a
run's score must sit between `steps_cleared` (a step has at least one safe
tile) and `34 * steps_cleared` (the whole arsenal). The streak counts cleared
steps, so it can never exceed them either.

That rejects careless or accidental garbage; it does not stop someone who
deliberately crafts a consistent tuple, and it isn't meant to — the stakes
are a fun board, and the alternative (running the game server-side) buys very
little for its cost. Same trade, same reasoning as `routes/waits.py`.
"""

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

import db

defense_bp = Blueprint("defense", __name__)

# Board size. Users outside it still get their own row via `you`.
LEADERBOARD_LIMIT = 10
# Loose ceiling, purely so a typo/overflow can't wedge the board's sort.
MAX_SCORE = 1_000_000
# Distinct tiles in the arsenal — the most one step can possibly be worth.
ARSENAL_SIZE = 34


def _validated_run(data):
    """Coerce a submitted run to ints, or return (None, error message)."""
    try:
        score = int(data.get("score"))
        best_streak = int(data.get("best_streak", 0))
        steps_cleared = int(data.get("steps_cleared", 0))
    except (TypeError, ValueError):
        return None, "score, best_streak and steps_cleared must be integers"

    if min(score, best_streak, steps_cleared) < 0:
        return None, "negative values are not a thing"
    if max(score, best_streak, steps_cleared) > MAX_SCORE:
        return None, "value out of range"
    if best_streak > steps_cleared:
        return None, "streak cannot exceed steps cleared"
    # One point per safe tile, and only cleared steps score — see the module
    # docstring.
    if not (steps_cleared <= score <= ARSENAL_SIZE * steps_cleared):
        return None, "score is inconsistent with steps cleared"
    return {"score": score, "best_streak": best_streak,
            "steps_cleared": steps_cleared}, None


@defense_bp.route("/api/defense/scores", methods=["POST"])
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
        db.submit_defense_score(conn, current_user.id, run["score"],
                                run["best_streak"], run["steps_cleared"])
    board = db.get_defense_leaderboard(conn, current_user.id, LEADERBOARD_LIMIT)
    return jsonify({"ok": True, "recorded": recorded, "leaderboard": board})


@defense_bp.route("/api/defense/leaderboard")
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
    return jsonify(db.get_defense_leaderboard(conn, uid,
                                              LEADERBOARD_LIMIT))
