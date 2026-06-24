# Mistake model redesign: dimension win-vectors (obvious / trade-off / complex)

**PLANNING — not started.** Reframes the rigid category tree (P1–P4, D1–D3,
OD1–OD3) around the *shape of the difference* between the player's pick and
Mortal's pick. The goal is richer, more teachable trainer text and a model that
absorbs new value features (tanyao/chanta/honitsu progress, shape quality)
**without inventing new categories**.

This file is the design rationale + phased plan. It supersedes nothing yet — the
existing categorizer keeps running until each phase lands behind the
`categorize-bench` parity check.

## The core reframe

There are two engines today that ask the same question ("how does your pick
differ from Mortal's?") and answer it differently:

- **`static/js/categorize.js`** — a *short-circuiting decision tree*. Hard
  precedence (P1 shanten → P2 ukeire → P3 value → P4 complex); picks ONE reason,
  discards the rest.
- **`static/js/ev-table.js`** feature-summary pills — *evaluates every dimension
  independently* and shows a green pill per dimension a pick wins. Its own
  comment notes the divergence: *"unlike the categorizer, which short-circuits…
  the summary always evaluates every feature."*

They can disagree, and we maintain both. The redesign makes the **pill
win-vector the single source of truth** and derives the category from its
*topology*:

| Your pick wins | Mortal's pick wins | → Shape       | Meaning                                   |
| -------------- | ------------------ | ------------- | ----------------------------------------- |
| nothing        | something          | **Obvious**   | Mortal strictly dominates — pure, learnable |
| something      | something          | **Trade-off** | value vs speed vs safety — judgment       |
| (anything)     | **nothing**        | **Complex**   | visible stats don't explain Mortal — "trust the read" |

`Obvious` = your column has zero pills. `Complex` = Mortal's column has zero
pills. No precedence needed for *classification* — precedence survives only as
**narration order** for the trainer text's lead clause.

## Two orthogonal axes (not a flat list)

1. **Skill area** (unchanged): Attack / Defense / Open Defense. Set by the scene
   (defense trigger present or not). This is the trends "counter" axis — the
   first revelation for a new player ("attack/efficiency is where you struggle,
   because it happens most").
2. **Shape**: Obvious / Trade-off / Complex. Derived from the win-vector
   topology, identically across all three skill areas.

Every current code collapses into `{skill area} × {shape}` + the win-vector:

- P1 shanten failure → Attack, **obvious** (Mortal wins shanten, you win nothing)
- P2 ukeire → Attack, **obvious** (equal shanten, Mortal wins ukeire)
- P3 value → Attack, **obvious** or **trade-off** depending on whether your pick
  keeps any competing win (this is *richer* than today — P3 currently always
  reads "preserve value" even when your pick had a real speed reason)
- P4 → Attack, **complex**
- D1 → Defense, **obvious** (Mortal wins deal-in, you win nothing)
- D2 (Mortal pushed, justified) → Defense, **trade-off** (you won safety, Mortal
  won speed/value — "you over-folded")
- D3 → Defense, **complex**
- OD* → same, Open Defense skill area

## The dimension comparator (the architectural move)

Extract one shared module that returns the full win-vector; both the categorizer
and the pills consume it, so they **cannot drift**.

```js
// shared module — single source of truth
function compareDimensions(m) {
  return [
    { dim: "shanten",   winner: "mortal", magnitude: 1, ... },
    { dim: "dora_kept", winner: "mortal", tiles: ["4m"], ... },
    { dim: "ukeire",    winner: "you",    magnitude: 2, suppressed: true, ... },
    // every dimension evaluated; nothing dropped
  ];
}

const wins      = compareDimensions(m);
const youWin    = wins.filter(w => w.winner === "you"    && !w.suppressed);
const mortalWin = wins.filter(w => w.winner === "mortal" && !w.suppressed);
const shape = !youWin.length ? "obvious"
            : !mortalWin.length ? "complex"
            : "trade-off";
```

Same `wins` array renders the pills. Card category and pills can no longer
contradict each other.

### Dimensions (initial set, from today's pills)

| Dimension      | Winner = lower/more | Axis   | Narration prio |
| -------------- | ------------------- | ------ | -------------- |
| shanten        | lower               | speed  | 1              |
| ukeire         | more (**gated**, see below) | speed | 2     |
| dora_kept      | keeps a dora the other discards | value | 3  |
| yakuhai_kept   | keeps a yakuhai the other discards | value | 3 |
| dora_acceptance| wait accepts more live dora | value | 4         |
| deal_in        | lower (KD threat data) | safety | 6           |

### Future dimensions (slot in for free)

- `tanyao_progress`, `chanta_progress`, `honitsu_progress` — yaku the discard
  moves toward. One fragment each; appears in all templates + trends with no new
  category.
- `shape_quality` (2-step ukeire / improvement tiles) — the dimension that
  converts the cross-shanten "wide shape worth a step" case out of **complex**
  and into a real **trade-off**.

## The shanten/ukeire gating rule (resolves the known headache)

Raw ukeire counts are **not comparable across different shanten** — a 2-shanten
hand structurally accepts far more tiles than a 1-shanten hand. "+5 ukeire while
+1 shanten worse" is not a +5 advantage; it's a *bad wide shape* dressed up as a
win. Today's pills are buggy here (`ev-table.js` fires `if (col.ukeireCount >
best)` with **no shanten gate**); `categorize.js` already gates correctly
(`if (sameShanten && eNec > aNec) return "P2"`). Unifying fixes the pill.

**Rule:** *ukeire counts as a win only when shanten is tied. When shanten
differs, the lower-shanten side wins "speed" outright and the ukeire gap is shown
as context ("wider but a step slower"), never as a competing pill (`suppressed:
true`).*

Consequences:

- **You raise shanten, "gain" ukeire** → Mortal wins shanten, your ukeire is
  suppressed → you win nothing → **Obvious** (shanten failure). Correct per
  theory; the wide count seduced you.
- **Mortal raises shanten for a wider shape** → Mortal's ukeire suppressed too →
  Mortal wins nothing visible → **Complex**, labeled honestly ("broke shanten for
  a shape read the visible stats can't quantify"). The future `shape_quality`
  dimension promotes these to trade-offs. Until then, complex is the honest
  answer — not a faked trade-off. No fuzzy threshold; consistent with the
  no-fuzzy-thresholds house rule.

## Trainer text: fragments + shape templates (day-to-day, ships first)

Today's `categorize-explanations.js` is ~600 lines of per-category `if/else` with
hand-written sentences — it cannot absorb N new value features. Replace it with
**compositional** text: each dimension owns small fragments; three shape
templates assemble them.

```js
shanten:      { win: "reaches tenpai a step sooner",       axis: "speed",  prio: 1 }
ukeire:       { win: t => `accepts ${t} more tiles`,        axis: "speed",  prio: 2 }
dora_kept:    { win: t => `keeps the ${t} dora`,            axis: "value",  prio: 3 }
yakuhai_kept: { win: t => `keeps ${t} (yakuhai)`,           axis: "value",  prio: 3 }
dora_accept:  { win: t => `its wait still draws ${t} (dora)`,axis: "value", prio: 4 }
honitsu:      { win: "pushes toward honitsu",               axis: "value",  prio: 5 } // future, free
deal_in:      { win: p => `stays safer (${p}% less deal-in)`,axis: "safety", prio: 6 }
```

Templates (skill area supplies the framing):

- **Obvious** — *"Mortal's {tile} is simply better — it {mortal wins, prio
  order}. Your {tile} gives that up for nothing."* (encouraging: it's learnable)
- **Trade-off** — *"A judgment call: your {tile} {your wins} — but Mortal's
  {tile} {mortal wins}, and here that's worth more."* (names both sides by axis)
- **Complex** — *"Mortal prefers {tile}, but shanten, ukeire and value don't
  explain it — likely {shape / wait quality / score}. Trust the read."*

Payoff: **a new yaku detector ships exactly one fragment** and instantly works in
all three templates (and later in trends). That is the interoperability
requirement, met structurally. The narration priority list is also where
"dora-in-hand beats dora-acceptance" lives — purely as lead-clause ordering,
never as a classification gate.

## Trends (deferred — the same win-vectors, aggregated)

Everything below is recomputed live client-side (per the categorization-vision
memory: no `category` column, no backfill), so trends just aggregates the
per-mistake win-vectors in the existing worker pool.

1. **Skill-area frequency counter** (first revelation, ~today's behavior) —
   "these are the situations you struggle in." Attack leads because it's most
   frequent. **Ship with the day-to-day.**
2. **Per-dimension behavioral profiling** (later) — your wrong pick's win-set is
   what you *over-valued*; Mortal's is what you *under-valued*. Aggregated:
   "you chase honitsu past where it pays / you under-weight defense." Primary
   clustering = over-valued axis (more actionable).
3. **Top-3 best vs top-3 worst dimensions** (cherry on top) — strengths framing,
   not just failures.
4. **Complex-bucket coverage %** — *admin-only first*. It measures *our feature
   set's* blindness, not player skill: every new dimension is scored by how many
   complex spots it converts to obvious/trade-off. Poweruser "judgment spots"
   view possible once the dimension set matures.

## Phased shipping plan

Each phase is independently shippable and stays behind `categorize-bench` parity
(see `.claude/skills/categorize-bench/SKILL.md`). Bump `CATEGORIZER_VERSION` per
phase that changes the decision tree or grouping.

- **Phase 0 — Unify the comparator (no behavior change).** Extract
  `compareDimensions(m)` into a shared module; `categorize.js` and `ev-table.js`
  both consume it. Add the **ukeire shanten-gate** to the pills (fixes the
  misleading "+ukeire" bug). Parity-bench: category distribution must not move
  except where the gate corrects a known bug.
- **Phase 1 — Derive `shape`.** Compute obvious/trade-off/complex from the
  win-vector topology; expose as a field alongside the existing category. No UI
  change yet; validate the shape distribution on the frozen sample.
- **Phase 2 — Trainer text rewrite (START HERE per product decision).** Replace
  `categorize-explanations.js` with the fragment + template system. Card looks
  similar; text is compositional and richer. This is the user-visible payoff and
  the first thing to ship.
- **Phase 3 — Pills-first card.** Promote the Summary pill row to the top of the
  card as the primary "what's the difference" view; demote the prose to a short
  caption beneath it.
- **Phase 4 — New value dimensions.** Add `tanyao/chanta/honitsu_progress` and
  `shape_quality` comparators — each is one fragment + one comparator function.
  Watch the complex bucket shrink.
- **Phase 5 — Trends.** Refine the skill-area counter, then profiling +
  top-3-best/worst; admin coverage metric.

## Open questions (revisit before Phase 2)

- Exact wording/tone of the three templates per skill area (Attack vs Defense
  framing verbs).
- How `dora_acceptance` and `dora_kept` co-narrate when both fire (avoid
  redundant "dora" mentions).
- Whether `shape` needs to be persisted on trends snapshots for version
  comparison, or recomputed (lean: recomputed, like everything else).

## Pointers

- Comparator engines today: `static/js/categorize.js` (tree),
  `static/js/ev-table.js` (~389–536, feat-pills).
- Trainer text: `static/js/categorize-explanations.js`.
- Category metadata: `static/js/categorize-metadata.js`.
- Benchmark: `.claude/skills/categorize-bench/SKILL.md`,
  `scripts/category_bench.mjs`.
</content>
