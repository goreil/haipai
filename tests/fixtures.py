"""Test fixture factories for the game-dict shape that `db.add_game` expects.

Three composing helpers:

    make_mistake(**overrides) -> dict   # one entry in round["mistakes"]
    make_round(**overrides)   -> dict   # one entry in game["rounds"]
    make_game(**overrides)    -> dict   # the full payload for db.add_game

Every helper accepts keyword overrides; everything you don't override gets a
sensible default. Two shortcuts on `make_game` cover the common cases:

    make_game()                            # game with one default mistake
    make_game(mistakes=[])                 # game with one empty round
    make_game(mistakes=[m1, m2])           # one round, two mistakes
    make_game(rounds=[make_round(...)])    # explicit round list (>1 rounds)
"""

_DEFAULT_HAND = [
    "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
    "1p", "2p", "3p", "4p",
]


def make_mistake(**overrides):
    """One mistake dict shaped like a row in round["mistakes"]."""
    m = {
        "turn": 5,
        "ev_loss": 0.50,
        "note": None,
        "hand": list(_DEFAULT_HAND),
        "melds": [],
        "shanten": 1,
        "draw": "4m",
        "actual": {"type": "dahai", "pai": "1m"},
        "expected": {"type": "dahai", "pai": "3m"},
        "top_actions": [
            {"type": "dahai", "pai": "3m", "q_value": 1.0},
            {"type": "dahai", "pai": "1m", "q_value": 0.5},
        ],
    }
    m.update(overrides)
    return m


def make_round(*, mistakes=None, **overrides):
    """One round dict. `mistakes` defaults to a single make_mistake();
    pass `mistakes=[]` for an empty round."""
    rnd = {
        "round": "E1",
        "honba": 0,
        "turn_count": 10,
        "outcome": None,
        "mistakes": [make_mistake()] if mistakes is None else mistakes,
    }
    rnd.update(overrides)
    return rnd


def make_game(*, rounds=None, mistakes=None, **overrides):
    """Full game payload. Pass `mistakes=...` to auto-build one round with
    those mistakes (the common case), or `rounds=[...]` for full control."""
    if rounds is None:
        rounds = [make_round() if mistakes is None else make_round(mistakes=mistakes)]
    game = {
        "date": "2026-01-15",
        "rounds": rounds,
    }
    game.update(overrides)
    return game
