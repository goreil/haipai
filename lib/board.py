#!/usr/bin/env python3
"""Wall reconstruction + board-state extraction.

Canonical owners of the wall vector and ``BoardState`` shape (see
REFACTOR-TARGET.md). Every place that needs to know "what's visible /
how far into the kyoku are we?" reads from here rather than walking
``mjai_log`` again.
"""

from lib.parse import flatten_mjai_log
from lib.tiles import (
    dora_indicator_to_dora_mjai,
    mjai_to_tile_id,
    tile_id_to_base,
)


# --- Wall reconstruction ---

def decrement_wall(wall, mjai_tile):
    """Decrement wall count for a tile. Handles red fives."""
    tid = mjai_to_tile_id(mjai_tile)
    base = tile_id_to_base(tid)
    wall[base] -= 1
    if tid != base:
        wall[tid] -= 1


def reconstruct_context(mortal_data, kyoku_idx, tiles_left_target):
    """Replay mjai_log for a kyoku up to tiles_left_target.

    Returns ``(wall, round_wind_id, seat_wind_id, dora_indicator_ids, tiles_left)``.
    ``wall`` is a 37-element array of remaining tile counts. ``tiles_left`` is
    the live-wall count at the cutoff (post-walk) — same value
    ``extract_board_state`` exposes on its returned dict, kept here so the
    wall-math callsites in categorize don't need a second walker to know
    where they stopped.
    """
    player_id = mortal_data["player_id"]
    events = flatten_mjai_log(mortal_data["mjai_log"])

    # Find start_kyoku events and their positions
    start_positions = []
    for i, e in enumerate(events):
        if e.get("type") == "start_kyoku":
            start_positions.append(i)

    start_pos = start_positions[kyoku_idx]
    start = events[start_pos]

    # Round/seat wind
    bakaze = start["bakaze"]  # "E" or "S"
    round_wind_id = mjai_to_tile_id(bakaze)
    oya = start["oya"]
    seat_idx = (player_id - oya) % 4
    seat_wind_id = 27 + seat_idx

    # Initialize wall: 4 of each regular tile, 1 of each red five
    wall = [4] * 34 + [1, 1, 1]

    # Track dora indicators
    dora_indicators = [start["dora_marker"]]

    # Visible tiles (everything we can see that's NOT in our hand)
    visible = []
    visible.append(start["dora_marker"])

    # Replay events from after start_kyoku
    tiles_left = 70  # standard live wall for 4-player
    pos = start_pos + 1

    # Find end of this kyoku
    next_start = start_positions[kyoku_idx + 1] if kyoku_idx + 1 < len(start_positions) else len(events)

    while pos < next_start:
        e = events[pos]
        etype = e.get("type")

        # Stop before the next draw that would take us past the target.
        # Events between draws (dahai, pon, chi, etc.) at the target
        # tiles_left are still visible and must be counted.
        if etype == "tsumo" and tiles_left <= tiles_left_target:
            break

        if etype == "tsumo":
            tiles_left -= 1
            # For a dahai decision, tiles_left_target is the post-draw state
            # of the decision player. Break here so the player's own upcoming
            # dahai isn't double-counted — subtract_hand_from_wall already
            # strips that tile from the mistake's 14-tile hand. For pon/chi/
            # kan decisions the tsumo actor is an opponent, so this doesn't
            # fire and the intervening opponent dahai stays in `visible`.
            if e.get("actor") == player_id and tiles_left <= tiles_left_target:
                break

        elif etype == "dahai":
            # Discarded tile is visible to everyone
            visible.append(e["pai"])

        elif etype in ("chi", "pon"):
            # consumed tiles (from caller's hand) become visible via the meld
            # pai was already counted as a dahai by the target player
            for t in e.get("consumed", []):
                visible.append(t)

        elif etype == "ankan":
            # All 4 tiles revealed (even though face-down, the tile type is known)
            for t in e.get("consumed", []):
                visible.append(t)

        elif etype == "kakan":
            # The added tile becomes visible
            visible.append(e["pai"])

        elif etype == "daiminkan":
            # consumed tiles (3 from caller's hand) visible; pai was already a dahai
            for t in e.get("consumed", []):
                visible.append(t)

        elif etype == "dora":
            # New dora indicator revealed (after kan)
            visible.append(e["dora_marker"])
            dora_indicators.append(e["dora_marker"])

        pos += 1

    # Build wall: subtract hand will be done by caller (since hand varies per mistake)
    # Here we subtract all visible tiles
    for t in visible:
        decrement_wall(wall, t)

    dora_ids = [mjai_to_tile_id(d) for d in dora_indicators]

    return wall, round_wind_id, seat_wind_id, dora_ids, tiles_left


def extract_board_state(mortal_data, kyoku_idx, tiles_left_target):
    """Extract full board state at a given point in a kyoku.

    Canonical owner of the BoardState shape (see REFACTOR-TARGET.md). Every
    other place that needs to know "how far into the kyoku are we?" reads
    ``tiles_left`` from the dict this returns rather than re-walking the
    kyoku — categorize / defense / JS consumers all converge here.

    Returns a dict with:
        dora_indicators: list of mjai tile strings (dora marker tiles)
        dora_tiles: list of mjai tile strings (the active dora — indicators
            resolved through ``lib.tiles.dora_indicator_to_dora_mjai``).
            Frontend reads this directly instead of mirroring the mapping.
        seat_wind: "E"/"S"/"W"/"N"
        round_wind: "E"/"S"
        scores: [int, int, int, int] at start of round
        all_discards: list of {seat, discards, riichi_idx} for all 4 players
        opponent_melds: list of {seat, melds} for non-player seats
        tiles_left: live-wall count at the cutoff point (canonical wall position)
    """
    player_id = mortal_data["player_id"]
    events = flatten_mjai_log(mortal_data["mjai_log"])

    start_positions = []
    for i, e in enumerate(events):
        if e.get("type") == "start_kyoku":
            start_positions.append(i)

    start_pos = start_positions[kyoku_idx]
    start = events[start_pos]

    # Winds
    bakaze = start["bakaze"]
    oya = start["oya"]
    seat_idx = (player_id - oya) % 4
    wind_names = ["E", "S", "W", "N"]
    seat_wind = wind_names[seat_idx]
    round_wind = bakaze

    # Scores at start of round
    scores = start.get("scores", [])

    # Dora indicators
    dora_indicators = [start["dora_marker"]]

    # Track discards and melds for all players
    discards = {i: {"tiles": [], "riichi_idx": None} for i in range(4)}
    melds = {i: [] for i in range(4)}

    tiles_left = 70
    next_start = start_positions[kyoku_idx + 1] if kyoku_idx + 1 < len(start_positions) else len(events)

    for pos in range(start_pos + 1, next_start):
        e = events[pos]
        etype = e.get("type")
        actor = e.get("actor")

        if etype == "tsumo":
            tiles_left -= 1

        elif etype == "dahai" and actor is not None:
            discards[actor]["tiles"].append({"tile": e["pai"]})

        elif etype == "reach" and actor is not None:
            # Real mjai order is tsumo → reach → dahai(riichi tile) → reach_accepted.
            # Record the slot the NEXT dahai will land on; when that dahai fires,
            # riichi_idx correctly points to the riichi tile. If the kyoku ends
            # between reach and its dahai, riichi_idx == len(tiles) and the UI's
            # `i === d.riichi_idx` check silently rotates nothing.
            d = discards[actor]
            d["riichi_idx"] = len(d["tiles"])

        elif etype in ("chi", "pon", "daiminkan") and actor is not None:
            melds[actor].append({
                "type": etype,
                "consumed": e.get("consumed", []),
                "pai": e.get("pai"),
                "target": e.get("target"),
            })
            # Mark called tile as ghost in the target's discard pool
            target = e.get("target")
            if target is not None and discards[target]["tiles"]:
                discards[target]["tiles"][-1]["called_by"] = actor

        elif etype == "ankan" and actor is not None:
            melds[actor].append({
                "type": "ankan",
                "consumed": e.get("consumed", []),
            })

        elif etype == "kakan" and actor is not None:
            melds[actor].append({
                "type": "kakan",
                "consumed": e.get("consumed", []),
                "pai": e.get("pai"),
                "target": e.get("target"),
            })

        elif etype == "dora":
            dora_indicators.append(e["dora_marker"])

        if tiles_left <= tiles_left_target:
            break

    # Build all_discards (all 4 players)
    all_discards = []
    for seat in range(4):
        d = discards[seat]
        all_discards.append({
            "seat": seat,
            "discards": d["tiles"],
            "riichi_idx": d["riichi_idx"],
        })

    # Build opponent_melds (non-player seats only)
    opponent_melds = []
    for seat in range(4):
        if seat != player_id and melds[seat]:
            opponent_melds.append({
                "seat": seat,
                "melds": melds[seat],
            })

    return {
        "dora_indicators": dora_indicators,
        # CS-02: resolved dora set, computed once via the canonical mapping
        # in lib.tiles. Frontend reads this directly instead of re-deriving
        # via its own NEXT_TILE mirror.
        "dora_tiles": [dora_indicator_to_dora_mjai(d) for d in dora_indicators],
        "seat_wind": seat_wind,
        "round_wind": round_wind,
        "scores": scores,
        "all_discards": all_discards,
        "opponent_melds": opponent_melds,
        # Canonical live-wall count at the cutoff. tiles_left_target is the
        # caller's request (from `entry["tiles_left"]`); we walk until the
        # internal counter hits it. Storing the post-walk value here means
        # downstream consumers (categorize wall math, JS, backfill) don't
        # have to re-derive it.
        "tiles_left": tiles_left,
    }


def subtract_hand_from_wall(wall, hand_tiles):
    """Subtract player's hand tiles from wall. Returns a copy."""
    w = wall[:]
    for t in hand_tiles:
        decrement_wall(w, t)
    return w
