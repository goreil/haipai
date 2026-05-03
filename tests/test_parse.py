#!/usr/bin/env python3
"""Tests for lib/parse.py — format_action and parse_game error handling."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.parse import format_action, parse_game, severity, round_header


# --- format_action tests ---

class TestFormatAction:
    def test_dahai(self):
        assert format_action({"type": "dahai", "pai": "5m"}) == "5m"

    def test_chi(self):
        result = format_action({"type": "chi", "consumed": ["3m", "4m"], "pai": "5m"})
        assert result == "chi 3m4m+5m"

    def test_pon(self):
        result = format_action({"type": "pon", "consumed": ["E", "E"], "pai": "E"})
        assert result == "pon EE+E"

    def test_reach(self):
        assert format_action({"type": "reach"}) == "riichi"

    def test_hora(self):
        assert format_action({"type": "hora"}) == "win"

    def test_none(self):
        assert format_action({"type": "none"}) == "pass"

    def test_ankan(self):
        result = format_action({"type": "ankan", "consumed": ["N"]})
        assert result == "ankan N"

    def test_unknown_type(self):
        assert format_action({"type": "kakan"}) == "kakan"

    def test_missing_type(self):
        assert format_action({}) == "?"


# --- parse_game error handling tests ---

class TestParseGameErrors:
    def test_not_a_dict(self):
        with pytest.raises(ValueError, match="Expected a JSON object"):
            parse_game([], game_date="2026-01-01")

    def test_missing_review(self):
        with pytest.raises(ValueError, match="Missing or invalid 'review'"):
            parse_game({"mjai_log": []}, game_date="2026-01-01")

    def test_review_not_dict(self):
        with pytest.raises(ValueError, match="Missing or invalid 'review'"):
            parse_game({"review": "bad", "mjai_log": []}, game_date="2026-01-01")

    def test_missing_kyokus(self):
        with pytest.raises(ValueError, match="Missing or invalid 'review.kyokus'"):
            parse_game({"review": {}, "mjai_log": []}, game_date="2026-01-01")

    def test_missing_mjai_log(self):
        with pytest.raises(ValueError, match="Missing or invalid 'mjai_log'"):
            parse_game({"review": {"kyokus": []}}, game_date="2026-01-01")

    def test_mismatched_kyoku_count(self):
        data = {
            "review": {"kyokus": [{"entries": []}, {"entries": []}]},
            "mjai_log": [{"type": "start_kyoku", "bakaze": "E", "kyoku": 1, "honba": 0}],
        }
        with pytest.raises(ValueError, match="2 review kyokus but 1 start_kyoku"):
            parse_game(data, game_date="2026-01-01")

    def test_valid_empty_game(self):
        """A game with zero kyokus should parse successfully."""
        data = {
            "review": {"kyokus": []},
            "mjai_log": [],
        }
        game = parse_game(data, game_date="2026-01-01")
        assert game["rounds"] == []
        assert game["date"] == "2026-01-01"

    def test_malformed_entry(self):
        """Missing details field should raise ValueError."""
        data = {
            "review": {"kyokus": [{
                "entries": [{
                    "is_equal": False,
                    "junme": 1,
                    "tiles_left": 60,
                    "state": {"tehai": [], "fuuros": []},
                    "actual": {"type": "dahai", "pai": "1m"},
                    "expected": {"type": "dahai", "pai": "2m"},
                    "actual_index": 1,
                    # missing "details"
                }],
            }]},
            "mjai_log": [{"type": "start_kyoku", "bakaze": "E", "kyoku": 1, "honba": 0}],
        }
        with pytest.raises(ValueError, match="Malformed entry"):
            parse_game(data, game_date="2026-01-01")


class TestDecisionCountsForKyoku:
    """U-04: per-category denominators derived from mjai log + review entries."""

    def _base_game(self, mjai_log, entries):
        return {
            "player_id": 0,
            "review": {"kyokus": [{"entries": entries}]},
            "mjai_log": mjai_log,
        }

    def _entry(self, junme, actual_type, detail_types=("dahai",),
               expected_type=None):
        details = [{"action": {"type": t}, "q_value": 0, "prob": 0.5} for t in detail_types]
        actual_index = 0
        if actual_type not in detail_types:
            details.append({"action": {"type": actual_type}, "q_value": -0.1, "prob": 0.1})
            actual_index = len(details) - 1
        return {
            "is_equal": True,  # skip mistake creation; decision_counts doesn't care
            "junme": junme,
            "tiles_left": 60,
            "state": {"tehai": [], "fuuros": []},
            "actual": {"type": actual_type},
            "expected": {"type": expected_type if expected_type is not None else detail_types[0]},
            "actual_index": actual_index,
            "details": details,
        }

    def test_attack_vs_defense_bucketing(self):
        # Player (seat 0) discards once before any reach, once after opp reach.
        mjai = [
            {"type": "start_kyoku", "bakaze": "E", "oya": 0, "honba": 0, "kyoku": 1,
             "dora_marker": "1s", "scores": [25000]*4},
            {"type": "tsumo", "actor": 0, "pai": "1m"},        # junme 0 — no riichi
            {"type": "dahai", "actor": 0, "pai": "9m"},
            {"type": "tsumo", "actor": 1, "pai": "2m"},
            {"type": "dahai", "actor": 1, "pai": "8m"},
            {"type": "reach", "actor": 1},
            {"type": "reach_accepted", "actor": 1},            # seat 1 riichi now active
            {"type": "tsumo", "actor": 0, "pai": "3m"},        # junme 1 — defense
            {"type": "dahai", "actor": 0, "pai": "E"},
        ]
        entries = [
            self._entry(0, "dahai"),
            self._entry(1, "dahai"),
        ]
        game = parse_game(self._base_game(mjai, entries), game_date="2026-01-01")
        dc = game["rounds"][0]["decision_counts"]
        assert dc == {"attack": 1, "defense": 1, "riichi": 0, "meld": 0, "kan": 0}

    def test_riichi_counts_only_actual_riichi_decisions(self):
        # Decisions land in exactly one bucket (sum = entries).
        # - A dahai where reach was on the table but both sides chose dahai
        #   is still an attack decision, not a riichi decision.
        # - A mistake with reach on either side (5A/5B-like) goes to riichi.
        # - A non-mistake where both sides reached also goes to riichi.
        mjai = [
            {"type": "start_kyoku", "bakaze": "E", "oya": 0, "honba": 0, "kyoku": 1,
             "dora_marker": "1s", "scores": [25000]*4},
            {"type": "tsumo", "actor": 0, "pai": "1m"},
            {"type": "dahai", "actor": 0, "pai": "9m"},
            {"type": "tsumo", "actor": 0, "pai": "2m"},
            {"type": "dahai", "actor": 0, "pai": "9p"},
            {"type": "tsumo", "actor": 0, "pai": "3m"},
            {"type": "dahai", "actor": 0, "pai": "8p"},
            {"type": "tsumo", "actor": 0, "pai": "4m"},
            {"type": "dahai", "actor": 0, "pai": "7p"},
        ]
        entries = [
            self._entry(0, "dahai", detail_types=("dahai",)),
            # reach offered, both agree on dahai — stays attack.
            self._entry(1, "dahai", detail_types=("dahai", "reach")),
            # 5B-shaped: actual dahai, expected reach.
            self._entry(2, "dahai", detail_types=("dahai", "reach"),
                        expected_type="reach"),
            # Correct riichi declaration.
            self._entry(3, "reach", detail_types=("dahai", "reach"),
                        expected_type="reach"),
        ]
        game = parse_game(self._base_game(mjai, entries), game_date="2026-01-01")
        dc = game["rounds"][0]["decision_counts"]
        assert dc == {"attack": 2, "defense": 0, "riichi": 2, "meld": 0, "kan": 0}
        assert sum(dc.values()) == len(entries)  # single-bucket invariant

    def test_meld_and_kan_counts_single_bucket(self):
        # Each entry contributes to exactly one bucket.
        mjai = [
            {"type": "start_kyoku", "bakaze": "E", "oya": 0, "honba": 0, "kyoku": 1,
             "dora_marker": "1s", "scores": [25000]*4},
        ]
        entries = [
            # Passed on chi — meld decision.
            self._entry(0, "none", detail_types=("none", "chi")),
            # Called pon — meld decision.
            self._entry(0, "pon", detail_types=("pon", "none"),
                        expected_type="pon"),
            # Ankan mistake (6A-shaped): actual ankan, expected dahai.
            self._entry(0, "ankan", detail_types=("dahai", "ankan"),
                        expected_type="dahai"),
            # Pass-on-kan that both agreed on — attack, not kan (no one
            # actually wanted to kan).
            self._entry(0, "dahai", detail_types=("dahai", "ankan")),
        ]
        game = parse_game(self._base_game(mjai, entries), game_date="2026-01-01")
        dc = game["rounds"][0]["decision_counts"]
        assert dc == {"attack": 1, "defense": 0, "riichi": 0, "meld": 2, "kan": 1}
        assert sum(dc.values()) == len(entries)
