const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('hand expansion toggles independently and stays scoped to its loaded game', () => {
  const content = { scrollTop: 240 };
  let renders = 0;
  let focused = 0;
  const game = { rounds: [{}, {}] };
  const context = vm.createContext({
    state: { currentGameData: game },
    document: {
      getElementById: () => content,
      querySelector: () => ({ focus: () => focused++ }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/game-render.js'), 'utf8'), context);
  context.renderGame = () => { renders++; content.scrollTop = 0; };
  context.toggleHandMistakes(0);
  assert.equal(context.handMistakesExpanded(game, 0), true);
  assert.equal(context.handMistakesExpanded(game, 1), false);
  assert.equal(content.scrollTop, 240);
  context.toggleHandMistakes(1);
  context.toggleHandMistakes(0);
  assert.equal(context.handMistakesExpanded(game, 0), false);
  assert.equal(context.handMistakesExpanded(game, 1), true);
  const nextGame = { rounds: [{}] };
  context.state.currentGameData = nextGame;
  assert.equal(context.handMistakesExpanded(nextGame, 0), false);
  context.toggleHandMistakes(99);
  assert.equal(renders, 3);
  assert.equal(focused, 3);
});

test('review counts include hand overrides and Show all clears both filter restrictions', () => {
  const game = { rounds: [
    { mistakes: [{ ev_loss: 1.2, topic: 'Speed' }, { ev_loss: 0.3, topic: 'Speed' }] },
    { mistakes: [{ ev_loss: 0.8, topic: 'Defense' }] },
    { mistakes: [] },
  ] };
  const context = vm.createContext({
    state: { currentGameData: game, sevLevel: 1, conceptFilters: [{ group: 'Speed' }] },
    haipaiConceptBreakdown: {
      mistakeTouchesConcept: (mistake, _compare, filter) => mistake.topic === filter.group,
    },
    haipaiCompareDimensions: { compareDimensions: () => ({}) },
    document: {
      getElementById: () => ({ scrollTop: 0 }),
      querySelector: () => null,
    },
  });
  for (const file of ['severity.js', 'game-render.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
  }
  context.renderGame = () => {};
  const counts = () => JSON.parse(JSON.stringify(context.reviewItemCounts(game)));
  assert.deepEqual(counts(), { total: 3, shown: 1, revealed: 0 });
  context.toggleHandMistakes(0);
  assert.deepEqual(counts(), { total: 3, shown: 2, revealed: 1 });
  context.toggleHandMistakes(1);
  assert.deepEqual(counts(), { total: 3, shown: 3, revealed: 2 });
  context.showAllReviewItems();
  assert.equal(context.state.sevLevel, 3);
  assert.equal(context.state.conceptFilters.length, 0);
  assert.deepEqual(counts(), { total: 3, shown: 3, revealed: 0 });
  context.toggleHandMistakes(0);
  assert.deepEqual(counts(), { total: 3, shown: 3, revealed: 0 });
});
