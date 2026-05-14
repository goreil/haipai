// Step-2 smoke test: parity between JS prep glue modules
// (prep/tiles.js, prep/parse.js, prep/board.js, prep/furiten.js) and their
// Python twins (lib/tiles.py, lib/parse.py, lib/board.py, lib/furiten.py).
//
// Strategy: load the two test mortal-JSON fixtures, walk Python's
// extract_board_state / walk_kyoku at every entry's tiles_left checkpoint,
// then re-run JS prep on the same inputs and diff.
//
// Usage: node scripts/smoke_step2.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const board = require(path.join(repoRoot, "static/js/prep/board.js"));
const parse = require(path.join(repoRoot, "static/js/prep/parse.js"));
const furiten = require(path.join(repoRoot, "static/js/prep/furiten.js"));

const fixtures = [
  "tests/fixtures/game_short.json",
  "tests/fixtures/game_multi_mistake.json",
];

// Pick tiles_left checkpoints: every entry's tiles_left + a few coarse points.
function checkpointsForKyoku(kyoku) {
  const set = new Set([70, 50, 30, 10, 0]);
  for (const e of kyoku.entries || []) {
    if (typeof e.tiles_left === "number") set.add(e.tiles_left);
  }
  return [...set].sort((a, b) => b - a);
}

function pyExpected(fixturePath) {
  const py = `
import json, sys
from lib.parse import flatten_mjai_log, walk_kyoku
from lib.board import extract_board_state, reconstruct_context

data = json.load(open("${fixturePath}"))
events = flatten_mjai_log(data["mjai_log"])
start_positions = [i for i, e in enumerate(events) if e.get("type") == "start_kyoku"]
player_id = data["player_id"]
out = []
for kyoku_idx, kyoku in enumerate(data["review"]["kyokus"]):
  start_pos = start_positions[kyoku_idx]
  end_pos = start_positions[kyoku_idx + 1] if kyoku_idx + 1 < len(start_positions) else len(events)
  # Per-kyoku checkpoints
  cps = sorted({70, 50, 30, 10, 0} | {e.get("tiles_left") for e in kyoku.get("entries", []) if e.get("tiles_left") is not None}, reverse=True)
  per_cp = []
  for tl in cps:
    bs = extract_board_state(data, kyoku_idx, tl)
    ctx = reconstruct_context(data, kyoku_idx, tl)
    walk = walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left=tl)
    per_cp.append({
      "tiles_left_target": tl,
      "board_state": bs,
      "wall": ctx[0],
      "round_wind_id": ctx[1],
      "seat_wind_id": ctx[2],
      "dora_ids": ctx[3],
      "wall_tiles_left": ctx[4],
      "walk": {
        "opponents": {str(k): v for k, v in walk["opponents"].items()},
        "player_tsumo_riichi_state": walk["player_tsumo_riichi_state"],
        "genbutsu_post_reach_by_seat": {str(k): v for k, v in walk["genbutsu_post_reach_by_seat"].items()},
        "first_dora_indicator": walk["first_dora_indicator"],
        "tiles_left_at_end": walk["tiles_left_at_end"],
      },
    })
  out.append({"kyoku_idx": kyoku_idx, "checkpoints": per_cp})
json.dump(out, sys.stdout)
`;
  const buf = execFileSync(".venv/bin/python", ["-c", py], {
    cwd: repoRoot,
    maxBuffer: 200 * 1024 * 1024,
  });
  return JSON.parse(buf.toString("utf8"));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function diffPath(a, b, prefix = "") {
  if (a === b) return null;
  if (a == null || b == null || typeof a !== typeof b) {
    return `${prefix}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${prefix}: type`;
    if (a.length !== b.length) return `${prefix}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diffPath(a[i], b[i], `${prefix}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = diffPath(a[k], b[k], `${prefix}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${prefix}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

let totalChecks = 0;
let totalFail = 0;
const failures = [];

for (const rel of fixtures) {
  const fixturePath = path.join(repoRoot, rel);
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const events = parse.flatten_mjai_log(data.mjai_log);
  const startPositions = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "start_kyoku") startPositions.push(i);
  }
  const expected = pyExpected(rel);
  for (const ke of expected) {
    const ki = ke.kyoku_idx;
    const start_pos = startPositions[ki];
    const end_pos = ki + 1 < startPositions.length ? startPositions[ki + 1] : events.length;
    for (const cp of ke.checkpoints) {
      const tl = cp.tiles_left_target;

      const bsJs = board.extract_board_state(data, ki, tl);
      totalChecks++;
      const d1 = diffPath(bsJs, cp.board_state, `${rel}#k${ki}@${tl} board_state`);
      if (d1) { totalFail++; failures.push(d1); }

      const ctx = board.reconstruct_context(data, ki, tl);
      const ctxExpected = {
        wall: cp.wall,
        round_wind_id: cp.round_wind_id,
        seat_wind_id: cp.seat_wind_id,
        dora_ids: cp.dora_ids,
        tiles_left: cp.wall_tiles_left,
      };
      totalChecks++;
      const d2 = diffPath(ctx, ctxExpected, `${rel}#k${ki}@${tl} reconstruct_context`);
      if (d2) { totalFail++; failures.push(d2); }

      const walkJs = parse.walk_kyoku(events, start_pos, end_pos, data.player_id, tl);
      // Python returns opponents keyed by int actor; expected is keyed by string
      // (json.dump converts int keys to strings). Normalize both sides to string keys.
      const walkExpected = cp.walk;
      const walkJsNormalized = {
        opponents: {},
        player_tsumo_riichi_state: walkJs.player_tsumo_riichi_state,
        genbutsu_post_reach_by_seat: {},
        first_dora_indicator: walkJs.first_dora_indicator,
        tiles_left_at_end: walkJs.tiles_left_at_end,
      };
      for (const k of Object.keys(walkJs.opponents)) {
        walkJsNormalized.opponents[String(k)] = walkJs.opponents[k];
      }
      for (const k of Object.keys(walkJs.genbutsu_post_reach_by_seat)) {
        walkJsNormalized.genbutsu_post_reach_by_seat[String(k)] = walkJs.genbutsu_post_reach_by_seat[k];
      }
      totalChecks++;
      const d3 = diffPath(walkJsNormalized, walkExpected, `${rel}#k${ki}@${tl} walk_kyoku`);
      if (d3) { totalFail++; failures.push(d3); }
    }
  }
}

// Furiten: synthesize a few hands and diff against Python.
function pyFuriten(cases) {
  const py = `
import json, sys
from lib.furiten import tenpai_waits, tenpai_wait_tiles, is_furiten
cases = json.loads("""${JSON.stringify(cases).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}""")
out = []
for c in cases:
  hand = c["hand"]
  melds = c["melds"]
  wall = c.get("wall")
  discards = c.get("discards", [])
  out.append({
    "waits_ids": tenpai_waits(hand, melds),
    "waits_with_count": tenpai_wait_tiles(hand, melds, wall) if wall is not None else None,
    "furiten": is_furiten(hand, melds, discards),
  })
json.dump(out, sys.stdout)
`;
  const buf = execFileSync(".venv/bin/python", ["-c", py], {
    cwd: repoRoot,
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(buf.toString("utf8"));
}

const furitenCases = [
  // Pinfu-ish ryanmen wait 4-7m
  { hand: ["1m","2m","3m","5m","6m","2p","3p","4p","6s","7s","8s","E","E"], melds: [], discards: [] },
  // Same hand but with 7m already in discards → furiten on 7m
  { hand: ["1m","2m","3m","5m","6m","2p","3p","4p","6s","7s","8s","E","E"], melds: [], discards: ["7m"] },
  // Chiitoitsu tenpai waiting on F
  { hand: ["1m","1m","3m","3m","5p","5p","7s","7s","E","E","S","S","F"], melds: [], discards: ["F"] },
  // Open hand (pon E)
  { hand: ["1m","2m","3m","4m","5m","6m","7m","8m","9m","P","P"], melds: [{type:"pon", pai:"E", consumed:["E","E"]}], discards: [] },
  // Tenpai with wall counts
  { hand: ["1m","2m","3m","5m","6m","2p","3p","4p","6s","7s","8s","E","E"], melds: [],
    wall: Array.from({length: 37}, (_, i) => i < 34 ? 4 : 1), discards: [] },
];

const expectedFuriten = pyFuriten(furitenCases);
for (let i = 0; i < furitenCases.length; i++) {
  const c = furitenCases[i];
  const e = expectedFuriten[i];

  const jsWaits = furiten.tenpai_waits(c.hand, c.melds);
  totalChecks++;
  const d1 = diffPath(jsWaits, e.waits_ids, `furiten[${i}].waits_ids`);
  if (d1) { totalFail++; failures.push(d1); }

  if (c.wall) {
    const jsWaitTiles = furiten.tenpai_wait_tiles(c.hand, c.melds, c.wall);
    totalChecks++;
    const d2 = diffPath(jsWaitTiles, e.waits_with_count, `furiten[${i}].waits_with_count`);
    if (d2) { totalFail++; failures.push(d2); }
  }

  const jsFuriten = furiten.is_furiten(c.hand, c.melds, c.discards);
  totalChecks++;
  const d3 = diffPath(jsFuriten, e.furiten, `furiten[${i}].is_furiten`);
  if (d3) { totalFail++; failures.push(d3); }
}

console.log(`checks=${totalChecks} pass=${totalChecks - totalFail} fail=${totalFail}`);
if (failures.length) {
  console.log("first failures:");
  for (const f of failures.slice(0, 10)) console.log("  " + f);
  process.exit(1);
}
