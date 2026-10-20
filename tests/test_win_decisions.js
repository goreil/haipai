const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepReport } = require('../static/js/prep/prep.js');
const { skill_area_for_entry } = require('../static/js/prep/parse.js');
const fixture = require('./fixtures/win_m323.json');

function example(data = structuredClone(fixture)) {
  const e = data.review.kyokus[0].entries[0];
  const m = { id:323, hand:e.state.tehai, melds:e.state.fuuros, actual:e.actual,
    expected:e.expected, draw:e.tile, turn:e.junme, ev_loss:2.42,
    top_actions:e.details };
  prepReport(m, data, 0, 0);
  return m;
}
const context = vm.createContext({ window:{}, console });
const index = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
for (const match of index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)) {
  if (!match[1].endsWith('/actions.js')) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', match[1]), 'utf8'), context);
  if (match[1].endsWith('/mistake-card.js')) break;
}

test('Win decisions always belong to Attack, including under a threat', () => {
  for (const other of ['none', 'dahai', 'reach', 'pon', 'ankan']) {
    assert.equal(skill_area_for_entry(other, 'hora', [], true, true), 'attack');
    assert.equal(skill_area_for_entry('hora', other, [], true, true), 'attack');
  }
});

test('m323 keeps the winning snapshot and reconstructs the actual 4p discard separately', () => {
  const m = example();
  assert.equal(m.actual.type, 'none');
  assert.equal(m.hand.length, 13);
  assert.equal(m.win_context.flags, 'ri');
  assert.equal(m.win_continuation.actual.pai, '4p');
  assert.equal(m.win_continuation.hand.length, 14);
  assert.equal(m.win_continuation.discard_stats.find(s => s.tile === '4p').shanten, 0);
  const html = context.renderEvComparison(m);
  assert.match(html, /col-actual[^]*>PASS<\/span>/);
  assert.doesNotMatch(html, /alt="4p"/);
  assert.match(html, /col-expected[^]*>Ron<\/span>/);
  assert.match(html, /ippatsu/);
  assert.match(html, /2,600/); // 2 han, 40 fu, non-dealer ron.
  assert.match(html, /3,600/); // Includes the already deposited riichi stick.
  assert.doesNotMatch(html, /class="dealin-col"|Winning ends the hand/);
  assert.match(html, /Unrevealed ura excluded/);
  assert.doesNotMatch(html, /feat-summary-row/);
  assert.equal(context.haipaiCategorize.categorize(m).skillArea, "attack");
  assert.doesNotMatch(context.renderWinScore(m), /~|no yaku|Tsumo/);
});

test('a round ending after a pass does not invent a subsequent discard', () => {
  const data = structuredClone(fixture);
  const end = data.mjai_log.findIndex(e => e.type === 'tsumo' && e.pai === '4p' && e.actor === 3);
  data.mjai_log.splice(end, Infinity, {type:'ryukyoku'}, {type:'end_kyoku'});
  const m = example(data);
  assert.equal(m.win_continuation, undefined);
  assert.match(context.renderEvComparison(m), /PASS/);
});

test('an AI pass keeps an unknown continuation while a tsumo gets only its actual score', () => {
  const m = example();
  m.hand.push('8m');
  m.actual = {type:'hora',actor:3,target:3};
  m.expected = {type:'none'};
  m.win_context = {tile:'8m',tsumo:true,flags:'r',honba:2,kyotaku:1};
  delete m.win_continuation;
  const html = context.renderEvComparison(m);
  assert.match(html, /col-actual/);
  assert.match(html, /col-expected/);
  assert.match(html, /PASS/);
  const score = context.renderWinScore(m);
  assert.match(score, /Tsumo/);
  assert.doesNotMatch(score, /Ron|no yaku|~|ura<\/span>/);
});

test('declining tsumo still prepares discard values for a complete hand', () => {
  const { prepMistake } = require('../static/js/prep/prep.js');
  const hand = ['1m','2m','3m','3m','3m','6m','7m','8m','7p','7p','7p','5s','6s','7s'];
  const m = {hand, melds:[], actual:{type:'dahai',actor:3,pai:'8m'},
    expected:{type:'hora',actor:3,target:3}};
  const data = {player_id:3, mjai_log:[
    {type:'start_kyoku',bakaze:'E',kyoku:1,oya:0,dora_marker:'4m'},
    {type:'tsumo',actor:3,pai:'8m'},
  ]};
  const patch = prepMistake(m, data, 0, {tiles_left:69,last_actor:3,tile:'8m'},
    {mjai_events:data.mjai_log,start_pos:0,end_pos:2,player_id:3});
  assert.equal(patch.discard_stats.find(s => s.tile === '8m').shanten, 0);
  assert.equal(patch.win_context.tsumo, true);
});

test('an actual win uses revealed ura instead of estimating an ura bonus', () => {
  const data = structuredClone(fixture);
  const e = data.review.kyokus[0].entries[0];
  e.actual = e.expected;
  e.expected = {type:'none'};
  const i = data.mjai_log.findIndex(x => x.type === 'dahai' && x.actor === 2 && x.pai === '8m');
  data.mjai_log.splice(i + 1, Infinity,
    {type:'hora',actor:3,target:2,ura_markers:['6p']}, {type:'end_kyoku'});
  const m = example(data);
  assert.deepEqual(m.win_context.ura_tiles, ['7p']);
  const html = context.renderWinScore(m);
  assert.match(html, /8,000/);
  assert.match(html, /9,000/);
  assert.doesNotMatch(html, /Unrevealed|~|no yaku/);
});

test('a later tsumo does not replace the original pass-versus-ron decision', () => {
  const data = structuredClone(fixture);
  const i = data.mjai_log.findIndex(x => x.type === 'tsumo' && x.actor === 3 && x.pai === '4p');
  data.mjai_log.splice(i, Infinity, {type:'tsumo',actor:3,pai:'5m'},
    {type:'hora',actor:3,target:3,ura_markers:[]}, {type:'end_kyoku'});
  const m = example(data);
  assert.equal(m.win_continuation.actual.type, 'hora');
  assert.equal(m.win_continuation.win_context.tile, '5m');
  const html = context.renderEvComparison(m);
  assert.match(html, /col-actual[^]*>PASS<\/span>/);
  assert.doesNotMatch(html, /class="tile ev-tile"[^>]*alt="5m"/);
  assert.match(html, /col-expected[^]*alt="8m"/);
  assert.doesNotMatch(context.renderWinScore(m), /Tsumo/);
  assert.match(html, /Ron/);
  assert.doesNotMatch(html, /class="dealin-col"|Winning ends the hand/);
});

test('Win comparisons show Deal-in only with threat data, like tenpai comparisons', () => {
  for (const kind of ['riichi', 'open']) {
    const m = example();
    const rates = {'8m':12};
    Object.assign(m, {
      dealin_rates: rates,
      per_threat: [{seat:1,kind,dealin_rates:rates}],
    });
    const html = context.renderEvComparison(m);
    assert.match(html, /class="dealin-col"/);
    assert.match(html, /Ron/);
    assert.doesNotMatch(html, /12.0%/);
    assert.match(html, /Winning ends the hand">0.0%/);
  }
});

test('passing ron in riichi locks every wait while preserving tsumo and the available AI ron', () => {
  const m = example();
  assert.equal(m.passed_win.furiten_kind, 'riichi_pass');
  assert.deepEqual(m.passed_win.waits.map(w => w.tile), ['5m','8m']);
  const groups = context.evalDiscardScores({...m,furiten_kind:m.passed_win.furiten_kind},
    null,m.passed_win.waits,true);
  for (const group of groups) {
    assert.equal(group.ron,null);
    assert.ok(group.tsumo.ten > 0);
    assert.ok(group.tiles.every(t => t.furiten));
  }
  const html = context.renderRiichiScoreCell(groups,true);
  assert.match(html,/furiten-badge/);
  assert.match(html,/rest of this hand/);
  assert.doesNotMatch(html,/already discarded|no yaku/);
  assert.match(context.renderWinScore(m),/2,600/);
});

test('passing ron outside riichi uses temporary furiten wording', () => {
  const data = structuredClone(fixture);
  data.mjai_log = data.mjai_log.filter(e => !['reach','reach_accepted'].includes(e.type));
  const m = example(data);
  assert.equal(m.passed_win.furiten_kind,'temporary_pass');
  const groups = context.evalDiscardScores({...m,furiten_kind:m.passed_win.furiten_kind},
    null,m.passed_win.waits,false);
  assert.ok(groups.every(g => !g.ron && g.tsumo));
  const html = context.renderRiichiScoreCell(groups,false);
  assert.match(html,/until your next draw/);
  assert.doesNotMatch(html,/rest of this hand/);
});
