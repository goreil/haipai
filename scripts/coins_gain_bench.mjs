#!/usr/bin/env node
// Read-only benchmark of the single-hand search prep on a three-game sample against a local snapshot.
// Usage: node scripts/coins_gain_bench.mjs [snapshot directory]
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve, basename} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {prepReport, prepGame} = require('../static/js/prep/prep.js');
const {categorize} = require('../static/js/categorize.js');
const dir = resolve(process.argv[2] || '.cache/category-stats');
const db = new DatabaseSync(resolve(dir, 'games.db'), {readOnly:true});
const users = db.prepare('SELECT user_id FROM games GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 10').all();
const samples = [];
for (const {user_id} of users) {
  const games = db.prepare('SELECT id, mortal_file FROM games WHERE user_id=? ORDER BY id DESC LIMIT 3').all(user_id);
  const loaded = new Map();
  for (const game of games) {
    try {
      const md = JSON.parse(readFileSync(resolve(dir,'mortal_analysis',basename(game.mortal_file))));
      const rows = db.prepare('SELECT * FROM mistakes WHERE game_id=? ORDER BY round_idx, mistake_idx').all(game.id);
      loaded.set(game.id, {md, rows});
    } catch { /* Older snapshots may lack files. */ }
  }
  const candidates = [...loaded.values()].flatMap(g => g.rows).sort((a,b) => b.ev_loss-a.ev_loss || b.id-a.id);
  let count = 0, checked = 0;
  const start = performance.now();
  for (const row of candidates) {
    const m = {...JSON.parse(row.data_json), id:row.id, ev_loss:row.ev_loss, turn:row.turn};
    prepReport(m, loaded.get(row.game_id).md, row.round_idx, row.mistake_idx);
    checked++;
    if (categorize(m).shape === 'complex' && ++count === 1) break;
  }
  const boundedMs = performance.now()-start;
  const oldStart = performance.now();
  for (const {md,rows} of loaded.values()) {
    const rounds = [...new Set(rows.map(r => r.round_idx))].map(idx => ({round:rows.find(r => r.round_idx===idx).round_name,
      mistakes:rows.filter(r => r.round_idx===idx).map(r => ({...JSON.parse(r.data_json), id:r.id, turn:r.turn, ev_loss:r.ev_loss}))}));
    prepGame({rounds},md);
  }
  samples.push({games:loaded.size, checked, found:count, next_hand_ms:Math.round(boundedMs), whole_games_ms:Math.round(performance.now()-oldStart)});
}
console.log(JSON.stringify(samples,null,2));
db.close();
