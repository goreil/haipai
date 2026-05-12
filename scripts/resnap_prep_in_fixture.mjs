#!/usr/bin/env node
// Re-snapshot the prep fields (discard_stats, best_discard) inside
// tests/fixtures/categorize_parity.json using the JS prep modules. Used
// when an intentional JS algorithm change shifts the prep output
// (e.g. swapping `mahjong` lib's simplified chiitoitsu formula for KD's
// more accurate one).
//
// Steps after running this:
//   1. node scripts/snapshot_categorize_fixture.mjs   # refresh `expected`
//   2. node scripts/verify_categorize_js.mjs          # confirm rule parity
//
// Mirrors the wall-derivation logic in scripts/smoke_step1.mjs so the JS
// output here matches what production prep will produce in Step 6.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const shantenMod = require(path.join(repoRoot, "static/js/prep/shanten.js"));

const MJAI_TO_BASE = {
  "1m": 0, "2m": 1, "3m": 2, "4m": 3, "5m": 4, "6m": 5, "7m": 6, "8m": 7, "9m": 8,
  "1p": 9, "2p": 10, "3p": 11, "4p": 12, "5p": 13, "6p": 14, "7p": 15, "8p": 16, "9p": 17,
  "1s": 18, "2s": 19, "3s": 20, "4s": 21, "5s": 22, "6s": 23, "7s": 24, "8s": 25, "9s": 26,
  "E": 27, "S": 28, "W": 29, "N": 30, "P": 31, "F": 32, "C": 33,
  "5mr": 4, "5pr": 13, "5sr": 22,
};
const BASE_TO_MJAI = [
  "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
  "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
  "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
  "E", "S", "W", "N", "P", "F", "C",
];

function baseToKd(b) {
  if (b < 9) return b + 1;
  if (b < 18) return b + 2;
  if (b < 27) return b + 3;
  return b + 4;
}

function hand34ToKd(h34) {
  const kd = new Array(38).fill(0);
  for (let b = 0; b < 34; b++) kd[baseToKd(b)] = h34[b];
  return kd;
}

function handMjaiToCounts(handMjai) {
  const c = new Array(34).fill(0);
  const red = new Set();
  for (const t of handMjai) {
    const b = MJAI_TO_BASE[t];
    if (b === undefined) throw new Error("unknown tile " + t);
    c[b]++;
    if (t === "5mr" || t === "5pr" || t === "5sr") red.add(b);
  }
  return { hand34: c, red };
}

function displayName(baseId, red) {
  if (baseId === 4 && red.has(4)) return "5mr";
  if (baseId === 13 && red.has(13)) return "5pr";
  if (baseId === 22 && red.has(22)) return "5sr";
  return BASE_TO_MJAI[baseId];
}

function shantenOf(h34, closed) {
  const kd = hand34ToKd(h34);
  return closed ? shantenMod.calculateMinimumShanten(kd)
                : shantenMod.calculateStandardShanten(kd);
}

function deriveWall(mistake) {
  const wall = new Array(34).fill(4);
  function decBase(t) {
    const b = MJAI_TO_BASE[t];
    if (b !== undefined && wall[b] > 0) wall[b]--;
  }
  for (const t of mistake.hand || []) decBase(t);
  for (const m of mistake.melds || []) {
    if (m.pai) decBase(m.pai);
    for (const c of m.consumed || []) decBase(c);
  }
  const bs = mistake.board_state || {};
  for (const t of bs.dora_indicators || []) decBase(t);
  for (const seat of bs.all_discards || []) {
    for (const d of (seat && seat.discards) || []) {
      const t = typeof d === "string" ? d : (d && d.tile);
      if (t) decBase(t);
    }
  }
  for (const block of bs.opponent_melds || []) {
    for (const m of (block && block.melds) || []) {
      for (const c of (m && m.consumed) || []) decBase(c);
      if (m && (m.type === "ankan" || m.type === "kakan") && m.pai) decBase(m.pai);
    }
  }
  return wall;
}

function computeStats(mistake) {
  const { hand34, red } = handMjaiToCounts(mistake.hand);
  const closed = !(mistake.melds && mistake.melds.length);
  const wall = deriveWall(mistake);

  const baseShanten = shantenOf(hand34, closed);
  if (baseShanten === -1) return null; // winning — skip

  const seen = new Set();
  const stats = [];
  for (let baseId = 0; baseId < 34; baseId++) {
    if (hand34[baseId] === 0 || seen.has(baseId)) continue;
    seen.add(baseId);
    const after = hand34.slice();
    after[baseId]--;
    const sh = shantenOf(after, closed);

    const necessary = [];
    for (let t = 0; t < 34; t++) {
      if (after[t] >= 4) continue;
      const trial = after.slice();
      trial[t]++;
      if (shantenOf(trial, closed) < sh) {
        necessary.push({ tile: BASE_TO_MJAI[t], count: wall[t] });
      }
    }
    stats.push({
      tile: displayName(baseId, red),
      shanten: sh,
      necessary_count: necessary.reduce((s, n) => s + n.count, 0),
      necessary_tiles: necessary,
    });
  }
  stats.sort((a, b) => (a.shanten - b.shanten) || (b.necessary_count - a.necessary_count));
  return stats;
}

const fixturePath = path.join(repoRoot, "tests/fixtures/categorize_parity.json");
const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

let updated = 0;
let changed = 0;
let skipped = 0;
const driftSamples = [];

for (const fx of data.fixtures) {
  const inp = fx.inputs;
  if (!inp.discard_stats || !inp.discard_stats.length) { skipped++; continue; }
  if (!inp.hand || inp.hand.length !== 14) { skipped++; continue; }
  const fresh = computeStats(inp);
  if (!fresh) { skipped++; continue; }

  const prev = inp.discard_stats;
  const same = JSON.stringify(prev) === JSON.stringify(fresh);
  if (!same) {
    changed++;
    if (driftSamples.length < 5) driftSamples.push({
      id: fx.mistake_id,
      prev_top: { tile: prev[0].tile, sh: prev[0].shanten, nc: prev[0].necessary_count },
      new_top: { tile: fresh[0].tile, sh: fresh[0].shanten, nc: fresh[0].necessary_count },
    });
  }
  inp.discard_stats = fresh;
  inp.best_discard = fresh[0].tile;
  updated++;
}

fs.writeFileSync(fixturePath, JSON.stringify(data));
console.log(`updated=${updated} changed=${changed} skipped=${skipped}`);
if (driftSamples.length) {
  console.log("drift samples:");
  for (const d of driftSamples) console.log("  " + JSON.stringify(d));
}
