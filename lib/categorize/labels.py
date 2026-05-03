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
