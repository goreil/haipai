#!/usr/bin/env node
// Open-defense han-gate sweep (analysis only — see [[od-trigger-benchmark]]).
//
// Question (report R-151 / #8790 "defense against dora4"): the shipped open-
// defense trigger is V7 = "2+ open calls, any turn". A single call can already
// be a real fold spot when it carries a lot of value (a dora-laden pon, a
// yakuhai). This sweep expands the gate to ALSO fire on
//        open_melds == 1  AND  guaranteed_han >= N
// for N = 2,3,4,5,6, and measures what that adds on top of V7.
//
// "guaranteed_han" is board-discards.js::threatGuaranteedHan — the han a hand
// is locked into from VISIBLE melds: yakuhai stand alone, dora need a yaku so a
// dora-only hand is dora+1. (e.g. a pon showing 3 dora → guaranteed_han 4.)
//
// Requires the prep cache built with OPEN_TRIGGER_VARIANT="SWEEP1" (every 1+
// call open opponent emitted, each open per_threat tagged open_melds/meld_dora/
// yakuhai_han/guaranteed_han). Then, WITHOUT re-prepping, for every mistake we:
//   1. BASELINE (V7): keep open threats with open_melds>=2 (+ all riichi),
//      recombine dealin, run the real categorize() → baseline category.
//   2. GATE N: keep open threats with open_melds>=2 OR guaranteed_han>=N,
//      recombine, categorize → gate category.
//   3. tally every mistake whose category switched from a Push (P1–P4) to an
//      Open Defense tier (OD1/OD2/OD3), broken down by source and destination.
//
// OD1 = your discard deals in harder than Mortal's → a real fold spot (good).
// OD2 = push.   OD3 = neither clearly defends nor improves → still "complex".
// A *good* gate adds mostly OD1, not OD3.
//
//   node scripts/od_han_gate_sweep.mjs

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));

const GATES = [2, 3, 4, 5, 6]; // guaranteed-han thresholds for the 1-call clause

// Cache to sweep: explicit path as argv[2], else newest prepped-*.json.
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
if (!cacheFile) { console.error("No prepped cache. Run category_bench.mjs under SWEEP1 first."); process.exit(1); }
const prepped = JSON.parse(readFileSync(cacheFile, "utf8")).mistakes;
console.error(`Loaded ${prepped.length} mistakes from ${cacheFile.split("/").pop()}`);

// Sanity: confirm the cache carries SWEEP1 han metadata on single-call threats.
const anyTagged = prepped.some(({ m }) =>
  (m.per_threat || []).some(t => t && t.kind === "open" && t.guaranteed_han != null));
if (!anyTagged) {
  console.error('Cache has no SWEEP1 han metadata — re-prep with ' +
    'OPEN_TRIGGER_VARIANT="SWEEP1" (node scripts/category_bench.mjs).');
  process.exit(1);
}

// Recombine the aggregate per-tile dealin from a set of kept threats, exactly as
// prep does: combined = 1 - Π(1 - p_i). per_threat rates are percents.
function recombineDealin(keptThreats) {
  const notHit = {};
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

// Categorize a mistake while keeping only the open threats that pass `keepOpen`
// (riichi threats are always kept). Returns the category string.
function catWith(m, keepOpen) {
  const threats = m.per_threat || [];
  const kept = threats.filter(t => (t.kind !== "open" ? true : keepOpen(t)));
  const m2 = { ...m, per_threat: kept, dealin_rates: recombineDealin(kept) };
  return categorize(m2).category;
}

// Han model: every open hand needs *a* yaku, so assume a 1-han base, then stack
// every visible han on top (melded yakuhai + exposed dora). So a bare call = 1,
// a single yakuhai pon = 2, one dora = 2, a pon of the dora tile (3 dora) = 4.
// (This differs from the stored guaranteed_han, which had no base for bare calls
// and folded the "+1 for a yaku" only into the dora-only case.)
const gHan = t => 1 + (t.yakuhai_han || 0) + (t.meld_dora || 0);
const keepV7 = t => t.open_melds >= 2;                         // shipped baseline
const keepGate = N => t => t.open_melds >= 2 || gHan(t) >= N;

const PUSH = new Set(["P1", "P2", "P3", "P4"]);
const ODS = ["OD1", "OD2", "OD3"];

// ── Reference distributions ────────────────────────────────────────────────
// Run the unfiltered baseline categorize once, then the V7-OD baseline, to
// anchor the "Defense/Defend" (riichi D1/D2/D3) and "Open Defense/Defend"
// (V7 OD1/OD2/OD3) comparison the report asks for.
function distRef() {
  const D = { D1: 0, D2: 0, D3: 0, evD1: 0, evTot: 0 };
  const ODv7 = { OD1: 0, OD2: 0, OD3: 0, evOD1: 0, evTot: 0, games: new Set() };
  for (const { m, game_id } of prepped) {
    const cat = catWith(m, keepV7);
    const ev = m.ev_loss || 0;
    if (cat === "D1" || cat === "D2" || cat === "D3") {
      D[cat]++; D.evTot += ev; if (cat === "D1") D.evD1 += ev;
    } else if (cat[0] === "O") {
      ODv7[cat]++; ODv7.evTot += ev; if (cat === "OD1") ODv7.evOD1 += ev;
      ODv7.games.add(game_id);
    }
  }
  return { D, ODv7 };
}

// ── Per-gate sweep ───────────────────────────────────────────────────────────
function runGate(N) {
  const keep = keepGate(N);
  // P -> OD switches, with source-P × dest-OD breakdown.
  const switchMat = {}; // `${from}->${to}` -> count
  const added = { OD1: 0, OD2: 0, OD3: 0 };       // newly-OD tiers (the gate's gain)
  const addedEv = { OD1: 0, OD2: 0, OD3: 0 };
  const fromCount = { P1: 0, P2: 0, P3: 0, P4: 0 };
  const games = new Set();
  // Combined OD pool after the gate (V7 OD + added).
  const pool = { OD1: 0, OD2: 0, OD3: 0, evOD1: 0, evTot: 0 };
  for (const { m, game_id } of prepped) {
    const base = catWith(m, keepV7);
    const gate = catWith(m, keep);
    if (gate[0] === "O") {
      pool[gate]++; pool.evTot += m.ev_loss || 0;
      if (gate === "OD1") pool.evOD1 += m.ev_loss || 0;
    }
    if (PUSH.has(base) && gate[0] === "O") {
      const key = `${base}->${gate}`;
      switchMat[key] = (switchMat[key] || 0) + 1;
      added[gate]++; addedEv[gate] += m.ev_loss || 0;
      fromCount[base]++;
      games.add(game_id);
    }
  }
  return { N, switchMat, added, addedEv, fromCount, games, pool };
}

// ── Output ───────────────────────────────────────────────────────────────────
const { D, ODv7 } = distRef();
const gateResults = GATES.map(runGate);

const pct = (n, d) => d ? (n / d * 100).toFixed(0) + "%" : "—";
const sample = prepped.length;

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log(` OPEN-DEFENSE 1-CALL HAN-GATE SWEEP   (sample = ${sample} mistakes, 51 games)`);
console.log("════════════════════════════════════════════════════════════════════");
console.log("");
console.log("New rule:  keep open threat if  open_melds>=2  OR  han>=N");
console.log("           han = 1 (base yaku) + yakuhai_han + meld_dora");
console.log("           (N is the 1-call clause; melds>=2 = current shipped V7)");
console.log("");

// --- Reference baselines ---
const dTot = D.D1 + D.D2 + D.D3;
const odTot = ODv7.OD1 + ODv7.OD2 + ODv7.OD3;
console.log("── BASELINES (the two axes to beat) ─────────────────────────────────");
console.log(`Defense/Defend     (riichi)   D1 ${D.D1} (${pct(D.D1, dTot)})  D2 ${D.D2} (${pct(D.D2, dTot)})  D3 ${D.D3} (${pct(D.D3, dTot)})   total ${dTot}`);
console.log(`                              D1 EV share ${pct(D.evD1, D.evTot)}`);
console.log(`Open Defense (V7, melds>=2)  OD1 ${ODv7.OD1} (${pct(ODv7.OD1, odTot)}) OD2 ${ODv7.OD2} (${pct(ODv7.OD2, odTot)}) OD3 ${ODv7.OD3} (${pct(ODv7.OD3, odTot)})  total ${odTot}`);
console.log(`                             OD1 EV share ${pct(ODv7.evOD1, ODv7.evTot)}   (${ODv7.games.size} games)`);
console.log("");

// --- 1) How many P->OD switches per gate (the headline) ---
console.log("── 1) WHAT EACH GATE ADDS ON TOP OF V7  (P->OD switches) ─────────────");
console.log("Gate     +switches  games   +OD1 Defend   +OD2 Push    +OD3 Complex   OD1%  OD1-EV%");
console.log("-".repeat(86));
for (const r of gateResults) {
  const t = r.added.OD1 + r.added.OD2 + r.added.OD3;
  const evT = r.addedEv.OD1 + r.addedEv.OD2 + r.addedEv.OD3;
  console.log(
    `han>=${r.N}` .padEnd(9) +
    String(t).padStart(8) + "  " +
    String(r.games.size).padStart(5) + "   " +
    `${r.added.OD1} (${pct(r.added.OD1, t)})`.padStart(11) + "  " +
    `${r.added.OD2} (${pct(r.added.OD2, t)})`.padStart(11) + "  " +
    `${r.added.OD3} (${pct(r.added.OD3, t)})`.padStart(12) + "   " +
    pct(r.added.OD1, t).padStart(4) + "  " +
    pct(r.addedEv.OD1, evT).padStart(5)
  );
}
console.log("");

// --- 2) Source-subcategory breakdown of the switches ---
console.log("── 2) WHERE THE SWITCHED MISTAKES CAME FROM  (source Push tier) ──────");
console.log("Gate       from P1   from P2   from P3   from P4   (P4 = the Complex bucket)");
console.log("-".repeat(78));
for (const r of gateResults) {
  console.log(
    `han>=${r.N}`.padEnd(9) +
    String(r.fromCount.P1).padStart(8) +
    String(r.fromCount.P2).padStart(10) +
    String(r.fromCount.P3).padStart(10) +
    String(r.fromCount.P4).padStart(10)
  );
}
console.log("");

// --- 2b) Full source x dest matrix for the most interesting gates ---
console.log("── 2b) FULL source->dest MATRIX ─────────────────────────────────────");
for (const r of gateResults) {
  const keys = Object.keys(r.switchMat).sort();
  if (!keys.length) { console.log(`han>=${r.N}: (none)`); continue; }
  const parts = keys.map(k => `${k} ${r.switchMat[k]}`);
  console.log(`han>=${r.N}:  ` + parts.join("   "));
}
console.log("");

// --- 3) Resulting combined OD pool distribution per gate ---
console.log("── 3) RESULTING OPEN-DEFENSE POOL  (V7 OD + gate additions) ──────────");
console.log("More OD1(Defend) share = better. Compare against V7-only and riichi-D above.");
console.log("Gate        OD1 Defend     OD2 Push      OD3 Complex     total   OD1%  OD1-EV%");
console.log("-".repeat(82));
{
  // V7-only pool row for reference
  console.log(
    "V7 only".padEnd(11) +
    `${ODv7.OD1} (${pct(ODv7.OD1, odTot)})`.padStart(12) + "  " +
    `${ODv7.OD2} (${pct(ODv7.OD2, odTot)})`.padStart(12) + "  " +
    `${ODv7.OD3} (${pct(ODv7.OD3, odTot)})`.padStart(12) + "   " +
    String(odTot).padStart(5) + "  " +
    pct(ODv7.OD1, odTot).padStart(4) + "  " +
    pct(ODv7.evOD1, ODv7.evTot).padStart(5)
  );
}
for (const r of gateResults) {
  const t = r.pool.OD1 + r.pool.OD2 + r.pool.OD3;
  console.log(
    `+ han>=${r.N}`.padEnd(11) +
    `${r.pool.OD1} (${pct(r.pool.OD1, t)})`.padStart(12) + "  " +
    `${r.pool.OD2} (${pct(r.pool.OD2, t)})`.padStart(12) + "  " +
    `${r.pool.OD3} (${pct(r.pool.OD3, t)})`.padStart(12) + "   " +
    String(t).padStart(5) + "  " +
    pct(r.pool.OD1, t).padStart(4) + "  " +
    pct(r.pool.evOD1, r.pool.evTot).padStart(5)
  );
}
console.log("");
