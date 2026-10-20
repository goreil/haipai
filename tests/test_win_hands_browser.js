const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepReport } = require('../static/js/prep/prep.js');

const chromium = spawnSync('chromium', ['--version'], {encoding:'utf8'});
test('Ron card shows the offered tile and the original pass without a later discard',
  {skip:chromium.status !== 0}, () => {
    const root = path.resolve(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-win-hands-'));
    const data = require('./fixtures/win_m323.json');
    const e = data.review.kyokus[0].entries[0];
    const m = {id:323, hand:e.state.tehai, melds:e.state.fuuros, actual:e.actual,
      expected:e.expected, draw:e.tile, turn:e.junme, ev_loss:2.42, top_actions:e.details};
    prepReport(m, data, 0, 0);
    const index = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
    const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)].map(m => m[1]);
    scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      ${['theme','game-detail','board-display'].map(n => `<link rel="stylesheet" href="file://${root}/static/style-${n}.css">`).join('')}
      <style>body{padding:16px}main{max-width:920px;margin:auto}</style></head><body><main></main>
      ${scripts.map(src => `<script src="file://${root}${src}"></script>`).join('')}
      <script>
      window.state = {readOnly:true};
      const m = ${JSON.stringify(m)};
      const original = JSON.stringify(m);
      Object.assign(m,haipaiCategorize.categorize(m));
      const check = (ok,msg) => {if (!ok) throw Error(msg)};
      window.addEventListener('load', () => {try {
        document.querySelector('main').innerHTML = renderMistakeCard(m);
        const atWin = document.querySelector('.win-opportunity-hand');
        check(atWin.querySelector('.tiles').querySelectorAll('img').length === 13, '13 concealed tiles at ron opportunity');
        check(atWin.querySelector('.win-incoming img').alt === '8m', '8m shown separately as opponent discard');
        check(atWin.querySelector('.win-incoming').textContent.includes('Opponent discard'), 'incoming tile source explicit');
        check(!atWin.querySelector('.tiles [alt="4p"]'), 'future 4p not added to earlier hand');
        check(!document.querySelector('.win-continuation-hand'), 'later hand not mixed into original decision');
        check(!document.querySelector('[alt="4p"]'), 'later 4p discard absent from card');
        check(document.querySelector('.col-actual .action-pass').textContent === 'PASS', 'You passed at this decision');
        check(!document.querySelector('.col-actual .ev-tile'), 'pass has no discard tile');
        check(document.querySelector('.col-expected .action-win').textContent === 'Ron', 'AI action says Ron');
        check(document.querySelector('.col-expected .ev-tile').alt === '8m', 'ron matches opponent discard');
        const value = document.querySelector('.score-col .col-actual');
        check(value.querySelectorAll('.furiten-badge').length > 0, 'passed ron has existing furiten badge');
        check(value.querySelectorAll('.rsc-count-furiten').length === 3, 'regular/red 5m and 8m waits are all furiten');
        check([...value.querySelectorAll('.rsc-line')].filter(e => e.textContent.includes('Ron'))
          .every(e => e.textContent.includes('Furiten') && !e.querySelector('.rsc-pts')), 'no ron points after passing');
        check(value.textContent.includes('Tsumo'), 'tsumo value retained');
        check(document.querySelector('.score-col .col-expected').textContent.includes('2,600'), 'offered ron remains available');
        check(!document.querySelector('.dealin-col'), 'no irrelevant deal-in row');
        check(document.documentElement.scrollWidth <= innerWidth, 'no page overflow');
        check(JSON.parse(original).hand.length === m.hand.length && m.actual.type === 'none', 'stored decision preserved');
        document.body.innerHTML = document.body.innerHTML.replaceAll('src="/tiles/', 'src="file://${root}/riichi-mahjong-tiles/Regular/');
        document.body.dataset.result = 'passed';
      } catch(e) {document.body.dataset.result=e.stack}});
      </script></body></html>`;
    try {
      const file = path.join(dir,'test.html');
      fs.writeFileSync(file,html);
      for (const width of [1100,390]) {
        const args = ['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files',
          '--no-proxy-server',`--user-data-dir=${dir}/profile-${width}`,`--window-size=${width},1400`,
          '--virtual-time-budget=2000','--dump-dom'];
        if (process.env.HAIPAI_WIN_HAND_PREVIEW) args.push(`--screenshot=${process.env.HAIPAI_WIN_HAND_PREVIEW}-${width}.png`);
        const result = spawnSync('chromium',[...args,`file://${file}`],
          {encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
        assert.equal(result.status,0,result.stderr);
        assert.match(result.stdout,/<body data-result="passed">/,result.stdout.match(/<body[^>]*>/)?.[0]);
      }
    } finally {fs.rmSync(dir,{recursive:true,force:true})}
  });
