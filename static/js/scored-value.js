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
    let points = 0, maxPoints = 0, copies = 0;
    for (const draw of draws) {
      // Exactly the width-first branch shown on the card; a narrower cut's
      // yaku are not evidence for this draw. Known dead/no-yaku branches
      // have a zero profile, whereas a failed evaluation is unknown.
      const value = draw.branch?.profile;
      if (!value) return null;
      copies += draw.count;
      points += draw.count * value.meanPoints;
      maxPoints = Math.max(maxPoints, value.maxPoints);
      for (const name in value.yaku) yaku[name] = (yaku[name] || 0) + draw.count * value.yaku[name];
    }
    for (const name in yaku) yaku[name] /= copies;
    return { meanPoints: copies ? points / copies : 0, maxPoints, yaku };
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

  return { profile, reachRole };
}));
