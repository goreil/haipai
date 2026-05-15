#!/usr/bin/env node
// Diff JS prep (static/js/prep/prep.js) against the Python ground truth in
// tests/fixtures/prep_parity.json (built by scripts/sample_prep_fixture.py).
//
// For each mistake the fixture has {mistake, kyoku_idx, entry,
// expected_prep} alongside the per-game mortal_data. We re-run JS
// prepMistake on the same inputs and diff the resulting patch field by
// field. Tolerates the same ~0.01 floating-point drift as smoke_step3.
//
// Usage: node scripts/verify_prep_js.mjs [path/to/fixture.json]

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const prep = require(resolve(repoRoot, "static/js/prep/prep.js"));
const parseMod = require(resolve(repoRoot, "static/js/prep/parse.js"));

const fixturePath = resolve(repoRoot,
  process.argv[2] || "tests/fixtures/prep_parity.json");
const fx = JSON.parse(readFileSync(fixturePath, "utf8"));
console.log(`Loaded ${fx.n_mistakes} mistakes across ${fx.n_games} games`);

// Round numbers the same way safety_ratings / dealin_rates were rounded
// on the Python side, so JSON-shape comparison works for cheap cases.
const FLOAT_TOL = 0.011;

function diffPath(a, b, prefix = "") {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < FLOAT_TOL ? null : `${prefix}: ${a} vs ${b}`;
  }
  if (a == null || b == null) {
    return `${prefix}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return `${prefix}: type ${typeof a} vs ${typeof b}`;
    }
    if (a.length !== b.length) {
      return `${prefix}.length: ${a.length} vs ${b.length}`;
    }
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

let total = 0, fail = 0, threw = 0, pyErrored = 0;
const fieldFails = new Map();    // top-level field -> count
const fieldSamples = new Map();  // top-level field -> [{mistake_id, diff}]
const allFailures = [];

for (const game of fx.games) {
  const mortalData = game.mortal_data;
  const events = parseMod.flatten_mjai_log(mortalData.mjai_log);
  const startPositions = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i] && events[i].type === "start_kyoku") startPositions.push(i);
  }
  const playerId = mortalData.player_id;

  for (const m of game.mistakes) {
    if (m.expected_prep && m.expected_prep.__error__) {
      pyErrored++;
      continue;
    }
    total++;

    const ki = m.kyoku_idx;
    const start_pos = startPositions[ki];
    const end_pos = ki + 1 < startPositions.length
      ? startPositions[ki + 1] : events.length;
    const defenseCtx = {
      mjai_events: events, start_pos, end_pos, player_id: playerId,
    };

    let actual;
    try {
      actual = prep.prepMistake(m.mistake, mortalData, ki, m.entry, defenseCtx);
    } catch (e) {
      threw++;
      fail++;
      const tag = `THREW: ${e.message}`;
      allFailures.push({
        mistake_id: m.mistake_id, game_id: game.game_id, diff: tag,
      });
      continue;
    }

    // Diff each top-level field independently so one bad field doesn't
    // hide regressions in others. Counts a mistake as "failed" once even
    // if multiple fields drift.
    const expected = m.expected_prep || {};
    const allKeys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    let mistakeFailed = false;
    for (const field of allKeys) {
      const d = diffPath(actual[field], expected[field],
        `g${game.game_id}/k${ki}/m${m.mistake_id}.${field}`);
      if (!d) continue;
      mistakeFailed = true;
      fieldFails.set(field, (fieldFails.get(field) || 0) + 1);
      if (!fieldSamples.has(field)) fieldSamples.set(field, []);
      if (fieldSamples.get(field).length < 3) {
        fieldSamples.get(field).push({
          mistake_id: m.mistake_id, game_id: game.game_id, diff: d,
          py: expected[field], js: actual[field],
        });
      }
      allFailures.push({
        mistake_id: m.mistake_id, game_id: game.game_id, diff: d,
      });
    }
    if (mistakeFailed) fail++;
  }
}

const pass = total - fail;
const pct = total === 0 ? 0 : (pass / total) * 100;
console.log(
  `\nprep parity: ${pass}/${total} (${pct.toFixed(2)}%)  ` +
  `failures=${fail}  js_threw=${threw}  py_errored_skipped=${pyErrored}`
);

if (fieldFails.size) {
  console.log(`\nMismatches by field:`);
  const sorted = [...fieldFails.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`  ${k}: ${v}`);

  console.log(`\nFirst samples per field:`);
  for (const [field, samples] of fieldSamples) {
    console.log(`\n  ${field}:`);
    for (const s of samples) {
      console.log(`    m=${s.mistake_id} g=${s.game_id}`);
      console.log(`      diff: ${s.diff}`);
      const py = JSON.stringify(s.py);
      const js = JSON.stringify(s.js);
      console.log(`      py:   ${py && py.length > 200 ? py.slice(0, 200) + "…" : py}`);
      console.log(`      js:   ${js && js.length > 200 ? js.slice(0, 200) + "…" : js}`);
    }
  }
}

process.exit(fail === 0 ? 0 : 1);
