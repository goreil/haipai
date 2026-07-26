#!/usr/bin/env node
// Open-defense trigger sweep (analysis only — see [[od-trigger-benchmark]]).
//
// Requires the prep cache to have been built with OPEN_TRIGGER_VARIANT="SWEEP"
// (every open opponent emitted, each per_threat tagged with open_melds /
// meld_dora / yakuhai_realized / tanyao_possible). Then, WITHOUT re-prepping,
// we apply each candidate trigger rule by:
//   1. keeping the open threats whose metadata passes the rule (riichi threats
//      are always kept — those scenes are D-tier, never OD),
//   2. recombining the aggregate dealin_rates from the kept threats exactly the
//      way prep does (1 - Π(1 - p_i)),
//   3. re-running the real categorize() and tallying OD1/OD2/OD3.
//
// OD1 = your discard deals in harder than Mortal's pick  → a real fold spot.
// OD3 = neither clearly defends nor clearly improves      → still "complex".
// So a *good* trigger has a high OD1 share, not just a big total.
//
//   node scripts/od_trigger_sweep.mjs

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));

// Cache to sweep: explicit path as argv[2], else newest prepped-*.json (built
// by category_bench.mjs under SWEEP).
const benchDir = join(repoRoot, ".cache", "category-bench");
const argFile = process.argv[2];
const cacheFile = argFile
  ? (argFile.includes("/") ? argFile : join(benchDir, argFile))
  : readdirSync(benchDir)
      .filter(f => f.startsWith("prepped-") && f.endsWith(".json"))
      .map(f => ({ f, mtime: statSync(join(benchDir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
      .map(x => join(benchDir, x.f))
      .pop();
if (!cacheFile) { console.error("No prepped cache. Run category_bench.mjs under SWEEP first."); process.exit(1); }
const prepped = JSON.parse(readFileSync(cacheFile, "utf8")).mistakes;
console.error(`Loaded ${prepped.length} mistakes from ${cacheFile.split("/").pop()}`);

// Sanity: confirm the cache actually carries SWEEP metadata.
const anyTagged = prepped.some(({ m }) =>
  (m.per_threat || []).some(t => t && t.kind === "open" && t.open_melds != null));
if (!anyTagged) {
  console.error("Cache has no SWEEP open-threat metadata — re-prep with " +
    'OPEN_TRIGGER_VARIANT="SWEEP" (node scripts/category_bench.mjs).');
  process.exit(1);
}

// --- candidate rules: predicate over a single open threat's metadata ---
// turn-agnostic by design — the point is to see the OD1 "hit rate" of each
// shape filter, independent of how many turns we wait.
const RULES = [
  ["melds >= 1 (all open)",        t => t.open_melds >= 1],
  ["melds >= 2",                   t => t.open_melds >= 2],
  ["melds >= 3",                   t => t.open_melds >= 3],
  ["melds >= 2 & dora >= 1",       t => t.open_melds >= 2 && t.meld_dora >= 1],
  ["melds >= 2 & dora >= 2",       t => t.open_melds >= 2 && t.meld_dora >= 2],
  ["melds >= 1 & dora >= 2",       t => t.open_melds >= 1 && t.meld_dora >= 2],
  ["melds >= 2 & yakuhai",         t => t.open_melds >= 2 && t.yakuhai_realized],
  ["melds >= 1 & yakuhai",         t => t.open_melds >= 1 && t.yakuhai_realized],
  ["melds >= 2 & tanyao-possible", t => t.open_melds >= 2 && t.tanyao_possible],
  ["melds >= 2 & (dora>=1|yakuhai)", t => t.open_melds >= 2 && (t.meld_dora >= 1 || t.yakuhai_realized)],
  ["melds>=3 | (melds>=2 & dora>=1)", t => t.open_melds >= 3 || (t.open_melds >= 2 && t.meld_dora >= 1)],
  ["melds>=2 & (dora>=1|yakuhai|tanyao)", t => t.open_melds >= 2 && (t.meld_dora >= 1 || t.yakuhai_realized || t.tanyao_possible)],
];

// Recombine the aggregate per-tile dealin from a set of kept threats, exactly
// as prep does: combined = 1 - Π(1 - p_i). per_threat rates are percents.
function recombineDealin(keptThreats) {
  const notHit = {}; // tile -> Π(1 - p_i)
  for (const t of keptThreats) {
    for (const [tile, pct] of Object.entries(t.dealin_rates || {})) {
      notHit[tile] = (tile in notHit ? notHit[tile] : 1) * (1 - pct / 100);
    }
  }
  const agg = {};
  for (const [tile, np] of Object.entries(notHit)) {
    agg[tile] = Math.round((1 - np) * 10000) / 100;
  }
  return agg;
}

function runRule(predicate) {
  const tally = { OD1: 0, OD2: 0, OD3: 0 };
  let evOD1 = 0, evTotal = 0;
  for (const { m } of prepped) {
    const threats = m.per_threat || [];
    if (!threats.some(t => t && t.kind === "open")) continue; // not an open scene
    const kept = threats.filter(t =>
      t.kind !== "open" ? true : predicate(t)); // riichi always kept
    if (!kept.some(t => t.kind === "open")) continue; // rule dropped all open threats
    const m2 = { ...m, per_threat: kept, dealin_rates: recombineDealin(kept) };
    const cat = categorize(m2).category;
    if (cat === "OD1" || cat === "OD2" || cat === "OD3") {
      tally[cat]++;
      evTotal += m.ev_loss || 0;
      if (cat === "OD1") evOD1 += m.ev_loss || 0;
    }
  }
  const total = tally.OD1 + tally.OD2 + tally.OD3;
  return { ...tally, total, evOD1, evTotal };
}

// Reference: the proven riichi-defense axis (D1/D2/D3). Same Defend/Push/
// Complex logic, but its trigger is "opponent declared riichi" — unconditional.
// Gives a benchmark OD1%% to compare the open-trigger rules against.
function riichiReference() {
  const tally = { D1: 0, D2: 0, D3: 0 };
  let evD1 = 0, evTotal = 0;
  for (const { m } of prepped) {
    const cat = categorize(m).category;
    if (cat === "D1" || cat === "D2" || cat === "D3") {
      tally[cat]++;
      evTotal += m.ev_loss || 0;
      if (cat === "D1") evD1 += m.ev_loss || 0;
    }
  }
  const total = tally.D1 + tally.D2 + tally.D3;
  return { OD1: tally.D1, OD2: tally.D2, OD3: tally.D3, total, evOD1: evD1, evTotal };
}

const pct = (n, d) => d ? (n / d * 100).toFixed(0) + "%" : "—";
const cell = (n, d) => `${String(n).padStart(4)} ${("(" + pct(n, d) + ")").padStart(6)}`;

console.log("");
console.log("OD tiers under each turn-agnostic open trigger (SWEEP universe = " +
  prepped.length + " mistakes). %% = share of that rule's OD total.");
console.log("OD1=Defend (real fold)  OD2=Push  OD3=Complex.  Higher OD1%% = better.\n");
const hdr = "Rule".padEnd(38) + "  Total   " +
  "OD1 Defend  ".padStart(13) + "OD2 Push   ".padStart(13) + "OD3 Complex".padStart(13) + "   OD1 EV%";
console.log(hdr);
console.log("-".repeat(hdr.length));

// Riichi-defense benchmark row (D1/D2/D3) at the top for comparison.
{
  const r = riichiReference();
  console.log(
    "RIICHI defense (D1/D2/D3, ref)".padEnd(38) + "  " +
    String(r.total).padStart(5) + "   " +
    cell(r.OD1, r.total) + "  " +
    cell(r.OD2, r.total) + "  " +
    cell(r.OD3, r.total) + "    " +
    pct(r.evOD1, r.evTotal).padStart(4)
  );
  console.log("-".repeat(hdr.length));
}

for (const [label, pred] of RULES) {
  const r = runRule(pred);
  console.log(
    label.padEnd(38) + "  " +
    String(r.total).padStart(5) + "   " +
    cell(r.OD1, r.total) + "  " +
    cell(r.OD2, r.total) + "  " +
    cell(r.OD3, r.total) + "    " +
    pct(r.evOD1, r.evTotal).padStart(4)
  );
}
console.log("");
