#!/usr/bin/env node
// Golden snapshot of the shared dimension comparator (mistake-dimensions CORE,
// Phase 0.4). Dumps `compareDimensions(m)` (the win-vector) + the scene-derived
// `skill_area_for_entry` for every mistake in the frozen category_bench sample
// into a committed fixture — the regression baseline that Phases 1–3 diff
// against (there is no legacy-category parity to hold; the codes are being
// deleted, so this snapshot replaces that guard).
//
// It does NOT prep: it replays the same prepped-mistake cache the bench builds,
// keyed by the snapshot db + the static/js/prep/** hash. Run the bench once
// first if the cache is cold:
//
//   node scripts/category_bench.mjs            # builds .cache/category-bench/prepped-*.json
//   node scripts/snapshot_golden_dimensions.mjs            # writes the fixture
//   node scripts/snapshot_golden_dimensions.mjs --check    # diff vs the committed fixture (CI/regression)

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  existsSync, readFileSync, writeFileSync, readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const targetIdx = args.indexOf("--target");
const target = targetIdx >= 0 ? Number(args[targetIdx + 1]) : 2000;

const dbPath = join(repoRoot, ".cache", "category-stats", "games.db");
const benchDir = join(repoRoot, ".cache", "category-bench");
const fixturePath = join(repoRoot, "tests", "fixtures", "golden_dimensions.json");

// Mirror category_bench.mjs's cache keys so we load the exact prepped sample it
// produced (sampleKey: db + target; prepHash: everything that changes prep).
function hashDir(h, dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) hashDir(h, p);
    else { h.update(p); h.update(readFileSync(p)); }
  }
}
if (!existsSync(dbPath)) {
  console.error(`Snapshot db not found: ${dbPath}\nSync once: node scripts/category_stats.mjs --prod`);
  process.exit(1);
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
if (!existsSync(cachePath)) {
  console.error(`Prepped cache miss (prep=${prepHash}).\nBuild it first: node scripts/category_bench.mjs`);
  process.exit(1);
}
const prepped = JSON.parse(readFileSync(cachePath, "utf8")).mistakes;

const { compareDimensions, deriveShape, skillAreaFor } =
  require(join(repoRoot, "static/js/compare-dimensions.js"));
const { CATEGORIZER_VERSION } = require(join(repoRoot, "static/js/categorize.js"));

// Build the snapshot. Stable sort by (game_id, mistake id) so the committed
// fixture diffs cleanly. `shape` is derived via the shared comparator's
// `deriveShape` (CORE Phase 1.1) — the same function the live categorize result
// now uses, so the frozen baseline and the runtime classification can't drift.

const entries = prepped.map(({ game_id, m }) => {
  const wins = compareDimensions(m);
  return {
    game_id,
    id: m.id ?? null,
    skill_area: skillAreaFor(m),
    shape: deriveShape(wins, m),
    wins,
  };
}).sort((a, b) => (a.game_id - b.game_id) || ((a.id ?? 0) - (b.id ?? 0)));

const snapshot = {
  meta: {
    categorizer_version: CATEGORIZER_VERSION,
    sample_key: sampleKey,
    prep_hash: prepHash,
    count: entries.length,
    note: "Golden baseline for compare-dimensions.js. Regenerate intentionally "
      + "with scripts/snapshot_golden_dimensions.mjs; --check diffs against it.",
  },
  entries,
};
const serialized = JSON.stringify(snapshot);

// --- review readouts (skill-area + shape distributions, suppressed-ukeire spot check) ---
const tally = (key) => {
  const t = {};
  for (const e of entries) { const k = e[key] || "(none)"; t[k] = (t[k] || 0) + 1; }
  return t;
};
const pct = (n) => (n / entries.length * 100).toFixed(1) + "%";
const printTally = (title, t) => {
  console.log(`\n${title}`);
  for (const k of Object.keys(t).sort((a, b) => t[b] - t[a])) {
    console.log(`  ${k.padEnd(14)} ${String(t[k]).padStart(5)}  ${pct(t[k])}`);
  }
};
console.log(`compare-dimensions golden snapshot — ${entries.length} mistakes (v${CATEGORIZER_VERSION}, prep=${prepHash})`);
printTally("Skill area:", tally("skill_area"));
printTally("Shape:", tally("shape"));

const suppressed = entries.filter(e => e.wins.some(w => w.dim === "ukeire" && w.suppressed));
console.log(`\nCross-shanten ukeire suppressed (the gate fix): ${suppressed.length} mistakes (${pct(suppressed.length)})`);
for (const e of suppressed.slice(0, 4)) {
  const u = e.wins.find(w => w.dim === "ukeire" && w.suppressed);
  const sh = e.wins.find(w => w.dim === "shanten");
  console.log(`  game ${e.game_id} #${e.id}: ukeire +${u.magnitude} to "${u.winner}" suppressed`
    + (sh ? `; shanten -${sh.magnitude} to "${sh.winner}"` : "") + ` → shape=${e.shape}`);
}

if (checkOnly) {
  if (!existsSync(fixturePath)) {
    console.error(`\n--check: no committed fixture at ${fixturePath}`);
    process.exit(1);
  }
  const committed = readFileSync(fixturePath, "utf8");
  if (committed === serialized) {
    console.log(`\n✓ golden snapshot matches ${fixturePath}`);
    process.exit(0);
  }
  // Pinpoint the first differing entry for a useful failure.
  const old = JSON.parse(committed).entries;
  let firstDiff = -1;
  for (let i = 0; i < Math.max(old.length, entries.length); i++) {
    if (JSON.stringify(old[i]) !== JSON.stringify(entries[i])) { firstDiff = i; break; }
  }
  console.error(`\n✗ golden snapshot DIFFERS from committed fixture`
    + ` (was ${old.length} entries, now ${entries.length}).`);
  if (firstDiff >= 0) {
    console.error(`  first diff at entry ${firstDiff}:`);
    console.error(`    committed: ${JSON.stringify(old[firstDiff])}`);
    console.error(`    current:   ${JSON.stringify(entries[firstDiff])}`);
  }
  console.error(`\n  If intended, regenerate: node scripts/snapshot_golden_dimensions.mjs`);
  process.exit(1);
}

writeFileSync(fixturePath, serialized);
console.log(`\nWrote ${entries.length} entries → ${fixturePath} (${(serialized.length / 1e6).toFixed(2)} MB)`);
