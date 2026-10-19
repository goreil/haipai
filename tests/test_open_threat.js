const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const board = vm.createContext({
  tileBase: tile => tile.replace(/r$/, ''),
  renderTile: tile => tile,
});
for (const file of ['board-melds.js', 'board-discards.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), board);
}
const chi = (start, suit = 'm') => ({
  type: 'chi', pai: start + suit, consumed: [start + 2 + suit, start + 1 + suit],
});

test('exposed Ittsu replaces the missing-yaku placeholder, including red fives', () => {
  for (const suit of ['m', 'p', 's']) {
    const melds = [chi(7, suit), chi(1, suit), chi(4, suit)];
    melds[2].consumed[1] += 'r';
    const yaku = board.meldIttsu(melds);
    assert.equal(yaku.length, 1);
    assert.equal(yaku[0].name, 'Ittsu');
    const han = board.threatGuaranteedHan(yaku[0].han, 1);
    assert.equal(han, 2);
    const html = board.renderThreatDetail(3, 10, yaku, ['5' + suit + 'r'], han);
    assert.match(html, /Ittsu/);
    assert.match(html, /≥2 han/);
    assert.doesNotMatch(html, /Yaku to win/);
    assert.equal(board.threatGuaranteedHan(yaku[0].han, 0), 1);
  }
});

test('incomplete, duplicated and mixed-suit runs do not guarantee Ittsu', () => {
  for (const melds of [
    [chi(1), chi(4)], [chi(1), chi(4), chi(4)],
    [chi(1), chi(4), chi(7, 'p')], [chi(2), chi(4), chi(7)],
  ]) {
    assert.equal(board.meldIttsu(melds).length, 0);
  }
  assert.match(board.renderThreatDetail(2, 10, [], ['5mr'], 2), /Yaku to win/);
});

test('Ittsu stacks with guaranteed yakuhai and dora', () => {
  const melds = [chi(1), chi(4), chi(7), { type: 'pon', pai: 'P', consumed: ['P', 'P'] }];
  const yaku = [...board.meldYakuhai(melds, 'S', 'E'), ...board.meldIttsu(melds)];
  assert.equal(board.threatGuaranteedHan(yaku.reduce((sum, y) => sum + y.han, 0), 1), 3);
});
