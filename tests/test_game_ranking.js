const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/game-render.js'), 'utf8'), context);
const rank = (ev, decisions = 100) => context.gameRating({ total_ev_loss: ev, total_decisions: decisions });

test('square-root scale covers every grade and clamps to S+ and E', () => {
  const examples = [[0, 'S+'], [4, 'S'], [6, 'S−'], [8, 'A+'], [10, 'A'], [13, 'A−'],
    [16, 'B+'], [20, 'B'], [24, 'B−'], [28, 'C+'], [32, 'C'], [37, 'C−'],
    [42, 'D+'], [47, 'D'], [53, 'D−'], [59, 'E+'], [65, 'E'], [1000, 'E']];
  for (const [ev, grade] of examples) assert.equal(rank(ev).grade, grade);
});

test('ranking normalizes game length and uses unrounded totals', () => {
  assert.equal(rank(8, 100).grade, rank(16, 200).grade);
  const boundary = ((21.124813514948926 - 13.5) / 24.895305056375324) ** 2;
  assert.equal(rank((boundary - 1e-8) * 100).grade, 'A+');
  assert.equal(rank((boundary + 1e-8) * 100).grade, 'A');
});

test('missing or invalid data remains unranked rather than receiving S+', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) assert.equal(rank(value), null);
  for (const decisions of [0, null, -1, Infinity]) assert.equal(rank(0, decisions), null);
  assert.equal(context.gameRating(null), null);
  assert.match(context.renderRanking({ total_ev_loss: 0, total_decisions: 0 }), /Ranking unavailable/);
});

test('sidebar keeps EV/D and a compact rank without mistakes or a ranking label', () => {
  const list = {};
  context.document = { getElementById: () => list };
  context.state = { currentGame: 1, games: [{ id: 1, date: '2026-09-22',
    summary: { total_ev_loss: 8, total_decisions: 100, total_mistakes: 12 } }] };
  context.renderGameList();
  assert.match(list.innerHTML, /ranking-a/);
  assert.match(list.innerHTML, /Ranking A\+/);
  const visible = list.innerHTML.replace(/<[^>]*>/g, "");
  assert.match(visible, /0.0800 EV\/D/);
  assert.doesNotMatch(visible, /mistakes|Ranking|★|☆/);
});


test('rank hover shows only its own approximate boundaries, including capped ends', () => {
  assert.equal(rank(8).threshold, '0.0708–0.0938');
  assert.equal(rank(0).threshold, '≤ 0.0345');
  assert.equal(rank(1000).threshold, '> 0.6214');
  const html = context.renderRanking({ total_ev_loss: 8, total_decisions: 100 });
  assert.match(html, /title="A\+: 0.0708–0.0938 EV\/D \(approx.\)"/);
});
