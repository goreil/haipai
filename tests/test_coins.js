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
