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
      ${['style-theme', 'style-layout', 'style-game-detail', 'style-board-display', 'style-coins'].map(style).join('')}
      <style>body{overflow:auto}#content{padding:16px;width:100%;overflow:visible}</style>
      </head><body><main id="content"></main>
      ${[...fs.readFileSync('static/index.html','utf8').matchAll(/<script src="\/static\/js\/([^"]+)\.js"/g)].map(m => m[1]).filter(n => !['main','ui'].includes(n)).map(script).join('')}
      <script>
      var state = {};
      const parseTabHash = () => 'coins';
      window.renderGameList = () => {};
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
      let workerCount = 0, terminated = 0, stalled = false;
      window.Worker = class {
        constructor() { workerCount++; }
        postMessage({before}) {
          if (stalled) {
            before = {id:3,ev_loss:13.55};
            this.onmessage({data:{before}});
          }
          setTimeout(() => {
            const c = candidates.find(c => !before || c.id > before.id);
            if (!c) {this.onmessage({data:{done:true}}); return;}
            this.onmessage({data:{before:{id:c.id,ev_loss:c.ev_loss}}});
            this.onmessage({data:{hand:{...c, mistake:{...c,
              actual:{type:'dahai',pai:'1m'}, expected:{type:'dahai',pai:'9m'},
              hand:['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','E','E'],
              shape:'complex', skillArea:'attack', wins:[]}}}});
          }, stalled ? 2100 : 0);
        }
        terminate() {terminated++;}
      };
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
          check(workerCount === 0, 'balance never starts analysis');
          document.querySelector('[data-action="showCoinGain"]').click();
          await new Promise(resolve => setTimeout(resolve, 20));
          check(document.querySelector('#coins-gain-dialog').open, 'separate window');
          check(document.querySelectorAll('.coins-gain-card .mistake').length === 1, 'one complete card');
          check(document.querySelectorAll('.coins-gain-card .complex-gap-row').length === 1, 'inline report funnel');
          document.querySelector('.complex-tag').click();
          await new Promise(resolve => setTimeout(resolve, 20));
          check(document.querySelector('.coins-gain-card .report-status').textContent.includes('+16'), 'inline award');
          check(_findMistakeById(1).my_report.kind === 'complex_gap', 'report stored on modal hand');
          check(terminated === 0, 'worker retained for Next');
          document.querySelector('#coins-gain-next').click();
          await new Promise(resolve => setTimeout(resolve, 20));
          check(document.querySelectorAll('.coins-gain-card').length === 1, 'Next replaces the card');
          check(_findMistakeById(2)?.id === 2 && !_findMistakeById(1), 'Next advances without stale report state');
          closeCoinGain();
          check(!document.querySelector('#coins-gain-dialog'), 'close removes window');
          stalled = true;
          showCoinGain();
          await new Promise(resolve => setTimeout(resolve, 1850));
          check(document.querySelector('#coins-gain-status').textContent.includes('Finding'), 'slow search keeps running');
          check(document.querySelector('#coins-gain-next').disabled, 'Next waits for current search');
          check(terminated === 1, 'slow search does not terminate the worker');
          stalled = false;
          await new Promise(resolve => setTimeout(resolve, 300));
          check(_findMistakeById(4)?.id === 4, 'result after two seconds appears automatically');
          document.querySelector('#coins-gain-next').click();
          await new Promise(resolve => setTimeout(resolve, 20));
          document.querySelector('#coins-gain-next').click();
          await new Promise(resolve => setTimeout(resolve, 20));
          check(document.querySelector('#coins-gain-next').disabled, 'end of search disables Next');
          closeCoinGain();
          stalled = false;
          showCoinGain();
          await new Promise(resolve => setTimeout(resolve, 20));
          for (const img of document.querySelectorAll('img')) {
            const src = img.getAttribute('src');
            if (src.startsWith('/tiles/')) img.src = 'file://${path.resolve('riichi-mahjong-tiles/Regular')}/' + src.slice(7);
            if (src === '/static/mascot.svg') img.src = 'file://${path.resolve('static/mascot.svg')}';
          }
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
