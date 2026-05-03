#!/usr/bin/env python3
"""Tests for lib/categorize.py — categorization decision logic, labels, helpers."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.categorize import (
    MJAI_TO_ID,
    ID_TO_MJAI,
    RED_TO_BASE,
    RULES,
    categorize_by_action_type,
    classify_efficiency,
    skill_area_for_entry,
    _classify_push,
    _stats_reasonably_agree,
    _is_terminal_mjai,
    _is_number_tile_mjai,
    _is_value_tile_mjai,
    _classify_defense,
    _player_has_open_melds,
    compute_labels,
    decrement_wall,
    is_honor_mjai,
    is_red_five_mjai,
    mjai_to_tile_id,
    tile_id_to_base,
)
from lib.tiles import dora_indicator_to_dora_mjai


# =========================================================================
# Helper functions: mjai_to_tile_id, tile_id_to_base
# =========================================================================

class TestMjaiToTileId:
    def test_man_tiles(self):
        for n in range(1, 10):
            assert mjai_to_tile_id(f"{n}m") == n - 1

    def test_pin_tiles(self):
        for n in range(1, 10):
            assert mjai_to_tile_id(f"{n}p") == 9 + n - 1

    def test_sou_tiles(self):
        for n in range(1, 10):
            assert mjai_to_tile_id(f"{n}s") == 18 + n - 1

    def test_honor_tiles(self):
        assert mjai_to_tile_id("E") == 27
        assert mjai_to_tile_id("S") == 28
        assert mjai_to_tile_id("W") == 29
        assert mjai_to_tile_id("N") == 30
        assert mjai_to_tile_id("P") == 31
        assert mjai_to_tile_id("F") == 32
        assert mjai_to_tile_id("C") == 33

    def test_red_fives(self):
        assert mjai_to_tile_id("5mr") == 34
        assert mjai_to_tile_id("5pr") == 35
        assert mjai_to_tile_id("5sr") == 36

    def test_unknown_tile_raises(self):
        with pytest.raises(KeyError):
            mjai_to_tile_id("XX")


class TestTileIdToBase:
    def test_red_fives_map_to_base(self):
        assert tile_id_to_base(34) == 4   # 5mr -> 5m
        assert tile_id_to_base(35) == 13  # 5pr -> 5p
        assert tile_id_to_base(36) == 22  # 5sr -> 5s

    def test_non_red_unchanged(self):
        assert tile_id_to_base(0) == 0
        assert tile_id_to_base(4) == 4
        assert tile_id_to_base(27) == 27
        assert tile_id_to_base(33) == 33


class TestTileNotationMaps:
    def test_round_trip(self):
        """Every tile in MJAI_TO_ID round-trips through ID_TO_MJAI."""
        for tile, tid in MJAI_TO_ID.items():
            assert ID_TO_MJAI[tid] == tile

    def test_all_ids_covered(self):
        """IDs 0-36 are all mapped."""
        for i in range(37):
            assert i in ID_TO_MJAI

    def test_red_to_base_consistency(self):
        assert RED_TO_BASE[MJAI_TO_ID["5mr"]] == MJAI_TO_ID["5m"]
        assert RED_TO_BASE[MJAI_TO_ID["5pr"]] == MJAI_TO_ID["5p"]
        assert RED_TO_BASE[MJAI_TO_ID["5sr"]] == MJAI_TO_ID["5s"]


# =========================================================================
# Tile type predicates
# =========================================================================

class TestTileHelpers:
    def test_is_honor(self):
        for t in ("E", "S", "W", "N", "P", "F", "C"):
            assert is_honor_mjai(t) is True
        assert is_honor_mjai("1m") is False
        assert is_honor_mjai("5mr") is False

    def test_is_terminal(self):
        for suit in "mps":
            assert _is_terminal_mjai(f"1{suit}") is True
            assert _is_terminal_mjai(f"9{suit}") is True
        assert _is_terminal_mjai("5m") is False
        assert _is_terminal_mjai("E") is False
        # Red fives and multi-char tiles
        assert _is_terminal_mjai("5mr") is False
        assert _is_terminal_mjai("5pr") is False

    def test_is_number_tile(self):
        for suit in "mps":
            for n in range(2, 9):
                assert _is_number_tile_mjai(f"{n}{suit}") is True
        # Terminals excluded
        assert _is_number_tile_mjai("1m") is False
        assert _is_number_tile_mjai("9s") is False
        # Honors excluded
        assert _is_number_tile_mjai("E") is False
        # Red fives excluded (3-char string)
        assert _is_number_tile_mjai("5mr") is False

    def test_is_value_tile(self):
        # Honors are value tiles
        assert _is_value_tile_mjai("E") is True
        assert _is_value_tile_mjai("C") is True
        # Terminals are value tiles
        assert _is_value_tile_mjai("1m") is True
        assert _is_value_tile_mjai("9s") is True
        # Number tiles are not
        assert _is_value_tile_mjai("5m") is False
        assert _is_value_tile_mjai("3p") is False

    def test_is_red_five(self):
        assert is_red_five_mjai("5mr") is True
        assert is_red_five_mjai("5pr") is True
        assert is_red_five_mjai("5sr") is True
        assert is_red_five_mjai("5m") is False
        assert is_red_five_mjai("E") is False


# =========================================================================
# categorize_by_action_type
# =========================================================================

class TestCategorizeByActionType:
    """Tests for categorize_by_action_type(actual, expected)."""

    # --- Meld decisions (4A-4C) ---

    def test_chi_none_returns_4A(self):
        assert categorize_by_action_type({"type": "chi"}, {"type": "none"}) == "4A"

    def test_pon_none_returns_4A(self):
        assert categorize_by_action_type({"type": "pon"}, {"type": "none"}) == "4A"

    def test_none_chi_returns_4B(self):
        assert categorize_by_action_type({"type": "none"}, {"type": "chi"}) == "4B"

    def test_none_pon_returns_4B(self):
        assert categorize_by_action_type({"type": "none"}, {"type": "pon"}) == "4B"

    def test_chi_chi_returns_4C(self):
        assert categorize_by_action_type({"type": "chi"}, {"type": "chi"}) == "4C"

    def test_pon_pon_returns_4C(self):
        assert categorize_by_action_type({"type": "pon"}, {"type": "pon"}) == "4C"

    def test_chi_pon_returns_4C(self):
        assert categorize_by_action_type({"type": "chi"}, {"type": "pon"}) == "4C"

    def test_pon_chi_returns_4C(self):
        assert categorize_by_action_type({"type": "pon"}, {"type": "chi"}) == "4C"

    # --- Riichi decisions (5A-5B) ---

    def test_reach_dahai_returns_5A(self):
        assert categorize_by_action_type({"type": "reach"}, {"type": "dahai"}) == "5A"

    def test_dahai_reach_returns_5B(self):
        assert categorize_by_action_type({"type": "dahai"}, {"type": "reach"}) == "5B"

    # --- Kan decisions (6A-6B) ---

    def test_bad_kan_all_types(self):
        for kan_type in ("ankan", "kakan", "daiminkan"):
            for expected in ("dahai", "none"):
                assert categorize_by_action_type({"type": kan_type}, {"type": expected}) == "6A"

    def test_missed_kan_all_types(self):
        for actual in ("dahai", "none"):
            for kan_type in ("ankan", "kakan", "daiminkan"):
                assert categorize_by_action_type({"type": actual}, {"type": kan_type}) == "6B"

    # --- Missed win ---

    def test_expected_hora_from_dahai_returns_3A(self):
        assert categorize_by_action_type({"type": "dahai"}, {"type": "hora"}) == "P4"

    def test_expected_hora_from_none_returns_3A(self):
        assert categorize_by_action_type({"type": "none"}, {"type": "hora"}) == "P4"

    def test_expected_hora_from_chi_returns_3A(self):
        """hora check happens after meld checks but before dahai-dahai."""
        # chi + hora doesn't match 4A (et != "none") or 4C (et not chi/pon),
        # so it falls through to hora check.
        assert categorize_by_action_type({"type": "chi"}, {"type": "hora"}) == "P4"

    # --- dahai vs dahai returns None ---

    def test_dahai_dahai_returns_none(self):
        assert categorize_by_action_type({"type": "dahai"}, {"type": "dahai"}) is None

    # --- Other combos default to 3A ---

    def test_reach_none_returns_3A(self):
        assert categorize_by_action_type({"type": "reach"}, {"type": "none"}) == "P4"

    def test_none_reach_returns_3A(self):
        assert categorize_by_action_type({"type": "none"}, {"type": "reach"}) == "P4"

    def test_reach_reach_returns_3A(self):
        assert categorize_by_action_type({"type": "reach"}, {"type": "reach"}) == "P4"


# =========================================================================
# skill_area_for_entry — per-entry bucket for decision_counts
# =========================================================================

class TestSkillAreaForEntry:
    """Each entry lands in exactly one bucket; buckets line up with
    CATEGORY_INFO group so mistake numerators and denominators match."""

    # --- dahai → attack / defense by in_riichi ---

    def test_dahai_no_riichi_is_attack(self):
        assert skill_area_for_entry("dahai", "dahai", in_riichi=False) == "attack"

    def test_dahai_with_opp_riichi_is_defense(self):
        assert skill_area_for_entry("dahai", "dahai", in_riichi=True) == "defense"

    def test_dahai_ignores_reach_in_details_when_both_sides_dahai(self):
        # Non-mistake where reach was on the table but both agreed to dahai —
        # still an attack decision, not a riichi decision.
        assert skill_area_for_entry(
            "dahai", "dahai", ("dahai", "reach"), in_riichi=False,
        ) == "attack"

    # --- riichi — actual OR expected is reach ---

    def test_reach_and_reach_is_riichi(self):
        assert skill_area_for_entry("reach", "reach") == "riichi"

    def test_bad_riichi_5A_is_riichi(self):
        assert skill_area_for_entry("reach", "dahai") == "riichi"

    def test_missed_riichi_5B_is_riichi(self):
        assert skill_area_for_entry("dahai", "reach") == "riichi"

    # --- meld ---

    def test_chi_and_chi_is_meld(self):
        assert skill_area_for_entry("chi", "chi") == "meld"

    def test_bad_meld_4A_is_meld(self):
        assert skill_area_for_entry("chi", "none") == "meld"

    def test_missed_meld_4B_is_meld(self):
        assert skill_area_for_entry("none", "pon") == "meld"

    def test_none_none_with_chi_option_is_meld(self):
        # Non-mistake where chi was offered and both passed — still a meld
        # decision (the entry exists because a chi was offered).
        assert skill_area_for_entry(
            "none", "none", ("none", "chi"),
        ) == "meld"

    # --- kan ---

    def test_ankan_and_ankan_is_kan(self):
        assert skill_area_for_entry("ankan", "ankan") == "kan"

    def test_bad_kan_6A_is_kan(self):
        assert skill_area_for_entry("ankan", "dahai") == "kan"

    def test_missed_kan_6B_is_kan(self):
        assert skill_area_for_entry("dahai", "kakan") == "kan"

    def test_dahai_with_kan_in_details_stays_attack(self):
        # Both sides picked dahai over a kan option — attack, not kan.
        assert skill_area_for_entry(
            "dahai", "dahai", ("dahai", "ankan"),
        ) == "attack"

    # --- priority: meld > riichi > kan ---

    def test_meld_beats_riichi_when_both_present(self):
        assert skill_area_for_entry("chi", "reach") == "meld"

    def test_riichi_beats_kan_when_both_present(self):
        assert skill_area_for_entry("reach", "ankan") == "riichi"

    # --- none / hora passthrough ---

    def test_none_none_with_no_options_returns_none(self):
        assert skill_area_for_entry("none", "none") is None

    def test_hora_both_sides_returns_none(self):
        # A correct ron — not a counted attack/defense/etc decision.
        assert skill_area_for_entry("hora", "hora") is None


# =========================================================================
# classify_efficiency
# =========================================================================

class TestClassifyEfficiency:
    """Tests for classify_efficiency(mistake, discard_stats)."""

    def _mistake(self, actual_pai, expected_pai):
        return {
            "actual": {"type": "dahai", "pai": actual_pai},
            "expected": {"type": "dahai", "pai": expected_pai},
        }

    def _make_discard_stats(self, tile_scores):
        """Build minimal discard_stats list from {tile: exp_score} dict."""
        return [
            {"tile": tile, "shanten": 0, "necessary_count": 10, "exp_score": score}
            for tile, score in tile_scores.items()
        ]

    def test_no_value_tile_returns_1A(self):
        """Two number tiles -> always 1A regardless of cpp scores."""
        m = self._mistake("3m", "5p")
        assert classify_efficiency(m, []) == "1A"

    def test_no_value_tile_close_scores_still_1A(self):
        m = self._mistake("3m", "5p")
        stats = self._make_discard_stats({"3m": 1000, "5p": 1010})
        assert classify_efficiency(m, stats) == "1A"

    def test_honor_actual_close_scores_returns_2A(self):
        m = self._mistake("E", "3m")
        stats = self._make_discard_stats({"E": 100, "3m": 140})
        assert classify_efficiency(m, stats) == "2A"

    def test_honor_expected_close_scores_returns_2A(self):
        m = self._mistake("3m", "N")
        stats = self._make_discard_stats({"3m": 1000, "N": 1040})
        assert classify_efficiency(m, stats) == "2A"

    def test_terminal_actual_close_scores_returns_2A(self):
        m = self._mistake("1m", "5p")
        stats = self._make_discard_stats({"1m": 100, "5p": 120})
        assert classify_efficiency(m, stats) == "2A"

    def test_terminal_expected_close_scores_returns_2A(self):
        m = self._mistake("5s", "9p")
        stats = self._make_discard_stats({"5s": 1000, "9p": 1000})
        assert classify_efficiency(m, stats) == "2A"

    def test_value_tile_distant_scores_returns_1A(self):
        m = self._mistake("E", "3m")
        stats = self._make_discard_stats({"E": 100, "3m": 500})
        assert classify_efficiency(m, stats) == "1A"

    def test_exact_threshold_returns_2A(self):
        threshold = RULES["value_tile_diff"]  # 60
        m = self._mistake("N", "2s")
        stats = self._make_discard_stats({"N": 100, "2s": 100 + threshold})
        assert classify_efficiency(m, stats) == "2A"

    def test_one_over_threshold_returns_1A(self):
        threshold = RULES["value_tile_diff"]
        m = self._mistake("N", "2s")
        stats = self._make_discard_stats({"N": 100, "2s": 100 + threshold + 1})
        assert classify_efficiency(m, stats) == "1A"

    def test_value_tile_no_discard_stats_returns_1A(self):
        m = self._mistake("E", "3m")
        assert classify_efficiency(m, None) == "1A"
        assert classify_efficiency(m, []) == "1A"

    def test_value_tile_missing_from_discard_stats_returns_1A(self):
        """If the value tile isn't found in discard_stats, fall back to 1A."""
        m = self._mistake("E", "3m")
        stats = self._make_discard_stats({"3m": 1000, "5p": 900})  # E not in stats
        assert classify_efficiency(m, stats) == "1A"

    def test_both_value_tiles_close_returns_2A(self):
        """Both tiles are value tiles (honor vs terminal), close scores."""
        m = self._mistake("P", "1s")
        stats = self._make_discard_stats({"P": 800, "1s": 820})
        assert classify_efficiency(m, stats) == "2A"

    def test_red_five_tile_stripped_for_lookup(self):
        """Red five notation (5mr) should match 5m in discard_stats via rstrip."""
        m = self._mistake("1m", "5mr")
        stats = self._make_discard_stats({"1m": 1000, "5m": 1020})
        assert classify_efficiency(m, stats) == "2A"

    def test_all_dragons_are_value_tiles(self):
        for dragon in ("P", "F", "C"):
            m = self._mistake(dragon, "4s")
            stats = self._make_discard_stats({dragon: 500, "4s": 530})
            assert classify_efficiency(m, stats) == "2A"

    def test_all_winds_are_value_tiles(self):
        for wind in ("E", "S", "W", "N"):
            m = self._mistake(wind, "4s")
            stats = self._make_discard_stats({wind: 500, "4s": 530})
            assert classify_efficiency(m, stats) == "2A"


# =========================================================================
# _stats_reasonably_agree
# =========================================================================

class TestCppReasonablyAgrees:
    """Tests for _stats_reasonably_agree(mortal_tile_id, discard_stats)."""

    def _make_stats(self, entries):
        """entries: list of (tile_mjai, shanten, exp_score_or_None, necessary_count)."""
        result = []
        for tile, shanten, exp_score, nec_count in entries:
            entry = {"tile": tile, "shanten": shanten, "necessary_count": nec_count}
            if exp_score is not None:
                entry["exp_score"] = exp_score
            result.append(entry)
        return result

    def test_empty_stats_returns_false(self):
        assert _stats_reasonably_agree(0, []) is False
        assert _stats_reasonably_agree(0, None) is False

    def test_tile_not_in_stats_returns_false(self):
        stats = self._make_stats([("1m", 1, 200, 10)])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is False

    def test_same_shanten_close_score_returns_true(self):
        stats = self._make_stats([
            ("1m", 1, 200, 10),
            ("2m", 1, 180, 8),
        ])
        # diff=20, threshold=60
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is True

    def test_same_shanten_far_score_returns_false(self):
        stats = self._make_stats([
            ("1m", 1, 200, 10),
            ("2m", 1, 50, 8),
        ])
        # diff=150, threshold=60
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is False

    def test_different_shanten_returns_false(self):
        stats = self._make_stats([
            ("1m", 0, 200, 10),
            ("2m", 1, 200, 8),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is False

    def test_exact_threshold_returns_true(self):
        threshold = RULES["agree_exp_score_diff"]  # 60
        stats = self._make_stats([
            ("1m", 1, 200, 10),
            ("2m", 1, 200 - threshold, 8),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is True

    def test_one_over_threshold_returns_false(self):
        threshold = RULES["agree_exp_score_diff"]
        stats = self._make_stats([
            ("1m", 1, 200, 10),
            ("2m", 1, 200 - threshold - 1, 8),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is False

    def test_fallback_necessary_count_above_ratio(self):
        """When no exp_score, falls back to necessary_count ratio."""
        ratio = RULES["agree_necessary_ratio"]  # 0.80
        top_nec = 10
        mortal_nec = int(top_nec * ratio)  # 8, exactly at threshold
        stats = self._make_stats([
            ("1m", 1, None, top_nec),
            ("2m", 1, None, mortal_nec),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is True

    def test_fallback_necessary_count_below_ratio(self):
        ratio = RULES["agree_necessary_ratio"]
        top_nec = 10
        mortal_nec = int(top_nec * ratio) - 1  # 7
        stats = self._make_stats([
            ("1m", 1, None, top_nec),
            ("2m", 1, None, mortal_nec),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is False

    def test_fallback_top_nec_zero_returns_false(self):
        stats = self._make_stats([
            ("1m", 1, None, 0),
            ("2m", 1, None, 0),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("2m"), stats) is False

    def test_red_five_matches_base(self):
        """Red five (5mr, tile_id=34) should match base '5m' in stats."""
        stats = self._make_stats([
            ("5m", 1, 200, 10),
            ("3m", 1, 190, 8),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("5mr"), stats) is True

    def test_mortal_is_top_tile_returns_true(self):
        """Mortal picked cpp's best tile -> 0 diff, always agrees."""
        stats = self._make_stats([
            ("3m", 1, 1000, 10),
            ("5p", 2, 500, 4),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("3m"), stats) is True

    def test_mortal_scores_higher_than_top(self):
        """Mortal's tile scores higher (abs diff still within threshold)."""
        stats = self._make_stats([
            ("3m", 1, 1000, 10),
            ("5p", 1, 1050, 12),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("5p"), stats) is True

    def test_honor_tile_agreement(self):
        stats = self._make_stats([
            ("E", 2, 500, 5),
            ("3m", 2, 480, 4),
        ])
        assert _stats_reasonably_agree(mjai_to_tile_id("3m"), stats) is True


# =========================================================================
# compute_labels
# =========================================================================

class TestComputeLabels:
    def _mistake(self, actual_pai, expected_pai):
        return {
            "actual": {"type": "dahai", "pai": actual_pai},
            "expected": {"type": "dahai", "pai": expected_pai},
        }

    def test_honor_label(self):
        labels = compute_labels(self._mistake("E", "3m"), [])
        assert "honor" in labels

    def test_terminal_label(self):
        labels = compute_labels(self._mistake("1m", "5p"), [])
        assert "terminal" in labels

    def test_dora_from_indicator(self):
        """Dora indicator 3m means 4m is dora."""
        labels = compute_labels(self._mistake("4m", "5p"), ["3m"])
        assert "dora" in labels

    def test_red_five_dora(self):
        labels = compute_labels(self._mistake("5mr", "3m"), [])
        assert "dora" in labels

    def test_yakuhai_dragon(self):
        labels = compute_labels(self._mistake("P", "3m"), [])
        assert "yakuhai" in labels

    def test_yakuhai_seat_wind(self):
        labels = compute_labels(self._mistake("S", "3m"), [], seat_wind="S")
        assert "yakuhai" in labels

    def test_yakuhai_round_wind(self):
        labels = compute_labels(self._mistake("E", "3m"), [], round_wind="E")
        assert "yakuhai" in labels

    def test_no_duplicate_labels(self):
        labels = compute_labels(self._mistake("E", "S"), [])
        assert labels.count("honor") == 1

    def test_no_labels_for_plain_tiles(self):
        labels = compute_labels(self._mistake("3m", "5p"), [])
        assert labels == []


# =========================================================================
# dora_indicator_to_dora_mjai (moved to lib/tiles.py under CS-05)
# =========================================================================

class TestDoraIndicatorToDoraMjai:
    def test_number_wraps(self):
        assert dora_indicator_to_dora_mjai("9m") == "1m"
        assert dora_indicator_to_dora_mjai("9p") == "1p"
        assert dora_indicator_to_dora_mjai("9s") == "1s"

    def test_number_increments(self):
        assert dora_indicator_to_dora_mjai("3m") == "4m"
        assert dora_indicator_to_dora_mjai("1p") == "2p"

    def test_wind_cycle(self):
        assert dora_indicator_to_dora_mjai("E") == "S"
        assert dora_indicator_to_dora_mjai("N") == "E"

    def test_dragon_cycle(self):
        assert dora_indicator_to_dora_mjai("P") == "F"
        assert dora_indicator_to_dora_mjai("C") == "P"

    def test_red_five_indicator(self):
        assert dora_indicator_to_dora_mjai("5mr") == "6m"
        assert dora_indicator_to_dora_mjai("5pr") == "6p"
        assert dora_indicator_to_dora_mjai("5sr") == "6s"


# =========================================================================
# _player_has_open_melds, _classify_push (UX-33: meld-blindness handling)
# =========================================================================

class TestPlayerHasOpenMelds:
    def test_no_melds(self):
        assert _player_has_open_melds([]) is False
        assert _player_has_open_melds(None) is False

    def test_only_ankan(self):
        assert _player_has_open_melds([{"type": "ankan"}]) is False

    def test_pon_open(self):
        assert _player_has_open_melds([{"type": "pon"}]) is True

    def test_chi_open(self):
        assert _player_has_open_melds([{"type": "chi"}]) is True

    def test_daiminkan_kakan_open(self):
        assert _player_has_open_melds([{"type": "daiminkan"}]) is True
        assert _player_has_open_melds([{"type": "kakan"}]) is True

    def test_mixed_with_ankan(self):
        # Ankan present but also a pon -> still open
        assert _player_has_open_melds([{"type": "ankan"}, {"type": "pon"}]) is True


class TestClassifyPushMeldBlind:
    """UX-33: with open melds, calc's value-tile rankings should not drive P2/P4."""

    def _stats(self, entries):
        return [{"tile": t, "shanten": s, "necessary_count": n,
                 **({"exp_score": e} if e is not None else {})}
                for t, s, n, e in entries]

    def test_open_melds_value_tile_discarded_returns_p4(self):
        """Player with open pon discards yakuhai; Mortal would have kept it.
        Previously P3 (meld-blind yakuhai); now P4 (Complex Decision)."""
        mistake = {
            "actual": {"type": "dahai", "pai": "P"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [{"type": "pon", "pai": "E", "consumed": ["E", "E"]}],
        }
        discard_stats = self._stats([("5m", 1, 8, 5000), ("P", 1, 8, 4500)])
        categorize_data = {}
        assert _classify_push(mistake, discard_stats, categorize_data, True) == "P4"
        assert _classify_push(mistake, discard_stats, categorize_data, False) == "P4"

    def test_closed_hand_unaffected(self):
        """Closed hand: meld-blindness rule does not apply.
        Worse ukeire still yields P2."""
        mistake = {
            "actual": {"type": "dahai", "pai": "P"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [],
        }
        discard_stats = self._stats([("5m", 1, 12, 5000), ("P", 1, 6, 3000)])
        assert _classify_push(mistake, discard_stats, {}, True) == "P2"

    def test_open_melds_two_number_tiles_unaffected(self):
        """Open melds + both tiles are number tiles -> rule doesn't fire."""
        mistake = {
            "actual": {"type": "dahai", "pai": "3m"},
            "expected": {"type": "dahai", "pai": "5p"},
            "melds": [{"type": "pon", "pai": "E", "consumed": ["E", "E"]}],
        }
        discard_stats = self._stats([("5p", 1, 12, 5000), ("3m", 1, 8, 4000)])
        # Falls through to normal P2 (worse ukeire)
        assert _classify_push(mistake, discard_stats, {}, True) == "P2"

    def test_p1_takes_priority_over_meld_rule(self):
        """Shanten failure (P1) is detected before the meld-blindness rule."""
        mistake = {
            "actual": {"type": "dahai", "pai": "P"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [{"type": "pon", "pai": "E", "consumed": ["E", "E"]}],
        }
        discard_stats = self._stats([("5m", 1, 8, 5000), ("P", 2, 4, 3000)])
        categorize_data = {"shanten_increase": True}
        assert _classify_push(mistake, discard_stats, categorize_data, True) == "P1"


# =========================================================================
# decrement_wall (T-03)
# =========================================================================

def _fresh_wall():
    """Initial wall: 4 of each base tile (0-33), 1 of each red five (34-36)."""
    return [4] * 34 + [1, 1, 1]


class TestDecrementWall:
    def test_normal_tile_decrements_only_base(self):
        wall = _fresh_wall()
        decrement_wall(wall, "3p")
        assert wall[mjai_to_tile_id("3p")] == 3
        # No other slot changes
        for i, c in enumerate(wall):
            if i != mjai_to_tile_id("3p"):
                assert c == _fresh_wall()[i], f"slot {i} changed"

    def test_normal_five_does_not_touch_red_slot(self):
        wall = _fresh_wall()
        decrement_wall(wall, "5m")
        assert wall[mjai_to_tile_id("5m")] == 3
        assert wall[mjai_to_tile_id("5mr")] == 1, "red 5m subset must not change"

    def test_red_five_decrements_both_slots(self):
        """Wall design: wall[base] = total fives (incl. red), wall[red] = red subset.

        Both must decrement when the red is seen.
        """
        wall = _fresh_wall()
        decrement_wall(wall, "5mr")
        assert wall[mjai_to_tile_id("5m")] == 3, "base count must drop"
        assert wall[mjai_to_tile_id("5mr")] == 0, "red subset must drop"

    def test_honor_decrement(self):
        wall = _fresh_wall()
        decrement_wall(wall, "C")
        assert wall[mjai_to_tile_id("C")] == 3

    def test_repeated_decrements_track_correctly(self):
        wall = _fresh_wall()
        decrement_wall(wall, "5p")
        decrement_wall(wall, "5p")
        decrement_wall(wall, "5pr")
        assert wall[mjai_to_tile_id("5p")] == 1
        assert wall[mjai_to_tile_id("5pr")] == 0

    def test_all_red_suits(self):
        for red, base in [("5mr", "5m"), ("5pr", "5p"), ("5sr", "5s")]:
            wall = _fresh_wall()
            decrement_wall(wall, red)
            assert wall[mjai_to_tile_id(base)] == 3
            assert wall[mjai_to_tile_id(red)] == 0


# =========================================================================
# _classify_defense (dealin-rate based: Defend / Push / Complex)
# =========================================================================

class TestClassifyDefense:
    """New semantics (2026-04-20):
    D1 Defend  — mortal's deal-in rate is strictly lower than user's.
    D2 Push    — mortal not safer AND push classifier says P1 or P2.
    D3 Complex — mortal not safer AND push classifier says P4.

    Returns (category, push_reason) where push_reason is P1/P2 for D2.
    """

    def _stats(self, entries):
        """entries: list of (tile, shanten, necessary_count)."""
        return [
            {"tile": t, "shanten": s, "necessary_count": n}
            for t, s, n in entries
        ]

    def test_d1_mortal_strictly_safer(self):
        mistake = {
            "actual":   {"type": "dahai", "pai": "5m"},
            "expected": {"type": "dahai", "pai": "E"},
            "melds": [],
        }
        dealin = {"5m": 12.0, "E": 0.0}
        discard_stats = self._stats([("5m", 0, 10), ("E", 0, 0)])
        cat, reason = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D1"
        assert reason is None

    def test_d2_push_when_mortal_riskier_and_shanten_failure(self):
        """Mortal pushes a more-dangerous tile AND user's discard raised shanten -> D2 + P1."""
        mistake = {
            "actual":   {"type": "dahai", "pai": "E"},      # safer but raises shanten
            "expected": {"type": "dahai", "pai": "5m"},     # riskier, keeps tenpai
            "melds": [],
        }
        dealin = {"E": 0.0, "5m": 12.0}
        # cpp best is 5m at shanten 0; user's E is shanten 1 => P1 shanten increase
        discard_stats = self._stats([("5m", 0, 10), ("E", 1, 0)])
        cat, reason = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D2"
        assert reason == "P1"

    def test_d2_push_when_mortal_riskier_and_worse_ukeire(self):
        """Mortal pushes a more-dangerous tile; user's choice has strictly worse ukeire -> D2 + P2."""
        mistake = {
            "actual":   {"type": "dahai", "pai": "E"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [],
        }
        dealin = {"E": 3.0, "5m": 10.0}
        discard_stats = self._stats([("5m", 0, 14), ("E", 0, 4)])
        cat, reason = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D2"
        assert reason == "P2"

    def test_d3_complex_when_mortal_riskier_and_p4(self):
        """Mortal pushes; push classifier says P4 (not a basic-strategy win) -> D3."""
        mistake = {
            "actual":   {"type": "dahai", "pai": "E"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [],
        }
        dealin = {"E": 3.0, "5m": 10.0}
        # Equal ukeire, equal shanten — push classifier falls to P4
        discard_stats = self._stats([("5m", 0, 8), ("E", 0, 8)])
        cat, reason = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D3"
        assert reason is None

    def test_tie_in_dealin_treated_as_not_safer(self):
        """Equal deal-in rates => Mortal isn't defending; route through push classifier."""
        mistake = {
            "actual":   {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [],
        }
        dealin = {"1p": 5.0, "5m": 5.0}
        discard_stats = self._stats([("5m", 0, 14), ("1p", 0, 4)])  # P2 gap
        cat, reason = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D2"
        assert reason == "P2"

    def test_red_five_dealin_lookup(self):
        """Red-five mjai strings fall back to base-tile deal-in rate."""
        mistake = {
            "actual":   {"type": "dahai", "pai": "5mr"},
            "expected": {"type": "dahai", "pai": "E"},
            "melds": [],
        }
        dealin = {"5m": 12.0, "E": 0.0}  # no "5mr" key
        discard_stats = self._stats([("5m", 0, 10), ("E", 0, 0)])
        cat, _ = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D1"

    def test_missing_dealin_falls_to_push_classifier(self):
        """If either tile's dealin rate is missing, can't establish
        'mortal safer' — fall through to push classifier."""
        mistake = {
            "actual":   {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [],
        }
        dealin = {"5m": 0.0}  # "1p" missing
        discard_stats = self._stats([("5m", 0, 14), ("1p", 0, 4)])
        cat, reason = _classify_defense(mistake, dealin, discard_stats, {}, True)
        assert cat == "D2"  # can't prove Defend, P2 ukeire gap = Push
        assert reason == "P2"


class TestClassifyPushBoundaries:
    """Direct boundary tests for the P1/P2/P3/P4 logic in _classify_push.

    P3 was reintroduced on 2026-04-20 as Hand Value: when no shanten/ukeire
    signal fires AND a yakuhai/dora label is set on the mistake, Mortal is
    almost certainly preserving value. Label-free P4 cases stay complex."""

    def _stats(self, entries):
        """entries: list of (tile, shanten, necessary_count, exp_score|None)."""
        return [{"tile": t, "shanten": s, "necessary_count": n,
                 **({"exp_score": e} if e is not None else {})}
                for t, s, n, e in entries]

    def test_p2_when_user_worse_than_both(self):
        """Mortal/calc disagree; user is worse than both on ukeire -> P2 (not P4)."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "7p"},  # mortal pick
            "melds": [],
        }
        # cpp's best is 5m (different from mortal's 7p) => disagreement
        discard_stats = self._stats([("5m", 0, 14, 5000), ("7p", 0, 10, 4500), ("1p", 0, 4, 2000)])
        assert _classify_push(mistake, discard_stats, {}, False) == "P2"

    def test_p4_when_user_worse_score_than_both(self):
        """User worse on score (equal ukeire) than both mortal+calc -> P4.
        Previously P3 (Score Efficiency); now folded into Complex Decision."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "7p"},
            "melds": [],
        }
        discard_stats = self._stats([("5m", 0, 10, 8000), ("7p", 0, 10, 7500), ("1p", 0, 10, 2000)])
        assert _classify_push(mistake, discard_stats, {}, False) == "P4"

    def test_p4_when_user_not_obviously_worse(self):
        """Mortal/calc disagree, user isn't strictly worse than both -> P4."""
        mistake = {
            "actual": {"type": "dahai", "pai": "5m"},  # = calc's pick
            "expected": {"type": "dahai", "pai": "7p"},
            "melds": [],
        }
        discard_stats = self._stats([("5m", 0, 14, 5000), ("7p", 0, 10, 4500)])
        # User picked calc's tile, so they're not "worse than both"
        assert _classify_push(mistake, discard_stats, {}, False) == "P4"

    def test_p4_when_score_gap_above_threshold_and_acceptance_equal(self):
        """Mortal+calc agree; equal ukeire, score gap -> P4.
        Previously P3 (Score Efficiency); score no longer drives classification."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "7p"},
            "melds": [],
        }
        discard_stats = self._stats([("7p", 0, 10, 5000), ("1p", 0, 10, 4000)])  # equal nec
        assert _classify_push(mistake, discard_stats, {}, True) == "P4"

    def test_p2_when_acceptance_clearly_worse(self):
        """Mortal+calc agree; user has clearly worse ukeire -> P2."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "7p"},
            "melds": [],
        }
        discard_stats = self._stats([("7p", 0, 14, 5000), ("1p", 0, 4, 4000)])
        assert _classify_push(mistake, discard_stats, {}, True) == "P2"

    # --- P3 Hand Value (reintroduced 2026-04-20) -----------------------

    def test_p3_when_yakuhai_label_present(self):
        """Tied ukeire+shanten, yakuhai label set -> P3 Hand Value."""
        mistake = {
            "actual": {"type": "dahai", "pai": "P"},    # dragon
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [],
        }
        discard_stats = self._stats([("5m", 1, 8, None), ("P", 1, 8, None)])
        assert _classify_push(mistake, discard_stats, {}, True,
                              labels=["yakuhai"]) == "P3"

    def test_p3_when_dora_label_present(self):
        """Tied ukeire, dora involved -> P3."""
        mistake = {
            "actual": {"type": "dahai", "pai": "5mr"},
            "expected": {"type": "dahai", "pai": "2p"},
            "melds": [],
        }
        discard_stats = self._stats([("2p", 0, 8, None), ("5m", 0, 8, None)])
        assert _classify_push(mistake, discard_stats, {}, True,
                              labels=["dora"]) == "P3"

    def test_p4_without_value_labels(self):
        """Tied ukeire, no yakuhai/dora label -> still P4 (genuinely complex)."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1p"},
            "expected": {"type": "dahai", "pai": "9s"},
            "melds": [],
        }
        discard_stats = self._stats([("9s", 0, 10, None), ("1p", 0, 10, None)])
        assert _classify_push(mistake, discard_stats, {}, True, labels=[]) == "P4"
        # And when labels arg isn't passed at all
        assert _classify_push(mistake, discard_stats, {}, True) == "P4"

    def test_p1_wins_over_p3_even_with_yakuhai(self):
        """Shanten failure beats Hand Value — objective error first."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1m"},   # raises shanten
            "expected": {"type": "dahai", "pai": "P"},
            "melds": [],
        }
        discard_stats = self._stats([("P", 1, 8, None), ("1m", 2, 12, None)])
        assert _classify_push(mistake, discard_stats, {}, True,
                              labels=["yakuhai"]) == "P1"

    def test_p2_wins_over_p3_even_with_dora(self):
        """Ukeire gap beats Hand Value — objective error first."""
        mistake = {
            "actual": {"type": "dahai", "pai": "5mr"},
            "expected": {"type": "dahai", "pai": "1p"},
            "melds": [],
        }
        discard_stats = self._stats([("1p", 0, 14, None), ("5m", 0, 4, None)])
        assert _classify_push(mistake, discard_stats, {}, True,
                              labels=["dora"]) == "P2"


# =========================================================================
# User-feedback-driven tests: real reported miscategorizations
# =========================================================================

class TestReportedMistakes:
    """Tests from user feedback on the categorization reporting system.
    Each case is a real miscategorization reported in production."""

    def _stats(self, entries):
        """entries: list of (tile, shanten, necessary_count, exp_score|None)."""
        return [{"tile": t, "shanten": s, "necessary_count": n,
                 **({"exp_score": e} if e is not None else {})}
                for t, s, n, e in entries]

    # --- P1 detection via discard_stats (no flag needed) — M1555, M3756, etc. ---

    def test_p1_detected_from_discard_stats_without_flag(self):
        """Shanten increase must be detected from discard_stats directly,
        not just from the categorize_data['shanten_increase'] flag (needed for
        re-classifying older data that never had the flag set)."""
        mistake = {
            "actual": {"type": "dahai", "pai": "5s"},
            "expected": {"type": "dahai", "pai": "3m"},
            "melds": [{"type": "chi", "pai": "3m", "consumed": ["1m", "2m"]}],
        }
        # M1555: 3m best is shanten 1, user's 5s raises to shanten 2
        discard_stats = self._stats([
            ("3m", 1, 15, 10326),
            ("7p", 1, 11, 9957),
            ("5s", 2, 38, 7929),
        ])
        # No shanten_increase flag — must still detect P1 from stats
        assert _classify_push(mistake, discard_stats, {}, True) == "P1"

    def test_p1_value_tile_shanten_increase(self):
        """M3835: user discards terminal (1m), mortal prefers honor (P),
        and user's 1m raises shanten. Not meld-blind (closed hand)."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1m"},
            "expected": {"type": "dahai", "pai": "P"},
            "melds": [],
        }
        discard_stats = self._stats([
            ("P", 1, 7, 15012),
            ("F", 1, 7, 14712),
            ("1m", 2, 24, 9958),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P1"

    # --- P2 detection: any ukeire diff is P2, not P3 — M4017, M4016 ---

    def test_p2_worse_ukeire_by_two(self):
        """M4017: user's 1s has 22 ukeire vs mortal's 2s at 24 — P2."""
        mistake = {
            "actual": {"type": "dahai", "pai": "1s"},
            "expected": {"type": "dahai", "pai": "2s"},
            "melds": [],
        }
        discard_stats = self._stats([
            ("2s", 2, 24, 61653),
            ("1s", 2, 22, 41242),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P2"

    def test_p2_worse_ukeire_by_one(self):
        """M4016: even 1-tile ukeire diff is P2, not P3."""
        mistake = {
            "actual": {"type": "dahai", "pai": "6m"},
            "expected": {"type": "dahai", "pai": "2s"},
            "melds": [],
        }
        discard_stats = self._stats([
            ("2s", 2, 19, 38122),
            ("6m", 2, 18, 37233),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P2"

    def test_not_p2_when_mortal_raises_shanten(self):
        """BUG-01 / M5747: Mortal's pick has worse shanten than the user's.
        Higher shanten trivially has broader ukeire — must NOT be P2.
        With a dora label on the table, falls through to P3 Hand Value."""
        mistake = {
            "actual": {"type": "dahai", "pai": "3p"},
            "expected": {"type": "dahai", "pai": "2m"},
            "melds": [],
        }
        # User's 3p keeps 2-shanten with 19 ukeire; Mortal's 2m goes back
        # to 3-shanten with 52 ukeire. Naive nec-count comparison would say P2.
        discard_stats = self._stats([
            ("3p", 2, 19, None),
            ("2m", 3, 52, None),
        ])
        assert _classify_push(mistake, discard_stats, {}, True,
                              labels=["dora"]) == "P3"

    def test_not_p2_when_mortal_raises_shanten_no_value_label(self):
        """Same shape, no yakuhai/dora signal — falls through to P4, not P2."""
        mistake = {
            "actual": {"type": "dahai", "pai": "3p"},
            "expected": {"type": "dahai", "pai": "2m"},
            "melds": [],
        }
        discard_stats = self._stats([
            ("3p", 2, 19, None),
            ("2m", 3, 52, None),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P4"

    # --- P4 in agree branch when user picked best_discard — M1472, M571, etc. ---

    def test_p4_when_user_picked_best_discard_mortal_close(self):
        """M1472: user discards best_discard (C), mortal would pick 9p
        (close score so mortal_agrees=True). User's choice isn't worse —
        this is a strategic disagreement, P4."""
        mistake = {
            "actual": {"type": "dahai", "pai": "C"},  # = best_discard
            "expected": {"type": "dahai", "pai": "9p"},
            "melds": [],
        }
        discard_stats = self._stats([
            ("C", 3, 16, 4338),  # best_discard
            ("9p", 3, 16, 4320),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P4"

    def test_p4_when_user_best_discard_no_exp_score(self):
        """M1471 / M2984: no exp_score data, user picked best_discard -> P4."""
        mistake = {
            "actual": {"type": "dahai", "pai": "P"},  # = best_discard
            "expected": {"type": "dahai", "pai": "9p"},
            "melds": [],
        }
        discard_stats = self._stats([
            ("P", 4, 79, None),
            ("9p", 4, 70, None),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P4"

    # --- Meld-blindness rule must yield P4 if user picked best_discard — M4317 ---

    def test_p4_meld_blind_but_user_picked_best_discard(self):
        """M4317: open hand, user discards value tile W, mortal would discard 8p.
        Normally meld-blind rule -> P3. But user's W IS cpp's best with big
        score lead (mortal clearly disagrees with cpp) -> strategic, P4."""
        mistake = {
            "actual": {"type": "dahai", "pai": "W"},
            "expected": {"type": "dahai", "pai": "8p"},
            "melds": [{"type": "pon", "pai": "E", "consumed": ["E", "E"]},
                      {"type": "pon", "pai": "S", "consumed": ["S", "S"]}],
        }
        discard_stats = self._stats([
            ("W", 0, 5, 10297),  # best_discard, big lead
            ("8p", 0, 1, 4298),
        ])
        # mortal_agrees_cpp=False (score gap 6000 is huge)
        assert _classify_push(mistake, discard_stats, {}, False) == "P4"

    def test_meld_blind_yakuhai_discard_returns_p4(self):
        """Open hand discards yakuhai, Mortal keeps it: P4 Complex Decision.
        Previously P3 (Score Efficiency)."""
        mistake = {
            "actual": {"type": "dahai", "pai": "P"},
            "expected": {"type": "dahai", "pai": "5m"},
            "melds": [{"type": "pon", "pai": "E", "consumed": ["E", "E"]}],
        }
        discard_stats = self._stats([
            ("5m", 1, 8, 5000),  # best_discard — NOT user's pick
            ("P", 1, 8, 4500),
        ])
        assert _classify_push(mistake, discard_stats, {}, True) == "P4"



# =========================================================================
# Defense threat detection must respect tiles_left cutoff
# =========================================================================

class TestThreatDetectionTilesLeft:
    """Future melds / future riichi must NOT count as threats at an earlier
    point in the kyoku. M1536 / M3142 / M4094 / M3979 et al. were all
    miscategorized as D3 because _has_threatening_opponent scanned the whole
    kyoku instead of stopping at the mistake's tiles_left."""

    def _defense_ctx(self, events, player_id=0):
        return {
            "mjai_events": events,
            "start_pos": 0,
            "end_pos": len(events),
            "player_id": player_id,
        }

    def test_future_melds_do_not_count_as_threat(self):
        """Three pon events happen AFTER the mistake's tiles_left;
        threatening_opponent should be False at the mistake time."""
        from lib.categorize import _has_threatening_opponent
        # Tiles_left sequence: 70 -> 69 (mistake here) -> 68 -> 67 -> 66
        events = [
            {"type": "start_kyoku"},
            {"type": "tsumo", "actor": 0},  # tiles_left: 69
            {"type": "dahai", "actor": 0, "pai": "1m"},
            # mistake happens here at tiles_left=69
            {"type": "tsumo", "actor": 1},  # tiles_left: 68 (future)
            {"type": "pon", "actor": 2, "consumed": [], "pai": "2m"},
            {"type": "tsumo", "actor": 2},  # 67
            {"type": "pon", "actor": 2, "consumed": [], "pai": "3m"},
            {"type": "tsumo", "actor": 2},  # 66
            {"type": "pon", "actor": 2, "consumed": [], "pai": "4m"},
        ]
        ctx = self._defense_ctx(events)
        # With tiles_left=69 (mistake's time), the 3 future pons must not count
        assert _has_threatening_opponent(ctx, tiles_left=69) is False

    def test_past_melds_still_count(self):
        """Three pons BEFORE the mistake's tiles_left are real threats."""
        from lib.categorize import _has_threatening_opponent
        events = [
            {"type": "start_kyoku"},
            {"type": "tsumo", "actor": 2},  # 69
            {"type": "pon", "actor": 2, "consumed": [], "pai": "1m"},
            {"type": "tsumo", "actor": 2},  # 68
            {"type": "pon", "actor": 2, "consumed": [], "pai": "2m"},
            {"type": "tsumo", "actor": 2},  # 67
            {"type": "pon", "actor": 2, "consumed": [], "pai": "3m"},
            {"type": "tsumo", "actor": 0},  # 66 — mistake happens here
            {"type": "dahai", "actor": 0, "pai": "9m"},
        ]
        ctx = self._defense_ctx(events)
        # All 3 pons happened before tiles_left=66, should be threatening
        assert _has_threatening_opponent(ctx, tiles_left=66) is True

    def test_future_riichi_does_not_count(self):
        """Riichi declared AFTER the mistake's tiles_left is not an active threat."""
        from lib.categorize import _has_riichi_opponent
        events = [
            {"type": "start_kyoku"},
            {"type": "tsumo", "actor": 0},  # 69
            {"type": "dahai", "actor": 0, "pai": "1m"},
            # mistake at tiles_left=69
            {"type": "tsumo", "actor": 1},  # 68
            {"type": "dahai", "actor": 1, "pai": "E"},
            {"type": "reach", "actor": 1},  # future riichi
        ]
        ctx = self._defense_ctx(events)
        assert _has_riichi_opponent(ctx, tiles_left=69) is False

    def test_past_riichi_still_counts(self):
        from lib.categorize import _has_riichi_opponent
        events = [
            {"type": "start_kyoku"},
            {"type": "tsumo", "actor": 1},  # 69
            {"type": "dahai", "actor": 1, "pai": "E"},
            {"type": "reach", "actor": 1},
            {"type": "tsumo", "actor": 0},  # 68 — mistake here
            {"type": "dahai", "actor": 0, "pai": "3m"},
        ]
        ctx = self._defense_ctx(events)
        assert _has_riichi_opponent(ctx, tiles_left=68) is True
