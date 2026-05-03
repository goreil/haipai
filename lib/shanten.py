#!/usr/bin/env python3
"""Pure-Python tile efficiency (shanten + ukeire).

Replaces nanikiru for the auto-categorization pipeline. Returns a subset
of the nanikiru response shape — shanten and per-discard necessary_tiles
(ukeire), no exp_score and no win_prob. Nanikiru is kept for the
optional per-hand score endpoint where those numbers are requested.
"""

from mahjong.shanten import Shanten

_shanten = Shanten()


MJAI_TO_BASE = {
    "1m": 0, "2m": 1, "3m": 2, "4m": 3, "5m": 4, "6m": 5, "7m": 6, "8m": 7, "9m": 8,
    "1p": 9, "2p": 10, "3p": 11, "4p": 12, "5p": 13, "6p": 14, "7p": 15, "8p": 16, "9p": 17,
    "1s": 18, "2s": 19, "3s": 20, "4s": 21, "5s": 22, "6s": 23, "7s": 24, "8s": 25, "9s": 26,
    "E": 27, "S": 28, "W": 29, "N": 30, "P": 31, "F": 32, "C": 33,
    # Red fives map to their base id — shanten doesn't care about dora
    "5mr": 4, "5pr": 13, "5sr": 22,
}

BASE_TO_MJAI = [
    "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
    "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
    "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
    "E", "S", "W", "N", "P", "F", "C",
]

# Red-five IDs in the wall array (wall is 37 entries: 34 base + 3 red).
_RED_WALL_IDX = {4: 34, 13: 35, 22: 36}


def _hand_to_34(hand_mjai):
    """Count tiles in the 34-array (base tile only). Return (counts, red_set).

    red_set is the set of base IDs (4, 13, 22) for which the hand holds a red five.
    Used to decide whether to report the discard as "5m" vs "5mr" for display.
    """
    counts = [0] * 34
    red = set()
    for t in hand_mjai:
        base = MJAI_TO_BASE[t]
        counts[base] += 1
        if t in ("5mr", "5pr", "5sr"):
            red.add(base)
    return counts, red


def _display_name(base_id, red_fives):
    """Pick the mjai tile name for display. Prefer red-five variant if in hand."""
    if base_id == 4 and 4 in red_fives:
        return "5mr"
    if base_id == 13 and 13 in red_fives:
        return "5pr"
    if base_id == 22 and 22 in red_fives:
        return "5sr"
    return BASE_TO_MJAI[base_id]


def _wall_count(wall, base_id):
    """Total remaining copies of a tile across base + red-five slots."""
    c = wall[base_id] if base_id < len(wall) else 0
    red_idx = _RED_WALL_IDX.get(base_id)
    if red_idx is not None and red_idx < len(wall):
        # Red-five slot already counted? Nanikiru treats wall[0..33] as base-inclusive
        # (the red five counts toward the base total). Keep the same convention:
        # don't double-count.
        pass
    return c


def calculate(hand_mjai, melds_mjai, wall):
    """Compute shanten + ukeire for a 14-tile hand (post-draw).

    Args:
        hand_mjai: list of 14 mjai tile strings.
        melds_mjai: list of called melds (chi/pon/ankan/etc.), each ``{type, pai, consumed}``.
        wall: 37-element array of remaining tile counts (indices 0-33 base tiles,
            34-36 red fives). Convention matches nanikiru / `lib.categorize` wall.

    Returns:
        ``{"shanten": int, "stats": [...]}`` where each stats entry is
        ``{"tile": mjai_str, "shanten": int, "necessary_count": int, "necessary_tiles": [...]}``.
        Stats are sorted by ``(shanten, -necessary_count)``, so ``stats[0]`` is
        the best discard.

    Raises:
        ValueError: if the hand is already in a winning form (shanten == -1 with
            14 tiles). Caller should classify the mistake as "passed on win".
    """
    hand34, red_fives = _hand_to_34(hand_mjai)
    # The mahjong lib's Shanten class has no meld parameter — it infers the
    # number of melds from ``sum(tiles_34)`` (each missing 3-tile slot is
    # assumed to be a called meld). We pass only the concealed hand.
    # Chiitoitsu and kokushi additionally require a fully concealed hand.
    closed = not melds_mjai

    # Winning hand check — analogous to nanikiru's "和了形" error.
    if _shanten.calculate_shanten(hand34, use_chiitoitsu=closed, use_kokushi=closed) == -1:
        raise ValueError("hand is already in winning form")

    seen_bases = set()
    stats = []
    for base_id, count in enumerate(hand34):
        if count == 0 or base_id in seen_bases:
            continue
        seen_bases.add(base_id)

        after = hand34[:]
        after[base_id] -= 1
        sh = _shanten.calculate_shanten(after, use_chiitoitsu=closed, use_kokushi=closed)

        necessary = []
        for t in range(34):
            trial = after[:]
            trial[t] += 1
            if _shanten.calculate_shanten(trial, use_chiitoitsu=closed, use_kokushi=closed) < sh:
                # Include tiles with 0 remaining — the UI renders them as
                # dimmed "dead wait" chips so the student sees the shape
                # even when the tile has been fully dealt away.
                necessary.append({"tile": BASE_TO_MJAI[t], "count": _wall_count(wall, t)})

        stats.append({
            "tile": _display_name(base_id, red_fives),
            "shanten": sh,
            # necessary_count stays the SUM of live counts (excludes 0-count
            # tiles) — that's still the meaningful "how many tiles help"
            # number. Individual entries retain their zeroes for rendering.
            "necessary_count": sum(n["count"] for n in necessary),
            "necessary_tiles": necessary,
        })

    stats.sort(key=lambda s: (s["shanten"], -s["necessary_count"]))
    best_shanten = stats[0]["shanten"] if stats else None
    return {"shanten": best_shanten, "stats": stats}
