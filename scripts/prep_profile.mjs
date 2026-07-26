#!/usr/bin/env node
// Where does trends category analysis spend its time?
//
// The trends page re-runs, per game, the same three steps this script times:
//   1. prepGame   — shanten/ukeire + board reconstruction + defense + yaku
//   2. categorize — static/js/categorize.js
//   3. decision_counts_for_game — the EV/D denominators
// CLAUDE.md pegs prep at ~700ms/game, so it's the suspect. This breaks prep
// down by sub-component to answer one question before anyone ports a wasm
// shanten lib (e.g. riichi-tools-rs): what fraction of total time is actually
// the per-discard ukeire table (shanten_calc.calculate)? That fraction is the
// Amdahl ceiling on what a faster shanten kernel can buy.
//
// It wraps each prep leaf module's exports with a stack-aware SELF timer
// (nested instrumented calls are subtracted out, so buckets don't double
// count) BEFORE requiring prep.js — CommonJS caches modules by path, so
// prep.js destructures the already-wrapped functions. Runs against the same
// frozen snapshot as category_bench.mjs.
//
// Usage:
//   node scripts/prep_profile.mjs              # ~400 mistakes (fast)
//   node scripts/prep_profile.mjs --target 2000

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v;
};
const target = Number(opt("--target", 400));
const dbPath = join(repoRoot, ".cache", "category-stats", "games.db");
const mortalDir = join(repoRoot, ".cache", "category-stats");
if (!existsSync(dbPath)) {
  console.error(`Snapshot not found: ${dbPath}\nSync it once with: node scripts/category_stats.mjs --prod`);
  process.exit(1);
}

// --- stack-aware self-timer ---------------------------------------------
// buckets[name] = { self, incl, calls }. self subtracts time spent in any
// deeper instrumented frame, so summing self across buckets never exceeds
// the real wall time and reveals the uninstrumented "glue" as the remainder.
const buckets = new Map();
const frameStack = [];
const now = () => process.hrtime.bigint();
function bucket(name) {
  if (!buckets.has(name)) buckets.set(name, { self: 0n, incl: 0n, calls: 0 });
  return buckets.get(name);
}
function wrap(obj, fnName, name) {
  const orig = obj[fnName];
  if (typeof orig !== "function") throw new Error(`no fn ${fnName} to wrap`);
  obj[fnName] = function (...a) {
    const frame = { child: 0n };
    frameStack.push(frame);
    const t0 = now();
    try {
      return orig.apply(this, a);
    } finally {
      const elapsed = now() - t0;
      frameStack.pop();
      const b = bucket(name);
      b.self += elapsed - frame.child;
      b.incl += elapsed;
      b.calls += 1;
      if (frameStack.length) frameStack[frameStack.length - 1].child += elapsed;
    }
  };
}

// --- instrument leaf modules BEFORE prep.js captures them ----------------
const P = (f) => join(repoRoot, "static/js/prep", f);
const mBoardState = require(P("prep-board-state.js"));
const mDefense = require(P("defense.js"));
const mYaku = require(P("prep-board-yaku.js"));
const mFuriten = require(P("furiten.js"));
const mShanten = require(P("shanten_calc.js"));
const mParse = require(P("parse.js"));

wrap(mShanten, "calculate", "shanten/ukeire (calculate)");
wrap(mBoardState, "reconstruct_context", "board_state");
wrap(mBoardState, "extract_board_state", "board_state");
wrap(mBoardState, "subtract_hand_from_wall", "board_state");
wrap(mDefense, "compute_kd_defense_data", "defense (KD)");
wrap(mYaku, "compute_yaku_panel", "yaku panel");
wrap(mFuriten, "tenpai_wait_tiles", "furiten/waits");
wrap(mFuriten, "is_furiten", "furiten/waits");
wrap(mParse, "flatten_mjai_log", "parse (flatten log)");

// Now require the consumers — they destructure the wrapped fns.
const { prepGame } = require(P("prep.js"));
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));
const { decision_counts_for_game } = mParse;

// --- sample the frozen snapshot (mirrors category_bench.mjs) -------------
let warnCount = 0;
const realWarn = console.warn;
console.warn = () => { warnCount++; };

const db = new DatabaseSync(dbPath, { readOnly: true });
const games = db.prepare(
  "SELECT id, mortal_file, rounds_json FROM games ORDER BY id"
).all();
const mistakeStmt = db.prepare(
  "SELECT id, round_name, round_idx, mistake_idx, data_json, ev_loss, turn " +
  "FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx"
);
const mistakeCounts = new Map(
  db.prepare("SELECT game_id, COUNT(*) AS c FROM mistakes GROUP BY game_id")
    .all().map(r => [r.game_id, r.c])
);
const totalMistakes = [...mistakeCounts.values()].reduce((a, b) => a + b, 0);
const avg = totalMistakes / games.length || 1;
const stride = Math.max(1, Math.floor(games.length / Math.ceil(target / avg)));
const sampled = [];
let sampledMistakes = 0;
for (let i = 0; i < games.length && sampledMistakes < target; i += stride) {
  sampled.push(games[i]);
  sampledMistakes += mistakeCounts.get(games[i].id) || 0;
}

function reconstructGame(g) {
  const meta = g.rounds_json ? JSON.parse(g.rounds_json) : [];
  const roundsMap = new Map();
  for (const r of mistakeStmt.all(g.id)) {
    if (!roundsMap.has(r.round_idx)) roundsMap.set(r.round_idx, { round: r.round_name, mistakes: [] });
    const m = JSON.parse(r.data_json);
    m.id = r.id; m.ev_loss = r.ev_loss; m.turn = r.turn;
    roundsMap.get(r.round_idx).mistakes.push(m);
  }
  const rounds = meta.map((rm, idx) => ({ ...(roundsMap.get(idx) || { mistakes: [] }), round: rm.round_name }));
  for (const idx of [...roundsMap.keys()].sort((a, b) => a - b)) {
    if (idx >= rounds.length) rounds.push(roundsMap.get(idx));
  }
  return { id: g.id, date: g.date, rounds };
}

// --- run the real trends per-game pipeline -------------------------------
let prepNs = 0n, catNs = 0n, dcNs = 0n;
let nGames = 0, nMistakes = 0, skipped = 0;
const t0wall = now();
for (const g of sampled) {
  const mortalPath = g.mortal_file ? join(mortalDir, g.mortal_file) : null;
  if (!mortalPath || !existsSync(mortalPath)) { skipped++; continue; }
  let mortal;
  try { mortal = JSON.parse(readFileSync(mortalPath, "utf8")); }
  catch { skipped++; continue; }
  const game = reconstructGame(g);

  let t = now();
  try { prepGame(game, mortal); }
  catch { skipped++; continue; }
  prepNs += now() - t;

  t = now();
  for (const rnd of game.rounds) for (const m of rnd.mistakes || []) { categorize(m); nMistakes++; }
  catNs += now() - t;

  t = now();
  try { decision_counts_for_game(mortal); } catch { /* ignore */ }
  dcNs += now() - t;

  nGames++;
}
const wallNs = now() - t0wall;
db.close();
console.warn = realWarn;

// --- report --------------------------------------------------------------
const ms = (ns) => Number(ns) / 1e6;
const pct = (ns, of) => of > 0n ? (Number(ns) / Number(of) * 100).toFixed(1) + "%" : "—";
const perGame = (ns) => (ms(ns) / (nGames || 1)).toFixed(1);

console.log(`\nProfiled ${nGames} games (${skipped} skipped), ${nMistakes} mistakes` +
  ` — ${warnCount} prep warnings suppressed`);
console.log(`Wall (read+prep+categorize+decisions): ${ms(wallNs).toFixed(0)}ms` +
  `  =  ${(ms(wallNs) / (nGames || 1)).toFixed(1)}ms/game\n`);

console.log("TOP-LEVEL STAGE                         total      /game     % wall");
console.log("-".repeat(68));
const stage = (label, ns) =>
  console.log(label.padEnd(38) + `${ms(ns).toFixed(0).padStart(7)}ms` +
    `${perGame(ns).padStart(9)}ms` + `${pct(ns, wallNs).padStart(9)}`);
stage("prepGame", prepNs);
stage("categorize", catNs);
stage("decision_counts_for_game", dcNs);
const readNs = wallNs - prepNs - catNs - dcNs;
stage("read+parse mortal JSON + glue", readNs);

console.log(`\nINSIDE prepGame — self time by component   total      calls    % prep`);
console.log("-".repeat(68));
const rows = [...buckets.entries()].sort((a, b) => Number(b[1].self - a[1].self));
let sumSelf = 0n;
for (const [name, b] of rows) {
  sumSelf += b.self;
  console.log(name.padEnd(38) + `${ms(b.self).toFixed(0).padStart(7)}ms` +
    `${String(b.calls).padStart(9)}` + `${pct(b.self, prepNs).padStart(9)}`);
}
const glueNs = prepNs - sumSelf;
console.log("(prep glue: walking, matching, JS)".padEnd(38) +
  `${ms(glueNs).toFixed(0).padStart(7)}ms` + `${"".padStart(9)}` + `${pct(glueNs, prepNs).padStart(9)}`);

const shanten = buckets.get("shanten/ukeire (calculate)") || { self: 0n, calls: 0 };
console.log(`\n→ Shanten/ukeire is ${pct(shanten.self, wallNs)} of total wall time, ` +
  `${pct(shanten.self, prepNs)} of prep (${shanten.calls} calls, ` +
  `${(ms(shanten.self) / (shanten.calls || 1)).toFixed(2)}ms each).`);
console.log(`   A wasm shanten kernel can save AT MOST that ${pct(shanten.self, wallNs)} ` +
  `of wall — likely less after JS↔wasm marshalling.\n`);
