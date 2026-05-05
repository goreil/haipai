#!/usr/bin/env python3
"""Per-mistake input prep — produces the data the frontend categorizer reads.

Step 2 of the BACKEND-TO-FRONTEND refactor moved the rule decision into
`static/js/categorize.js`; this package now only computes the *inputs*
the JS categorizer reads at render time:

- `discard_stats` / `best_discard` (via `lib.shanten`)
- `safety_ratings` / `opponent_discards` (via `lib.defense`)
- `dealin_rates` / `wait_breakdowns` / `suji_partners` / `per_threat`
  (via `lib.defense_kd`, the KillerDucky riichi-defense port)
- Riichi-specific patches (`tenpai_waits`, `bad_riichi_reason`,
  `furiten_tiles`, `actual_riichi_tile`, `prior_own_discards`)
  via `lib.furiten`.

Public surface:

- `prepare_mistake_data(mistake, mortal_data, kyoku_idx, entry, defense_ctx)`
  returns a dict of fields to merge into a mistake's `data_json`. No
  category, no labels — those are JS-side now.
- `prepare_game_data(conn, game_id, force, on_progress)` walks every
  mistake in a game, calls `prepare_mistake_data`, and writes the
  results.
- `backfill_board_state_db` / `backfill_discard_stats_db` /
  `backfill_safety_ratings_db` are re-exported from `.backfill` so
  callers can re-run a single piece of the prep pipeline on stored
  mistakes without redoing the full pass.
"""

import json
import logging
import sys
from pathlib import Path

from lib.board import (
    extract_board_state,
    reconstruct_context,
    subtract_hand_from_wall,
)
from lib.parse import flatten_mjai_log
from lib.tiles import ID_TO_MJAI

from .backfill import (
    backfill_board_state_db,
    backfill_discard_stats_db,
    backfill_safety_ratings_db,
)

logger = logging.getLogger(__name__)

DIR = Path(__file__).parent.parent.parent


_NON_DAHAI_RIICHI_PATCH = {
    "reach_dahai": "5A",  # actual=reach, expected=dahai
    "dahai_reach": "5B",  # actual=dahai, expected=reach
}


def prepare_mistake_data(mistake, mortal_data, kyoku_idx, entry,
                         defense_ctx=None):
    """Compute the per-mistake input fields the frontend categorizer needs.

    Returns a dict of fields to merge into the mistake's `data_json`.
    Never sets `category`, `categorize_data`, or `labels` — the JS
    categorizer derives those from these inputs at render time.

    Returns an empty dict when nothing useful can be computed (hand
    already winning, shanten failure, missing context).
    """
    actual = mistake.get("actual") or {}
    expected = mistake.get("expected") or {}

    at, et = actual.get("type"), expected.get("type")

    # --- Non-dahai branch (meld/riichi/kan decisions) ---
    # No discard tradeoff. We still want a per-tile shanten table for the
    # EV-table view, plus 5A/5B-specific furiten / wait data.
    if not (at == "dahai" and et == "dahai"):
        patch = {}
        stats = _compute_shanten_stats(mistake, mortal_data, kyoku_idx, entry)
        if stats:
            patch["discard_stats"] = stats

        if at == "reach" and et == "dahai":
            patch.update(_compute_bad_riichi_reason(
                mistake, defense_ctx, mortal_data, kyoku_idx, entry))
        elif at == "dahai" and et == "reach":
            patch.update(_compute_missed_riichi_patch(
                mistake, defense_ctx, mortal_data, kyoku_idx, entry))

        return patch

    # --- Dahai vs dahai: full prep ---
    hand = mistake.get("hand") or []
    melds = mistake.get("melds") or []
    tiles_left = entry["tiles_left"]

    wall, _round_wind, _seat_wind, _dora_ids, _ = reconstruct_context(
        mortal_data, kyoku_idx, tiles_left
    )
    wall = subtract_hand_from_wall(wall, hand)
    for i, count in enumerate(wall):
        if count < 0:
            tile_name = ID_TO_MJAI.get(i, f"id={i}")
            logger.warning("Negative wall count: wall[%d] (%s) = %d, clamping",
                           i, tile_name, count)
            wall[i] = 0

    patch = {}

    # Defense: safety ratings, opponent discards, KD-style dealin breakdown.
    if defense_ctx:
        from lib.defense import (
            get_tile_safety_for_mistake,
            get_opponent_discards,
        )
        safety = get_tile_safety_for_mistake(
            hand, defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"],
            tiles_left, wall,
        )
        if safety:
            patch["safety_ratings"] = {k: round(v, 1) for k, v in safety.items()}
            patch["opponent_discards"] = get_opponent_discards(
                defense_ctx["mjai_events"], defense_ctx["start_pos"],
                defense_ctx["end_pos"], defense_ctx["player_id"],
                tiles_left,
            )
        patch.update(_compute_kd_defense_patch(
            hand, defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"],
            tiles_left, wall,
        ))

    # Shanten + ukeire.
    from lib.shanten import calculate as calc_shanten
    try:
        response = calc_shanten(hand, melds, wall)
    except ValueError as e:
        if "winning" in str(e).lower():
            # Hand already in winning form — strategy decision, not efficiency.
            # Frontend categorizes it as P4 from action types alone.
            return patch
        logger.warning("Shanten error on mistake: %s", e)
        return patch
    except Exception as e:
        logger.warning("Shanten error on mistake: %s", e)
        return patch

    discard_stats = response.get("stats") or []
    if discard_stats:
        patch["discard_stats"] = discard_stats
        patch["best_discard"] = discard_stats[0]["tile"]

    return patch


def _compute_bad_riichi_reason(mistake, defense_ctx, mortal_data=None,
                               kyoku_idx=None, entry=None):
    """5A patch: detect furiten + collect wait tiles.

    Furiten = riichi'd into a wait that includes a tile already in the
    player's own discards, so they can never ron. Returns the empty dict
    when context is missing or the hand isn't in a detectable furiten
    state.
    """
    if not defense_ctx:
        return {}
    try:
        from lib.furiten import (
            find_riichi_context, is_furiten, tenpai_wait_tiles,
        )
        riichi_tile, own_discards = find_riichi_context(
            defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"],
        )
        if not riichi_tile:
            return {}
        hand = list(mistake.get("hand") or [])
        if riichi_tile not in hand:
            return {}
        hand.remove(riichi_tile)
        fur = is_furiten(hand, mistake.get("melds") or [], own_discards)
        wall = _wall_for_mistake(mistake, mortal_data, kyoku_idx, entry)
        wait_tiles = tenpai_wait_tiles(hand, mistake.get("melds") or [], wall)
    except Exception as e:
        logger.warning("furiten compute failed: %s", e)
        return {}

    patch = {"actual_riichi_tile": riichi_tile}
    if wait_tiles:
        patch["tenpai_waits"] = wait_tiles
    if fur["is_furiten"]:
        patch["bad_riichi_reason"] = "furiten"
        patch["furiten_tiles"] = fur["furiten_tiles"]
    return patch


def _compute_missed_riichi_patch(mistake, defense_ctx, mortal_data=None,
                                 kyoku_idx=None, entry=None):
    """5B patch: would-be riichi tile + 13-tile waits + own prior discards.

    Player made a plain dahai instead of declaring riichi, so the tile
    they actually picked IS the would-be riichi tile. Furiten doesn't
    apply (they didn't declare).
    """
    if not defense_ctx:
        return {}
    actual = mistake.get("actual") or {}
    would_riichi_tile = actual.get("pai")
    if not would_riichi_tile:
        return {}
    try:
        from lib.furiten import (
            find_discard_history_for_turn, tenpai_wait_tiles,
        )
        target_junme = mistake.get("turn")
        own_discards = find_discard_history_for_turn(
            defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"], target_junme,
        )
        hand = list(mistake.get("hand") or [])
        if would_riichi_tile not in hand:
            return {}
        hand.remove(would_riichi_tile)
        wall = _wall_for_mistake(mistake, mortal_data, kyoku_idx, entry)
        wait_tiles = tenpai_wait_tiles(hand, mistake.get("melds") or [], wall)
    except Exception as e:
        logger.warning("5B waits compute failed: %s", e)
        return {}
    if not wait_tiles:
        return {}
    return {
        "tenpai_waits": wait_tiles,
        "prior_own_discards": own_discards,
    }


def _compute_kd_defense_patch(hand, events, start_pos, end_pos, player_id,
                              tiles_left, wall):
    """KillerDucky-style defense data for a mistake under a riichi threat.

    Returns the empty dict when there is no riichi threat (KD's model
    only applies to declared riichi). Fine-grained safety labels
    (``"honor (N left)"``, ``"suji 2-8"``, …) are derived on the client
    from this payload plus ``board_state``.
    """
    try:
        from lib.defense_kd import compute_kd_defense_data
        kd = compute_kd_defense_data(
            hand, events, start_pos, end_pos, player_id, tiles_left, wall,
        )
    except Exception as e:
        logger.warning("KD defense compute failed: %s", e)
        return {}
    if not kd:
        return {}
    return {
        "dealin_rates": kd["dealin_rates"],
        "wait_breakdowns": kd["wait_breakdowns"],
        "suji_partners": kd["suji_partners"],
        "per_threat": kd["per_threat"],
    }


def _wall_for_mistake(mistake, mortal_data, kyoku_idx, entry):
    """Reconstruct the remaining-tiles wall at the mistake's decision point.

    Returns None on any reconstruction error — callers then get zero
    counts on wait tiles but no crash.
    """
    if mortal_data is None or kyoku_idx is None or entry is None:
        return None
    tiles_left = entry.get("tiles_left")
    if tiles_left is None:
        return None
    try:
        wall, _, _, _, _ = reconstruct_context(
            mortal_data, kyoku_idx, tiles_left
        )
        wall = subtract_hand_from_wall(wall, mistake.get("hand") or [])
        for i, c in enumerate(wall):
            if c < 0:
                wall[i] = 0
        return wall
    except Exception as e:
        logger.warning("wall reconstruct failed: %s", e)
        return None


def _compute_shanten_stats(mistake, mortal_data, kyoku_idx, entry):
    """Per-discard shanten + ukeire for any 14-tile mistake.

    Used by non-dahai categories (5A/5B/meld/kan) so the EV table can
    show a Shanten value for each highlighted tile. Returns ``[]`` when
    the hand isn't 14 tiles or the library raises.
    """
    hand = mistake.get("hand") or []
    if len(hand) != 14:
        return []
    melds = mistake.get("melds") or []
    tiles_left = entry.get("tiles_left") if entry else None
    if tiles_left is None:
        return []
    try:
        wall, *_ = reconstruct_context(mortal_data, kyoku_idx, tiles_left)
        wall = subtract_hand_from_wall(wall, hand)
        for i, c in enumerate(wall):
            if c < 0:
                wall[i] = 0
        from lib.shanten import calculate as calc_shanten
        response = calc_shanten(hand, melds, wall)
        return response.get("stats") or []
    except Exception as e:
        logger.warning("discard_stats compute failed: %s", e)
        return []


def prepare_game_data(conn, game_id, force=False, on_progress=None):
    """Compute the input data for every mistake in a game and write to DB.

    Reads the mortal JSON, walks each mistake, calls
    `prepare_mistake_data`, and merges the resulting fields into
    `data_json`. Never writes the `category` column — that's JS-side.

    `force` re-runs even on mistakes that already have `discard_stats`
    populated (the pre-existing implicit "already prepped" check).

    Returns ``(prepared_count, _unused, failures)``. The middle slot is
    kept for caller compatibility with the old ``categorize_game_db``
    return shape (api_calls); always 0 now.
    """
    import db as dbmod  # local: top-level import would create a circular dep

    game_row = conn.execute(
        "SELECT mortal_file FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    if not game_row or not game_row["mortal_file"]:
        return 0, 0, 0

    mortal_path = DIR / game_row["mortal_file"]
    if not mortal_path.exists():
        return 0, 0, 0

    with open(mortal_path) as f:
        mortal_data = json.load(f)

    kyokus = mortal_data["review"]["kyokus"]
    events = flatten_mjai_log(mortal_data["mjai_log"])
    start_events = [e for e in events if e.get("type") == "start_kyoku"]
    start_positions = [i for i, e in enumerate(events)
                       if e.get("type") == "start_kyoku"]
    player_id = mortal_data["player_id"]

    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()

    rounds = {}
    for mr in mistake_rows:
        rounds.setdefault(mr["round_name"], []).append(mr)

    from lib.parse import round_header

    work_items = []
    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_header = round_header(start)
        db_mistakes = rounds.get(rnd_header, [])
        if not db_mistakes:
            continue

        start_pos = start_positions[kyoku_idx]
        end_pos = (start_positions[kyoku_idx + 1]
                   if kyoku_idx + 1 < len(start_positions) else len(events))
        defense_ctx = {
            "mjai_events": events,
            "start_pos": start_pos,
            "end_pos": end_pos,
            "player_id": player_id,
        }

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

            if not m.get("board_state"):
                board = extract_board_state(mortal_data, kyoku_idx,
                                            entry["tiles_left"])
                dbmod.update_mistake_data(conn, mr["id"], {"board_state": board})

            # Skip already-prepped mistakes unless forced. "Prepped" means
            # discard_stats present; anything missing further fields can
            # be filled in by the more targeted backfill helpers.
            if m.get("discard_stats") and not force:
                continue

            work_items.append((mr, m, mortal_data, kyoku_idx, entry, defense_ctx))

    if not work_items:
        return 0, 0, 0

    prepared = 0
    failures = 0

    for mr, m, mortal_data, kyoku_idx, entry, defense_ctx in work_items:
        try:
            patch = prepare_mistake_data(
                m, mortal_data, kyoku_idx, entry, defense_ctx=defense_ctx,
            )
        except Exception as e:
            logger.warning("prepare_mistake_data failed for mistake %s: %s",
                           mr["id"], e)
            failures += 1
            patch = {}

        if patch:
            import db as dbmod  # noqa: F811
            dbmod.update_mistake_data(conn, mr["id"], patch)
            prepared += 1

        if on_progress:
            on_progress(prepared + failures, len(work_items))

    return prepared, 0, failures


__all__ = [
    "prepare_mistake_data",
    "prepare_game_data",
    "backfill_board_state_db",
    "backfill_discard_stats_db",
    "backfill_safety_ratings_db",
]
