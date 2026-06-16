#!/usr/bin/env node
// Collect REAL closed 14-tile hands the prep pipeline feeds, with the WASM
// adapter's full per-discard table, for ground-truth checking by gt_realhands.py.
//   node scripts/gt_realhands_gen.mjs [--target 2000] > /tmp/gt_real.json

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
const BASE = { "1m":0,"2m":1,"3m":2,"4m":3,"5m":4,"6m":5,"7m":6,"8m":7,"9m":8,"1p":9,"2p":10,"3p":11,"4p":12,"5p":13,"6p":14,"7p":15,"8p":16,"9p":17,"1s":18,"2s":19,"3s":20,"4s":21,"5s":22,"6s":23,"7s":24,"8s":25,"9s":26,"E":27,"S":28,"W":29,"N":30,"P":31,"F":32,"C":33,"5mr":4,"5pr":13,"5sr":22 };
const baseOf = (mjai) => BASE[mjai] ?? BASE[mjai.replace(/r$/, "")];

const inputs = [];
mShanten.calculate = function (h, m, w) { if (!m || !m.length) inputs.push(h.slice()); return origCalc.call(this, h, m, w); };
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

const out = [];
for (const hand of inputs) {
  const counts = new Array(34).fill(0); let bad = false;
  for (const t of hand) { const b = baseOf(t); if (b == null) { bad = true; break; } counts[b]++; }
  if (bad || counts.reduce((a, b) => a + b, 0) !== 14) continue;
  let res; try { res = adapter.calculate(hand, [], null); } catch (e) { if (e && e.code === "winning") continue; else continue; }
  const stats = res.stats.map(s => ({ d: baseOf(s.tile), sh: s.shanten, uke: s.necessary_tiles.map(n => BASE[n.tile]).sort((a, b) => a - b) }));
  out.push({ counts, stats });
}
process.stdout.write(JSON.stringify(out));
