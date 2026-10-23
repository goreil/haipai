const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('full hand toggles and cycles in place while preserving tile interactions on desktop and mobile',
  { skip: chromium.status !== 0 }, () => {
    const root = path.resolve(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-hand-comparison-'));
    const index = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
    const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)].map(m => m[1]);
    scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
    const fixture = require('./fixtures/dora_acceptance_m35078.json');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      ${['theme', 'game-detail', 'board-display', 'hand-blocks'].map(n => `<link rel="stylesheet" href="file://${root}/static/style-${n}.css">`).join('')}
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
      tileSrc = t => 'file://${root}/riichi-mahjong-tiles/Regular/' + (TILE_FILE[t] || 'Back') + '.svg';
      window.addEventListener('load', async () => {try {
        const wait = () => new Promise(r => setTimeout(r, 30));
        document.querySelector('main').innerHTML = renderMistakeCard(m) + renderMistakeCard(m);
        const [card, other] = document.querySelectorAll('.mistake');
        const row = card.querySelector('.hand-row');
        const body = row.querySelector('.block-view-body');
        const toggle = row.querySelector('.block-view-toggle');
        const next = row.querySelector('.block-view-next');
        const prev = row.querySelector('.block-view-prev');
        const normal = row.querySelector('.hand-normal-tiles');
        const normalHtml = normal.innerHTML;
        const originalSize = normal.querySelector('img').getBoundingClientRect().height;
        const inactiveColor = getComputedStyle(toggle).color;
        check(toggle.textContent === 'Blocks', 'stable label before activation');
        check(![...row.children].some(el => el.classList.contains('label') && el.textContent === 'Hand'), 'no visible Hand label');
        check(haipaiBlockViewPrep.cacheInfo().misses === 0, 'initial rendering does no partition work');
        check(body.hidden && !normal.hidden && next.hidden, 'normal hand initially');
        check(!card.querySelector('.hand-block-view'), 'no detached panel');
        toggle.click();await wait();
        check(!body.hidden && normal.hidden && !next.hidden, 'grouping replaces hand');
        check(toggle.textContent === 'Blocks', 'stable label after activation');
        check(getComputedStyle(toggle).color !== inactiveColor, 'active state changes color');
        check(prev.getBoundingClientRect().top >= toggle.getBoundingClientRect().bottom, 'arrows below Blocks');
        check(body.querySelectorAll('.hand-block-tiles img').length === 14, 'whole 14-tile hand');
        check(body.querySelectorAll('.hand-choice-you').length === 1, 'You badge preserved once');
        check(body.querySelectorAll('.hand-choice-ai').length === 1, 'AI badge preserved once');
        check(body.querySelectorAll('.hand-choice-button').length === 14, 'all grouped tiles selectable');
        check(!body.querySelector('.hand-block-label, .block-view-summary'), 'no descriptive text');
        check(/^[0-9]+ blocks$/.test(row.querySelector('.block-view-counter').textContent), 'only category displayed');
        check(prev.textContent === '<-' && next.textContent === '->', 'arrow-only controls');
        const tiles = [...body.querySelectorAll('.hand-block-tiles img')];
        check(tiles.every(t => Math.abs(t.getBoundingClientRect().top - tiles[0].getBoundingClientRect().top) < 1), 'tiles in one row');
        check(Math.abs(tiles[0].getBoundingClientRect().height - originalSize) < 1, 'original tile size preserved');
        if (innerWidth > 600) {
          const a=row.querySelector('.block-view-controls').getBoundingClientRect(), b=body.getBoundingClientRect();
          check(Math.abs((a.top+a.bottom)/2 - (b.top+b.bottom)/2) < 1, 'desktop controls and tiles share one row');
        }
        const misses = haipaiBlockViewPrep.cacheInfo().misses;
        const firstHtml = body.innerHTML;
        prev.focus();prev.click();
        check(document.activeElement === prev, 'back keeps focus');
        check(row.querySelector('.block-view-counter').textContent === '13 orphans', 'back wraps to last category');
        next.click();
        check(body.innerHTML === firstHtml, 'forward returns from last to first');
        next.focus();next.click();
        check(body.innerHTML !== firstHtml, 'cycles interpretation');
        check(document.activeElement === next, 'cycle preserves keyboard focus');
        const count = Number(row.querySelector('.block-view-counter').title.match(/of ([0-9]+)/)[1]);
        for (let i=1;i<count;i++) {
          next.click();
          check(document.documentElement.scrollWidth <= innerWidth, 'each interpretation stays within page width');
        }
        check(body.innerHTML === firstHtml, 'cycle wraps to default');
        check(haipaiBlockViewPrep.cacheInfo().misses === misses, 'cycling does no search');
        const pick = tile => body.querySelector('[data-choice-tile="' + tile + '"]').click();
        pick('8p');
        check(card.querySelector('.col-actual .ev-tile').alt === '8p', 'grouped tile updates comparison');
        check(body.querySelectorAll('.hand-block-tiles img').length === 14, 'selected discard remains in hand');
        check(body.innerHTML.includes('aria-pressed="true"'), 'selection exposed');
        next.click();
        check(body.querySelector('[data-choice-tile="8p"]').getAttribute('aria-pressed') === 'true', 'selection survives cycle');
        toggle.click();
        check(body.hidden && !normal.hidden && next.hidden, 'toggle restores normal hand');
        check(toggle.textContent === 'Blocks' && getComputedStyle(toggle).color === inactiveColor, 'stable label and inactive color restored');
        check(normal.querySelector('[data-choice-tile="8p"]').getAttribute('aria-pressed') === 'true', 'normal selection retained');
        normal.querySelector('[data-choice-tile="5p"]').click();
        check(normal.innerHTML === normalHtml, 'original normal hand restored exactly');
        toggle.click();
        check(haipaiBlockViewPrep.cacheInfo().misses === misses, 'reopening reuses grouping');
        check(!body.hidden && other.querySelector('.block-view-body').hidden, 'other card untouched');
        check(JSON.stringify(m) === original, 'stored decision unchanged');
        check(document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow');
        other.remove();
        const open = {...m, top_actions:[],
          hand:['1m','2m','3m','4m','5m','6m','7p','8p','9p','N','S'],
          melds:[{type:'ankan',consumed:['E','E','E','E']}]};
        const fixed = document.createElement('div');
        fixed.innerHTML = renderMistakeCard(open);document.querySelector('main').append(fixed);
        fixed.querySelector('.block-view-toggle').click();await wait();
        check(fixed.querySelectorAll('.block-view-body .hand-block-tiles img').length === 11, 'all concealed tiles grouped');
        check(fixed.querySelectorAll('.inline-melds img').length === 4, 'fixed kan retained once');
        check(fixed.querySelector('.block-view-counter').textContent === '4 blocks', 'kan is one fixed set');
        fixed.remove();
        toggle.click();toggle.click();toggle.click();await wait();
        check(body.hidden && !normal.hidden, 'rapid toggling preserves final off state');
        toggle.click();
        card.querySelector('.hand-row').scrollIntoView();
        document.body.dataset.result = 'passed';
      } catch (e) {document.body.dataset.result=e.stack}});
      </script></body></html>`;
    try {
      fs.writeFileSync(path.join(dir, 'test.html'), html);
      for (const width of [1100, 390]) {
        const result = spawnSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu',
          '--allow-file-access-from-files', '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`,
          `--window-size=${width},1400`, '--virtual-time-budget=3000',
          ...(process.env.HAIPAI_BLOCK_PREVIEW
            ? ['--screenshot=' + process.env.HAIPAI_BLOCK_PREVIEW + '-' + width + '.png'] : []),
          '--dump-dom', `file://${dir}/test.html`],
        { encoding: 'utf8', timeout:30000, maxBuffer:4*1024*1024 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body[^>]*data-result="passed"/, result.stdout.match(/<body[^>]*>/)?.[0]);
      }
      if (process.env.HAIPAI_BLOCK_PREVIEW) fs.writeFileSync(process.env.HAIPAI_BLOCK_PREVIEW + '.html', html);
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  });
