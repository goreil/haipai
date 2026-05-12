// Step-1 smoke test: shanten + per-discard ukeire from the new JS modules
// matches the Python prep output stored in tests/fixtures/categorize_parity.json.
//
// Usage: node scripts/smoke_step1.mjs [N]   (default N=20)

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

function hand34ToKd(hand34) {
  const kd = new Array(38).fill(0);
  for (let b = 0; b < 34; b++) kd[baseToKd(b)] = hand34[b];
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

function shantenOf(hand34, closed) {
  const kd = hand34ToKd(hand34);
  if (closed) return shantenMod.calculateMinimumShanten(kd);
  return shantenMod.calculateStandardShanten(kd);
}

// Derive wall_remaining (34 base slots) from the fixture's board_state +
// the hand + melds. The fixture stored discard_stats was computed with a
// 37-slot wall where slots 34-36 are red fives; we only need the base
// slots (0..33) because that's what feeds necessary_tiles[].count.
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
  // opponent_melds is [{seat, melds: [{type, consumed, pai, target}]}]
  // pai is from the discarder (already in their discards), so only consumed
  // counts as additionally-visible tiles. Exception: ankan reveals all 4 of
  // a tile (consumed array of 4) — board_state doesn't seem to expose ankan
  // in opponent_melds the way it does called melds, so we mirror.
  for (const block of bs.opponent_melds || []) {
    for (const m of (block && block.melds) || []) {
      for (const c of (m && m.consumed) || []) decBase(c);
      // For ankan / kakan / daiminkan the `pai` is owned by the caller, not
      // a discarded tile — count it too.
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
  if (baseShanten === -1) return { winning: true };

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
      if (after[t] >= 4) continue;  // can't draw a 5th copy
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
  return { shanten: stats.length ? stats[0].shanten : null, stats };
}

function compareStats(actual, expected) {
  // Both lists sorted same way; compare tile-by-tile.
  if (actual.length !== expected.length) {
    return { ok: false, reason: `len ${actual.length} vs ${expected.length}` };
  }
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a.tile !== e.tile) return { ok: false, reason: `[${i}] tile ${a.tile} vs ${e.tile}` };
    if (a.shanten !== e.shanten) return { ok: false, reason: `[${i}] shanten ${a.shanten} vs ${e.shanten} on ${a.tile}` };
    if (a.necessary_count !== e.necessary_count) return { ok: false, reason: `[${i}] necessary_count ${a.necessary_count} vs ${e.necessary_count} on ${a.tile}` };
    const aTiles = new Set(a.necessary_tiles.map(n => `${n.tile}:${n.count}`));
    const eTiles = new Set(e.necessary_tiles.map(n => `${n.tile}:${n.count}`));
    if (aTiles.size !== eTiles.size) return { ok: false, reason: `[${i}] necessary_tiles size ${aTiles.size} vs ${eTiles.size} on ${a.tile}` };
    for (const k of aTiles) if (!eTiles.has(k)) return { ok: false, reason: `[${i}] missing ${k} on ${a.tile}` };
  }
  return { ok: true };
}

const fixturePath = path.join(repoRoot, "tests/fixtures/categorize_parity.json");
const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const N = parseInt(process.argv[2] || "20", 10);

// Pick mistakes that have stored discard_stats AND are dahai (full 14-tile hand).
const candidates = data.fixtures.filter(f =>
  f.inputs && f.inputs.discard_stats && f.inputs.discard_stats.length
  && f.inputs.hand && f.inputs.hand.length === 14
);

const stride = Math.max(1, Math.floor(candidates.length / N));
const samples = [];
for (let i = 0; i < candidates.length && samples.length < N; i += stride) samples.push(candidates[i]);

let pass = 0;
let fail = 0;
const failures = [];
for (const fx of samples) {
  const actual = computeStats(fx.inputs);
  if (actual.winning) {
    // Expected to be empty stats too; skip if stored disagrees.
    if (!fx.inputs.discard_stats.length) pass++;
    else { fail++; failures.push({ id: fx.mistake_id, reason: "JS says winning, fixture has stats" }); }
    continue;
  }
  const cmp = compareStats(actual.stats, fx.inputs.discard_stats);
  if (cmp.ok) pass++;
  else { fail++; failures.push({ id: fx.mistake_id, reason: cmp.reason }); }
}

console.log(`samples=${samples.length} pass=${pass} fail=${fail}`);
if (failures.length) {
  console.log("first failures:");
  for (const f of failures.slice(0, 5)) console.log("  " + f.id + ": " + f.reason);
  if (process.env.DEBUG_FX) {
    const id = parseInt(process.env.DEBUG_FX, 10);
    const fx = data.fixtures.find(f => f.mistake_id === id);
    if (fx) {
      const actual = computeStats(fx.inputs);
      console.log("\n=== DEBUG mistake_id=" + id + " ===");
      console.log("hand:", fx.inputs.hand);
      for (let i = 0; i < actual.stats.length; i++) {
        const a = actual.stats[i];
        const e = fx.inputs.discard_stats[i];
        if (!e || a.tile !== e.tile || a.necessary_count !== e.necessary_count) {
          console.log(`[${i}] JS:`, a);
          console.log(`[${i}] EX:`, e);
        }
      }
    }
  }
  process.exit(1);
}
