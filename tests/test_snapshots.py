"""Golden-replay snapshot tests pinning behavior at the user-visible layer.

The deep unit tests in test_categorize/test_parse/etc. pin internal names;
these pin user-visible shape so internals can move/rename without silently
changing what the pipeline outputs.

Regenerate snapshots after an intentional behavior change:

    UPDATE_SNAPSHOTS=1 .venv/bin/pytest tests/test_snapshots.py

Review the JSON diff before committing.
"""

import json
import os
from pathlib import Path

import pytest

from lib.parse import parse_game

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
