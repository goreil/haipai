#!/usr/bin/env python3
"""Defense evaluation entry points.

Delegates to ``lib/defense_kd.py`` (MIT-licensed KillerDucky port) for
the actual safety math. This module exposes a small adapter surface
that the categorize pipeline and UI-facing backfills call into:

- ``get_tile_safety_for_mistake`` — per-tile 0-15 safety rating
- ``get_opponent_discards`` — mjai discard pool per riichi opponent

Defense signals fire only for declared riichi threats. Open-meld
threats are not evaluated here; categorization handles them as
attack-side decisions via the push classifier (they never land in a
D-category).
"""

from lib.defense_kd import get_tile_safety_for_mistake as _kd_safety
from lib.parse import walk_kyoku


def get_tile_safety_for_mistake(hand_mjai, mjai_log_events, start_pos, end_pos,
                                player_id, tiles_left, wall_remaining):
    """Per-tile 0-15 safety rating against riichi opponents.

    Returns ``{mjai_tile: safety}`` or ``None`` when no opponent is in
    riichi.
    """
    return _kd_safety(hand_mjai, mjai_log_events, start_pos, end_pos,
                      player_id, tiles_left, wall_remaining)


def get_opponent_discards(mjai_log_events, start_pos, end_pos, player_id,
                          target_tiles_left):
    """Discard pools (mjai, ordered) per riichi opponent.

    Returns ``[{seat, discards, riichi_idx}, ...]`` or ``None`` when no
    opponent is in riichi. ``riichi_idx`` is the slot in ``discards``
    at which riichi was declared.
    """
    state = walk_kyoku(mjai_log_events, start_pos, end_pos, player_id,
                       target_tiles_left)
    riichi_opps = [
        {"seat": seat, "discards": opp["discards"],
         "riichi_idx": opp["reach_event_idx"]}
        for seat, opp in state["opponents"].items()
        if opp["reach_event_idx"] is not None
    ]
    return riichi_opps if riichi_opps else None
