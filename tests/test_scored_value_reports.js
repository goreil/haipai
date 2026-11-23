const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const haipaiCategorize = require('../static/js/categorize.js');
const { categorize } = haipaiCategorize;
const { analyzeIishanten } = require('../static/js/iishanten.js');
const reports = require('./fixtures/scored_value_reports.json');

// These are decision-time prepGame outputs from the reported games, not
// estimated walls. Replay the real categorizer/scorer without production data.
function result(reportId) {
  const m = reports.find(r => r.report_ids.includes(reportId)).mistake;
  const { shape, wins } = categorize(m);
  const value = wins.find(w => w.dim === 'scored_value');
  assert.ok(value, `R-${reportId}: no scored Value comparison`);
  assert.equal(value.group, 'Dora'); // Display group: Value
  return { m, shape, wins, value };
}

function drawsFor(m, action) {
  const stat = m.discard_stats.find(s => s.tile === action.pai);
  return analyzeIishanten(m, action.pai, stat);
}

const trainer = vm.createContext({
  haipaiCategorize,
  haipaiCompareDimensions: require('../static/js/compare-dimensions.js'),
  renderTile: tile => `[${tile}]`,
});
for (const file of ['ev-table.js', 'categorize-explanations.js']) {
  vm.runInContext(fs.readFileSync(require.resolve(`../static/js/${file}`), 'utf8'), trainer);
}

function summary(mistakeId) {
  return trainer.explainDiscardShape(reports.find(r => r.mistake.id === mistakeId).mistake, { threats: [] });
}

test('equal projected final waits compare visible yaku shares and overall wait value', () => {
  const text = summary(42402);
  assert.match(text, /Both cuts have a projected final wait of 6–7 tiles/);
  assert.match(text, /Mortal's \[7p\] cut has iipeikou in 34\.8% of weighted outcomes versus 18\.8%/);
  assert.match(text, /\+2,475 wait value overall/);
  assert.doesNotMatch(text, /average|maximum|points/i);
});

test('one-shanten summaries distinguish tiles reaching tenpai from tiles winning the hand', () => {
  const flush = summary(15192);
  assert.match(flush, /Your \[2s\] cut reaches tenpai on 5 more tiles/);
  assert.match(flush, /Mortal's \[3p\] cut has honitsu in 100% of weighted outcomes versus 0%/);
  assert.match(flush, /\+21,845 wait value overall/);
  assert.doesNotMatch(flush, /average|maximum|points|because of honitsu/i);

  const wider = summary(34648);
  assert.match(wider, /Your \[5m\] cut reaches tenpai on 2 more tiles/);
  assert.match(wider, /projects a final wait of 3–11 tiles versus 3–7 tiles/);
  assert.match(wider, /\+6,630 wait value overall/);
  assert.doesNotMatch(wider, /average|maximum|points/i);
});

test('unexplained tenpai picks report the actual wait and wait-value gain only once', () => {
  const text = summary(42417);
  assert.match(text, /Your \[P\] cut leaves 3 winning tiles instead of 2 and gains \+18,000 wait value overall/);
  assert.match(text, /The comparison doesn't show why Mortal prefers \[6p\]/);
  assert.doesNotMatch(text, /average|accepts|reaches tenpai|safer|easier/);
});

test('equal waits without a visible yaku difference report wait value without inventing a reason', () => {
  const text = summary(38391);
  assert.match(text, /Both cuts have a projected final wait of 4–8 tiles/);
  assert.match(text, /Your \[3m\] cut reaches tenpai on 4 more tiles/);
  assert.match(text, /Mortal's \[8s\] cut gains \+2,575 wait value overall/);
  assert.doesNotMatch(text, /average|maximum|points|riichi/i);
  assert.match(summary(19374), /dora/);
});

test('mixed-depth comparisons distinguish an existing wait from a projected one on either side', () => {
  const m = reports.find(r => r.mistake.id === 42417).mistake;
  // Compare two real tenpai cuts from this hand against the same one-shanten cut.
  const compare = tile => trainer.explainDiscardShape({
    ...m, actual: { ...m.actual, pai: tile }, expected: { ...m.expected, pai: '3m' },
  }, { threats: [] });
  const tenpai = compare('P'), projected = compare('6p');
  assert.match(tenpai, /a tenpai wait of 3 tiles versus a projected final wait of 2–3 tiles/);
  assert.match(tenpai, /\+2,571 wait value overall/);
  assert.match(projected, /projects a final wait of 2–3 tiles versus a tenpai wait of 2 tiles/);
  assert.match(projected, /\+15,429 wait value overall/);
  assert.doesNotMatch(tenpai + projected, /average|maximum|points|riichi/i);
});

test('R-292: when speed and peak points tie, stronger iipeikou makes #m42402 a Value decision', () => {
  const { m, shape, wins, value } = result(292);
  assert.equal(m.id, 42402);
  assert.equal(shape, 'obvious');
  assert.deepEqual(wins.filter(w => !w.suppressed).map(w => w.dim), ['scored_value']);
  assert.equal(value.winner, 'mortal');
  assert.deepEqual(value.yaku, ['iipeikou']);
  assert.equal(value.you.maxPoints, value.mortal.maxPoints);
  assert.ok(value.you.yaku.iipeikou > 0 && value.you.yaku.iipeikou < value.mortal.yaku.iipeikou);
  assert.ok(value.mortal.yaku.iipeikou < 1); // A chance, not a guaranteed yaku.
  const next = action => drawsFor(m, action).find(d => d.tile === '1p').branch;
  const actual = next(m.actual), mortal = next(m.expected);
  assert.equal(actual.discard, '9p');
  assert.ok(!actual.groups.some(g => g.ron?.yaku.includes('iipeikou')));
  assert.equal(mortal.discard, '1s');
  const twoSou = mortal.groups.find(g => g.tiles.some(t => t.tile === '2s'));
  assert.ok(twoSou.ron.yaku.includes('iipeikou'));
});

test('R-282: the 3p cut trades ukeire for scored open honitsu', () => {
  const { m, shape, wins, value } = result(282);
  assert.equal(m.expected.pai, '3p');
  assert.equal(shape, 'trade-off');
  assert.ok(wins.some(w => w.dim === 'ukeire' && w.winner === 'you'));
  assert.equal(value.winner, 'mortal');
  assert.equal(value.you.yaku.honitsu, undefined);
  assert.equal(value.mortal.yaku.honitsu, 1);
  assert.deepEqual(value.yaku, ['honitsu']);
});

test('R-291: a white-dragon seven-pairs wait is not a yakuhai triplet', () => {
  const { shape, wins, value } = result(291);
  assert.equal(shape, 'complex'); // No evidence here ranks the honor wait easier to ron.
  assert.ok(!wins.some(w => w.dim === 'yakuhai_kept'));
  assert.equal(value.winner, 'you');
  assert.deepEqual(value.yaku, ['tanyao']);
  for (const side of [value.you, value.mortal]) {
    assert.equal(side.yaku.chiitoitsu, 1);
    assert.ok(!Object.keys(side.yaku).some(name => name.startsWith('yakuhai')));
  }
});

test('R-273: the larger hand wins on average, without inventing a different yaku or a placement motive', () => {
  const { value, wins } = result(273);
  assert.ok(wins.some(w => w.dim === 'ukeire' && w.winner === 'you'));
  assert.equal(value.winner, 'mortal');
  assert.equal(value.you.maxPoints, value.mortal.maxPoints);
  assert.ok(value.mortal.meanPoints > value.you.meanPoints);
  assert.deepEqual(value.yaku, []);
});

for (const [id, terminal, expectedSupport] of [[200, '1s', 12 / 15], [269, '9p', 15 / 17]]) {
  test(`R-${id}: a no-yaku ${terminal} improvement cannot count toward scored tanyao`, () => {
    const { m, wins, value } = result(id);
    // This is a Value fix, not a rewrite of structural acceptance or wait quality.
    assert.ok(wins.some(w => w.dim === 'ukeire' && w.winner === 'you'));
    const draw = drawsFor(m, m.actual).find(d => d.tile === terminal);
    assert.ok(draw.branch.groups.length > 0);
    assert.ok(draw.branch.groups.every(g => g.noYaku));
    assert.equal(value.winner, 'mortal');
    assert.deepEqual(value.yaku, ['tanyao']);
    assert.ok(Math.abs(value.you.yaku.tanyao - expectedSupport) < 1e-9);
    assert.equal(value.mortal.yaku.tanyao, 1);
  });
}

for (const [id, guaranteed] of [[196, 6], [283, 9]]) {
  test(`R-${id}: Mortal keeps a ${guaranteed}-copy wait on every improving draw`, () => {
    const { m, value } = result(id);
    const theirs = drawsFor(m, m.expected), ours = drawsFor(m, m.actual);
    assert.ok(theirs.length > 0 && theirs.every(d => d.branch.count === guaranteed));
    assert.ok(ours.some(d => d.branch.count < guaranteed));
    assert.equal(value.winner, 'mortal');
    assert.ok(value.mortal.waitValue > value.you.waitValue);
  });
}

function liveWaits(draw) {
  return [...new Set(draw.branch.groups.filter(g => g.ron || g.tsumo)
    .flatMap(g => g.tiles.map(t => t.tile.replace(/r$/, ''))))].sort();
}

test('R-279: on a 3m improvement Mortal leaves the 5s/8s side wait', () => {
  const { m, value } = result(279);
  const afterThreeMan = action => drawsFor(m, action).find(d => d.tile === '3m');
  assert.deepEqual(liveWaits(afterThreeMan(m.actual)), ['3m', '7s']);
  assert.deepEqual(liveWaits(afterThreeMan(m.expected)), ['5s', '8s']);
  assert.equal(value.winner, 'mortal');
  assert.ok(value.mortal.waitValue > value.you.waitValue);
});

test('R-280: wider waits outweigh lower points per win, including the reported 6p/9p wait', () => {
  const { m, value } = result(280);
  const draws = drawsFor(m, m.expected);
  for (const tile of ['3m', '6m']) {
    assert.deepEqual(liveWaits(draws.find(d => d.tile === tile)), ['6p', '9p']);
  }
  assert.ok(value.mortal.meanPoints < value.you.meanPoints);
  assert.ok(value.mortal.waitValue > value.you.waitValue);
  assert.equal(value.winner, 'mortal');
});

for (const [id, firstDraw, blockedWaits, blockedCopies, expectedIndex] of [
  [205, '4s', ['2p'], 10, 15250],
  [265, '6s', ['1s', '4s'], 4, 8833],
]) {
  test(`R-${id}: losing ron on a projected wait reduces the discard's Value index`, () => {
    const { m, value } = result(id);
    const actual = drawsFor(m, m.actual);
    const firstBlocked = actual.find(d => d.tile === firstDraw);
    assert.deepEqual(liveWaits(firstBlocked), blockedWaits);
    assert.ok(firstBlocked.branch.groups.every(g => g.furiten && !g.ron && g.tsumo));
    assert.equal(actual.filter(d => d.branch.groups.some(g => g.furiten))
      .reduce((n, d) => n + d.count, 0), blockedCopies);
    assert.ok(drawsFor(m, m.expected).every(d => d.branch.groups.every(g => !g.furiten)));
    // Blocked ron earns zero rather than redistributing its half to tsumo.
    assert.equal(Math.round(value.you.waitValue), expectedIndex);
    assert.equal(value.winner, 'mortal');
  });
}
