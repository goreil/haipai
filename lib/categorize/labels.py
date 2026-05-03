#!/usr/bin/env python3
"""Honor / value / yaku label pills for a mistake.

The list returned here is consumed both by the frontend (rendered as
pills under the EV table) and by ``rules._classify_push`` to fire the
P3 "Hand Value" branch when a yakuhai or dora tile is in play.
"""

from lib.tiles import (
    dora_indicator_to_dora_mjai,
    is_honor_mjai,
    is_red_five_mjai,
)

from .rules import _is_terminal_mjai


def compute_labels(mistake, dora_indicators, round_wind=None, seat_wind=None):
    """Compute labels for a mistake based on the tiles involved.

    Returns a list of label strings.
    """
    actual_tile = mistake["actual"]["pai"]
    expected_tile = mistake["expected"]["pai"]
    tiles = [actual_tile, expected_tile]

    labels = []

    # Compute dora tiles from indicators
    dora_tiles = set()
    for d in (dora_indicators or []):
        dora_tiles.add(dora_indicator_to_dora_mjai(d))

    for t in tiles:
        if is_honor_mjai(t) and "honor" not in labels:
            labels.append("honor")
        if _is_terminal_mjai(t) and "terminal" not in labels:
            labels.append("terminal")
        if (t in dora_tiles or is_red_five_mjai(t)) and "dora" not in labels:
            labels.append("dora")

    # Yakuhai: honor that is seat wind, round wind, or dragon
    for t in tiles:
        if t in ("P", "F", "C"):
            if "yakuhai" not in labels:
                labels.append("yakuhai")
        elif t == round_wind or t == seat_wind:
            if "yakuhai" not in labels:
                labels.append("yakuhai")

    return labels


def tile_is_yakuhai_or_dora(tile_mjai, dora_indicators=None,
                            round_wind=None, seat_wind=None):
    """True if a single tile is a yakuhai (dragon, seat/round wind) or dora.

    Mirrors the per-tile checks in ``compute_labels``, but answers for one
    side of a mistake at a time. Used by ``_classify_push`` to gate the P3
    Hand Value branch — P3 only applies when the value tile is on the
    actual (player-discarded) side, i.e. Mortal kept it.
    """
    if not tile_mjai:
        return False
    if tile_mjai in ("P", "F", "C"):
        return True
    if tile_mjai == round_wind or tile_mjai == seat_wind:
        return True
    if is_red_five_mjai(tile_mjai):
        return True
    dora_tiles = {dora_indicator_to_dora_mjai(d) for d in (dora_indicators or [])}
    return tile_mjai in dora_tiles
