# Failure modes in the category-report backlog

Clustered from all 35 production `category_reports` (see
`BACKLOG-INVENTORY.md`). A report can touch two clusters; primary assignment
only, so counts sum to 35. "Fixability" is my judgment of how mechanical the
fix is in the current architecture (`compare-dimensions.js` win-vector +
`static/js/prep/` pipeline), not effort-in-days.

Context for every hypothesis below: since CORE Phase 3, a dahai mistake's
category *is* its win-vector. `compareDimensions(m)` evaluates exactly ten
dimensions — shanten, ukeire, versatility_kept (Speed); yakuhai/tanyao/
honitsu/ittsu_kept (Yaku); dora_kept, dora_acceptance (Dora); deal_in
(Defense) — and `deriveShape` calls the spot **complex** iff Mortal's pick
wins none of them unsuppressed. So most "miscategorizations" here are
literally *missing dimensions*, not wrong branches.

---

## 1. Safe-tile management / defensive foresight not a dimension — 7 reports

The most-reported gap. The win-vector values a discard's deal-in risk **only
when a live threat already exists** (`deal_in` reads `m.dealin_rates` /
`per_threat`). Holding a safe tile for *later*, or sequencing discards
danger-outward-first, is invisible — so when Mortal keeps the safe tile at
equal acceptance, Mortal "wins nothing" and the spot lands in Complex.

Examples:
- **#148** (g197 t5): "Tile acceptance equal (9m + B) → Keep B as safe tile"
- **#212** (g557 t15, TecHam): fold context, last place — "3z was discarded
  by Shimocha, so it must be safe this turn against Toimen"
- **#219** (g608 t5, 23樓Ken少): "breaking tatsu usually starts discarding
  inward tiles for safety reasons"
- also #160, #195, #216, #154 (Chun dangerous vs. possible Daisangen — the
  mirror image: *danger* of holding/dropping a specific tile pre-threat).

Root cause: no `safe_tile_kept` dimension; additionally the threat model only
arms on riichi + strong open threats (`defense_kd` is riichi-only, OD gate =
2 melds or 1-call han≥3), so late-game "everyone is tense" spots (#216 t15)
have no defense signal at all.

Fixability: **medium**. The prep pipeline already computes `safety_ratings`
and genbutsu sets; a "Mortal's pick keeps a safe/safer tile at ~equal speed"
dimension is computable from existing data. The hard part is gating it so it
doesn't fire on every early-game honor cut.

## 2. Yaku coverage gaps (chanta / toitoi / sanankou / pinfu / chiitoi /
   yakuman) — 7 reports

The Yaku group knows exactly four yaku (yakuhai, tanyao, honitsu, ittsu).
When Mortal plays toward any other yaku — or the explanation text under-sells
one — the value reasoning is invisible.

Examples:
- **#129** (g138 t5): "Mortal sees chanta opportunity"
- **#169** (g309 t3): "Toitoi dash → discard middle tiles"
- **#220** (g626 t15, karl theo): "Missing Daisangen in Value tab"
- also #25 (pinfu not in trainer text), #162 (tanyao likelihood — likely the
  ≥11-simples gate refusing a real tanyao line), #172 (sanankou vs tsumo
  display), #211 (chiitoi/honitsu optionality).

Root cause: dimension set + `categorize-yaku.js` coverage is deliberately
minimal; each missing yaku is a missing pill.

Fixability: **medium, incremental**. honitsu_kept/ittsu_kept (changelog v11)
are the template: each new yaku is one gated dimension + pill. Chanta/toitoi/
chiitoi are shape-checkable from the 14 tiles like honitsu is. Diminishing
returns per yaku, but each is self-contained.

## 3. Hand-shape / 5-block / future-development reasoning missing — 7 reports

Mortal often wins on *shape quality one step ahead* (block count, pair
economy, which tatsu survives), which one-step ukeire + the crude
versatility tier can't see. These land in Complex with "trust the read".

Examples:
- **#201** (g477 t4): "Already 5 blocks for perfect 2-shanten" — the
  textbook 5-block-theory call, verbatim from a user
- **#217** (g607 t5): "If the hand is already open, pair > edge wait, since
  pon" — block valuation depends on open/closed state
- **#180** (g365 t4): "Better future shape" (user suggested category P2)
- also #196, #202, #203 (bare "shape" tags), #210 (guaranteed-dora block vs.
  dora acceptance).

Root cause: no block decomposition anywhere in the pipeline. The shanten
kernel returns a number, not a structure; nothing counts blocks, ranks tatsu
(ryanmen > kanchan > penchan), or values pairs.

Fixability: **hard but high-leverage** — this is the "5-block model"
question; `COMPLEX-ANATOMY.md` quantifies how much of the Complex bucket it
would explain.

## 4. Furiten not modeled — 4 reports

`prep/furiten.js` exists but is only consumed by the bad-riichi explanation
path (`categorize-explanations.js`). The win-vector has no furiten dimension,
so "Mortal's pick avoids (or your pick causes) furiten" is invisible.

Examples:
- **#183** (g389 t9, legacy wrong_category): "The other puts me in furiten"
- **#205** (g516 t10): "2p is furiten"
- also #187 (g398 t11: "Ron impossible due to furiten", shown row implies a
  ron value that can't happen), #204 (g516 t8: "likely to lead into furiten").

Root cause: missing dimension; the data to compute it (own discards + each
candidate's resulting wait) already exists in prep.

Fixability: **high** — the furiten machinery is already written and
per-candidate waits are in `discard_stats.necessary_tiles`; a
`furiten_avoided` dimension is mostly wiring.

## 5. Live-tile ("N left") counts wrong around calls — 3 reports

Concrete bug, root cause identified by reading
`prep-board-state.js::reconstruct_context` (and `extract_board_state`, same
walk): the event walk breaks only on a **tsumo** event reaching the target
`tiles_left`. Naki events don't consume wall tiles, so when the decision sits
between a call and the next draw — or events after the player's discard but
before anyone's next tsumo — the interleaved `dahai`/`pon`/`chi` events are
pushed into `visible` and decremented from the wall **even though they happen
after the decision point**. The user in #170 diagnosed it from the outside:

- **#170** (g309 t3): "shows Tile acceptance F: 0 left, even though I can't
  see any F discarded … there is a pon happening afterwards, but 1. there
  would be 1 left, 2. I can't know that before the pon happens"
- **#207** (g527 t7): "shouldn't it be +2 pei?"
- **#208** (g527 t10): "there should be 2 west left"

Fixability: **highest in the list** — an off-by-events bug in one function,
already unit-testable against these three replays. Wrong live counts also
silently poison dora_acceptance and the ittsu "N left" hover, so the blast
radius is bigger than 3 reports.

## 6. Wait-quality reasoning missing — 3 reports

Equal shanten + equal ukeire, but the *waits differ in liveness or win-rate*
(dead 9p vs live tiles, ron-ability, deal-in-ease of the winning tile).
versatility_kept (static 3-7 > 2,8 > 1,9 tier) is the only tiebreaker and
doesn't look at the board.

- **#213** (g572 t5, Icedug): "Discard 7p, because two 9p are already
  discarded" (wait_quality tag)
- **#214** (g575 t6): "5m gets accepted anyway, so this keeps the wait
  that's easier to deal in[to]"
- **#218** (g608 t3, wait_quality tag, no text)

Root cause: no live-count-weighted wait comparison. Fixability: **medium** —
`necessary_tiles` × the (bug-fixed, see mode 5) wall counts gives a
live-ukeire dimension almost for free.

## 7. Score / placement context missing — 2 reports

- **#199** (g505 t3): "we only need 300 points for 3rd → Mortal wants speed,
  keep the pair to pon"
- **#215** (g599 t1): "Wind ordering… preventing South from winning, so get
  rid of their wind first"

Root cause: scores/placement are in the log but nothing in the comparator
reads them. Fixability: **low** — placement EV is Mortal's whole value
function; any cheap heuristic risks confident-wrong text. Park unless
Complex anatomy shows it's big.

## 8. Threat/deal-in model ignores yaku constraints — 2 reports

- **#193** (g446 t15, wrong_category → D1): "the only possible yaku is
  toitoi, [so] the deal-in calculations for south are wrong" — danger rates
  don't condition on what the threat can actually win with
- **#187** also shows a ron row for a hand that cannot ron (furiten overlap).

Root cause: deal-in rates are shape-based; no yaku filter on the threat's
possible waits. Fixability: **low-medium** (the open-threat yaku panel
already computes visible-yaku info that could gate it).

---

## Ranking (frequency × fixability)

| rank | mode | n | fixability | why this order |
|---|---|---|---|---|
| 1 | 5. live-count bug around calls | 3 | very high | a localized, verified bug; poisons other dimensions; regression cases in hand |
| 2 | 4. furiten dimension | 4 | high | machinery exists, pure wiring |
| 3 | 1. safe-tile management | 7 | medium | top reported gap; data exists, needs a good gate |
| 4 | 6. wait quality (live ukeire) | 3 | medium | cheap once mode 5 is fixed; merges naturally with it |
| 5 | 2. yaku coverage | 7 | medium | high count but long-tail — ship chanta/toitoi/chiitoi first, ignore yakuman edge cases |
| 6 | 3. 5-block / shape model | 7 | hard | biggest conceptual gap — decision hinges on COMPLEX-ANATOMY.md numbers |
| 7 | 8. yaku-aware threat model | 2 | low-med | real but rare |
| 8 | 7. placement context | 2 | low | honest "Mortal plays for placement" text may beat modeling it |

Caveat: 28/35 reports are from the dev; the ranking above reflects the
backlog, and the backlog reflects one expert's eye. The three failure modes
independently confirmed by *other* users are safe-tile management (#212,
#219, #160, #195), wait quality (#213, #218), and yaku coverage (#220) —
which supports keeping modes 1, 6, and 2 high despite "medium" fixability.
