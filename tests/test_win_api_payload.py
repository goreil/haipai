"""Exercise Win prep with the slim replay the browser actually receives."""

import json
from pathlib import Path
import subprocess

import db
from tests.conftest import insert_game

ROOT = Path(__file__).resolve().parents[1]


def test_win_comparison_from_api_payload_and_old_cache_revalidation(client, monkeypatch):
    from routes import game as game_routes

    full = json.loads((ROOT / "tests/fixtures/win_m323.json").read_text())
    client.post("/login", data={"username": "testuser", "password": "testpass1"})
    conn = db.get_db()
    uid = db.get_user_by_username(conn, "testuser")["id"]
    conn.close()
    game_id, _ = insert_game(uid)
    conn = db.get_db()
    conn.execute("UPDATE games SET mortal_file = ? WHERE id = ?", ("mortal_analysis/win-fixture.json", game_id))
    conn.commit()
    conn.close()
    monkeypatch.setattr(game_routes, "_read_mortal_json", lambda _path: full)

    # Old responses used only the source-file hash, and must not get a 304.
    url = f"/api/games/{game_id}/mortal?v=2"
    response = client.get(url, headers={"If-None-Match": '"win-fixture"'})
    assert response.status_code == 200
    assert response.headers["ETag"] != '"win-fixture"'
    assert client.get(url, headers={"If-None-Match": response.headers["ETag"]}).status_code == 304
    slim = response.get_json()
    entry = slim["review"]["kyokus"][0]["entries"][0]
    original = full["review"]["kyokus"][0]["entries"][0]
    for key in ("last_actor", "tile", "at_self_chi_pon", "at_opponent_kakan"):
        assert entry[key] == original[key]
    assert "state" not in entry
    assert "q_value" not in entry["details"][0]

    # Stored mistake data and slim replay are separate objects in the browser.
    result = subprocess.run(
        ["node", "-e", r'''
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const {prepReport} = require('./static/js/prep/prep.js');
const {full, slim} = JSON.parse(fs.readFileSync(0, 'utf8'));
const e = full.review.kyokus[0].entries[0];
const m = {hand:e.state.tehai, melds:e.state.fuuros, actual:e.actual, expected:e.expected,
  draw:e.tile, turn:e.junme, top_actions:e.details};
prepReport(m, slim, 0, 0);
assert.equal(m.win_context.flags, 'ri');
assert.equal(m.win_continuation.actual.pai, '4p');
const ctx = vm.createContext({window:{}, console});
const index = fs.readFileSync('static/index.html', 'utf8');
for (const match of index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)) {
  if (!match[1].endsWith('/actions.js')) vm.runInContext(fs.readFileSync('.' + match[1], 'utf8'), ctx);
  if (match[1].endsWith('/mistake-card.js')) break;
}
const html = ctx.renderEvComparison(m);
assert.match(html, /2,600/);
assert.match(html, /3,600/);
assert.doesNotMatch(html, /alt="4p"/);
assert.match(html, /col-actual[^]*>PASS<\/span>/);
assert.match(html, /col-expected[^]*>Ron<\/span>/);
assert.doesNotMatch(html, /class="dealin-col"|Winning ends the hand/);
assert.doesNotMatch(html, /Win value unavailable|Continuation unknown/);
'''],
        input=json.dumps({"full": full, "slim": slim}), text=True, cwd=ROOT,
        capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
