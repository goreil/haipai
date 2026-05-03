#!/usr/bin/env python3
"""Automatic error categorization by comparing Mortal AI vs local shanten/ukeire analysis.

The package is split so each concern lives next to its tests:

- ``rules`` — RULES dict + the ``_classify_*`` / ``classify_efficiency`` helpers
  + tile-category predicates.
- ``labels`` — ``compute_labels`` (honor / value / yaku label pills).
- ``backfill`` — ``backfill_board_state_db`` / ``backfill_discard_stats_db``
  / ``backfill_safety_ratings_db`` re-runs over already-stored mistakes.

This module owns the two entry points (``categorize_mistake`` and
``categorize_game_db``) and the private helpers exclusive to them, then
re-exports the full public surface so ``from lib.categorize import X``
keeps working from every callsite.
"""

import json
import logging
import sys
from pathlib import Path

from lib.board import (
    decrement_wall,
    extract_board_state,
    reconstruct_context,
    subtract_hand_from_wall,
)
from lib.parse import flatten_mjai_log
from lib.tiles import (
    ID_TO_MJAI,
    MJAI_TO_ID,
    RED_TO_BASE,
    dora_indicator_to_dora_mjai,
    is_honor_mjai,
    is_red_five_mjai,
    mjai_to_tile_id,
    tile_id_to_base,
)

from .backfill import (
    backfill_board_state_db,
    backfill_discard_stats_db,
    backfill_safety_ratings_db,
)
from .labels import compute_labels
from .rules import (
    RULES,
    _classify_defense,
    _classify_push,
    _dealin_for,
    _find_in_stats,
    _get_exp_score_for_tile,
    _get_shanten_for_tile,
    _has_riichi_opponent,
    _has_threatening_opponent,
    _is_number_tile_mjai,
    _is_terminal_mjai,
    _is_value_tile_mjai,
    _player_has_open_melds,
    _stats_reasonably_agree,
    categorize_by_action_type,
    classify_efficiency,
    skill_area_for_entry,
)

logger = logging.getLogger(__name__)

DIR = Path(__file__).parent.parent.parent


# Tile notation (MJAI_TO_ID, helpers, predicates) lives in lib/tiles.py.
# Symbols are re-imported at the top so "from lib.categorize import MJAI_TO_ID"
# still works for downstream callers during the CS-03 transition.


def categorize_mistake(mistake, mortal_data, kyoku_idx, entry, dora_indicators,
                       defense_ctx=None):
    """Categorize a single mistake.

    Args:
        mistake: The mistake dict (as produced by lib/parse.py)
        mortal_data: Full Mortal analysis JSON
        kyoku_idx: Index into review.kyokus
        entry: The original review entry from Mortal JSON
        dora_indicators: List of dora indicator mjai strings for this round
        defense_ctx: Optional dict with keys (mjai_events, start_pos, end_pos, player_id)
                     for defense analysis

    Returns:
        (category, cat_data, safety_data, ...) where cat_data is a dict with
        shanten/ukeire results (keys ``best`` and ``stats``), or None when no
        per-tile stats were computed for this decision type.
    """
    actual = mistake["actual"]
    expected = mistake["expected"]

    # Try action-type categorization first
    cat = categorize_by_action_type(actual, expected)
    if cat is not None:
        extra = {}
        if cat == "5A":
            extra = _compute_bad_riichi_reason(mistake, defense_ctx, mortal_data, kyoku_idx, entry)
        elif cat == "5B":
            extra = _compute_missed_riichi_patch(mistake, defense_ctx, mortal_data, kyoku_idx, entry)
        # Populate discard_stats so the EV table can show Shanten per highlighted
        # tile for every non-dahai category too. best_discard is unused here
        # (there's no "Speed" pick on a riichi/meld/kan decision) so stays None.
        stats = _compute_shanten_stats(mistake, mortal_data, kyoku_idx, entry)
        cat_data = {"best": None, "stats": stats} if stats else None
        return cat, cat_data, None, None, extra

    # dahai vs dahai -> compute per-discard shanten/ukeire via lib.shanten
    hand = mistake["hand"]
    melds = mistake["melds"]
    tiles_left = entry["tiles_left"]

    # Reconstruct wall (visible tiles, not including our hand)
    wall, round_wind, seat_wind, dora_ids, _ = reconstruct_context(
        mortal_data, kyoku_idx, tiles_left
    )
    # Subtract our hand from wall
    wall = subtract_hand_from_wall(wall, hand)

    # Validate wall (no negative values)
    for i, count in enumerate(wall):
        if count < 0:
            tile_name = ID_TO_MJAI.get(i, f"id={i}")
            logger.warning("Negative wall count: wall[%d] (%s) = %d, clamping to 0", i, tile_name, count)
            wall[i] = 0

    # Compute safety ratings and opponent discards for defense visuals
    safety_data = None
    opp_discards = None
    kd_patch = {}
    if defense_ctx:
        from lib.defense import (
            get_tile_safety_for_mistake,
            get_opponent_discards,
        )
        safety_data = get_tile_safety_for_mistake(
            hand, defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"],
            tiles_left, wall,
        )
        if safety_data:
            safety_data = {k: round(v, 1) for k, v in safety_data.items()}
            opp_discards = get_opponent_discards(
                defense_ctx["mjai_events"], defense_ctx["start_pos"],
                defense_ctx["end_pos"], defense_ctx["player_id"],
                tiles_left,
            )
        kd_patch = _compute_kd_defense_patch(
            hand, defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"],
            tiles_left, wall,
            current_turn=mistake.get("turn", 0) or 0,
        )

    # Shanten + ukeire via the pure-Python mahjong library.
    from lib.shanten import calculate as calc_shanten

    try:
        response = calc_shanten(hand, melds, wall)
    except ValueError as e:
        # Hand already in winning form — strategy decision, not efficiency.
        if "winning" in str(e).lower():
            return "P4", None, safety_data, opp_discards, kd_patch
        print(f"  Shanten error: {e}", file=sys.stderr)
        return None, None, safety_data, opp_discards, kd_patch
    except Exception as e:
        print(f"  Shanten error: {e}", file=sys.stderr)
        return None, None, safety_data, opp_discards, kd_patch

    discard_stats = response["stats"]
    if not discard_stats:
        return None, None, safety_data, opp_discards, kd_patch

    best_mjai = discard_stats[0]["tile"]
    hand_shanten = response["shanten"]

    # Key kept as `cat_data` for DB/data_json backward-compat; only the
    # payload source changed (no exp_score / win_prob from this path).
    cat_data = {
        "best": best_mjai,
        "shanten": hand_shanten,
        "stats": discard_stats,
    }

    # Detect shanten-increasing discard: player chose a tile that raises shanten
    # compared to the best available discard
    actual_shanten = _get_shanten_for_tile(actual["pai"], discard_stats)
    best_shanten = discard_stats[0]["shanten"] if discard_stats else None
    if (actual_shanten is not None and best_shanten is not None
            and actual_shanten > best_shanten):
        cat_data["shanten_increase"] = True
        cat_data["actual_shanten"] = actual_shanten
        cat_data["best_shanten"] = best_shanten

    # Compare the shanten-library recommendation with Mortal's and player's actual
    mortal_best_id = mjai_to_tile_id(expected["pai"])
    actual_id = mjai_to_tile_id(actual["pai"])
    best_id = mjai_to_tile_id(best_mjai)
    best_base = tile_id_to_base(best_id)
    mortal_base = tile_id_to_base(mortal_best_id)
    actual_base = tile_id_to_base(actual_id)

    stats_agree_mortal = (best_base == mortal_base)
    mortal_agrees = stats_agree_mortal or _stats_reasonably_agree(mortal_best_id, discard_stats)

    # Informational flags (do NOT gate categorization anymore — non-riichi
    # 3+-meld threats fall through to push, per the analysis that showed
    # their P1/P2/P4 distribution matches the push baseline).
    has_threatening_opponent = _has_threatening_opponent(defense_ctx, tiles_left)
    if has_threatening_opponent:
        cat_data["threatening_opponent"] = True
    if _has_riichi_opponent(defense_ctx, tiles_left):
        cat_data["defense_trigger"] = "riichi"

    # Compute labels up front — the push classifier needs to see
    # yakuhai/dora to produce P3 "Hand Value" when no objective ukeire or
    # shanten signal fires.
    round_wind_mjai = ID_TO_MJAI.get(round_wind)
    seat_wind_mjai = ID_TO_MJAI.get(seat_wind)
    labels = compute_labels(mistake, dora_indicators, round_wind_mjai, seat_wind_mjai)
    if labels:
        cat_data["labels"] = labels

    # Defense gate: we need per-tile deal-in rates to run the new
    # classifier, and those only exist when an opponent is in riichi.
    dealin_rates = (kd_patch or {}).get("dealin_rates") or {}

    if dealin_rates:
        cat, push_reason = _classify_defense(
            mistake, dealin_rates, discard_stats, cat_data, mortal_agrees, labels,
        )
        if push_reason:
            cat_data["push_reason"] = push_reason
        # Both-safe flag: when mortal and user's picks are both 0% deal-in,
        # there's no defense tradeoff — just an efficiency choice among
        # safe tiles. Categorize as D2/D3 still (this is a defense practice
        # situation for the student), but flag so the card can swap copy.
        user_r = _dealin_for(mistake["actual"]["pai"], dealin_rates)
        mortal_r = _dealin_for(mistake["expected"]["pai"], dealin_rates)
        if user_r == 0 and mortal_r == 0 and cat in ("D2", "D3"):
            cat_data["both_safe"] = True
    else:
        cat = _classify_push(mistake, discard_stats, cat_data, mortal_agrees, labels)

    return cat, cat_data, safety_data, opp_discards, kd_patch


def _compute_bad_riichi_reason(mistake, defense_ctx, mortal_data=None,
                               kyoku_idx=None, entry=None):
    """Produce a data_json patch for 5A (Bad Riichi) mistakes.

    Currently detects furiten — the player is tenpai but the wait includes a
    tile they've already discarded, so they can never ron. Returns an empty
    dict when the context isn't available or the hand isn't in a detectable
    furiten state (e.g. shanten != 0 after removing the riichi tile, or the
    mjai log is missing the reach event for some reason).
    """
    if not defense_ctx:
        return {}
    try:
        from lib.furiten import find_riichi_context, is_furiten, tenpai_wait_tiles
        riichi_tile, own_discards = find_riichi_context(
            defense_ctx["mjai_events"], defense_ctx["start_pos"],
            defense_ctx["end_pos"], defense_ctx["player_id"],
        )
        if not riichi_tile:
            return {}
        hand = list(mistake.get("hand") or [])
        if riichi_tile not in hand:
            return {}
        hand.remove(riichi_tile)  # removes first occurrence, keeps duplicates
        fur = is_furiten(hand, mistake.get("melds") or [], own_discards)
        wall = _wall_for_mistake(mistake, mortal_data, kyoku_idx, entry)
        wait_tiles = tenpai_wait_tiles(hand, mistake.get("melds") or [], wall)
    except Exception as e:
        logger.warning("furiten compute failed: %s", e)
        return {}
    # actual_riichi_tile stored so the frontend's EV table can tag a "You"
    # row on reach mistakes (actual = {type: "reach"} has no pai of its own).
    patch = {"actual_riichi_tile": riichi_tile}
    if wait_tiles:
        # tenpai_waits is now [{tile, count}]; the UI can derive both
        # distinct-count and total-remaining from it.
        patch["tenpai_waits"] = wait_tiles
    if fur["is_furiten"]:
        patch["bad_riichi_reason"] = "furiten"
        patch["furiten_tiles"] = fur["furiten_tiles"]
    return patch


def _wall_for_mistake(mistake, mortal_data, kyoku_idx, entry):
    """Reconstruct the remaining-tiles wall at the mistake's decision point.
    Returns None on any reconstruction error — callers then get zero counts
    on wait tiles but no crash.
    """
    if mortal_data is None or kyoku_idx is None or entry is None:
        return None
    tiles_left = entry.get("tiles_left")
    if tiles_left is None:
        return None
    try:
        wall, _, _, _, _ = reconstruct_context(mortal_data, kyoku_idx, tiles_left)
        wall = subtract_hand_from_wall(wall, mistake.get("hand") or [])
        for i, c in enumerate(wall):
            if c < 0:
                wall[i] = 0
        return wall
    except Exception as e:
        logger.warning("wall reconstruct failed: %s", e)
        return None


def _compute_shanten_stats(mistake, mortal_data, kyoku_idx, entry):
    """Compute per-discard shanten + ukeire for any 14-tile mistake.

    Used by non-dahai categories (5A/5B/meld/kan) so the UI can still show a
    Shanten value for each highlighted tile in the EV table — previously these
    decisions rendered "-" because only the dahai-vs-dahai path called the
    shanten library. Returns ``[]`` when the hand isn't 14 tiles or the
    library raises.
    """
    hand = mistake.get("hand") or []
    if len(hand) != 14:
        return []
    melds = mistake.get("melds") or []
    tiles_left = entry.get("tiles_left") if entry else None
    if tiles_left is None:
        return []
    try:
        wall, _rw, _sw, _di, _tl = reconstruct_context(mortal_data, kyoku_idx, tiles_left)
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


def _compute_missed_riichi_patch(mistake, defense_ctx, mortal_data=None,
                                 kyoku_idx=None, entry=None):
    """Data patch for 5B (Missed Riichi) mistakes.

    The player made a plain dahai instead of declaring riichi, so the tile
    they picked IS the would-be riichi tile. Compute the 13-tile tenpai that
    results, then the wait set (with remaining tile counts). Furiten is N/A
    here — they didn't declare.
    """
    if not defense_ctx:
        return {}
    actual = mistake.get("actual") or {}
    would_riichi_tile = actual.get("pai")
    if not would_riichi_tile:
        return {}
    try:
        from lib.furiten import find_discard_history_for_turn, tenpai_wait_tiles
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
                              tiles_left, wall, current_turn=0):
    """Compute KillerDucky defense data (dealin rate, label, wait breakdown,
    per-threat) for a mistake. Returns an empty dict when there is no riichi
    threat, since KD's model only applies to declared riichi.

    Fine-grained safety labels (``"honor (N left)"``, ``"suji 2-8"``, …)
    are derived on the client from this payload plus ``board_state``, so
    they aren't stored here.
    """
    del current_turn  # legacy; kept for caller compatibility
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


def categorize_game_db(conn, game_id, force=False, on_progress=None):
    """Categorize mistakes for a game using SQLite database.

    Reads the mortal JSON, matches entries to DB mistakes, categorizes,
    and updates the DB directly.  Safe to call from a background thread
    (opens its own connection if the passed one is cross-thread).

    on_progress: optional callback(done, total) called after each mistake.
    Returns (categorized_count, api_calls, failures).
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
    start_positions = [i for i, e in enumerate(events) if e.get("type") == "start_kyoku"]
    player_id = mortal_data["player_id"]

    # Load all mistakes for this game, grouped by round
    mistake_rows = conn.execute(
        "SELECT * FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx",
        (game_id,),
    ).fetchall()

    # Group by round_name
    rounds = {}
    for mr in mistake_rows:
        rn = mr["round_name"]
        if rn not in rounds:
            rounds[rn] = []
        rounds[rn].append(mr)

    from lib.parse import round_header

    # Phase 1: Collect work items (sequential — DB reads + board state backfill)
    work_items = []
    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_header = round_header(start)
        db_mistakes = rounds.get(rnd_header, [])
        if not db_mistakes:
            continue

        dora_indicators = [start["dora_marker"]]
        start_pos = start_positions[kyoku_idx]
        end_pos = start_positions[kyoku_idx + 1] if kyoku_idx + 1 < len(start_positions) else len(events)
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
            tiles_left = entry["tiles_left"]

            # Extract board state if missing
            if not m.get("board_state"):
                board = extract_board_state(mortal_data, kyoku_idx, tiles_left)
                dbmod.update_mistake_data(conn, mr["id"], {"board_state": board})

            if mr["category"] and not force:
                continue

            work_items.append((mr, m, mortal_data, kyoku_idx, entry,
                               dora_indicators, defense_ctx))

    if not work_items:
        return 0, 0, 0

    # Sort by severity: ??? first, then ??, then ?
    SEV_ORDER = {"???": 0, "??": 1, "?": 2}
    work_items.sort(key=lambda w: SEV_ORDER.get(w[0]["severity"], 9))

    # Phase 2+3: Categorize and write results
    categorized = 0
    api_calls = 0
    failures = 0

    for mr, m, mortal_data, kyoku_idx, entry, dora_indicators, defense_ctx in work_items:
        needs_api = (m.get("actual", {}).get("type") == "dahai" and
                     m.get("expected", {}).get("type") == "dahai")
        if needs_api:
            api_calls += 1

        cat, cat_data, safety_data, opp_discards, kd_patch = categorize_mistake(
            m, mortal_data, kyoku_idx, entry, dora_indicators,
            defense_ctx=defense_ctx,
        )

        if cat:
            updates = {"category": cat}
            if cat_data:
                if cat_data.get("best"):
                    updates["best_discard"] = cat_data["best"]
                updates["discard_stats"] = cat_data["stats"]
                if cat_data.get("labels"):
                    updates["labels"] = cat_data["labels"]
                # Store enriched categorization data
                extra_meta = {}
                for key in ("shanten_increase", "actual_shanten", "best_shanten",
                            "threatening_opponent", "shanten",
                            "defense_trigger", "push_reason", "both_safe"):
                    if key in cat_data:
                        extra_meta[key] = cat_data[key]
                if extra_meta:
                    updates["categorize_data"] = extra_meta
            if safety_data:
                updates["safety_ratings"] = safety_data
            if opp_discards:
                updates["opponent_discards"] = opp_discards
            if kd_patch:
                updates.update(kd_patch)
            dbmod.update_mistake_data(conn, mr["id"], updates)
            categorized += 1
        elif needs_api:
            failures += 1
            # Server may have crashed — wait before next request
            import time
            time.sleep(3)

        if on_progress:
            on_progress(categorized + failures, len(work_items))

    return categorized, api_calls, failures
