#!/usr/bin/env python3
"""Tests for lib/defense_kd.py — KillerDucky-style defense eval."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.defense_kd import (
    MJAI_TO_TENHOU,
    DEALIN_MAX_PCT,
    WAIT_KANCHAN,
    WAIT_PENCHAN,
    WAIT_RYANMEN,
    WAIT_SHANPON,
    WAIT_TANKI,
    _derive_label,
    _suji_partners,
    calc_combos,
    compute_kd_defense_data,
    dealin_probability,
    dealin_to_safety,
    generate_waits,
    get_tile_safety_for_mistake,
    norm_red_five,
)
from lib.tiles import dora_indicator_to_dora_tenhou


# ---------------------------------------------------------------------------
# Encoding helpers
# ---------------------------------------------------------------------------

class TestNormRedFive:
    def test_non_aka_passthrough(self):
        assert norm_red_five(15) == 15
        assert norm_red_five(41) == 41
        assert norm_red_five(11) == 11

    def test_aka_collapses(self):
        assert norm_red_five(51) == 15
        assert norm_red_five(52) == 25
        assert norm_red_five(53) == 35


class TestDoraIndicator:
    def test_number_wraps_nine_to_one_in_suit(self):
        assert dora_indicator_to_dora_tenhou(19) == 11
        assert dora_indicator_to_dora_tenhou(29) == 21
        assert dora_indicator_to_dora_tenhou(39) == 31

    def test_number_normal_increment(self):
        assert dora_indicator_to_dora_tenhou(14) == 15
        assert dora_indicator_to_dora_tenhou(25) == 26

    def test_wind_wrap_north_to_east(self):
        assert dora_indicator_to_dora_tenhou(44) == 41

    def test_dragon_wrap_chun_to_haku(self):
        assert dora_indicator_to_dora_tenhou(47) == 45

    def test_aka_indicator_normalises(self):
        assert dora_indicator_to_dora_tenhou(51) == 16


# ---------------------------------------------------------------------------
# generate_waits
# ---------------------------------------------------------------------------

class TestGenerateWaits:
    @pytest.fixture
    def waits(self):
        return generate_waits()

    def test_ryanmen_count(self, waits):
        # 6 positions × 3 suits
        assert sum(1 for w in waits if w["type"] == WAIT_RYANMEN) == 18

    def test_kanchan_count(self, waits):
        # 7 positions × 3 suits
        assert sum(1 for w in waits if w["type"] == WAIT_KANCHAN) == 21

    def test_penchan_count(self, waits):
        # (1,2)→3 and (8,9)→7, × 3 suits
        assert sum(1 for w in waits if w["type"] == WAIT_PENCHAN) == 6

    def test_tanki_count(self, waits):
        # 9 number positions × 3 suits + 7 honor positions = 34
        assert sum(1 for w in waits if w["type"] == WAIT_TANKI) == 34

    def test_shanpon_count(self, waits):
        assert sum(1 for w in waits if w["type"] == WAIT_SHANPON) == 34

    def test_ryanmen_waits_on_outer_tiles(self, waits):
        # 2-3m ryanmen should wait on 1m and 4m
        m23 = next(w for w in waits if w["type"] == WAIT_RYANMEN
                   and w["tiles"] == [12, 13])
        assert m23["waits_on"] == [11, 14]

    def test_kanchan_waits_on_middle(self, waits):
        # 1-3m kanchan should wait on 2m
        m13 = next(w for w in waits if w["type"] == WAIT_KANCHAN
                   and w["tiles"] == [11, 13])
        assert m13["waits_on"] == [12]


# ---------------------------------------------------------------------------
# calc_combos
# ---------------------------------------------------------------------------

def _full_unseen():
    """4 unseen per numbered tile (11-19, 21-29, 31-39), 4 per honor (41-47)."""
    return {t: 4 for t in list(range(11, 20)) + list(range(21, 30))
            + list(range(31, 40)) + list(range(41, 48))}


class TestCalcCombos:
    def test_empty_genbutsu_all_waits_contribute(self):
        combos = calc_combos(generate_waits(), set(), [],
                             _full_unseen(), dora=None)
        assert combos["all"] > 0

    def test_genbutsu_tile_is_zero(self):
        combos = calc_combos(generate_waits(), {15}, [],
                             _full_unseen(), dora=None)
        # Every wait that waits on 5m should be skipped.
        assert 15 not in combos

    def test_genbutsu_reduces_overall(self):
        baseline = calc_combos(generate_waits(), set(), [],
                               _full_unseen(), dora=None)["all"]
        with_gb = calc_combos(generate_waits(), {15, 25, 35}, [],
                              _full_unseen(), dora=None)["all"]
        assert with_gb < baseline

    def test_aka_discard_penalty_shrinks_combos(self):
        baseline = calc_combos(generate_waits(), set(), [15],
                               _full_unseen(), dora=None)
        # Now tell the calc a red 5m was discarded — involved waits get 0.14×.
        penalised = calc_combos(generate_waits(), set(), [51],
                                _full_unseen(), dora=None)
        # Both share the same normalised riichi tile (15), but penalised has
        # the aka penalty on waits involving 5m.
        assert penalised["all"] < baseline["all"]


# ---------------------------------------------------------------------------
# dealin_probability / safety conversion
# ---------------------------------------------------------------------------

class TestDealinAndSafety:
    def test_dealin_zero_when_genbutsu(self):
        combos = calc_combos(generate_waits(), {15}, [],
                             _full_unseen(), dora=None)
        assert dealin_probability(15, combos) == 0.0

    def test_dealin_probability_in_range(self):
        combos = calc_combos(generate_waits(), set(), [15],
                             _full_unseen(), dora=None)
        for t in (11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 31, 41):
            p = dealin_probability(t, combos)
            assert 0.0 <= p <= 1.0

    def test_safety_at_zero_dealin_is_max(self):
        assert dealin_to_safety(0.0) == DEALIN_MAX_PCT

    def test_safety_at_or_above_cap_clamps_to_zero(self):
        assert dealin_to_safety(DEALIN_MAX_PCT / 100) == 0.0
        assert dealin_to_safety(1.0) == 0.0

    def test_safety_is_monotonically_decreasing(self):
        assert dealin_to_safety(0.05) > dealin_to_safety(0.10)


# ---------------------------------------------------------------------------
# End-to-end wrapper
# ---------------------------------------------------------------------------

def _build_wall_from_mjai_ids():
    """Wall in categorize.py layout: 34 base + 3 red slots."""
    return [4] * 34 + [1, 1, 1]


TARGET_TILES_LEFT = 61


def _minimal_events_riichi_on_5m():
    """Minimal flattened mjai event stream with opponent (seat 1) declaring
    riichi on 5m in their 2nd turn. Seat 1 has previously discarded East, so
    E is in their own discard pile (genbutsu). The hypothetical hero mistake
    is hero's 3rd tsumo, leaving tiles_left = 61."""
    return [
        {"type": "start_kyoku", "bakaze": "E", "oya": 0,
         "dora_marker": "9m"},
        # Turn 1
        {"type": "tsumo", "actor": 0, "pai": "1m"},      # 70 -> 69
        {"type": "dahai", "actor": 0, "pai": "1m", "tsumogiri": True},
        {"type": "tsumo", "actor": 1, "pai": "E"},       # 69 -> 68
        {"type": "dahai", "actor": 1, "pai": "E", "tsumogiri": True},
        {"type": "tsumo", "actor": 2, "pai": "2p"},      # 68 -> 67
        {"type": "dahai", "actor": 2, "pai": "2p", "tsumogiri": True},
        {"type": "tsumo", "actor": 3, "pai": "3p"},      # 67 -> 66
        {"type": "dahai", "actor": 3, "pai": "3p", "tsumogiri": True},
        # Turn 2 — seat 1 reaches on 5m.
        {"type": "tsumo", "actor": 0, "pai": "4p"},      # 66 -> 65
        {"type": "dahai", "actor": 0, "pai": "4p", "tsumogiri": True},
        {"type": "tsumo", "actor": 1, "pai": "5m"},      # 65 -> 64
        {"type": "reach", "actor": 1},
        {"type": "dahai", "actor": 1, "pai": "5m", "tsumogiri": False},
        {"type": "reach_accepted", "actor": 1},
        {"type": "tsumo", "actor": 2, "pai": "6p"},      # 64 -> 63
        {"type": "dahai", "actor": 2, "pai": "6p", "tsumogiri": True},
        {"type": "tsumo", "actor": 3, "pai": "7p"},      # 63 -> 62
        {"type": "dahai", "actor": 3, "pai": "7p", "tsumogiri": True},
        # Hero's 3rd tsumo — mistake occurs at tiles_left = 61.
        {"type": "tsumo", "actor": 0, "pai": "8p"},      # 62 -> 61
    ]


class TestGetTileSafety:
    def test_returns_none_without_riichi(self):
        events = [{"type": "start_kyoku", "bakaze": "E", "oya": 0,
                   "dora_marker": "9m"}]
        result = get_tile_safety_for_mistake(
            ["1m", "2p"], events, 0, 1, player_id=0,
            tiles_left=70, wall_remaining=_build_wall_from_mjai_ids())
        assert result is None

    def test_riichi_returns_dict_of_hand_tiles(self):
        events = _minimal_events_riichi_on_5m()
        hand = ["1m", "7m", "2p", "8p", "3s", "E", "S", "W", "N", "P", "F", "C", "5p"]
        result = get_tile_safety_for_mistake(
            hand, events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert result is not None
        assert set(result.keys()) == set(hand)
        for val in result.values():
            assert 0.0 <= val <= DEALIN_MAX_PCT

    def test_east_is_genbutsu_after_opponent_discard(self):
        events = _minimal_events_riichi_on_5m()
        # Seat 1 discarded E before their riichi tile → E is genbutsu.
        result = get_tile_safety_for_mistake(
            ["E", "3s"], events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert result is not None
        assert result["E"] == DEALIN_MAX_PCT

    def test_five_m_is_genbutsu_riichi_tile(self):
        events = _minimal_events_riichi_on_5m()
        result = get_tile_safety_for_mistake(
            ["5m", "5mr"], events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert result is not None
        # The riichi tile (5m) was the opponent's own discard, genbutsu = 15.
        assert result["5m"] == DEALIN_MAX_PCT
        # Aka 5m collapses to the same tenhou id → also genbutsu.
        assert result["5mr"] == DEALIN_MAX_PCT

class TestDeriveLabel:
    def test_honor_is_no_suji_unless_genbutsu(self):
        assert _derive_label(41, set()) == "no-suji"
        assert _derive_label(41, {41}) == "genbutsu"

    def test_terminal_suji_on_single_flank(self):
        # 1m (tenhou 11) suji iff 4m (14) in genbutsu.
        assert _derive_label(11, {14}) == "suji"
        assert _derive_label(11, set()) == "no-suji"

    def test_middle_suji_requires_both_flanks(self):
        # 5m (15) only suji when BOTH 2m (12) and 8m (18) are in genbutsu.
        assert _derive_label(15, {12}) == "no-suji"
        assert _derive_label(15, {18}) == "no-suji"
        assert _derive_label(15, {12, 18}) == "suji"

    def test_red_five_collapses_to_base(self):
        assert _derive_label(51, {12, 18}) == "suji"


class TestSujiPartners:
    def test_honor_has_no_partners(self):
        assert _suji_partners(41, {41, 12, 15}) == []

    def test_edge_has_single_partner(self):
        # 1m (11): partner is 4m (14).
        assert _suji_partners(11, {14}) == [14]
        assert _suji_partners(11, set()) == []
        # 9m (19): partner is 6m (16).
        assert _suji_partners(19, {16}) == [16]

    def test_middle_partners_both(self):
        # 5m (15): partners are 2m (12) and 8m (18).
        assert _suji_partners(15, {12, 18}) == [12, 18]
        assert _suji_partners(15, {12}) == [12]
        assert _suji_partners(15, {18}) == [18]
        assert _suji_partners(15, set()) == []

    def test_red_five_collapses(self):
        assert _suji_partners(51, {12, 18}) == [12, 18]


class TestComputeKDDefenseData:
    def test_returns_none_without_riichi(self):
        events = [{"type": "start_kyoku", "bakaze": "E", "oya": 0,
                   "dora_marker": "9m"}]
        assert compute_kd_defense_data(
            ["1m"], events, 0, 1, player_id=0,
            tiles_left=70, wall_remaining=_build_wall_from_mjai_ids()) is None

    def test_full_shape(self):
        events = _minimal_events_riichi_on_5m()
        hand = ["1m", "5m", "3s", "E"]
        data = compute_kd_defense_data(
            hand, events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert data is not None
        assert set(data.keys()) == {
            "safety_ratings", "dealin_rates",
            "wait_breakdowns", "suji_partners", "per_threat",
        }
        assert set(data["safety_ratings"].keys()) == set(hand)
        assert set(data["dealin_rates"].keys()) == set(hand)
        for rate in data["dealin_rates"].values():
            assert 0.0 <= rate <= 100.0

    def test_genbutsu_marks_discarded_tile(self):
        events = _minimal_events_riichi_on_5m()
        data = compute_kd_defense_data(
            ["E", "5m", "3s"], events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert data["dealin_rates"]["E"] == 0.0
        assert data["dealin_rates"]["5m"] == 0.0

    def test_per_threat_block(self):
        events = _minimal_events_riichi_on_5m()
        data = compute_kd_defense_data(
            ["1m", "3s"], events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert len(data["per_threat"]) == 1
        pt = data["per_threat"][0]
        assert pt["seat"] == 1
        assert pt["riichi_tile"] == "5m"
        assert "E" in pt["genbutsu"]
        assert set(pt["dealin_rates"].keys()) == {"1m", "3s"}

    def test_suji_partners_in_payload(self):
        """Top-level and per-threat suji_partners expose matched partners so
        the frontend doesn't re-scan discards (CS-01)."""
        events = _minimal_events_riichi_on_5m()
        # Seat 1's pre-riichi discards include E and 1m/9m/... the minimal
        # fixture has; 5m is the riichi tile. Hand here contains 2m whose
        # partner 5m lands in genbutsu → 2m gets ["5m"] as a half-suji
        # partner. E is honor → no entry. 5m is genbutsu → no partners.
        data = compute_kd_defense_data(
            ["2m", "5m", "E"], events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        assert data is not None
        partners = data["suji_partners"]
        assert partners.get("2m") == ["5m"]
        assert "E" not in partners
        assert "5m" not in partners  # genbutsu tile has no partners
        # Per-threat mirror carries the same info.
        pt_partners = data["per_threat"][0]["suji_partners"]
        assert pt_partners.get("2m") == ["5m"]

    def test_wait_breakdown_shape(self):
        events = _minimal_events_riichi_on_5m()
        data = compute_kd_defense_data(
            ["2m", "E"], events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids())
        # 2m has live waits against seat 1's riichi.
        breakdown = data["wait_breakdowns"]["2m"]
        assert len(breakdown) > 0
        for entry in breakdown:
            assert entry["type"] in ("ryanmen", "kanchan", "penchan",
                                     "tanki", "shanpon")
            assert isinstance(entry["tiles"], list)
            assert isinstance(entry["waits_on"], list)
            assert 0.0 <= entry["rate"] <= 100.0
        # Genbutsu tile has no live waits.
        assert data["wait_breakdowns"]["E"] == []

    def test_defense_module_delegates_to_kd(self):
        """lib.defense.get_tile_safety_for_mistake delegates to KD (the only
        evaluator)."""
        from lib import defense
        events = _minimal_events_riichi_on_5m()
        hand = ["1m", "5m", "3s", "E"]
        result = defense.get_tile_safety_for_mistake(
            hand, events, 0, len(events), player_id=0,
            tiles_left=TARGET_TILES_LEFT,
            wall_remaining=_build_wall_from_mjai_ids(),
        )
        assert result is not None
        # Both the riichi tile and the opponent's earlier discard read as
        # genbutsu under KD.
        assert result["5m"] == DEALIN_MAX_PCT
        assert result["E"] == DEALIN_MAX_PCT
