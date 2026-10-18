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
