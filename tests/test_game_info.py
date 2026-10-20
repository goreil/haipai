import json

from lib import game_info


def test_missing_invalid_and_outside_files(tmp_path, monkeypatch):
    root = tmp_path / "app"
    root.mkdir()
    monkeypatch.setattr(game_info, "ROOT", root)
    (root / "invalid.json").write_text("{")
    (tmp_path / "outside.json").write_text("{}")
    for filename in (None, "missing.json", "invalid.json", "../outside.json"):
        assert game_info.load_match_info(filename) is None


def test_compact_events_keep_final_hand_riichi_and_invalidate_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(game_info, "ROOT", tmp_path)
    source = tmp_path / "game.json"
    data = {
        "player_id": 1, "game_length": "Hanchan",
        "mjai_log": [
            {"type": "start_kyoku", "oya": 3, "scores": [25000] * 4, "tehais": [["1m"]]},
            {"type": "hora", "target": 0, "deltas": [-1000, 1000, 0, 0]},
            {"type": "start_kyoku", "oya": 0, "scores": [24000, 26000, 25000, 25000], "kyotaku": 0},
            [{"type": "reach", "actor": 1}, {"type": "reach_accepted", "actor": 1}],
            {"type": "dahai", "actor": 1, "pai": "1m"},
            {"type": "ryukyoku", "deltas": [0, 0, 0, 0]},
        ],
        "review": {"large": "payload"},
    }
    source.write_text(json.dumps(data))
    info = game_info.load_match_info("game.json")
    assert info["mjai_log"] == [
        {"type": "start_kyoku", "oya": 3, "scores": [25000] * 4},
        {"type": "start_kyoku", "oya": 0, "scores": [24000, 26000, 25000, 25000], "kyotaku": 0},
        {"type": "reach", "actor": 1},
        {"type": "reach_accepted", "actor": 1},
        {"type": "ryukyoku", "deltas": [0, 0, 0, 0]},
    ]
    data["game_length"] = "Tonpu"
    source.write_text(json.dumps(data))
    assert game_info.load_match_info("game.json")["game_length"] == "Tonpu"
