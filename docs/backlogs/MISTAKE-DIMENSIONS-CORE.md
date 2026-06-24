# Mistake model redesign — CORE: dimension win-vectors (obvious / trade-off / complex)

**PLANNING — not started.** Reframes the rigid category tree (P1–P4, D1–D3,
OD1–OD3) around the *shape of the difference* between the player's pick and
Mortal's pick.

This is the **core feature**: making the win-vector the single source of truth,
deriving a three-way `shape` from its topology, replacing the per-category
trainer text with compositional fragments, and **deleting the legacy P/D/OD
category codes entirely** (not preserving them internally). It touches the live
categorizer and trainer text, so it ships in small phases and is the part most
likely to break something — do it quickly and carefully.

The **add-on features** (complex→feedback report funnel, new value dimensions,
trends + admin dashboard) are split out into `MISTAKE-DIMENSIONS-EXTRAS.md`.
They depend on this core but ship independently afterward.

This file supersedes nothing yet — the existing categorizer keeps running until
each phase lands.

## Why the legacy codes go (no "keep them internally")

An earlier draft kept P1–P4 / D1–D3 / OD\* alive internally as a skill-area tag
and a parity oracle. We're **not** doing that — the new `{skill area} × {shape}`
model fully replaces them, for two reasons that survived scrutiny:

1. **Skill area never needed the codes.** It already has an independent,
   scene-based classifier — `lib/parse.py::skill_area_for_entry()` and its JS
   mirror `static/js/prep/parse.js::skill_area_for_entry` — that reads
   Attack/Defense/Open-Defense off the *scene* (`actual_type` / `expected_type` /
   riichi / open-threat), not off a category prefix. Today's card redundantly
   re-derives it via `catGroup(m.category)`; the new card reads the classifier
   that already exists. Nothing is lost.
2. **Categories are never persisted, so removal has no migration cost.** Per the
   categorization-vision memory there is no `category` column on `mistakes` and
   nothing in `data_json` stores it — every category is recomputed live. Deleting
   the codes is a pure code change, no backfill. (The *one* place a code string is
   stored is `category_reports.suggested_category` / the `wrong_category` report
   kind — handled under "Legacy removal" below, not a destructive migration.)

The crude codes are exactly what the user wants gone: they don't absorb new
features and they're less honest to a player than naming the actual shape of the
mistake. Keeping them only to diff against would mean maintaining the crude model
forever to validate its replacement.

### What replaces the parity net

Without legacy codes there is no "byte-identical category" diff. The honest
regression guard:

- **Skill area** still has a real before/after — `skill_area_for_entry` is
  untouched by this redesign, so that axis is diffable against today exactly as
  before.
- **Shape** is genuinely new; there is nothing legacy to compare it to. It is
  guarded by a **golden snapshot** of the new win-vector + derived shape on the
  frozen `category_bench` sample: generate once, hand-review, freeze as the
  baseline, then diff every later change against *that* (not against P-codes).
  Plus spot checks of the known-correct cases (dora-keeping shanten failure →
  trade-off; pure ukeire loss → obvious; ukeire-gate suppression).

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

1. **Skill area**: Attack / Defense / Open Defense. Comes straight from the
   scene classifier (`skill_area_for_entry`), independent of any category code.
   This is the trends "counter" axis.
2. **Shape**: Obvious / Trade-off / Complex. Derived from the win-vector
   topology, identically across all three skill areas.

A mistake *is* `{skill area} × {shape}` + the win-vector — that's the whole
model; there is no third "category" layer. For sanity, here is how the deleted
codes would have mapped (they are not computed anymore — this is documentation of
coverage, not a lookup table):

- **P1 / P2 / P3** (shanten / ukeire / value) covered **Attack**. The new shape
  is *derived*, not fixed: **obvious** when your pick wins nothing, **trade-off**
  the moment it keeps a competing dora / yakuhai / shape, **complex** when Mortal
  wins nothing visible. *A shanten failure that keeps a dora is a trade-off, not
  obvious* — "the speed you lost isn't worth the dora you kept." This is the whole
  point of the redesign.
- **P4** was **Attack**, usually **complex**.
- **D1 / D2** were **Defense**: **obvious** when you win nothing; **trade-off**
  when you won safety but gave up speed/value (the old D2 over-fold).
- **D3** was **Defense**, usually **complex**.
- **OD\*** were **Open Defense**.

⚠️ Nothing reads an old code to decide anything. Skill area comes from the scene
classifier; shape comes from the topology. The mapping above only demonstrates
the new model loses no coverage.

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

### Pill-groups (first-class), with the day-one dimensions

The win-vector is organized into **named groups** that match how a player reads a
board. Groups are first-class in the data model — the comparator tags every
dimension with its group. **No group outranks another for classification** (the
anti-precedence point); groups exist to carry (a) *internal* precedence,
(b) narration order, (c) trends profiling.

| Group       | Dimension              | Winner =                              | Group-internal prio |
| ----------- | ---------------------- | ------------------------------------- | ------------------- |
| **Speed**   | shanten                | lower                                 | 1 — always over ukeire |
|             | ukeire                 | more (**gated**: only when shanten tied) | 2                |
| **Yaku**    | yakuhai_kept           | keeps a yakuhai the other discards (*points + the ability to open the hand*) | 1 |
| **Dora**    | dora_kept              | keeps a dora the other discards       | 1 — always over acceptance |
|             | dora_acceptance        | wait accepts more live dora           | 2                   |
| **Defense** | deal_in (**per-opponent vector**) | lower deal-in                | 1 |

**Classification is group-blind**: `trade-off` iff ≥1 unsuppressed pill in your
column **and** ≥1 in Mortal's, regardless of which groups they fall in. The only
two precedence rules — *shanten > ukeire* and *dora_kept > dora_acceptance* — are
**internal to a group** and only ever reorder narration; they never gate the
category.

> The **Shape** group (`shape_quality`) and the extra Yaku dimensions
> (`yaku_progress`, `open_ability`) are deliberately **not** in this core — they
> are new comparators that slot in for free later (see EXTRAS). The point of the
> core is that adding them is a one-fragment change, not a re-architecture.

#### Within-group trade-off seam (data model now, surfacing later)

`deal_in` is modeled as a **per-opponent vector**, not a scalar, **from day one**
in the comparator — even though the core only consumes its aggregate. This
reserves a place for the within-Defense trade-off ("Mortal accepted a higher
deal-in vs W to stay safe against the bigger threat S") that EXTRAS surfaces.
Similarly `dora_kept` vs `dora_acceptance` can both fire (you held a dora;
Mortal's shape draws more dora) — both are core dimensions, so this within-Dora
trade-off works in core.

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
  dimension (EXTRAS) promotes these to trade-offs. Until then, complex is the
  honest answer — not a faked trade-off. No fuzzy threshold; consistent with the
  no-fuzzy-thresholds house rule.

## Trainer text: fragments + shape templates

Today's `categorize-explanations.js` is ~600 lines of per-category `if/else` with
hand-written sentences — it cannot absorb N new value features. Replace it with
**compositional** text: each dimension owns small fragments; three shape
templates assemble them.

```js
shanten:      { win: "reaches tenpai a step sooner",       group: "Speed",   prio: 1 }
ukeire:       { win: t => `accepts ${t} more tiles`,        group: "Speed",   prio: 2 }
yakuhai_kept: { win: t => `keeps ${t} (yakuhai — points + opens the hand)`, group: "Yaku", prio: 1 }
dora_kept:    { win: t => `keeps the ${t} dora`,            group: "Dora",    prio: 1 }
dora_accept:  { win: t => `its wait still draws ${t} (dora)`,group: "Dora",   prio: 2 }
deal_in:      { win: (p,o) => `stays safer vs ${o} (${p}% less deal-in)`, group: "Defense", prio: 1 }
```

Templates (skill area supplies the framing):

- **Obvious** — *"Mortal's {tile} is simply better — it {mortal wins, prio
  order}. Your {tile} gives that up for nothing."* (encouraging: it's learnable)
- **Trade-off** — *"A judgment call: your {tile} {your wins} — but Mortal's
  {tile} {mortal wins}, and here that's worth more."* (names both sides by axis)
- **Complex** — *"Mortal prefers {tile}, but shanten, ukeire and value don't
  explain it — likely {shape / wait quality / score}. Trust the read."*

Payoff: **a new value detector ships exactly one fragment** and instantly works
in all three templates (and later in trends) with no new category. That is the
interoperability requirement, met structurally, and it is what makes EXTRAS cheap.

## Phased shipping plan

Each phase is independently shippable. Bump `CATEGORIZER_VERSION` per phase that
changes the comparator or grouping.

> **Standing rule for every phase that touches `categorize*.js` or
> `static/js/prep/`:** run `scripts/category_bench.mjs` (skill: `categorize-bench`)
> before and after. There is no legacy-category parity to hold (the codes are
> being deleted); the regression guard is instead:
> - **skill-area distribution** must not move except where intended (that axis
>   comes from the unchanged `skill_area_for_entry`);
> - the **win-vector / shape golden snapshot** captured in Phase 0/1 must not
>   move except for the one ukeire-gate bug we *intend* to fix (Phase 0.4) and the
>   new dimensions in EXTRAS.
>
> **Migration scaffold rule:** during Phases 0–2 the existing `categorize.js`
> category output is left flowing *only because we haven't ripped it out yet* — it
> is a time-boxed scaffold, **deleted in Phase 3**, not preserved. No phase adds
> new code that reads a P/D/OD string.

### Phase −1 — Freeze the trends weakness analysis (DONE)

Mid-migration the categorizer version bumps repeatedly and `shape` derivation
shifts; letting users run "Analyze my weak categories" would write confusing,
half-migrated snapshots. Disable *new runs* only; keep existing snapshot
**history** visible (read-only). **The freeze stays in place through this entire
core plan and is lifted in EXTRAS' trends phase.**

- [x] **−1.1** Add a single flag `WEAKNESS_ANALYSIS_ENABLED = false;` at the top
  of `static/js/trends-view.js`. *(Done — `var`, not `const`.)*
- [x] **−1.2** In `renderWeaknessSection`: when off, return a static "Weakness
  analysis paused" notice instead of the button / stale-banner / cached panels.
  `renderSnapshotsHistory` untouched.
- [x] **−1.3** Guard at the source: `startWeaknessAnalysis`
  (`trends-analysis.js:32`) early-returns when off.
- [x] **Exit gate:** verified via puppeteer — frozen path emits the paused notice
  with no button; flipping the flag back on restores it; snapshot history
  untouched.

### Phase 0 — Build the shared comparator + capture the golden snapshot

Goal: one module returns the full win-vector; the pills consume it (fixing the
ukeire-gate bug), and we freeze a golden baseline to guard everything after. The
old category output is left untouched here — it's the scaffold, removed in Phase 3.

- [ ] **0.1** New file `static/js/compare-dimensions.js` exporting
  `compareDimensions(m) -> Array<{ dim, group, winner: "you"|"mortal"|null, magnitude?, tiles?, suppressed?, context? }>`.
  Reuse the existing helpers from `categorize.js` (`findInStats`,
  `getShantenForTile`, `doraUkeireForTile`, `tileIsDora`, `tileIsYakuhai`,
  `dealinFor`) — lift the shared ones into the module or import them; do NOT fork
  a second copy of the dora/yakuhai logic.
- [ ] **0.2** Emit every dimension tagged with its **group**: Speed (shanten,
  ukeire), Yaku (yakuhai_kept), Dora (dora_kept, dora_acceptance), Defense
  (deal_in). Model `deal_in` as a **per-opponent vector** from day one (read
  `m.per_threat`, like `prioritizedDefense` at `categorize.js:293`), even though
  only the aggregate is consumed yet.
- [ ] **0.3** Repoint the `ev-table.js` pill loop (`432–536`) at the win-vector.
  This **fixes the ukeire-gate bug**: today `ev-table.js:451` fires
  `if (col.ukeireCount > best)` with no shanten gate, while `categorize.js:244`
  gates on `sameShanten`. After unifying, the pill must mark cross-shanten ukeire
  `suppressed: true` and render it as context ("wider but a step slower"), never
  as a green +ukeire pill. (`categorize.js` keeps emitting its code unchanged this
  phase — scaffold.)
- [ ] **0.4** Capture the **golden snapshot**: dump `compareDimensions` output +
  `skill_area_for_entry` for every mistake in the `category_bench` sample to a
  committed fixture. Hand-review it once; this becomes the regression baseline for
  Phases 1–3 (replaces legacy-category parity).
- [ ] **0.5** Bump `CATEGORIZER_VERSION` (→ 9) + changelog entry (the pill
  ukeire-gate fix is the only intended behavior delta this phase).
- [ ] **Exit gate:** golden snapshot committed + reviewed; spot-check 3–4
  cross-shanten "+ukeire" cards now show suppressed context, not a green pill;
  skill-area distribution unchanged vs today.

### Phase 1 — Derive `shape` + skill area (the new result shape)

- [ ] **1.1** Compute `shape` from win-vector topology:
  `youWin = wins.filter(w => w.winner==="you" && !w.suppressed)`,
  `mortalWin = …"mortal"…`; `shape = !youWin.length ? "obvious" : !mortalWin.length ? "complex" : "trade-off"`.
- [ ] **1.2** Make the categorize result expose `{ skillArea, shape, wins }`
  (skill area from `skill_area_for_entry`, not from any code). The legacy `category`
  field may still be emitted as scaffold for the not-yet-migrated consumers, but
  nothing *new* reads it, and it is deleted in Phase 3.
- [ ] **1.3** Add `skill-area × shape` + `shape` distribution readouts to
  `category_bench` (replacing the P4/D3 "complex-decision" headline) so the split
  is inspectable on the frozen sample, and diff the win-vector against the Phase 0
  golden snapshot.
- [ ] **Exit gate:** shape distribution printed and sanity-checked (dora-keeping
  shanten failure → `trade-off`, not `obvious`; pure ukeire loss → `obvious`);
  win-vector matches the golden snapshot; skill-area distribution stable.

### Phase 2 — Trainer-text rewrite (the first user-visible payoff)

Replace `categorize-explanations.js` (664 lines of per-category if/else) with
fragments + 3 shape templates. Resolve the **open questions** below first.

- [ ] **2.1** Fragment registry: one `{ win, group, prio }` entry per day-one
  dimension (shanten, ukeire, yakuhai_kept, dora_kept, dora_acceptance, deal_in),
  per the table in "Trainer text" above.
- [ ] **2.2** Three templates (Obvious / Trade-off / Complex) that assemble
  fragments in narration order (group-internal prio: shanten>ukeire,
  dora_kept>dora_acceptance), with the skill area supplying framing verbs.
- [ ] **2.3** Wire the card (`mistake-card.js` → `categorize-explanations.js`) to
  render from `shape` + win-vector. Keep the card *layout* the same for now
  (prose block); only the text source changes.
- [ ] **Exit gate:** every benched mistake renders non-empty, correct text;
  manual read of one card per shape per skill area (9 cards) reads naturally; no
  spot produces an empty or contradictory sentence.

### Phase 3 — Card identity flips to {skill area} × {shape} + delete the codes

This is the phase that **removes the legacy categories**. The pure presentation
flip and the code deletion ship together so there is never a window where the
card names a shape while the codebase still maintains P-numbers. (The original
plan's 3.2/3.3 **complex report funnel** moved to EXTRAS-A.)

- [ ] **3.0** Switch the card **badge** to **{skill area} × {shape}**. Today
  `mistake-card.js:108` renders `catLabel(m.category)`; compute it instead as
  `{skillArea} / {shape}` (e.g. "Attack / Trade-off", "Defense / Complex"), with
  `skillArea` from the categorize result (Phase 1.2) and color from a new
  skill-area→color map (replacing `GROUP_COLORS` keyed by code). Same change in
  `game-render.js` (sidebar + detail badges, ~189/206/337).
- [ ] **3.1** Promote the Summary pill row to the **top** of the mistake card;
  demote prose to a short caption beneath (`mistake-card.js`, card CSS in
  `static/style-game-detail.css`).
- [ ] **3.2 (legacy removal — see the checklist in "Legacy category removal")**
  Delete the `category` emission from `categorize.js`, delete
  `lib/categories.py` + the `/api/categories` route + its frontend fetch, and
  repoint the remaining consumers (`account.js`, `admin.js`,
  `categorize-metadata.js`) onto skill-area + shape.
- [ ] **Exit gate:** badge reads "{skill} / {shape}" on every card; pills sit
  above prose; **`rg "P1|P2|P3|P4|catGroup|catLabel|CATEGORY_INFO|/api/categories"
  static/js lib routes` returns nothing live** (only this doc + git history);
  skill-area distribution + win-vector golden snapshot unchanged.

### Legacy category removal (checklist for Phase 3.2)

Every live reader of a P/D/OD code or `CATEGORY_INFO`, found by grep, with its
replacement. The skill-area axis is preserved (via `skill_area_for_entry`); only
the *code* layer dies.

- [ ] **Categorizer**: `categorize.js` stops returning a `category` string; result
  is `{ skillArea, shape, wins }`.
- [ ] **Backend**: delete `lib/categories.py` (`CATEGORY_INFO` / `CATEGORIES`) and
  the `/api/categories` route (`routes/pages.py:53`). Keep
  `lib/parse.py::skill_area_for_entry` and `decision_counts` (they don't depend on
  codes). Confirm `routes/game.py:102`'s skill-area classifier path is unaffected.
- [ ] **Metadata module**: `categorize-metadata.js` — drop `CATEGORY_INFO`,
  `catLabel`/`catGroup`/`catDesc`, and the code-keyed `GROUP_COLORS`; replace with
  a small skill-area label/color map + shape labels.
- [ ] **Boot**: `main.js:43` stops fetching `/api/categories`.
- [ ] **Card + game render**: `mistake-card.js`, `game-render.js` use
  `skillArea`/`shape` (done in 3.0/3.1).
- [ ] **Account legend** (`account.js:98`): the category-legend grid becomes a
  skill-area × shape legend.
- [ ] **Admin reports** (`admin.js:234/253/257`): report rows show skill-area +
  shape instead of `catLabel`; the `suggested_category` display becomes inert (see
  next).
- [ ] **Reports table** (`db/reports.py`, `db/schema.py`): retire the
  `wrong_category` kind for *new* reports (EXTRAS-A's `complex_gap` replaces the
  report taxonomy). Leave existing `suggested_category` rows as **read-only
  historical text** — no destructive migration. `REPORT_KINDS` drops
  `wrong_category` going forward; `wrong_text` stays.
- [ ] **Trends** (`trends-analysis.js:304` iterates `CATEGORY_INFO`): currently
  behind the Phase −1 freeze. Stub its `CATEGORY_INFO` iteration so the file still
  loads; the real skill-area/shape aggregation is built in **EXTRAS-C** when the
  freeze lifts. Note this explicitly so it isn't mistaken for "trends done".

### Progress-tracking summary

| Phase | One-line gate | Regression guard |
| ----- | ------------- | ---------------- |
| −1 | Weakness button gone, history intact | n/a (no categorizer change) |
| 0  | Pills==card; ukeire-gate fixed; golden snapshot frozen | skill-area stable; snapshot captured |
| 1  | `{skillArea, shape, wins}` derived & sane | snapshot held; skill-area stable |
| 2  | Compositional text on every card | snapshot held (text only) |
| 3  | Badge → {skill}×{shape}; **codes deleted** | grep-clean; snapshot + skill-area held |

After Phase 3 the core is complete, the legacy codes are gone, and the result is
purely `{skillArea, shape, wins}`. Hand off to `MISTAKE-DIMENSIONS-EXTRAS.md` for
the report funnel, new dimensions, and trends. **The weakness-analysis freeze
(Phase −1) stays in place until EXTRAS-C re-enables it.**

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
- Skill-area classifier (kept — the surviving skill-area source):
  `lib/parse.py::skill_area_for_entry`, JS mirror `static/js/prep/parse.js`.
- Trainer text: `static/js/categorize-explanations.js`.
- Category metadata (to be gutted in Phase 3): `static/js/categorize-metadata.js`,
  `lib/categories.py`, `/api/categories` in `routes/pages.py`.
- Benchmark: `.claude/skills/categorize-bench/SKILL.md`,
  `scripts/category_bench.mjs`.
- Add-on features that build on this: `MISTAKE-DIMENSIONS-EXTRAS.md`.
