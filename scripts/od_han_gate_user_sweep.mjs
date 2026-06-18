#!/usr/bin/env node
// Open-defense 1-call han-gate sweep — goreil's han model (2026-06-18).
// See [[od-han-gate-sweep]]. Companion to scripts/od_han_gate_sweep.mjs, which
// used `han = 1 + yakuhai_han + meld_dora` (single yakuhai = 2 han). This file
// uses goreil's model instead:
//
//   han = max(1, yakuhai_han) + meld_dora
//
//   - every open hand has a yaku  -> base 1 han
//   - a single yakuhai IS that yaku, so it stays 1 han (not 2)
//   - round+seat double wind counts twice -> 2 han
//   - each exposed dora (incl. aka) -> +1 han
//
//   1 han: any bare call / single yakuhai, no dora
//   2 han: double wind, OR 1 dora
//   3 han: 2 dora
//   4 han: 3 dora, OR double wind + 2 dora
//   5 han: 4 dora, OR double wind + 3 dora
//
// Gate "han>=N" keeps a single-call open threat only when its han >= N (the 2+
// call V7 shipped gate is always kept on top). Requires a SWEEP1-prepped cache.
//
//   node scripts/od_han_gate_user_sweep.mjs [cacheFile]

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { categorize } = require(join(repoRoot, "static/js/categorize.js"));

const GATES = [1, 2, 3, 4, 5]; // han>=N single-call clause (1 = keep every call)

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
if (!cacheFile) { console.error("No prepped cache."); process.exit(1); }
const prepped = JSON.parse(readFileSync(cacheFile, "utf8")).mistakes;
console.error(`Loaded ${prepped.length} mistakes from ${cacheFile.split("/").pop()}`);

const anyTagged = prepped.some(({ m }) =>
  (m.per_threat || []).some(t => t && t.kind === "open" && t.yakuhai_han != null));
if (!anyTagged) {
  console.error('Cache has no SWEEP1 han metadata — re-prep with OPEN_TRIGGER_VARIANT="SWEEP1".');
  process.exit(1);
}

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

function catWith(m, keepOpen) {
  const threats = m.per_threat || [];
  const kept = threats.filter(t => (t.kind !== "open" ? true : keepOpen(t)));
  const m2 = { ...m, per_threat: kept, dealin_rates: recombineDealin(kept) };
  return categorize(m2).category;
}

// goreil's han model.
const gHan = t => Math.max(1, t.yakuhai_han || 0) + (t.meld_dora || 0);
const keepV7   = t => t.open_melds >= 2;                       // shipped baseline
const keepGate = N => t => t.open_melds >= 2 || gHan(t) >= N;

const PUSH = new Set(["P1", "P2", "P3", "P4"]);
const pct = (n, d) => d ? (n / d * 100).toFixed(0) + "%" : "—";
const sample = prepped.length;

// ── 0) single-call han histogram (the shape we're gating on) ─────────────────
const hist = {};
const gamesAll = new Set();
for (const { m, game_id } of prepped) {
  gamesAll.add(game_id);
  for (const t of m.per_threat || []) {
    if (t && t.kind === "open" && t.open_melds === 1) {
      const h = gHan(t);
      hist[h] = (hist[h] || 0) + 1;
    }
  }
}

// ── reference distributions (riichi-D and V7-OD) ─────────────────────────────
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

// ── per-gate sweep ───────────────────────────────────────────────────────────
function runGate(N) {
  const keep = keepGate(N);
  const switchMat = {};
  const added = { OD1: 0, OD2: 0, OD3: 0 };
  const addedEv = { OD1: 0, OD2: 0, OD3: 0 };
  const fromCount = { P1: 0, P2: 0, P3: 0, P4: 0 };
  const games = new Set();             // games gaining >=1 new OD
  const pool = { OD1: 0, OD2: 0, OD3: 0, evOD1: 0, evTot: 0, games: new Set() };
  for (const { m, game_id } of prepped) {
    const base = catWith(m, keepV7);
    const gate = catWith(m, keep);
    if (gate[0] === "O") {
      pool[gate]++; pool.evTot += m.ev_loss || 0; pool.games.add(game_id);
      if (gate === "OD1") pool.evOD1 += m.ev_loss || 0;
    }
    if (PUSH.has(base) && gate[0] === "O") {
      switchMat[`${base}->${gate}`] = (switchMat[`${base}->${gate}`] || 0) + 1;
      added[gate]++; addedEv[gate] += m.ev_loss || 0;
      fromCount[base]++; games.add(game_id);
    }
  }
  return { N, switchMat, added, addedEv, fromCount, games, pool };
}
const gateResults = GATES.map(runGate);

// ── output ───────────────────────────────────────────────────────────────────
const dTot = D.D1 + D.D2 + D.D3;
const odTot = ODv7.OD1 + ODv7.OD2 + ODv7.OD3;

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════");
console.log(` OD 1-CALL HAN-GATE — goreil model   (sample = ${sample} mistakes, ${gamesAll.size} games)`);
console.log("══════════════════════════════════════════════════════════════════════════");
console.log("han = max(1, yakuhai_han) + meld_dora   |   gate: keep call if melds>=2 OR han>=N\n");

console.log("── 0) SINGLE-CALL OPEN THREATS BY HAN  (the population the gate filters) ──");
const hmax = Math.max(...Object.keys(hist).map(Number));
let cum = 0;
const totalCalls = Object.values(hist).reduce((a, b) => a + b, 0);
for (let h = hmax; h >= 1; h--) cum += hist[h] || 0; // (just to compute total via loop not needed)
let atLeast = 0;
const histRows = [];
for (let h = hmax; h >= 1; h--) {
  atLeast += hist[h] || 0;
  histRows.unshift({ h, n: hist[h] || 0, atLeast });
}
console.log("han      threats   cumulative(han>=)   ");
for (const r of histRows) {
  console.log(`${r.h} han`.padEnd(9) + String(r.n).padStart(7) + "      " +
    `${r.atLeast}`.padStart(5) + ` (${pct(r.atLeast, totalCalls)} of calls)`);
}
console.log("");

console.log("── BASELINES ─────────────────────────────────────────────────────────────");
console.log(`Riichi Defense (D)            D1 ${D.D1} (${pct(D.D1, dTot)})  D2 ${D.D2} (${pct(D.D2, dTot)})  D3 ${D.D3} (${pct(D.D3, dTot)})   total ${dTot}, D1-EV ${pct(D.evD1, D.evTot)}`);
console.log(`Open Defense (V7, melds>=2)  OD1 ${ODv7.OD1} (${pct(ODv7.OD1, odTot)}) OD2 ${ODv7.OD2} (${pct(ODv7.OD2, odTot)}) OD3 ${ODv7.OD3} (${pct(ODv7.OD3, odTot)})  total ${odTot}, OD1-EV ${pct(ODv7.evOD1, ODv7.evTot)}  (${ODv7.games.size} games)`);
console.log("");

console.log("── 1) THE TRADEOFF TABLE  (capture ↑ vs noise ↓) ───────────────────────────");
console.log("Each row = V7 plus a 1-call han>=N clause. 'new' = Push→OD switches the");
console.log("clause adds; OD1=Defend(good), OD2=Push, OD3=Complex(noise).");
console.log("");
console.log("Gate        new   games    new-OD1   new-OD2   new-OD3   OD1%  OD1-EV%   |  combined OD pool: OD1 / OD2 / OD3  (OD1%, games)");
console.log("-".repeat(118));
// V7-only reference row
console.log(
  "V7 only".padEnd(11) +
  "    —".padStart(6) + "  " + String(ODv7.games.size).padStart(5) + "      " +
  "—".padStart(7) + "   " + "—".padStart(7) + "   " + "—".padStart(7) + "    " +
  "—".padStart(4) + "  " + "—".padStart(6) + "   |  " +
  `${ODv7.OD1} / ${ODv7.OD2} / ${ODv7.OD3}`.padEnd(18) +
  `  (${pct(ODv7.OD1, odTot)}, ${ODv7.games.size} games)`
);
for (const r of gateResults) {
  const t = r.added.OD1 + r.added.OD2 + r.added.OD3;
  const evT = r.addedEv.OD1 + r.addedEv.OD2 + r.addedEv.OD3;
  const pt = r.pool.OD1 + r.pool.OD2 + r.pool.OD3;
  console.log(
    `+ han>=${r.N}`.padEnd(11) +
    String(t).padStart(5) + "  " + String(r.games.size).padStart(5) + "    " +
    `${r.added.OD1} (${pct(r.added.OD1, t)})`.padStart(9) + " " +
    `${r.added.OD2} (${pct(r.added.OD2, t)})`.padStart(9) + " " +
    `${r.added.OD3} (${pct(r.added.OD3, t)})`.padStart(9) + "  " +
    pct(r.added.OD1, t).padStart(4) + "  " +
    pct(r.addedEv.OD1, evT).padStart(6) + "   |  " +
    `${r.pool.OD1} / ${r.pool.OD2} / ${r.pool.OD3}`.padEnd(18) +
    `  (${pct(r.pool.OD1, pt)}, ${r.pool.games.size} games)`
  );
}
console.log("");

console.log("── 2) WHERE SWITCHES CAME FROM (source Push tier; P4 = Complex bucket) ──────");
console.log("Gate        from P1   from P2   from P3   from P4");
console.log("-".repeat(54));
for (const r of gateResults) {
  console.log(
    `+ han>=${r.N}`.padEnd(11) +
    String(r.fromCount.P1).padStart(7) +
    String(r.fromCount.P2).padStart(10) +
    String(r.fromCount.P3).padStart(10) +
    String(r.fromCount.P4).padStart(10)
  );
}
console.log("");
