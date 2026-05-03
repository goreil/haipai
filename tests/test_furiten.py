#!/usr/bin/env python3
"""Tests for lib/furiten.py — Bad Riichi furiten detection."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.furiten import find_riichi_context, is_furiten, tenpai_waits


class TestTenpaiWaits:
    def test_ryanmen_wait(self):
        # 2-3m ryanmen waiting on 1m or 4m, plus valid triplets/pair to fill.
        hand = ["2m", "3m",
                "5p", "5p", "5p",
                "6s", "7s", "8s",
                "E", "E", "E",
                "W", "W"]
        waits = tenpai_waits(hand, [])
        # waits returns base IDs: 1m=0, 4m=3
        assert set(waits) == {0, 3}

    def test_not_tenpai_returns_empty(self):
        # Shanten 1+ hand — noise pattern, definitely not tenpai.
        hand = ["1m", "3m", "5m", "7m", "9m",
                "1p", "3p", "5p", "7p",
                "1s", "3s", "5s", "7s"]
        assert tenpai_waits(hand, []) == []

    def test_tanki_wait(self):
        # Pair wait on the last tile — the four triplets leave a tanki.
        hand = ["1m", "2m", "3m",
                "4p", "5p", "6p",
                "7s", "8s", "9s",
                "E", "E", "E",
                "W"]
        waits = tenpai_waits(hand, [])
        assert set(waits) == {29}  # W = 29


class TestIsFuriten:
    @property
    def ryanmen_hand(self):
        # Same tenpai hand as above, waits on 1m (base 0) and 4m (base 3).
        return ["2m", "3m",
                "5p", "5p", "5p",
                "6s", "7s", "8s",
                "E", "E", "E",
                "W", "W"]

    def test_no_furiten_when_wait_not_discarded(self):
        report = is_furiten(self.ryanmen_hand, [], ["9m", "9p", "9s", "S"])
        assert report["is_furiten"] is False
        assert report["furiten_tiles"] == []
        assert set(report["waits"]) == {"1m", "4m"}

    def test_furiten_when_wait_tile_in_discards(self):
        report = is_furiten(self.ryanmen_hand, [], ["9m", "1m", "S"])
        assert report["is_furiten"] is True
        assert report["furiten_tiles"] == ["1m"]

    def test_furiten_both_waits_discarded(self):
        report = is_furiten(self.ryanmen_hand, [], ["1m", "4m"])
        assert report["is_furiten"] is True
        assert set(report["furiten_tiles"]) == {"1m", "4m"}

    def test_non_tenpai_hand_never_furiten(self):
        bad_hand = ["1m", "3m", "5m", "7m", "9m",
                    "1p", "3p", "5p", "7p",
                    "1s", "3s", "5s", "7s"]
        report = is_furiten(bad_hand, [], ["1m"])
        assert report["is_furiten"] is False
        assert report["waits"] == []

    def test_red_five_discard_matches_base(self):
        # Hand waits on 5m (via a 46m kanchan, say). If the player discarded
        # the red 5mr earlier, that's still furiten on the 5m wait.
        hand = ["4m", "6m",
                "1p", "2p", "3p",
                "7s", "8s", "9s",
                "S", "S", "S",
                "F", "F"]
        waits = tenpai_waits(hand, [])
        assert 4 in waits  # 5m base
        report = is_furiten(hand, [], ["5mr"])
        assert report["is_furiten"] is True
        assert "5m" in report["furiten_tiles"]


class TestFindRiichiContext:
    def _events(self, seq):
        """Tiny helper to build an mjai-event stream with start_kyoku at 0."""
        return [{"type": "start_kyoku", "oya": 0, "bakaze": "E",
                 "dora_marker": "1s"}] + seq

    def test_basic_reach_then_dahai(self):
        events = self._events([
            {"type": "tsumo", "actor": 1, "pai": "1m"},
            {"type": "dahai", "actor": 1, "pai": "9m"},
            {"type": "tsumo", "actor": 0, "pai": "2m"},
            {"type": "dahai", "actor": 0, "pai": "E"},
            {"type": "tsumo", "actor": 1, "pai": "3m"},
            {"type": "reach", "actor": 1},
            {"type": "dahai", "actor": 1, "pai": "5m"},
            {"type": "reach_accepted", "actor": 1},
        ])
        tile, discards = find_riichi_context(events, 0, len(events), player_id=1)
        assert tile == "5m"
        assert discards == ["9m"]

    def test_no_reach_returns_none(self):
        events = self._events([
            {"type": "tsumo", "actor": 1, "pai": "1m"},
            {"type": "dahai", "actor": 1, "pai": "9m"},
        ])
        tile, discards = find_riichi_context(events, 0, len(events), player_id=1)
        # No reach by this player in the kyoku → nothing to report. Callers
        # only use the discards when a riichi tile is returned.
        assert tile is None

    def test_other_player_reach_ignored(self):
        events = self._events([
            {"type": "tsumo", "actor": 0, "pai": "1m"},
            {"type": "dahai", "actor": 0, "pai": "E"},
            {"type": "reach", "actor": 0},  # different player
            {"type": "dahai", "actor": 0, "pai": "S"},
            {"type": "tsumo", "actor": 1, "pai": "2m"},
            {"type": "dahai", "actor": 1, "pai": "W"},
        ])
        tile, discards = find_riichi_context(events, 0, len(events), player_id=1)
        assert tile is None
