const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('admin can switch between open reports and fixed history in Chromium',
  { skip: chromium.status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-fixed-reports-'));
    const file = path.join(dir, 'test.html');
    const script = name => `<script src="file://${path.resolve('static/js', name)}"></script>`;
    const style = name => `<link rel="stylesheet" href="file://${path.resolve('static', name)}">`;
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${['style-theme.css', 'style-layout.css', 'style-game-detail.css', 'style-coins.css'].map(style).join('')}
      <style>body {overflow:auto} #content {max-width:1100px;margin:24px auto;padding:16px;overflow:visible}</style>
      </head><body><main id="content"></main>
      ${['html-escape.js', 'actions.js', 'admin.js'].map(script).join('')}
      <script>
      window._meData = {id:1, username:'admin'};
      const formatRoundLabel = value => value;
      const formatTurnNumber = value => value;
      const parseTabHash = () => 'admin';
      const refreshCoinBalance = () => {};
      const rows = [{id:42, mistake_id:10, game_id:3, round_name:'East 1', turn:4,
        kind:'wrong_text', username:'reporter', created_at:'2026-10-20 10:00:00',
        reason:'The explanation claims a scoring pattern that is not shown.', awarded_coins:null}];
      window.fetch = async url => {
        const status = new URL(url, 'https://example.test').searchParams.get('status');
        return {ok:true, json:async () => ({reports: structuredClone(rows.filter(r =>
          status === 'all' || (status === 'fixed' ? !!r.fixed_at : !r.fixed_at)))})};
      };
      window.prompt = () => 'Removed the unsupported scoring claim. Report-hand regression tests pass.';
      const apiPost = async (url, body) => {
        Object.assign(rows[0], {fixed_at:'2026-10-21 12:00:00', fixed_by:1,
          fixed_by_username:'admin', fix_note:body.reason, awarded_coins:66});
        return {ok:true, json:async () => ({...rows[0], id:999, amount:66})};
      };
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const settle = () => new Promise(resolve => setTimeout(resolve, 0));
      window.addEventListener('load', async () => {
        try {
          adminState.reportScope = 'all';
          await reloadAdminReports('all');
          check(document.querySelector('#report-42'), 'open report visible');
          check(!document.querySelector('[data-action="adminDeleteReport"]'), 'no destructive cleanup action');
          document.querySelector('[data-action="adminFixReport"]').click();
          await settle();
          check(!document.querySelector('#report-42'), 'fixed report disappears from open view');
          let select = document.querySelector('[data-change-action="adminSetReportStatus"]');
          select.value = 'fixed';
          select.dispatchEvent(new Event('change', {bubbles:true}));
          await settle();
          check(document.querySelector('#report-42'), 'fixed report retained with original ID');
          check(document.querySelector('.report-resolution').textContent.includes('regression tests pass'), 'fix summary');
          check(document.querySelector('.report-resolution').textContent.includes('@admin'), 'fix actor');
          check(!document.querySelector('[data-action="adminFixReport"]'), 'history has no completion action');
          check(document.querySelector('.report-reason').textContent.includes('scoring pattern'), 'original feedback');
          check(document.querySelector('.report-coin-awarded').textContent.includes('66'), 'award retained');
          rows[0].fix_note = '<img src=x onerror="window.injected=true">';
          await reloadAdminReports('all');
          check(!document.querySelector('.report-resolution img') && !window.injected, 'fix summary escaped');
          rows[0].fix_note = window.prompt();
          await reloadAdminReports('all');
          // Frame the report controls/history for the optional visual review.
          const header = document.getElementById('admin-report-controls').previousElementSibling;
          while (header.previousElementSibling) header.previousElementSibling.remove();
          window.scrollTo(0, 0);
          check(document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow');
          document.body.dataset.result = 'passed';
        } catch (error) { document.body.dataset.result = error.stack; }
      });
      </script></body></html>`;
    try {
      fs.writeFileSync(file, html);
      for (const width of [1280, 390]) {
        const args = ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
          '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`, '--virtual-time-budget=3000',
          `--window-size=${width},1000`, '--dump-dom'];
        if (process.env.HAIPAI_REPORT_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.HAIPAI_REPORT_SCREENSHOT_DIR, {recursive:true});
          args.push('--screenshot=' + path.join(process.env.HAIPAI_REPORT_SCREENSHOT_DIR, `fixed-${width}.png`));
        }
        const result = spawnSync('chromium', [...args, 'file://' + file],
          {encoding:'utf8', timeout:30000, maxBuffer:2 * 1024 * 1024});
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body data-result="passed">/, result.stdout);
      }
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  });
