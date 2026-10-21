#!/usr/bin/env node
// Isolated engine cost, plus optional real prep+categorization comparisons.
// node --expose-gc scripts/hand_blocks_bench.mjs
// node --expose-gc scripts/hand_blocks_bench.mjs --db .cache/category-stats/games.db
// Inputs stay local; stdout contains aggregate timings and cache statistics only.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const moduleStart = performance.now();
const engineMod = require('../static/js/prep/hand-blocks.js');
const moduleInitMs = performance.now() - moduleStart;
const fixtures = require('../tests/fixtures/hand_blocks.json');
const { ID_TO_MJAI } = require('../static/js/prep/tiles.js');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const reps = Number(option('--reps', 3));
if (!Number.isInteger(reps) || reps < 1) throw new Error('--reps must be positive');
const percentile = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
function summary(xs) {
  return { meanMs: xs.reduce((sum, x) => sum + x, 0) / xs.length,
    medianMs: percentile(xs, 0.5), p95Ms: percentile(xs, 0.95), maxMs: Math.max(...xs) };
}
let seed = 0x12345;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const corpus = Array.from({ length: 200 }, (_, n) => {
  const counts = Array(34).fill(0);
  for (let i = 0; i < 13 + n % 2;) {
    const id = Math.floor(random() * 34);
    if (counts[id] < 4) { counts[id]++; i++; }
  }
  return counts.flatMap((count, id) => Array(count).fill(ID_TO_MJAI[id]));
});
const engineStart = performance.now();
const engine = engineMod.createEngine();
const engineInitMs = performance.now() - engineStart;
const initStart = performance.now();
engine.analyzeTiles(corpus[0]);
const firstCallMs = performance.now() - initStart;
for (const hand of corpus.slice(0, 10)) engine.analyzeTiles(hand);
const cold = [], cached = [], availability = [];
for (let rep = 0; rep < reps; rep++) {
  for (const hand of corpus) {
    engine.clearCache();
    let start = performance.now();
    const result = engine.analyzeTiles(hand);
    cold.push(performance.now() - start);
    start = performance.now();
    engine.analyzeTiles(hand);
    cached.push(performance.now() - start);
    start = performance.now();
    engineMod.evaluateAvailability(result, Array(34).fill(4));
    availability.push(performance.now() - start);
  }
}
const stress = {};
for (const [name, hand] of Object.entries(fixtures)) {
  const times = [];
  let result;
  for (let rep = 0; rep < reps; rep++) {
    engine.clearCache();
    const start = performance.now();
    result = engine.analyzeTiles(hand);
    times.push(performance.now() - start);
  }
  stress[name] = { ...summary(times), enumerated: result.standard.totalConfigurations,
    retained: result.standard.configurations.length };
}
engine.clearCache();
global.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
for (const hand of corpus) engine.analyzeTiles(hand);
global.gc?.();
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, reps, moduleInitMs, engineInitMs, firstCallMs,
  cold: summary(cold), cacheHit: summary(cached), availability: summary(availability), stress,
  cache: engine.cacheInfo(), retainedHeapBytes: process.memoryUsage().heapUsed - heapBefore,
  gcAvailable: Boolean(global.gc) }, null, 2));

// This is a benchmark-only simulated consumer. Application prep is unchanged.
// Load the same 49-game sample used by the design baseline, read-only.
if (args.includes('--db')) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = resolve(option('--db'));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const games = db.prepare('SELECT id, mortal_file, rounds_json FROM games ORDER BY id').all();
  const counts = db.prepare('SELECT COUNT(*) c FROM mistakes').get().c;
  const stride = Math.max(1, Math.floor(games.length / Math.ceil(2000 / (counts / games.length))));
  const statement = db.prepare('SELECT id, round_name, round_idx, mistake_idx, data_json, ev_loss, turn '
    + 'FROM mistakes WHERE game_id = ? ORDER BY round_idx, mistake_idx');
  const sample = [];
  let decisions = 0, missingGames = 0;
  for (let i = 0; i < games.length && decisions < 2000; i += stride) {
    const row = games[i];
    const mortalPath = resolve(dirname(dbPath), row.mortal_file || 'missing');
    if (!row.mortal_file || !existsSync(mortalPath)) { missingGames++; continue; }
    const byRound = new Map();
    for (const mistake of statement.all(row.id)) {
      if (!byRound.has(mistake.round_idx)) byRound.set(mistake.round_idx, { round: mistake.round_name, mistakes: [] });
      byRound.get(mistake.round_idx).mistakes.push({ ...JSON.parse(mistake.data_json),
        id: mistake.id, ev_loss: mistake.ev_loss, turn: mistake.turn });
    }
    const rounds = JSON.parse(row.rounds_json || '[]').map((meta, index) => ({
      ...(byRound.get(index) || { mistakes: [] }), round: meta.round_name,
    }));
    for (const index of [...byRound.keys()].sort((a, b) => a - b)) {
      if (index >= rounds.length) rounds.push(byRound.get(index));
    }
    const game = { id: row.id, rounds };
    decisions += rounds.reduce((sum, round) => sum + round.mistakes.length, 0);
    sample.push({ game, mortal: JSON.parse(readFileSync(mortalPath, 'utf8')) });
  }
  db.close();
  if (!sample.length) throw new Error('No sample games available');
  const prep = require('../static/js/prep/prep.js');
  const { categorize } = require('../static/js/categorize.js');
  const wasm = require('../static/js/prep/shanten_calc_wasm.js');
  const originalSelf = global.self;
  const endToEnd = {};
  let lastCache;
  try {
    for (const mode of ['wasm', 'js']) {
      global.self = { haipaiPrepUseWasm: mode === 'wasm', haipaiPrepShantenCalcWasm: wasm };
      const measured = { baseline: [], withBlocks: [] };
      function run(input, withBlocks) {
        const game = structuredClone(input.game);
        // Empty cache per game: no repeated-pass structural hits.
        engine.clearCache();
        const start = performance.now();
        prep.prepGame(game, input.mortal);
        for (const round of game.rounds) for (const mistake of round.mistakes) {
          if (withBlocks) {
            const hand = mistake.hand || [], melds = mistake.melds || [];
            if (hand.length === 14 - 3 * melds.length) {
              for (const action of [mistake.actual, mistake.expected]) {
                if (action?.type !== 'dahai') continue;
                const index = hand.indexOf(action.pai);
                if (index < 0) continue;
                engine.analyzeTiles(hand.filter((_, i) => i !== index), melds);
              }
            }
          }
          categorize(mistake);
        }
        const elapsed = performance.now() - start;
        lastCache = engine.cacheInfo();
        return elapsed;
      }
      for (const input of sample.slice(0, 3)) { run(input, false); run(input, true); }
      for (let rep = 0; rep < reps; rep++) {
        // Alternate order to reduce ordering bias.
        for (const key of rep % 2 ? ['withBlocks', 'baseline'] : ['baseline', 'withBlocks']) {
          measured[key].push(sample.map(input => run(input, key === 'withBlocks')));
        }
        console.error(`${mode}: pass ${rep + 1}/${reps}`);
      }
      endToEnd[mode] = Object.fromEntries(Object.entries(measured).map(([key, passes]) => [key,
        summary(sample.map((_, i) => percentile(passes.map(pass => pass[i]), 0.5)))]));
    }
  } finally { global.self = originalSelf; }
  console.log(JSON.stringify({ databaseSha256: createHash('sha256').update(readFileSync(dbPath)).digest('hex'),
    games: sample.length, decisions, missingGames, gameIds: sample.map(s => s.game.id),
    endToEnd, lastCache }, null, 2));
}
