#!/usr/bin/env node
// Correctness gate for the riichi-tools-rs WASM shanten kernel.
//
// Runs every hand in shanten_test.txt through BOTH:
//   - the new WASM kernel (wasm/haipai-shanten/pkg, fast_shanten feature)
//   - our current JS kernel (static/js/prep/shanten.js, calculateMinimumShanten)
// and compares each against the expected shanten annotated in the file.
//
//   node scripts/wasm_shanten_verify.mjs

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const wasm = require(join(repoRoot, "wasm/haipai-shanten/pkg/haipai_shanten.js"));
const jsShanten = require(join(repoRoot, "static/js/prep/shanten.js"));

// tenhou text ("456p111m246s1122z") -> KD 38-array (see prep/shanten.js header).
const SUIT_BASE = { m: 0, p: 10, s: 20 };
function textToKd(text) {
  const kd = new Array(38).fill(0);
  let digits = "";
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") { digits += ch; continue; }
    const isHonor = ch === "z";
    for (const d of digits) {
      let n = Number(d);
      if (!isHonor && n === 0) n = 5; // red five -> base five
      const idx = isHonor ? 30 + n : SUIT_BASE[ch] + n;
      kd[idx] += 1;
    }
    digits = "";
  }
  return kd;
}

const txt = readFileSync(join(repoRoot, "shanten_test.txt"), "utf8");
const cases = [];
for (const raw of txt.split("\n")) {
  const line = raw.replace(/\/\/.*$/, "").trim();   // strip // comments
  if (!line) continue;
  const m = line.match(/^([0-9mspz]+)\s+(-?\d+)/);
  if (!m) continue;
  cases.push({ hand: m[1], expected: Number(m[2]) });
}

let wasmFail = 0, jsFail = 0;
console.log("HAND".padEnd(26) + "exp   wasm   js");
console.log("-".repeat(46));
for (const c of cases) {
  const w = wasm.shanten_from_text(c.hand);
  const j = jsShanten.calculateMinimumShanten(textToKd(c.hand));
  const wOk = w === c.expected, jOk = j === c.expected;
  if (!wOk) wasmFail++;
  if (!jOk) jsFail++;
  if (!wOk || !jOk) {
    console.log(
      c.hand.padEnd(26) +
      String(c.expected).padStart(3) +
      String(w).padStart(7) + (wOk ? " " : "✗") +
      String(j).padStart(6) + (jOk ? " " : "✗"));
  }
}
console.log("-".repeat(46));
console.log(`${cases.length} cases — wasm mismatches: ${wasmFail}, js mismatches: ${jsFail}`);
console.log(wasmFail === 0
  ? "✓ WASM matches expected on every case."
  : `✗ WASM disagrees on ${wasmFail} case(s) (shown above).`);
