const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { categorize } = require('../static/js/categorize.js');
const comparator = require('../static/js/compare-dimensions.js');
const fixture = require('./fixtures/double_yakuhai_m35708.json');

test('#m35708 favors double East over white at equal shanten and ukeire', () => {
  const result = categorize(fixture);
  assert.equal(result.shape, 'obvious');
  assert.deepEqual(result.wins, [{
    dim: 'yakuhai_kept', group: 'Yaku', prio: 1,
    winner: 'mortal', tiles: ['E'], han: 2,
  }]);
});

test('double yakuhai comparison works for every wind and in both directions', () => {
  for (const wind of ['E', 'S', 'W', 'N']) {
    const m = structuredClone(fixture);
    m.board_state.round_wind = wind;
    m.board_state.seat_wind = wind;
    m.actual.pai = wind;
    assert.equal(comparator.compareDimensions(m).find(w => w.dim === 'yakuhai_kept').winner, 'mortal');
    [m.actual, m.expected] = [m.expected, m.actual];
    assert.equal(comparator.compareDimensions(m).find(w => w.dim === 'yakuhai_kept').winner, 'you');
  }
});

test('single yakuhai ties and ordinary yakuhai advantages retain their behavior', () => {
  const m = structuredClone(fixture);
  for (const [round, seat] of [['E', 'S'], ['S', 'E'], [null, 'E'], ['E', null], [null, null]]) {
    m.board_state.round_wind = round;
    m.board_state.seat_wind = seat;
    const win = comparator.compareDimensions(m).find(w => w.dim === 'yakuhai_kept');
    if (round === null && seat === null) assert.equal(win.winner, 'you');
    else assert.equal(win, undefined);
  }
  m.board_state.round_wind = 'E';
  m.expected.pai = 'W';
  assert.deepEqual(comparator.compareDimensions(m).find(w => w.dim === 'yakuhai_kept'), {
    dim: 'yakuhai_kept', group: 'Yaku', prio: 1, winner: 'mortal', tiles: ['E'],
  });
});

test('card explanation and value pill both identify double yakuhai', () => {
  const context = vm.createContext({
    haipaiCompareDimensions: comparator,
    renderTile: tile => `<span>${tile}</span>`,
  });
  for (const file of ['categorize-explanations.js', 'ev-table.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
  }
  const text = context.explainDiscardShape(fixture, { threats: [] });
  assert.match(text, /double yakuhai \(2 han\)/);
  assert.doesNotMatch(text, /don't explain|Trust the read/);
  const pill = context.renderWinFeatPill(categorize(fixture).wins[0]);
  assert.match(pill, /\+double yakuhai/);
  assert.match(pill, /both seat and round wind/);
});
