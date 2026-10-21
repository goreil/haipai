// Keep expensive prep off the UI thread so the window's deadline can stop it.
importScripts(
  'prep/tiles.js', 'prep/parse.js', 'prep/shanten.js', 'prep/defense_kd.js',
  'prep/shanten_calc.js', 'prep/furiten.js', 'prep/prep-board-state.js',
  'prep/prep-board-yaku.js', 'prep/defense.js', 'prep/prep.js',
  'categorize.js', 'compare-dimensions.js'
);

// One request finds one hand. Retain only two game payloads between clicks.
const gainGames = new Map();
let gainSearching = false;
async function coinGainSearch(before) {
  if (gainSearching) return;
  gainSearching = true;
  const read = async url => {
    const response = await fetch(url);
    if (!response.ok) throw Error('Could not load hands');
    return response.json();
  };
  try {
    while (true) {
      const {candidates} = await read('/api/me/coins/gain' + (before ? `?before=${before.id}&before_ev=${before.ev_loss}` : ''));
      if (!candidates.length) { postMessage({done: true}); return; }
      for (const candidate of candidates) {
        const id = candidate.game_id;
        if (!gainGames.has(id)) {
          const payload = await Promise.all([read(`/api/games/${id}`), read(`/api/games/${id}/mortal?v=2`)]);
          gainGames.set(id, payload);
          if (gainGames.size > 2) gainGames.delete(gainGames.keys().next().value);
        }
        const [game, mortal] = gainGames.get(id);
        const mistake = game.rounds.flatMap(r => r.mistakes || []).find(m => m.id === candidate.id);
        if (mistake && !mistake.my_report) {
          haipaiPrep.prepReport(mistake, mortal, candidate.round_idx, candidate.mistake_idx);
          Object.assign(mistake, haipaiCategorize.categorize(mistake));
        }
        before = {id: candidate.id, ev_loss: candidate.ev_loss};
        if (mistake && !mistake.my_report && mistake.shape === 'complex') {
          postMessage({before, hand: {...candidate, mistake}});
          return;
        }
        postMessage({before});
      }
    }
  } catch (_) {
    postMessage({error: true});
  } finally {
    gainSearching = false;
  }
}
onmessage = ({data}) => coinGainSearch(data.before || null);
