const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('deal-in values identify every opponent while collapsed, including a single dealer',
  { skip: chromium.status !== 0 }, () => {
    const root = path.resolve(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-dealin-'));
    const index = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
    const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)].map(m => m[1]);
    scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
    const fixture = require('./fixtures/dora_acceptance_m35078.json');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      ${['theme', 'game-detail'].map(n => `<link rel="stylesheet" href="file://${root}/static/style-${n}.css">`).join('')}
      <style>body{padding:16px}main{max-width:750px;margin:auto}</style></head><body><main></main>
      ${scripts.map(src => `<script src="file://${root}${src}"></script>`).join('')}
      <script>
      const m = ${JSON.stringify(fixture)};
      m.top_actions = [{action:m.actual,q_value:1}, {action:m.expected,q_value:2}];
      m.actual.actor = 1;
      m.board_state.seat_wind = 'S';
      const rates = (you, ai) => ({[m.actual.pai]:you,[m.expected.pai]:ai});
      m.dealin_rates = rates(30, 12);
      m.per_threat = [
        {seat:3,kind:'open',guaranteed_han:2,dealin_rates:rates(15,3)},
        {seat:0,kind:'riichi',dealin_rates:rates(20,10)},
        {seat:2,kind:'open',dealin_rates:rates(0,0),soft_safe:[m.expected.pai]},
      ];
      const host = document.querySelector('main');
      const check = (ok, msg) => {if (!ok) throw Error(msg)};
      const draw = () => {host.innerHTML = renderEvComparison(m)};
      window.addEventListener('load', () => {try {
        draw();
        const cells = [...host.querySelectorAll('.dealin-col td')].filter(e=>e.tagName==='TD');
        check(cells.length===2, 'two comparison columns');
        for (const cell of cells) {
          const details = [...cell.querySelectorAll('details')];
          check(details.length===3, 'one disclosure per opponent');
          check(details.every(d=>!d.open), 'calculations initially collapsed');
          check([...cell.querySelectorAll('summary .dealin-threat-seat')].map(e=>e.textContent).join(',')==='E,W,N', 'visible winds in round order');
          check(!cell.textContent.includes('all threats'), 'no aggregate total');
          details[1].querySelector('summary').click();
          check(details[1].open && !details[0].open && !details[2].open, 'independent expansion');
        }
        check(cells[0].querySelector('summary').textContent.includes('20.0%'), 'individual risk rather than aggregate');
        check(cells[1].textContent.includes('Safe*'), 'soft safe preserved per opponent');
        m.per_threat = [m.per_threat[1]];
        draw();
        check(host.querySelectorAll('summary .dealin-threat-seat').length===2, 'single opponent keeps wind in both columns');
        check(host.querySelector('summary .dealin-threat-seat').textContent==='E', 'dealer East remains visible');
        check(renderWinFeatPill({dim:'deal_in',pct:5,threat:{seat:0,kind:'riichi'}},0).includes('(E)'), 'dealer summary pill keeps wind');
        m.per_threat.push({seat:2,kind:'open',dealin_rates:rates(0,0)});
        draw();
        document.body.innerHTML = document.body.innerHTML.replaceAll('src="/tiles/', 'src="file://${root}/riichi-mahjong-tiles/Regular/');
        document.body.dataset.result='passed';
      } catch(e) {document.body.dataset.result=e.stack}});
      </script></body></html>`;
    try {
      const file = path.join(dir, 'test.html');
      fs.writeFileSync(file, html);
      for (const width of [1100, 390]) {
        const result = spawnSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu',
          '--allow-file-access-from-files', '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`,
          `--window-size=${width},1000`, '--virtual-time-budget=3000', '--dump-dom', `file://${file}`],
        { encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body data-result="passed">/, result.stdout.match(/<body[^>]*>/)?.[0]);
      }
      if (process.env.HAIPAI_DEALIN_PREVIEW) fs.writeFileSync(process.env.HAIPAI_DEALIN_PREVIEW, html);
    } finally {fs.rmSync(dir, {recursive:true,force:true})}
  });
