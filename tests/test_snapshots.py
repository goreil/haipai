"""Golden-replay snapshot tests pinning behavior at the user-visible layer.

These exist so the REFACTOR initiative (docs/backlogs/REFACTOR.md) can move
and rename internals without silently changing what the pipeline outputs.
The deep unit tests in test_categorize/test_parse/etc. pin internal names;
these pin user-visible shape.

Regenerate snapshots after an intentional behavior change:

    UPDATE_SNAPSHOTS=1 .venv/bin/pytest tests/test_snapshots.py

Review the JSON diff before committing.
"""

import json
import os
from pathlib import Path

import pytest

from lib.categorize import (
    categorize_mistake,
    reconstruct_context,
    subtract_hand_from_wall,
)
from lib.parse import flatten_mjai_log, parse_game, round_header

FIXTURES_DIR = Path(__file__).parent / "fixtures"

FIXTURES = [
    ("game_short", "game_short.json"),
    ("game_multi_mistake", "game_multi_mistake.json"),
]

UPDATE_SNAPSHOTS = os.environ.get("UPDATE_SNAPSHOTS") == "1"


def _load(fname):
    with open(FIXTURES_DIR / fname) as f:
        return json.load(f)


def _serialize(obj):
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _assert_snapshot(name, suffix, actual):
    path = FIXTURES_DIR / f"expected_{suffix}_{name}.json"
    actual_text = _serialize(actual)
    if UPDATE_SNAPSHOTS:
        path.write_text(actual_text)
        return
    assert path.exists(), (
        f"Missing snapshot {path.name}. "
        f"Create it with: UPDATE_SNAPSHOTS=1 .venv/bin/pytest {__file__}"
    )
    expected_text = path.read_text()
    if expected_text != actual_text:
        # Drop a .actual.json next to the expected file so the diff is easy.
        (path.parent / f"{path.stem}.actual.json").write_text(actual_text)
        pytest.fail(
            f"Snapshot mismatch for {path.name}. "
            f"Review {path.stem}.actual.json, then run "
            f"UPDATE_SNAPSHOTS=1 pytest if the change is intentional."
        )


@pytest.mark.parametrize("name,fname", FIXTURES)
def test_parse_snapshot(name, fname):
    """parse_game(fixture) output is stable."""
    data = _load(fname)
    game = parse_game(data, game_date="2026-01-01")
    _assert_snapshot(name, "parse", game)


def _categorize_fixture(data):
    """Run categorize_mistake over every mistake, returning a compact per-mistake
    summary. Captures the user-visible category label and the fields that identify
    which decision it came from — no internal state that'd churn on refactor."""
    game = parse_game(data, game_date="2026-01-01")
    kyokus = data["review"]["kyokus"]
    events = flatten_mjai_log(data["mjai_log"])
    start_events = [e for e in events if e.get("type") == "start_kyoku"]
    start_positions = [
        i for i, e in enumerate(events) if e.get("type") == "start_kyoku"
    ]
    player_id = data["player_id"]

    out = []
    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_name = round_header(start)
        game_round = next(
            (r for r in game["rounds"] if r["round"] == rnd_name), None
        )
        if not game_round:
            continue
        dora_indicators = [start["dora_marker"]]
        start_pos = start_positions[kyoku_idx]
        end_pos = (
            start_positions[kyoku_idx + 1]
            if kyoku_idx + 1 < len(start_positions)
            else len(events)
        )
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
            while mistake_idx < len(game_round["mistakes"]):
                if game_round["mistakes"][mistake_idx]["turn"] == entry["junme"]:
                    break
                mistake_idx += 1
            else:
                continue
            if mistake_idx >= len(game_round["mistakes"]):
                continue

            m = game_round["mistakes"][mistake_idx]
            mistake_idx += 1

            cat, _, _, _, _ = categorize_mistake(
                m, data, kyoku_idx, entry, dora_indicators,
                defense_ctx=defense_ctx,
            )
            out.append({
                "round": rnd_name,
                "turn": m["turn"],
                "severity": m["severity"],
                "ev_loss": m["ev_loss"],
                "actual_type": m["actual"].get("type"),
                "expected_type": m["expected"].get("type"),
                "actual_pai": m["actual"].get("pai"),
                "expected_pai": m["expected"].get("pai"),
                "category": cat,
            })
    return out


@pytest.mark.parametrize("name,fname", FIXTURES)
def test_categorize_snapshot(name, fname):
    """categorize_mistake output for every mistake is stable."""
    data = _load(fname)
    out = _categorize_fixture(data)
    _assert_snapshot(name, "categorize", out)


# --- HTTP end-to-end -----------------------------------------------------
#
# The SPA calls `/api/games/add` (upload) and `/api/games/<id>` (render data
# source). Pin both at the HTTP layer so later refactors that reshape routes,
# auth wiring, or the DB surface can't silently drop mistakes on the floor.
# We assert against the *parse-level* mistake count, which is stable before
# the background categorization thread even starts — no race.

# (fixture_name, expected total_mistakes) — kept alongside the fixture list
# for grepability; update together if fixtures change.
EXPECTED_MISTAKE_COUNTS = {
    "game_short": 11,
    "game_multi_mistake": 23,
}


# --- Defense snapshot ----------------------------------------------------
#
# Defense output flows through three modules (`lib/defense.py` classic suji,
# `lib/defense.py` label text, `lib/defense_kd.py` dealin-prob model) and is
# the user-visible signal on mistake cards with an active riichi/open-meld
# threat. CS-03/04/05 in REFACTOR-TARGET.md touch tile-notation encodings,
# the flatten helper, and dora computation — all three feed these functions.
# Pin the outputs now so that unification PRs can't silently move a tile's
# safety rating without the diff surfacing here.
#
# We emit the mistake coordinates (round, turn, hand) plus the three
# defense payloads for every mistake with a live threat. Mistakes without a
# threat (all three return None) are omitted — they'd just be noise.


def _round_floats(obj, ndigits=2):
    """Recursively round floats so snapshots are stable across platforms
    without tying us to a specific float repr."""
    if isinstance(obj, float):
        return round(obj, ndigits)
    if isinstance(obj, dict):
        return {k: _round_floats(v, ndigits) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_round_floats(x, ndigits) for x in obj]
    return obj


def _defense_fixture(data):
    """For every mistake with a live threat, capture classic suji ratings,
    human-readable labels, and KD dealin data. Output ordered by (round, turn)."""
    from lib.defense import get_tile_safety_for_mistake
    from lib.defense_kd import compute_kd_defense_data

    game = parse_game(data, game_date="2026-01-01")
    kyokus = data["review"]["kyokus"]
    events = flatten_mjai_log(data["mjai_log"])
    start_events = [e for e in events if e.get("type") == "start_kyoku"]
    start_positions = [
        i for i, e in enumerate(events) if e.get("type") == "start_kyoku"
    ]
    player_id = data["player_id"]

    out = []
    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        rnd_name = round_header(start)
        game_round = next(
            (r for r in game["rounds"] if r["round"] == rnd_name), None
        )
        if not game_round:
            continue
        start_pos = start_positions[kyoku_idx]
        end_pos = (
            start_positions[kyoku_idx + 1]
            if kyoku_idx + 1 < len(start_positions)
            else len(events)
        )

        mistake_idx = 0
        for entry in kyoku["entries"]:
            if entry["is_equal"]:
                continue
            while mistake_idx < len(game_round["mistakes"]):
                if game_round["mistakes"][mistake_idx]["turn"] == entry["junme"]:
                    break
                mistake_idx += 1
            else:
                continue
            if mistake_idx >= len(game_round["mistakes"]):
                continue

            m = game_round["mistakes"][mistake_idx]
            mistake_idx += 1

            hand = list(m.get("hand") or [])
            if not hand:
                continue
            tiles_left = entry.get("tiles_left")
            if tiles_left is None:
                continue

            try:
                wall, _rw, _sw, _di, _tl = reconstruct_context(
                    data, kyoku_idx, tiles_left
                )
                wall = subtract_hand_from_wall(wall, hand)
                for i, c in enumerate(wall):
                    if c < 0:
                        wall[i] = 0
            except Exception:
                continue

            safety = get_tile_safety_for_mistake(
                hand, events, start_pos, end_pos, player_id,
                tiles_left, wall,
            )
            kd = compute_kd_defense_data(
                hand, events, start_pos, end_pos, player_id,
                tiles_left, wall,
            )

            if safety is None and kd is None:
                continue

            # Keep only the stable, user-visible slice of the KD payload.
            # `wait_breakdowns` + `per_threat.wait_breakdowns` are large and
            # bounce around with wait-table regeneration; leave them out.
            kd_slim = None
            if kd is not None:
                kd_slim = {
                    "safety_ratings": kd["safety_ratings"],
                    "dealin_rates": kd["dealin_rates"],
                    "suji_partners": kd["suji_partners"],
                    "per_threat": [
                        {
                            "seat": t["seat"],
                            "riichi_tile": t["riichi_tile"],
                            "genbutsu": t["genbutsu"],
                            "dealin_rates": t["dealin_rates"],
                            "suji_partners": t["suji_partners"],
                        }
                        for t in kd["per_threat"]
                    ],
                }

            out.append({
                "round": rnd_name,
                "turn": m["turn"],
                "hand": hand,
                "tiles_left": tiles_left,
                "suji_ratings": _round_floats(safety) if safety else None,
                "kd": _round_floats(kd_slim) if kd_slim else None,
            })
    return out


@pytest.mark.parametrize("name,fname", FIXTURES)
def test_defense_snapshot(name, fname):
    """Defense output (classic suji, labels, KD dealin) is stable across
    CS-03/04/05 tile-encoding + dora + flatten refactors."""
    data = _load(fname)
    out = _defense_fixture(data)
    _assert_snapshot(name, "defense", out)


@pytest.mark.parametrize("name,fname", FIXTURES)
def test_add_and_get_game_http(client, name, fname):
    """POST a fixture to /api/games/add, then GET /api/games/<id> and confirm
    the mistake count survives the round-trip through the HTTP + DB layer."""
    mortal_data = _load(fname)
    expected = EXPECTED_MISTAKE_COUNTS[name]

    login_res = client.post(
        "/login",
        data={"username": "testuser", "password": "testpass1"},
        follow_redirects=True,
    )
    assert login_res.status_code == 200

    add_res = client.post(
        "/api/games/add",
        json={"mortal_data": mortal_data, "date": "2026-01-01"},
    )
    assert add_res.status_code == 200, add_res.get_data(as_text=True)
    body = add_res.get_json()
    assert body["ok"] is True
    game_id = body["game_id"]
    assert body["summary"]["total_mistakes"] == expected

    get_res = client.get(f"/api/games/{game_id}")
    assert get_res.status_code == 200
    game = get_res.get_json()
    total = sum(len(r["mistakes"]) for r in game["rounds"])
    assert total == expected
