const assert = require('node:assert/strict');
const { test } = require('node:test');
const { profile, calculations } = require('../static/js/scored-value.js');
const { analyzeIishanten } = require('../static/js/iishanten.js');
const reports = require('./fixtures/scored_value_reports.json');

function actual(id) {
  const m = reports.find(r => r.report_ids.includes(id)).mistake;
  const cut = m.actual.pai, stat = m.discard_stats.find(s => s.tile === cut);
  const value = profile(m, cut, stat);
  return { value, math: calculations(m, cut, stat, false, value), draws: analyzeIishanten(m, cut, stat) };
}

function drawLine(text, tile) {
  return text.split('\n').find(line => line.split(':')[0].split(', ').some(label => label.startsWith(`${tile} × `)));
}

test('R-265: furiten contributes a zero ron term only to the wait index', () => {
  const { math, value } = actual(265);
  assert.match(drawLine(math.waitValue, '6s'), /× \(0 \+ [\d,]+\)/);
  const mean = drawLine(math.meanPoints, '6s');
  assert.ok(mean && !mean.includes('(0 + '));
  assert.ok(math.waitValue.endsWith(Math.round(value.waitValue).toLocaleString()));
});

test('R-200: a draw without a legal win still carries its copies in the outer average', () => {
  const { math } = actual(200);
  assert.match(drawLine(math.meanPoints, '1s'), /0 legal wins → 0$/);
  assert.match(math.meanPoints.split('\n').at(-1), /\d+ × 0\b/);
});

test('R-292: the outer average weights exact payouts, not rounded branch averages', () => {
  const { draws, math, value } = actual(292);
  const outer = math.meanPoints.split('\n').at(-1);
  const weights = new Map();
  for (const { branch, count } of draws) {
    let points = 0, wins = 0;
    for (const g of branch.groups) {
      const copies = g.tiles.reduce((n, t) => n + t.count, 0);
      for (const score of [g.ron, g.tsumo].filter(Boolean)) {
        points += copies * score.ten;
        wins += copies;
      }
    }
    const term = points % wins ? `(${points.toLocaleString()}/${wins})` : (wins ? points / wins : 0).toLocaleString();
    weights.set(term, (weights.get(term) || 0) + count);
  }
  for (const [term, count] of weights) assert.ok(outer.includes(`${count} × ${term}`), term);
  assert.ok(outer.endsWith(Math.round(value.meanPoints).toLocaleString()));
});
