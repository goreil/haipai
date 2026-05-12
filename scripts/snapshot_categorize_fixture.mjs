#!/usr/bin/env node
// Re-snapshot the JS categorizer's output into
// tests/fixtures/categorize_parity.json. The fixture's `expected` block
// was originally the (now-removed) Python categorizer's output; with the
// frontend owning the rules, this script makes the fixture a regression
// snapshot of the JS categorizer instead.
//
// Inputs (`hand`, `discard_stats`, `board_state`, …) are untouched.
// `expected.{category, categorize_data, labels}` is overwritten with the
// current `categorize.js` output.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const fixturePath = resolve(repoRoot, "tests/fixtures/categorize_parity.json");
const categorizePath = resolve(repoRoot, "static/js/categorize.js");

const src = readFileSync(categorizePath, "utf8");
const ctx = { module: { exports: {} } };
ctx.exports = ctx.module.exports;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: categorizePath });
const { categorize } = ctx.module.exports;

const fx = JSON.parse(readFileSync(fixturePath, "utf8"));
let updated = 0;
for (const f of fx.fixtures) {
  const out = categorize(f.inputs);
  f.expected = {
    category: out.category,
    categorize_data: out.categorize_data,
    labels: out.labels,
  };
  updated++;
}

writeFileSync(fixturePath, JSON.stringify(fx));
console.log(`Re-snapshotted ${updated} fixtures -> ${fixturePath}`);

const byCat = {};
for (const f of fx.fixtures) {
  const c = f.expected.category;
  byCat[c] = (byCat[c] || 0) + 1;
}
for (const c of Object.keys(byCat).sort()) console.log(`  ${c}: ${byCat[c]}`);
