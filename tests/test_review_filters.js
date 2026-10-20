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
  for (const file of ['severity.js', 'game-prep.js', 'game-render.js', 'game-review-tabs.js', 'game-overview.js']) {
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
  c.addReviewFilter('new');
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '5' });
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'ev' });
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
  c.switchGameView('filter-1');
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

test('standards stay first, fixed and protected; count and sort reset independently per tab', () => {
  const { context: c } = setup();
  for (const id of ['top5', 'top-group', 'rounds']) {
    c.switchGameView(id);
    const original = JSON.stringify(c.activeReviewTab());
    c.deleteReviewFilter(id);
    c.moveReviewTab(id, 'top5');
    c.saveActiveReviewFilter({ name: 'Renamed', severity: 0, topics: [{ side: 'missed', group: 'Speed' }], topGroup: false });
    c.toggleConceptFilter('missed', 'Speed');
    c.setSevLevel(0);
    c.showAllReviewItems();
    assert.equal(JSON.stringify(c.activeReviewTab()), original);
    c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'ev' });
    c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '20' });
    assert.equal(c.activeReviewTab().limit, 20);
    c.resetStandardReviewFilter();
    assert.equal(JSON.stringify(c.activeReviewTab()), original);
  }
  assert.deepEqual(plain(c.reviewTabs().map(f => f.id)), ['top5', 'top-group', 'rounds']);
  assert.doesNotMatch(c.renderReviewTabs(), /review-tab-close|review-tab-handle|Restore standard/);
  c.switchGameView('top5');
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '10' });
  assert.equal(c.reviewTabName(c.activeReviewTab()), 'Top 10 mistakes');
});

test('custom filters retain editing, deletion and ordering after the standards', () => {
  const { context: c, storage } = setup();
  c.addReviewFilter('new');
  c.toggleConceptFilter('missed', 'Speed');
  c.setSevLevel(0);
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '10' });
  c.addReviewFilter('new');
  c.moveReviewTab('filter-2', 'filter-1');
  c.moveReviewTab('filter-2', 'top5');
  assert.deepEqual(plain(c.reviewTabs().map(f => f.id)), ['top5', 'top-group', 'rounds', 'filter-2', 'filter-1']);
  c.deleteReviewFilter('filter-2');
  assert.equal(c.state.gameView, 'filter-1');
  assert.equal(c.activeReviewTab().severity, 0);
  assert.equal(c.activeReviewTab().limit, 10);
  assert.equal(c.activeReviewTab().topics[0].group, 'Speed');
  c.window._meData.id = 11;
  c.reviewTabs();
  c.window._meData.id = 10;
  assert.equal(c.reviewTabs().length, 4);
  assert.equal(JSON.parse(storage.get(c.reviewStorageKey())).length, 4);
});

test('v2 restoration repairs standard rules, names and order, and preserves custom filters', () => {
  const { context: c, storage } = setup();
  const custom = { ...plain(c.standardReviewFilter('top5')), id: 'custom', name: 'Mine', severity: 1 };
  c.window._meData.id = 11;
  storage.set(c.reviewStorageKey(), JSON.stringify([
    custom, { ...plain(c.standardReviewFilter('rounds')), limit: 10, sort: 'ev' },
    { ...plain(c.standardReviewFilter('top-group')), name: 'Top group', severity: 0, topGroup: false, limit: 20 },
  ]));
  assert.deepEqual(plain(c.reviewTabs().map(f => f.id)), ['top5', 'top-group', 'rounds', 'custom']);
  assert.equal(c.reviewTabs()[1].name, 'Top category');
  assert.equal(c.reviewTabs()[1].topGroup, true);
  assert.equal(c.reviewTabs()[1].severity, 3);
  assert.equal(c.reviewTabs()[1].limit, 20);
  assert.equal(c.reviewTabs()[2].limit, 10);
  assert.deepEqual(plain(c.reviewTabs()[3]), custom);
  c.window._meData.id = 12;
  storage.set(c.reviewStorageKey(), '[]');
  assert.deepEqual(plain(c.reviewTabs().map(f => f.id)), ['top5', 'top-group', 'rounds']);
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
  assert.equal(c.reviewTabs().length, 4);
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

test('custom renaming escapes text and retains tab identity', () => {
  const { context: c } = setup();
  c.addReviewFilter('new');
  const input = { value: '<img src=x onerror=alert(1)>', isConnected: true,
    dataset: { renameReviewTab: 'filter-1' } };
  c.finishReviewRename(input);
  assert.equal(c.state.gameView, 'filter-1');
  assert.match(c.renderReviewTabs(null), /&lt;img/);
  assert.doesNotMatch(c.renderReviewTabs(null), /<img|data-view="summary"|data-view="overview"/);
  input.value = '   ';
  input.dataset.renameReviewTab = 'filter-1';
  c.finishReviewRename(input);
  assert.equal(c.activeReviewTab().name, '<img src=x onerror=alert(1)>');
  input.value = 'Cancelled';
  input.dataset.renameReviewTab = 'filter-1';
  c.finishReviewRename(input, true);
  assert.notEqual(c.activeReviewTab().name, 'Cancelled');
});

test('Top category retains its dynamic membership after option edits and rejects topic edits', () => {
  const { context: c } = setup();
  c.state.gameView = 'top-group';
  const leader = { side: 'missed', group: 'Defense', meta: { label: 'Defense' } };
  c.syncReviewFilter(leader);
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'round' });
  c.toggleConceptFilter('missed', 'Speed');
  assert.equal(c.activeReviewTab().topGroup, true);
  assert.equal(c.state.conceptFilters[0].dim, 'deal_in');
  assert.equal(c.reviewTabName(c.activeReviewTab()), 'Top category');
  assert.equal(c.activeReviewTab().topics.length, 0);
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
  assert.equal(c.state.sevLevel, 3);
});

test('overview ranks the top mistake across the whole game and handles short/empty games', () => {
  const { context: c, game } = setup();
  c.state.reviewLimit = 20;
  c.state.sevLevel = 0;
  c.state.conceptFilters = [{ side: 'missed', group: 'missing' }];
  const overview = c.gameOverviewData(game);
  assert.deepEqual(plain(overview.top.map(e => e.mistake.id)), [4]);
  assert.equal(overview.worst.round, 'E1-1');
  assert.equal(overview.worst.ev, 15);
  assert.equal(c.gameOverviewData({ rounds: [game.rounds[0]] }).top.length, 1);
  assert.deepEqual(plain(c.gameOverviewData({ rounds: [] }).top), []);
  assert.equal(c.gameOverviewData({ rounds: [{ round: 'E1', mistakes: [] }] }).worst, undefined);
});

test('opening preferences are user scoped, survive reload and default deletion falls back to Top mistakes', () => {
  const { context: c, storage } = setup();
  assert.deepEqual(plain(c.reviewOpeningPreferences()), { skipOverview: false, defaultFilter: 'top5' });
  c.addReviewFilter('new');
  c.saveReviewOpeningPreferences({ skipOverview: true, defaultFilter: 'filter-1' });
  c.beginGameReview();
  assert.equal(c.state.overviewOpen, false);
  assert.equal(c.state.gameView, 'filter-1');
  c.window._meData.id = 11;
  assert.equal(c.reviewOpeningPreferences().skipOverview, false);
  c.window._meData.id = 10;
  vm.runInContext('reviewOpeningCache.clear()', c);
  assert.equal(c.reviewOpeningPreferences().defaultFilter, 'filter-1');
  c.deleteReviewFilter('filter-1');
  assert.equal(c.reviewOpeningPreferences().defaultFilter, 'top5');
  assert.equal(JSON.parse(storage.get(`${c.reviewStorageKey()}:opening`)).defaultFilter, 'top5');
  c.saveReviewOpeningPreferences({ skipOverview: false });
  c.beginGameReview();
  assert.equal(c.state.overviewOpen, true);
  c.closeGameOverview();
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '10' });
  assert.equal(c.state.overviewOpen, false);
  c.beginGameReview(true);
  assert.equal(c.state.overviewOpen, false);
  assert.equal(c.state.reviewLinkedMistake, true);
});

test('worst round navigation overrides display only and reset or selecting Rounds restores saved settings', () => {
  const { context: c } = setup();
  c.switchGameView('rounds');
  c.changeReviewOption({ dataset: { reviewOption: 'sort' }, value: 'ev' });
  c.changeReviewOption({ dataset: { reviewOption: 'limit' }, value: '5' });
  const saved = JSON.stringify(c.reviewTabs());
  c.overviewNavigate({ dataset: { view: 'rounds', roundIndex: '2' } });
  assert.equal(c.state.overviewOpen, false);
  assert.equal(c.state.gameView, 'rounds');
  assert.equal(c.reviewRoundLayout(), true);
  assert.equal(JSON.stringify(c.reviewTabs()), saved);
  c.syncReviewFilter(null);
  assert.equal(c.reviewRoundLayout(), true);
  c.switchGameView('rounds');
  assert.equal(c.state.reviewLimit, 5);
  assert.equal(c.state.reviewSort, 'ev');
  c.overviewNavigate({ dataset: { view: 'rounds', roundIndex: '2' } });
  c.resetStandardReviewFilter();
  assert.equal(c.state.reviewNavigation, null);
  assert.equal(c.state.reviewLimit, 0);
  assert.equal(c.state.reviewSort, 'round');
});
