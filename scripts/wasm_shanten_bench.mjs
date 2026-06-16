#!/usr/bin/env node
// Head-to-head: per-discard ukeire on 14-tile hands — the exact operation that
// dominates prep (shanten_calc.calculate is ~95% of trends wall time).
//
//   JS   = static/js/prep/shanten_calc.calculate  (brute-force: each discard x
//          34 draw candidates x full re-shanten, all in JS)
//   WASM = riichi-tools-rs find_shanten_improving_tiles via ukeire_from_text,
//          + JSON.parse of the result (marshalling counted, as it would be live)
//
//   node scripts/wasm_shanten_bench.mjs [--hands 400] [--reps 5]

import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : Number(args[i + 1]); };
const NHANDS = opt("--hands", 400);
const REPS = opt("--reps", 5);

const wasm = require(join(repoRoot, "wasm/haipai-shanten/pkg/haipai_shanten.js"));
const calc = require(join(repoRoot, "static/js/prep/shanten_calc.js"));

const BASE_TO_MJAI = [
  "1m","2m","3m","4m","5m","6m","7m","8m","9m",
  "1p","2p","3p","4p","5p","6p","7p","8p","9p",
  "1s","2s","3s","4s","5s","6s","7s","8s","9s",
  "E","S","W","N","P","F","C",
];
const SUIT_CH = ["m", "p", "s"];

// counts[34] -> mjai 14-tile list (for JS calculate)
function countsToMjai(counts) {
  const out = [];
  for (let b = 0; b < 34; b++) for (let k = 0; k < counts[b]; k++) out.push(BASE_TO_MJAI[b]);
  return out;
}
// counts[34] -> tenhou text "123m..z" (for wasm from_text)
function countsToText(counts) {
  let text = "";
  for (let s = 0; s < 3; s++) {
    let digits = "";
    for (let n = 1; n <= 9; n++) { const b = s * 9 + (n - 1); for (let k = 0; k < counts[b]; k++) digits += n; }
    if (digits) text += digits + SUIT_CH[s];
  }
  let honors = "";
  for (let h = 0; h < 7; h++) { const b = 27 + h; for (let k = 0; k < counts[b]; k++) honors += (h + 1); }
  if (honors) text += honors + "z";
  return text;
}

// seeded PRNG (mulberry32) for a reproducible corpus
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x9E3779B1);

// Build NHANDS legal 14-tile hands that are NOT already complete (shanten >= 0),
// so both kernels run the full ukeire path. Store both representations.
const corpus = [];
while (corpus.length < NHANDS) {
  const counts = new Array(34).fill(0);
  let placed = 0;
  while (placed < 14) {
    const b = Math.floor(rand() * 34);
    if (counts[b] < 4) { counts[b]++; placed++; }
  }
  const text = countsToText(counts);
  if (wasm.shanten_from_text(text) < 0) continue;   // skip complete hands
  corpus.push({ mjai: countsToMjai(counts), text });
}

// --- parity sanity on best shanten (real 14-tile hands) ------------------
let parityChecked = 0, parityMismatch = 0;
for (const h of corpus) {
  let jsSh;
  try { jsSh = calc.calculate(h.mjai, [], null).shanten; } catch { continue; }
  const wSh = JSON.parse(wasm.ukeire_from_text(h.text)).shanten;
  parityChecked++;
  if (jsSh !== wSh) parityMismatch++;
}

// --- warm up -------------------------------------------------------------
for (const h of corpus) { try { calc.calculate(h.mjai, [], null); } catch {} wasm.ukeire_from_text(h.text); }

// --- time ----------------------------------------------------------------
const now = () => process.hrtime.bigint();
const ms = (ns) => Number(ns) / 1e6;

let jsNs = 0n, jsCalls = 0;
for (let r = 0; r < REPS; r++) {
  const t = now();
  for (const h of corpus) { try { calc.calculate(h.mjai, [], null); jsCalls++; } catch {} }
  jsNs += now() - t;
}

let wasmNs = 0n, wasmCalls = 0;
for (let r = 0; r < REPS; r++) {
  const t = now();
  for (const h of corpus) { JSON.parse(wasm.ukeire_from_text(h.text)); wasmCalls++; }
  wasmNs += now() - t;
}

const jsPer = ms(jsNs) / jsCalls;
const wasmPer = ms(wasmNs) / wasmCalls;

console.log(`\nCorpus: ${corpus.length} non-complete 14-tile hands x ${REPS} reps`);
console.log(`Parity: best-shanten agrees on ${parityChecked - parityMismatch}/${parityChecked} hands` +
  (parityMismatch ? `  (${parityMismatch} MISMATCH)` : ""));
console.log("-".repeat(56));
console.log(`JS   calculate        ${ms(jsNs).toFixed(0).padStart(7)}ms total   ${jsPer.toFixed(3)} ms/call`);
console.log(`WASM ukeire+JSON.parse${ms(wasmNs).toFixed(0).padStart(7)}ms total   ${wasmPer.toFixed(3)} ms/call`);
console.log("-".repeat(56));
const speedup = jsPer / wasmPer;
console.log(`→ WASM is ${speedup.toFixed(1)}x ${speedup >= 1 ? "FASTER" : "SLOWER"} per call ` +
  `(${jsPer.toFixed(2)} -> ${wasmPer.toFixed(2)} ms)\n`);
