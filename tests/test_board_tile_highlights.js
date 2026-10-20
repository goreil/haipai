const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const board = vm.createContext({});
for (const file of ['tiles.js', 'board-melds.js', 'board-yaku-panel.js', 'board-discards.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), board);
}

const pon = tile => ({ type: 'pon', pai: tile, consumed: [tile, tile], target: 0 });
function render(melds, seatWind = 'W') {
  return board.renderBoardContext({
    actual: { actor: 0 }, turn: 8,
    board_state: {
      seat_wind: seatWind, round_wind: 'S', dora_tiles: ['P'],
      all_discards: [{ seat: 1, discards: ['W', 'S', 'P', { tile: 'F', called_by: 2 }] }],
      opponent_melds: [{ seat: 1, melds }],
    },
  });
}

test('discards suppress yakuhai while retaining dora and called-tile markings', () => {
  const html = render([]);
  const discards = html.match(/<img\b[^>]*data-turn="[^"]*"[^>]*>/g);
  assert.equal(discards.length, 4);
  for (const tile of discards) assert.doesNotMatch(tile, /yakuhai-highlight|Yakuhai for you/);
  assert.match(discards[2], /dora-highlight/);
  assert.match(discards[3], /ghost-tile/);
});

test('meld yakuhai follows the caller in a rotated round, not the viewer', () => {
  // Viewer is West, so the next seat is North; round wind is South.
  const html = render(['W', 'N', 'S', 'P', 'F', 'C'].map(pon));
  const melds = html.slice(html.indexOf('<span class="inline-melds">'));
  const highlighted = [...melds.matchAll(/<img\b[^>]*yakuhai-highlight[^>]*alt="([^"]+)"/g)]
    .map(match => match[1]);
  assert.deepEqual(highlighted, ['N', 'N', 'N', 'S', 'S', 'S', 'P', 'P', 'P', 'F', 'F', 'F', 'C', 'C', 'C']);
  assert.doesNotMatch(melds, /Yakuhai for you/);
  assert.match(melds, /Yakuhai for caller/);
  assert.match(board.renderTile('W'), /yakuhai-highlight/);
});

test('unknown dealer does not assign the viewer wind to an opponent call', () => {
  const html = render([pon('W'), pon('S'), pon('P')], null);
  const melds = html.slice(html.indexOf('<span class="inline-melds">'));
  const highlighted = [...melds.matchAll(/<img\b[^>]*yakuhai-highlight[^>]*alt="([^"]+)"/g)]
    .map(match => match[1]);
  assert.deepEqual(highlighted, ['S', 'S', 'S', 'P', 'P', 'P']);
});
