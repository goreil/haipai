#!/usr/bin/env node
// End-to-end speedup of the WASM adapter (with JS fallback) vs the pure-JS
// kernel, over the REAL hands prep feeds — the honest number, since ~20% of
// calls fall back to JS. Collects inputs from the snapshot, then times both.
//   node scripts/wasm_adapter_bench.mjs [--target 2000] [--reps 3]

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : Number(process.argv[i + 1]); };
const target = arg("--target", 2000), reps = arg("--reps", 3);

const P = (f) => join(repoRoot, "static/js/prep", f);
const mShanten = require(P("shanten_calc.js"));
const origCalc = mShanten.calculate;
const inputs = [];
mShanten.calculate = function (h, m, w) { inputs.push({ hand: h.slice(), melds: m ? m.slice() : m, wall: w ? w.slice() : w }); return origCalc.call(this, h, m, w); };
const { prepGame } = require(P("prep.js"));

const dbPath = join(repoRoot, ".cache", "category-stats", "games.db");
const mortalDir = join(repoRoot, ".cache", "category-stats");
const realWarn = console.warn; console.warn = () => {};
const db = new DatabaseSync(dbPath, { readOnly: true });
const games = db.prepare("SELECT id, mortal_file, rounds_json FROM games ORDER BY id").all();
const mistakeStmt = db.prepare("SELECT id, round_name, round_idx, mistake_idx, data_json, ev_loss, turn FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx");
const mistakeCounts = new Map(db.prepare("SELECT game_id, COUNT(*) AS c FROM mistakes GROUP BY game_id").all().map(r => [r.game_id, r.c]));
const avg = ([...mistakeCounts.values()].reduce((a, b) => a + b, 0) / games.length) || 1;
const stride = Math.max(1, Math.floor(games.length / Math.ceil(target / avg)));
function reconstruct(g) {
  const meta = g.rounds_json ? JSON.parse(g.rounds_json) : [];
  const map = new Map();
  for (const r of mistakeStmt.all(g.id)) {
    if (!map.has(r.round_idx)) map.set(r.round_idx, { round: r.round_name, mistakes: [] });
    const m = JSON.parse(r.data_json); m.id = r.id; m.ev_loss = r.ev_loss; m.turn = r.turn;
    map.get(r.round_idx).mistakes.push(m);
  }
  const rounds = meta.map((rm, idx) => ({ ...(map.get(idx) || { mistakes: [] }), round: rm.round_name }));
  for (const idx of [...map.keys()].sort((a, b) => a - b)) if (idx >= rounds.length) rounds.push(map.get(idx));
  return { id: g.id, rounds };
}
let sm = 0;
for (let i = 0; i < games.length && sm < target; i += stride) {
  const g = games[i];
  const mp = g.mortal_file ? join(mortalDir, g.mortal_file) : null;
  if (!mp || !existsSync(mp)) continue;
  let mortal; try { mortal = JSON.parse(readFileSync(mp, "utf8")); } catch { continue; }
  try { prepGame(reconstruct(g), mortal); } catch {}
  sm += mistakeCounts.get(g.id) || 0;
}
db.close(); console.warn = realWarn;
mShanten.calculate = origCalc;
const adapter = require(P("shanten_calc_wasm.js"));

const safe = (fn, inp) => { try { return fn(inp.hand, inp.melds, inp.wall); } catch { return null; } };
for (const inp of inputs) { safe(origCalc, inp); safe(adapter.calculate, inp); } // warm
const now = () => process.hrtime.bigint();
let jsNs = 0n, waNs = 0n;
for (let r = 0; r < reps; r++) {
  let t = now(); for (const inp of inputs) safe(origCalc, inp); jsNs += now() - t;
  t = now(); for (const inp of inputs) safe(adapter.calculate, inp); waNs += now() - t;
}
const ms = (ns) => Number(ns) / 1e6;
const n = inputs.length * reps;
const jsPer = ms(jsNs) / n, waPer = ms(waNs) / n;
console.log(`\nReal prep hands: ${inputs.length} x ${reps} reps`);
console.log(`JS kernel:       ${jsPer.toFixed(3)} ms/call`);
console.log(`WASM adapter:    ${waPer.toFixed(3)} ms/call  (JS fallback: open hands + rare quads)`);
console.log(`→ end-to-end ${(jsPer / waPer).toFixed(1)}x faster on real hands\n`);
