#!/usr/bin/env python3
"""Furiten detection for Bad Riichi (5A) enrichment.

Furiten: a tenpai hand whose wait includes a tile the player has already
discarded. The player cannot ron on that tile (or any of their waits, under
permanent furiten) so declaring riichi locks them into tsumo-only — often a
bad trade. This module produces the data the 5A categorization path uses
to tag a mistake with ``bad_riichi_reason = "furiten"``.
"""

from lib.shanten import (
    BASE_TO_MJAI,
    MJAI_TO_BASE,
    _hand_to_34,
    _shanten,
    _wall_count,
)


def tenpai_waits(hand_13_mjai, melds_mjai, wall=None):
    """For a 13-tile tenpai hand, return the waits it has.

    Returns a list of base tile IDs (0-33). Empty list when the hand isn't
    tenpai. Red fives collapse to their base — callers render either form.
    """
    hand34, _ = _hand_to_34(hand_13_mjai)
    closed = not melds_mjai
    if _shanten.calculate_shanten(hand34, use_chiitoitsu=closed, use_kokushi=closed) != 0:
        return []
    waits = []
    for t in range(34):
        trial = hand34[:]
        trial[t] += 1
        if _shanten.calculate_shanten(trial, use_chiitoitsu=closed, use_kokushi=closed) == -1:
            waits.append(t)
    return waits


def tenpai_wait_tiles(hand_13_mjai, melds_mjai, wall):
    """Like ``tenpai_waits`` but returns ``[{tile: mjai, count: int}]`` —
    each wait tile paired with the remaining copies in the wall. Used by 5A/5B
    cards so the UI can show both "how many distinct waits" and "how many
    tiles total" without the frontend having to do the lookup.
    """
    ids = tenpai_waits(hand_13_mjai, melds_mjai)
    return [
        {"tile": BASE_TO_MJAI[t], "count": _wall_count(wall, t) if wall else 0}
        for t in ids
    ]


def is_furiten(hand_13_mjai, melds_mjai, own_discards_mjai):
    """Return a furiten report for a 13-tile tenpai hand.

    ``own_discards_mjai`` is the list of mjai tile strings the player has
    already discarded (order not needed — we only intersect against a set).

    Returns::

        {
            "is_furiten": bool,
            "waits": [mjai_str, ...],          # what the hand waits on
            "furiten_tiles": [mjai_str, ...],  # subset that's in discards
        }
    """
    waits = tenpai_waits(hand_13_mjai, melds_mjai)
    waits_mjai = [BASE_TO_MJAI[t] for t in waits]
    if not waits:
        return {"is_furiten": False, "waits": [], "furiten_tiles": []}
    discarded_bases = {MJAI_TO_BASE[t] for t in own_discards_mjai}
    furiten_tiles = [BASE_TO_MJAI[t] for t in waits if t in discarded_bases]
    return {
        "is_furiten": bool(furiten_tiles),
        "waits": waits_mjai,
        "furiten_tiles": furiten_tiles,
    }


def find_discard_history_for_turn(mjai_events, start_pos, end_pos,
                                  player_id, target_junme):
    """Return the player's discard pool up to (but not including) their dahai
    on ``target_junme``. Used by 5B (missed riichi) to compute what the wait
    pool looked like at the decision point.

    junme is 0-indexed (first tsumo = junme 0). If the target junme isn't
    reached, returns whatever was collected so far.
    """
    own_discards = []
    player_tsumo = -1
    for pos in range(start_pos + 1, end_pos):
        e = mjai_events[pos]
        etype = e.get("type")
        actor = e.get("actor")
        if etype == "tsumo" and actor == player_id:
            player_tsumo += 1
            if player_tsumo > target_junme:
                break
        elif etype == "dahai" and actor == player_id:
            if player_tsumo == target_junme:
                break
            pai = e.get("pai")
            if pai is not None:
                own_discards.append(pai)
    return own_discards


def find_riichi_context(mjai_events, start_pos, end_pos, player_id):
    """Find the player's reach event in this kyoku and return the context.

    Returns ``(riichi_tile_mjai, own_discards_before_reach)``. If the player
    never reached in this kyoku, returns ``(None, [])``.

    A player can only legally reach once per kyoku, so the first match is
    unambiguous.
    """
    own_discards = []
    for pos in range(start_pos + 1, end_pos):
        e = mjai_events[pos]
        etype = e.get("type")
        actor = e.get("actor")
        if etype == "reach" and actor == player_id:
            for pos2 in range(pos + 1, end_pos):
                e2 = mjai_events[pos2]
                if e2.get("type") == "dahai" and e2.get("actor") == player_id:
                    return e2.get("pai"), own_discards
            return None, own_discards
        if etype == "dahai" and actor == player_id:
            pai = e.get("pai")
            if pai is not None:
                own_discards.append(pai)
    return None, []
