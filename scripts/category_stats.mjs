#!/usr/bin/env node
// Category distribution over every game in the DB.
//
// Runs the exact pipeline the trends page runs per game (prepGame →
// haipaiCategorize.categorize), but headlessly against SQLite + the mortal
// JSON files on disk — no HTTP, no server. Prints per-category mistake
// counts/%, EV loss, and how many games contain each category, plus the
// P4+D3 "complex decision" headline metric.
//
// Usage:
//   node scripts/category_stats.mjs                  # repo-root games.db (dev)
//   node scripts/category_stats.mjs --prod           # sync prod data from the
//                                                    #   container into .cache/, run on that
//   node scripts/category_stats.mjs --db x.db --mortal-dir /some/root
//   node scripts/category_stats.mjs --prod --user 3  # one user only
//
// --prod copies games.db out of the container on every run (it changes) but
// syncs mortal_analysis/ incrementally — filenames are content hashes, so an
// existing local copy is never stale.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const prod = flag("--prod");
const verbose = flag("--verbose");
const userFilter = opt("--user");
let dbPath = opt("--db");
let mortalDir = opt("--mortal-dir");
if (args.length) {
  console.error(`Unknown args: ${args.join(" ")}`);
  process.exit(2);
}

// --- prod sync: pull games.db + missing mortal files out of the container ---
if (prod) {
  const cache = join(repoRoot, ".cache", "category-stats");
  mkdirSync(join(cache, "mortal_analysis"), { recursive: true });
  const sh = (cmd, opts = {}) =>
    execSync(cmd, { cwd: repoRoot, maxBuffer: 1 << 28, ...opts });

  process.stderr.write("Syncing games.db from container…\n");
  sh(`docker compose cp app:/app/data/games.db ${join(cache, "games.db")}`,
     { stdio: ["ignore", "ignore", "inherit"] });

  const listing = sh("docker compose exec -T app ls /app/mortal_analysis")
    .toString().trim().split("\n").filter(Boolean);
  const missing = listing.filter(f => !existsSync(join(cache, "mortal_analysis", f)));
  if (missing.length) {
    process.stderr.write(`Syncing ${missing.length}/${listing.length} mortal files…\n`);
    for (let i = 0; i < missing.length; i += 50) {
      const files = missing.slice(i, i + 50).map(f => `mortal_analysis/${f}`).join(" ");
      sh(`docker compose exec -T app tar -cf - -C /app ${files} | tar -xf - -C ${cache}`);
    }
  } else {
    process.stderr.write(`Mortal files cached (${listing.length}).\n`);
  }
  dbPath = dbPath || join(cache, "games.db");
  mortalDir = mortalDir || cache;
}
dbPath = dbPath || join(repoRoot, "games.db");
mortalDir = mortalDir || repoRoot;

// --- load the live pipeline (same modules the browser runs) ---
const { prepGame } = require(join(repoRoot, "static/js/prep/prep.js"));
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));

// Category labels/groups from the backend registry — single source of truth.
const CATEGORY_INFO = JSON.parse(
  execSync(`${join(repoRoot, ".venv/bin/python")} -c ` +
    `"import json; from lib.categories import CATEGORY_INFO; print(json.dumps(CATEGORY_INFO))"`,
    { cwd: repoRoot }).toString()
);

// prep warns about wall inconsistencies per game; keep them out of the table.
let warnCount = 0;
const realWarn = console.warn;
console.warn = (...a) => { warnCount++; if (verbose) realWarn(...a); };

// --- walk the DB ---
const db = new DatabaseSync(dbPath, { readOnly: true });
let gamesSql = "SELECT id, user_id, date, mortal_file, rounds_json FROM games";
const gamesParams = [];
if (userFilter != null) {
  gamesSql += " WHERE user_id = ?";
  gamesParams.push(Number(userFilter));
}
const games = db.prepare(gamesSql + " ORDER BY id").all(...gamesParams);
const mistakeStmt = db.prepare(
  "SELECT id, round_name, round_idx, mistake_idx, data_json, ev_loss, turn " +
  "FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx"
);

// Mirror db/games.py::get_game — rounds_json gives the full round list (kept
// so round_idx ↔ kyoku alignment matches what prepGame sees in the browser).
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

const byCat = new Map(); // cat -> { count, ev, games:Set }
let totalMistakes = 0, totalEv = 0;
let analyzed = 0;
const skipped = [];

for (const g of games) {
  const mortalPath = g.mortal_file ? join(mortalDir, g.mortal_file) : null;
  if (!mortalPath || !existsSync(mortalPath)) {
    skipped.push(g.id);
    continue;
  }
  const game = reconstructGame(g);
  // Full mortal JSON is a superset of the slim copy the API ships; prep
  // reads the same fields either way.
  const md = JSON.parse(readFileSync(mortalPath, "utf8"));
  try {
    prepGame(game, md);
  } catch (e) {
    skipped.push(g.id);
    if (verbose) realWarn(`prep failed for game ${g.id}:`, e.message);
    continue;
  }
  for (const rnd of game.rounds) {
    for (const m of rnd.mistakes || []) {
      const out = categorize(m);
      const cat = out.category || "??";
      if (!byCat.has(cat)) byCat.set(cat, { count: 0, ev: 0, games: new Set() });
      const e = byCat.get(cat);
      e.count++;
      e.ev += m.ev_loss || 0;
      e.games.add(g.id);
      totalMistakes++;
      totalEv += m.ev_loss || 0;
    }
  }
  analyzed++;
  if (analyzed % 50 === 0) process.stderr.write(`  …${analyzed}/${games.length} games\n`);
}
db.close();

// --- table ---
const ORDER = ["P1", "P2", "P3", "P4", "D1", "D2", "D3",
               "4A", "4B", "4C", "5A", "5B", "6A", "6B"];
const cats = [...ORDER.filter(c => byCat.has(c)),
              ...[...byCat.keys()].filter(c => !ORDER.includes(c)).sort()];

const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "—";
const cols = [4, 18, 9, 7, 10, 7, 8];
const row = (cells) => cells.map((c, i) =>
  i < 2 ? String(c).padEnd(cols[i]) : String(c).padStart(cols[i])).join(" ");

console.log(`\nGames: ${games.length} total, ${analyzed} analyzed` +
  (skipped.length ? `, ${skipped.length} skipped (missing/unreadable mortal file)` : "") +
  (userFilter != null ? `  [user ${userFilter}]` : ""));
console.log(`Mistakes: ${totalMistakes}   total EV loss: ${totalEv.toFixed(1)}\n`);
console.log(row(["Cat", "Label", "Mistakes", "%", "EV loss", "Games", "% games"]));
console.log("-".repeat(cols.reduce((a, b) => a + b + 1, -1)));

let lastGroup = null;
for (const cat of cats) {
  const info = CATEGORY_INFO[cat] || { group: "?", label: "(unknown)" };
  if (info.group !== lastGroup) {
    if (lastGroup !== null) console.log("");
    lastGroup = info.group;
  }
  const e = byCat.get(cat);
  console.log(row([cat, info.label, e.count, pct(e.count, totalMistakes),
                   e.ev.toFixed(1), e.games.size, pct(e.games.size, analyzed)]));
}
console.log("-".repeat(cols.reduce((a, b) => a + b + 1, -1)));
console.log(row(["", "TOTAL", totalMistakes, "100.0%", totalEv.toFixed(1), analyzed, ""]));

const p4 = byCat.get("P4") || { count: 0, ev: 0 };
const d3 = byCat.get("D3") || { count: 0, ev: 0 };
console.log(`\nComplex decisions (P4 attack + D3 defense): ` +
  `${p4.count + d3.count} mistakes = ${pct(p4.count + d3.count, totalMistakes)} of all, ` +
  `${(p4.ev + d3.ev).toFixed(1)} EV (${pct(p4.ev + d3.ev, totalEv)} of EV loss)`);
if (warnCount && !verbose) {
  console.log(`(${warnCount} prep warnings suppressed — rerun with --verbose to see them)`);
}
if (skipped.length && verbose) console.log(`Skipped game ids: ${skipped.join(", ")}`);
