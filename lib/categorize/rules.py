#!/usr/bin/env python3
"""Categorization decision rules — the RULES thresholds and the
``_classify_*`` / ``classify_efficiency`` helpers that turn a mistake
plus shanten/defense data into a category code.

Tile-category predicates (``_is_terminal_mjai`` / ``_is_number_tile_mjai``
/ ``_is_value_tile_mjai``) live here too; ``compute_labels`` in
``categorize/labels.py`` re-imports the terminal predicate, no other
direction.
"""

from lib.tiles import ID_TO_MJAI, is_honor_mjai, tile_id_to_base


# --- Tunable categorization rules ---
# Edit these thresholds, then run: python3 mj_games.py categorize --recheck --dry-run
# to see the impact on all existing categorizations (instant, no API calls).

RULES = {
    # "Reasonable agreement" check: mortal's tile is considered efficiency (not strategy)
    # if it has the same shanten as cpp's best AND scores within this absolute threshold.
    "agree_exp_score_diff": 60,         # absolute expected score difference
    "agree_necessary_ratio": 0.80,      # fallback: mortal necessary_count >= best_discard * this

    # 1V "Value Tile Ordering" threshold: honor/terminal vs number tile where
    # cpp scores are close (efficiency is similar but mortal has a preference).
    "value_tile_diff": 60,              # max absolute exp_score diff for 1V classification
}


# --- Action-type categorization (non-dahai vs non-dahai) ---

def categorize_by_action_type(actual, expected):
    """Categorize non-discard-vs-discard mistakes by action type.
    Returns category string or None if this is a dahai-vs-dahai case.
    """
    at = actual.get("type")
    et = expected.get("type")

    # Meld decisions (4A-4C)
    if at in ("chi", "pon") and et == "none":
        return "4A"  # Bad meld call
    if at == "none" and et in ("chi", "pon"):
        return "4B"  # Missed meld opportunity
    if at in ("chi", "pon") and et in ("chi", "pon"):
        return "4C"  # Wrong meld choice

    # Riichi decisions (5A-5B)
    if at == "reach" and et == "dahai":
        return "5A"  # Bad riichi
    if at == "dahai" and et == "reach":
        return "5B"  # Missed riichi

    # Kan decisions (6A-6B)
    if at in ("ankan", "kakan", "daiminkan") and et in ("dahai", "none"):
        return "6A"  # Bad kan
    if at in ("dahai", "none") and et in ("ankan", "kakan", "daiminkan"):
        return "6B"  # Missed kan

    # Missed win
    if et == "hora":
        return "P4"  # Passed on win — strategic error

    # dahai vs dahai -> needs per-discard shanten/ukeire comparison (handled elsewhere)
    if at == "dahai" and et == "dahai":
        return None

    # Other combinations (reach vs none, etc.) - categorize as strategic
    return "P4"


# --- Skill-area classification (for every Mortal entry, mistake or not) ---

_MELD_TYPES = frozenset({"chi", "pon"})
_KAN_TYPES = frozenset({"ankan", "kakan", "daiminkan"})


def skill_area_for_entry(actual_type, expected_type, detail_types=(),
                         in_riichi=False):
    """Classify a Mortal review entry into exactly one skill area.

    Returns one of ``"attack"``, ``"defense"``, ``"meld"``, ``"riichi"``,
    ``"kan"``, or ``None`` if the entry isn't a trackable player decision
    (e.g. pure hora with no counterfactual option).

    Rule: take the union of ``actual.type`` and ``expected.type`` — for
    mistakes these differ, for ``is_equal`` entries they're identical — and
    pick the highest-priority non-dahai action type on the table, so
    entries line up with ``CATEGORY_INFO[cat]["group"]`` (e.g. a 5B
    dahai/reach stays in Riichi, a 4B none/chi stays in Meld). Falls
    through to attack/defense when the decision is a plain discard.
    """
    types = {actual_type, expected_type}
    if types & _MELD_TYPES:
        return "meld"
    if "reach" in types:
        return "riichi"
    if types & _KAN_TYPES:
        return "kan"
    if "dahai" in types:
        return "defense" if in_riichi else "attack"
    # Both sides are "none" / "hora" — the entry represents a passed call
    # opportunity. Recover the skill area from what Mortal actually
    # evaluated in ``details``.
    d = set(detail_types)
    if d & _MELD_TYPES:
        return "meld"
    if "reach" in d:
        return "riichi"
    if d & _KAN_TYPES:
        return "kan"
    # No discard/call options on the table — not a counted decision.
    return None


# --- Tile-category predicates ---

def _is_terminal_mjai(tile):
    """Check if tile is a terminal (1 or 9 of any suit)."""
    return len(tile) == 2 and tile[0] in "19" and tile[1] in "mps"


def _is_number_tile_mjai(tile):
    """Check if tile is a non-terminal number tile (2-8)."""
    return len(tile) == 2 and tile[0] in "2345678" and tile[1] in "mps"


def _is_value_tile_mjai(tile):
    """Check if tile is a value tile (honor or terminal)."""
    return is_honor_mjai(tile) or _is_terminal_mjai(tile)


def _player_has_open_melds(melds):
    """True if the player has any non-ankan (open) meld."""
    if not melds:
        return False
    return any(m.get("type") in ("chi", "pon", "daiminkan", "kakan") for m in melds)


# --- discard_stats lookups ---

def _get_exp_score_for_tile(tile_mjai, discard_stats):
    """Get the expected score for a specific tile from discard_stats."""
    if not discard_stats:
        return None
    tile_base = tile_mjai.rstrip("r")
    for s in discard_stats:
        s_base = s["tile"].rstrip("r")
        if s["tile"] == tile_mjai or s_base == tile_base:
            return s.get("exp_score")
    return None


def _get_shanten_for_tile(tile_mjai, discard_stats):
    """Get the shanten value after discarding a specific tile."""
    if not discard_stats:
        return None
    tile_base = tile_mjai.rstrip("r")
    for s in discard_stats:
        s_base = s["tile"].rstrip("r")
        if s["tile"] == tile_mjai or s_base == tile_base:
            return s.get("shanten")
    return None


def _find_in_stats(tile_mjai, discard_stats):
    """Find a tile's entry in discard_stats. Handles red five variants."""
    if not discard_stats or not tile_mjai:
        return None
    tile_base = tile_mjai.rstrip("r")
    for s in discard_stats:
        s_base = s["tile"].rstrip("r")
        if s["tile"] == tile_mjai or s_base == tile_base:
            return s
    return None


def _dealin_for(tile_mjai, dealin_rates):
    """Pull a tile's deal-in rate, handling the red-five key fallback."""
    if tile_mjai is None:
        return None
    r = dealin_rates.get(tile_mjai)
    if r is not None:
        return r
    return dealin_rates.get(tile_mjai.rstrip("r"))


# --- Threat-context probes ---

def _has_threatening_opponent(defense_ctx, tiles_left=None):
    """Check if any opponent has 3+ open melds at the mistake's time.

    An opponent with 3+ open calls is likely tenpai or close, making defense
    relevant even without a riichi declaration.

    tiles_left: tiles remaining in wall at mistake time. Events after this
    point (i.e. melds later in the kyoku) must NOT count — they aren't
    visible to the player at decision time.
    """
    if not defense_ctx:
        return False

    events = defense_ctx.get("mjai_events", [])
    start = defense_ctx.get("start_pos", 0)
    end = defense_ctx.get("end_pos", len(events))
    player_id = defense_ctx.get("player_id")

    meld_counts = {}
    seen = 70
    for pos in range(start + 1, end):
        ev = events[pos]
        if not isinstance(ev, dict):
            continue
        etype = ev.get("type", "")
        actor = ev.get("actor")
        if etype == "tsumo":
            seen -= 1
        if etype in ("chi", "pon", "daiminkan") and actor is not None and actor != player_id:
            meld_counts[actor] = meld_counts.get(actor, 0) + 1
        if tiles_left is not None and seen <= tiles_left:
            break

    return any(count >= 3 for count in meld_counts.values())


def _has_riichi_opponent(defense_ctx, tiles_left=None):
    """True if any opponent declared riichi at or before the mistake's time.

    Used to label the `defense_trigger` distinctly from 3+-open-meld threats.
    tiles_left bounds the scan so a future riichi isn't treated as active.
    """
    if not defense_ctx:
        return False
    events = defense_ctx.get("mjai_events", [])
    start = defense_ctx.get("start_pos", 0)
    end = defense_ctx.get("end_pos", len(events))
    player_id = defense_ctx.get("player_id")
    seen = 70
    for pos in range(start + 1, end):
        ev = events[pos]
        if not isinstance(ev, dict):
            continue
        etype = ev.get("type", "")
        if etype == "tsumo":
            seen -= 1
        if etype == "reach" and ev.get("actor") != player_id:
            return True
        if tiles_left is not None and seen <= tiles_left:
            break
    return False


# --- Category classifiers ---

def _classify_defense(mistake, dealin_rates, discard_stats, cat_data,
                       mortal_agrees_stats, labels=None):
    """Classify a riichi-defense mistake as D1, D2, or D3.

    Comparison is done on deal-in rate (KillerDucky-style): the choice
    whose deal-in probability is lower is the safer one.

    D1 "Defend": Mortal's choice has a strictly lower deal-in rate than
        the player's — Mortal is defending, and that's the right read.
    D2 "Push":   Mortal's choice is not safer (tie or more dangerous), AND
        the push classifier explains that choice as P1 Shanten Failure,
        P2 Tile Efficiency, or P3 Hand Value. Mortal is pushing for a
        concrete reason; the push sub-reason is returned alongside so the
        UI can render it.
    D3 "Complex": Mortal's choice is not safer and the push classifier
        returns P4 — a genuine judgment call that can't be reduced to
        basic strategy or a yakuhai/dora hold.

    Returns ``(category, push_reason)`` where ``push_reason`` is the
    P1/P2/P3 string for D2 and None otherwise.
    """
    actual_tile = mistake["actual"]["pai"]
    expected_tile = mistake["expected"]["pai"]

    user_r = _dealin_for(actual_tile, dealin_rates)
    mortal_r = _dealin_for(expected_tile, dealin_rates)

    # Strict inequality: equal deal-in rate means Mortal isn't defending.
    if user_r is not None and mortal_r is not None and mortal_r < user_r:
        return "D1", None

    # Mortal's pick is tied or more dangerous. Does basic strategy
    # justify pushing that tile out?
    push = _classify_push(mistake, discard_stats, cat_data, mortal_agrees_stats, labels)
    if push in ("P1", "P2", "P3"):
        return "D2", push
    return "D3", None


def _classify_push(mistake, discard_stats, cat_data, mortal_agrees_stats, labels=None):
    """Classify a non-defense discard mistake as P1, P2, P3, or P4.

    P1: Shanten failure (player raised shanten)
    P2: Tile efficiency failure (strictly worse ukeire than mortal's pick)
    P3: Hand value — would otherwise be P4, but a yakuhai or dora is
        involved. Mortal is likely preserving hand value; the student can
        learn this pattern. (Distinct from the retired P3 Score Efficiency,
        which was score-number driven.)
    P4: Complex decision — everything else. Genuine Mortal/calc disagreement
        with no identifiable hand-value signal.
    """
    actual_tile = mistake["actual"]["pai"]
    expected_tile = mistake["expected"]["pai"]

    actual_stat = _find_in_stats(actual_tile, discard_stats)
    expected_stat = _find_in_stats(expected_tile, discard_stats)

    # P1: Shanten increase. Detect directly from discard_stats so this works on
    # mistakes categorized before the shanten_increase flag was introduced.
    best_shanten = discard_stats[0].get("shanten") if discard_stats else None
    if (actual_stat and best_shanten is not None
            and actual_stat.get("shanten") is not None
            and actual_stat["shanten"] > best_shanten):
        return "P1"
    if cat_data.get("shanten_increase"):
        return "P1"

    # P2: user's ukeire is strictly worse than Mortal's pick. Any gap
    # (even 1 tile) counts, per user feedback on M4016/M4017.
    # Skip when Mortal's pick raises shanten relative to the user's —
    # comparing ukeire across different shanten levels is meaningless,
    # and the higher-shanten side trivially has broader acceptance
    # (BUG-01: mistake 5747 had user 3p@shanten=2/nec=19 vs mortal
    # 2m@shanten=3/nec=52, miscategorized as P2).
    if actual_stat and expected_stat:
        actual_sh = actual_stat.get("shanten")
        expected_sh = expected_stat.get("shanten")
        shanten_ok = (actual_sh is None or expected_sh is None
                      or expected_sh <= actual_sh)
        actual_nec = actual_stat.get("necessary_count", 0)
        expected_nec = expected_stat.get("necessary_count", 0)
        if shanten_ok and expected_nec > actual_nec:
            return "P2"

    # P3: Hand value. Neither shanten nor ukeire distinguishes the choice,
    # but a yakuhai (seat/round wind or dragon) or dora tile is one of the
    # two — Mortal is almost certainly preserving that value. This is the
    # most teachable slice of what used to be P4 "complex".
    if labels and ("yakuhai" in labels or "dora" in labels):
        return "P3"

    # P4: genuine strategic disagreement with no identifiable value signal.
    return "P4"


def classify_efficiency(mistake, discard_stats):
    """Classify an efficiency mistake as 1A or 2A.

    2A (Value Tile Ordering): at least one tile is a value tile (honor or terminal),
        and cpp scores are close (diff <= threshold). Mortal sees a strategic difference
        that pure tile efficiency doesn't capture. Covers honor vs number, terminal vs
        number, and honor vs terminal.
    1A: all other efficiency mistakes (pure tile efficiency).
    """
    actual_tile = mistake["actual"]["pai"]
    expected_tile = mistake["expected"]["pai"]

    # 2A: at least one value tile involved, cpp scores close
    has_value = _is_value_tile_mjai(actual_tile) or _is_value_tile_mjai(expected_tile)

    if has_value and discard_stats:
        actual_score = _get_exp_score_for_tile(actual_tile, discard_stats)
        expected_score = _get_exp_score_for_tile(expected_tile, discard_stats)
        if actual_score is not None and expected_score is not None:
            if abs(actual_score - expected_score) <= RULES["value_tile_diff"]:
                return "2A"

    return "1A"


def _stats_reasonably_agree(mortal_tile_id, discard_stats):
    """Check if mortal's pick is competitive in cpp's rankings.

    Returns True if mortal's tile has the same shanten as cpp's best
    and an expected score within 90% of the top candidate.
    """
    if not discard_stats:
        return False

    mortal_base = tile_id_to_base(mortal_tile_id)
    mortal_mjai = ID_TO_MJAI.get(mortal_base, ID_TO_MJAI.get(mortal_tile_id))

    # Find mortal's tile in cpp stats
    mortal_entry = None
    for s in discard_stats:
        s_base = s["tile"].rstrip("r")
        m_base = mortal_mjai.rstrip("r") if mortal_mjai else None
        if s["tile"] == mortal_mjai or s_base == m_base:
            mortal_entry = s
            break

    if mortal_entry is None:
        return False

    top = discard_stats[0]

    # Must have same shanten
    if mortal_entry["shanten"] != top["shanten"]:
        return False

    # Compare expected scores (if available) — absolute difference threshold
    top_score = top.get("exp_score")
    mortal_score = mortal_entry.get("exp_score")
    if top_score is not None and mortal_score is not None:
        return abs(top_score - mortal_score) <= RULES["agree_exp_score_diff"]

    # Fallback: compare necessary tile counts
    top_nec = top.get("necessary_count", 0)
    mortal_nec = mortal_entry.get("necessary_count", 0)
    if top_nec > 0:
        return mortal_nec >= top_nec * RULES["agree_necessary_ratio"]

    return False
