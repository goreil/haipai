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

// Redraws in place on a TTY; falls back to ~10%-step lines when piped.
// `done` may advance by more than 1 per call (the game loop ticks by each
// game's mistake count), so the fallback thresholds on distance covered,
// not on round numbers.
let _lastProgress = 0;
function progress(done, total, label) {
  if (!total) return;
  if (!process.stderr.isTTY) {
    if (done === total || done - _lastProgress >= total / 10) {
      process.stderr.write(`  …${done}/${total} ${label}\n`);
      _lastProgress = done === total ? 0 : done;  // reset for the next phase
    }
    return;
  }
  const width = 30;
  const filled = Math.round(width * done / total);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  process.stderr.write(`\r[${bar}] ${done}/${total} ${label}`);
  if (done === total) process.stderr.write("\n");
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
      const chunk = missing.slice(i, i + 50);
      const files = chunk.map(f => `mortal_analysis/${f}`).join(" ");
      sh(`docker compose exec -T app tar -cf - -C /app ${files} | tar -xf - -C ${cache}`);
      progress(Math.min(i + 50, missing.length), missing.length, "files synced");
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

// Per-game mistake counts up front so progress can tick by mistake — a
// closer proxy for remaining time than game count, since prep cost scales
// with game size.
const mistakeCounts = new Map(
  db.prepare("SELECT game_id, COUNT(*) AS c FROM mistakes GROUP BY game_id")
    .all().map(r => [r.game_id, r.c])
);
const mistakesTotal = games.reduce((s, g) => s + (mistakeCounts.get(g.id) || 0), 0);

// CORE Phase 3: the legacy category codes are gone — a mistake is {skillArea,
// shape, wins}. Tally the shape distribution + skill-area × shape matrix.
const byShape = new Map();      // shape -> { count, ev }
const bySkillShape = new Map(); // skill -> Map(shape -> count)
let totalMistakes = 0, totalEv = 0;
let analyzed = 0, mistakesSeen = 0;
const skipped = [];

for (const g of games) {
  try {
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
        const ev = m.ev_loss || 0;
        const shape = out.shape || "n/a";
        if (!byShape.has(shape)) byShape.set(shape, { count: 0, ev: 0 });
        const se = byShape.get(shape);
        se.count++;
        se.ev += ev;
        const skill = out.skillArea || "(none)";
        if (!bySkillShape.has(skill)) bySkillShape.set(skill, new Map());
        const sm = bySkillShape.get(skill);
        sm.set(shape, (sm.get(shape) || 0) + 1);
        totalMistakes++;
        totalEv += ev;
      }
    }
    analyzed++;
  } finally {
    // Skipped games advance the bar too, so it always reaches 100%.
    mistakesSeen += mistakeCounts.get(g.id) || 0;
    progress(mistakesSeen, mistakesTotal, "mistakes");
  }
}
db.close();

// --- shape distribution + skill-area × shape matrix ---
const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "—";

console.log(`\nGames: ${games.length} total, ${analyzed} analyzed` +
  (skipped.length ? `, ${skipped.length} skipped (missing/unreadable mortal file)` : "") +
  (userFilter != null ? `  [user ${userFilter}]` : ""));
console.log(`Mistakes: ${totalMistakes}   total EV loss: ${totalEv.toFixed(1)}`);

const SHAPE_ORDER = ["obvious", "trade-off", "complex", "n/a"];
const shapeKeys = [...SHAPE_ORDER.filter(s => byShape.has(s)),
                   ...[...byShape.keys()].filter(s => !SHAPE_ORDER.includes(s)).sort()];
console.log("\nShape distribution (win-vector topology):");
for (const s of shapeKeys) {
  const e = byShape.get(s);
  console.log(`  ${s.padEnd(10)} ${String(e.count).padStart(5)}  ${pct(e.count, totalMistakes)}` +
    `   ${e.ev.toFixed(1).padStart(8)} EV (${pct(e.ev, totalEv)})`);
}

const skillKeys = [...bySkillShape.keys()].sort((a, b) => {
  const ca = [...bySkillShape.get(a).values()].reduce((x, y) => x + y, 0);
  const cb = [...bySkillShape.get(b).values()].reduce((x, y) => x + y, 0);
  return cb - ca;
});
const mcols = [14, ...shapeKeys.map(() => 10), 8];
const mrow = (cells) => cells.map((c, i) =>
  i === 0 ? String(c).padEnd(mcols[i]) : String(c).padStart(mcols[i])).join(" ");
console.log("\nSkill area × shape:");
console.log(mrow(["skill", ...shapeKeys, "total"]));
console.log("-".repeat(mcols.reduce((a, b) => a + b + 1, -1)));
for (const sk of skillKeys) {
  const sm = bySkillShape.get(sk);
  const counts = shapeKeys.map(s => sm.get(s) || 0);
  console.log(mrow([sk, ...counts, counts.reduce((a, b) => a + b, 0)]));
}

const complex = byShape.get("complex") || { count: 0, ev: 0 };
console.log(`\nComplex decisions (Mortal wins nothing visible): ` +
  `${complex.count} mistakes = ${pct(complex.count, totalMistakes)} of all, ` +
  `${complex.ev.toFixed(1)} EV (${pct(complex.ev, totalEv)} of EV loss)`);
if (warnCount && !verbose) {
  console.log(`(${warnCount} prep warnings suppressed — rerun with --verbose to see them)`);
}
if (skipped.length && verbose) console.log(`Skipped game ids: ${skipped.join(", ")}`);
