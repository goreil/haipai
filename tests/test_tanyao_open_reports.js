const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareDimensions, deriveShape } = require('../static/js/compare-dimensions.js');
const { calculate } = require('../static/js/prep/shanten_calc.js');
const reports = require('./fixtures/tanyao_open_reports.json');
const report = id => structuredClone(reports.find(r => r.report_ids.includes(id)).mistake);
const tanyao = m => compareDimensions(m).find(w => w.dim === 'tanyao_kept');

test('R-278 counts the open chi, including its red five, toward tanyao', () => {
  const m = report(278);
  assert.equal(m.hand.length, 11);
  assert.equal(m.hand.filter(t => t !== '1p').length, 10);
  assert.equal(tanyao(m)?.winner, 'mortal');
  assert.equal(tanyao(m)?.magnitude, 13);

  // Recompute structural stats without production data; visible-wall counts
  // do not affect the shanten difference responsible for this trade-off.
  m.discard_stats = calculate(m.hand, m.melds, Array(37).fill(4), { allowComplete: true }).stats;
  const wins = compareDimensions(m);
  assert.ok(wins.some(w => w.dim === 'shanten' && w.winner === 'you'));
  assert.equal(deriveShape(wins, m), 'trade-off');
});

test('R-240 also counts its open chi, crediting the player who cuts the terminal', () => {
  // This covers the shared counting bug, not completion of R-240's complaint.
  const m = report(240);
  assert.equal(tanyao(m)?.winner, 'you');
  assert.equal(tanyao(m)?.magnitude, 13);
});

test('the same tiles count equally when concealed or locked in a simple meld', () => {
  const m = report(278);
  const openWin = tanyao(m);
  m.hand.push(...m.melds[0].consumed, m.melds[0].pai);
  m.melds = [];
  assert.deepEqual(tanyao(m), openWin);
});

test('counting meld tiles preserves the eleven-simple threshold', () => {
  const m = report(278);
  m.hand.splice(m.hand.indexOf('3m'), 1, 'E');
  m.hand.splice(m.hand.indexOf('3m'), 1, 'N');
  assert.equal(tanyao(m)?.magnitude, 11);
  m.hand.splice(m.hand.indexOf('4m'), 1, 'W');
  assert.equal(tanyao(m), undefined);
});

test('terminal and honor melds still prevent tanyao', () => {
  for (const meld of [
    { type: 'chi', pai: '1s', consumed: ['2s', '3s'] },
    { type: 'pon', pai: 'E', consumed: ['E', 'E'] },
  ]) {
    const m = report(278);
    // Ten concealed simples plus the terminal chi's two simples pass the
    // threshold, so that case must be rejected by the meld guard.
    m.hand[m.hand.indexOf('1p')] = '2p';
    m.hand[m.hand.indexOf('5s')] = '1p';
    m.actual.pai = '1p';
    m.expected.pai = '2p';
    m.melds = [meld];
    assert.equal(tanyao(m), undefined);
  }
});
