#!/usr/bin/env node
// Residual parity of the WASM adapter (shanten_calc_wasm.js) vs the pure-JS
// kernel on real snapshot hands. Two phases to avoid recursion (the adapter
// falls back INTO shanten_calc.calculate):
//   1. collect every (hand, melds, wall) the real prepGame pipeline feeds
//   2. replay each through origCalc vs adapter.calculate and diff full output
//   node scripts/wasm_adapter_parity.mjs [--target 2000]

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = Number((() => { const i = process.argv.indexOf("--target"); return i < 0 ? 2000 : process.argv[i + 1]; })());

const P = (f) => join(repoRoot, "static/js/prep", f);
const mShanten = require(P("shanten_calc.js"));
const origCalc = mShanten.calculate;

// --- phase 1: collect inputs (orig stays live, no adapter call here) ------
const inputs = [];
mShanten.calculate = function (handMjai, melds, wall) {
  inputs.push({ hand: handMjai.slice(), melds: melds ? melds.slice() : melds, wall: wall ? wall.slice() : wall });
  return origCalc.call(this, handMjai, melds, wall);
};

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
mShanten.calculate = origCalc;  // restore BEFORE requiring the adapter

// --- phase 2: replay & diff ----------------------------------------------
const adapter = require(P("shanten_calc_wasm.js"));
const BASE = { "1m":0,"2m":1,"3m":2,"4m":3,"5m":4,"6m":5,"7m":6,"8m":7,"9m":8,"1p":9,"2p":10,"3p":11,"4p":12,"5p":13,"6p":14,"7p":15,"8p":16,"9p":17,"1s":18,"2s":19,"3s":20,"4s":21,"5s":22,"6s":23,"7s":24,"8s":25,"9s":26,"E":27,"S":28,"W":29,"N":30,"P":31,"F":32,"C":33,"5mr":4,"5pr":13,"5sr":22 };
function stat_eq(a, b) {
  if (a.tile !== b.tile || a.shanten !== b.shanten || a.necessary_count !== b.necessary_count) return false;
  const sa = new Set(a.necessary_tiles.map(n => n.tile + ":" + n.count));
  const sb = new Set(b.necessary_tiles.map(n => n.tile + ":" + n.count));
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}
function text(hand) {
  const c = new Array(34).fill(0); for (const t of hand) c[BASE[t]]++;
  const SU = ["m", "p", "s"]; let s = "";
  for (let k = 0; k < 3; k++) { let d = ""; for (let n = 1; n <= 9; n++) for (let j = 0; j < c[k*9+(n-1)]; j++) d += n; if (d) s += d + SU[k]; }
  let h = ""; for (let i = 0; i < 7; i++) for (let j = 0; j < c[27+i]; j++) h += (i+1); if (h) s += h + "z";
  return s;
}
let total = 0, fallbacks = 0, fullMatch = 0, mism = 0;
const examples = [];
for (const inp of inputs) {
  let js;
  try { js = origCalc(inp.hand, inp.melds, inp.wall); }
  catch (e) { if (e && e.code === "winning") continue; else throw e; }
  total++;
  const isOpen = inp.melds && inp.melds.length;
  const c = new Array(34).fill(0); for (const t of inp.hand) c[BASE[t]]++;
  let pairs = 0, uniq = 0, quad = false;
  for (let b = 0; b < 34; b++) if (c[b]) { uniq++; if (c[b] >= 2) pairs++; if (c[b] === 4) quad = true; }
  if (isOpen || quad || pairs >= 5) fallbacks++;
  let wa;
  try { wa = adapter.calculate(inp.hand, inp.melds, inp.wall); }
  catch (e) { if (e && e.code === "winning") continue; else throw e; }
  let ok = wa.shanten === js.shanten && wa.stats.length === js.stats.length;
  if (ok) { const jm = new Map(js.stats.map(s => [s.tile, s])); for (const s of wa.stats) { const j = jm.get(s.tile); if (!j || !stat_eq(s, j)) { ok = false; break; } } }
  if (ok) fullMatch++; else { mism++; if (examples.length < 8) examples.push(text(inp.hand)); }
}

console.log(`\ncalculate() calls replayed: ${total}  (JS fallback taken: ${fallbacks}, ${(100*fallbacks/total).toFixed(1)}%)`);
console.log(`adapter output-identical to JS: ${fullMatch}/${total} (${(100*fullMatch/total).toFixed(2)}%)`);
console.log(`residual mismatches: ${mism}`);
if (examples.length) console.log("examples:", examples.join("  "));
console.log(mism === 0 ? "\n✓ Adapter matches JS on every replayed hand.\n"
  : `\n${mism} hand(s) differ — the no-clean-trigger ukeire false-positives.\n`);
