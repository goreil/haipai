#!/usr/bin/env node
// Diff JS categorizer output against the Python ground truth in
// tests/fixtures/categorize_parity.json. Reports mismatches grouped
// by category transition, with sample IDs for digging in.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const fixturePath = resolve(repoRoot, "tests/fixtures/categorize_parity.json");
const categorizePath = resolve(repoRoot, "static/js/categorize.js");

// Load the browser-style UMD module by faking a CommonJS context.
const src = readFileSync(categorizePath, "utf8");
const ctx = { module: { exports: {} } };
ctx.exports = ctx.module.exports;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: categorizePath });
const { categorize } = ctx.module.exports;
if (typeof categorize !== "function") {
  console.error("categorize.js did not export `categorize`");
  process.exit(2);
}

const fx = JSON.parse(readFileSync(fixturePath, "utf8"));
console.log(`Loaded ${fx.fixtures.length} fixtures from ${fx.n_games} games\n`);

let total = 0;
let catMatch = 0;
let cdMatch = 0;
let labelsMatch = 0;
const transitions = new Map();
const cdMismatchSamples = new Map();
const labelMismatchSamples = [];
const catMismatchSamples = [];

function sortKeys(o) {
  if (o == null || typeof o !== "object" || Array.isArray(o)) return o;
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
  return out;
}

function deepEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

for (const f of fx.fixtures) {
  total++;
  // Carry the threatening_opponent scene flag from expected.categorize_data
  // into inputs — JS can't derive it from data_json today.
  const m = { ...f.inputs };
  if (f.expected.categorize_data && f.expected.categorize_data.threatening_opponent) {
    m.categorize_data = { ...(m.categorize_data || {}), threatening_opponent: true };
  }

  const out = categorize(m);

  if (out.category === f.expected.category) {
    catMatch++;
  } else {
    const key = `${f.expected.category} -> ${out.category}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
    if (catMismatchSamples.length < 50) {
      catMismatchSamples.push({
        id: f.mistake_id, game: f.game_id,
        py: f.expected.category, js: out.category,
      });
    }
  }

  if (deepEqual(out.categorize_data || {}, f.expected.categorize_data || {})) {
    cdMatch++;
  } else {
    const key = `${f.expected.category}`;
    if (!cdMismatchSamples.has(key)) cdMismatchSamples.set(key, []);
    if (cdMismatchSamples.get(key).length < 5) {
      cdMismatchSamples.get(key).push({
        id: f.mistake_id,
        py: f.expected.categorize_data,
        js: out.categorize_data,
      });
    }
  }

  if (deepEqual([...(out.labels || [])].sort(), [...(f.expected.labels || [])].sort())) {
    labelsMatch++;
  } else {
    if (labelMismatchSamples.length < 5) {
      labelMismatchSamples.push({
        id: f.mistake_id, py: f.expected.labels, js: out.labels,
      });
    }
  }
}

console.log(`category match:        ${catMatch}/${total} (${(catMatch / total * 100).toFixed(2)}%)`);
console.log(`categorize_data match: ${cdMatch}/${total} (${(cdMatch / total * 100).toFixed(2)}%)`);
console.log(`labels match:          ${labelsMatch}/${total} (${(labelsMatch / total * 100).toFixed(2)}%)`);

if (transitions.size > 0) {
  console.log(`\nCategory transitions (Python -> JS):`);
  const sorted = [...transitions.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`  ${k}: ${v}`);
  console.log(`\nFirst category mismatches:`);
  for (const s of catMismatchSamples.slice(0, 10)) {
    console.log(`  m=${s.id} g=${s.game}: ${s.py} -> ${s.js}`);
  }
}

if (cdMismatchSamples.size > 0) {
  console.log(`\nFirst categorize_data mismatches per category:`);
  for (const [cat, samples] of cdMismatchSamples) {
    console.log(`  ${cat}:`);
    for (const s of samples.slice(0, 2)) {
      console.log(`    m=${s.id}`);
      console.log(`      py: ${JSON.stringify(s.py)}`);
      console.log(`      js: ${JSON.stringify(s.js)}`);
    }
  }
}

if (labelMismatchSamples.length > 0) {
  console.log(`\nFirst label mismatches:`);
  for (const s of labelMismatchSamples) {
    console.log(`  m=${s.id}: py=${JSON.stringify(s.py)} js=${JSON.stringify(s.js)}`);
  }
}

const allMatch = catMatch === total && cdMatch === total && labelsMatch === total;
process.exit(allMatch ? 0 : 1);
