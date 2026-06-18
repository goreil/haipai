// Hand partitioning — JS port of `Partition.partition` /
// `Partition._partition_single_type` from MahjongKit.py.
//
// Original work: JapaneseRiichiMahjongKit by Jianyang Tang (Thomas)
// <jian4yang2.tang1@gmail.com>. Vendored as the `MahjongKit/` git submodule
// (fork tracked at https://github.com/goreil/MahjongKit); the upstream ships
// no LICENSE file, so this port is included for attributed credit. See the
// NOTICE file at the repo root for the third-party-components summary.
//
// Splits a hand into blocks: finished melds (pon/chow), half-finished melds
// (ryanmen/penchan/kanchan/pair), and singles. Pure logic, no UI.
//
// Tile scheme: 34-form base ids 0..33 (same as `tiles34` in MahjongKit and
// `tile_id_to_base` from prep/tiles.js):
//   0..8   = 1m..9m
//   9..17  = 1p..9p
//   18..26 = 1s..9s
//   27..33 = E S W N P F C
// Red fives collapse to their base index before partitioning.
//
// A "partition" is a list of blocks; each block is a list of base ids. The
// algorithm keeps only the minimum-block-count partitions per suit, so a hand
// can still yield several partitions when a suit admits more than one minimal
// split (e.g. 2234m). `partition()` returns every such combination.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const tiles = require("./tiles.js");
    module.exports = factory(tiles);
  } else {
    root.haipaiPrepPartition = factory(root.haipaiPrepTiles);
  }
}(typeof self !== "undefined" ? self : this, function (tiles) {

  const { mjai_to_tile_id, tile_id_to_base, ID_TO_MJAI } = tiles;

  // Remove the first occurrence of `val` from `arr` in place (mirrors Python's
  // list.remove, which the upstream recursion relies on).
  function _removeFirst(arr, val) {
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1);
  }

  // Partition tiles of a single suit (a sorted ascending list of base ids
  // within one suit range) into blocks. Returns every minimal-length
  // partition. Direct port of Partition._partition_single_type.
  function _partition_single_type(t) {
    const n = t.length;

    if (n === 0) return [[]];
    // one tile, or two tiles close enough to share a half-finished meld
    if (n === 1 || (n === 2 && Math.abs(t[0] - t[1]) < 3)) return [[t.slice()]];
    // two separate tiles
    if (n === 2) return [[t.slice(0, 1), t.slice(1, 2)]];

    const res = [];
    const t0 = t[0];

    // a pon (triplet)
    if (t[0] === t[1] && t[1] === t[2]) {
      for (const rest of _partition_single_type(t.slice(3))) {
        res.push([t.slice(0, 3)].concat(rest));
      }
    }
    // a chow (run)
    if (t.includes(t0 + 1) && t.includes(t0 + 2)) {
      const rec = t.slice();
      _removeFirst(rec, t0); _removeFirst(rec, t0 + 1); _removeFirst(rec, t0 + 2);
      for (const rest of _partition_single_type(rec)) {
        res.push([[t0, t0 + 1, t0 + 2]].concat(rest));
      }
    }
    // a two-headed half-finished meld (ryanmen / penchan)
    if (t.includes(t0 + 1)) {
      const rec = t.slice();
      _removeFirst(rec, t0); _removeFirst(rec, t0 + 1);
      for (const rest of _partition_single_type(rec)) {
        res.push([[t0, t0 + 1]].concat(rest));
      }
    }
    // a dead half-finished meld (kanchan)
    if (t.includes(t0 + 2)) {
      const rec = t.slice();
      _removeFirst(rec, t0); _removeFirst(rec, t0 + 2);
      for (const rest of _partition_single_type(rec)) {
        res.push([[t0, t0 + 2]].concat(rest));
      }
    }
    // a pair
    if (t[0] === t[1]) {
      for (const rest of _partition_single_type(t.slice(2))) {
        res.push([t.slice(0, 2)].concat(rest));
      }
    }
    // a single
    for (const rest of _partition_single_type(t.slice(1))) {
      res.push([t.slice(0, 1)].concat(rest));
    }

    // keep only minimum-length partitions, de-duplicated by value
    let minLen = Infinity;
    for (const p of res) if (p.length < minLen) minLen = p.length;
    const tuned = [];
    const seen = new Set();
    for (const p of res) {
      if (p.length > minLen) continue;
      const key = JSON.stringify(p);
      if (!seen.has(key)) { seen.add(key); tuned.push(p); }
    }
    return tuned;
  }

  // Partition a full hand in 34-form into blocks across all four suits. Each
  // suit is partitioned independently; honors group by kind. Returns the
  // cartesian product of per-suit partitions (so length > 1 means the hand has
  // more than one minimal block split). Port of Partition.partition.
  function partition(tiles34) {
    const man = tiles34.filter((x) => x >= 0 && x < 9);
    const pin = tiles34.filter((x) => x >= 9 && x < 18);
    const suo = tiles34.filter((x) => x >= 18 && x < 27);
    const honors = tiles34.filter((x) => x >= 27 && x < 34);

    const pMan = _partition_single_type(man);
    const pPin = _partition_single_type(pin);
    const pSuo = _partition_single_type(suo);

    // honors: one block per distinct honor, holding all copies of that kind
    const honorBlocks = [];
    for (const k of new Set(honors)) {
      honorBlocks.push(honors.filter((h) => h === k));
    }

    const res = [];
    for (const pm of pMan) {
      for (const pp of pPin) {
        for (const ps of pSuo) {
          res.push(pm.concat(pp, ps, honorBlocks));
        }
      }
    }
    return res;
  }

  // Convert an mjai hand (e.g. ["1m","2m","5pr",...]) to a sorted 34-form base
  // id list, ready for partition().
  function mjai_hand_to_tiles34(hand) {
    return hand
      .map((t) => tile_id_to_base(mjai_to_tile_id(t)))
      .sort((a, b) => a - b);
  }

  // Map a base-id partition back onto the actual mjai hand tiles, preserving
  // red fives for rendering. Consumes from a working copy of the hand so each
  // physical tile lands in exactly one block.
  function blocks_to_mjai(blocks, hand) {
    const pool = hand.slice();
    return blocks.map((block) => block.map((baseId) => {
      const idx = pool.findIndex(
        (t) => tile_id_to_base(mjai_to_tile_id(t)) === baseId);
      if (idx >= 0) {
        const tile = pool[idx];
        pool.splice(idx, 1);
        return tile;
      }
      return ID_TO_MJAI[baseId];
    }));
  }

  // Convenience: partition an mjai hand. Returns { count, partitions, tiles34 }
  // where partitions are base-id blocks. Callers gate on `count` and map a
  // chosen partition through blocks_to_mjai for display.
  function partition_mjai_hand(hand) {
    if (!hand || !hand.length) return null;
    const tiles34 = mjai_hand_to_tiles34(hand);
    const partitions = partition(tiles34);
    return { count: partitions.length, partitions, tiles34 };
  }

  return {
    partition,
    mjai_hand_to_tiles34,
    blocks_to_mjai,
    partition_mjai_hand,
  };
}));
