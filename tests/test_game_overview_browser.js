const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('overview entry, refresh, shortcuts, preferences, standard controls and keyboard behavior in Chromium',
  { skip: chromium.status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-overview-'));
    const script = name => `<script src="file://${path.resolve(__dirname, '../static/js', name)}"></script>`;
    const game = {
      id: 1, date: '2026-10-20', summary: { total_decisions: 100, total_ev_loss: 14 },
      rounds: [
        { round: 'E1', decision_count: 20, mistakes: [
          { id: 1, turn: 1, ev_loss: 1, topic: 'Speed' }, { id: 2, turn: 2, ev_loss: 2, topic: 'Speed' },
        ] },
        { round: 'E2', decision_count: 30, mistakes: [
          { id: 3, turn: 3, ev_loss: 6, topic: 'Speed' }, { id: 4, turn: 3, ev_loss: 2, topic: 'Speed' },
          { id: 5, turn: 6, ev_loss: 2, topic: 'Speed' }, { id: 6, turn: 7, ev_loss: 1, topic: 'Speed' },
        ] },
      ],
    };
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="file://${path.resolve(__dirname, '../static/style-theme.css')}">
      <link rel="stylesheet" href="file://${path.resolve(__dirname, '../static/style-game-detail.css')}">
      <style>body {overflow:hidden} #content {height: 500px; overflow: auto} .mistake {height: 300px}</style>
      </head><body><main id="content"></main>
      ${['html-escape.js', 'actions.js', 'severity.js', 'game-prep.js', 'game-review-tabs.js',
        'game-render.js', 'game-overview.js', 'game-fetch.js'].map(script).join('')}
      <script>
      const fixture = ${JSON.stringify(game)};
      window.state = {readOnly:true, games:[], currentGame:null, conceptFilters:[], sevLevel:3};
      window._meData = {id: 42};
      const formatRoundLabel = value => value;
      const mistakeBadge = () => ({label:'Attack / Efficiency',color:'#4fc3f7'});
      const renderMistakeCard = (m, opts) => '<article class="mistake" data-mid="' + m.id
        + '" data-round="' + opts.round + '" data-turn="' + m.turn + '" data-index="' + opts.index + '">Mistake ' + m.id + '</article>';
      const parseMistakeHash = () => null;
      const OUTCOME_EMOJI = {};
      const haipaiCompareDimensions = { compareDimensions: () => ({}), GROUP_META: {Speed:{label:'Efficiency', color:'#4fc3f7'}} };
      const haipaiConceptBreakdown = {
        aggregate: () => ({groups:{missed:{Speed:{group:'Speed',ev:14}}}}), tradeoffBoxes: () => [],
        mistakeTouchesConcept: (m, compare, f) => m.topic === f.group,
      };
      recategorizeGameInPlace = () => {};
      recomputeSummaryByCategory = game => game.summary;
      // Simulate both the initial render and a later prep/data refresh.
      refreshPrepAndRecategorize = async () => { renderGame(); };
      window.fetch = async url => ({ok: !url.endsWith('/mortal'), json: async () => structuredClone(fixture)});
      let opened = 0;
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function() { opened++; showModal.call(this); };
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const click = selector => { const el = document.querySelector(selector); check(el, 'Missing ' + selector); el.click(); };
      const change = (selector, value) => {
        const el = document.querySelector(selector);
        el.value = value;
        el.dispatchEvent(new Event('change', {bubbles:true}));
      };
      window.addEventListener('load', async () => {
        try {
          localStorage.clear();
          await fetchGame(1);
          check(opened === 1, 'opens once through prep refresh');
          check(document.querySelectorAll('.overview-mistake').length === 1, 'only the top mistake');
          check(document.querySelector('.overview-mistake').textContent.includes('6.00 EV'), 'highest EV across game');
          check(getComputedStyle(document.querySelector('.overview-category-name')).color === 'rgb(79, 195, 247)',
            'top category retains its category color');
          check(getComputedStyle(document.querySelector('.overview-mistake .cat-badge')).color === 'rgb(79, 195, 247)',
            'top mistake retains its mistake badge color');
          check([...document.querySelectorAll('.overview-highlights > button')].map(el => el.dataset.view).join(',')
            === 'top5,top-group,rounds', 'consistent shortcuts start with the top mistake');
          check(document.querySelector('.overview-round-grade').textContent.includes(gameRating({total_decisions:30,total_ev_loss:11}).letter), 'worst round grade');
          const dialog = document.querySelector('dialog');
          check(dialog.querySelector('.trainer-tip').compareDocumentPosition(dialog.querySelector('.overview-highlights'))
            & Node.DOCUMENT_POSITION_FOLLOWING, 'trainer above category');
          const rect = dialog.getBoundingClientRect();
          check(Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < 2, 'centered horizontally');
          check(Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2) < 2, 'centered vertically');
          click('[data-action="closeGameOverview"]');
          check(state.gameView === 'top5', 'dismiss retains default filter');
          check(document.activeElement.dataset.action === 'openGameOverview', 'close restores focus');
          await fetchGame(1);
          check(opened === 1 && !document.querySelector('dialog'), 'same-game refresh stays closed');
          changeReviewOption({dataset:{reviewOption:'limit'}, value:'20'});
          check(!document.querySelector('dialog'), 'filter edit stays closed');
          click('[data-action="openGameOverview"]');
          check(document.querySelectorAll('.overview-mistake').length === 1, 'saved count cannot expand overview');
          click('.overview-category');
          check(state.gameView === 'top-group' && !document.querySelector('dialog'), 'category shortcut');
          switchGameView('rounds');
          changeReviewOption({dataset:{reviewOption:'limit'}, value:'5'});
          changeReviewOption({dataset:{reviewOption:'sort'}, value:'ev'});
          const savedRounds = JSON.stringify(activeReviewTab());
          click('[data-action="openGameOverview"]');
          click('[data-action="overviewNavigate"][data-view="rounds"]');
          check(document.getElementById('game-round-1') && reviewRoundLayout(), 'round destination rendered');
          check(JSON.stringify(activeReviewTab()) === savedRounds, 'round shortcut preserves saved settings');
          click('[data-action="selectReviewTab"][data-view="rounds"]');
          check(state.reviewSort === 'ev' && state.reviewLimit === 5, 'tab restores saved rounds');
          click('[data-action="resetStandardReviewFilter"]');
          check(state.reviewSort === 'round' && state.reviewLimit === 0, 'reset rounds');
          click('[data-action="openGameOverview"]');
          click('.overview-mistake');
          check(state.gameView === 'top5' && document.querySelector('.mistake[data-mid="3"]'), 'mistake destination');
          check(!document.querySelector('dialog'), 'mistake shortcut closes dialog');
          click('[data-action="resetStandardReviewFilter"]');
          check(state.reviewLimit === 5 && state.reviewSort === 'ev', 'reset top mistakes');
          check(!document.querySelector('[data-review-tab="top5"] .review-tab-close'), 'standard not deletable');
          beginReviewRename('top5');
          check(!document.querySelector('[data-rename-review-tab]'), 'standard not renamable');
          click('[data-action="addReviewFilter"]');
          const customId = state.gameView;
          const input = document.querySelector('[data-rename-review-tab]');
          input.value = 'My study';
          input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
          click('[data-action="openGameOverview"]');
          check(document.querySelector('.overview-shortcuts').textContent.includes('My study'), 'saved custom name');
          change('[data-preference="default"]', customId);
          click('[data-preference="skip"]');
          document.querySelector('dialog').dispatchEvent(new Event('cancel', {cancelable:true}));
          check(!document.querySelector('dialog'), 'native Escape cancel closes');
          state.currentGame = null;
          await fetchGame(2);
          check(!document.querySelector('dialog') && state.gameView === customId, 'next entry uses saved preferences');
          click('[data-action="openGameOverview"]');
          click('[data-action="overviewNavigate"][data-view="' + customId + '"]');
          check(state.gameView === customId && !document.querySelector('dialog'), 'custom shortcut');
          deleteReviewFilter(customId);
          check(reviewOpeningPreferences().defaultFilter === 'top5', 'deleted default falls back');
          reviewOpeningCache.clear();
          check(reviewOpeningPreferences().skipOverview === true && reviewOpeningPreferences().defaultFilter === 'top5', 'persisted opening preferences');
          saveReviewOpeningPreferences({skipOverview:false});
          state.currentGame = null;
          state.scrollToMistakeId = 4;
          await fetchGame(3);
          check(!document.querySelector('dialog') && state.reviewLinkedMistake, 'deep link bypass');
          check(document.querySelector('.mistake[data-mid="4"]'), 'linked target rendered');
          state.scrollToMistakeId = null;
          state.currentGame = null;
          await fetchGame(4);
          check(document.querySelector('dialog[open]'), 'later ordinary opening shows overview');
          check(!document.querySelector('.overview-shortcuts'), 'deleted custom shortcut hidden');
          document.body.dataset.result = 'passed';
        } catch (error) { document.body.dataset.result = error.stack; }
      });
      </script></body></html>`;
    try {
      fs.writeFileSync(path.join(dir, 'test.html'), html);
      const result = spawnSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu',
        '--allow-file-access-from-files', '--no-proxy-server', `--user-data-dir=${dir}/profile`,
        '--virtual-time-budget=3000', '--dump-dom', `file://${dir}/test.html`],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /<body data-result="passed">/, result.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
