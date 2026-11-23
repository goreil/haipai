const assert = require('node:assert/strict');
const { test } = require('node:test');
const { profile, calculations } = require('../static/js/scored-value.js');
const reports = require('./fixtures/scored_value_reports.json');

function actual(id) {
  const m = reports.find(r => r.report_ids.includes(id)).mistake;
  const cut = m.actual.pai, stat = m.discard_stats.find(s => s.tile === cut);
  const value = profile(m, cut, stat);
  return { value, math: calculations(m, cut, stat, false, value) };
}

function drawLine(text, tile) {
  return text.split('\n').find(line => line.split(':')[0].split(', ').some(label => label.startsWith(`${tile} × `)));
}

test('R-265: furiten contributes a zero ron term to the wait index', () => {
  const { math, value } = actual(265);
  assert.match(drawLine(math.waitValue, '6s'), /× \(0 \+ [\d,]+\)/);
  assert.ok(math.waitValue.endsWith(Math.round(value.waitValue).toLocaleString()));
});

test('R-200: a draw without a legal win still carries its copies in the outer average', () => {
  const { math } = actual(200);
  assert.match(drawLine(math.waitValue, '1s'), /÷ 2 = 0$/);
  assert.match(math.waitValue.split('\n').at(-1), /\d+ × 0\b/);
});
