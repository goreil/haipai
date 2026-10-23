# Hand Partition: Five-Block and Six-Block Analysis

**Created**: 2026-06-15

**Updated**: 2026-10-23

**Status**: HP-01 and HP-02 done. HP-03 and HP-04 comparison consumers,
and HP-05 engine/distribution refinement, remain pending.
See [the engine contract](../hand-blocks.md) for API, retention and profiling.
The proposed WASM integration overhead target is not met; optimize before
eager per-decision integration.

**Scope**: A shared client-side decomposition engine, a beginner-facing block
view, and subsequent improvements to structural explanations.

## Goal

Represent a hand as complete sets, pairs, incomplete sets and leftover tiles,
while retaining meaningful alternative configurations. Use the same structural
evidence in the hand view, discard comparison, feature pills and explanation
text. Make missing blocks, weak waits and genuine spare tiles explicit.

The current shanten/ukeire engine already reasons about groups internally.
Keep it as the numerical foundation; this project adds reusable structural
evidence. Decomposition alone does not establish Mortal's intent, future tile
safety, or an eventual scoring advantage.

## Findings from the current implementation

- `static/js/prep/prep.js` prepares each reviewed decision. The browser normally
  uses the WASM shanten adapter, with JavaScript fallback. Its output includes
  per-discard shanten and ukeire but no reusable block configurations.
- `static/js/compare-dimensions.js` is already the shared comparator used by
  categorization and feature pills. Extend its inputs rather than creating a
  separate explanation engine.
- `versatility_kept` compares retained tile ranks at tied shanten and ukeire:
  3–7 > 2/8 > terminals > honors. It does not establish that the tile is a
  floater, that blocks are missing, or that a block needs improvement.
- `safe_spare_kept` checks tied shanten/ukeire, turn >= 6, no active threat, and
  a safety score based on rank and visible copies. It does not establish that
  the tile is spare or that the remaining blocks are strong enough.
- Chanta, ittsu and honitsu concentration heuristics are currently suppressed
  before tenpai. A displayed advantage requires a verified live completed
  shape that the other choice does not also retain. Preserve these safeguards;
  early-hand yaku analysis needs additional evidence before becoming visible.
- Opponent yaku panels in `prep-board-yaku.js` use exposed information. Our hand
  decomposition must not imply knowledge of opponents' concealed tiles.

### Concrete safe-spare reproduction

Use this closed 14-tile hand, turn 8, no active threat, with three unseen copies
of both `5p` and North:

```text
123m | 456m | 789p | 234s | 5p | North
```

Discarding either candidate produces tenpai with three winning tiles. The
current comparator awards keeping North a `safe_spare_kept` advantage. North
is actually the only remaining pair-wait tile, not a spare. Preserve this as a
standalone regression case when implementing the structural gate.

### Chanta requires examining alternatives

A `33` head or retained `333` set is incompatible with chanta. Their presence
in concealed tile counts does not exclude chanta across all configurations:
`112233` can form two `123` sequences, and concealed tiles can be discarded or
regrouped. A fixed called `333` does exclude chanta; current code already checks
contradictory fixed melds.

For completed hands, check whether a qualifying complete decomposition exists.
For incomplete hands, distinguish an incompatible configuration from an
impossible yaku and from a possible but costly development path. Do not display
an early-hand yaku advantage solely because a compatible grouping exists.

## Reference implementation assessment

Reference: [MahjongKit Partition](https://github.com/erreurt/MahjongKit/blob/master/MahjongKit.py),
also present locally in `MahjongKit/MahjongKit.py`.

Its recursive suit decomposition is useful inspiration, but should not be
ported unchanged:

- It retains only minimum-component partitions within each suit. For example,
  `112233m` returns two sequences and omits the three-pair interpretation.
  This pruning can remove strategically relevant alternatives.
- Four identical concealed honors become one four-tile component. Distinguish
  a declared kan from four concealed copies that can be regrouped.
- Ordering affects results. Normalize inputs explicitly. Its `tiles34` argument
  is a list of repeated tile IDs, not a 34-entry count array.
- It supplies no head assignments, live completion counts or strategic ranking.

The vendored `riichi-tools-rs/src/riichi/shape_finder.rs` searches completed hand
shapes and rejects hands with fewer than 14 tiles. It is not a ready general
incomplete-hand partitioner. The current WASM wrapper exposes numerical
shanten/ukeire operations, not these partitions.

## Proposed structural model

Keep computation client-side, with a pure module under `static/js/prep/`
(proposed filename: `hand-blocks.js`). JavaScript is the initial candidate;
decide whether native/WASM work is necessary from profiling.

### Inputs and outputs

Accept normalized concealed counts and fixed melds; retain original tile
identities for red-five display and value. Support pre-discard and post-discard
hands, open hands and declared kans. Each configuration should expose:

- Complete sequences and triplets, with fixed melds identified separately.
  A declared kan occupies one set slot despite having four physical tiles.
- Pairs with possible roles: head or incomplete triplet candidate.
- Two-tile incomplete sequences classified as side, closed or edge waits.
- Singletons, including candidates for building missing blocks.
- Tile allocation, selected head role, occupied set slots, missing slots,
  candidate block count and excess candidates.
- Enough information to compare compound/overlapping shapes such as `2334`
  and `344` through alternative allocations.

Account for every physical tile exactly once per configuration. Alternatives
may interpret a shape differently but must not reuse a tile within one
interpretation. Keep seven-pairs and thirteen-orphans interpretations separate
from the standard four-sets-plus-head model.

### Five and six blocks

A five-block plan allocates candidates toward four sets and a head. A six-block
plan retains competing candidates for those five eventual slots. With fewer
established blocks, additional development is needed; a singleton must not
silently count as an already-formed two-tile block.

Retain alternatives differing meaningfully in head choice, wait quality, yaku
compatibility or spare-tile status. Do not rank solely by maximum complete
sets or minimum component count. Check normal-hand structural results against
the existing standard shanten calculation, handling special hands separately.

The UI can choose a deterministic default while consumers inspect several
configurations. The displayed default must not become the evaluator's only
allowed interpretation.

### Structure, context and caching

Cache structural results by normalized hand and fixed melds. Evaluate live
completion counts, dora, yaku prospects and defense using the decision's board
context; context-sensitive results require appropriate cache invalidation.

Wait quality must consider available completion tiles, not just geometry: a
dead side wait is not automatically strong. Do not double-count shared
acceptance tiles across blocks. Structural metadata does not promise a full
multi-draw expected-value search.

Compute actual and recommended post-discard configurations once per decision
and reuse them for categorization and rendering. Support the existing
selectable-discard comparison by computing/caching other candidates on demand,
rather than recomputing partitions on every render.

## Staged backlog

### HP-01: Structural engine and validation — Done

- [x] Define the contract, candidate equivalence, pruning rules and retention limits.
- [x] Implement normalized decomposition with fixed melds, explicit pair roles,
  incomplete sets, singles and separate special-hand handling.
- [x] Establish deterministic output and bounded caches.
- [x] Validate correctness and profile performance before changing visible comparisons.

Correctness and profiling are complete. The proposed eager-integration overhead
budget is not achieved; the completed view uses on-demand computation instead.
This completion does not imply that eager per-decision integration is ready.

### HP-02: Five-/six-block view — Done

- [x] Show a stable default grouping with alternatives available on demand.
- [x] Group the full pre-discard hand in place, preserving physical tile identities
  and fixed melds, including kans.
- [x] Add a **Blocks** toggle with a fixed label and active color; place **<-** /
  **->** controls beneath it, with wraparound in both directions.
- [x] Show only the grouping category (**5 blocks**, **6 blocks**, **7 pairs**,
  **13 orphans**, etc.); keep individual block roles in hover titles.
- [x] Preserve selected-discard interaction and You/AI/EV badges without removing
  the selected tile from the full-hand grouping.
- [x] Keep decomposition and interpretation selection in prep; reuse existing
  tile/meld rendering and the EV comparison.
- [x] Inspect desktop and mobile layouts visually. Remove the **Hand** label,
  preserve original tile sizes and support local scrolling on narrow screens.
- [x] Add isolated prep/browser coverage, run the full suites, and document
  performance measurements and remaining limitations.

Implemented on normal and shared review pages. Computation runs only when
blocks are enabled, outside game prep/categorization; cycling and toggling reuse
prepared results. The view currently offers up to eight standard groupings plus
two separate special models. Text describes only displayed structural evidence.
See [implementation and measurements](../hand-blocks.md#hp-02-on-demand-view).

The final UI scope uses the full hand rather than a separate post-discard
comparison panel, and category-only text rather than detailed missing/excess
and wait explanations. Compound groups and a more relevant distribution picker
remain follow-up work under HP-05; the current ten-option cap is not the final
selection policy.

### HP-03: Safe-spare and versatility consumers — Pending

- Establish whether a retained tile is spare, necessary for the head, part of
  a useful block, or a candidate for a missing block.
- Use missing blocks and weak-block improvement opportunities to qualify
  versatility explanations instead of applying rank alone.
- Use remaining block quality to evaluate the opportunity cost of holding a
  defensive spare. Keep opponent-specific danger in the defense analysis.
- Treat block quality as evidence, not a universal rule that safety matters
  only when every wait is good. Turn, threats and live improvements still matter.
- Update the shared comparator, feature pills and text together. Preserve
  complex/unexplained outcomes when visible evidence is insufficient.

### HP-04: Yaku development consumers — Pending

- Evaluate relevant alternative configurations, starting with outside-hand
  compatibility and suit-based plans.
- Distinguish verified completion, possible development and structural conflict.
  Define development cost/live-tile evidence before displaying an advantage.
- Preserve live-tenpai verification and suppression until replacements have
  independent regression coverage.
- Do not infer Mortal's intent from a compatible partition or add speculative
  reasons to text. Suppressed dimensions remain absent from visuals and text.
- Review consumers individually rather than changing every category at once.

### HP-05: Revamp compound blocks and distribution selection — Pending

- [ ] Extend the structural engine to represent larger connected groups, such as
  **`334m` as one compound block**, instead of always splitting it into a pair
  and singleton or a two-tile wait and singleton. Cover related shapes such as
  `344` and `2334`, retaining their meaningful internal allocations.
- [ ] Define how compound groups map to formed blocks, head candidates and set
  slots so the five-/six-block categories remain accurate. Conserve every
  physical tile and red-five identity without counting overlapping allocations
  twice; do not silently treat `334` as a complete set.
- [ ] Replace the current up-to-ten-view cycle with **only relevant block
  distributions**. Define relevance and equivalence, remove redundant or
  inferior variants, and retain alternatives that materially change the head,
  connected shape or five-/six-block plan. Do not fill the picker to ten just
  because that many configurations are available.
- [ ] Include seven-pairs and thirteen-orphans views only when relevant under
  the same explicit selection policy, keeping their models separate.
- [ ] Add concrete regression fixtures for compound groups and redundant
  distributions. Verify a deterministic default, relevance across competing
  heads and special models, correct block counts, and a shorter useful cycle.
- [ ] Profile ambiguous hands and cache growth before integrating the revised
  engine. Keep on-demand prep and avoid changing numerical shanten/ukeire or
  introducing unsupported strategic claims.

This is engine and interpretation-selection work, not just hiding additional
buttons in the renderer. Define the relevance criteria before pruning; a short
visible list must not restrict the alternatives needed by future HP-03/HP-04
consumers or imply that omitted interpretations are impossible.

## Performance baseline: measured 2026-10-21

Current code: `671fc20e5b0abbdf5ece2eb6f4cfa41e29455451`.
Dataset: local `.cache/category-stats/games.db` snapshot with mtime
2026-06-25 16:00:45 UTC; 49 games, 2,017 reviewed decisions, no missing sample
games. These are reviewed decisions, not every turn of every player.

Environment: Node v22.22.2; host CPU reported as Neoverse-N1. Warm up each engine
on three games, then run three measured passes. Aggregate each game's median;
p95 is across those 49 medians. Time `prepGame` plus categorization, excluding
input loading and cloning.

| Engine | Mean/game | Median/game | p95/game | Maximum/game |
| --- | ---: | ---: | ---: | ---: |
| WASM with existing fallbacks | 50.7 ms | 48.3 ms | 127.3 ms | 183.2 ms |
| JavaScript | 735.7 ms | 664.0 ms | 1,398.9 ms | 1,652.7 ms |

Headless Chromium 155, using the served web WASM artifact and actual
`prepGameAsync` plus categorization, also ran three measured passes after warmup:

| Game | Decisions / rounds | WASM median | JavaScript median |
| --- | --- | ---: | ---: |
| 414 | 7 / 3 | 13.7 ms | 85.8 ms |
| 3 | 42 / 9 | 65.6 ms | 584.3 ms |
| 105 | 85 / 17 | 150.8 ms | 1,381.1 ms |

Browser timings include real event-loop yields between rounds. They exclude
network fetching, WASM initialization and DOM rendering. These are host
measurements, not mobile-device estimates. Neither benchmark reported prep
warnings. These figures are the original baseline; subsequent implementation
measurements are recorded in [the engine/view contract](../hand-blocks.md).

### Reproduction and before/after requirements

Investigation harnesses and detailed results were saved outside the repo:

- `/tmp/haipai-block-baseline.cjs`
- `/tmp/haipai-block-baseline-inputs.json`
- `/tmp/haipai-block-baseline-results.json`
- `/tmp/haipai-block-browser-bench.cjs`
- `/tmp/haipai-block-browser-results.json`

These are temporary artifacts, not durable test dependencies. Preserve the
baseline separately before rerunning: the scripts overwrite their results.
At implementation time, establish a repeatable benchmark without committing
production databases or raw analysis output. If artifacts or the snapshot are
unavailable, remeasure the base revision on the same available dataset used
for the changed revision.

Snapshot SHA-256:

```text
ecea77be46c52343d18531bcbfd5a0436d10745dd59a504958c34756ad1365de
```

Sample game IDs, for reproduction only:

```text
3,11,44,80,89,97,105,114,122,130,138,146,154,162,170,178,187,195,203,212,221,230,238,246,254,262,270,278,286,294,302,310,318,326,334,342,350,358,366,374,382,390,398,406,414,422,430,438,446
```

Do not use a cached categorize-only run as the end-to-end measure.
`scripts/category_bench.mjs` defaults to JavaScript prep and may skip prep on
cache hits; the browser normally uses WASM. Measure both paths explicitly.

Proposed initial target: less than 10% additional warm WASM prep-plus-
categorization time at median and p95 on identical inputs and hardware. This
is a design target, not an achieved result. Also record worst cases, memory/
cache growth, initialization cost and mobile rendering/interaction latency.
Stress dense one-suit and highly ambiguous hands. Tune memoization and pruning
before considering a WASM implementation.

## Validation and completion criteria

Add isolated fixtures/tests for:

- Tile conservation, no overlapping allocation, suit boundaries, order
  invariance, deterministic alternatives and red-five identity preservation.
- Competing heads, six candidate blocks, missing blocks, compound shapes,
  dense one-suit hands and weak/dead waits.
- Open melds, all kan types and concealed four-of-a-kind.
- Seven pairs and thirteen orphans without forcing a standard-hand reading.
- The North pair-wait reproduction and cases with genuine safe spares.
- Chanta with a fixed middle triplet, a middle head and alternative `123`
  decompositions; compatible shapes must not automatically become yaku claims.
- Actual/recommended/selected discard comparisons sharing structural results,
  and explanations matching exactly what the visuals expose.

During investigation, these existing checks passed: **16 tests**.

```bash
node --test tests/test_yaku_guards.js tests/test_dora_acceptance.js tests/test_double_yakuhai.js
```

At the end of the design investigation, no engine, UI, regression tests, coin
awards or report status changes had been implemented. The subsequent HP-01
implementation adds the pure engine, isolated fixtures/tests, and a repeatable
benchmark; application prep and comparison consumers remain future stages. HP-02 now
adds the separate on-demand view described above.
During implementation, run the
full Python suite and relevant JavaScript/component checks, inspect the UI,
and record comparable before/after timings. Report-driven fixes must also
follow `AGENTS.md` and the category-reports skill, including preserved fixtures,
eligible coin awards and fully resolved report history.

## HP-01 decisions and remaining consumer work

The engine contract defines canonical allocation/head equivalence, exhaustive
enumeration with bounded retained samples, deterministic geometric ordering,
and an instance-local bounded LRU. Context-dependent availability is evaluated
separately, without caching board state. Truncated samples explicitly cannot
establish that another interpretation is impossible. The JavaScript engine is
implemented first; benchmark results and limitations belong in the contract.

These consumer decisions remain open:

- HP-05 must replace the current eight-standard-plus-two-special display cap
  with compound groups and a justified relevance policy. Consumers must still
  inspect structural results independently.
- Exact criteria for a genuine spare, a useful improvement opportunity and
  sufficient block quality, including live tiles and competing head choices.
- Evidence required to display early-hand yaku development before tenpai.
- Whether integration profiling justifies further pruning or a native/WASM path.
