#!/usr/bin/env node
// Ukeire parity gate: WASM (riichi-tools-rs) vs JS (shanten_calc.calculate) on
// the REAL hands the prep pipeline feeds, pulled from the frozen snapshot.
//
// It wraps shanten_calc.calculate, runs the actual prepGame pipeline (like
// prep_profile.mjs), and for every CLOSED-hand call compares:
//   - best shanten
//   - the set of best-shanten discards
//   - per discard, the set of improving (ukeire) tiles
//   - per discard, the wall-weighted necessary_count (re-derived from the WASM
//     improving set using the SAME wall prep passed JS) — proves that swapping
//     the kernel but keeping JS wall-weighting yields identical counts.
//
// Open hands (melds) are counted but skipped (meld notation parity is separate).
//
//   node scripts/wasm_ukeire_parity.mjs [--target 2000]

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = Number((() => { const i = args.indexOf("--target"); return i < 0 ? 2000 : args[i + 1]; })());

const wasm = require(join(repoRoot, "wasm/haipai-shanten/pkg/haipai_shanten.js"));

const MJAI_TO_BASE = {
  "1m":0,"2m":1,"3m":2,"4m":3,"5m":4,"6m":5,"7m":6,"8m":7,"9m":8,
  "1p":9,"2p":10,"3p":11,"4p":12,"5p":13,"6p":14,"7p":15,"8p":16,"9p":17,
  "1s":18,"2s":19,"3s":20,"4s":21,"5s":22,"6s":23,"7s":24,"8s":25,"9s":26,
  "E":27,"S":28,"W":29,"N":30,"P":31,"F":32,"C":33,
  "5mr":4,"5pr":13,"5sr":22,
};
const BASE_TO_MJAI = [
  "1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p","5p","6p","7p","8p","9p",
  "1s","2s","3s","4s","5s","6s","7s","8s","9s","E","S","W","N","P","F","C",
];
const SUIT_CH = ["m","p","s"];
const tileId1ToBase = (id) => id - 1;        // wasm get_id is 1-based
const stripRed = (name) => name.replace(/r$/, "");

function mjaiListToText(list) {
  const counts = new Array(34).fill(0);
  for (const t of list) counts[MJAI_TO_BASE[t]]++;
  let text = "";
  for (let s = 0; s < 3; s++) {
    let d = "";
    for (let n = 1; n <= 9; n++) for (let k = 0; k < counts[s*9+(n-1)]; k++) d += n;
    if (d) text += d + SUIT_CH[s];
  }
  let h = "";
  for (let i = 0; i < 7; i++) for (let k = 0; k < counts[27+i]; k++) h += (i+1);
  if (h) text += h + "z";
  return text;
}
const _wall_count = (wall, b) => (!wall || b >= wall.length) ? 0 : (wall[b] || 0);
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

// --- counters ------------------------------------------------------------
let closed = 0, open = 0, winningSkip = 0, parseSkip = 0;
let shMis = 0, discMis = 0, ukeMis = 0, countMis = 0, fullMatch = 0;
const examples = [];

function compare(handMjai, melds, wall, jsResult) {
  if (melds && melds.length) { open++; return; }
  closed++;
  const text = mjaiListToText(handMjai);
  let w;
  try { w = JSON.parse(wasm.ukeire_from_text(text)); }
  catch { parseSkip++; return; }
  if (w.error) { parseSkip++; return; }

  // JS best-shanten discards
  const jsBest = jsResult.shanten;
  const jsDiscards = new Map();   // baseName -> {improving:Set, count:Number}
  for (const s of jsResult.stats) {
    if (s.shanten !== jsBest) continue;
    jsDiscards.set(stripRed(s.tile), {
      improving: new Set(s.necessary_tiles.map(n => n.tile)),
      count: s.necessary_count,
    });
  }
  // WASM discards (all are best-shanten). discard null => 13-tile (shouldn't
  // happen for closed 14-tile input, but guard anyway).
  const wDiscards = new Map();
  for (const st of w.stats) {
    const name = st.discard == null ? "(none)" : BASE_TO_MJAI[tileId1ToBase(st.discard)];
    wDiscards.set(name, new Set(st.tiles.map(([id]) => BASE_TO_MJAI[tileId1ToBase(id)])));
  }

  let ok = true;
  if (w.shanten !== jsBest) { shMis++; ok = false; }
  if (!setEq(new Set(jsDiscards.keys()), new Set(wDiscards.keys()))) { discMis++; ok = false; }

  // per-discard improving set + re-derived wall-weighted count
  for (const [name, wSet] of wDiscards) {
    const js = jsDiscards.get(name);
    if (!js) continue;
    if (!setEq(js.improving, wSet)) { ukeMis++; ok = false; }
    // re-derive count from WASM set using the SAME wall prep gave JS
    let wCount = 0;
    for (const t of wSet) wCount += _wall_count(wall, MJAI_TO_BASE[t]);
    if (wCount !== js.count) { countMis++; ok = false; }
  }

  if (ok) fullMatch++;
  else if (examples.length < 8) examples.push({ text, jsBest, wSh: w.shanten,
    jsD: [...jsDiscards.keys()].sort(), wD: [...wDiscards.keys()].sort() });
}

// --- instrument calculate, then run the real pipeline --------------------
const P = (f) => join(repoRoot, "static/js/prep", f);
const mShanten = require(P("shanten_calc.js"));
const origCalc = mShanten.calculate;
mShanten.calculate = function (handMjai, melds, wall) {
  let res;
  try { res = origCalc.call(this, handMjai, melds, wall); }
  catch (e) { if (e && e.code === "winning") winningSkip++; throw e; }
  try { compare(handMjai, melds, wall, res); } catch { /* never break prep */ }
  return res;
};

const { prepGame } = require(P("prep.js"));

const dbPath = join(repoRoot, ".cache", "category-stats", "games.db");
const mortalDir = join(repoRoot, ".cache", "category-stats");
if (!existsSync(dbPath)) { console.error(`Snapshot not found: ${dbPath}`); process.exit(1); }

const realWarn = console.warn; console.warn = () => {};
const db = new DatabaseSync(dbPath, { readOnly: true });
const games = db.prepare("SELECT id, mortal_file, rounds_json FROM games ORDER BY id").all();
const mistakeStmt = db.prepare(
  "SELECT id, round_name, round_idx, mistake_idx, data_json, ev_loss, turn FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx");
const mistakeCounts = new Map(
  db.prepare("SELECT game_id, COUNT(*) AS c FROM mistakes GROUP BY game_id").all().map(r => [r.game_id, r.c]));
const avg = ([...mistakeCounts.values()].reduce((a,b)=>a+b,0) / games.length) || 1;
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
  for (const idx of [...map.keys()].sort((a,b)=>a-b)) if (idx >= rounds.length) rounds.push(map.get(idx));
  return { id: g.id, rounds };
}

let sampledMistakes = 0;
for (let i = 0; i < games.length && sampledMistakes < target; i += stride) {
  const g = games[i];
  const mortalPath = g.mortal_file ? join(mortalDir, g.mortal_file) : null;
  if (!mortalPath || !existsSync(mortalPath)) continue;
  let mortal; try { mortal = JSON.parse(readFileSync(mortalPath, "utf8")); } catch { continue; }
  try { prepGame(reconstruct(g), mortal); } catch { /* keep going */ }
  sampledMistakes += mistakeCounts.get(g.id) || 0;
}
db.close(); console.warn = realWarn;

// --- report --------------------------------------------------------------
console.log(`\nCLOSED-hand calculate() calls compared: ${closed}  (open skipped: ${open}, parse skip: ${parseSkip})`);
console.log("-".repeat(60));
console.log(`shanten mismatches:        ${shMis}`);
console.log(`discard-set mismatches:    ${discMis}`);
console.log(`improving-set mismatches:  ${ukeMis}`);
console.log(`wall-weighted count diffs: ${countMis}`);
console.log(`fully-identical calls:     ${fullMatch}/${closed}` +
  (closed ? `  (${(100*fullMatch/closed).toFixed(2)}%)` : ""));
if (examples.length) {
  console.log("\nfirst mismatches:");
  for (const e of examples)
    console.log(`  ${e.text}  jsSh=${e.jsBest} wSh=${e.wSh}\n    jsDisc=${e.jsD.join(",")}\n    wDisc =${e.wD.join(",")}`);
}
console.log(fullMatch === closed
  ? "\n✓ Full ukeire parity on every closed hand.\n"
  : `\n✗ ${closed - fullMatch} closed hand(s) differ.\n`);
