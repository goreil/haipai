#!/usr/bin/env node
// Fast categorization benchmark over a fixed ~2000-mistake sample.
//
// Same pipeline as category_stats.mjs (prepGame → categorize) but built for
// quick iteration on categorize.js / the prep defense modules:
//   - runs against the frozen prod snapshot in .cache/category-stats/
//     (sync it once with `node scripts/category_stats.mjs --prod`) — never
//     touches the prod container itself
//   - samples games deterministically until ~TARGET mistakes are covered
//   - caches the *prepped* mistakes keyed by a hash of static/js/prep/** —
//     categorize-only edits skip prep entirely (~2s); prep edits trigger one
//     automatic re-prep of the sample (~30s)
//   - prints the category table + the P4+D3 "complex decision" headline,
//     with deltas against a saved baseline
//
// Usage:
//   node scripts/category_bench.mjs              # bench current code
//   node scripts/category_bench.mjs --baseline   # also save result as baseline
//   node scripts/category_bench.mjs --target 500 # smaller/bigger sample
//   node scripts/category_bench.mjs --reprep     # force prep-cache rebuild

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- args ---
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args.splice(i, 1), true) : false;
};
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const saveBaseline = flag("--baseline");
const reprep = flag("--reprep");
const verbose = flag("--verbose");
const target = Number(opt("--target") || 2000);
const dbPath = opt("--db") || join(repoRoot, ".cache", "category-stats", "games.db");
const mortalDir = opt("--mortal-dir") || join(repoRoot, ".cache", "category-stats");
if (args.length) {
  console.error(`Unknown args: ${args.join(" ")}`);
  process.exit(2);
}

if (!existsSync(dbPath)) {
  console.error(`Snapshot not found: ${dbPath}`);
  console.error("Sync it once with: node scripts/category_stats.mjs --prod");
  process.exit(1);
}

const benchDir = join(repoRoot, ".cache", "category-bench");
mkdirSync(benchDir, { recursive: true });

// --- cache keys ---
// sampleKey: identity of the data + sample size — the baseline is only
// comparable across runs that share it.
// prepHash: everything that can change prep output. All prep deps live
// inside static/js/prep/ (verified: no requires escape the dir).
function hashDir(h, dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) hashDir(h, p);
    else { h.update(p); h.update(readFileSync(p)); }
  }
}
const sampleKey = (() => {
  const h = createHash("sha1");
  h.update(readFileSync(dbPath));
  h.update(String(target));
  return h.digest("hex").slice(0, 12);
})();
const prepHash = (() => {
  const h = createHash("sha1");
  hashDir(h, join(repoRoot, "static", "js", "prep"));
  return h.digest("hex").slice(0, 12);
})();
const cachePath = join(benchDir, `prepped-${sampleKey}-${prepHash}.json`);
const baselinePath = join(benchDir, "baseline.json");

// --- get prepped mistakes: from cache, or by running prepGame on the sample ---
let prepped; // [{game_id, m}] — m is the prepped mistake, exactly what categorize takes
if (!reprep && existsSync(cachePath)) {
  prepped = JSON.parse(readFileSync(cachePath, "utf8")).mistakes;
  console.error(`Prep cache hit (${prepped.length} mistakes, prep=${prepHash})`);
} else {
  console.error(`Prep cache miss (prep=${prepHash}) — running prepGame on the sample…`);
  const { prepGame } = require(join(repoRoot, "static/js/prep/prep.js"));

  let warnCount = 0;
  const realWarn = console.warn;
  console.warn = (...a) => { warnCount++; if (verbose) realWarn(...a); };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const games = db.prepare(
    "SELECT id, user_id, date, mortal_file, rounds_json FROM games ORDER BY id"
  ).all();
  const mistakeStmt = db.prepare(
    "SELECT id, round_name, round_idx, mistake_idx, data_json, ev_loss, turn " +
    "FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx"
  );
  const mistakeCounts = new Map(
    db.prepare("SELECT game_id, COUNT(*) AS c FROM mistakes GROUP BY game_id")
      .all().map(r => [r.game_id, r.c])
  );

  // Deterministic spread: stride over the id-ordered game list so the sample
  // covers the whole snapshot (users, dates) instead of the oldest games.
  const totalMistakes = [...mistakeCounts.values()].reduce((a, b) => a + b, 0);
  const avg = totalMistakes / games.length || 1;
  const stride = Math.max(1, Math.floor(games.length / Math.ceil(target / avg)));
  const sampled = [];
  let sampledMistakes = 0;
  for (let i = 0; i < games.length && sampledMistakes < target; i += stride) {
    sampled.push(games[i]);
    sampledMistakes += mistakeCounts.get(games[i].id) || 0;
  }

  // Mirror db/games.py::get_game (same shape category_stats.mjs rebuilds).
  function reconstructGame(g) {
    const meta = g.rounds_json ? JSON.parse(g.rounds_json) : [];
    const roundsMap = new Map();
    for (const r of mistakeStmt.all(g.id)) {
      if (!roundsMap.has(r.round_idx)) {
        roundsMap.set(r.round_idx, { round: r.round_name, mistakes: [] });
      }
      const m = JSON.parse(r.data_json);
      m.id = r.id;
      m.ev_loss = r.ev_loss;
      m.turn = r.turn;
      roundsMap.get(r.round_idx).mistakes.push(m);
    }
    const rounds = meta.map((rm, idx) => {
      const rnd = roundsMap.get(idx) || { mistakes: [] };
      return { ...rnd, round: rm.round_name };
    });
    for (const idx of [...roundsMap.keys()].sort((a, b) => a - b)) {
      if (idx >= rounds.length) rounds.push(roundsMap.get(idx));
    }
    return { id: g.id, date: g.date, rounds };
  }

  prepped = [];
  let done = 0, skipped = 0;
  for (const g of sampled) {
    done++;
    const mortalPath = g.mortal_file ? join(mortalDir, g.mortal_file) : null;
    if (!mortalPath || !existsSync(mortalPath)) { skipped++; continue; }
    const game = reconstructGame(g);
    try {
      prepGame(game, JSON.parse(readFileSync(mortalPath, "utf8")));
    } catch (e) {
      skipped++;
      if (verbose) realWarn(`prep failed for game ${g.id}:`, e.message);
      continue;
    }
    for (const rnd of game.rounds) {
      for (const m of rnd.mistakes || []) prepped.push({ game_id: g.id, m });
    }
    if (process.stderr.isTTY) {
      process.stderr.write(`\r  prepping ${done}/${sampled.length} games`);
    }
  }
  if (process.stderr.isTTY) process.stderr.write("\n");
  db.close();
  console.warn = realWarn;

  // JSON round-trip is exactly what the cached path replays, and the parity
  // fixture already relies on prepped mistakes being JSON-safe.
  writeFileSync(cachePath, JSON.stringify({ sampleKey, prepHash, mistakes: prepped }));
  prepped = JSON.parse(readFileSync(cachePath, "utf8")).mistakes;
  console.error(
    `Prepped ${sampled.length - skipped}/${sampled.length} games → ` +
    `${prepped.length} mistakes cached (${warnCount} prep warnings` +
    `${verbose ? "" : ", --verbose to see"})`
  );
}

// --- categorize ---
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));
const t0 = process.hrtime.bigint();
const byCat = new Map(); // cat -> { count, ev, games:Set }
let totalMistakes = 0, totalEv = 0;
const allGames = new Set();
for (const { game_id, m } of prepped) {
  const cat = categorize(m).category || "??";
  if (!byCat.has(cat)) byCat.set(cat, { count: 0, ev: 0, games: new Set() });
  const e = byCat.get(cat);
  e.count++;
  e.ev += m.ev_loss || 0;
  e.games.add(game_id);
  allGames.add(game_id);
  totalMistakes++;
  totalEv += m.ev_loss || 0;
}
const catMs = Number(process.hrtime.bigint() - t0) / 1e6;

// --- baseline ---
let baseline = null;
if (existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (baseline.sampleKey !== sampleKey) {
    console.error("Baseline was saved on a different sample (snapshot or " +
      "--target changed) — deltas hidden. Re-save with --baseline.");
    baseline = null;
  }
}

// --- table (same layout as category_stats.mjs, plus a Δ column) ---
const CATEGORY_INFO = JSON.parse(
  execSync(`${join(repoRoot, ".venv/bin/python")} -c ` +
    `"import json; from lib.categories import CATEGORY_INFO; print(json.dumps(CATEGORY_INFO))"`,
    { cwd: repoRoot }).toString()
);
const ORDER = ["P1", "P2", "P3", "P4", "D1", "D2", "D3",
               "4A", "4B", "4C", "5A", "5B", "6A", "6B"];
const baseCats = baseline ? Object.keys(baseline.byCat) : [];
const present = new Set([...byCat.keys(), ...baseCats]);
const cats = [...ORDER.filter(c => present.has(c)),
              ...[...present].filter(c => !ORDER.includes(c)).sort()];

const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "—";
const delta = (n) => baseline ? (n > 0 ? `+${n}` : n < 0 ? `${n}` : "·") : "";
const cols = baseline ? [4, 18, 9, 7, 6, 10, 7] : [4, 18, 9, 7, 10, 7];
const row = (cells) => cells.map((c, i) =>
  i < 2 ? String(c).padEnd(cols[i]) : String(c).padStart(cols[i])).join(" ");

console.log(`\nSample: ${allGames.size} games, ${totalMistakes} mistakes, ` +
  `EV loss ${totalEv.toFixed(1)}  (categorize: ${catMs.toFixed(0)}ms, prep=${prepHash})`);
const header = baseline
  ? ["Cat", "Label", "Mistakes", "%", "Δ", "EV loss", "Games"]
  : ["Cat", "Label", "Mistakes", "%", "EV loss", "Games"];
console.log(row(header));
console.log("-".repeat(cols.reduce((a, b) => a + b + 1, -1)));

let lastGroup = null;
for (const cat of cats) {
  const info = CATEGORY_INFO[cat] || { group: "?", label: "(unknown)" };
  if (info.group !== lastGroup) {
    if (lastGroup !== null) console.log("");
    lastGroup = info.group;
  }
  const e = byCat.get(cat) || { count: 0, ev: 0, games: new Set() };
  const cells = [cat, info.label, e.count, pct(e.count, totalMistakes)];
  if (baseline) cells.push(delta(e.count - (baseline.byCat[cat]?.count || 0)));
  cells.push(e.ev.toFixed(1), e.games.size);
  console.log(row(cells));
}
console.log("-".repeat(cols.reduce((a, b) => a + b + 1, -1)));

const p4 = byCat.get("P4") || { count: 0, ev: 0 };
const d3 = byCat.get("D3") || { count: 0, ev: 0 };
const complex = { count: p4.count + d3.count, ev: p4.ev + d3.ev };
let headline =
  `\nComplex decisions (P4 attack + D3 defense): ${complex.count} mistakes = ` +
  `${pct(complex.count, totalMistakes)} of all, ` +
  `${complex.ev.toFixed(1)} EV (${pct(complex.ev, totalEv)} of EV loss)`;
if (baseline) {
  const b = baseline.complex;
  headline += `\n  vs baseline: ${delta(complex.count - b.count)} mistakes ` +
    `(${(complex.count / totalMistakes * 100 - b.count / baseline.total * 100).toFixed(1)}pp), ` +
    `${(complex.ev - b.ev >= 0 ? "+" : "")}${(complex.ev - b.ev).toFixed(1)} EV` +
    `  [baseline saved ${baseline.saved}]`;
}
console.log(headline);

if (saveBaseline) {
  writeFileSync(baselinePath, JSON.stringify({
    sampleKey, prepHash, saved: new Date().toISOString().slice(0, 16),
    total: totalMistakes, totalEv,
    byCat: Object.fromEntries([...byCat].map(([c, e]) =>
      [c, { count: e.count, ev: +e.ev.toFixed(1) }])),
    complex: { count: complex.count, ev: +complex.ev.toFixed(1) },
  }, null, 2));
  console.log(`Baseline saved → ${baselinePath}`);
}
