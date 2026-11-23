const _valueRange = (lo, hi) => lo === hi ? `${hi}` : `${lo}–${hi}`;

// Ranges describe legal wins, not all tiles in the hand. In particular a
// no-yaku completion, a furiten ron and a dead wait cannot contribute dora.
function _drawValueProfile({ yaku, groups, dead = false, unavailable = false, status = "" }) {
  let minDora = Infinity, maxDora = 0, minYakuhai = Infinity, maxYakuhai = 0;
  let maxHan = 0, maxYakuman = 0;
  if (!unavailable && !dead && groups) {
    for (const group of groups) {
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
  }
  if (unavailable) status = "Value unavailable";
  else if (dead) status = "No unseen winning tiles";
  else if (!status) {
    if (minDora === Infinity) status = "No yaku";
    else if (groups.some(g => g.furiten)) status = "Furiten · tsumo only";
    else if (groups.every(g => !g.ron)) status = "No yaku on ron";
    else if (groups.some(g => !g.ron)) status = "No yaku on some ron waits";
  }
  return { yaku, status, dead, unavailable, minDora, maxDora,
    minYakuhai: maxYakuhai ? minYakuhai : 0, maxYakuhai, maxHan, maxYakuman };
}

function _displayValueYaku(profile, other) {
  const yaku = profile.yaku.filter(y => !y.name.startsWith('yakuhai')
    && !other?.yaku.some(o => o.name === y.name && (o.confirmed || !y.confirmed)));
  // Count value honors per win rather than adding up names on mutually
  // exclusive waits. Display the actual count on this side when either end
  // improves: subtracting two ranges would imply the wins were paired.
  const { minYakuhai, maxYakuhai } = profile;
  if (minYakuhai > (other?.minYakuhai ?? 0) || maxYakuhai > (other?.maxYakuhai ?? 0)) {
    yaku.push({ name: `yakuhai ${_valueRange(minYakuhai, maxYakuhai)}`, confirmed: minYakuhai === maxYakuhai });
  }
  return yaku.sort((a, b) => a.name.localeCompare(b.name));
}

// Compare the same physical tile (red and regular fives stay distinct) BEFORE
// grouping. A shared tile only contributes this side's gains; the other pick
// reports its own. A changed win status or a unique tile gets its full row.
function groupValueRows(rows, compareRows = null, describe = row => row) {
  const peers = new Map(compareRows?.map(row => [row.tile, _drawValueProfile(describe(row))]));
  const groups = new Map();
  for (const row of rows) {
    const p = _drawValueProfile(describe(row)), other = peers.get(row.tile);
    const shared = other && p.status === other.status;
    const yaku = _displayValueYaku(p, shared ? other : null);
    const showDora = shared ? p.minDora !== other.minDora || p.maxDora !== other.maxDora : p.maxDora > 0;
    if (shared && !yaku.length && !showDora) continue;
    const status = shared ? "" : p.status || (other ? "Live wait" : "");
    const additional = !!shared && yaku.length > 0;
    // Only differing bonuses belong on a shared tile's delta. Full rows,
    // however, combine zero and positive bonuses into one displayed range.
    const key = JSON.stringify([yaku, additional, status, p.unavailable, p.dead, !!shared && showDora]);
    if (!groups.has(key)) groups.set(key, { draws: [], yaku, additional, status, unavailable: p.unavailable,
      dead: p.dead, minDora: Infinity, maxDora: 0, showDora: false, maxHan: 0, maxYakuman: 0 });
    const group = groups.get(key);
    group.draws.push(row);
    group.minDora = Math.min(group.minDora, p.minDora);
    group.maxDora = Math.max(group.maxDora, p.maxDora);
    group.showDora ||= showDora;
    group.maxHan = Math.max(group.maxHan, p.maxHan);
    group.maxYakuman = Math.max(group.maxYakuman, p.maxYakuman);
  }
  return [...groups.values()].map(({ minDora, maxDora, showDora, ...g }) => ({
    ...g, dora: showDora && minDora !== Infinity ? { label: `${_valueRange(minDora, maxDora)} dora` } : null,
  })).sort((a, b) => a.unavailable - b.unavailable || b.maxYakuman - a.maxYakuman || b.maxHan - a.maxHan);
}

function groupIishantenValues(draws, compareDraws = null) {
  return groupValueRows(draws, compareDraws, draw => ({
    yaku: draw.yaku, unavailable: draw.unavailable, dead: !draw.unavailable && draw.branch?.count === 0,
    groups: draw.branch?.groups,
  }));
}

// All tiles in an existing Value group already share their mode scores.
// Leave the main scorer's groups and tile order untouched.
function sortIishantenWaitGroups(groups) {
  const max = (g, field) => Math.max(g.ron?.[field] || 0, g.tsumo?.[field] || 0);
  return [...groups].sort((a, b) => max(b, 'yakuman') - max(a, 'yakuman') || max(b, 'han') - max(a, 'han'));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupValueRows, groupIishantenValues, sortIishantenWaitGroups };
}
