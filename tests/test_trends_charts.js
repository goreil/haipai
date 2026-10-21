const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const chart = {};
  const context = vm.createContext({ document: { getElementById: id => id === 'content'
    ? { clientWidth: 1000 } : chart } });
  for (const file of ['game-render', 'trends-charts', 'trends-view']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../static/js/${file}.js`), 'utf8'), context);
  }
  return { context, chart };
}
const game = value => ({ date: '2026-10-21', ev_per_decision: value });
const badges = svg => [...svg.matchAll(/aria-label="Ranking ([^"]+)"/g)].map(m => m[1]);
const render = (context, values) => context.renderLineChart(values.map(game), 'ev_per_decision',
  { color: '#4fc3f7', yLabel: 'Grade' });

test('axis shows relevant subgrades using the shared ranking badges', () => {
  const { context } = setup();
  const svg = render(context, [0.10, 0.13]);
  assert.deepEqual(badges(svg), ['A', 'A−']);
  assert.match(svg, /foreignObject/);
  assert.match(svg, /ranking-letter/);
  assert.match(svg, /<sup>−<\/sup>/);
  assert.equal((svg.match(/<polyline /g) || []).length, 1, 'only the per-game line');
  assert.doesNotMatch(svg, /stroke-dasharray/);
});

test('range selector rescales grades using only the selected last games', () => {
  const { context, chart } = setup();
  context.trendsChartGames = [...Array(30).fill(game(0.65)), ...Array(10).fill(game(0.2)),
    ...Array(10).fill(game(0.1))];
  for (const [limit, expected] of [[10, ['A']], [20, ['A', 'A−', 'B+', 'B']],
    [50, ['A', 'A−', 'B+', 'B', 'B−', 'C+', 'C', 'C−', 'D+', 'D', 'D−', 'E+', 'E']]]) {
    context.updateTrendsGameLimit(String(limit));
    assert.deepEqual(badges(chart.innerHTML), expected);
    assert.equal((chart.innerHTML.match(/<circle /g) || []).length, limit);
  }
});

test('constant, single-point, zero-loss and capped E data have finite geometry', () => {
  const { context } = setup();
  for (const values of [[0], [0, 0], [0.1, 0.1], [0.65], [5, 10]]) {
    const svg = render(context, values);
    assert.equal(badges(svg).length, 1);
    assert.doesNotMatch(svg, /NaN|Infinity/);
    for (const match of svg.matchAll(/<circle cx="[^"]+" cy="([^"]+)"/g)) {
      assert.ok(Number(match[1]) >= 20, 'point is inside plot');
    }
  }
});
