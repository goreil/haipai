#!/usr/bin/env node
// Phase 1 of ground-truth verification. Generates 13-tile hands and, for each,
// records JS and riichi(WASM) shanten + ukeire. Python (gt_compare.py) then
// adds the mahjong-library ground truth and diffs. Ukeire here = the set of
// tile kinds (count<4) whose draw lowers shanten.
//   node scripts/gt_compare_gen.mjs [N] > /tmp/gt_hands.json

import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const N = Number(process.argv[2] || 4000);

const wasm = require(join(repoRoot, "wasm/haipai-shanten/pkg/haipai_shanten.js"));        // fast_shanten
const wasmSlow = require(join(repoRoot, "wasm/haipai-shanten/pkg-slow/haipai_shanten.js")); // default kernel
const js = require(join(repoRoot, "static/js/prep/shanten.js"));

const SUIT_CH = ["m", "p", "s"];
function countsToText(c) {
  let t = "";
  for (let s = 0; s < 3; s++) { let d = ""; for (let n = 1; n <= 9; n++) for (let k = 0; k < c[s*9+(n-1)]; k++) d += n; if (d) t += d + SUIT_CH[s]; }
  let h = ""; for (let i = 0; i < 7; i++) for (let k = 0; k < c[27+i]; k++) h += (i+1); if (h) t += h + "z";
  return t;
}
// counts34 -> KD-38 for JS
function toKd(c) { const a = new Array(38).fill(0); for (let b = 0; b < 34; b++) { const id = b < 9 ? b+1 : b < 18 ? b+2 : b < 27 ? b+3 : b+4; a[id] = c[b]; } return a; }
const jsSh = (c) => js.calculateMinimumShanten(toKd(c));
function jsUke(c, sh) { const out = []; for (let t = 0; t < 34; t++) { if (c[t] >= 4) continue; c[t]++; if (jsSh(c) < sh) out.push(t); c[t]--; } return out; }

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rand = mulberry32(12345);

const out = [];
function emit(c) {
  if (c.reduce((a, b) => a + b, 0) !== 13) return; // ukeire is defined on 13-tile hands
  const sh = jsSh(c);
  if (sh < 0) return; // skip complete (13-tile can't really be -1 unless winning shape)
  const text = countsToText(c);
  const ukeOf = (mod) => { try { const r = JSON.parse(mod.ukeire_from_text(text)); const e = r.stats && r.stats[0]; return e ? e.tiles.map(([id]) => id - 1).sort((a,b)=>a-b) : []; } catch { return null; } };
  out.push({ counts: c, text, jsSh: sh, jsUke: jsUke(c.slice(), sh),
    riichiSh: wasm.shanten_from_text(text), riichiUke: ukeOf(wasm),
    slowSh: wasmSlow.shanten_from_text(text), slowUke: ukeOf(wasmSlow) });
}
// explicit divergent hands
function mk(man,pin,sou,hon){const c=new Array(34).fill(0);for(const ch of man)c[+ch-1]++;for(const ch of pin)c[9+ +ch-1]++;for(const ch of sou)c[18+ +ch-1]++;for(const ch of hon)c[27+ +ch-1]++;return c;}
emit(mk("","1144888","22","5566"));
emit(mk("455667","345","8888",""));
emit(mk("11444","111668","677",""));

while (out.length < N) {
  const c = new Array(34).fill(0); let placed = 0;
  while (placed < 13) { const b = Math.floor(rand()*34); if (c[b] < 4) { c[b]++; placed++; } }
  emit(c);
}
process.stdout.write(JSON.stringify(out));
