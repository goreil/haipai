// Step-3 smoke test: parity between JS prep (prep/prep.js) and the Python
// lib/categorize/__init__.py:prepare_mistake_data.
//
// Strategy: load both fixture Mortal JSONs, walk every non-equal entry,
// synthesize a mistake dict (hand/melds/actual/expected/turn) from the
// entry's state, run Python's prepare_mistake_data and JS's prepMistake on
// the same inputs, then diff the resulting patches.
//
// Usage: node scripts/smoke_step3.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const prep = require(path.join(repoRoot, "static/js/prep/prep.js"));
const parseMod = require(path.join(repoRoot, "static/js/prep/parse.js"));

const fixtures = [
  "tests/fixtures/game_short.json",
  "tests/fixtures/game_multi_mistake.json",
];

function buildCases(fixturePath) {
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const cases = [];
  const kyokus = data.review.kyokus || [];
  for (let ki = 0; ki < kyokus.length; ki++) {
    for (const entry of (kyokus[ki].entries || [])) {
      if (entry.is_equal) continue;
      const mistake = {
        hand: (entry.state && entry.state.tehai) || [],
        melds: (entry.state && entry.state.fuuros) || [],
        actual: entry.actual || {},
        expected: entry.expected || {},
        turn: entry.junme,
      };
      cases.push({ kyoku_idx: ki, entry, mistake });
    }
  }
  return { data, cases };
}

function pyPatches(fixturePath, cases) {
  const slim = cases.map(c => ({
    kyoku_idx: c.kyoku_idx,
    tiles_left: c.entry.tiles_left,
    junme: c.entry.junme,
    mistake: c.mistake,
  }));
  const py = `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(repoRoot)})
from lib.categorize import prepare_mistake_data
from lib.parse import flatten_mjai_log

with open(${JSON.stringify(fixturePath)}) as f:
    mortal = json.load(f)
cases = json.loads(sys.stdin.read())
events = flatten_mjai_log(mortal["mjai_log"])
start_positions = [i for i, e in enumerate(events) if e.get("type") == "start_kyoku"]
player_id = mortal["player_id"]

out = []
for c in cases:
    ki = c["kyoku_idx"]
    start_pos = start_positions[ki]
    end_pos = start_positions[ki + 1] if ki + 1 < len(start_positions) else len(events)
    defense_ctx = {
        "mjai_events": events,
        "start_pos": start_pos,
        "end_pos": end_pos,
        "player_id": player_id,
    }
    kyoku = mortal["review"]["kyokus"][ki]
    entry = next(
        (e for e in kyoku["entries"]
         if not e.get("is_equal") and e.get("junme") == c["junme"]
         and e.get("tiles_left") == c["tiles_left"]),
        None,
    )
    if entry is None:
        out.append(None)
        continue
    try:
        patch = prepare_mistake_data(c["mistake"], mortal, ki, entry, defense_ctx)
    except Exception as e:
        patch = {"__error__": repr(e)}
    out.append(patch)
json.dump(out, sys.stdout)
`;
  const buf = execFileSync(".venv/bin/python", ["-c", py], {
    cwd: repoRoot,
    input: JSON.stringify(slim),
    maxBuffer: 200 * 1024 * 1024,
  });
  return JSON.parse(buf.toString("utf8"));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    // Allow tiny floating-point drift on safety / dealin / rate fields.
    return Math.abs(a - b) < 0.011;
  }
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
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.011 ? null : `${prefix}: ${a} vs ${b}`;
  }
  if (a == null || b == null) {
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
  if (typeof a === "object" && typeof b === "object") {
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
  const { data, cases } = buildCases(fixturePath);
  const events = parseMod.flatten_mjai_log(data.mjai_log);
  const startPositions = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "start_kyoku") startPositions.push(i);
  }
  const pyOut = pyPatches(fixturePath, cases);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const expected = pyOut[i];
    if (!expected || expected.__error__) continue;

    const ki = c.kyoku_idx;
    const start_pos = startPositions[ki];
    const end_pos = ki + 1 < startPositions.length
      ? startPositions[ki + 1] : events.length;
    const defenseCtx = { mjai_events: events, start_pos, end_pos, player_id: data.player_id };

    let actual;
    try {
      actual = prep.prepMistake(c.mistake, data, ki, c.entry, defenseCtx);
    } catch (e) {
      totalFail++;
      failures.push(`${rel}#k${ki}@j${c.entry.junme} JS threw: ${e.message}`);
      continue;
    }

    totalChecks++;
    const d = diffPath(actual, expected, `${rel}#k${ki}@j${c.entry.junme}`);
    if (d) {
      totalFail++;
      failures.push(d);
    }
  }
}

console.log(`checks=${totalChecks} pass=${totalChecks - totalFail} fail=${totalFail}`);
if (failures.length) {
  console.log("first failures:");
  for (const f of failures.slice(0, 20)) console.log("  " + f);
  process.exit(1);
}
