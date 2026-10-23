const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const chromium = spawnSync('chromium', ['--version'], { encoding: 'utf8' });
test('decision cards show evidence before explanations and keep feedback editable only in game views',
  { skip: chromium.status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haipai-cards-'));
    const root = path.resolve(__dirname, '..');
    const index = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
    const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)]
      .map(match => match[1]);
    scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
    const fixture = require('./fixtures/dora_acceptance_m35078.json');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
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
      const before = (a,b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      window.addEventListener('load', async () => {
        try {
          let card = draw();
          check(card.querySelectorAll('.mistake-top .cat-badge').length === 1, 'single category badge');
          check(card.querySelector('.mistake-top .severity').textContent.includes('3.42 EV'), 'visible evaluation');
          check(card.querySelector('.mistake-top .dev-id').getAttribute('href') === '#m35078', 'mistake permalink');
          check(card.querySelector('.col-actual .marker').textContent === 'You'
            && card.querySelector('.col-expected .marker').textContent === 'AI', 'explicit comparison labels');
          check(card.querySelector('.hand-choice-you') && card.querySelector('.hand-choice-ai'), 'choices marked on hand');
          const sections = ['.mistake-top','.hand-row','.board-context','.ev-comparison','.mascot-speech','.note-row','.report-row'];
          sections.slice(1).forEach((selector,i) => check(before(card.querySelector(sections[i]),card.querySelector(selector)), 'section order ' + selector));
          check(!card.querySelector('.all-discards').open, 'attack discards collapsed');
          const expectedTable = document.createElement('div');
          expectedTable.innerHTML = renderEvComparison(base);
          check(card.querySelector('table').textContent === expectedTable.querySelector('table').textContent, 'comparison contents preserved');
          // Exercise native disclosure in both directions.
          card.querySelector('.all-discards > summary').click();
          await tick();
          check(card.querySelector('.all-discards').open, 'discards expand on click');
          check(card.querySelector('.all-discards .discard-row'), 'expanded discard evidence');
          card.querySelector('.all-discards > summary').click();
          await tick();
          check(!card.querySelector('.all-discards').open, 'discards collapse on click');
          const annotated = {...structuredClone(base), note:'Keep the dora',
            my_report:{kind:'wrong_text',reason:'Please check the acceptance'}};
          card = draw(annotated);
          check(card.querySelector('.note-input').value === annotated.note, 'saved annotation restored');
          check(card.querySelector('.report-reason').value === annotated.my_report.reason
            && card.querySelector('.report-btn-wrong_text.active'), 'saved report restored');
          const defense = {...structuredClone(base), id:2, skillArea:'defense'};
          card = draw(defense);
          check(card.querySelector('.all-discards').open, 'defense discards open');
          check(before(card.querySelector('.board-context'),card.querySelector('.mascot-speech')), 'board evidence before explanation');
          card.querySelector('.all-discards > summary').click();
          await tick();
          check(!card.querySelector('.all-discards').open, 'defense discards can be collapsed');
          const mixed = {...structuredClone(base), id:3, per_threat:[{seat:0,kind:'riichi',dealin_rates:{}}]};
          check(draw(mixed).querySelector('.all-discards').open, 'live threat expands discards');
          const furiten = {...structuredClone(base), id:4, bad_riichi_reason:'furiten',furiten_tiles:['5p']};
          card = draw(furiten);
          check(card.querySelector('.mistake-top .furiten-badge').title.includes('5p'), 'furiten wait identified');
          check(draw({...structuredClone(base), id:5, is_all_last:true}).querySelector('.all-last-badge'), 'final-round context visible');
          const complex = {...structuredClone(base), id:6, shape:'complex',
            my_report:{kind:'complex_gap',suggested_category:'shape',reason:'Compare the blocks'}};
          card = draw(complex);
          check(card.querySelectorAll('.complex-gap-row').length === 1, 'single complex feedback funnel');
          check(card.querySelector('.speech-bubble .complex-gap-row'), 'complex feedback accompanies explanation');
          check(card.querySelector('.complex-tag.active').dataset.tag === 'shape'
            && card.querySelector('.complex-gap-reason').value === complex.my_report.reason, 'saved complex feedback restored');
          state.readOnly = true;
          card = draw(complex, {inline:true});
          check(!card.querySelector('input, .report-row') && card.querySelectorAll('.mascot-speech').length === 1, 'shared card has explanation without feedback');
          state.readOnly = false;
          card = draw(complex, {});
          check(!card.querySelector('input, .report-row, .mascot-speech') && card.querySelector('.ev-comparison'), 'admin card leaves explanation to its caller');
          const call = {...structuredClone(base),id:7, discard_stats:[],
            actual:{type:'pon',actor:3,pai:'5p',consumed:['5p','5p']}, expected:{type:'none'}};
          call.top_actions = [{action:call.expected,q_value:2},{action:call.actual,q_value:1}];
          card = draw(call);
          check(card.querySelector('.top-actions .action-meld'), 'call choice rendered without discard statistics');
          const riichi = {...structuredClone(base),id:8, actual:{type:'reach',actor:3},actual_riichi_tile:'5p'};
          riichi.top_actions = [{action:riichi.expected,q_value:2},{action:riichi.actual,q_value:1}];
          card = draw(riichi);
          check(card.querySelector('.col-actual .reach-pill-riichi')
            && card.querySelector('.col-actual .ev-tile').alt === '5p', 'riichi choice includes its discard');
          // Leave a representative attack card for desktop/mobile visual checks.
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
