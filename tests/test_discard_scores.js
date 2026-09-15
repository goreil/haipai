// Run with: node --test tests/test_discard_scores.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ window: {}, renderTile: tile => tile });
for (const file of ['vendor/riichi/riichi-bundle.js', 'categorize-yaku.js', 'bad-riichi-bars.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
}

// #m35086: South round, South seat, open East pon (not yakuhai).
const mistake = {
  hand: ['6m', '7m', '8m', '4p', '5p', '8p', '8p', '7s', '8s', '9s', '3p'],
  melds: [{ type: 'pon', target: 0, pai: 'E', consumed: ['E', 'E'] }],
  board_state: { round_wind: 'S', seat_wind: 'S' },
};

test('prep builds the discard table when the drawn hand is complete without yaku', () => {
  const { prepMistake } = require('../static/js/prep/prep.js');
  const { calculate } = require('../static/js/prep/shanten_calc.js');
  const m = {
    ...mistake,
    actual: { type: 'dahai', actor: 3, pai: '3p' },
    expected: { type: 'dahai', actor: 3, pai: '8p' },
  };
  const mortal = { player_id: 3, mjai_log: [
    { type: 'start_kyoku', bakaze: 'S', kyoku: 3, oya: 2, dora_marker: '5s', scores: [] },
    { type: 'tsumo', actor: 3, pai: '3p' },
  ] };
  assert.throws(() => calculate(m.hand, m.melds, []), { code: 'winning' });
  const patch = prepMistake(m, mortal, 0, { tiles_left: 69, last_actor: 3 }, null);
  for (const [discard, waits] of [['3p', ['3p', '6p']], ['8p', ['8p']]]) {
    const stat = patch.discard_stats.find(s => s.tile === discard);
    assert.equal(stat.shanten, 0);
    assert.deepEqual(stat.necessary_tiles.map(w => w.tile), waits);
    const groups = context.evalDiscardScores({ ...m, ...patch }, discard, stat.necessary_tiles, false);
    assert.equal(groups[0].noYaku, true);
  }
});

test('no-yaku tenpai retains waits and renders an explicit value explanation', () => {
  for (const [discard, waits] of [
    ['3p', [{ tile: '3p', count: 3 }, { tile: '6p', count: 4 }]],
    ['8p', [{ tile: '8p', count: 2 }]],
  ]) {
    const groups = context.evalDiscardScores(mistake, discard, waits, false);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].noYaku, true);
    assert.equal(groups[0].ron, null);
    assert.equal(groups[0].tsumo, null);
    assert.equal(groups[0].tiles.length, waits.length);
    const html = context.renderRiichiScoreCell(groups, false);
    assert.match(html, /Ron \/ Tsumo/);
    assert.match(html, /no yaku/);
    assert.doesNotMatch(html, /only menzen-tsumo wins/);
    for (const wait of waits) assert.ok(html.includes(`${wait.tile} ×${wait.count}`));
  }
});

test('an open hand with yakuhai still scores ron and tsumo', () => {
  const m = { ...mistake, board_state: { round_wind: 'E', seat_wind: 'S' } };
  const groups = context.evalDiscardScores(m, '3p', [{ tile: '6p', count: 4 }], false);
  assert.ok(groups[0].ron.ten > 0);
  assert.ok(groups[0].tsumo.ten > 0);
  assert.equal(groups[0].noYaku, false);
});

test('mixed waits retain both the chanta win and the no-yaku completion', () => {
  const m = {
    ...mistake,
    hand: ['1m', '2m', '3m', '7p', '8p', '9p', 'N', 'N', '2s', '3s', '5p'],
  };
  const groups = context.evalDiscardScores(m, '5p', [
    { tile: '1s', count: 4 }, { tile: '4s', count: 4 },
  ], false);
  assert.equal(groups.length, 2);
  assert.ok(groups[0].ron.ten > 0);
  assert.equal(groups[0].tiles[0].tile, '1s');
  assert.equal(groups[1].noYaku, true);
  assert.equal(groups[1].tiles[0].tile, '4s');
});

test('closed no-yaku ron retains its legal menzen-tsumo score', () => {
  const m = { ...mistake, melds: [], hand: [...mistake.hand, 'E', 'E', 'E'] };
  const groups = context.evalDiscardScores(m, '8p', [{ tile: '8p', count: 2 }], false);
  assert.equal(groups[0].ron, null);
  assert.ok(groups[0].tsumo.ten > 0);
  assert.equal(groups[0].noYaku, false);
  assert.match(context.renderRiichiScoreCell(groups, false), /only menzen-tsumo wins/);
  const reached = context.evalDiscardScores(m, '8p', [{ tile: '8p', count: 2 }], true);
  assert.ok(reached[0].ron.ten > 0);
});

test('invalid waits and unavailable scoring do not become no-yaku results', () => {
  assert.equal(context.evalDiscardScores(mistake, '3p', [{ tile: '1m', count: 4 }], false), null);
  assert.equal(context.evalDiscardScores(mistake, '1m', [{ tile: '6p', count: 4 }], false), null);
  const hand = mistake.hand.slice(0, -1);
  assert.equal(context._evalWaitScore(hand, '6p', mistake, { tsumo: false, riichi: false }), null);
  const calc = context.window.Riichi;
  try {
    context.window.Riichi = class { calc() { throw new Error('unavailable'); } };
    assert.equal(context.evalDiscardScores(mistake, '3p', [{ tile: '6p', count: 4 }], false), null);
  } finally {
    context.window.Riichi = calc;
  }
});
