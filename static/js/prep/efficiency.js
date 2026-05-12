// Ukeire (acceptance) calculator — extracted from
// killer_mortal_gui/efficiency.js (MIT). Same array format as shanten.js
// (38-element, 1-indexed, suit padding at 0/10/20/30).
//
// Drops upstream's discord-bot wrapper and the createUkeireGroups /
// filterBadUkeire / sortGroups / calculateUkeireUpgrades helpers — those
// are for human-readable output, not the per-discard stats we ship to the
// categorizer.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiEfficiency = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  function calculateUkeire(hand, remainingTiles, shantenFunction, baseShanten = -2) {
    const convertedHand = hand.slice();
    const convertedTiles = remainingTiles.slice();

    if (baseShanten === -2) {
      baseShanten = shantenFunction(convertedHand);
    }

    let value = 0;
    const tiles = [];

    let hasManzu = false;
    let hasPinzu = false;
    let hasSouzu = false;

    for (let i = 1; i < 10; i++) {
      if (hand[i] > 0) hasManzu = true;
      if (hand[i + 10] > 0) hasPinzu = true;
      if (hand[i + 20] > 0) hasSouzu = true;
    }

    for (let addedTile = 1; addedTile < convertedHand.length; addedTile++) {
      if (remainingTiles[addedTile] === 0) continue;
      if (addedTile % 10 === 0) continue;
      if (!hasManzu && addedTile > 1 && addedTile < 9) continue;
      if (!hasPinzu && addedTile > 11 && addedTile < 19) continue;
      if (!hasSouzu && addedTile > 21 && addedTile < 29) continue;

      convertedHand[addedTile]++;

      if (shantenFunction(convertedHand, baseShanten - 1) < baseShanten) {
        value += convertedTiles[addedTile];
        tiles.push(addedTile);
      }

      convertedHand[addedTile]--;
    }

    return { value, tiles };
  }

  function calculateDiscardUkeire(hand, remainingTiles, shantenFunction, baseShanten = -2) {
    const results = Array(hand.length).fill(0);
    const convertedHand = hand.slice();

    if (baseShanten === -2) {
      baseShanten = shantenFunction(convertedHand);
    }

    for (let handIndex = 0; handIndex < convertedHand.length; handIndex++) {
      if (convertedHand[handIndex] === 0) {
        results[handIndex] = { value: 0, tiles: [] };
        continue;
      }

      convertedHand[handIndex]--;
      const ukeire = calculateUkeire(convertedHand, remainingTiles, shantenFunction, baseShanten);
      convertedHand[handIndex]++;

      results[handIndex] = ukeire;
    }

    return results;
  }

  return {
    calculateUkeire,
    calculateDiscardUkeire,
  };
}));
