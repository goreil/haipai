const assert = require('node:assert/strict');
const { test } = require('node:test');
const { categorize } = require('../static/js/categorize.js');
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
