const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareDimensions, deriveShape } = require('../static/js/compare-dimensions.js');
const { calculate } = require('../static/js/prep/shanten_calc.js');
const reports = require('./fixtures/tanyao_open_reports.json');
const report = id => structuredClone(reports.find(r => r.report_ids.includes(id)).mistake);
const tanyao = m => compareDimensions(m).find(w => w.dim === 'tanyao_kept');

test('R-278 does not promote a slower tanyao possibility over the iishanten discard', () => {
  const m = report(278);
  assert.equal(m.hand.length, 11);
  assert.equal(m.hand.filter(t => t !== '1p').length, 10);
  assert.equal(tanyao(m), undefined);

  // Recompute structural stats without production data; visible-wall counts
  // do not affect the shanten difference between these two choices.
  m.discard_stats = calculate(m.hand, m.melds, Array(37).fill(4), { allowComplete: true }).stats;
  const wins = compareDimensions(m);
  assert.ok(wins.some(w => w.dim === 'shanten' && w.winner === 'you'));
  assert.equal(tanyao(m), undefined);
  assert.equal(deriveShape(wins, m), 'complex');
});

test('R-240 also counts its open chi, crediting the player who cuts the terminal', () => {
  // This covers the shared counting bug, not completion of R-240's complaint.
  const m = report(240);
  assert.equal(tanyao(m)?.winner, 'you');
  assert.equal(tanyao(m)?.magnitude, 13);
});

test('the same tiles count equally when concealed or locked in a simple meld', () => {
  const m = report(240);
  const openWin = tanyao(m);
  m.hand.push(...m.melds[0].consumed, m.melds[0].pai);
  m.melds = [];
  assert.deepEqual(tanyao(m), openWin);
});

test('counting meld tiles preserves the eleven-simple threshold', () => {
  const m = report(240);
  m.hand.splice(m.hand.indexOf('3m'), 1, 'E');
  m.hand.splice(m.hand.indexOf('4m'), 1, 'N');
  assert.equal(tanyao(m)?.magnitude, 11);
  m.hand.splice(m.hand.indexOf('6m'), 1, 'W');
  assert.equal(tanyao(m), undefined);
});

test('terminal and honor melds still prevent tanyao', () => {
  for (const meld of [
    { type: 'chi', pai: '1s', consumed: ['2s', '3s'] },
    { type: 'pon', pai: 'E', consumed: ['E', 'E'] },
  ]) {
    const m = report(240);
    // Ten concealed simples plus the terminal chi's two simples pass the
    // threshold, so that case must be rejected by the meld guard.
    m.hand[m.hand.indexOf('1m')] = '2p';
    m.hand[m.hand.indexOf('5p')] = '1p';
    m.actual.pai = '1p';
    m.expected.pai = '2p';
    m.melds = [meld];
    assert.equal(tanyao(m), undefined);
  }
});
