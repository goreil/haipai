const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const comparator = require('../static/js/compare-dimensions.js');
const { categorize } = require('../static/js/categorize.js');
const { calculate } = require('../static/js/prep/shanten_calc.js');
const reports = require('./fixtures/yaku_report_guards.json');
const report = id => structuredClone(reports.find(r => r.report_id === id).mistake);
const yaku = m => comparator.compareDimensions(m).filter(w => w.group === 'Yaku');
const speculative = ['chanta_kept', 'ittsu_kept', 'honitsu_kept'];

test('all 11 reported false yaku claims stop acting as winning dimensions', () => {
  for (const { report_id, mistake } of reports) {
    const wins = yaku(mistake);
    const disputed = [237, 272].includes(report_id) ? ['yakuhai_kept'] : speculative;
    assert.ok(!wins.some(w => disputed.includes(w.dim) && !w.suppressed), `report ${report_id}`);
    if ([227, 233, 237, 242, 253, 272].includes(report_id)) {
      assert.ok(!wins.some(w => disputed.includes(w.dim)), `claim removed for ${report_id}`);
    }
  }
  assert.equal(categorize(report(226)).shape, 'complex');
  assert.equal(categorize(report(272)).shape, 'obvious');
});

test('a live singleton, a live pair and double yakuhai remain eligible', () => {
  const m = report(237);
  const row = m.board_state.all_discards.find(r => r.discards.some(d => d.tile === 'F'));
  row.discards = row.discards.filter(d => d.tile !== 'F');
  assert.ok(yaku(m).some(w => w.dim === 'yakuhai_kept'));
  m.hand[m.hand.indexOf('1p')] = 'F';
  assert.ok(yaku(m).some(w => w.dim === 'yakuhai_kept'));
  const double = require('./fixtures/double_yakuhai_m35708.json');
  assert.equal(yaku(double).find(w => w.dim === 'yakuhai_kept').han, 2);
});

test('dora indicators and opponent melds also make honor triplets unavailable', () => {
  for (const exposed of ['indicator', 'pon', 'ankan', 'kakan']) {
    const m = report(237);
    m.board_state.all_discards = [];
    m.board_state.opponent_melds = [];
    m.board_state.dora_indicators = [];
    if (exposed === 'indicator') {
      m.board_state.dora_indicators = ['F'];
      m.board_state.all_discards = [{ seat: 1, discards: [{ tile: 'F' }] }];
    } else {
      const meld = exposed === 'ankan' ? { type: 'ankan', consumed: ['F', 'F', 'F', 'F'] }
        : { type: exposed, pai: 'F', consumed: exposed === 'pon' ? ['F', 'F'] : ['F', 'F', 'F'] };
      m.board_state.opponent_melds = [{ seat: 1, melds: [meld] }];
    }
    assert.ok(!yaku(m).some(w => w.dim === 'yakuhai_kept'), exposed);
  }
});

function ready(hand, actual, expected, melds = []) {
  return {
    hand, melds, actual: { type: 'dahai', pai: actual, actor: 0 },
    expected: { type: 'dahai', pai: expected, actor: 0 },
    board_state: { round_wind: 'E', seat_wind: 'S' },
    discard_stats: calculate(hand, melds, Array(37).fill(4), { allowComplete: true }).stats,
  };
}

const outsideHand = ['1m', '2m', '3m', '7p', '8p', '9p', '1s', '2s', 'E', 'E', 'E', 'N', 'N', '5m'];
const straightHand = ['1m', '2m', '3m', '4m', '5mr', '6m', '7m', '8m', 'E', 'E', 'E', 'N', 'N', '5p'];

test('verified live chanta, ittsu and flush completions retain their winning pills', () => {
  const outside = ready(outsideHand, '1m', '5m');
  assert.ok(yaku(outside).some(w => w.dim === 'chanta_kept' && !w.suppressed));
  const straight = ready(straightHand, '1m', '5p');
  for (const dim of ['ittsu_kept', 'honitsu_kept']) {
    assert.ok(yaku(straight).some(w => w.dim === dim && !w.suppressed), dim);
  }
  [straight.actual, straight.expected] = [straight.expected, straight.actual];
  assert.equal(yaku(straight).find(w => w.dim === 'ittsu_kept').winner, 'you');
});

test('a dead scoring wait does not justify a yaku claim', () => {
  const m = ready(outsideHand, '1m', '5m');
  m.discard_stats.find(s => s.tile === '5m').necessary_tiles.forEach(w => { w.count = 0; });
  assert.ok(!yaku(m).some(w => w.dim === 'chanta_kept'));
});

test('chanta verifies fixed melds and rejects all-triplet outside shapes', () => {
  const melds = [{ type: 'pon', pai: 'E', consumed: ['E', 'E'] }];
  const open = ready(outsideHand.filter(t => t !== 'E'), '1m', '5m', melds);
  assert.ok(yaku(open).some(w => w.dim === 'chanta_kept' && !w.suppressed));
  const triplets = ready(['1m', '1m', '1m', '9m', '9m', '9m', '1p', '1p', '1p',
    'E', 'E', 'E', 'N', '5m'], '1m', '5m');
  assert.ok(!yaku(triplets).some(w => w.dim === 'chanta_kept'));
});

test('browser comparator and Node comparator give the same report results', () => {
  const context = vm.createContext({});
  for (const file of ['prep/tiles.js', 'prep/parse.js', 'prep/shanten.js', 'categorize.js', 'compare-dimensions.js']) {
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
  const verified = ready(outsideHand, '1m', '5m');
  assert.match(context.explainDiscardShape(verified, { threats: [] }), /chanta/);
});
