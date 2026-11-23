const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const comparator = require('../static/js/compare-dimensions.js');
const { categorize } = require('../static/js/categorize.js');
const { calculate } = require('../static/js/prep/shanten_calc.js');
const { subtract_hand_from_wall } = require('../static/js/prep/prep-board-state.js');
const { profile } = require('../static/js/scored-value.js');
const reports = require('./fixtures/yaku_report_guards.json');
const report = id => structuredClone(reports.find(r => r.report_id === id).mistake);
const yaku = m => comparator.compareDimensions(m).filter(w => w.group === 'Yaku');
const speculative = ['chanta_kept', 'ittsu_kept', 'honitsu_kept'];

test('all 11 reported false yaku claims stop acting as winning dimensions', () => {
  for (const { report_id, mistake } of reports) {
    const wins = yaku(mistake);
    if (mistake.discard_stats.some(stat => stat.shanten === 1)) {
      assert.deepEqual(wins, [], `no heuristic yaku on iishanten report ${report_id}`);
    }
    const disputed = [237, 272].includes(report_id) ? ['yakuhai_kept'] : speculative;
    assert.ok(!wins.some(w => disputed.includes(w.dim) && !w.suppressed), `report ${report_id}`);
    if ([227, 233, 237, 242, 253, 272].includes(report_id)) {
      assert.ok(!wins.some(w => disputed.includes(w.dim)), `claim removed for ${report_id}`);
    }
  }
  assert.equal(categorize(report(226)).shape, 'complex');
  assert.equal(categorize(report(272)).shape, 'obvious');
});

test('neither a live singleton nor a live pair awards an iishanten yakuhai win', () => {
  const m = report(237);
  const row = m.board_state.all_discards.find(r => r.discards.some(d => d.tile === 'F'));
  row.discards = row.discards.filter(d => d.tile !== 'F');
  assert.equal(yaku(m).length, 0);
  m.hand[m.hand.indexOf('1p')] = 'F';
  assert.equal(yaku(m).length, 0);
});

test('dora indicators and opponent melds also make honor triplets unavailable', () => {
  for (const exposed of ['indicator', 'pon', 'ankan', 'kakan']) {
    const m = structuredClone(require('./fixtures/double_yakuhai_m35708.json'));
    m.expected.pai = '6m';
    m.board_state.all_discards = [];
    m.board_state.opponent_melds = [];
    m.board_state.dora_indicators = [];
    assert.equal(yaku(m).find(w => w.dim === 'yakuhai_kept')?.winner, 'mortal');
    if (exposed === 'indicator') {
      m.board_state.dora_indicators = ['E'];
      m.board_state.all_discards = [{ seat: 1, discards: [{ tile: 'E' }] }];
    } else {
      const meld = exposed === 'ankan' ? { type: 'ankan', consumed: ['E', 'E', 'E', 'E'] }
        : { type: exposed, pai: 'E', consumed: exposed === 'pon' ? ['E', 'E'] : ['E', 'E', 'E'] };
      m.board_state.opponent_melds = [{ seat: 1, melds: [meld] }];
    }
    assert.ok(!yaku(m).some(w => w.dim === 'yakuhai_kept'), exposed);
  }
});

function ready(hand, actual, expected, melds = []) {
  const wall = subtract_hand_from_wall([...Array(34).fill(4), 1, 1, 1],
    [...hand, ...melds.flatMap(m => [...m.consumed, m.pai]), 'F']);
  return {
    hand, melds, actual: { type: 'dahai', pai: actual, actor: 0 },
    expected: { type: 'dahai', pai: expected, actor: 0 },
    board_state: { round_wind: 'E', seat_wind: 'S', dora_tiles: ['C'], all_discards: [{ seat: 0, discards: [] }] },
    iishanten_wall: wall, discard_stats: calculate(hand, melds, wall, { allowComplete: true }).stats,
  };
}

const outsideHand = ['1m', '2m', '3m', '7p', '8p', '9p', '1s', '2s', 'E', 'E', 'E', 'N', 'N', '5m'];
const straightHand = ['1m', '2m', '3m', '4m', '5mr', '6m', '7m', '8m', 'E', 'E', 'E', 'N', 'N', '5p'];

function scoredYaku(m, cut) {
  const p = profile(m, cut, m.discard_stats.find(s => s.tile === cut));
  return p?.yaku || {};
}

test('live outside and straight hands use scored outcomes, never tile-pattern wins', () => {
  const outside = ready(outsideHand, '1m', '5m');
  assert.ok(scoredYaku(outside, '5m').chanta > 0);
  assert.deepEqual(yaku(outside), []);
  const straight = ready(straightHand, '1m', '5p');
  assert.ok(scoredYaku(straight, '5p').ittsu > 0);
  assert.ok(scoredYaku(straight, '5p').honitsu > 0);
  assert.deepEqual(yaku(straight), []);
});

test('a dead scoring wait does not justify a yaku claim', () => {
  const m = ready(outsideHand, '1m', '5m');
  m.discard_stats.find(s => s.tile === '5m').necessary_tiles.forEach(w => { w.count = 0; });
  assert.equal(scoredYaku(m, '5m').chanta, undefined);
});

test('chanta verifies fixed melds and rejects all-triplet outside shapes', () => {
  const melds = [{ type: 'pon', pai: 'E', consumed: ['E', 'E'] }];
  const open = ready(outsideHand.filter(t => t !== 'E'), '1m', '5m', melds);
  assert.ok(scoredYaku(open, '5m').chanta > 0);
  const triplets = ready(['1m', '1m', '1m', '9m', '9m', '9m', '1p', '1p', '1p',
    'E', 'E', 'E', 'N', '5m'], '1m', '5m');
  assert.equal(scoredYaku(triplets, '5m').chanta, undefined);
});

test('browser comparator and Node comparator give the same report results', () => {
  const context = vm.createContext({});
  context.self = context;
  for (const file of ['prep/tiles.js', 'prep/parse.js', 'prep/shanten.js', 'prep/prep-board-state.js',
    'vendor/riichi/riichi-bundle.js', 'categorize-yaku.js', 'bad-riichi-bars.js', 'iishanten.js',
    'scored-value.js', 'categorize.js', 'compare-dimensions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
  }
  for (const { mistake } of reports) {
    assert.equal(JSON.stringify(context.haipaiCompareDimensions.compareDimensions(mistake)),
      JSON.stringify(comparator.compareDimensions(mistake)));
  }
});

test('trainer text explains visible features without revealing suppressed yaku or guessing reasons', () => {
  const context = vm.createContext({ haipaiCompareDimensions: comparator, renderTile: t => `[${t}]` });
  for (const file of ['categorize-explanations.js', 'ev-table.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
  }
  const m = report(226);
  const text = context.explainDiscardShape(m, { threats: [] });
  assert.match(text, /visible comparison doesn't explain it/);
  assert.doesNotMatch(text, /chanta|Potential yaku|likely|Trust the read|simply better/);
  const pills = comparator.compareDimensions(m).filter(w => !w.suppressed)
    .map(w => context.renderWinFeatPill(w)).join('');
  assert.doesNotMatch(pills, /chanta/);
  assert.doesNotMatch(context.explainDiscardShape(report(242), { threats: [] }), /chanta/);
  for (const { mistake } of reports) {
    const rendered = context.explainDiscardShape(mistake, { threats: [] });
    for (const win of yaku(mistake).filter(w => w.suppressed)) {
      assert.ok(!rendered.includes(win.dim.replace('_kept', '')), `hidden ${win.dim} on ${mistake.id}`);
    }
  }
});
