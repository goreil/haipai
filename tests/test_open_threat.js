const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compute_yaku_panel } = require('../static/js/prep/prep-board-yaku.js');

const board = vm.createContext({
  tileBase: tile => tile.replace(/r$/, ''),
  renderTile: tile => tile,
  renderBackTile: () => '',
  getDoraTiles: b => new Set(b.dora_tiles || []),
  setActiveDora: () => {},
  SUIT_NAME: { m: 'Man', p: 'Pin', s: 'Sou' },
  SUIT_TILE: { m: '1m', p: '1p', s: '1s' },
});
for (const file of ['board-melds.js', 'board-yaku-panel.js', 'board-discards.js']) {
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

function renderOpenBoard(melds, { dora = [], player = 0, riichi = null, panel = true } = {}) {
  return board.renderBoardContext({
    actual: { actor: player }, turn: 8,
    board_state: {
      seat_wind: player === 0 ? 'E' : 'S', round_wind: 'E', dora_tiles: dora,
      all_discards: [{ seat: 1, discards: ['9p'], riichi_idx: riichi }],
      opponent_melds: [{ seat: 1, melds }],
      yaku: panel ? compute_yaku_panel({ 1: melds }, Array(37).fill(4), 0, 'E', []) : undefined,
    },
  });
}

test('Open disclosure covers single calls without changing danger bands or warnings', () => {
  const pon = tile => ({ type: 'pon', pai: tile, consumed: [tile, tile] });
  for (const [melds, dora, band] of [
    [[chi(2)], [], 'quiet'],
    [[pon('P')], [], 'quiet'],
    [[chi(2), chi(3, 'p')], [], 'moderate'],
    [[pon('P'), pon('F')], [], 'strong'],
    [[pon('5m')], ['5m'], 'strong'],
  ]) {
    const html = renderOpenBoard(melds, { dora });
    assert.match(html, new RegExp(`open-tag ${band} has-detail" tabindex="0">`));
    assert.match(html, /class="threat-detail"/);
    assert.equal(html.includes('⚠ Open'), band !== 'quiet');
    assert.equal(html.includes('discard-row danger-row'), band !== 'quiet');
    assert.doesNotMatch(html, /Open threat|class="danger-detail"|class="yaku-strip"/);
    // The count lives only in the expanded detail, never next to the badge.
    assert.equal((html.match(/open calls? by turn/g) || []).length, 1);
  }
  assert.match(renderOpenBoard([chi(2)], { panel: false }), /No guaranteed yaku or dora shown/);
});

test('Open panel groups likely and possible yakus with values, without repeating guaranteed yakus', () => {
  const html = renderOpenBoard([chi(2), chi(3, 'p')]);
  assert.match(html, /Likely yakus/);
  assert.match(html, /Tanyao/);
  assert.match(html, /1 han/);
  assert.match(html, /<details class="td-yaku-more" open><summary>Possible · /);
  assert.doesNotMatch(html, /No yaku reachable/);

  const yakuhai = renderOpenBoard([{ type: 'pon', pai: 'P', consumed: ['P', 'P'] }]);
  assert.match(yakuhai, /Visible value/);
  assert.equal((yakuhai.match(/td-name">Haku/g) || []).length, 1);
  assert.doesNotMatch(yakuhai, /yp-tile-chip is-locked/);
  assert.match(yakuhai, /<summary>Possible · /);
  assert.equal(board.openYakuHan({ type: 'yakuhai', possible: [{ count: 3, note: 'round + seat' }] }), '2');
  assert.equal(board.openYakuHan({ type: 'honitsu', chinitsuReachable: true }), '2 / 5');
  assert.equal(board.openYakuHan({ type: 'chanta', junchanReachable: true }), '1 / 2');
  const eliminated = board.renderYakuStrip([
    { type: 'yakuhai', state: 'dead', dead: [{ tile: 'P', unseen: 0, inHand: 0 }] },
  ]);
  assert.match(eliminated, /<details class="td-yaku-more" open><summary>Eliminated · /);
});

test('own hands, riichi and concealed kans do not acquire an Open badge', () => {
  assert.doesNotMatch(renderOpenBoard([chi(2)], { player: 1 }), /open-tag/);
  assert.doesNotMatch(renderOpenBoard([chi(2)], { riichi: 0 }), /open-tag/);
  const concealedKan = { type: 'ankan', consumed: ['5m', '5m', '5m', '5m'] };
  assert.doesNotMatch(renderOpenBoard([concealedKan]), /open-tag|danger-row/);
  const doraKan = renderOpenBoard([concealedKan], { dora: ['5m'] });
  assert.match(doraKan, /danger-row/);
  assert.match(doraKan, /⚠ 4 dora/);
  assert.doesNotMatch(doraKan, /open-tag/);
});
