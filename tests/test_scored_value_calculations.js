const assert = require('node:assert/strict');
const { test } = require('node:test');
const { profile, calculations } = require('../static/js/scored-value.js');
const { evalDiscardScores } = require('../static/js/bad-riichi-bars.js');
const reports = require('./fixtures/scored_value_reports.json');

function actual(id) {
  const m = reports.find(r => r.report_ids.includes(id)).mistake;
  const cut = m.actual.pai, stat = m.discard_stats.find(s => s.tile === cut);
  const value = profile(m, cut, stat);
  return { m, cut, stat, value, math: calculations(m, cut, stat, false, value) };
}

test('R-200: projected wait endpoints remain available without an aggregate or equation', () => {
  const { value, math } = actual(200);
  assert.equal(value.minWait, 0); // The 1s draw has no legal winning wait.
  assert.ok(value.maxWait > 0);
  assert.ok(!Object.hasOwn(value, 'waitValue'));
  assert.equal(math, null);
});

test('R-291: the tenpai equation weights ron and tsumo by the three unseen 6p', () => {
  const { m, cut, stat, value, math } = actual(291);
  const [{ ron, tsumo }] = evalDiscardScores(m, cut, stat.necessary_tiles, false);
  const expected = 3 * (ron.ten + tsumo.ten) / 2;
  assert.equal(value.waitValue, expected);
  assert.equal(math.waitValue, 'Unseen copies × (ron + tsumo) ÷ 2\n'
    + `3 × (${ron.ten.toLocaleString()} + ${tsumo.ten.toLocaleString()}) ÷ 2 = ${expected.toLocaleString()}`);
});
