const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../static/js/terminology.js'), 'utf8');

function load(stored, unavailable = false) {
  const storage = new Map(stored ? [['haipai_terminology', stored]] : []);
  const context = vm.createContext({ localStorage: {
    getItem: key => { if (unavailable) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (unavailable) throw Error('blocked'); storage.set(key, value); },
  } });
  vm.runInContext(source, context);
  return context.HaipaiTerminology;
}

test('English terms use whole words, preserve case and prefer full yaku names', () => {
  const terms = load();
  assert.equal(terms.language, 'japanese');
  assert.equal(terms.translate('Ukeire: 12, 2-shanten; Tenpai'), 'Acceptance: 12, 2-away; Ready');
  assert.equal(terms.translate('Tanyao / Honitsu / Chiitoitsu'), 'All simples / Half flush / Seven pairs');
  assert.equal(terms.translate('sanshoku doukou / pure chuuren poutou'), 'triple triplets / pure nine gates');
  assert.equal(terms.translate('SHANTEN / shanten_calc / ranking'), 'AWAY / shanten_calc / ranking');
});

test('saved and unavailable preferences have safe defaults', () => {
  assert.equal(load('english').language, 'english');
  assert.equal(load('invalid').language, 'japanese');
  assert.equal(load('english', true).language, 'japanese');
});

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('settings, async content, tooltips, restoration and storage work in a browser',
  { skip: chromium.status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-terminology-'));
    const script = name => `<script src="file://${path.resolve(__dirname, '../static/js', name)}"></script>`;
    const html = `<!doctype html><html><body><div id="content"></div>
      <script>localStorage.clear(); window.state = {}; window.renderGameList = () => {};</script>
      ${script('html-escape.js')}${script('actions.js')}${script('terminology.js')}${script('account.js')}
      <script>
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      window.addEventListener('load', async () => {
        try {
          showAccount();
          check(document.querySelector('h2').textContent === 'Settings', 'settings heading');
          const select = document.getElementById('terminology-select');
          select.value = 'english'; select.dispatchEvent(new Event('change', {bubbles: true}));
          check(localStorage.getItem('haipai_terminology') === 'english', 'saved preference');
          const content = document.getElementById('content');
          content.innerHTML = '<p id="label" title="Tanyao: 1-shanten" data-yaku="tanyao">Ukeire: 12</p>'
            + '<textarea>riichi notes</textarea><span class="wt-lb-name">Tanyao</span>'
            + '<span data-terminology="ignore">Shanten</span><a href="/riichi">Riichi</a>';
          await tick();
          const label = document.getElementById('label');
          check(label.textContent === 'Acceptance: 12', 'async text');
          check(label.title === 'All simples: 1-away', 'tooltip');
          check(label.dataset.yaku === 'tanyao', 'data key');
          check(document.querySelector('textarea').value === 'riichi notes', 'notes');
          check(document.querySelector('.wt-lb-name').textContent === 'Tanyao', 'player name');
          check(document.querySelector('[data-terminology]').textContent === 'Shanten', 'opt out');
          check(document.querySelector('a').getAttribute('href') === '/riichi', 'link URL');
          label.textContent = '2-shanten'; label.title = 'Honitsu';
          await tick();
          check(label.textContent === '2-away' && label.title === 'Half flush', 'reused node');
          HaipaiTerminology.setLanguage('japanese');
          check(label.textContent === '2-shanten' && label.title === 'Honitsu', 'restore latest source');
          HaipaiTerminology.setLanguage('english');
          HaipaiTerminology.setLanguage('japanese');
          check(label.title === 'Honitsu', 'repeat toggle');
          window.dispatchEvent(new StorageEvent('storage', {key: 'haipai_terminology', newValue: 'english'}));
          check(label.textContent === '2-away', 'other tab');
          Object.defineProperty(window, 'localStorage', {get() { throw Error('blocked'); }});
          check(HaipaiTerminology.setLanguage('japanese') === false, 'blocked storage');
          check(label.textContent === '2-shanten', 'blocked storage still applies');
          document.body.dataset.result = 'passed';
        } catch (error) { document.body.dataset.result = error.message; }
      });
      </script></body></html>`;
    try {
      fs.writeFileSync(path.join(dir, 'test.html'), html);
      const result = spawnSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu',
        '--allow-file-access-from-files', '--no-proxy-server', `--user-data-dir=${dir}/profile`,
        '--virtual-time-budget=2000', '--dump-dom', `file://${dir}/test.html`],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /<body data-result="passed">/, result.stdout);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });
