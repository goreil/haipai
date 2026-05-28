// KillerDucky defense algorithm — extracted from
// killer_mortal_gui/index.js (MIT). The wait-enumeration / weighting /
// deal-in probability core, lifted out of GlobalState so callers pass
// state as plain args.
//
// Tile encoding: tenhou ints (suit*10 + n; 11..19 man, 21..29 pin,
// 31..39 sou, 41..47 honors). Red fives ride as 51/52/53 in
// discardsToRiichi and get normalised inside calcCombos. unseenTiles
// keys are normalised ints.
//
// The Haipai-side mjai ↔ tenhou translation and threat extraction live
// in the prep glue (Step 3), not here.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiDefenseKD = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  const WAIT_TYPE = Object.freeze({
    ryanmen: 0,
    kanchan: 1,
    penchan: 2,
    tanki: 3,
    shanpon: 4,
  });

  // Tuning weights — copied verbatim from GlobalState in upstream index.js.
  const WEIGHTS = Object.freeze({
    ryanmen: 3.5,
    honorTankiShanpon: 1.7,
    nonHonorTankiShanpon: 1.0,
    kanchan: 0.21,
    kanchanRiichiSujiTrap: 2.6,
    uraSuji: 1.3,
    matagiSujiEarly: 0.6,
    matagiSujiRiichi: 1.2,
    doraGreed: 1.2,
    akaDiscard: 0.14,
  });

  function normRedFive(t) {
    if (t < 51) return t;
    if (t === 51) return 15;
    if (t === 52) return 25;
    if (t === 53) return 35;
    return null;
  }

  function generateWaits() {
    const waits = [];
    for (const [a, b] of [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]) {
      for (let suit = 1; suit <= 3; suit++) {
        waits.push({
          type: WAIT_TYPE.ryanmen,
          tiles: [suit * 10 + a, suit * 10 + b],
          waitsOn: [suit * 10 + a - 1, suit * 10 + b + 1],
        });
      }
    }
    for (const [a, b] of [[1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8], [7, 9]]) {
      for (let suit = 1; suit <= 3; suit++) {
        waits.push({
          type: WAIT_TYPE.kanchan,
          tiles: [suit * 10 + a, suit * 10 + b],
          waitsOn: [suit * 10 + a + 1],
        });
      }
    }
    for (const [a, b, c] of [[1, 2, 3], [8, 9, 7]]) {
      for (let suit = 1; suit <= 3; suit++) {
        waits.push({
          type: WAIT_TYPE.penchan,
          tiles: [suit * 10 + a, suit * 10 + b],
          waitsOn: [suit * 10 + c],
        });
      }
    }
    for (let n = 1; n <= 9; n++) {
      for (const wtype of [WAIT_TYPE.tanki, WAIT_TYPE.shanpon]) {
        for (let suit = 1; suit <= 4; suit++) {
          if (suit === 4 && n > 7) continue;
          const tile = suit * 10 + n;
          const tiles = wtype === WAIT_TYPE.tanki ? [tile] : [tile, tile];
          waits.push({ type: wtype, tiles, waitsOn: [tile] });
        }
      }
    }
    return waits;
  }

  function calcCombos(waits, genbutsu, discardsToRiichi, unseenTiles, dora, weights) {
    weights = weights || WEIGHTS;
    const genbutsuNorm = new Set();
    for (const t of genbutsu) genbutsuNorm.add(normRedFive(t));
    const dtrNorm = discardsToRiichi.map(normRedFive);
    const riichiTile = dtrNorm.length ? dtrNorm[dtrNorm.length - 1] : null;

    const combos = { all: 0.0 };

    for (const wait of waits) {
      let skip = false;
      for (const t of wait.waitsOn) {
        if (genbutsuNorm.has(t)) { skip = true; break; }
      }
      if (skip) continue;

      let w = 1.0;
      const numUnseen = [];
      for (let i = 0; i < wait.tiles.length; i++) {
        const t = wait.tiles[i];
        const count = unseenTiles[t] || 0;
        const n = (i > 0 && wait.type === WAIT_TYPE.shanpon)
          ? Math.max(0, count - 1) : count;
        w *= n;
        numUnseen.push(n);
      }
      wait.numUnseen = numUnseen;
      if (wait.type === WAIT_TYPE.shanpon) {
        w /= wait.tiles.length;
      }

      if (wait.type === WAIT_TYPE.ryanmen) {
        let ura = false;
        for (const d of dtrNorm) {
          if (wait.tiles.includes(d)) continue;
          const m = d % 10;
          if (m >= 4 && m <= 6) {
            for (const wt of wait.tiles) {
              if (Math.abs(d - wt) === 2) { ura = true; break; }
            }
          }
          if (ura) break;
        }
        let matagiEarly = false;
        let matagiRiichi = false;
        for (const d of dtrNorm) {
          if (wait.tiles.includes(d)) {
            if (d === riichiTile) matagiRiichi = true;
            else matagiEarly = true;
          }
        }
        w *= weights.ryanmen;
        if (ura) w *= weights.uraSuji;
        if (matagiEarly) w *= weights.matagiSujiEarly;
        if (matagiRiichi) w *= weights.matagiSujiRiichi;
      } else if (wait.type === WAIT_TYPE.tanki || wait.type === WAIT_TYPE.shanpon) {
        if (wait.tiles[0] > 40) w *= weights.honorTankiShanpon;
        else w *= weights.nonHonorTankiShanpon;
      } else if (wait.type === WAIT_TYPE.kanchan) {
        const rm = riichiTile != null ? riichiTile % 10 : -1;
        if (riichiTile != null && rm >= 4 && rm <= 6
            && Math.abs(wait.waitsOn[0] - riichiTile) === 3) {
          w *= weights.kanchanRiichiSujiTrap;
        } else {
          w *= weights.kanchan;
        }
      }
      // penchan anchors at 1.0

      const involved = new Set([...wait.tiles, ...wait.waitsOn]);
      if (dora != null && involved.has(dora)) {
        w *= weights.doraGreed;
      }

      for (const d of discardsToRiichi) {
        if (d > 50 && involved.has(normRedFive(d))) {
          w *= weights.akaDiscard;
          break;
        }
      }

      combos.all += w;
      if (wait.type === WAIT_TYPE.shanpon) {
        w *= 2; // after denominator
      }
      wait.combos = w;

      for (const t of wait.waitsOn) {
        if (!combos[t]) combos[t] = { all: 0.0, types: [] };
        combos[t].all += w;
        combos[t].types.push(wait);
      }
    }

    return combos;
  }

  function dealinProbability(tile, combos) {
    const t = normRedFive(tile);
    if (combos.all <= 0 || !combos[t]) return 0.0;
    return combos[t].all / combos.all;
  }

  return {
    WAIT_TYPE,
    WEIGHTS,
    normRedFive,
    generateWaits,
    calcCombos,
    dealinProbability,
  };
}));
