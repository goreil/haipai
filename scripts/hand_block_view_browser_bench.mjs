#!/usr/bin/env node
// Real-clock HP-02 desktop/mobile interaction measurements, no production data.
// node scripts/hand_block_view_browser_bench.mjs [--cpu-rate 4]
// CPU throttling is a simulation, not a physical mobile-device measurement.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'haipai-block-view-bench-'));
const args = process.argv.slice(2);
const rate = Number(args.includes('--cpu-rate') ? args[args.indexOf('--cpu-rate') + 1] : 1);
if (!Number.isFinite(rate) || rate < 1) throw new Error('CPU rate must be >= 1');
const index = readFileSync(join(root, 'static/index.html'), 'utf8');
const scripts = [...index.matchAll(/<script src="(\/static\/js\/[^\"]+)"/g)].map(m => m[1]);
scripts.splice(scripts.indexOf('/static/js/mistake-card.js') + 1);
const base = JSON.parse(readFileSync(join(root, 'tests/fixtures/dora_acceptance_m35078.json')));
const hands = JSON.parse(readFileSync(join(root, 'tests/fixtures/hand_blocks.json')));
writeFileSync(join(dir, 'bench.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${['theme','game-detail','board-display','hand-blocks'].map(n => `<link rel="stylesheet" href="file://${root}/static/style-${n}.css">`).join('')}
<style>body{padding:16px}main{max-width:920px;margin:auto}</style><main></main>
${scripts.map(src => `<script src="file://${root}${src}"></script>`).join('')}
<script>
window.state={readOnly:false};
tileSrc=t=>'file://${root}/riichi-mahjong-tiles/Regular/'+(TILE_FILE[t]||'Back')+'.svg';
window.runBench=async()=>{
  const base=${JSON.stringify(base)}, hands=${JSON.stringify(hands)};
  const samples=[['reviewed',base.hand,base.actual.pai,base.expected.pai],
    ['sixBlocks',hands.sixBlocks,'1m','9s'],['dense',hands.dense,'7m','5mr']];
  const paint=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const untilReady=panel=>new Promise(resolve=>{
    const observer=new MutationObserver(()=>{
      if(panel.querySelector('.hand-block')){observer.disconnect();resolve();}
    }); observer.observe(panel,{subtree:true,childList:true});
  });
  const rows=[];
  for(const [name,hand,actual,expected] of samples)for(let rep=-1;rep<3;rep++){
    const m={...base,hand,actual:{type:'dahai',pai:actual},expected:{type:'dahai',pai:expected},ev_loss:0.5,
      top_actions:[{action:{type:'dahai',pai:actual},q_value:1},{action:{type:'dahai',pai:expected},q_value:2}]};
    haipaiBlockViewPrep.clearCache();
    const host=document.querySelector('main');
    const prep=window.haipaiBlockViewPrep;
    window.haipaiBlockViewPrep=undefined;
    let start=performance.now();host.innerHTML=renderMistakeCard(m);const baselineRenderMs=performance.now()-start;
    window.haipaiBlockViewPrep=prep;
    start=performance.now();host.innerHTML=renderMistakeCard(m);const collapsedRenderMs=performance.now()-start;
    const panel=host.querySelector('.hand-row');
    let ready=untilReady(panel);start=performance.now();panel.querySelector('.block-view-toggle').click();
    await ready;const coldComputeRenderMs=performance.now()-start;await paint();const coldPaintMs=performance.now()-start;
    start=performance.now();panel.querySelector('.block-view-next').click();
    const alternativeMs=performance.now()-start;
    panel.querySelector('.block-view-toggle').click();
    start=performance.now();panel.querySelector('.block-view-toggle').click();
    const cachedToggleMs=performance.now()-start;await paint();
    if(rep>=0)rows.push({name,rep,baselineRenderMs,collapsedRenderMs,coldComputeRenderMs,coldPaintMs,alternativeMs,cachedToggleMs,
      cache:prep.cacheInfo(),overflow:document.documentElement.scrollWidth>innerWidth});
  }
  return rows;
};</script>`);
let browser, ws;
try {
  browser = spawn('chromium', ['--headless','--no-sandbox','--disable-gpu','--no-proxy-server',
    '--disable-background-networking','--allow-file-access-from-files','--remote-debugging-port=0',
    `--user-data-dir=${dir}/profile`, 'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = '';
    browser.stderr.on('data', d => { stderr += d; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    browser.on('exit', code => reject(new Error('Chromium exited ' + code)));
    browser.on('error', reject);
  });
  const targets = await (await fetch(new URL(endpoint).origin.replace('ws:', 'http:') + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const p = pending.get(message.id); pending.delete(message.id);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, {resolve,reject}); ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Page.enable');
  const loaded = new Promise(resolve => {
    ws.addEventListener('message', e => { if (JSON.parse(e.data).method === 'Page.loadEventFired') resolve(); });
  });
  await call('Page.navigate', {url:`file://${dir}/bench.html`}); await loaded;
  await call('Emulation.setCPUThrottlingRate', {rate});
  const results = {};
  for (const width of [1100,390]) {
    await call('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:width<600});
    results[width] = await evaluate('window.runBench()');
  }
  console.log(JSON.stringify({userAgent:await evaluate('navigator.userAgent'),cpuRate:rate,results},null,2));
} finally { ws?.close(); browser?.kill(); rmSync(dir,{recursive:true,force:true}); }
