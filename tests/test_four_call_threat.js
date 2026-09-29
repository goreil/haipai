const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compute_kd_defense_data } = require('../static/js/prep/defense.js');
const { compute_yaku_panel } = require('../static/js/prep/prep-board-yaku.js');

const pon = tile => ({ type: 'pon', pai: tile, consumed: [tile, tile] });
const honorMelds = ['P', 'F', 'C', 'E'].map(pon);
const board = vm.createContext({
  tileBase: tile => tile.replace(/r$/, ''),
  renderTile: tile => tile,
});
for (const file of ['board-melds.js', 'board-discards.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), board);
}

test('four open calls use only tanki waits in open defense', () => {
  const events = [
    { type: 'start_kyoku', bakaze: 'E', oya: 0, dora_marker: '1p' },
    ...honorMelds.map(m => ({ ...m, actor: 1 })),
  ];
  const wall = Array(37).fill(4);
  const hand = ['3m', '4m', 'P'];
  const four = compute_kd_defense_data(hand, events, 0, events.length, 0, 50, wall);
  assert.equal(four.per_threat[0].open_melds, 4);
  assert.equal(four.per_threat[0].shape_han, 4);
  assert.equal(four.per_threat[0].guaranteed_han, 8);
  for (const waits of Object.values(four.per_threat[0].wait_breakdowns)) {
    assert.ok(waits.length > 0);
    assert.ok(waits.every(w => w.type === 'tanki'));
  }

  const three = compute_kd_defense_data(hand, events.slice(0, -1), 0, events.length - 1, 0, 50, wall);
  assert.equal(three.per_threat[0].shape_han, 0);
  assert.ok(three.per_threat[0].wait_breakdowns['3m'].some(w => w.type !== 'tanki'));
});

test('four honor melds lock toitoi and honitsu and exhaust yakuhai slots', () => {
  const wall = Array(37).fill(4);
  const panel = compute_yaku_panel({ 1: honorMelds }, wall, 0, 'E', [])[1];
  const yaku = type => panel.find(entry => entry.type === type);
  assert.equal(yaku('toitoi').state, 'locked');
  assert.equal(yaku('honitsu').state, 'locked');
  assert.deepEqual(yaku('yakuhai').possible, []);
  assert.deepEqual(yaku('yakuhai').dead, []);
  assert.equal(yaku('yakuhai').locked.length, 4);

  const three = compute_yaku_panel({ 1: honorMelds.slice(0, 3) }, wall, 0, 'E', [])[1];
  assert.equal(three.find(entry => entry.type === 'toitoi').state, 'possible');
  assert.equal(three.find(entry => entry.type === 'honitsu').state, 'possible');
  assert.ok(three.find(entry => entry.type === 'yakuhai').possible.length > 0);
});

test('four mixed triplets lock toitoi but not honitsu; a kakan is one set', () => {
  const wall = Array(37).fill(4);
  const mixed = compute_yaku_panel({ 1: [...honorMelds.slice(0, 3), pon('1m')] }, wall, 0, 'E', [])[1];
  assert.equal(mixed.find(entry => entry.type === 'toitoi').state, 'locked');
  assert.equal(mixed.find(entry => entry.type === 'honitsu').state, 'possible');

  const upgraded = [...honorMelds.slice(0, 3), { type: 'kakan', pai: 'P', consumed: ['P', 'P', 'P'] }];
  const panel = compute_yaku_panel({ 1: upgraded }, wall, 0, 'E', [])[1];
  assert.equal(panel.find(entry => entry.type === 'toitoi').state, 'possible');
  assert.ok(panel.find(entry => entry.type === 'yakuhai').possible.length > 0);
});

test('four honor calls add Toitoi and Honitsu to the open threat han breakdown', () => {
  const yaku = [
    ...board.meldYakuhai(honorMelds, 'S', 'E'),
    ...board.meldFourCallYaku(honorMelds, 4),
  ];
  assert.deepEqual(yaku.slice(-2).map(y => [y.name, y.han]), [['Toitoi', 2], ['Honitsu', 2]]);
  const han = board.threatGuaranteedHan(yaku.reduce((sum, y) => sum + y.han, 0), 1);
  assert.equal(han, 9);
  const html = board.renderThreatDetail(4, 12, yaku, ['5mr'], han);
  assert.match(html, /Toitoi/);
  assert.match(html, /Honitsu/);
  assert.match(html, /≥9 han/);
  assert.doesNotMatch(html, /Yaku to win/);

  assert.equal(board.meldFourCallYaku(honorMelds.slice(0, 3), 3).length, 0);
  assert.deepEqual(Array.from(board.meldFourCallYaku([...honorMelds.slice(0, 3), pon('1m')], 4),
    y => y.name), ['Toitoi']);
});
