const assert = require('node:assert/strict');
const { test } = require('node:test');
const { categorize, doraAcceptance } = require('../static/js/categorize.js');
const fixture = require('./fixtures/dora_acceptance_m35078.json');

test('#m35078 recognizes the live red 5p acceptance', () => {
  const result = categorize(fixture);
  assert.equal(result.shape, 'obvious');
  assert.deepEqual(result.wins.find(w => w.dim === 'dora_acceptance'), {
    dim: 'dora_acceptance', group: 'Dora', prio: 2, winner: 'mortal',
    magnitude: 1, tiles: ['5pr'],
  });
});

test('unavailable or unknown red copies do not create a dora win', () => {
  const m = structuredClone(fixture);
  for (const stat of m.discard_stats) {
    for (const nt of stat.necessary_tiles) delete nt.aka_count;
  }
  assert.equal(categorize(m).shape, 'complex');
});

test('red acceptance retains the shanten gate and works in either direction', () => {
  const m = structuredClone(fixture);
  m.discard_stats.find(s => s.tile === '7p').shanten++;
  assert.equal(categorize(m).wins.find(w => w.dim === 'dora_acceptance').suppressed, true);
  m.discard_stats.find(s => s.tile === '7p').shanten--;
  [m.actual, m.expected] = [m.expected, m.actual];
  assert.equal(categorize(m).wins.find(w => w.dim === 'dora_acceptance').winner, 'you');
});

test('counts live red copies in each suit without double counting indicator dora', () => {
  for (const tile of ['5m', '5p', '5s']) {
    const stat = { necessary_tiles: [{ tile, count: 3, aka_count: 1 }] };
    assert.deepEqual(doraAcceptance(stat, []), [{ tile: tile + 'r', count: 1 }]);
    assert.deepEqual(doraAcceptance(stat, [tile]), [{ tile, count: 3 }]);
    stat.necessary_tiles[0].count = 0;
    assert.deepEqual(doraAcceptance(stat, [tile]), []);
  }
});
