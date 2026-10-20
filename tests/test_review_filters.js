const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const storage = new Map();
  let nextId = 0;
  const game = { rounds: [
    { round: 'E1', mistakes: [
      { id: 1, turn: 2, ev_loss: 0.2, topic: 'Speed' },
      { id: 2, turn: 2, ev_loss: 4, topic: 'Defense' },
      { id: 3, turn: 6, ev_loss: 3, topic: 'Speed' },
    ] },
    { round: 'E1-1', mistakes: [
      { id: 4, turn: 1, ev_loss: 8, topic: 'Speed' },
      { id: 5, turn: 2, ev_loss: 7, topic: 'Defense' },
    ] },
    { round: 'E2', mistakes: [
      { id: 6, turn: 1, ev_loss: 3, topic: 'Speed' },
      { id: 7, turn: 1, ev_loss: 2, topic: 'Speed' },
    ] },
  ] };
  const context = vm.createContext({
    state: { currentGameData: game, currentGame: 12, gameView: 'top5',
      sevLevel: 3, conceptFilters: [], reviewSort: 'ev', reviewLimit: 5 },
    window: { _meData: { id: 10 } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => `filter-${++nextId}` },
    document: { getElementById: () => null, querySelector: () => null },
    escapeHtml: str => String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    haipaiConceptBreakdown: {
      mistakeTouchesConcept: (m, _, filter) => m.topic === filter.group,
      PILL_META: {},
    },
    haipaiCompareDimensions: {
      compareDimensions: () => ({}),
      GROUP_META: { Speed: { label: 'Efficiency' }, Defense: { label: 'Defense' } },
    },
  });
  for (const file of ['severity.js', 'game-prep.js', 'game-render.js', 'game-review-tabs.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
  }
  context.renderGame = () => context.syncReviewFilter(context.state.reviewTopGroup);
  context.syncReviewFilter(null);
  return { context, game, storage };
}

const plain = value => JSON.parse(JSON.stringify(value));
const ids = (c, game) => plain(c.reviewEntries(game).map(e => e.mistake.id));

test('top five uses EV across rounds, breaks ties chronologically, and preserves annotation identity', () => {
  const { context: c, game } = setup();
  assert.deepEqual(ids(c, game), [4, 5, 2, 3, 6]);
  const secondDecision = c.reviewEntries(game).find(e => e.mistake.id === 2);
  assert.equal(secondDecision.index, 1);
  assert.equal(secondDecision.round, 'E1');
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'round' });
  assert.deepEqual(ids(c, game), [2, 3, 4, 5, 6]);
  assert.equal(c.state.gameView, 'top5');
  assert.equal(c.reviewTabs().length, 3);
  c.switchGameView('rounds');
  c.switchGameView('top5');
  assert.deepEqual(ids(c, game), [2, 3, 4, 5, 6]);
});

test('topics and severity apply before the limit; empty, short, and uncategorized games work', () => {
  const { context: c, game } = setup();
  c.toggleConceptFilter('missed', 'Speed');
  assert.deepEqual(ids(c, game), [4, 3, 6, 7, 1]);
  c.setSevLevel(0);
  assert.deepEqual(ids(c, game), [4, 3, 6, 7]);
  c.toggleConceptFilter('missed', 'Defense');
  assert.deepEqual(ids(c, game), [4, 5, 2, 3, 6]);
  assert.deepEqual(ids(c, { rounds: [] }), []);
  c.state.gameView = 'top-group';
  c.state.conceptFilters = [];
  assert.deepEqual(ids(c, game), []);
  c.showAllReviewItems();
  assert.equal(c.reviewItemCounts(game).shown, 7);
  assert.equal(c.state.reviewLimit, 0);
});

test('leading group includes trade-offs and resolves to the correct topic filter', () => {
  const { context: c } = setup();
  const agg = { groups: { missed: { Speed: { group: 'Speed', ev: 10 } } } };
  const leader = c.conceptTopGroup(agg, [{ key: 'push_fold', title: 'Push vs. Fold', ev: 12 }]);
  assert.equal(leader.meta.label, 'Push vs. Fold');
  assert.deepEqual(plain(c.reviewTopGroupFilter(leader)), { side: 'tradeoff', group: 'push_fold', dim: null });
  assert.equal(c.conceptTopGroup(agg, []).meta.label, 'Efficiency');
  assert.equal(c.conceptTopGroup(null, []), null);
});

test('Defense preset stops at three deal-in mistakes instead of including Attack safe-spare comparisons (game 897)', () => {
  const { context: c } = setup();
  c.haipaiConceptBreakdown = require('../static/js/game-concept-breakdown.js');
  c.haipaiCompareDimensions.compareDimensions = m => m.wins;
  const game = { rounds: [{ round: 'E1', mistakes: [0.89, 0.71, 0.59, 0.11, 0.08].map((ev, i) => ({
    id: i + 1, turn: i + 1, ev_loss: ev, skillArea: i < 3 ? 'defense' : 'attack',
    wins: [{ winner: 'mortal', group: 'Defense', dim: i < 3 ? 'deal_in' : 'safe_spare_kept' }],
  })) }] };
  const aggregate = () => c.haipaiConceptBreakdown.aggregate(game, c.haipaiCompareDimensions.compareDimensions, () => 'mistake');
  const leader = c.reviewTopGroup(game, aggregate(), []);
  assert.ok(Math.abs(leader.ev - 2.19) < 0.00001);
  c.state.gameView = 'top-group';
  c.state.conceptFilters = [c.reviewTopGroupFilter(leader)];
  assert.deepEqual(ids(c, game), [1, 2, 3]);
  // The broader concept filter remains available when deliberately selected.
  c.state.conceptFilters = [{ side: 'missed', group: 'Defense', dim: null }];
  assert.equal(c.reviewEntries(game).length, 5);
  game.rounds[0].mistakes = game.rounds[0].mistakes.slice(3);
  assert.equal(c.reviewTopGroup(game, aggregate(), []), null);
});

test('standards are edited in place and only missing or changed standards appear in the add menu', () => {
  const { context: c } = setup();
  assert.deepEqual(plain(c.missingReviewStandards()), []);
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'round' });
  assert.equal(c.state.gameView, 'top5');
  assert.equal(c.reviewTabs().length, 3);
  assert.deepEqual(plain(c.missingReviewStandards()), ['top5']);
  c.addReviewFilter('top5');
  assert.equal(c.reviewTabs().length, 4);
  assert.equal(c.activeReviewTab().sort, 'ev');
  assert.equal(c.reviewTabs().find(f => f.id === 'top5').sort, 'round');
  assert.deepEqual(plain(c.missingReviewStandards()), []);
  c.addReviewFilter('top5');
  assert.equal(c.reviewTabs().length, 4);
  c.deleteReviewFilter('top-group');
  assert.deepEqual(plain(c.missingReviewStandards()), ['top-group']);
});

test('custom and standard preferences, ordering, and deletion persist without respawning tabs', () => {
  const { context: c, storage, game } = setup();
  c.toggleConceptFilter('missed', 'Speed');
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'round' });
  c.moveReviewTab('rounds', 'top5');
  assert.deepEqual(plain(c.reviewTabs().map(f => f.id)), ['rounds', 'top5', 'top-group']);
  assert.equal(c.state.gameView, 'top5');
  c.state.currentGameData = { rounds: game.rounds.slice(1) };
  c.switchGameView('rounds');
  c.switchGameView('top5');
  assert.deepEqual(ids(c, c.state.currentGameData), [4, 6, 7]);
  c.addReviewFilter('new');
  const added = c.state.gameView;
  assert.equal(c.activeReviewTab().name, 'New filter');
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '10' });
  assert.equal(c.state.gameView, added);
  c.deleteReviewFilter(added);
  assert.equal(c.state.gameView, 'top-group');
  for (const tab of [...c.reviewTabs()]) c.deleteReviewFilter(tab.id);
  assert.equal(c.state.gameView, null);
  assert.deepEqual(plain(c.reviewTabs()), []);
  assert.equal(storage.get(c.reviewStorageKey()), '[]');
  assert.equal(c.missingReviewStandards().length, 3);
  // Re-read the persisted empty collection rather than resetting to defaults.
  c.window._meData.id = 11;
  c.reviewTabs();
  c.window._meData.id = 10;
  assert.deepEqual(plain(c.reviewTabs()), []);
  c.addReviewFilter('rounds');
  assert.equal(c.reviewTabs().length, 1);
  assert.equal(c.activeReviewTab().sort, 'round');
});

test('storage migrates old saved filters, validates records, and remains account-scoped', () => {
  const { context: c, storage } = setup();
  c.window._meData.id = 11;
  storage.set(c.reviewStorageKey(1), JSON.stringify([{ id: 'old-filter', name: 'My defense',
    severity: 1, sort: 'ev', limit: 5, topics: [{ side: 'missed', group: 'Defense', dim: 'deal_in' }] }]));
  assert.equal(c.reviewTabs().length, 4);
  const migrated = c.reviewTabs()[3];
  assert.equal(migrated.name, 'My defense');
  assert.equal(migrated.topics[0].dim, 'deal_in');
  c.window._meData.id = 12;
  storage.set(c.reviewStorageKey(), JSON.stringify([null, { id: 'bad' }, migrated, migrated]));
  assert.equal(c.reviewTabs().length, 1);
  c.window._meData.id = 13;
  storage.set(c.reviewStorageKey(), 'broken json');
  assert.equal(c.reviewTabs().length, 3);
  c.window._meData.id = 10;
  assert.equal(c.reviewTabs().length, 3);
});

test('failed writes retain session changes and display an honest persistence error', () => {
  const { context: c } = setup();
  c.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '20' });
  assert.match(c.state.reviewFilterError, /could not save/);
  assert.equal(c.activeReviewTab().limit, 20);
  assert.match(c.renderReviewTabs(null), /role="alert"/);
});

test('renaming escapes text, retains tab identity, and makes the original standard restorable', () => {
  const { context: c } = setup();
  const input = { value: '<img src=x onerror=alert(1)>', isConnected: true,
    dataset: { renameReviewTab: 'top5' } };
  c.finishReviewRename(input);
  assert.equal(c.state.gameView, 'top5');
  assert.match(c.renderReviewTabs(null), /&lt;img/);
  assert.doesNotMatch(c.renderReviewTabs(null), /<img|data-view="summary"|data-view="overview"/);
  assert.deepEqual(plain(c.missingReviewStandards()), ['top5']);
  input.value = '   ';
  input.dataset.renameReviewTab = 'top5';
  c.finishReviewRename(input);
  assert.equal(c.activeReviewTab().name, '<img src=x onerror=alert(1)>');
  input.value = 'Cancelled';
  input.dataset.renameReviewTab = 'top5';
  c.finishReviewRename(input, true);
  assert.notEqual(c.activeReviewTab().name, 'Cancelled');
});

test('Top group stays dynamic after sort edits; topic edits explicitly replace its group rule', () => {
  const { context: c } = setup();
  c.state.gameView = 'top-group';
  const leader = { side: 'missed', group: 'Defense', meta: { label: 'Defense' } };
  c.syncReviewFilter(leader);
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'round' });
  assert.equal(c.activeReviewTab().topGroup, true);
  assert.equal(c.state.conceptFilters[0].dim, 'deal_in');
  assert.equal(c.reviewTabName(c.activeReviewTab()), 'Top group · Defense');
  c.toggleConceptFilter('missed', 'Speed');
  assert.equal(c.activeReviewTab().topGroup, false);
  assert.equal(c.activeReviewTab().topics.length, 2);
});

test('linked mistakes bypass filters without overwriting the user tabs', () => {
  const { context: c, game } = setup();
  c.setSevLevel(0);
  const before = JSON.stringify(c.reviewTabs());
  c.state.gameView = null;
  c.state.reviewLinkedMistake = true;
  c.syncReviewFilter(null);
  assert.equal(c.state.reviewLimit, 0);
  assert.equal(c.state.reviewSort, 'round');
  assert.equal(c.reviewEntries(game).length, 7);
  assert.equal(JSON.stringify(c.reviewTabs()), before);
  c.switchGameView('top5');
  assert.equal(c.state.reviewLinkedMistake, false);
  assert.equal(c.state.sevLevel, 0);
});
