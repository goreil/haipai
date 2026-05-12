// Shanten calculator — extracted from killer_mortal_gui/shanten.js (MIT,
// upstream is the same source that lib/shanten.py / the `mahjong` package
// originate from). Pure logic, no UI.
//
// Hand format: 38-element Uint8/number array indexed 1..37.
//   1..9   = 1m..9m
//   11..19 = 1p..9p
//   21..29 = 1s..9s
//   31..37 = E S W N P F C
//   index 0 and 10/20/30 are padding so suit math (i < 30, i + 1, i + 2)
//   stays inside one suit.
//
// Red fives collapse to their non-red index when counting shanten.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiShanten = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  let hand = new Array(38);
  let completeSets;
  let pair;
  let partialSets;
  let bestShanten;
  let minimumShanten;
  let hasGivenMinimum;

  function calculateMinimumShanten(handToCheck, minShanten = -2) {
    const chiitoiShanten = calculateChiitoitsuShanten(handToCheck);
    if (chiitoiShanten < 0) return chiitoiShanten;

    const kokushiShanten = calculateKokushiShanten(handToCheck);
    if (kokushiShanten < 3) return kokushiShanten;

    const standardShanten = calculateStandardShanten(handToCheck, minShanten);
    return Math.min(standardShanten, chiitoiShanten, kokushiShanten);
  }

  function calculateChiitoitsuShanten(handToCheck) {
    // Adds a (7 - uniqueTiles) penalty when the hand has fewer than 7
    // distinct kinds. The Python `mahjong` library uses a simpler
    // `6 - pair_count` formula that is over-optimistic for concentrated
    // hands (6 pairs spanning only 6 kinds reports tenpai instead of
    // 1-shanten). We keep the upstream KD formula because the JS prep
    // is the new source of truth; the parity fixture is re-snapshotted
    // to match.
    hand = handToCheck.slice();
    let pairCount = 0, uniqueTiles = 0;
    for (let i = 1; i < hand.length; i++) {
      if (hand[i] === 0) continue;
      uniqueTiles++;
      if (hand[i] >= 2) pairCount++;
    }
    let shanten = 6 - pairCount;
    if (uniqueTiles < 7) shanten += 7 - uniqueTiles;
    return shanten;
  }

  function calculateKokushiShanten(handToCheck) {
    let uniqueTiles = 0;
    let hasPair = 0;
    for (let i = 1; i < handToCheck.length; i++) {
      if (i % 10 === 1 || i % 10 === 9 || i > 30) {
        if (handToCheck[i] !== 0) {
          uniqueTiles++;
          if (handToCheck[i] >= 2) hasPair = 1;
        }
      }
    }
    return 13 - uniqueTiles - hasPair;
  }

  function calculateStandardShanten(handToCheck, minShanten_ = -2) {
    hand = handToCheck.slice();
    hasGivenMinimum = true;
    minimumShanten = minShanten_;
    completeSets = 0;
    pair = 0;
    partialSets = 0;
    bestShanten = 8;

    if (minShanten_ === -2) {
      hasGivenMinimum = false;
      minimumShanten = -1;
    }

    for (let i = 1; i < hand.length; i++) {
      if (hand[i] >= 2) {
        pair++;
        hand[i] -= 2;
        removeCompletedSets(1);
        hand[i] += 2;
        pair--;
      }
    }

    removeCompletedSets(1);
    return bestShanten;
  }

  function removeCompletedSets(i) {
    if (bestShanten <= minimumShanten) return;
    for (; i < hand.length && hand[i] === 0; i++) { }

    if (i >= hand.length) {
      removePotentialSets(1);
      return;
    }

    if (hand[i] >= 3) {
      completeSets++;
      hand[i] -= 3;
      removeCompletedSets(i);
      hand[i] += 3;
      completeSets--;
    }

    if (i < 30 && hand[i + 1] !== 0 && hand[i + 2] !== 0) {
      completeSets++;
      hand[i]--; hand[i + 1]--; hand[i + 2]--;
      removeCompletedSets(i);
      hand[i]++; hand[i + 1]++; hand[i + 2]++;
      completeSets--;
    }

    removeCompletedSets(i + 1);
  }

  function removePotentialSets(i) {
    if (bestShanten <= minimumShanten) return;
    if (hasGivenMinimum && completeSets < 3 - minimumShanten) return;

    for (; i < hand.length && hand[i] === 0; i++) { }

    if (i >= hand.length) {
      const currentShanten = 8 - (completeSets * 2) - partialSets - pair;
      if (currentShanten < bestShanten) bestShanten = currentShanten;
      return;
    }

    if (completeSets + partialSets < 4) {
      if (hand[i] === 2) {
        partialSets++;
        hand[i] -= 2;
        removePotentialSets(i);
        hand[i] += 2;
        partialSets--;
      }

      if (i < 30 && hand[i + 1] !== 0) {
        partialSets++;
        hand[i]--; hand[i + 1]--;
        removePotentialSets(i);
        hand[i]++; hand[i + 1]++;
        partialSets--;
      }

      if (i < 30 && i % 10 <= 8 && hand[i + 2] !== 0) {
        partialSets++;
        hand[i]--; hand[i + 2]--;
        removePotentialSets(i);
        hand[i]++; hand[i + 2]++;
        partialSets--;
      }
    }

    removePotentialSets(i + 1);
  }

  return {
    calculateMinimumShanten,
    calculateStandardShanten,
  };
}));
