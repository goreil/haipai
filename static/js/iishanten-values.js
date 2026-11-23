// Only an actual ron/tsumo score is a legal outcome. A structural no-yaku
// wait, a furiten ron, and an unevaluated branch cannot supply han or bonuses.
function _iishantenValueProfile(draw) {
  const unavailable = draw.unavailable;
  const dead = !unavailable && draw.branches.every(branch => branch.count === 0);
  const yaku = [...draw.yaku].sort((a, b) => a.name.localeCompare(b.name));
  const bonuses = [];
  let maxHan = 0, maxYakuman = 0;
  if (!unavailable && !dead) {
    let minDora = Infinity, maxDora = 0, minAka = Infinity, maxAka = 0;
    for (const branch of draw.branches) {
      for (const group of branch.groups) {
        for (const score of [group.ron, group.tsumo]) {
          if (!score) continue;
          maxHan = Math.max(maxHan, score.han);
          maxYakuman = Math.max(maxYakuman, score.yakuman);
          minDora = Math.min(minDora, score.dora);
          maxDora = Math.max(maxDora, score.dora);
          minAka = Math.min(minAka, score.aka);
          maxAka = Math.max(maxAka, score.aka);
        }
      }
    }
    for (const [name, min, max] of [['dora', minDora, maxDora], ['aka', minAka, maxAka]]) {
      if (max > 0) bonuses.push({ label: `${name} ${min === max ? max : `${min}–${max}`}`, conditional: min !== max });
    }
  }
  return { yaku, bonuses, unavailable, dead, maxHan, maxYakuman };
}

function groupIishantenValues(draws) {
  const groups = new Map();
  for (const draw of draws) {
    const profile = _iishantenValueProfile(draw);
    const key = JSON.stringify(profile);
    if (!groups.has(key)) groups.set(key, { ...profile, draws: [] });
    groups.get(key).draws.push(draw);
  }
  return [...groups.values()].sort((a, b) => a.unavailable - b.unavailable
    || b.maxYakuman - a.maxYakuman || b.maxHan - a.maxHan);
}

// All tiles in an existing Value group already share their mode scores.
// Leave the main scorer's groups and tile order untouched.
function sortIishantenWaitGroups(groups) {
  const max = (g, field) => Math.max(g.ron?.[field] || 0, g.tsumo?.[field] || 0);
  return [...groups].sort((a, b) => max(b, 'yakuman') - max(a, 'yakuman') || max(b, 'han') - max(a, 'han'));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupIishantenValues, sortIishantenWaitGroups };
}
