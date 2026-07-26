# Hand Partition

**Date**: 2026-06-15
**Scope**: Adopt a hand-partition algorithm that splits a 13/14-tile hand into
melds, pairs, and single tiles, and build features on top of it.

---

## Source

Partition algorithm comes from **MahjongKit**
(https://github.com/erreurt/MahjongKit.git). It decomposes a hand into its
constituent blocks: complete melds (runs/triplets), pairs, and leftover single
tiles. We'd port / vendor this as the base primitive.

A hand can usually be partitioned in **more than one way** (e.g. `2334m` is
`23m`+`34m` or `33m`+`2m`+`4m`), so every consumer below has to decide how to
handle multiple candidate partitions — pick a canonical one, rank them, or show
all. This is the central open design question, flagged per-feature.

---

## HP-01: Visualize the partition (LOW)

Just show the decomposition of the player's hand into melds / pairs / singles
in the board/review UI.

- **Open**: how to render when multiple partitions are valid (a). Options:
  pick the partition that maximizes complete blocks, let the user toggle
  between candidates, or overlay the most "shanten-relevant" grouping.
- Lives near the existing hand/meld rendering (`static/js/board-melds.js`,
  `static/js/tiles.js`); partition compute would sit in the prep pipeline
  (`static/js/prep/`).

## HP-02: Block-counting heuristics for "Hand value" (MED)

Use the partition as the base for detecting Mortal's strategic intent, to move
cases out of the **Complex Decision** bucket and into **Hand value**:

- "Mortal wants tanyao — you already have 5 blocks for tanyao."
- "Mortal is going for honitsu" (suit/honor concentration over the partition).

This is the categorization angle: richer hand-shape understanding lets the
categorizer explain *why* a decision is about hand value rather than dumping it
into Complex Decision (P4 / D3 / OD3). Ties into the threshold/heuristic work in
[CATEGORIZATION.md](CATEGORIZATION.md) C-01 and the `categorization_vision`
memory.

- **Open**: again multiple-partition handling — block counts depend on which
  partition you commit to, so "5 blocks for tanyao" needs a defined partition
  selection rule before it's well-defined.

---

## Notes

- Categorization stays 100% client-side (REFACTOR-GUIDELINES / FINDABILITY hard
  constraint) — partition compute belongs in `static/js/prep/`, not the backend.
- `riichi-tools-rs` is already vendored as a submodule; check whether it already
  exposes a comparable decomposition before porting MahjongKit's.
