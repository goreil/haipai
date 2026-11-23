// Quantitative summaries of the Value tab's actual score rows, not hand EV.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./bad-riichi-bars.js'), require('./iishanten.js'));
  } else {
    root.haipaiScoredValue = factory(root, root);
  }
}(globalThis, function ({ evalDiscardScores, profileWaitScores, scoringDiscardRiver }, { analyzeIishanten }) {
  const cache = new WeakMap();

  // A reach-vs-dahai choice has a declaration and a dama alternative. A
  // discard made as part of an agreed declaration has no dama alternative.
  function reachRole(m, side, shanten) {
    if (side === 'actual' && m.passed_win && /[rw]/.test(m.win_context?.flags || '')) return 'riichi';
    const actual = m.actual?.type, expected = m.expected?.type;
    if ((actual === 'reach' && expected === 'dahai') || (expected === 'reach' && actual === 'dahai')) {
      if (m[side]?.type === 'reach') return 'riichi';
      return shanten === 0 && (side === 'actual' || side === 'expected') ? 'dama' : null;
    }
    return m.riichi_decision && shanten === 0 ? 'riichi' : null;
  }

  function drawProfile(draws) {
    if (!draws) return null;
    const yaku = {};
    let points = 0, waitValue = 0, maxPoints = 0, copies = 0;
    let minWait = Infinity, maxWait = 0;
    for (const draw of draws) {
      // Exactly the width-first branch shown on the card; a narrower cut's
      // yaku are not evidence for this draw. Known dead/no-yaku branches
      // have a zero profile, whereas a failed evaluation is unknown.
      const value = draw.branch?.profile;
      if (!value) return null;
      copies += draw.count;
      points += draw.count * value.meanPoints;
      waitValue += draw.count * value.waitValue;
      minWait = Math.min(minWait, value.minWait);
      maxWait = Math.max(maxWait, value.maxWait);
      maxPoints = Math.max(maxPoints, value.maxPoints);
      for (const name in value.yaku) yaku[name] = (yaku[name] || 0) + draw.count * value.yaku[name];
    }
    for (const name in yaku) yaku[name] /= copies;
    return { waitValue: copies ? waitValue / copies : 0, minWait: copies ? minWait : 0, maxWait,
      meanPoints: copies ? points / copies : 0, maxPoints, yaku };
  }

  function profile(m, discardTile, stat, riichi = false) {
    if (!m || (stat?.shanten !== 0 && stat?.shanten !== 1) || !stat.necessary_tiles?.length) return null;
    const key = (stat.shanten === 0 && riichi ? 'riichi:' : '') + discardTile;
    let cached = cache.get(m);
    const hit = cached?.get(key);
    if (hit?.stat === stat) return hit.result;
    let result;
    if (stat.shanten === 1) {
      result = drawProfile(analyzeIishanten(m, discardTile, stat));
    } else {
      if (!scoringDiscardRiver(m, discardTile, stat) || stat.necessary_tiles.some(w =>
        !Number.isInteger(w.count) || w.count < 0 || w.count > 4 || w.aka_count != null &&
        (!Number.isInteger(w.aka_count) || w.aka_count < 0 || w.aka_count > Math.min(1, w.count)))) return null;
      result = profileWaitScores(evalDiscardScores(m, discardTile, stat.necessary_tiles, riichi));
    }
    if (result) {
      if (!cached) cache.set(m, cached = new Map());
      cached.set(key, { stat, result });
    }
    return result;
  }

  const fmt = n => n.toLocaleString();
  const calcHeading = {
    waitValue: 'Unseen copies × (ron + tsumo) ÷ 2',
    meanPoints: 'Unseen copies × legal win points ÷ legal wins',
  };

  // Use physical copies, not score rows: identical payouts can have different
  // yaku (and thus different rows). A blocked method is zero for Wait value,
  // but is absent from both the numerator and denominator for Average.
  function waitCalculation(groups, metric) {
    const average = metric === 'meanPoints';
    const pairs = new Map();
    for (const group of groups) {
      const count = group.tiles.reduce((n, t) => n + t.count, 0);
      if (!count || (average && !group.ron && !group.tsumo)) continue;
      const ron = group.ron?.ten || 0, tsumo = group.tsumo?.ten || 0;
      const key = `${ron}:${tsumo}`;
      const pair = pairs.get(key);
      if (pair) pair.count += count;
      else pairs.set(key, { count, ron, tsumo });
    }
    if (!pairs.size) {
      return { equation: average ? '0 legal wins → 0' : '0 live copies → 0', exact: '0' };
    }
    const terms = [];
    let numerator = 0, legalWins = 0;
    for (const { count, ron, tsumo } of [...pairs.values()].sort((a, b) => a.ron - b.ron || a.tsumo - b.tsumo)) {
      const payout = average && (!ron || !tsumo) ? fmt(ron || tsumo) : `(${fmt(ron)} + ${fmt(tsumo)})`;
      terms.push(`${count} × ${payout}`);
      numerator += count * (ron + tsumo);
      legalWins += count * (Number(ron > 0) + Number(tsumo > 0));
    }
    const divisor = average ? legalWins : 2;
    const sum = terms.length === 1 ? terms[0] : `(${terms.join(' + ')})`;
    // This exact value is also an operand in the outer (draw-copy) average.
    const exact = numerator % divisor ? `${fmt(numerator)}/${divisor}` : fmt(numerator / divisor);
    return { equation: `${sum} ÷ ${divisor} = ${exact}`, exact };
  }

  function projectedWaitCalculation(draws, result) {
    if (!draws.length) return '0 unseen improving draws → 0';
    const details = new Map(), weights = new Map();
    let copies = 0;
    for (const draw of draws) {
      const { equation, exact } = waitCalculation(draw.branch.groups, 'waitValue');
      if (!details.has(equation)) details.set(equation, []);
      details.get(equation).push(`${draw.tile} × ${draw.count}`);
      weights.set(exact, (weights.get(exact) || 0) + draw.count);
      copies += draw.count;
    }
    const lines = [calcHeading.waitValue];
    for (const [equation, draws] of details) lines.push(`${draws.join(', ')}: ${equation}`);
    const terms = Array.from(weights, ([value, n]) => `${n} × ${value.includes('/') ? `(${value})` : value}`);
    lines.push(`By draw copies: (${terms.join(' + ')}) ÷ ${copies} ${Number.isInteger(result) ? '=' : '≈'} ${fmt(Math.round(result))}`);
    return lines.join('\n');
  }

  function calculations(m, discardTile, stat, riichi, value) {
    if (!value) return null;
    const result = {};
    if (stat.shanten === 1) {
      const draws = analyzeIishanten(m, discardTile, stat);
      if (!draws || draws.some(d => !d.branch?.groups)) return null;
      result.waitValue = projectedWaitCalculation(draws, value.waitValue);
    } else {
      const groups = evalDiscardScores(m, discardTile, stat.necessary_tiles, riichi);
      if (!groups) return null;
      for (const metric of Object.keys(calcHeading)) {
        const { equation } = waitCalculation(groups, metric);
        const rounded = Number.isInteger(value[metric]) ? '' : ` ≈ ${fmt(Math.round(value[metric]))}`;
        result[metric] = `${calcHeading[metric]}\n${equation}${rounded}`;
      }
    }
    return result;
  }

  return { profile, reachRole, calculations };
}));
