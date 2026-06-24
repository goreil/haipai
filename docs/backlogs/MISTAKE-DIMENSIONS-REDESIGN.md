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

Every current category collapses into `{skill area} × {shape}` + the win-vector —
but **only the skill area is inherited** from the old category. The **shape is
always re-derived** from the win-vector, so a single old category splits across
all three shapes. The old letter-numbers survive only as skill-area tags:

- **P1 / P2 / P3** (shanten / ukeire / value) → **Attack**. Shape is *derived*,
  not fixed: **obvious** when your pick wins nothing, **trade-off** the moment it
  keeps a competing dora / yakuhai / shape, **complex** when Mortal wins nothing
  visible. *A shanten failure that keeps a dora is a trade-off, not obvious* —
  "the speed you lost isn't worth the dora you kept." This is the whole point of
  the redesign, and it applies to P1/P2 exactly as it does to P3.
- **P4** → **Attack**, usually **complex**.
- **D1 / D2** → **Defense**. **Obvious** when you win nothing; **trade-off** when
  you won safety but gave up speed/value (the D2 over-fold), *or* when Mortal
  traded a higher deal-in against one opponent for a lower one against another
  (within-Defense — see the per-opponent rule below).
- **D3** → **Defense**, usually **complex**.
- **OD\*** → same shapes, **Open Defense** skill area.

⚠️ The "→ obvious / → complex" labels above are *typical* outcomes, never inputs.
Nothing reads the old category to decide the shape; the topology decides it every
time. (The earlier draft's "P1 → obvious" wording was the bug this fixes.)

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

### Five pill-groups (first-class), each with its own dimensions

The win-vector is organized into **five named groups** that match how a player
reads a board. Groups are first-class in the data model — the comparator tags
every dimension with its group. **No group outranks another for classification**
(that's the whole anti-precedence point); groups exist to carry (a) *internal*
precedence, (b) narration order, (c) trends profiling.

| Group       | Dimension              | Winner =                              | Group-internal prio |
| ----------- | ---------------------- | ------------------------------------- | ------------------- |
| **Speed**   | shanten                | lower                                 | 1 — always over ukeire |
|             | ukeire                 | more (**gated**: only when shanten tied) | 2                |
| **Yaku**    | yakuhai_kept           | keeps a yakuhai the other discards (*points + the ability to open the hand*) | 1 |
|             | *open_ability / yaku_progress* (future) | —                    | 2                   |
| **Dora**    | dora_kept              | keeps a dora the other discards       | 1 — always over acceptance |
|             | dora_acceptance        | wait accepts more live dora           | 2                   |
| **Defense** | deal_in (**per-opponent vector**) | lower; *contested across opponents = within-Defense trade-off* | 1 |
| **Shape**   | shape_quality (future) | better 2-step ukeire / live improvement tiles | 1            |

**Classification is group-blind**: `trade-off` iff ≥1 unsuppressed pill in your
column **and** ≥1 in Mortal's, regardless of which groups they fall in. The only
two precedence rules — *shanten > ukeire* and *dora_kept > dora_acceptance* — are
**internal to a group** and only ever reorder narration; they never gate the
category.

#### Within-group trade-offs

A single group can be contested on *both* sides — these are real trade-offs
surfaced inside one pill-group, not across groups:

- **Dora**: you win `dora_kept` while Mortal wins `dora_acceptance` (you held a
  dora; Mortal's shape draws more dora).
- **Defense**: `deal_in` is a **per-opponent vector**, not a scalar. You can be
  safer against one opponent while Mortal is safer against another — *"Mortal
  accepted a higher deal-in vs W to stay safe against the bigger threat S."*

> **Dependency (per-opponent defense):** `defense_kd.js` evaluates **riichi
> threats only** (open-meld threat eval is the deferred `defense_open_meld_deferred`
> item). Day-one, per-opponent Defense trade-offs are computable **only between
> multiple riichi**, not the riichi-vs-open example above. Riichi-vs-open is the
> eventual target once open-meld threat eval lands — design for the vector now,
> ship the multi-riichi subset first.

### Future dimensions (slot in for free)

- `yaku_progress` (tanyao / chanta / honitsu) — yaku the discard moves toward.
  Lands in the **Yaku** group. One fragment each; appears in all templates +
  trends with no new category.
- `open_ability` (**Yaku**) — keeping a yakuhai pair preserves the option to open
  for speed; the value isn't just points. One fragment.
- `shape_quality` (**Shape**, 2-step ukeire / improvement tiles) — converts the
  cross-shanten "wide shape worth a step" case out of **complex** into a real
  **trade-off**.

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
shanten:      { win: "reaches tenpai a step sooner",       group: "Speed",   prio: 1 }
ukeire:       { win: t => `accepts ${t} more tiles`,        group: "Speed",   prio: 2 }
yakuhai_kept: { win: t => `keeps ${t} (yakuhai — points + opens the hand)`, group: "Yaku", prio: 1 }
yaku_progress:{ win: "pushes toward honitsu",               group: "Yaku",    prio: 2 } // future, free
dora_kept:    { win: t => `keeps the ${t} dora`,            group: "Dora",    prio: 1 }
dora_accept:  { win: t => `its wait still draws ${t} (dora)`,group: "Dora",   prio: 2 }
deal_in:      { win: (p,o) => `stays safer vs ${o} (${p}% less deal-in)`, group: "Defense", prio: 1 }
shape_quality:{ win: "leaves a much wider final shape",     group: "Shape",   prio: 1 } // future, free
```

Templates (skill area supplies the framing):

- **Obvious** — *"Mortal's {tile} is simply better — it {mortal wins, prio
  order}. Your {tile} gives that up for nothing."* (encouraging: it's learnable)
- **Trade-off** — *"A judgment call: your {tile} {your wins} — but Mortal's
  {tile} {mortal wins}, and here that's worth more."* (names both sides by axis)
- **Complex** — *"Mortal prefers {tile}, but shanten, ukeire and value don't
  explain it — likely {shape / wait quality / score}. Trust the read."* Pair this
  with the user-report prompt below.

Payoff: **a new yaku detector ships exactly one fragment** and instantly works in
all three templates (and later in trends). That is the interoperability
requirement, met structurally. The narration priority list is also where
"dora-in-hand beats dora-acceptance" lives — purely as lead-clause ordering,
never as a classification gate.

## Complex cards: turn the blind spot into a feature funnel

A **Complex** card is, by definition, a spot our visible dimensions can't
explain — which is exactly where the player can teach *us*. Every complex card
carries a lightweight report prompt:

> *"Mortal sees something our stats don't capture yet — what do you think it
> read?"* → free-text + optional quick-tags (e.g. *wait quality / score
> pressure / safe-tile management / shape*).

This writes to the existing `category_reports` table under a new report type
(e.g. `complex_gap`), alongside today's `agree / wrong_category / wrong_text`
(read via `scripts/show_reports.py` / the `category-reports` skill). Two payoffs:

1. **Product**: the complex bucket becomes a backlog generator — clustered
   reports tell us which dimension to build next.
2. **User**: "help us out" reframes a frustrating "we don't know" into
   participation, instead of a dead end.

This is the user-facing complement to the **admin-only complex-coverage %**
(trends item 4): coverage measures how blind we are; the reports tell us *what
we're blind to*.

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
  both consume it. Tag every dimension with its **group** (Speed / Yaku / Dora /
  Defense / Shape). Add the **ukeire shanten-gate** to the pills (fixes the
  misleading "+ukeire" bug). Model `deal_in` as a **per-opponent vector** from
  the start (even though only the aggregate is consumed at first) so the
  within-Defense trade-off has somewhere to live. Parity-bench: category
  distribution must not move except where the gate corrects a known bug.
- **Phase 1 — Derive `shape`.** Compute obvious/trade-off/complex from the
  win-vector topology; expose as a field alongside the existing category. No UI
  change yet; validate the shape distribution on the frozen sample.
- **Phase 2 — Trainer text rewrite (START HERE per product decision).** Replace
  `categorize-explanations.js` with the fragment + template system. Card looks
  similar; text is compositional and richer. This is the user-visible payoff and
  the first thing to ship.
- **Phase 3 — Pills-first card + complex report.** Promote the Summary pill row
  to the top of the card as the primary "what's the difference" view; demote the
  prose to a short caption beneath it. Add the **complex-card report prompt**
  ("what did Mortal read?") wired to `category_reports` (`complex_gap` type).
- **Phase 4 — New dimensions.** Add `yaku_progress` (tanyao/chanta/honitsu),
  `open_ability`, and `shape_quality` comparators — each is one fragment + one
  comparator function. **Per-opponent Defense**: surface the within-Defense
  trade-off from the deal_in vector (multi-riichi first; riichi-vs-open follows
  open-meld threat eval — see the dependency note above). Watch the complex
  bucket shrink.
- **Phase 5 — Trends.** Refine the skill-area counter, then profiling +
  top-3-best/worst; admin coverage metric.

## Concrete execution checklist (checkpointed)

The phased plan above is the *design intent*. This is the **operational
checklist** — each step has a verifiable exit gate so progress is inspectable
mid-flight. Steps inside a phase are ordered; phases ship independently.

> **Standing rule for every phase that touches `categorize*.js` or
> `static/js/prep/`:** run `scripts/category_bench.mjs` (skill: `categorize-bench`)
> before and after. Record the P4/D3 "complex-decision" headline + category
> distribution in the phase's checkbox. "Parity" = no movement except the one
> ukeire-gate bug we *intend* to fix (Phase 0, step 0.4).

### Phase −1 — Freeze the trends weakness analysis (do FIRST)

Mid-migration the categorizer version bumps repeatedly and `shape` derivation
shifts; letting users run "Analyze my weak categories" would write confusing,
half-migrated snapshots tagged with throwaway versions. Disable *new runs* only;
keep existing snapshot **history** visible (read-only) so nothing regresses
visually.

- [x] **−1.1** Add a single flag `WEAKNESS_ANALYSIS_ENABLED = false;` at
  the top of `static/js/trends-view.js`. *(Done — `var`, not `const`, to match
  the file's non-module global style.)*
- [x] **−1.2** In `renderWeaknessSection` (`trends-view.js`): when the flag is
  off, return a static "Weakness analysis paused" notice card instead of the
  button / stale-banner / cached panels. `renderSnapshotsHistory` left untouched.
- [x] **−1.3** Guard the action at the source: `startWeaknessAnalysis`
  (`trends-analysis.js:32`) early-returns when the flag is off — covers all call
  paths, not just the `actions.js:76` dispatch (button is already gone anyway).
- [x] **Exit gate:** verified via puppeteer (test account → `renderWeaknessSection`
  direct call): frozen path emits the paused notice with **no** `startWeaknessAnalysis`
  button; flipping the flag back on restores the button (freeze is the cause);
  `startWeaknessAnalysis()` with the flag off early-returns (`fetchTrends` never
  called, gen counter unchanged); snapshot history path untouched. (Flag flips
  back to `true` in Phase 5.)

### Phase 0 — Unify the comparator (no behavior change)

Goal: one module returns the full win-vector; the tree and the pills both consume
it so they can't drift.

- [ ] **0.1** New file `static/js/compare-dimensions.js` exporting
  `compareDimensions(m) -> Array<{ dim, group, winner: "you"|"mortal"|null, magnitude?, tiles?, suppressed?, context? }>`.
  Reuse the existing helpers from `categorize.js` (`findInStats`,
  `getShantenForTile`, `doraUkeireForTile`, `tileIsDora`, `tileIsYakuhai`,
  `dealinFor`) — lift the shared ones into the module or import them; do NOT fork
  a second copy of the dora/yakuhai logic.
- [ ] **0.2** Emit every dimension tagged with its **group**: Speed
  (shanten, ukeire), Yaku (yakuhai_kept), Dora (dora_kept, dora_acceptance),
  Defense (deal_in). Model `deal_in` as a **per-opponent vector** from day one
  (read `m.per_threat`, like `prioritizedDefense` at `categorize.js:293`), even
  though only the aggregate is consumed yet.
- [ ] **0.3** Rewrite `classifyPush`/`classifyDefense` (`categorize.js:226–280`)
  to *consume* the win-vector instead of recomputing comparisons inline. The
  returned category strings (P1–P4 / D1–D3 / OD*) must be **byte-identical** to
  today. This is the parity-critical step.
- [ ] **0.4** Repoint the `ev-table.js` pill loop (`432–536`) at the same
  win-vector. This **fixes the ukeire-gate bug**: today `ev-table.js:451` fires
  `if (col.ukeireCount > best)` with no shanten gate, while `categorize.js:244`
  gates on `sameShanten`. After unifying, the pill must mark cross-shanten ukeire
  `suppressed: true` and render it as context ("wider but a step slower"), never
  as a green +ukeire pill.
- [ ] **0.5** Bump `CATEGORIZER_VERSION` (→ 9) + changelog entry (the pill bug
  fix is the only intended behavior delta).
- [ ] **Exit gate:** `category_bench` distribution unchanged vs baseline **except**
  the ukeire-gate correction; spot-check 3–4 cross-shanten "+ukeire" cards in the
  UI now show suppressed context, not a green pill. Pills and card category agree
  on every benched mistake.

### Phase 1 — Derive `shape` (obvious / trade-off / complex)

- [ ] **1.1** In the categorizer, compute `shape` from win-vector topology:
  `youWin = wins.filter(w => w.winner==="you" && !w.suppressed)`,
  `mortalWin = …"mortal"…`; `shape = !youWin.length ? "obvious" : !mortalWin.length ? "complex" : "trade-off"`.
- [ ] **1.2** Expose `shape` on the categorize result **alongside** the existing
  `category` (do not replace it yet). No UI consumes it.
- [ ] **1.3** Add a `shape` distribution readout to `category_bench` (or a tiny
  sibling script) so the obvious/trade-off/complex split is inspectable on the
  frozen sample.
- [ ] **Exit gate:** shape distribution printed and sanity-checked (e.g. a
  dora-keeping shanten failure reports `trade-off`, not `obvious`; a pure ukeire
  loss reports `obvious`). `category` strings still unchanged → bench parity holds.

### Phase 2 — Trainer-text rewrite (the first user-visible payoff)

Replace `categorize-explanations.js` (664 lines of per-category if/else) with
fragments + 3 shape templates. Resolve the three **open questions** below first.

- [ ] **2.1** Fragment registry: one `{ win, group, prio }` entry per dimension
  (shanten, ukeire, yakuhai_kept, dora_kept, dora_acceptance, deal_in), per the
  table in "Trainer text" above.
- [ ] **2.2** Three templates (Obvious / Trade-off / Complex) that assemble
  fragments in narration order (group-internal prio: shanten>ukeire,
  dora_kept>dora_acceptance), with the skill area supplying framing verbs.
- [ ] **2.3** Wire the card (`mistake-card.js` → `categorize-explanations.js`) to
  render from `shape` + win-vector. Keep the card *layout* the same for now
  (prose block); only the text source changes.
- [ ] **Exit gate:** every benched category renders non-empty, correct text;
  manual read of one card per shape per skill area (9 cards) reads naturally; no
  category produces an empty or contradictory sentence.

### Phase 3 — Pills-first card + complex report funnel

- [ ] **3.0** Switch the card **badge** from the old letter-category label to
  **{skill area} × {shape}**. Today `mistake-card.js:108` renders
  `catLabel(m.category)` → `"{group} / {label}"` (e.g. "Attack / Shanten
  Failure"); compute it instead as `{catGroup(category)} / {shape}` (e.g.
  "Attack / Trade-off", "Defense / Complex"), so the badge stops naming the
  internal P-number and names the shape. Leave `m.category` and `/api/categories`
  (`lib/categories.py` / `CATEGORY_INFO`) **untouched** — `catGroup` still reads
  the skill area off the preserved internal code; only the displayed label
  changes. Keep the existing `GROUP_COLORS` keying off the skill area. This is
  the moment the card's identity flips from "which P-number" to "which shape";
  it's bundled here (not Phase 2) so Phase 2 stays a pure text swap.
- [ ] **3.1** Promote the Summary pill row to the **top** of the mistake card;
  demote prose to a short caption beneath (`mistake-card.js`, card CSS in
  `static/style-game-detail.css`).
- [ ] **3.2** On **complex** cards, add the report prompt ("Mortal sees something
  our stats don't capture yet — what did it read?") with free-text + quick-tags
  (wait quality / score pressure / safe-tile mgmt / shape).
- [ ] **3.3** Wire it to the existing `category_reports` table under a new type
  `complex_gap` (alongside `agree/wrong_category/wrong_text`). Backend:
  `db/reports.py` + the report route; read path: `scripts/show_reports.py` /
  `category-reports` skill must surface the new type.
- [ ] **Exit gate:** submit a `complex_gap` report from a complex card in the UI;
  confirm it lands via `scripts/show_reports.py`. Non-complex cards show no prompt.

### Phase 4 — New dimensions (each = 1 fragment + 1 comparator)

- [ ] **4.1** `yaku_progress` (tanyao / chanta / honitsu) → Yaku group. Reuse the
  existing shape-yaku detection in `static/js/prep/prep-board-yaku.js` /
  `categorize-yaku.js` rather than re-detecting.
- [ ] **4.2** `open_ability` (keeping a yakuhai pair preserves the open option) →
  Yaku group.
- [ ] **4.3** `shape_quality` (2-step ukeire / improvement tiles) → Shape group;
  converts cross-shanten "broke shanten for a wider shape" complex cards into
  real trade-offs.
- [ ] **4.4** Per-opponent Defense trade-off: surface the within-Defense case from
  the `deal_in` vector. **Multi-riichi subset first** (computable today);
  riichi-vs-open is gated on open-meld threat eval — see
  `[[defense_open_meld_deferred]]` and the dependency note above. Do **not** build
  riichi-vs-open now.
- [ ] **Exit gate (per dimension):** bench shows the complex bucket shrinking by
  the expected amount; each new fragment renders in all three templates; no new
  category introduced.

### Phase 5 — Trends + re-enable weakness analysis

- [ ] **5.1** Flip `WEAKNESS_ANALYSIS_ENABLED` back to `true` (Phase −1) and
  remove the paused notice.
- [ ] **5.2** Skill-area frequency counter ("situations you struggle in") —
  aggregate the per-mistake win-vectors in the existing worker pool
  (`trends-analysis.js`). Attack leads by frequency.
- [ ] **5.3** Per-dimension behavioral profiling (over-valued = your win-set,
  under-valued = Mortal's), then top-3 best/worst dimensions.
- [ ] **5.4** Admin-only complex-coverage % metric.
- [ ] **Exit gate:** run a full weakness analysis end-to-end; snapshot saves with
  the final `CATEGORIZER_VERSION`; the skill-area counter matches a hand-count on
  a small sample.

### Progress-tracking summary

| Phase | One-line gate | Bench parity? |
| ----- | ------------- | ------------- |
| −1 | Weakness button gone, history intact | n/a (no categorizer change) |
| 0  | Pills==card everywhere; ukeire-gate bug fixed | parity ± gate fix |
| 1  | shape field derived & sane; category unchanged | strict parity |
| 2  | Compositional text on every card | strict parity (text only) |
| 3  | Badge → {skill}×{shape}; pills-first card; complex_gap report round-trips | strict parity |
| 4  | New fragments live; complex bucket shrinks | intended movement |
| 5  | Weakness analysis re-enabled on new model | n/a |

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
