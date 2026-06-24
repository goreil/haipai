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
const byShape = new Map();      // shape -> { count, ev }
const bySkillShape = new Map(); // skill -> Map(shape -> count) — the new axis pair
const computed = [];            // {game_id, id, wins, shape, skill_area} for the golden diff
let totalMistakes = 0, totalEv = 0;
const allGames = new Set();
for (const { game_id, m } of prepped) {
  const out = categorize(m);
  const ev = m.ev_loss || 0;

  // Result axes (CORE Phase 3): skill area × shape are the whole model now —
  // the legacy P/D/OD code layer is gone. shape is "n/a" for action (non-dahai)
  // decisions; those keep an action code on out.category but no shape.
  const shape = out.shape || "n/a";
  if (!byShape.has(shape)) byShape.set(shape, { count: 0, ev: 0 });
  const se = byShape.get(shape);
  se.count++;
  se.ev += ev;
  const skill = out.skillArea || "(none)";
  if (!bySkillShape.has(skill)) bySkillShape.set(skill, new Map());
  const sm = bySkillShape.get(skill);
  sm.set(shape, (sm.get(shape) || 0) + 1);

  computed.push({ game_id, id: m.id ?? null, wins: out.wins, shape, skill_area: out.skillArea });

  allGames.add(game_id);
  totalMistakes++;
  totalEv += ev;
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

// Formatting helpers shared by the Shape distribution + skill×shape matrix.
const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "—";
const delta = (n) => baseline ? (n > 0 ? `+${n}` : n < 0 ? `${n}` : "·") : "";

console.log(`\nSample: ${allGames.size} games, ${totalMistakes} mistakes, ` +
  `EV loss ${totalEv.toFixed(1)}  (categorize: ${catMs.toFixed(0)}ms, prep=${prepHash})`);

// --- Shape distribution (the headline — there is no legacy category table) ---
// Shape is derived from the win-vector topology (compare-dimensions.js), not
// from any P/D/OD code: obvious (you win nothing) / trade-off (both win
// something) / complex (Mortal wins nothing visible) / n/a (action decision).
const SHAPE_ORDER = ["obvious", "trade-off", "complex", "n/a"];
const shapeKeys = [...SHAPE_ORDER.filter(s => byShape.has(s)),
                   ...[...byShape.keys()].filter(s => !SHAPE_ORDER.includes(s)).sort()];
console.log("\nShape distribution (win-vector topology):");
for (const s of shapeKeys) {
  const e = byShape.get(s);
  const baseShape = baseline && baseline.byShape && baseline.byShape[s];
  const d = baseShape ? `  ${delta(e.count - baseShape.count)}` : "";
  console.log(`  ${s.padEnd(10)} ${String(e.count).padStart(5)}  ${pct(e.count, totalMistakes)}` +
    `   ${e.ev.toFixed(1).padStart(8)} EV (${pct(e.ev, totalEv)})${d}`);
}

// --- Skill area × shape matrix (the two orthogonal axes that replace the tree) ---
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
  const tot = counts.reduce((a, b) => a + b, 0);
  console.log(mrow([sk, ...counts, tot]));
}

// --- Golden-snapshot win-vector diff (the Phase 0 regression guard) ---
// Only meaningful when the run's sample + prep match the frozen fixture;
// otherwise the keys won't line up and a diff would be noise.
const fixturePath = join(repoRoot, "tests", "fixtures", "golden_dimensions.json");
if (existsSync(fixturePath)) {
  const fx = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (fx.meta.sample_key === sampleKey && fx.meta.prep_hash === prepHash) {
    const byKey = new Map(fx.entries.map(e => [`${e.game_id}:${e.id}`, e]));
    let matched = 0, missing = 0, winsDiff = 0, shapeDiff = 0, skillDiff = 0;
    for (const c of computed) {
      const g = byKey.get(`${c.game_id}:${c.id}`);
      if (!g) { missing++; continue; }
      matched++;
      if (JSON.stringify(g.wins) !== JSON.stringify(c.wins)) winsDiff++;
      if (g.shape !== c.shape) shapeDiff++;
      if ((g.skill_area || null) !== (c.skill_area || null)) skillDiff++;
    }
    const clean = !winsDiff && !shapeDiff && !skillDiff && !missing;
    console.log(`\nGolden snapshot (v${fx.meta.categorizer_version}, ${fx.entries.length} entries): ` +
      (clean
        ? `✓ ${matched} matched, win-vector + shape + skill-area identical`
        : `✗ ${winsDiff} win-vector / ${shapeDiff} shape / ${skillDiff} skill-area diffs` +
          (missing ? `, ${missing} not in fixture` : "") + ` over ${matched} matched`));
    if (!clean) {
      console.log("  Intended changes must be re-frozen: node scripts/snapshot_golden_dimensions.mjs");
    }
  } else {
    console.log(`\nGolden snapshot: skipped — fixture is from a different sample/prep ` +
      `(fixture prep=${fx.meta.prep_hash}, run prep=${prepHash}).`);
  }
}

if (saveBaseline) {
  writeFileSync(baselinePath, JSON.stringify({
    sampleKey, prepHash, saved: new Date().toISOString().slice(0, 16),
    total: totalMistakes, totalEv,
    byShape: Object.fromEntries([...byShape].map(([s, e]) =>
      [s, { count: e.count, ev: +e.ev.toFixed(1) }])),
  }, null, 2));
  console.log(`Baseline saved → ${baselinePath}`);
}
