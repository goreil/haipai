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

test('gain cards embed the full mistake and report funnel', () => {
  ctx.renderMistakeCard = m => `<div class="mistake">${m.id}</div>`;
  ctx.trainerBubbleHtml = m => `<div class="report-row">report ${m.id}</div>`;
  const html = ctx.coinGainHtml([{id:12, game_id:2, coins:16, mistake:{id:12}}]);
  assert.match(html, /class="mistake"/);
  assert.match(html, /class="report-row"/);
  assert.match(html, /\+16/);
});

test('worker finds one hand per Next, skips reports, pages beyond five and reuses game payloads', async () => {
  const candidates = Array.from({length:16}, (_,i) => ({id:16-i, game_id:i<8?2:1,
    round_idx:0, mistake_idx:i, ev_loss:(16-i)/10}));
  const messages = [], loads = [], preps = [];
  const worker = vm.createContext({
    importScripts: () => {},
    postMessage: message => messages.push(message),
    fetch: async url => {
      loads.push(url);
      const before = Number(new URL(url, 'https://test').searchParams.get('before')) || Infinity;
      return {ok:true, json:async () => url.includes('/coins/gain')
        ? {candidates:candidates.filter(c => c.id < before).slice(0,3)}
        : url.includes('/mortal') ? {} : {rounds:[{mistakes:candidates.map(c => ({id:c.id,
          shape:c.id>12?'obvious':'complex', my_report:c.id===10?{}:null}))}]}};
    },
    haipaiPrep: {prepReport:(m,md,ri,mi) => preps.push([m.id,ri,mi])},
    haipaiCategorize: {categorize:m => ({shape:m.shape})},
  });
  vm.runInContext(fs.readFileSync('static/js/coins-worker.js','utf8'),worker);
  assert.equal(loads.length,0, 'idle until Next requested');
  let before = null;
  for (let i=0; i<12; i++) {
    const previous = messages.filter(m => m.hand).length;
    await worker.onmessage({data:{before}});
    const hands = messages.filter(m => m.hand);
    assert.ok(hands.length-previous <= 1, 'at most one result per request');
    for (const message of messages) if (message.before) before = message.before;
  }
  assert.deepEqual(messages.filter(m => m.hand).map(m => m.hand.id),[12,11,9,8,7,6,5,4,3,2,1]);
  assert.equal(messages.at(-1).done,true);
  assert.equal(loads.filter(url => url.includes('/games/')).length,4);
  assert.equal(preps.length,15);
  assert.deepEqual(preps[0],[16,0,0]);
});

test('worker imports and runs the real prep and categorizer without browser DOM globals', async () => {
  const mortal = JSON.parse(fs.readFileSync('tests/fixtures/win_m323.json','utf8'));
  const entry = mortal.review.kyokus[0].entries[0];
  const mistake = {id:323, hand:entry.state.tehai, melds:entry.state.fuuros,
    actual:entry.actual, expected:entry.expected, draw:entry.tile, turn:entry.junme,
    ev_loss:2.42, top_actions:entry.details};
  const messages = [];
  const worker = vm.createContext({console, onmessage:null, postMessage:m => messages.push(m),
    fetch:async url => ({ok:true,json:async () => url.includes('/coins/gain')
      ? {candidates:url.includes('?') ? [] : [{id:323,game_id:1,round_idx:0,mistake_idx:0}]}
      : url.includes('/mortal') ? mortal : {rounds:[{mistakes:[mistake]}]}}),
  });
  worker.self = worker;
  worker.importScripts = (...paths) => {
    for (const path of paths) vm.runInContext(fs.readFileSync('static/js/'+path,'utf8'),worker);
  };
  vm.runInContext(fs.readFileSync('static/js/coins-worker.js','utf8'),worker);
  await worker.onmessage({data:{before:null}});
  if (!messages.at(-1)?.done) await worker.onmessage({data:{before:{id:323,ev_loss:2.42}}});
  assert.equal(messages.at(-1).done,true, JSON.stringify(messages));
  assert.equal(messages.some(m => m.error),false);
});
