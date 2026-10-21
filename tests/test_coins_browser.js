const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('coins card and immediate report/Maka rewards work on desktop and mobile',
  {skip: spawnSync('chromium', ['--version']).status !== 0}, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-coin-browser-'));
    const script = name => `<script src="file://${path.resolve('static/js', name + '.js')}"></script>`;
    const style = name => `<link rel="stylesheet" href="file://${path.resolve('static', name + '.css')}">`;
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${['style-theme', 'style-layout', 'style-coins'].map(style).join('')}
      <style>body{overflow:auto}#content{padding:16px;width:100%;overflow:visible}</style>
      </head><body><main id="content"></main>
      ${['html-escape', 'coins', 'mistake-card', 'game-maka'].map(script).join('')}
      <script>
      const state = {};
      const parseTabHash = () => 'coins';
      const renderGameList = () => {};
      const check = (value, message) => {if (!value) throw new Error(message);};
      const data = {balance: 476, entries: [], next_before: null, totals: {maka_grade: 10}, maka_rate: 5};
      const candidates = Array.from({length:5}, (_, i) => ({id:i+1, game_id:1, round_name:'East 1',
        turn:i+4, ev_loss: 15.55-i, coins:156-i*10}));
      window.fetch = async url => ({ok:true, json:async () => {
        if (url.endsWith('/gain')) return {candidates};
        if (url.includes('/mortal')) return {};
        if (url.includes('/games/')) return {rounds:[{mistakes:candidates.map(c => ({id:c.id, shape:'complex'}))}]};
        return data;
      }});
      const haipaiPrep = {prepGameAsync: async () => {}};
      const recategorizeGameInPlace = () => {};
      window.apiPost = async url => ({ok:true, headers: new Headers({'X-Coins-Earned':'10','X-Coins-Balance':'476'}),
        json:async () => url.endsWith('/report') ? {coins_earned:16,balance:466} : {overall:'A', matches:['B']}});
      document.addEventListener('DOMContentLoaded', async () => {
        try {
          document.getElementById('content').innerHTML = '<div class="report-row" data-mid="1"><span class="report-status"></span></div>';
          check(await saveReport(1, 'wrong_text', null, null), 'report saved');
          check(document.querySelector('.report-status').textContent.includes('+16'), 'immediate report reward');
          check(document.querySelector('.report-status .coin-mark'), 'report reward coin icon');
          check(document.querySelector('.report-status [aria-label="16 community coins"]'), 'accessible report reward');
          const game = {id:1, rounds:[{round:'East 1'}], maka_ratings:{overall:'A',matches:['B']}};
          state.currentGameData = game;
          document.getElementById('content').innerHTML = renderMakaRatings(game);
          bindMakaRatings(game);
          document.querySelector('.maka-form').dispatchEvent(new Event('submit', {cancelable:true}));
          await new Promise(resolve => setTimeout(resolve, 20));
          check(document.querySelector('.maka-status').textContent.includes('+10 coins'), 'immediate Maka reward');
          await showCoins();
          await new Promise(resolve => setTimeout(resolve, 20));
          check(document.querySelectorAll('.coins-gain-hands li').length === 5, 'five opportunities');
          check(document.querySelector('.coins-gain-hands a').getAttribute('href') === '#m1', 'hand link');
          check(document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow');
          document.body.dataset.result = 'passed';
        } catch(error) {document.body.dataset.result = error.stack;}
      });
      </script></body></html>`;
    try {
      const file = path.join(dir, 'test.html');
      fs.writeFileSync(file, html);
      for (const width of [1280, 390]) {
        const args = ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
          '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`, '--virtual-time-budget=3000',
          `--window-size=${width},1000`, '--dump-dom'];
        if (process.env.HAIPAI_COINS_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.HAIPAI_COINS_SCREENSHOT_DIR, {recursive:true});
          args.push('--screenshot=' + path.join(process.env.HAIPAI_COINS_SCREENSHOT_DIR, `coins-${width}.png`));
        }
        const result = spawnSync('chromium', [...args, 'file://' + file],
          {encoding:'utf8', timeout:30000, maxBuffer:2*1024*1024});
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body data-result="passed">/, result.stdout);
      }
    } finally {fs.rmSync(dir, {recursive:true, force:true});}
  });
