# Hand-block engine contract (HP-01)

The pure module is `static/js/prep/hand-blocks.js`. Node exports and the browser
global `haipaiHandBlocks` have the same API. In a browser, load `prep/tiles.js`
first. This change deliberately has no application consumers: no script tag,
prep integration, comparator, explanatory text, or UI has been added.

## API

```javascript
const { createEngine, evaluateAvailability } = require('../static/js/prep/hand-blocks.js');
const engine = createEngine({ cacheSize: 64, maxConfigurations: 128 });
const structural = engine.analyzeHand({ counts, tiles, melds });
// Equivalent convenience entry point:
const same = engine.analyzeTiles(tiles, melds);
const live = evaluateAvailability(structural, unseenCopies);
```

The module also exports a default engine's `analyzeHand`, `analyzeTiles`,
`cacheInfo`, and `clearCache`, plus `countsFromTiles(tiles)`.

- `counts`: exactly 34 integers, 0–4, indexed `1m..9m, 1p..9p, 1s..9s,
  E,S,W,N,P,F,C`. Red fives are included in their base-five counts. Arrays and
  typed arrays are accepted. This is **not** a repeated-ID list, 37-entry wall,
  or the shanten solver's padded 38-entry array.
- `tiles`: optional mjai string array matching those counts exactly, preserving
  `5mr`, `5pr`, and `5sr`. Omitting it means all copies are regular tiles; red
  identity cannot be recovered from counts. Inputs are copied and sorted.
- `melds`: optional fixed meld list, default `[]`. Accept `chi`, `pon`, `ankan`,
  `kakan`, and `daiminkan`, either as `{type, tiles}` or mjai
  `{type, pai, consumed}`. These describe the final physical meld, including
  all four tiles of a kan. A kakan replaces its earlier pon; pass only the
  final meld. The stored player-fuuro kakan form is also accepted: two original
  `consumed` tiles, `previous_pon_pai` (original called tile), and `pai` (added
  fourth tile). Missing physical identities are rejected instead of guessed.
  Target/actor information is irrelevant to structure and omitted.

Physical copies across concealed tiles and fixed melds must not exceed four
per base tile or one red five per suit. Invalid meld geometry is rejected.
Concealed tile count must be at most `14 - 3 * melds.length`. Both pre-discard
and post-discard hands work; shorter fragments are permitted for analysis.
Kans occupy one set slot and retain all four physical tiles. Even an ankan
disables special-hand interpretations. Four undeclared concealed copies can
form a triplet plus a singleton, two pairs, or other suited allocations; they
are never silently made into a kan.

## Structural result

Results are deeply immutable. They contain normalized `counts`, canonical
`tiles`, `fixedMelds`, combined `totalCounts`, a canonical cache `key`, and
three independent models:

- `standard`: exact structural `shanten`, retained `configurations`,
  `totalConfigurations`, `truncated`, and `exhaustive`. Exhaustive means that
  enumeration considered every allocation, **not** that the returned sample
  contains every allocation. Check `truncated` before reasoning about absence.
- `sevenPairs`: its own shanten, unique-kind pairs, leftover physical tiles,
  and missing pair count; `null` with any fixed meld. Four identical tiles
  provide one of the seven distinct pairs, with two leftover tiles.
- `thirteenOrphans`: its own shanten, missing orphan IDs, all `possibleHeads`,
  one deterministic `headTile`, allocated blocks, and leftovers; `null` with
  any fixed meld. Surplus or off-pattern tiles remain accounted for.

The standard model does not compete with the special models for the default
interpretation. Consumers must choose which model to present or evaluate.
No overall-hand shanten, discard recommendation, legal win, scoring, yaku
advantage, safe-spare verdict, or claim about Mortal's intent is inferred.

Each standard configuration contains:

- `blocks`: concealed `sequence`, `triplet`, `pair`, `side`, `closed`, `edge`,
  or `singleton` components. `tileIndices` refer to canonical result `tiles`,
  not the original input ordering. Every concealed physical index occurs
  exactly once. Fixed melds are allocated separately in `fixedMelds`.
- Each block has exact display `tiles`, base `tileIds`, a `role`, and immediate
  `completionTileIds`. A pair is either the selected `head` or a
  `triplet_candidate`. A complete set has role `set`; a two-tile sequence
  candidate has role `set_candidate`. A singleton is a `head_candidate` when
  no head is selected, otherwise `unassigned`. These are candidates rather
  than promises that the tile will eventually serve that role.
- `headIndex`: selected concealed pair block index, or `null`; `headTile`:
  corresponding base tile ID, or `null`. Equivalent identical pairs need only
  one head assignment. Singleton head candidates do not count as a formed head.
- `completeSets`: fixed plus concealed complete sets. `occupiedSetSlots`:
  complete sets plus incomplete set candidates, capped at four.
  `missingSetSlots`: `4 - occupiedSetSlots`. `missingHead` is explicit.
  `missingSlots` sums missing set slots and the missing head.
- `candidateBlockCount`: complete sets plus pairs and two-tile sequence
  candidates, including the selected head, excluding singletons.
  `excessCandidates` counts competing set candidates beyond four set slots
  after the selected pair is reserved for the head. A headless five-candidate
  configuration can still lack a head; inspect both fields.
- Per-configuration `shanten` is
  `8 - 2*completeSets - min(setCandidates, 4-completeSets) - hasHead`.
  The standard model's shanten is the minimum over **all** configurations,
  before retention. It is structural distance, independent of dead waits.
- `outsideCompatible` checks only **formed non-singleton components**: each
  complete set/pair contains an outside tile, or an incomplete sequence can
  complete to an outside set. A fixed middle triplet, a middle pair, or a
  retained middle sequence conflicts. Singles, missing slots, discards,
  development cost, live draws, and the chanta sequence requirement are not
  evaluated. This flag is allocation evidence, never a yaku verdict; it can
  be vacuously true with no formed blocks.

For `123m 456m 789p 234s North`, the leading standard configuration has four
sets, no head, and North as `head_candidate`. It has zero shanten and a missing
head. A singleton label alone never establishes a spare tile.

## Equivalence, enumeration, and retention

Enumeration removes components from the lowest remaining base tile, in
canonical component order. It considers complete sequences, triplets, pairs,
adjacent/gapped two-tile sequences, and singles. It never crosses suit
boundaries, reuses a physical tile, or applies minimum-component suit pruning.
In particular, `112233` retains both sequences and the three-pair allocation.
Every distinct pair kind is considered as head, plus a headless allocation.
More than four complete sets cannot fit a standard plan and is rejected.

Equivalence is the multiset of base-tile components plus selected head kind.
Exchanging identical physical copies does not create another structural
interpretation. Red identity is assigned deterministically to canonical
components (regular copies first), and conserved. Enumerating red placement
permutations or choosing their scoring role is outside this contract.

Rank configurations by shanten, fewer excess candidates, fewer missing slots,
more complete sets, more geometric side waits, fewer singletons, and canonical
key. The first is a stable geometric default; rank does not imply strategic
strength, and dead side waits do not acquire strategic preference.

Retain the best configuration first, then representatives for distinct heads,
block counts, outside compatibility, and each tile's role among minimum-shanten
configurations, then fill remaining capacity in rank order. Representatives
are selected in that priority order; small limits can omit later classes.
Return retained configurations in rank order. The default limit is 128,
configurable from 1 to 4096. When truncated, consumers **must not** infer
impossibility, universal spare status, or universal yaku conflict from the
retained sample. Positive evidence must reference an actual allocation.

There is no early search cutoff: shanten and `totalConfigurations` remain exact.
Work is finite under the validated 14-equivalent-tile limit; highly ambiguous
hands still cost more. Enumeration temporarily holds the full candidate set.

## Context and caches

Structural results use an instance-local LRU keyed by canonical concealed
physical identities and fixed melds, including kan/open type. Wall state,
turn, dora, opponents, and defensive scores do not enter this cache.
The default capacity is 64 hands, configurable from 0 (disabled) to 1024.
`cacheInfo()` exposes size, capacity, hits, misses, and retention limit.
`clearCache()` clears entries and counters. No unbounded suit cache is hidden
underneath it. Equal canonical inputs return the same immutable result while
cached, permitting future actual/recommended/selected consumers to share it.

`evaluateAvailability(result, wall)` is a pure, uncached context operation.
Accept 34 unseen base counts, or the existing 37-entry wall format whose base
five slots **already include** red copies. Extra red slots are not added again.
Counts are capped by four minus concealed and fixed physical copies.

It returns rows matching retained configuration order/keys, and block order,
with completion tiles/counts, `liveCompletionCount`, and `dead`. A selected pair
head is already formed and has no completion draw; a non-head pair can become
a triplet; a singleton head candidate can become a pair. Complete sets have
no immediate completion draw. Unassigned singletons have no completion entry.
Configuration totals count the **union** of completion tile kinds, avoiding
shared-draw double counting. They are immediate component completion counts,
not full-hand ukeire, winning waits, guaranteed simultaneous improvements,
or multi-draw expected value. Reevaluate when unseen counts change.

## Validation and profiling

```bash
node --test tests/test_hand_blocks.js
node --test tests/test_*.js
.venv/bin/pytest tests/ -q
node --expose-gc scripts/hand_blocks_bench.mjs
node --expose-gc scripts/hand_blocks_bench.mjs --db .cache/category-stats/games.db
```

The standalone benchmark uses a seeded 200-hand corpus plus concrete fixtures,
reports cold and cached costs separately, stresses ambiguous hands, and measures
bounded retained heap with explicit GC when available. Data is generated or
loaded read-only; production data and raw benchmark output are not committed.

The optional database benchmark loads the design's reviewed-game sample and
runs full prep plus categorization with both WASM and JavaScript, alternating
baseline and benchmark-only post-discard analysis in three passes. It resets
structural caches per game to prevent repeated-pass cache hits from masking
cost, excludes loading/cloning, and aggregates per-game medians. No application
consumer is installed by this benchmark. It reports the snapshot hash and
sample IDs so results can be compared on the same data and hardware.

### Measurements on 2026-10-21

Node v22.22.2 on the host's Neoverse-N1 CPU, default 64-hand/128-configuration
limits, three passes:

| Standalone operation | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Uncached seeded hand | 2.90 ms | 10.42 ms | 23.63 ms |
| Cached hand (including normalization) | 0.047 ms | 0.078 ms | 5.84 ms |
| Availability over retained configurations | 0.215 ms | 0.740 ms | 9.05 ms |

Module load took 6.17 ms, engine construction 0.028 ms, and the first uncached
analysis 24.90 ms before warmup. The dense `11223344556677m` fixture enumerated
19,051 head/allocation configurations and retained 128; its median was 94.56 ms
and maximum 98.03 ms. After 200 distinct hands, the LRU held 64 entries and
retained approximately 17.2 MB of additional heap after explicit GC. This is
retained heap, not a peak-memory bound on transient exhaustive enumeration.

The optional end-to-end run used all 49 games / 2,017 decisions from the
backlog's snapshot and game-ID list, with the identical SHA-256 and no missing
games. Times below are full prep plus categorization, not cached categorization.
“With blocks” adds benchmark-only actual/recommended post-discard analysis.

| Kernel / benchmark mode | Mean/game | Median/game | p95/game | Maximum/game |
| --- | ---: | ---: | ---: | ---: |
| WASM baseline | 50.2 ms | 43.4 ms | 132.8 ms | 184.9 ms |
| WASM with blocks | 358.7 ms | 321.6 ms | 790.8 ms | 1,150.1 ms |
| JavaScript baseline | 921.2 ms | 784.3 ms | 1,943.8 ms | 2,359.7 ms |
| JavaScript with blocks | 1,075.6 ms | 957.2 ms | 2,102.1 ms | 3,609.0 ms |

**The proposed <10% WASM integration overhead target is not met.** This first
engine favors exhaustive structural correctness and explicit retention over
search pruning. Further profiling/optimization is required before eager
per-decision integration. Host timings vary; these are not mobile estimates.
No application path currently pays this cost. Browser/mobile rendering and
interaction latency remain unmeasured because no consumer or view was added.

Validation: 14 isolated engine tests pass, including 250 seeded closed/open
standard-shanten comparisons plus concrete dense/special-hand fixtures.
The targeted engine/yaku/dora/double-yakuhai run passed all 30 tests. The full
Python suite passed 303 tests; full JavaScript passed 114/115, with the existing
card browser test failing its `quiet header` assertion in `mistake-card.js`,
outside the added engine files. Repository Ruff reported 30 errors outside
the added files. JavaScript syntax checks and whitespace checks passed.
