const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('decision cards keep evidence, explanations, feedback and disclosure state in reading order',
  { skip: chromium.status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-cards-'));
    const root = path.resolve(__dirname, '..');
    const index = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
    const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)]
      .map(match => match[1]);
    scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
    const fixture = require('./fixtures/dora_acceptance_m35078.json');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      ${['theme', 'game-detail', 'board-display'].map(name =>
        '<link rel="stylesheet" href="file://' + root + '/static/style-' + name + '.css">').join('')}
      <style>body {padding: 16px; overflow:auto} main {max-width:920px;margin:auto}</style>
      </head><body><main id="cards"></main>
      ${scripts.map(src => '<script src="file://' + root + src + '"></script>').join('')}
      <script>
      window.state = {readOnly:false};
      const base = ${JSON.stringify(fixture)};
      Object.assign(base, {id:35078, ev_loss:3.42, round_name:'S1',
        top_actions:[{action:base.expected,q_value:2}, {action:base.actual,q_value:1}]});
      Object.assign(base, haipaiCategorize.categorize(base));
      const opts = {inline:true, annotate:true, gameId:1, round:'S1', index:0};
      const host = document.getElementById('cards');
      const check = (value, message) => {if (!value) throw Error(message);};
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      const draw = (m = base, options = opts) => {
        host.innerHTML = renderMistakeCard(m, options).replaceAll('src="/static/', 'src="file://${root}/static/')
          .replaceAll('src="/tiles/', 'src="file://${root}/riichi-mahjong-tiles/Regular/');
        return host.querySelector('.mistake');
      };
      const before = (a,b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      window.addEventListener('load', async () => {
        try {
          let card = draw();
          check(card.querySelectorAll('.mistake-top .cat-badge').length === 1, 'single category badge');
          check(!card.querySelector('.mistake-top .severity, .mistake-top .ev-loss, .mistake-top .dev-id'), 'quiet header');
          check(card.querySelector('.decision-choices').textContent.includes('Your choice')
            && card.querySelector('.decision-choices').textContent.includes('Mortal’s choice'), 'explicit labels');
          const sections = ['.mistake-top','.decision-choices','.decision-hand','.decision-comparison','.mascot-speech','.decision-extras'];
          sections.slice(1).forEach((selector,i) => check(before(card.querySelector(sections[i]),card.querySelector(selector)), 'section order ' + selector));
          check(!card.querySelector('.decision-board').open, 'attack board collapsed');
          check(card.querySelector('.decision-extras .decision-board'), 'optional board after explanation');
          check(card.querySelector('.decision-evaluation .severity') && card.querySelector('.decision-evaluation .dev-id'), 'evaluation metadata');
          const expectedTable = document.createElement('div');
          expectedTable.innerHTML = renderEvComparison(base);
          check(card.querySelector('table').textContent === expectedTable.querySelector('table').textContent, 'comparison contents preserved');
          // Real native summary activation, then filter the card out and back in.
          card.querySelector('.decision-evaluation > summary').click();
          card.querySelector('.decision-notes > summary').click();
          card.querySelector('.decision-board > summary').click();
          await tick();
          host.innerHTML = '';
          await tick();
          card = draw(structuredClone(base));
          check([...card.querySelectorAll('details[data-disclosure]')].every(d => d.open), 'filter and refresh preserve expansion');
          card.querySelector('.decision-notes').open = false;
          card = draw();
          check(!card.querySelector('.decision-notes').open, 'immediate rerender preserves collapse');
          const defense = {...structuredClone(base), id:2, skillArea:'defense'};
          card = draw(defense);
          check(card.querySelector('.decision-board').open, 'defense board open');
          check(before(card.querySelector('.decision-board'),card.querySelector('.mascot-speech')), 'board evidence before explanation');
          check(!card.querySelector('.decision-board details'), 'no hidden nested discards');
          card.querySelector('.decision-board > summary').click();
          await tick();
          card = draw(defense);
          check(!card.querySelector('.decision-board').open, 'explicit collapse overrides defense default');
          const mixed = {...structuredClone(base), id:3, per_threat:[{seat:0,kind:'riichi',dealin_rates:{}}]};
          check(draw(mixed).querySelector('.decision-board').open, 'mixed defense board open');
          const furiten = {...structuredClone(base), id:4, bad_riichi_reason:'furiten',furiten_tiles:['5p']};
          card = draw(furiten);
          check(card.querySelector('.decision-comparison .furiten-badge') && card.querySelector('.decision-board').open, 'furiten beside visible evidence');
          check(draw({...structuredClone(base), id:5, is_all_last:true}).querySelector('.decision-board').open, 'score evidence visible');
          const complex = {...structuredClone(base), id:6, shape:'complex'};
          card = draw(complex);
          check(card.querySelector('.decision-notes .complex-gap-row'), 'complex feedback in notes');
          check(!card.querySelector('.speech-bubble .report-row'), 'feedback outside teaching text');
          check(before(card.querySelector('.mascot-speech'),card.querySelector('.complex-gap-row')), 'feedback follows explanation');
          card = draw(complex, {});
          check(!card.querySelector('input, .report-row') && card.querySelectorAll('.mascot-speech').length === 1, 'admin read-only card');
          card = draw({...structuredClone(base),id:7, actual:{type:'pon',actor:3,pai:'5p',consumed:['5p','5p']}});
          check(card.querySelector('.decision-choices .action-meld'), 'call choice rendered');
          card = draw({...structuredClone(base),id:8, actual:{type:'reach',actor:3},actual_riichi_tile:'5p'});
          check(card.querySelector('.decision-choices .action-riichi'), 'riichi choice rendered');
          // Leave a representative attack card for desktop/mobile visual checks.
          mistakeDisclosures.clear();
          card = draw();
          check(document.documentElement.scrollWidth <= innerWidth, 'no page overflow');
          document.body.dataset.result = 'passed';
        } catch(error) { document.body.dataset.result = error.stack; }
      });
      </script></body></html>`;
    try {
      fs.writeFileSync(path.join(dir, 'test.html'), html);
      for (const width of [1100, 390]) {
        const result = spawnSync('chromium', ['--headless', '--no-sandbox', '--disable-gpu',
          '--allow-file-access-from-files', '--no-proxy-server', `--user-data-dir=${dir}/profile-${width}`,
          `--window-size=${width},1400`, '--virtual-time-budget=3000', '--dump-dom', `file://${dir}/test.html`],
        { encoding: 'utf8', timeout:30000, maxBuffer:4*1024*1024 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /<body data-result="passed">/, result.stdout.match(/<body[^>]*>/)?.[0] || result.stderr);
      }
      if (process.env.HAIPAI_CARD_PREVIEW_DIR) {
        fs.mkdirSync(process.env.HAIPAI_CARD_PREVIEW_DIR, {recursive:true});
        fs.writeFileSync(path.join(process.env.HAIPAI_CARD_PREVIEW_DIR, 'test.html'), html);
      }
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  });
