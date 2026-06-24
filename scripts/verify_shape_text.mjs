#!/usr/bin/env node
// Phase 2 verification: render the compositional trainer text over the frozen
// bench sample and check (a) every discard mistake produces non-empty text,
// (b) sample one card per shape per skill area for a manual read.
//
// Reuses the prep cache written by category_bench.mjs and loads the real
// browser-side scripts into a vm context, stubbing only leaf render primitives.

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// newest prepped cache
const benchDir = join(repoRoot, ".cache", "category-bench");
const cacheFile = readdirSync(benchDir)
  .filter(f => f.startsWith("prepped-"))
  .map(f => ({ f, t: statSync(join(benchDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0].f;
const prepped = JSON.parse(readFileSync(join(benchDir, cacheFile), "utf8")).mistakes;
console.log(`Loaded ${prepped.length} prepped mistakes from ${cacheFile}`);

const cmp = require(join(repoRoot, "static/js/categorize.js")); // warms compare deps
const compare = require(join(repoRoot, "static/js/compare-dimensions.js"));

// vm context with leaf stubs.
const ctx = {
  console,
  haipaiCompareDimensions: compare,
  tileBase: (t) => (t ? String(t).replace(/r$/, "") : t),
  renderTile: (t) => `[${t}]`,
  setActiveDora: () => {},
  getDoraTiles: (bs) => (bs && bs.dora_tiles) || [],
  formatAction: (a) => (a ? `${a.type}${a.pai ? " " + a.pai : ""}` : ""),
};
vm.createContext(ctx);
for (const f of ["static/js/defense-labels.js", "static/js/categorize-explanations.js"]) {
  vm.runInContext(readFileSync(join(repoRoot, f), "utf8"), ctx, { filename: f });
}

const samples = {};   // `${skill}/${shape}` -> {m, text}
let discard = 0, empty = 0, contradict = 0;
const emptyExamples = [];

for (const { m } of prepped) {
  const at = m.actual && m.actual.type, et = m.expected && m.expected.type;
  if (at !== "dahai" || et !== "dahai") continue;
  discard++;
  const wins = compare.compareDimensions(m);
  const shape = compare.deriveShape(wins, m);
  const skill = compare.skillAreaFor(m) || "(none)";
  let text;
  try { text = ctx.generateExplanation(m); }
  catch (e) { console.log("THREW:", e.message, m.id); continue; }
  const stripped = (text || "").replace(/<[^>]*>/g, "").trim();
  if (!stripped) { empty++; if (emptyExamples.length < 5) emptyExamples.push(m.id); }
  // crude contradiction check: an "obvious" card must not say "judgment call",
  // and a "complex" card must not claim Mortal "is simply better".
  if (shape === "obvious" && /judgment call/i.test(stripped)) contradict++;
  if (shape === "complex" && /simply better/i.test(stripped)) contradict++;
  const key = `${skill}/${shape}`;
  if (!samples[key]) samples[key] = { m, shape, skill, text: stripped };
}

console.log(`\nDiscard mistakes: ${discard}  |  empty text: ${empty}  |  contradictions: ${contradict}`);
if (emptyExamples.length) console.log("  empty ids:", emptyExamples.join(", "));

const ORDER = ["attack", "defense", "open_defense"];
const SHAPES = ["obvious", "trade-off", "complex"];
console.log("\n=== one card per shape per skill area ===");
for (const sk of ORDER) {
  for (const sh of SHAPES) {
    const s = samples[`${sk}/${sh}`];
    if (!s) { console.log(`\n[${sk} / ${sh}] — no sample found`); continue; }
    console.log(`\n[${sk} / ${sh}]  (#${s.m.id}: you ${s.m.actual.pai} → mortal ${s.m.expected.pai})`);
    console.log("  " + s.text);
  }
}
