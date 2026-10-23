const assert = require('node:assert/strict');
const { test } = require('node:test');
const prep = require('../static/js/prep/hand-block-view.js');
const fixtures = require('./fixtures/hand_blocks.json');

test('full-hand grouping is lazy, cached and independent of discard selection', () => {
  prep.clearCache();
  const m = {hand: fixtures.northPairWait.slice()};
  const original = JSON.stringify(m);
  assert.ok(prep.canGroup(m));
  assert.equal(prep.cacheInfo().misses, 0);
  const first = prep.prepareHand(m);
  const again = prep.prepareHand({...m, actual:{type:'dahai',pai:'N'}});
  assert.equal(first.result, again.result);
  assert.equal(first.result.tiles.length, 14);
  assert.equal(prep.cacheInfo().misses, 1);
  assert.equal(JSON.stringify(m), original);
  for (const option of first.options) assert.equal(option.blocks.flatMap(b => b.tiles).length, 14);
});

test('meaningful full-hand alternatives include six blocks and competing heads', () => {
  const six = prep.prepareHand({hand:fixtures.sixBlocks});
  assert.ok(six.options.some(o => o.config.candidateBlockCount === 6));
  const dense = prep.prepareHand({hand:fixtures.dense});
  assert.ok(new Set(dense.options.filter(o => o.id.startsWith('standard')).map(o => o.config.headTile)).size > 1);
  assert.ok(dense.options.length <= 10);
  for (const option of dense.options) {
    assert.equal(option.blocks.flatMap(b => b.tiles).length, 14);
    assert.ok(option.shanten >= dense.options[0].shanten);
    assert.equal(option.blocks.flatMap(b => b.tiles).filter(t => t === '5mr').length, 1);
  }
});

test('special hands remain separate and fixed kans count as one set', () => {
  for (const name of ['sevenPairs','thirteenOrphans']) {
    const prepared = prep.prepareHand({hand:fixtures[name]});
    assert.equal(prepared.options[0].id, name);
    assert.ok(prepared.options.some(o => o.id.startsWith('standard')));
  }
  const prepared = prep.prepareHand({hand:['1m','2m','3m','4m','5m','6m','7p','8p','9p','N','S'],
    melds:[{type:'ankan',consumed:['E','E','E','E']}]});
  assert.equal(prepared.result.tiles.length, 11);
  assert.equal(prepared.result.fixedMelds.length, 1);
  assert.equal(prepared.options[0].config.completeSets, 4);
  assert.ok(prepared.options.every(o => o.id.startsWith('standard')));
  assert.equal(prep.prepareHand({hand:fixtures.northPairWait.slice(0,13)}), null);
});
