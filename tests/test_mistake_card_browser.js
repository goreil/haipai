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
    const reports = require('./fixtures/scored_value_reports.json');
    const scoredHand = reports.find(r => r.mistake.id === 42402).mistake;
    const doraHand = reports.find(r => r.mistake.id === 607).mistake;
    const furitenHand = reports.find(r => r.report_ids.includes(205)).mistake;
    const flushHand = reports.find(r => r.mistake.id === 15192).mistake;
    const tenpaiHand = reports.find(r => r.mistake.id === 42417).mistake;
    const headlineCases = [
      [6099, 'Attack / Efficiency + Value'],
      [5502, 'Defense / Value + Safety'],
      [6827, 'Defense / Complex'],
      [6073, 'Attack / Prioritize value'],
      [6077, 'Defense / Should fold'],
      [2066, 'Defense / Should push'],
      [6074, 'Attack / Prioritize safety'],
      [6078, 'Defense / Safety trade-off'],
      [6075, 'Attack / Complex'],
      [6076, 'Meld / Bad Call'],
    ];
    const inputs = require('./fixtures/categorize_parity.json').fixtures;
    const headlineFixtures = headlineCases.map(([id, label]) => ({
      id, label, input: inputs.find(f => f.mistake_id === id).inputs,
    }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      ${['theme', 'game-detail', 'board-display'].map(name =>
        '<link rel="stylesheet" href="file://' + root + '/static/style-' + name + '.css">').join('')}
      <style>body {padding: 16px; overflow:auto} main {max-width:920px;margin:auto}</style>
      </head><body><main id="cards"></main>
      ${scripts.map(src => '<script src="file://' + root + src + '"></script>').join('')}
      <script>
      window.state = {readOnly:false};
      const base = ${JSON.stringify(fixture)};
      const headlineFixtures = ${JSON.stringify(headlineFixtures)};
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
          for (const fixture of headlineFixtures) {
            const m = {...fixture.input, id:fixture.id, ev_loss:1, round_name:'E1',
              ...haipaiCategorize.categorize(fixture.input)};
            card = draw(m, {inline:true});
            check(card.querySelectorAll('.cat-badge').length === 1, 'single replacement badge ' + fixture.id);
            check(card.querySelector('.cat-badge').textContent === fixture.label, 'headline ' + fixture.id);
            check(card.querySelectorAll(':scope > .mistake-top').length === 1
              && card.querySelectorAll(':scope > .mascot-speech').length === 1, 'no added row or explanation ' + fixture.id);
            check(document.documentElement.scrollWidth <= innerWidth, 'headline fits viewport ' + fixture.id);
          }
          const scored = ${JSON.stringify(scoredHand)};
          card = draw({ ...scored, ...haipaiCategorize.categorize(scored) }, {inline:true});
          check(card.querySelector('.cat-badge').textContent === 'Attack / Value', 'scored iipeikou headline');
          const summary = card.querySelector('.feat-summary-row');
          const value = card.querySelector('.score-col');
          const profile = side => value.querySelector('.col-' + side + ' .scored-profile');
          const evidence = side => profile(side).innerText.replaceAll(',', '');
          check(profile('actual').querySelector('.score-metric').textContent === 'Final wait 6–7 tiles' && !/Average|Max/.test(evidence('expected')),
            'one-shanten profile shows the final wait range without average or max');
          const sides = ['actual', 'expected'];
          for (const side of sides) {
            check(!/wait value/i.test(profile(side).textContent) && !profile(side).querySelector('button, [popover]'),
              'projected Value has neither an aggregate nor a calculation control');
            check(/iipeikou [\\d.]+%/.test(evidence(side)), 'per-pick iipeikou percentage in Value');
            check(!evidence(side).includes('riichi'), 'Value percentages omit ordinary riichi');
          }
          const mountDraws = () => {
            const hosts = card.querySelectorAll('haipai-iishanten');
            check(hosts.length === 1, 'one Value draw view for #' + card.id);
            const view = hosts[0];
            const details = [...view.querySelectorAll('[data-draw-details]')];
            const visible = () => !!view.querySelector('.continuation-draw')?.checkVisibility();
            check(!visible(), 'draw breakdown starts collapsed');
            details.at(-1).click();
            check(visible() && details.every(b => b.getAttribute('aria-expanded') === 'true'), 'either control opens both columns');
            details[0].click();
            check(!visible() && details.every(b => b.getAttribute('aria-expanded') === 'false'), 'other control collapses both columns');
            details[0].click();
            return hosts[0];
          };
          const pill = (view, side) => view.querySelector('.col-' + side + ' [data-all-draws]');
          const checkPills = (view, labels, expanded) => sides.forEach((side, i) => {
            const button = pill(view, side);
            check(button?.checkVisibility() && button.innerText.replace(/[▸◂]/g, '').trim() === labels[i]
              && button.getAttribute('aria-expanded') === String(expanded), side + ' pill should show ' + labels[i]);
          });
          const drawButton = (view, side, tile) => {
            const button = view.querySelector('.col-' + side + ' .continuation-draw:has(img[alt="' + tile + '"])');
            return button?.checkVisibility() ? button : null;
          };
          let view = mountDraws();
          const check42402 = expanded => {
            checkPills(view, expanded ? ['16', '16'] : ['3 equal', '3 equal'], expanded);
            check(!view.querySelector('.continuation-rows').innerText.includes('riichi'), 'draw tags omit ordinary riichi');
            for (const side of sides) {
              for (const tile of ['9p', '4s']) {
                check(!!drawButton(view, side, tile) === expanded, side + ' equal draw ' + tile);
              }
            }
            if (!expanded) {
              for (const tile of ['1p', '4p']) {
                check(drawButton(view, 'expected', tile)?.closest('.continuation').innerText.includes('+iipeikou?'),
                  tile + ' retains the conditional iipeikou gain');
              }
            }
          };
          check42402(false);
          pill(view, 'actual').click();
          check42402(true);
          pill(view, 'expected').click();
          check42402(false);
          check(!summary.querySelector('.scored-profile') && summary.querySelector('.col-actual').textContent === '—'
            && summary.querySelector('.col-expected').textContent === '+16.1% iipeikou',
            'equal final waits give only the iipeikou advantage');
          check(getComputedStyle(summary.querySelector('.col-expected .feat-pill')).getPropertyValue('--feat-grp').trim()
            === haipaiCompareDimensions.GROUP_META.Yaku.color, 'scored yaku uses the heuristic yaku color');
          check(!/wait value/i.test(card.querySelector('.mascot-speech').textContent),
            'projected explanation has no wait-value gain');
          check(document.documentElement.scrollWidth <= innerWidth, 'iipeikou comparison fits viewport');
          card.querySelector('button[aria-label="Compare discarding 2p with AI"]').click();
          check(card.querySelector('.col-actual .ev-tile').alt === '2p', 'selected two-shanten counterpart');
          view = mountDraws();
          check(card.querySelector('.score-col .col-expected').contains(view) && !view.querySelector('[data-all-draws]'),
            'unpaired one-shanten pick has no equality toggle');
          const fullDraws = [...view.querySelectorAll('.continuation-draw')].filter(b => b.checkVisibility())
            .map(b => b.querySelector('img').alt).sort();
          check(fullDraws.join(' ') === '1p 2s 4p 4s 5s 5sr 9p', 'all AI draws visible without a counterpart');
          const dora = ${JSON.stringify(doraHand)};
          card = draw({ ...dora, ...haipaiCategorize.categorize(dora) }, {inline:true});
          check(card.querySelector('.cat-badge').textContent === 'Attack / Final wait', 'final wait attack category');
          view = mountDraws();
          checkPills(view, ['14 equal', '14 equal'], false);
          // Mounting draw rows is lazy, so load their local tile SVGs before measuring layout.
          await Promise.all([...view.querySelectorAll('img[src^="/tiles/"]')].map(img => {
            img.src = img.getAttribute('src').replace('/tiles/', 'file://${root}/riichi-mahjong-tiles/Regular/');
            return img.decode();
          }));
          const doraRows = sides.map((side, i) => {
            const three = drawButton(view, side, '3m'), seven = drawButton(view, side, '7s');
            check(three?.innerText.trim() === '×3' && seven?.innerText.trim() === '×2', side + ' differing draw counts');
            const row = three.closest('.continuation');
            check(row === seven.closest('.continuation'), side + ' groups the two dora differences');
            check(row.querySelector('.dora-tag')?.innerText === ['2 dora', '2–3 dora'][i], side + ' dora range');
            return row.getBoundingClientRect();
          });
          check(doraRows[0].right <= doraRows[1].left && Math.abs(doraRows[0].top - doraRows[1].top) < 1,
            'corresponding dora outcomes align side by side at viewport width ' + innerWidth);
          pill(view, 'expected').click();
          checkPills(view, ['38', '33'], true);
          for (const side of sides) {
            const acceptance = card.querySelector('.ukeire-acc-row .col-' + side + ' .ukeire-collapsed button');
            check(acceptance.checkVisibility() && acceptance.innerText.includes('19 shared'),
              'Tile acceptance still counts all shared draws after expanding Value');
          }
          check(document.documentElement.scrollWidth <= innerWidth, 'no page overflow');
          const blocked = ${JSON.stringify(furitenHand)};
          card = draw({ ...blocked, ...haipaiCategorize.categorize(blocked) }, {inline:true});
          view = mountDraws();
          const blockedRow = drawButton(view, 'actual', '4s').closest('.continuation');
          check(blockedRow.querySelector('.furiten-badge')?.checkVisibility(), 'furiten draw shows the tenpai badge');
          check(!view.querySelector('.col-expected .furiten-badge') && !view.innerText.includes('Live wait'),
            'unblocked draws need no status label');
          const ronPill = card.querySelector('.feat-summary-row .col-expected [title*="other cut is furiten"]');
          check(ronPill?.querySelector('.feat-pill-label').textContent === 'Keeps ron after'
            && [...ronPill.querySelectorAll('img')].map(img => img.alt).sort().join(' ') === '4s 5s 7s F'
            && !card.querySelector('.feat-summary-row .col-actual [title*="other cut is furiten"]'),
            'only the cut that keeps ron gets the matching shared draws');
          const tenpai = ${JSON.stringify(tenpaiHand)};
          card = draw({ ...tenpai, ...haipaiCategorize.categorize(tenpai) }, {inline:true});
          for (const side of sides) {
            const scores = card.querySelector('.score-col .col-' + side + ' > .rsc-cell');
            check(scores.querySelector('.rsc-vals').checkVisibility(), 'tenpai payouts visible without a disclosure');
            const metrics = scores.parentElement.querySelector('.scored-profile');
            check(metrics.innerText.includes('Wait value') && !/Final wait|Max|Average/.test(metrics.textContent),
              'tenpai shows wait value without redundant metrics');
            const button = metrics.querySelector('button');
            button.click();
            const panel = metrics.querySelector(':popover-open');
            check(panel?.innerText.includes('÷ 2') && panel.innerText.endsWith(button.querySelector('b').innerText),
              side + ' tenpai calculation explains its displayed wait value');
            const rect = panel.getBoundingClientRect();
            check(rect.left >= 0 && rect.right <= innerWidth, 'tenpai calculation fits the viewport');
            button.click();
            check(!metrics.querySelector(':popover-open'), 'tenpai calculation closes');
          }
          const flush = ${JSON.stringify(flushHand)};
          card = draw({ ...flush, ...haipaiCategorize.categorize(flush) }, {inline:true});
          for (const [side, yaku] of [['actual', 'yakuhai (hatsu)'], ['expected', 'honitsu']]) {
            const wait = card.querySelector('.feat-summary-row .col-' + side + ' [title^="Final wait compared"]');
            check(wait && getComputedStyle(wait).getPropertyValue('--feat-grp').trim() === SKILL_AREA_INFO.attack.color,
              side + ' final wait uses Attack blue');
            const metric = card.querySelector('.score-col .col-' + side + ' .score-metric');
            const metricStyle = getComputedStyle(metric), pillStyle = getComputedStyle(wait);
            check(['color', 'backgroundColor', 'borderTopColor'].every(key => metricStyle[key] === pillStyle[key]),
              side + ' final wait metric matches the efficiency pill palette');
            const pills = [...card.querySelectorAll('.feat-summary-row .col-' + side + ' .feat-pill-label')].map(p => p.textContent);
            check(pills.filter(p => p.startsWith('Final wait ')).length === 1
              && pills.filter(p => p.endsWith('% ' + yaku)).length === 1
              && !pills.some(p => /wait value/i.test(p)), side + ' gets its own wait and yaku advantages once');
          }
          const speech = card.querySelector('.mascot-speech').textContent;
          check(/Your [^.]*yakuhai \\(hatsu\\)/.test(speech) && /Mortal's [^.]*honitsu/.test(speech)
            && !/wait value/i.test(speech), 'crossing projected advantages are explained on their own sides');
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
