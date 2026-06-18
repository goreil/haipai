#!/usr/bin/env node
// One-off evaluation harness for the "dora acceptance" Attack rule (report #4932).
//
// Reads the frozen prepped bench sample and, WITHOUT touching categorize.js,
// re-derives the baseline category and overlays each candidate variant of the
// new rule:
//   V1  naive   — Mortal's wait accepts strictly more live dora than yours
//   V2  net     — V1, but suppressed when Mortal's discard is itself a dora
//                 (throwing a dora to gain dora acceptance is a wash)
//   V2t threshold — V2 but require the dora-ukeire gain to be >= 2 live tiles
//   V3  +redfive — V2 plus an (over-approx) red-five-acceptance signal:
//                 accepting a bare 5m/5p/5s is treated as possible red dora.
//
// Only fires at the P4 / D3 / OD3 fall-through (the "complex" buckets), mirroring
// where classifyPush returns P4. P4->P3, D3->D2, OD3->OD2.
//
// Prints reclassification counts + EV, the V1\V2 "moot" cases the net rule
// removes, the V3-extra cases, and a gain-magnitude histogram for threshold
// tuning.  Run: node scripts/dora_accept_eval.mjs

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));

const CACHE = process.argv[2] ||
  join(repoRoot, ".cache/category-bench/prepped-45b13400ad79-dd4738d7baab.json");
const prepped = JSON.parse(readFileSync(CACHE, "utf8")).mistakes;

// --- tile helpers (mirror categorize.js) ---
const tileBase = (t) => (t && t.endsWith("r") ? t.slice(0, -1) : t);
const isRedFive = (t) => t === "5mr" || t === "5pr" || t === "5sr";
const isBareFive = (t) => t === "5m" || t === "5p" || t === "5s";
function isDoraTile(tile, doraSet) {
  if (!tile) return false;
  if (isRedFive(tile)) return true;
  return doraSet.has(tile);
}
function statFor(m, tile) {
  if (!m.discard_stats || !tile) return null;
  const base = tileBase(tile);
  return m.discard_stats.find((s) => s.tile === tile || tileBase(s.tile) === base) || null;
}
// Weighted live-dora acceptance: sum of wall counts over accepted dora tiles.
function doraUkeire(stat, doraSet) {
  if (!stat || !stat.necessary_tiles) return 0;
  let n = 0;
  for (const nt of stat.necessary_tiles) if (doraSet.has(nt.tile)) n += nt.count || 0;
  return n;
}
// Over-approx red-five acceptance: any bare-5 acceptance whose suit's 5 is NOT
// already a board dora (avoid double count). Upper bound — can't confirm the
// red copy is live without a prep-side flag.
function redFiveUkeire(stat, doraSet) {
  if (!stat || !stat.necessary_tiles) return 0;
  let n = 0;
  for (const nt of stat.necessary_tiles) {
    if (isBareFive(nt.tile) && !doraSet.has(nt.tile) && (nt.count || 0) > 0) n += 1;
  }
  return n;
}

const COMPLEX = new Set(["P4", "D3", "OD3"]);
const DEMOTE = { P4: "P3", D3: "D2", OD3: "OD2" };

const variants = ["V1", "V2", "V2t", "V3"];
const stats = {};
for (const v of variants) stats[v] = { p4: 0, d3: 0, od3: 0, ev: 0, cases: [] };
const gainHist = new Map();      // dora-ukeire gain -> count (among complex dahai)
let complexDahai = 0, mootCases = [], v3ExtraCases = [];

for (const { game_id, m } of prepped) {
  const baseCat = categorize(m).category;
  if (!COMPLEX.has(baseCat)) continue;
  const a = m.actual, e = m.expected;
  if (!a || !e || a.type !== "dahai" || e.type !== "dahai") continue;

  const board = m.board_state || {};
  const doraSet = new Set(board.dora_tiles || []);
  const aStat = statFor(m, a.pai), eStat = statFor(m, e.pai);
  if (!aStat || !eStat) continue;
  complexDahai++;

  const dA = doraUkeire(aStat, doraSet);     // your wait's dora acceptance
  const dE = doraUkeire(eStat, doraSet);     // Mortal's wait's dora acceptance
  const gain = dE - dA;
  gainHist.set(gain, (gainHist.get(gain) || 0) + 1);

  const mortalThrowsDora = isDoraTile(e.pai, doraSet);
  const rfGain = redFiveUkeire(eStat, doraSet) - redFiveUkeire(aStat, doraSet);

  const fires = {
    V1: gain > 0,
    V2: gain > 0 && !mortalThrowsDora,
    V2t: gain >= 2 && !mortalThrowsDora,
    V3: (gain > 0 || rfGain > 0) && !mortalThrowsDora,
  };

  const tag = baseCat === "P4" ? "p4" : baseCat === "D3" ? "d3" : "od3";
  const summary = {
    game_id, id: m.id, baseCat, ev: m.ev_loss || 0,
    actual: a.pai, expected: e.pai, dora: [...doraSet],
    dA, dE, gain, mortalThrowsDora, rfGain,
    aNec: aStat.necessary_tiles, eNec: eStat.necessary_tiles,
  };
  for (const v of variants) {
    if (fires[v]) {
      stats[v][tag]++;
      stats[v].ev += m.ev_loss || 0;
      stats[v].cases.push(summary);
    }
  }
  if (fires.V1 && !fires.V2) mootCases.push(summary);
  if (fires.V3 && !fires.V2) v3ExtraCases.push(summary);
}

// --- report ---
const baseComplex = { P4: 0, D3: 0, OD3: 0, ev: 0 };
for (const { m } of prepped) {
  const c = categorize(m).category;
  if (COMPLEX.has(c)) { baseComplex[c]++; baseComplex.ev += m.ev_loss || 0; }
}
console.log(`Sample: ${prepped.length} mistakes`);
console.log(`Baseline complex: P4=${baseComplex.P4} D3=${baseComplex.D3} OD3=${baseComplex.OD3} ` +
  `(EV ${baseComplex.ev.toFixed(1)})`);
console.log(`Complex dahai-vs-dahai with stats on both tiles: ${complexDahai}\n`);

console.log("Variant reclassification (complex -> value):");
console.log("var   P4->P3  D3->D2  OD3->OD2  total  EV moved");
for (const v of variants) {
  const s = stats[v];
  const total = s.p4 + s.d3 + s.od3;
  console.log(
    `${v.padEnd(5)} ${String(s.p4).padStart(6)} ${String(s.d3).padStart(7)} ` +
    `${String(s.od3).padStart(9)} ${String(total).padStart(6)} ${s.ev.toFixed(1).padStart(9)}`);
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) : "0.0");
console.log("\nP4+D3 'complex' headline impact:");
const headlineBase = baseComplex.P4 + baseComplex.D3;
for (const v of variants) {
  const s = stats[v];
  const red = s.p4 + s.d3;
  console.log(`  ${v}: -${red} (${headlineBase} -> ${headlineBase - red}, ` +
    `${pct(red, headlineBase)}% of headline complex)`);
}

console.log("\nDora-ukeire gain histogram (Mortal dora-accept minus yours), complex dahai:");
for (const g of [...gainHist.keys()].sort((a, b) => a - b)) {
  console.log(`  gain ${String(g).padStart(3)}: ${gainHist.get(g)}`);
}

console.log(`\nV1\\V2 "moot" cases (Mortal gains dora-accept but discards a dora): ${mootCases.length}`);
for (const c of mootCases.slice(0, 12)) {
  console.log(`  #${c.id} g${c.game_id} ${c.baseCat} you=${c.actual} mortal=${c.expected} ` +
    `dora=${c.dora} doraUke ${c.dA}->${c.dE} ev=${c.ev.toFixed(2)}`);
}

console.log(`\nV3-extra (red-five-only) cases over V2: ${v3ExtraCases.length}`);
for (const c of v3ExtraCases.slice(0, 12)) {
  console.log(`  #${c.id} g${c.game_id} ${c.baseCat} you=${c.actual} mortal=${c.expected} ` +
    `dora=${c.dora} rfGain=${c.rfGain} eNec=${JSON.stringify(c.eNec.map(n=>n.tile))}`);
}

console.log("\nSample V2 reclassifications (manual FP check):");
for (const c of stats.V2.cases.slice(0, 16)) {
  console.log(`  #${c.id} g${c.game_id} ${c.baseCat}->${DEMOTE[c.baseCat]} you=${c.actual} ` +
    `mortal=${c.expected} dora=${c.dora} doraUke ${c.dA}->${c.dE} ev=${c.ev.toFixed(2)}`);
  console.log(`        yourNec=${JSON.stringify(c.aNec.map(n=>n.tile+":"+n.count))}`);
  console.log(`       mortalNec=${JSON.stringify(c.eNec.map(n=>n.tile+":"+n.count))}`);
}
