// Run with: node --test tests/test_iishanten.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepMistake } = require('../static/js/prep/prep.js');
const { base_mjai } = require('../static/js/prep/tiles.js');
const { groupValueRows, groupIishantenValues, sortIishantenWaitGroups } = require('../static/js/iishanten-values.js');

const ctx = vm.createContext({ renderTile: tile => tile });
ctx.self = ctx; // classic worker globals, no window or DOM
for (const file of ['prep/tiles', 'prep/parse', 'prep/prep-board-state', 'vendor/riichi/riichi-bundle',
  'categorize-yaku', 'bad-riichi-bars', 'iishanten', 'scored-value']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', `${file}.js`), 'utf8'), ctx);
}

// A decision-time snapshot from the real event walker, shanten kernel and
// bundled scorer. No precomputed ukeire, waits, or mocked scoring results.
function prep(hand, { melds = [], discards = [], marker = 'F', meldEvents = [] } = {}) {
  const player = 3;
  const events = [{ type: 'start_kyoku', bakaze: 'E', kyoku: 3, oya: 2, dora_marker: marker,
    scores: [25000, 25000, 25000, 25000] }];
  for (const [actor, pai] of discards) {
    events.push({ type: 'tsumo', actor }, { type: 'dahai', actor, pai });
  }
  events.push(...meldEvents, { type: 'tsumo', actor: player, pai: hand.at(-1) });
  const m = { hand, melds, actual: { type: 'dahai', actor: player, pai: hand.at(-1) },
    expected: { type: 'dahai', actor: player, pai: hand[0] } };
  const patch = prepMistake(m, { mjai_log: events, player_id: player }, 0,
    { last_actor: player, tiles_left: 69 - discards.length }, null);
  return Object.assign(m, patch);
}
function analyze(m, tile) {
  const stat = m.discard_stats.find(s => base_mjai(s.tile) === base_mjai(tile));
  assert.equal(stat.shanten, 1);
  return ctx.analyzeIishanten(m, tile, stat);
}
function branch(draw, tile) {
  assert.equal(draw.branch?.discard, tile, `selected tenpai discard after drawing ${draw.tile}`);
  return draw.branch;
}
function on(b, tile) {
  const g = b.groups.find(g => g.tiles.some(t => t.tile === tile));
  assert.ok(g, `score for ${tile} after discarding ${b.discard}`);
  return g;
}
function copies(b, tile) {
  return b.groups.flatMap(g => g.tiles).find(t => t.tile === tile)?.count ?? 0;
}

const hand42402 = '2p 3p 6p 7p 7p 8p 9p 9p 1s 2s 3s 4s 4s 3s'.split(' ');
const rivers42402 = 'N N 1p 1m 1s W 9p E 1s P 5m 3p 3s 6m 6p 7s C 6m 4p 1m F'
  .split(' ').map((t, i) => [(i + 2) % 4, t]);

test('#m42402: only the selected widest wait contributes yaku to its draw', () => {
  const m = prep(hand42402, { discards: rivers42402 });
  const mortal = analyze(m, '7p'), actual = analyze(m, '3s');
  for (const draws of [mortal, actual]) {
    assert.equal(draws.reduce((sum, d) => sum + d.count, 0), 16);
    const d = draws.find(d => d.tile === '4p');
    assert.equal(d.count, 3);
    assert.equal(d.unavailable, false);
    assert.ok(d.yaku.find(y => y.name === 'riichi').confirmed);
    const paired = groupIishantenValues(draws).find(g => g.draws.includes(d));
    assert.ok(paired.draws.includes(draws.find(draw => draw.tile === '1p')));
    assert.equal(paired.maxHan, 4); // riichi, pinfu, tsumo and either iipeikou or aka
    assert.deepEqual(paired.dora, { label: '0–1 dora' });
    assert.equal(paired.yaku.find(y => y.name === 'iipeikou')?.confirmed, draws === mortal ? false : undefined);
  }
  const diff = groupIishantenValues(mortal, actual);
  const gain = diff.find(g => g.draws.some(d => d.tile === '4p'));
  assert.ok(gain.draws.includes(mortal.find(d => d.tile === '1p')));
  assert.ok(gain.additional);
  assert.deepEqual(Array.from(gain.yaku, y => [y.name, y.confirmed]), [['iipeikou', false]]);
  assert.equal(gain.dora, null); // both continuations can score the same aka
  const reverse = groupIishantenValues(actual, mortal);
  assert.ok(!reverse.some(g => g.draws.some(d => ['1p', '4p'].includes(d.tile))));
  assert.deepEqual(groupIishantenValues(mortal, mortal), []);
  for (const [mine, theirs, compact] of [[mortal, actual, diff], [actual, mortal, reverse]]) {
    for (const d of mine.filter(d => !theirs.some(peer => peer.tile === d.tile))) {
      const row = compact.find(g => g.draws.includes(d));
      assert.ok(row);
      assert.equal(row.additional, false);
      assert.deepEqual(row.yaku, groupIishantenValues([d])[0].yaku);
    }
  }
  const wide = branch(mortal.find(d => d.tile === '4p'), '1s');
  assert.equal(wide.count, 7);
  assert.equal(copies(wide, '2s'), 3);
  assert.deepEqual([...on(wide, '2s').ron.yaku].sort(), ['iipeikou', 'pinfu', 'riichi']);
  assert.deepEqual([...on(wide, '5s').ron.yaku].sort(), ['pinfu', 'riichi']);
  assert.equal(copies(wide, '5sr'), 1);
  assert.equal(on(wide, '5sr').ron.aka, 1);
  const d = actual.find(d => d.tile === '4p');
  const pinfu = branch(d, '9p');
  assert.equal(pinfu.count, 7);
  assert.equal(pinfu.label, 'Best');
  for (const t of ['5p', '5pr', '8p']) assert.deepEqual([...on(pinfu, t).ron.yaku].sort(), ['pinfu', 'riichi']);
  assert.equal(analyze(m, '7p'), mortal); // rerender does not rescore this card
});

test('the iishanten profile weights each selected wait first, then each physical draw', () => {
  const m = prep(hand42402, { discards: rivers42402 });
  const stat = m.discard_stats.find(s => s.tile === '7p');
  const draws = analyze(m, '7p');
  let points = 0, iipeikou = 0, maxPoints = 0, copies = 0;
  for (const d of draws) {
    let wins = 0, value = 0, matching = 0;
    for (const group of d.branch.groups) {
      for (const tile of group.tiles) {
        for (const score of [group.ron, group.tsumo].filter(Boolean)) {
          wins += tile.count;
          value += tile.count * score.ten;
          maxPoints = Math.max(maxPoints, score.ten);
          if (score.yaku.includes('iipeikou')) matching += tile.count;
        }
      }
    }
    points += d.count * (wins ? value / wins : 0);
    iipeikou += d.count * (wins ? matching / wins : 0);
    copies += d.count;
  }
  const worker = ctx.haipaiScoredValue.profile(m, '7p', stat);
  const node = require('../static/js/scored-value.js').profile(m, '7p', stat);
  assert.deepEqual(structuredClone(worker), node);
  assert.equal(node.meanPoints, points / copies);
  assert.equal(node.maxPoints, maxPoints);
  assert.equal(node.yaku.iipeikou, iipeikou / copies);
  assert.ok(node.yaku.iipeikou > 0 && node.yaku.iipeikou < 1);
});

test('#m42402: on a 1p draw only the cut with iipeikou on 2s earns Best', () => {
  // Encounter the lower-value cut first; selection must not depend on hand order.
  const m = prep([...hand42402].reverse(), { discards: rivers42402 });
  const draw = analyze(m, '7p').find(d => d.tile === '1p');
  const best = branch(draw, '1s'), other = draw.branches.find(b => b.discard === '4s');
  assert.equal(best.count, other.count);
  assert.equal(best.profile.maxPoints, other.profile.maxPoints);
  assert.ok(on(best, '2s').ron.yaku.includes('iipeikou'));
  assert.ok(!on(other, '2s').ron.yaku.includes('iipeikou'));
  assert.equal(best.label, 'Best');
  assert.equal(other.label, 'Cut');
});

test('a narrower discard can win more points without replacing the width-first summary', () => {
  const m = prep(hand42402, { discards: [...rivers42402, [1, '5pr']] });
  const draw = analyze(m, '3s').find(d => d.tile === '4p');
  assert.equal(branch(draw, '9p').label, 'Speed');
  assert.deepEqual(Object.fromEntries(draw.branches.map(b => [b.discard, [b.label, b.count, b.profile.maxPoints]])), {
    '6p': ['Value', 3, 4000], '7p': ['Cut', 3, 2000], '9p': ['Speed', 6, 2700],
  });
});

test('even an exhausted wait in the river locks ron on every other wait', () => {
  const discards = [...rivers42402, [3, '2s'], [1, '2s'], [0, '2s']];
  const m = prep(hand42402, { discards });
  const d = analyze(m, '7p').find(d => d.tile === '4p');
  const b = branch(d, '1s');
  assert.equal(b.count, 4);
  assert.equal(copies(b, '2s'), 0);
  for (const group of b.groups) {
    assert.equal(group.furiten, true);
    assert.equal(group.ron, null);
    assert.ok(group.tsumo.ten > 0);
    assert.ok(!group.tsumo.yaku.includes('iipeikou'));
  }
  const dry = prep(hand42402, { discards: [...discards, [0, '5s'], [1, '5s'], [2, '5sr'], [1, '5s']] });
  // Exhausting the previous widest wait changes which discard is selected.
  assert.equal(branch(analyze(dry, '7p').find(d => d.tile === '4p'), '3s').count, 3);
});

test('the proposed first discard joins the river, not the unseen wall', () => {
  const m = prep('1m 2m 3m 8m 9m 4p 5p 1s 2s 3s 2s 2s 9s 3p'.split(' '));
  const b = branch(analyze(m, '3p').find(d => d.tile === '7m'), '9s');
  assert.equal(copies(b, '3p'), 3);
  assert.equal(copies(b, '6p'), 4);
  assert.ok(b.groups.every(g => g.furiten && g.ron === null && g.tsumo));
});

test('physical fives split without multiplying draw copies or replenishing a discard', () => {
  const m = prep('1m 2m 3m 4m 5m 6m 7p 8p 9p 2s 2s 5s N C'.split(' '));
  const draws = analyze(m, 'C');
  const regular = draws.find(d => d.tile === '5s'), red = draws.find(d => d.tile === '5sr');
  assert.equal(regular.count, 2);
  assert.equal(red.count, 1);
  const a = branch(regular, 'N'), b = branch(red, 'N');
  assert.equal(copies(a, '5s'), 1);
  assert.equal(copies(a, '5sr'), 1);
  assert.equal(copies(b, '5s'), 2);
  assert.equal(copies(b, '5sr'), 0);
  assert.equal(on(b, '2s').tsumo.aka, 1);
  assert.equal(on(a, '2s').tsumo.aka, 0);
  assert.equal(m.iishanten_wall[22], 3);
  assert.equal(m.iishanten_wall[36], 1);

  // Put red first: equal structural waits must be broken by scored value, not enumeration order.
  const both = prep('1m 2m 4p 5pr 5p 6p 7s 8s 9s 1s 2s 6m 6m 9p'.split(' '));
  const d = analyze(both, '9p').find(d => d.tile === '3m');
  assert.equal(d.branch.count, 4);
  assert.equal(on(branch(d, '5p'), '3s').tsumo.aka, 1);
});

test('next-turn riichi enables otherwise yakuless ron only with the stick and a full turn left', () => {
  const m = prep('1m 2m 3m 4p 5p 6p 7s 9s E E 3p 4p N C'.split(' '));
  for (const [points, left, eligible] of [[1000, 8, true], [900, 8, false], [1000, 7, false]]) {
    const snapshot = { ...m, turn: 1, board_state: { ...m.board_state,
      tiles_left: left, scores: [25000, 25000, 25000, points] } };
    const draw = analyze(snapshot, 'C').find(d => d.tile === '8s');
    const g = on(branch(draw, 'N'), '2p');
    if (eligible) {
      assert.deepEqual([...g.ron.yaku], ['riichi']);
      assert.equal(g.ron.han, 1); // not double riichi, even from a first-turn snapshot
    } else {
      assert.equal(g.ron, null);
      assert.equal(g.tsumo.han, 1); // menzen tsumo only
    }
  }
});

test('a method-only yaku is conditional and explained on the matching win method', () => {
  const m = prep('3m 3m 3m 6p 6p 6p 2s 2s F F 7p 8p N C'.split(' '));
  const d = analyze(m, 'C').find(d => d.tile === '9p');
  assert.equal(d.yaku.find(y => y.name === 'sanankou').confirmed, false);
  const g = on(branch(d, 'N'), 'F');
  assert.ok(!g.yaku.includes('sanankou'));
  assert.ok(!g.ron.yaku.includes('sanankou'));
  assert.ok(g.tsumo.yaku.includes('sanankou'));
  assert.match(ctx.renderRiichiScoreCell([g], false), /Tsumo.*sanankou/);
  assert.ok(d.yaku.find(y => y.name === 'riichi').confirmed);
});

test('concealed kan preserves menzen, kan dora and one aka; an open kan cannot claim iipeikou', () => {
  const hand = '2p 3p 2p 3p 4p 8s 9s E E N C'.split(' ');
  const ankan = { type: 'ankan', consumed: ['5m', '5m', '5mr', '5m'] };
  const m = prep(hand, { marker: '4m', melds: [ankan], meldEvents: [{ ...ankan, actor: 3 }] });
  const b = branch(analyze(m, 'C').find(d => d.tile === '4p'), 'N');
  const g = on(b, '7s');
  assert.ok(g.ron.yaku.includes('iipeikou'));
  assert.ok(g.ron.yaku.includes('riichi'));
  assert.equal(g.ron.dora, 4);
  assert.equal(g.ron.aka, 1);
  assert.equal(g.tsumo.han, g.ron.han + 1);
  assert.deepEqual(groupIishantenValues([analyze(m, 'C').find(d => d.tile === '4p')])[0].dora,
    { label: '5 dora' });
  const kakan = { type: 'kakan', consumed: ['5m', '5m'], previous_pon_pai: '5mr', pai: '5m' };
  const open = prep(hand, { marker: '4m', melds: [kakan], discards: [[1, '5mr']], meldEvents: [
    { type: 'pon', actor: 3, target: 1, pai: '5mr', consumed: ['5m', '5m'] },
    { type: 'kakan', actor: 3, consumed: ['5m', '5m', '5mr'], pai: '5m' },
  ] });
  const draw = analyze(open, 'C').find(d => d.tile === '4p');
  assert.deepEqual([...draw.yaku], []);
  assert.equal(draw.unavailable, false);
  assert.equal(on(branch(draw, 'N'), '7s').noYaku, true);
  // A physically present kan dora and red five do not score on a no-yaku win.
  const [noYaku] = groupIishantenValues([draw]);
  assert.equal(noYaku.dora, null);
  assert.equal(noYaku.maxHan, 0);
  assert.equal(noYaku.dead, false);
  assert.equal(ctx._meldFuroStr(kakan), '5505m');
});

test('seven pairs is evaluated as a winning shape, not forced into four sets', () => {
  const m = prep('1m 1m 2m 2m 3p 3p 4p 4p 5s 5s 7m 9p N C'.split(' '));
  const d = analyze(m, 'C').find(d => d.tile === '7m');
  assert.ok(d.yaku.find(y => y.name === 'chiitoitsu').confirmed);
  assert.ok(on(branch(d, '9p'), 'N').ron.yaku.includes('chiitoitsu'));
});

test('ineligible and missing inputs stay unavailable; inconsistent draws do not confirm yaku', () => {
  const m = prep(hand42402, { discards: rivers42402 });
  const stat = m.discard_stats.find(s => s.tile === '7p');
  for (const bad of [{ ...m, iishanten_wall: null }, { ...m, board_state: {} }]) {
    assert.equal(ctx.analyzeIishanten(bad, '7p', stat), null);
  }
  assert.equal(ctx.analyzeIishanten(m, '7p', { ...stat, shanten: 2 }), null);
  assert.equal(ctx.analyzeIishanten(m, '1m', stat), null);
  const [inconsistent] = ctx.analyzeIishanten(m, '7p', { ...stat, necessary_tiles: [{ tile: 'E', count: 3 }] });
  assert.ok(inconsistent.unavailable);
  assert.deepEqual([...inconsistent.yaku], []);

  // Real calculator rejects this malformed chi. The branches still have
  // structural waits and counts; missing scores aren't reported as no yaku.
  const meld = { type: 'chi', consumed: ['1m', '2m'], pai: '8m' };
  const badMeld = prep('2p 3p 2p 3p 4p 8s 9s E E N C'.split(' '), { melds: [meld] });
  const draw = analyze(badMeld, 'C').find(d => d.tile === '4p');
  assert.ok(draw.unavailable);
  assert.equal(branch(draw, 'N').groups, null);
  assert.ok(branch(draw, 'N').count > 0);
  assert.deepEqual([...draw.yaku], []);
});

test('yakuman outranks ordinary han; ron and tsumo contribute only the bonuses they score', () => {
  const m = prep('1m 1m 1m 7p 7p 7p 3s 3s 3s 5m 5m 2p N C'.split(' '), { marker: '4m' });
  const draws = analyze(m, 'C');
  const ordinary = draws.find(d => d.tile === '3p'), rich = draws.find(d => d.tile === '2p');
  const [first, second] = groupIishantenValues([ordinary, rich]);
  assert.equal(first.draws[0], rich);
  assert.equal(first.maxYakuman, 1); // suuankou on tsumo only
  assert.equal(first.maxHan, 9); // riichi + toitoi + sanankou + three dora + aka on red-five ron
  assert.deepEqual(first.dora, { label: '0–4 dora' });
  assert.equal(second.maxYakuman, 0);
  assert.equal(second.maxHan, 6);
  assert.deepEqual(second.dora, { label: '2 dora' });

  const shanpon = branch(rich, 'N');
  // A separate tenpai (ordinary 1p wait) loses to every yakuman-capable
  // wait; the shanpon ends tie on tsumo, so their legal ron han break ties.
  const candidates = Object.freeze([on(branch(ordinary, 'N'), '1p'), on(shanpon, '2p'),
    on(shanpon, '5m'), on(shanpon, '5mr')]);
  assert.deepEqual(sortIishantenWaitGroups(candidates), [...candidates].reverse());
});

test('unavailable, dead, and live no-yaku draws stay distinct even when all have zero han', () => {
  const empty = { yaku: [], unavailable: false };
  const unknown = { ...empty, tile: 'E', unavailable: true, branch: null };
  const dead = { ...empty, tile: 'S', branch: { count: 0, groups: [] } };
  const noYaku = { ...empty, tile: 'W', branch: { count: 2, groups: [{ ron: null, tsumo: null }] } };
  const profiles = groupIishantenValues([unknown, noYaku, dead]);
  assert.deepEqual(profiles.map(p => [p.draws[0].tile, p.dead, p.unavailable]), [
    ['W', false, false], ['S', true, false], ['E', false, true],
  ]);
  assert.ok(profiles.every(p => p.maxHan === 0 && p.maxYakuman === 0 && p.dora === null));
  for (const [mine, peer, expected] of [[unknown, dead, 'Value unavailable'],
    [dead, noYaku, 'No unseen winning tiles'], [noYaku, unknown, 'No yaku']]) {
    const [changed] = groupIishantenValues([mine], [{ ...peer, tile: mine.tile }]);
    assert.equal(changed.status, expected);
    assert.equal(changed.additional, false);
  }
});

test('mutually exclusive red/regular bonuses and value honors are counted per win, not summed across wins', () => {
  const score = (dora, aka, ...yaku) => ({ dora, aka, yaku, han: 4, yakuman: 0 });
  const w = score(2, 0, 'yakuhai (seat east)');
  const dragon = score(1, 1, 'yakuhai (hatsu)');
  const draw = { unavailable: false, yaku: [...w.yaku, ...dragon.yaku].map(name => ({ name, confirmed: false })),
    branch: { count: 2, groups: [{ ron: w, tsumo: w }, { ron: dragon, tsumo: dragon }] } };
  const [fixed] = groupIishantenValues([draw]);
  assert.deepEqual(fixed.yaku, [{ name: 'yakuhai 1', confirmed: true }]);
  assert.deepEqual(fixed.dora, { label: '2 dora' });
  w.yaku.push('yakuhai (round east)');
  assert.deepEqual(groupIishantenValues([draw])[0].yaku, [{ name: 'yakuhai 1–2', confirmed: false }]);
});

test('compare physical waits first, then group equal displayed yaku across dora and aka', () => {
  function row(tile, dora, aka, name = 'pinfu') {
    const score = { dora, aka, yaku: [name], han: 1 + dora + aka, yakuman: 0 };
    return { tile, count: 1, yaku: [{ name, confirmed: true }], groups: [{ ron: score, tsumo: score }] };
  }
  const a = [row('5p', 0, 0), row('5pr', 1, 1), row('6p', 0, 0), row('8p', 1, 0)];
  const b = [row('6p', 0, 0), row('5pr', 0, 1), row('5p', 1, 0)];
  const diff = groupValueRows(a, b);
  assert.equal(diff.length, 2);
  const bonuses = diff.find(g => !g.yaku.length), unique = diff.find(g => g.yaku.length);
  assert.deepEqual(bonuses.draws, a.slice(0, 2));
  assert.deepEqual(bonuses.dora, { label: '0–2 dora' });
  assert.deepEqual(unique.draws, [a[3]]);
  assert.deepEqual(unique.yaku, a[3].yaku);
  assert.deepEqual(unique.dora, { label: '1 dora' });
  const full = groupValueRows(a);
  assert.equal(full.length, 1);
  assert.deepEqual(full[0].draws, a);
  assert.deepEqual(full[0].dora, bonuses.dora);
  assert.equal(full[0].maxHan, 3);
  assert.equal(groupValueRows([row('5pr', 1, 0)], [row('5pr', 0, 1)]).length, 0);
  const [explicit] = groupValueRows([{ ...a[0], status: 'Furiten · tsumo only' }], [a[0]]);
  assert.equal(explicit.status, 'Furiten · tsumo only');
  assert.deepEqual(explicit.yaku, a[0].yaku);
  const [dead] = groupValueRows([{ ...a[0], dead: true, status: 'Furiten · tsumo only' }]);
  assert.equal(dead.status, 'No unseen winning tiles');

  const gains = groupValueRows(a.slice(0, 2), [row('5p', 0, 0, 'tanyao'), row('5pr', 0, 1, 'tanyao')]);
  assert.equal(gains.length, 2);
  const pinfuOnly = gains.find(g => g.draws.includes(a[0]));
  assert.deepEqual(pinfuOnly.draws, [a[0]]);
  assert.deepEqual(pinfuOnly.yaku, a[0].yaku);
  assert.equal(pinfuOnly.dora, null);
  assert.deepEqual(gains.find(g => g.draws.includes(a[1])).dora, { label: '2 dora' });
});
