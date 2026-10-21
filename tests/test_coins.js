const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({});
for (const file of ['html-escape', 'coins']) vm.runInContext(fs.readFileSync(`static/js/${file}.js`, 'utf8'), ctx);

test('report history shows the user report and hides fix descriptions and generic award text', () => {
  const html = ctx.coinEntriesHtml([{id: 1, mistake_id: 7414, report_id: 12, mistake_available: true,
    kind: 'report_fix', amount: 131, created_at: '2026-10-19 12:00:00',
    title: 'Report R-12 helped fix Haipai', detail: 'Generic old boilerplate',
    report_text: '<script>alert("report")</script>', fix_description: 'Corrected the <yakuhai> comparison'}]);
  assert.match(html, /href="#m7414"/);
  assert.match(html, /Mistake <a[^>]*>#7414<\/a>/);
  assert.match(html, /R-12/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /Corrected the|yakuhai/);
  assert.doesNotMatch(html, /<script>|helped fix Haipai|Generic old boilerplate/);
});

test('missing reports and deleted mistakes do not produce a quote or broken link', () => {
  const html = ctx.coinEntriesHtml([{id: 1, mistake_id: 15, mistake_available: false,
    kind: 'report_fix', amount: 20, created_at: '2026-10-19 12:00:00'}]);
  assert.match(html, /Mistake #15/);
  assert.doesNotMatch(html, /href=|blockquote|undefined|R-null/);
});

test('Maka renders as one total, with no grade lines or invented date', () => {
  const html = ctx.coinMakaSummaryHtml(985);
  assert.equal((html.match(/<li /g) || []).length, 1);
  assert.match(html, /Maka ranks/);
  assert.match(html, /\+985/);
  assert.doesNotMatch(html, /<time|game #|Hand /);
  assert.equal(ctx.coinMakaSummaryHtml(0), '');
});

test('gain list skips explained and reported hands, ranks across games, and prepares each once', async () => {
  const candidates = Array.from({length: 12}, (_, i) => ({id: i + 1, game_id: i < 8 ? 1 : 2}));
  const loads = [];
  const hands = await ctx.findCoinGain(candidates, async id => {
    loads.push(id);
    return {rounds: [{mistakes: candidates.filter(c => c.game_id === id).map(c => ({
      id: c.id, shape: c.id < 5 ? 'speed' : 'complex', my_report: c.id === 6 ? {} : null,
    }))}]};
  }, () => true);
  assert.deepEqual(Array.from(hands, h => h.id), [5, 7, 8, 9, 10]);
  assert.deepEqual(loads, [1, 2]);
});

test('gain list stops when navigating away', async () => {
  let current = true;
  const hands = await ctx.findCoinGain([{id: 1, game_id: 2}], async () => {
    current = false;
    return {rounds: []};
  }, () => current);
  assert.equal(hands, null);
});

test('gain rows link directly to hands and escape labels', () => {
  const html = ctx.coinGainHtml([{id: 12, game_id: 2, round_name: '<East 1>', turn: 3, ev_loss: 1.55, coins: 16}]);
  assert.match(html, /href="#m12"/);
  assert.match(html, /&lt;East 1&gt;/);
  assert.match(html, /\+16/);
  assert.match(ctx.coinGainHtml([]), /No unreported complex hands/);
});
