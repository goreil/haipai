const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('admin distinguishes pending grades from completed reviews at desktop and mobile widths',
  { skip: chromium.status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-maka-review-'));
    const script = name => `<script src="file://${path.resolve('static/js', name)}"></script>`;
    const style = name => `<link rel="stylesheet" href="file://${path.resolve('static', name)}">`;
    const file = path.join(dir, 'test.html');
    fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${['style-theme.css', 'style-layout.css'].map(style).join('')}
      <style>body {overflow:auto} #content {max-width:900px;margin:24px auto;padding:16px;overflow:visible}</style>
      </head><body><main id="content"></main>
      ${['html-escape.js', 'admin.js'].map(script).join('')}
      <script>
      const card = document.getElementById('content');
      const check = (ok, message) => {if (!ok) throw Error(message);};
      try {
        card.innerHTML = renderMakaRankPanel({count:41, undated:158, since:'2026-09-22 19:12:18'});
        check(card.querySelector('strong').textContent === '41', 'pre-review count');
        check(card.textContent.includes('No calibration review recorded'), 'fallback is explicit');
        const reviewed = {count:0, overall:0, hand:0, undated:158, reviewed:true,
          since:'2026-10-22 12:00:00', reviewed_grades:198,
          conclusion:'Keep current thresholds. Separate scales provide no convincing improvement.'};
        card.innerHTML = renderMakaRankPanel({...reviewed, conclusion:'<img src=x onerror="window.injected=true">'});
        check(!card.querySelector('img') && !window.injected, 'conclusion is escaped');
        card.innerHTML = renderMakaRankPanel({...reviewed, count:2, overall:1, hand:1});
        check(card.querySelector('strong').textContent === '2', 'later submissions remain visible');
        check(card.textContent.includes('1 overall, 1 hand'), 'pending scope breakdown');
        card.innerHTML = '<div class="game-header"><h2>Admin Dashboard</h2></div>' + renderMakaRankPanel(reviewed);
        check(card.querySelector('strong').textContent === '0', 'completed review clears pending count');
        check(!card.textContent.includes('At least'), 'undated history does not inflate pending count');
        check(card.textContent.includes('198 usable grades'), 'usable sample size remains visible');
        check(document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow');
        document.body.dataset.result = 'passed';
      } catch(error) {document.body.dataset.result = error.stack;}
      </script></body></html>`);
    try {
      for (const width of [1280, 390]) {
        const args = ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
          '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`, '--virtual-time-budget=1000',
          `--window-size=${width},800`, '--dump-dom'];
        if (process.env.HAIPAI_MAKA_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.HAIPAI_MAKA_SCREENSHOT_DIR, {recursive:true});
          args.push('--screenshot=' + path.join(process.env.HAIPAI_MAKA_SCREENSHOT_DIR, `maka-${width}.png`));
        }
        const result = spawnSync('chromium', [...args, 'file://' + file],
          {encoding:'utf8', timeout:30000, maxBuffer:2 * 1024 * 1024});
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body data-result="passed">/, result.stdout);
      }
    } finally {fs.rmSync(dir, {recursive:true, force:true});}
  });
