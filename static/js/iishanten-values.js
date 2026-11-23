// Only an actual ron/tsumo score is a legal outcome. A structural no-yaku
// wait, a furiten ron, and an unevaluated branch cannot supply han or bonuses.
function _iishantenValueProfile(draw) {
  const unavailable = draw.unavailable;
  const dead = !unavailable && draw.branch?.count === 0;
  const yaku = draw.yaku.filter(y => !y.name.startsWith('yakuhai'));
  let dora = null;
  let maxHan = 0, maxYakuman = 0;
  if (!unavailable && draw.branch?.groups) {
    let minDora = Infinity, maxDora = 0, minYakuhai = Infinity, maxYakuhai = 0;
    for (const group of draw.branch.groups) {
      for (const score of [group.ron, group.tsumo]) {
        if (!score) continue;
        maxHan = Math.max(maxHan, score.han);
        maxYakuman = Math.max(maxYakuman, score.yakuman);
        const total = score.dora + score.aka;
        minDora = Math.min(minDora, total);
        maxDora = Math.max(maxDora, total);
        const honors = score.yaku.filter(name => name.startsWith('yakuhai')).length;
        minYakuhai = Math.min(minYakuhai, honors);
        maxYakuhai = Math.max(maxYakuhai, honors);
      }
    }
    const range = (lo, hi) => lo === hi ? `${hi}` : `${lo}–${hi}`;
    if (maxDora) dora = { label: `dora ${range(minDora, maxDora)}`, conditional: minDora !== maxDora };
    if (maxYakuhai) yaku.push({ name: `yakuhai ${range(minYakuhai, maxYakuhai)}`, confirmed: minYakuhai === maxYakuhai });
  }
  yaku.sort((a, b) => a.name.localeCompare(b.name));
  return { yaku, dora, unavailable, dead, maxHan, maxYakuman };
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
