const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('hand selection updates only its own comparison and restores the original decision',
  { skip: chromium.status !== 0 }, () => {
    const root = path.resolve(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-hand-comparison-'));
    const index = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
    const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)].map(m => m[1]);
    scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
    const fixture = require('./fixtures/dora_acceptance_m35078.json');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      ${['theme', 'game-detail', 'board-display'].map(n => `<link rel="stylesheet" href="file://${root}/static/style-${n}.css">`).join('')}
      <style>body{padding:16px}main{max-width:920px;margin:auto}</style></head><body><main></main>
      ${scripts.map(src => `<script src="file://${root}${src}"></script>`).join('')}
      <script>
      window.state = {readOnly:false};
      const m = ${JSON.stringify(fixture)};
      m.top_actions = [{action:m.expected,q_value:2}, {action:m.actual,q_value:1.5},
        {action:{type:'dahai',pai:'8p'},q_value:1}];
      m.ev_loss = 0.5;
      const original = JSON.stringify(m);
      const check = (ok, msg) => {if (!ok) throw Error(msg)};
      window.addEventListener('load', () => {try {
        document.querySelector('main').innerHTML = renderMistakeCard(m) + renderMistakeCard(m);
        const [card, other] = document.querySelectorAll('.mistake');
        const otherHtml = other.innerHTML;
        const initial = card.querySelector('.ev-comparison').innerHTML;
        check(card.querySelectorAll('.hand-choice-button').length === m.hand.length, 'all hand tiles selectable');
        check(card.querySelector('.hand-choice-you').textContent === 'YOU-0.50', 'you EV');
        check(!card.querySelector('.hand-choice-rank-2'), 'no duplicate second tab');
        const pick = tile => card.querySelector('[data-choice-tile="' + tile + '"]').click();
        pick('8p');
        check(card.querySelector('.col-actual .ev-tile').alt === '8p', 'selected discard replaces You');
        check(card.querySelector('.col-actual .marker').textContent === 'Selected', 'honest selected label');
        check(card.querySelector('.col-expected .ev-tile').alt === '7p', 'AI unchanged');
        check(card.querySelector('[data-choice-tile="8p"]').getAttribute('aria-pressed') === 'true', 'selection exposed');
        const expected = document.createElement('div');
        expected.innerHTML = renderEvComparison(m, {selectedTile:'8p'});
        check(card.querySelector('.ev-comparison').innerHTML === expected.firstChild.innerHTML, 'full comparison recalculated');
        pick('7p');
        check(card.querySelectorAll('.ev-col-head').length === 2, 'selecting AI preserves two comparison columns');
        pick('5p');
        check(card.querySelector('.ev-comparison').innerHTML === initial, 'original restored');
        check(other.innerHTML === otherHtml, 'other card unchanged');
        check(JSON.stringify(m) === original, 'stored decision unchanged');
        document.body.innerHTML = document.body.innerHTML.replaceAll('src="/tiles/', 'src="file://${root}/riichi-mahjong-tiles/Regular/');
        document.body.dataset.result = 'passed';
      } catch (e) {document.body.dataset.result=e.stack}});
      </script></body></html>`;
    try {
      fs.writeFileSync(path.join(dir, 'test.html'), html);
      for (const width of [1100, 390]) {
        const result = spawnSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu',
          '--allow-file-access-from-files', '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`,
          `--window-size=${width},1400`, '--virtual-time-budget=3000', '--dump-dom', `file://${dir}/test.html`],
        { encoding: 'utf8', timeout:30000, maxBuffer:4*1024*1024 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body data-result="passed">/, result.stdout.match(/<body[^>]*>/)?.[0]);
      }
      if (process.env.HAIPAI_HAND_PREVIEW) fs.writeFileSync(process.env.HAIPAI_HAND_PREVIEW, html);
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  });
