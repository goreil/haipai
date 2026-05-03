#!/usr/bin/env python3
"""Database backfills that re-run pieces of the categorize pipeline on
existing mistakes — board state, discard stats, defense ratings.

These are invoked from the admin/backfill HTTP routes; they share the
same wall-reconstruction and KD-defense helpers as the live
categorizer but skip the model API entirely.
"""

import json
import logging
from pathlib import Path

from lib.board import (
    extract_board_state,
    reconstruct_context,
    subtract_hand_from_wall,
)
from lib.parse import flatten_mjai_log
from lib.tiles import dora_indicator_to_dora_mjai

logger = logging.getLogger(__name__)

DIR = Path(__file__).parent.parent.parent


def backfill_board_state_db(conn, game_id, force=False):
    """Populate board_state on all mistakes missing it (no API calls).

    Also patches the canonical ``tiles_left`` key onto pre-CS-02 board_state
    blobs that pre-date its introduction (cheap in-place add — no full
    re-extract needed since ``entry["tiles_left"]`` IS the canonical value).

    If force=True, re-extracts board_state even for mistakes that already have it.
    Returns the number of mistakes updated.
    """
    import db as dbmod  # local: top-level import would create a circular dep

    game_row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if not game_row or not game_row["mortal_file"]:
        return 0

    mortal_path = DIR / game_row["mortal_file"]
    if not mortal_path.exists():
        return 0

    with open(mortal_path) as f:
        mortal_data = json.load(f)

    kyokus = mortal_data["review"]["kyokus"]
    events = flatten_mjai_log(mortal_data["mjai_log"])
    start_events = [e for e in events if e.get("type") == "start_kyoku"]

    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()

    rounds = {}
    for mr in mistake_rows:
        rn = mr["round_name"]
        if rn not in rounds:
            rounds[rn] = []
        rounds[rn].append(mr)

    updated = 0
    from lib.parse import round_header

    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_header = round_header(start)
        db_mistakes = rounds.get(rnd_header, [])
        if not db_mistakes:
            continue

        mistake_idx = 0
        for entry in kyoku["entries"]:
            if entry["is_equal"]:
                continue

            while mistake_idx < len(db_mistakes):
                if db_mistakes[mistake_idx]["turn"] == entry["junme"]:
                    break
                mistake_idx += 1
            else:
                continue
            if mistake_idx >= len(db_mistakes):
                continue

            mr = db_mistakes[mistake_idx]
            mistake_idx += 1

            m = dbmod.row_to_mistake(mr)
            existing = m.get("board_state")
            if existing and not force:
                # Existing blob — only intervene if a canonical key is missing.
                # Patching it on without a full re-extract keeps backfill
                # cheap on prod-sized DBs.
                patched = False
                if "tiles_left" not in existing:
                    existing["tiles_left"] = entry["tiles_left"]
                    patched = True
                if "dora_tiles" not in existing:
                    # Mapping is pure; no mortal_file walk needed. Resolve
                    # straight from the already-stored indicators.
                    existing["dora_tiles"] = [
                        dora_indicator_to_dora_mjai(d)
                        for d in existing.get("dora_indicators", [])
                    ]
                    patched = True
                if patched:
                    dbmod.update_mistake_data(
                        conn, mr["id"], {"board_state": existing}
                    )
                    updated += 1
                continue

            board = extract_board_state(mortal_data, kyoku_idx, entry["tiles_left"])
            dbmod.update_mistake_data(conn, mr["id"], {"board_state": board})
            updated += 1

    return updated


def backfill_discard_stats_db(conn, game_id, force=False):
    """Re-fetch discard_stats (with individual necessary_tiles) for dahai-vs-dahai
    mistakes. Preserves categories, notes, and other manual annotations —
    only the discard_stats / best_discard fields on each mistake are rewritten.

    Without force, skips mistakes whose stored discard_stats already has per-tile
    `necessary_tiles` (i.e. already current-format).
    """
    import db as dbmod

    game_row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if not game_row or not game_row["mortal_file"]:
        return 0

    mortal_path = DIR / game_row["mortal_file"]
    if not mortal_path.exists():
        return 0

    with open(mortal_path) as f:
        mortal_data = json.load(f)

    kyokus = mortal_data["review"]["kyokus"]
    events = flatten_mjai_log(mortal_data["mjai_log"])
    start_events = [e for e in events if e.get("type") == "start_kyoku"]

    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()

    rounds = {}
    for mr in mistake_rows:
        rn = mr["round_name"]
        rounds.setdefault(rn, []).append(mr)

    from lib.parse import round_header
    updated = 0

    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_header = round_header(start)
        db_mistakes = rounds.get(rnd_header, [])
        if not db_mistakes:
            continue

        mistake_idx = 0
        for entry in kyoku["entries"]:
            if entry["is_equal"]:
                continue
            while mistake_idx < len(db_mistakes):
                if db_mistakes[mistake_idx]["turn"] == entry["junme"]:
                    break
                mistake_idx += 1
            if mistake_idx >= len(db_mistakes):
                continue

            mr = db_mistakes[mistake_idx]
            mistake_idx += 1

            m = dbmod.row_to_mistake(mr)
            actual = m.get("actual") or {}
            expected = m.get("expected") or {}
            if actual.get("type") != "dahai" or expected.get("type") != "dahai":
                continue

            # Skip if already current-format (has per-tile necessary_tiles).
            existing = m.get("discard_stats") or []
            already_current = existing and all(
                "necessary_tiles" in s for s in existing
            )
            if already_current and not force:
                continue

            hand = m.get("hand") or []
            melds = m.get("melds") or []
            tiles_left = entry["tiles_left"]

            try:
                wall, _rw, _sw, _di, _tl = reconstruct_context(
                    mortal_data, kyoku_idx, tiles_left
                )
                wall = subtract_hand_from_wall(wall, hand)
                for i, c in enumerate(wall):
                    if c < 0:
                        wall[i] = 0
                from lib.shanten import calculate as calc_shanten
                response = calc_shanten(hand, melds, wall)
            except Exception as e:
                logger.warning("discard_stats backfill skipped mistake %s: %s",
                               mr["id"], e)
                continue

            discard_stats = response.get("stats") or []
            if not discard_stats:
                continue
            best_mjai = discard_stats[0]["tile"]
            dbmod.update_mistake_data(conn, mr["id"], {
                "discard_stats": discard_stats,
                "best_discard": best_mjai,
            })
            updated += 1

    return updated


def backfill_safety_ratings_db(conn, game_id, force=False):
    """Populate safety_ratings + opponent_discards on defense-relevant mistakes
    using the generalized threat detector (riichi OR 3+ open melds).

    Without force, skips mistakes that already have safety_ratings.
    """
    import db as dbmod
    from lib.defense import get_tile_safety_for_mistake, get_opponent_discards

    # Lazy import to avoid a circular dep with the package __init__
    # (which itself imports backfill_* names from this module).
    from lib.categorize import _compute_kd_defense_patch

    game_row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if not game_row or not game_row["mortal_file"]:
        return 0

    mortal_path = DIR / game_row["mortal_file"]
    if not mortal_path.exists():
        return 0

    with open(mortal_path) as f:
        mortal_data = json.load(f)

    player_id = mortal_data.get("player_id")
    kyokus = mortal_data["review"]["kyokus"]
    events = flatten_mjai_log(mortal_data["mjai_log"])
    start_positions = [i for i, e in enumerate(events)
                       if e.get("type") == "start_kyoku"]
    start_events = [events[i] for i in start_positions]

    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()

    rounds = {}
    for mr in mistake_rows:
        rounds.setdefault(mr["round_name"], []).append(mr)

    from lib.parse import round_header
    updated = 0

    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_header = round_header(start)
        db_mistakes = rounds.get(rnd_header, [])
        if not db_mistakes:
            continue

        start_pos = start_positions[kyoku_idx]
        end_pos = (start_positions[kyoku_idx + 1]
                   if kyoku_idx + 1 < len(start_positions) else len(events))

        mistake_idx = 0
        for entry in kyoku["entries"]:
            if entry["is_equal"]:
                continue
            while mistake_idx < len(db_mistakes):
                if db_mistakes[mistake_idx]["turn"] == entry["junme"]:
                    break
                mistake_idx += 1
            if mistake_idx >= len(db_mistakes):
                continue

            mr = db_mistakes[mistake_idx]
            mistake_idx += 1

            m = dbmod.row_to_mistake(mr)
            # Skip only when the full KD defense payload is present — legacy
            # mistakes that have safety_ratings but no dealin_rates still need
            # backfilling to populate the new UI fields.
            if m.get("safety_ratings") and m.get("dealin_rates") and not force:
                continue

            hand = m.get("hand") or []
            tiles_left = entry["tiles_left"]

            try:
                wall, _rw, _sw, _di, _tl = reconstruct_context(
                    mortal_data, kyoku_idx, tiles_left
                )
                wall = subtract_hand_from_wall(wall, hand)
                for i, c in enumerate(wall):
                    if c < 0:
                        wall[i] = 0
                safety = get_tile_safety_for_mistake(
                    hand, events, start_pos, end_pos, player_id,
                    tiles_left, wall,
                )
            except Exception as e:
                logger.warning("safety backfill skipped mistake %s: %s",
                               mr["id"], e)
                continue

            if not safety:
                continue

            safety = {k: round(v, 1) for k, v in safety.items()}
            opp_discards = get_opponent_discards(
                events, start_pos, end_pos, player_id, tiles_left,
            )
            patch = {"safety_ratings": safety}
            if opp_discards:
                patch["opponent_discards"] = opp_discards
            kd_patch = _compute_kd_defense_patch(
                hand, events, start_pos, end_pos, player_id, tiles_left, wall,
                current_turn=(mr["turn"] or 0),
            )
            if kd_patch:
                patch.update(kd_patch)
            dbmod.update_mistake_data(conn, mr["id"], patch)
            updated += 1

    return updated
