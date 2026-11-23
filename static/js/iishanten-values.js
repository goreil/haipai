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

// A delta only describes this side's gains. Null does not mean the two
// results are equal: the other side can still have an additional yaku.
function _displayValue(p, other) {
  const shared = other && p.status === other.status;
  const yaku = _displayValueYaku(p, shared ? other : null);
  const doraDelta = !!shared && (p.minDora !== other.minDora || p.maxDora !== other.maxDora);
  if (shared && !yaku.length && !doraDelta) return null;
  return { yaku, additional: !!shared && yaku.length > 0,
    status: shared ? "" : p.status || (other ? "Live wait" : ""),
    doraDelta, showDora: shared ? doraDelta : p.maxDora > 0 };
}

function _valueGroupKey(p, display) {
  return display && [display.yaku, display.additional, display.status, p.unavailable, p.dead, display.doraDelta];
}

function _addValueDraw(group, draw, p, display) {
  if (!group) group = { draws: [], yaku: display.yaku, additional: display.additional, status: display.status,
    unavailable: p.unavailable, dead: p.dead, minDora: Infinity, maxDora: 0, showDora: false, maxHan: 0, maxYakuman: 0 };
  group.draws.push(draw);
  group.minDora = Math.min(group.minDora, p.minDora);
  group.maxDora = Math.max(group.maxDora, p.maxDora);
  group.showDora ||= display.showDora;
  group.maxHan = Math.max(group.maxHan, p.maxHan);
  group.maxYakuman = Math.max(group.maxYakuman, p.maxYakuman);
  return group;
}

function _finishValueGroup({ minDora, maxDora, showDora, ...g }) {
  return { ...g, dora: showDora && minDora !== Infinity ? { label: `${_valueRange(minDora, maxDora)} dora` } : null };
}

function _compareValueGroups(a, b) {
  return a.unavailable - b.unavailable || b.maxYakuman - a.maxYakuman || b.maxHan - a.maxHan;
}

function groupValueRows(rows, compareRows = null, describe = row => row) {
  const peers = new Map(compareRows?.map(row => [row.tile, _drawValueProfile(describe(row))]));
  const groups = new Map();
  for (const row of rows) {
    const p = _drawValueProfile(describe(row)), display = _displayValue(p, peers.get(row.tile));
    if (!display) continue;
    const key = JSON.stringify(_valueGroupKey(p, display));
    groups.set(key, _addValueDraw(groups.get(key), row, p, display));
  }
  return Array.from(groups.values(), _finishValueGroup).sort(_compareValueGroups);
}

function _describeIishanten(draw) {
  return { yaku: draw.yaku, unavailable: draw.unavailable, dead: !draw.unavailable && draw.branch?.count === 0,
    groups: draw.branch?.groups };
}

function groupIishantenValues(draws) {
  return groupValueRows(draws, null, _describeIishanten);
}

function compareIishantenValues(leftDraws, rightDraws, full = false) {
  const rightByTile = new Map(rightDraws.map(draw => [draw.tile, draw]));
  const leftOnly = [], pairs = new Map();
  let equalCount = 0;
  for (const left of leftDraws) {
    const right = rightByTile.get(left.tile);
    if (!right) {
      leftOnly.push(left);
      continue;
    }
    rightByTile.delete(left.tile);
    const p = _drawValueProfile(_describeIishanten(left)), q = _drawValueProfile(_describeIishanten(right));
    let a = _displayValue(p, q), b = _displayValue(q, p);
    if (!a && !b) {
      equalCount += Math.min(left.count, right.count);
      if (!full) continue;
    }
    if (full) {
      a = _displayValue(p, null);
      b = _displayValue(q, null);
    }
    // Partition on BOTH badges before combining ranges. Never mix equal
    // bonuses with differing ones, or cancel differences in opposite directions.
    const key = JSON.stringify([_valueGroupKey(p, a), _valueGroupKey(q, b),
      Math.sign(p.minDora - q.minDora) || 0, Math.sign(p.maxDora - q.maxDora)]);
    let pair = pairs.get(key);
    if (!pair) pairs.set(key, pair = [null, null]);
    if (a) pair[0] = _addValueDraw(pair[0], left, p, a);
    if (b) pair[1] = _addValueDraw(pair[1], right, q, b);
  }
  const rows = Array.from(pairs.values(), pair => pair.map(g => g && _finishValueGroup(g)));
  rows.sort(([a, b], [c, d]) => _compareValueGroups(a ?? b, c ?? d));
  const leftGroups = groupIishantenValues(leftOnly), rightGroups = groupIishantenValues([...rightByTile.values()]);
  for (let i = 0; i < Math.max(leftGroups.length, rightGroups.length); i++) {
    rows.push([leftGroups[i] ?? null, rightGroups[i] ?? null]);
  }
  return { equalCount, rows };
}

// All tiles in an existing Value group already share their mode scores.
// Leave the main scorer's groups and tile order untouched.
function sortIishantenWaitGroups(groups) {
  const max = (g, field) => Math.max(g.ron?.[field] || 0, g.tsumo?.[field] || 0);
  return [...groups].sort((a, b) => max(b, 'yakuman') - max(a, 'yakuman') || max(b, 'han') - max(a, 'han'));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupValueRows, groupIishantenValues, compareIishantenValues, sortIishantenWaitGroups };
}
