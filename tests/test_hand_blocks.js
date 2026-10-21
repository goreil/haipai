const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const blocks = require('../static/js/prep/hand-blocks.js');
const { calculateStandardShanten } = require('../static/js/prep/shanten.js');
const { ID_TO_MJAI } = require('../static/js/prep/tiles.js');
const fixtures = require('./fixtures/hand_blocks.json');

function conserve(result, allocation) {
  const indices = allocation.flatMap(b => b.tileIndices);
  assert.deepEqual(indices.slice().sort((a, b) => a - b), result.tiles.map((_, i) => i));
  for (const block of allocation) {
    assert.deepEqual(block.tiles, block.tileIndices.map(i => result.tiles[i]));
  }
}

test('every alternative conserves physical tiles, red identity, and disjoint allocations', () => {
  for (const hand of Object.values(fixtures)) {
    const result = blocks.analyzeTiles(hand);
    for (const config of result.standard.configurations) {
      conserve(result, config.blocks);
      for (const block of config.blocks) {
        if (['sequence', 'side', 'closed', 'edge'].includes(block.kind)) {
          assert.ok(block.tileIds.every(id => Math.floor(id / 9) === Math.floor(block.tileIds[0] / 9)));
        }
      }
    }
    conserve(result, [...result.sevenPairs.pairs, ...result.sevenPairs.leftovers]);
    conserve(result, [...result.thirteenOrphans.blocks, ...result.thirteenOrphans.leftovers]);
  }
});

test('normalized inputs, fixed meld ordering, browser/Node and cold runs are deterministic', () => {
  const engine = blocks.createEngine();
  const hand = fixtures.sevenPairs;
  const first = engine.analyzeTiles(hand);
  assert.equal(engine.analyzeTiles(hand.slice().reverse()), first);
  assert.equal(engine.analyzeHand({ counts: blocks.countsFromTiles(hand), tiles: hand }), first);
  engine.clearCache();
  assert.deepEqual(engine.analyzeTiles(hand), first);
  const context = vm.createContext({});
  for (const file of ['tiles.js', 'hand-blocks.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/prep', file), 'utf8'), context);
  }
  assert.equal(JSON.stringify(context.haipaiHandBlocks.analyzeTiles(hand)), JSON.stringify(first));
  const melds = [{ type: 'pon', tiles: ['E', 'E', 'E'] }, { type: 'chi', tiles: ['3m', '1m', '2m'] }];
  assert.equal(engine.analyzeTiles(['N'], melds), engine.analyzeTiles(['N'], melds.reverse()));
});

test('112233 retains two sequences, three pairs, competing heads and non-head pairs', () => {
  const result = blocks.analyzeTiles(['1m', '1m', '2m', '2m', '3m', '3m']);
  assert.equal(result.standard.truncated, false);
  assert.ok(result.standard.configurations.some(c => c.blocks.length === 2
    && c.blocks.every(b => b.kind === 'sequence')));
  const pairs = result.standard.configurations.filter(c => c.blocks.length === 3
    && c.blocks.every(b => b.kind === 'pair'));
  assert.deepEqual(pairs.map(c => c.headTile).sort((a, b) => (a ?? -1) - (b ?? -1)), [null, 0, 1, 2]);
  for (const c of pairs.filter(c => c.headIndex !== null)) {
    assert.equal(c.blocks.filter(b => b.role === 'head').length, 1);
    assert.equal(c.blocks.filter(b => b.role === 'triplet_candidate').length, 2);
  }
});

test('compound shapes retain overlapping possibilities through separate allocations', () => {
  for (const [hand, allocations] of [
    [['2m', '3m', '3m', '4m'], [['sequence', 'singleton'], ['side', 'side'], ['closed', 'pair']]],
    [['3m', '4m', '4m'], [['side', 'singleton'], ['singleton', 'pair']]],
  ]) {
    const result = blocks.analyzeTiles(hand);
    for (const kinds of allocations) {
      assert.ok(result.standard.configurations.some(c => c.blocks.map(b => b.kind).sort().join()
        === kinds.slice().sort().join()), kinds.join());
    }
  }
});

test('six-block plans expose competing candidates, and singles never become formed blocks', () => {
  const result = blocks.analyzeTiles(fixtures.sixBlocks);
  const plan = result.standard.configurations.find(c => c.candidateBlockCount === 6 && c.headTile === 27
    && c.completeSets === 2);
  assert.ok(plan);
  assert.equal(plan.excessCandidates, 1);
  assert.equal(plan.missingSlots, 0);
  const singles = blocks.analyzeTiles(['1m', '4p', '8s', 'E']);
  assert.equal(singles.standard.configurations[0].candidateBlockCount, 0);
  assert.equal(singles.standard.configurations[0].missingSetSlots, 4);
  assert.equal(singles.standard.configurations[0].missingHead, true);
});

test('North tanki reproduction needs a head; a separate hand has a leftover alongside five blocks', () => {
  for (const discarded of ['5p', 'N']) {
    const hand = fixtures.northPairWait.filter(t => t !== discarded);
    const result = blocks.analyzeTiles(hand);
    const plan = result.standard.configurations[0];
    assert.equal(plan.shanten, 0);
    assert.equal(plan.completeSets, 4);
    assert.equal(plan.missingHead, true);
    const singleton = plan.blocks.find(b => b.kind === 'singleton');
    assert.equal(singleton.role, 'head_candidate');
    assert.equal(singleton.tiles[0], discarded === '5p' ? 'N' : '5p');
    const wall = Array(34).fill(0);
    wall[13] = wall[30] = 3;
    assert.equal(blocks.evaluateAvailability(result, wall).configurations[0].liveCompletionCount, 3);
  }
  const result = blocks.analyzeTiles(fixtures.spareCandidate);
  const plan = result.standard.configurations[0];
  assert.equal(plan.candidateBlockCount, 5);
  assert.equal(plan.missingSlots, 0);
  assert.equal(plan.blocks.find(b => b.tiles[0] === 'N').role, 'unassigned');
  assert.equal(Object.hasOwn(plan, 'safeSpare'), false);
});

test('all kan types occupy one fixed slot; concealed quads remain regroupable', () => {
  for (const type of ['ankan', 'kakan', 'daiminkan', 'pon', 'chi']) {
    const meld = type === 'chi' ? { type, pai: '3m', consumed: ['1m', '2m'] }
      : type === 'ankan' ? { type, consumed: Array(4).fill('E') }
      : { type, pai: 'E', consumed: Array(type === 'pon' ? 2 : 3).fill('E') };
    const result = blocks.analyzeTiles(['N', 'N'], [meld]);
    assert.equal(result.fixedMelds.length, 1);
    assert.equal(result.fixedMelds[0].tiles.length, ['pon', 'chi'].includes(type) ? 3 : 4);
    assert.ok(result.standard.configurations.every(c => c.completeSets === 1));
    assert.equal(result.sevenPairs, null);
    assert.equal(result.thirteenOrphans, null);
    result.standard.configurations.forEach(c => conserve(result, c.blocks));
  }
  const concealed = blocks.analyzeTiles(Array(4).fill('E'));
  assert.ok(concealed.standard.configurations.some(c => c.blocks.map(b => b.kind).join() === 'triplet,singleton'));
  assert.ok(concealed.standard.configurations.some(c => c.blocks.every(b => b.kind === 'pair')));
  assert.ok(concealed.standard.configurations.every(c => !c.blocks.some(b => b.kind === 'kan')));
  assert.equal(concealed.sevenPairs.pairs.length, 1);
  const stored = blocks.analyzeTiles(['N'], [{ type: 'kakan', pai: '5m', consumed: ['5m', '5m'],
    previous_pon_pai: '5mr', previous_pon_target: 2 }]);
  assert.deepEqual(stored.fixedMelds[0].tiles, ['5m', '5m', '5m', '5mr']);
  assert.equal(stored.standard.configurations[0].completeSets, 1);
});

test('seven pairs and thirteen orphans keep independent interpretations and full tile allocation', () => {
  const seven = blocks.analyzeTiles(fixtures.sevenPairs);
  assert.equal(seven.sevenPairs.shanten, -1);
  assert.equal(seven.standard.shanten, 3);
  assert.equal(blocks.analyzeTiles(fixtures.thirteenOrphans).thirteenOrphans.shanten, -1);
  const thirteen = blocks.analyzeTiles(fixtures.thirteenOrphans.slice(0, 13)).thirteenOrphans;
  assert.equal(thirteen.shanten, 0);
  assert.equal(thirteen.headTile, null);
  assert.deepEqual(thirteen.missingTileIds, []);
  const twoHeads = blocks.analyzeTiles(['1m', '1m', '9m', '9m']).thirteenOrphans;
  assert.deepEqual(twoHeads.possibleHeads, [0, 8]);
});

test('outside compatibility is allocation evidence, including fixed middle sets and alternative 123s', () => {
  const alternative = blocks.analyzeTiles(fixtures.alternativeOutside);
  assert.ok(alternative.standard.configurations.some(c => c.shanten === -1 && c.outsideCompatible));
  assert.ok(alternative.standard.configurations.some(c => !c.outsideCompatible && c.headTile === 2));
  const middle = blocks.analyzeTiles(fixtures.middleHead);
  assert.ok(middle.standard.configurations.filter(c => c.shanten === -1).every(c => !c.outsideCompatible));
  const fixed = blocks.analyzeTiles(['1p', '2p', '3p', 'E', 'E'],
    [{ type: 'pon', consumed: ['3m', '3m'], pai: '3m' }]);
  assert.ok(fixed.standard.configurations.every(c => !c.outsideCompatible));
  assert.equal(Object.hasOwn(alternative, 'yaku'), false);
});

test('live waits respect geometry, dead tiles, shared draws, kans, and changing contexts', () => {
  const result = blocks.analyzeTiles(['2m', '3m', '2m', '3m', 'E', 'E']);
  const index = result.standard.configurations.findIndex(c => c.blocks.length === 3
    && c.blocks.filter(b => b.kind === 'side').length === 2 && c.headTile === 27);
  assert.ok(index >= 0);
  const wall = Array(37).fill(0);
  wall[0] = 3; wall[3] = 2;
  const live = blocks.evaluateAvailability(result, wall).configurations[index];
  assert.equal(live.liveCompletionCount, 5);
  assert.equal(live.blocks.reduce((sum, b) => sum + b.liveCompletionCount, 0), 10);
  wall[0] = wall[3] = 0;
  assert.ok(blocks.evaluateAvailability(result, wall).configurations[index].blocks
    .filter(b => b.completions.length).every(b => b.dead));
  assert.equal(live.liveCompletionCount, 5);
  for (const [tiles, kind, completions] of [
    [['1m', '2m'], 'edge', [2]], [['8m', '9m'], 'edge', [6]],
    [['2m', '4m'], 'closed', [2]], [['8m', '1p'], 'singleton', []],
  ]) {
    const plan = blocks.analyzeTiles(tiles).standard.configurations[0];
    assert.ok(plan.blocks.every(b => b.kind === kind));
    if (kind !== 'singleton') assert.deepEqual(plan.blocks[0].completionTileIds, completions);
  }
  const kan = blocks.analyzeTiles(['2m', '3m'], [{ type: 'ankan', tiles: Array(4).fill('1m') }]);
  const limited = blocks.evaluateAvailability(kan, Array(34).fill(4)).configurations[0];
  assert.equal(limited.completionTiles.find(t => t.tileId === 0).count, 0);
});

test('structural shanten agrees with the independent standard engine on seeded open and closed hands', () => {
  let seed = 0x12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const engine = blocks.createEngine({ cacheSize: 0, maxConfigurations: 16 });
  for (let n = 0; n < 250; n++) {
    const fixedCount = n % 5;
    const melds = Array.from({ length: fixedCount }, (_, i) => ({ type: i % 2 ? 'ankan' : 'pon',
      tiles: Array(i % 2 ? 4 : 3).fill(ID_TO_MJAI[27 + i]) }));
    const counts = Array(34).fill(0);
    const owned = Array(34).fill(0);
    melds.flatMap(m => m.tiles).forEach(t => owned[blocks.countsFromTiles([t]).findIndex(c => c > 0)]++);
    for (let placed = 0; placed < 13 + n % 2 - fixedCount * 3;) {
      const id = Math.floor(random() * 34);
      if (counts[id] + owned[id] < 4) { counts[id]++; placed++; }
    }
    const kd = Array(38 + fixedCount).fill(0);
    counts.forEach((count, id) => { kd[id + 1 + Math.floor(id / 9)] = count; });
    for (let i = 0; i < fixedCount; i++) kd[38 + i] = 3;
    const result = engine.analyzeHand({ counts, melds });
    assert.equal(result.standard.shanten, calculateStandardShanten(kd), `seeded hand ${n}`);
    assert.equal(result.standard.configurations[0].shanten, result.standard.shanten);
  }
  for (const hand of Object.values(fixtures)) {
    const kd = Array(38).fill(0);
    blocks.countsFromTiles(hand).forEach((count, id) => { kd[id + 1 + Math.floor(id / 9)] = count; });
    assert.equal(engine.analyzeTiles(hand).standard.shanten, calculateStandardShanten(kd));
  }
});

test('cache identity includes red copies and kan type; caller mutations cannot poison results', () => {
  const engine = blocks.createEngine();
  const counts = blocks.countsFromTiles(['5m', '5m']);
  const regular = engine.analyzeHand({ counts: new Uint8Array(counts) });
  const tiles = ['5m', '5mr'];
  const red = engine.analyzeHand({ counts, tiles });
  assert.notEqual(red, regular);
  counts[4] = 0;
  tiles[0] = 'E';
  assert.deepEqual(red.tiles, ['5m', '5mr']);
  assert.equal(red.counts[4], 2);
  const ankan = engine.analyzeTiles(['N'], [{ type: 'ankan', tiles: Array(4).fill('E') }]);
  const open = engine.analyzeTiles(['N'], [{ type: 'daiminkan', tiles: Array(4).fill('E') }]);
  assert.notEqual(ankan, open);
  const noCache = blocks.createEngine({ cacheSize: 0 });
  assert.notEqual(noCache.analyzeTiles(['N']), noCache.analyzeTiles(['N']));
  assert.equal(noCache.cacheInfo().size, 0);
});

test('retention is bounded and explicit; results are immutable and LRU caches evict', () => {
  const engine = blocks.createEngine({ cacheSize: 2, maxConfigurations: 8 });
  const dense = engine.analyzeTiles(fixtures.dense);
  assert.equal(dense.standard.configurations.length, 8);
  assert.ok(dense.standard.totalConfigurations > 10000);
  assert.equal(dense.standard.truncated, true);
  assert.equal(dense.standard.exhaustive, true);
  assert.ok(Object.isFrozen(dense.standard.configurations[0].blocks[0].tiles));
  assert.throws(() => dense.tiles.push('N'), TypeError);
  const second = engine.analyzeTiles(['E']);
  assert.equal(engine.analyzeTiles(fixtures.dense), dense);
  engine.analyzeTiles(['N']);
  assert.notEqual(engine.analyzeTiles(['E']), second);
  assert.deepEqual(engine.cacheInfo(), { size: 2, capacity: 2, hits: 1, misses: 4, maxConfigurations: 8 });
  engine.clearCache();
  assert.equal(engine.cacheInfo().size, 0);
});

test('reject invalid counts, impossible tiles, excess tiles, malformed melds and invalid context', () => {
  for (const counts of [[], Array(34).fill(-1), Array(34).fill(0.5), Array(34).fill(5)]) {
    assert.throws(() => blocks.analyzeHand({ counts }));
  }
  assert.throws(() => blocks.analyzeTiles(['0m']));
  assert.throws(() => blocks.analyzeTiles(['toString']));
  assert.throws(() => blocks.analyzeTiles(Array(5).fill('E')));
  assert.throws(() => blocks.analyzeTiles(['5mr', '5mr']));
  assert.throws(() => blocks.analyzeTiles(Array(15).fill('1m')));
  assert.throws(() => blocks.analyzeHand({ counts: Array(34).fill(0), tiles: ['N'] }));
  for (const meld of [
    { type: 'kan', tiles: Array(4).fill('E') }, { type: 'pon', tiles: ['E', 'E'] },
    { type: 'chi', tiles: ['8m', '9m', '1p'] }, { type: 'pon', tiles: ['E', 'E', 'N'] },
  ]) assert.throws(() => blocks.analyzeTiles([], [meld]));
  assert.throws(() => blocks.analyzeTiles(['E'], [{ type: 'ankan', tiles: Array(4).fill('E') }]));
  assert.throws(() => blocks.createEngine({ maxConfigurations: 0 }));
  assert.throws(() => blocks.createEngine({ cacheSize: -1 }));
  assert.throws(() => blocks.evaluateAvailability(blocks.analyzeTiles(['E']), []));
});
