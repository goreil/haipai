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
  return { m, ...categorize(m) };
}

// Verify both sides, including the absence of a win for a side with no gain.
// The expected yaku and wait advantages below come from the reported hands.
function projected(wins, expected) {
  assert.ok(!wins.some(w => w.dim === 'scored_value'));
  const values = wins.filter(w => w.dim === 'projected_value');
  const waits = wins.filter(w => w.dim === 'final_wait');
  assert.deepEqual(waits.map(w => [w.winner, w.group]).sort(),
    Object.entries(expected).filter(([, [wider]]) => wider).map(([side]) => [side, 'Speed']).sort());
  const sides = [...new Set([...waits, ...values].map(w => w.winner))].sort();
  assert.deepEqual(sides, Object.keys(expected).sort());
  for (const side of sides) {
    const [, ...yaku] = expected[side];
    const w = values.find(w => w.winner === side);
    assert.deepEqual([...(w?.yaku || [])].sort(), yaku.sort());
    if (!w) continue;
    assert.equal(w.group, 'Dora');
    assert.equal(w.prio, 1);
    assert.ok(!Object.hasOwn(w, 'magnitude'));
  }
  return Object.fromEntries(values.map(w => [w.winner, w]));
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

test('equal projected final waits compare visible iipeikou shares, not aggregate value', () => {
  const text = summary(42402);
  assert.match(text, /iipeikou/i);
  assert.match(text, /34\.8%/);
  assert.match(text, /18\.8%/);
  assert.doesNotMatch(text, /wait value|points/i);
});

test('one-shanten summaries distinguish tiles reaching tenpai from tiles winning the hand', () => {
  const flush = summary(15192);
  assert.match(flush, /5 more tiles/);
  assert.match(flush, /honitsu/i);
  assert.match(flush, /100%/);
  assert.doesNotMatch(flush, /wait value|points/i);

  const wider = summary(34648);
  assert.match(wider, /2 more tiles/);
  assert.match(wider, /3–11/);
  assert.match(wider, /3–7/);
  assert.doesNotMatch(wider, /wait value|points/i);
});

test('unexplained tenpai picks report the actual wait and wait-value gain only once', () => {
  const text = summary(42417);
  assert.match(text, /3 winning tiles instead of 2/);
  assert.match(text, /\+18,000 wait value/);
  assert.equal(text.match(/wait value/gi)?.length, 1);
  assert.match(text, /why Mortal prefers \[6p\]/);
  assert.doesNotMatch(text, /average|accepts|reaches tenpai|safer|easier/);
});

test('R-273: equal visible projections leave Mortal’s preference unexplained', () => {
  const { shape, wins } = result(273);
  projected(wins, {});
  assert.equal(shape, 'complex');
  assert.ok(wins.some(w => w.dim === 'ukeire' && w.winner === 'you'));
  const text = summary(38391);
  assert.doesNotMatch(text, /wait value|points|riichi/i);
  assert.match(summary(19374), /dora/i);
});

test('mixed-depth comparisons distinguish an existing wait from a projected one on either side', () => {
  const m = reports.find(r => r.mistake.id === 42417).mistake;
  // Compare two real tenpai cuts from this hand against the same one-shanten cut.
  for (const [tile, winner, range] of [['P', 'you', 3], ['6p', 'mortal', 2]]) {
    const mixed = { ...m, actual: { ...m.actual, pai: tile }, expected: { ...m.expected, pai: '3m' } };
    const value = projected(categorize(mixed).wins, { [winner]: [true, 'tanyao'] })[winner];
    assert.deepEqual([value.you.minWait, value.you.maxWait], [range, range]);
    assert.deepEqual([value.mortal.minWait, value.mortal.maxWait], [2, 3]);
    assert.ok(!Object.hasOwn(value.mortal, 'waitValue'));
    const text = trainer.explainDiscardShape(mixed, { threats: [] });
    assert.match(text, /tenpai wait/i);
    assert.match(text, /projected final wait/i);
    assert.doesNotMatch(text, /wait value|points|riichi/i);
  }
});

test('R-292: when speed and wait endpoints tie, stronger iipeikou makes #m42402 a Value decision', () => {
  const { m, shape, wins } = result(292);
  const { mortal: value } = projected(wins, { mortal: [false, 'iipeikou'] });
  assert.equal(m.id, 42402);
  assert.equal(shape, 'obvious');
  assert.deepEqual(wins.filter(w => !w.suppressed).map(w => w.dim), ['projected_value']);
  for (const side of [value.you, value.mortal]) {
    assert.deepEqual([side.minWait, side.maxWait], [6, 7]);
    assert.ok(!Object.hasOwn(side, 'waitValue'));
  }
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
  const { m, shape, wins } = result(282);
  const { mortal: value } = projected(wins, {
    you: [true, 'yakuhai (hatsu)'], mortal: [true, 'honitsu'],
  });
  assert.equal(m.expected.pai, '3p');
  assert.equal(shape, 'trade-off');
  assert.ok(wins.some(w => w.dim === 'ukeire' && w.winner === 'you'));
  assert.equal(value.you.yaku.honitsu, undefined);
  assert.equal(value.mortal.yaku.honitsu, 1);
});

test('game summary filters visible yaku by name and counts Value only for a separate value pill', () => {
  const { aggregate, mistakeTouchesConcept } = require('../static/js/game-concept-breakdown.js');
  const { compareDimensions } = trainer.haipaiCompareDimensions;
  const pure = result(292).m, mixed = result(282).m, tenpai = result(291).m, multi = result(205).m;
  const mistakes = [pure, mixed, tenpai, multi];
  const { groups } = aggregate({ rounds: [{ mistakes }] }, compareDimensions, () => 'mistake');
  assert.equal(groups.missed.Yaku.count, 3); // Two yaku on the same side still count once.
  assert.equal(groups.missed.Yaku.subs.Iipeikou.count, 2);
  assert.equal(groups.missed.Dora.count, 1); // Only the hand that also preserves ron.
  assert.equal(groups.missed.Speed.subs.final_wait.count, 2);
  assert.ok(mistakeTouchesConcept(mixed, compareDimensions, { side: 'you', group: 'Speed', dim: 'final_wait' }));
  assert.ok(!mistakeTouchesConcept(mixed, compareDimensions, { side: 'missed', group: 'Dora' }));
  assert.equal(groups.you.Yaku.subs.tanyao_kept.count, 1);
  for (const [m, side, dim] of [[mixed, 'missed', 'honitsu_kept'], [mixed, 'you', 'yakuhai_kept'],
    [tenpai, 'you', 'tanyao_kept'], [pure, 'missed', 'Iipeikou']]) {
    assert.ok(mistakeTouchesConcept(m, compareDimensions, { side, group: 'Yaku', dim }));
  }
  assert.ok(!mistakeTouchesConcept(pure, compareDimensions, { side: 'missed', group: 'Dora' }));
  assert.ok(mistakeTouchesConcept(tenpai, compareDimensions, { side: 'you', group: 'Dora', dim: 'scored_value' }));
});

test('R-291: a white-dragon seven-pairs wait is not a yakuhai triplet', () => {
  const { shape, wins } = result(291);
  assert.ok(!wins.some(w => w.dim === 'projected_value'));
  const value = wins.find(w => w.dim === 'scored_value');
  assert.equal(value.group, 'Dora');
  assert.equal(value.magnitude, 18000);
  assert.equal(shape, 'complex'); // No evidence here ranks the honor wait easier to ron.
  assert.ok(!wins.some(w => w.dim === 'yakuhai_kept'));
  assert.equal(value.winner, 'you');
  assert.deepEqual(value.yaku, ['tanyao']);
  for (const side of [value.you, value.mortal]) {
    assert.equal(side.yaku.chiitoitsu, 1);
    assert.ok(!Object.keys(side.yaku).some(name => name.startsWith('yakuhai')));
  }
});

for (const [id, terminal, expectedSupport] of [[200, '1s', 12 / 15], [269, '9p', 15 / 17]]) {
  test(`R-${id}: a no-yaku ${terminal} improvement cannot count toward scored tanyao`, () => {
    const { m, wins } = result(id);
    const { mortal: value } = projected(wins, { mortal: [true, 'tanyao'] });
    // This is a Value fix, not a rewrite of structural acceptance or wait quality.
    assert.ok(wins.some(w => w.dim === 'ukeire' && w.winner === 'you'));
    const draw = drawsFor(m, m.actual).find(d => d.tile === terminal);
    assert.ok(draw.branch.groups.length > 0);
    assert.ok(draw.branch.groups.every(g => g.noYaku));
    assert.ok(Math.abs(value.you.yaku.tanyao - expectedSupport) < 1e-9);
    assert.equal(value.mortal.yaku.tanyao, 1);
  });
}

for (const [id, guaranteed] of [[196, 6], [283, 9]]) {
  test(`R-${id}: Mortal keeps a ${guaranteed}-copy wait on every improving draw`, () => {
    const { m, wins } = result(id);
    const { mortal: value } = projected(wins, { mortal: [true, 'pinfu'] });
    const theirs = drawsFor(m, m.expected), ours = drawsFor(m, m.actual);
    assert.ok(theirs.length > 0 && theirs.every(d => d.branch.count === guaranteed));
    assert.ok(ours.some(d => d.branch.count < guaranteed));
    assert.equal(value.mortal.minWait, guaranteed);
    assert.equal(value.mortal.maxWait, guaranteed);
    assert.ok(value.you.minWait < guaranteed);
  });
}

function liveWaits(draw) {
  return [...new Set(draw.branch.groups.filter(g => g.ron || g.tsumo)
    .flatMap(g => g.tiles.map(t => t.tile.replace(/r$/, ''))))].sort();
}

test('R-279: on a 3m improvement Mortal leaves the 5s/8s side wait', () => {
  const { m, wins } = result(279);
  const { mortal: value } = projected(wins, { mortal: [true, 'tanyao'] });
  const afterThreeMan = action => drawsFor(m, action).find(d => d.tile === '3m');
  assert.deepEqual(liveWaits(afterThreeMan(m.actual)), ['3m', '7s']);
  assert.deepEqual(liveWaits(afterThreeMan(m.expected)), ['5s', '8s']);
  assert.deepEqual([value.you.maxWait, value.mortal.maxWait], [9, 10]);
});

test('R-280: Mortal gains on wait width and pinfu, while the player gains on sanshoku', () => {
  const { m, wins } = result(280);
  const { mortal: value } = projected(wins, {
    mortal: [true, 'pinfu'], you: [false, 'sanshoku'],
  });
  const draws = drawsFor(m, m.expected);
  for (const tile of ['3m', '6m']) {
    assert.deepEqual(liveWaits(draws.find(d => d.tile === tile)), ['6p', '9p']);
  }
  assert.deepEqual([value.you.minWait, value.mortal.minWait], [3, 3]);
  assert.deepEqual([value.you.maxWait, value.mortal.maxWait], [7, 11]);
});

for (const [id, firstDraw, blockedWaits, blockedCopies, ronDraws, gains] of [
  [205, '4s', ['2p'], 10, ['4s', '5s', '7s', 'F'], { you: [true], mortal: [true, 'iipeikou', 'yakuhai (hatsu)'] }],
  [265, '6s', ['1s', '4s'], 4, ['6s', 'W'], { you: [true], mortal: [false] }],
]) {
  test(`R-${id}: Mortal preserves ron on shared improvements where the player becomes furiten`, () => {
    const { m, wins, shape } = result(id);
    const actual = drawsFor(m, m.actual);
    const firstBlocked = actual.find(d => d.tile === firstDraw);
    assert.deepEqual(liveWaits(firstBlocked), blockedWaits);
    assert.ok(firstBlocked.branch.groups.every(g => g.furiten && !g.ron && g.tsumo));
    assert.equal(actual.filter(d => d.branch.groups.some(g => g.furiten))
      .reduce((n, d) => n + d.count, 0), blockedCopies);
    assert.ok(drawsFor(m, m.expected).every(d => d.branch.groups.every(g => !g.furiten)));
    const values = projected(wins, gains);
    assert.deepEqual([...values.mortal.ronDraws].sort(), ronDraws);
    assert.equal(values.you, undefined); // The player's wider wait is not a Value win.
    assert.equal(shape, 'trade-off');
  });
}
