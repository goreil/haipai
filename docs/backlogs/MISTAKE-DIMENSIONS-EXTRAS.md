# Mistake model redesign — EXTRAS: add-ons on the win-vector

**PLANNING — not started. Depends on `MISTAKE-DIMENSIONS-CORE.md`.** These three
add-ons all bolt onto the core's win-vector / fragment / shape system **without
inventing new categories**. They were extracted out of the original combined plan
so the core (which touches the live categorizer and could break something) can
ship quickly and on its own.

Read CORE first for the architecture (the `compareDimensions` win-vector, the
five pill-groups, the obvious/trade-off/complex `shape`, the fragment+template
trainer text). Each section here is independent — ship in any order once core is
done.

| Add-on | What it is | Core dependency |
| ------ | ---------- | --------------- |
| **A. Complex → feedback funnel** ✅ SHIPPED | report prompt on complex cards → `category_reports` | `shape` (Phase 1) + pills-first card (Phase 3) |
| **B. New value dimensions** | yaku_progress / open_ability / shape_quality / per-opponent defense | comparator + fragment registry (Phases 0 & 2) |
| **C. Trends + admin dashboard** | skill-area counter, behavioral profiling, complex-coverage %, re-enable weakness analysis | the win-vectors (Phase 0) |

---

## A. Complex cards: turn the blind spot into a feature funnel — ✅ SHIPPED

A **Complex** card is a spot our visible dimensions can't explain — exactly
where the player can teach *us*. Complex cards embed a feedback funnel **inside
the trainer's speech bubble** (right under the "the visible stats don't explain
it — trust the read" line, for maximum visibility): a *"We can't pin down what
Mortal read here — can you?"* CTA + multi-select quick-tags (wait quality /
score pressure / safe-tile mgmt / shape) + free text. Complex cards get no
`wrong_text` report row — the bubble funnel replaces it. It writes to
`category_reports` under the new `complex_gap` kind (tags ride comma-joined in
`suggested_category`, free text in `reason`; no schema change).

This is the user-facing complement to the **admin-only complex-coverage %**
(add-on C): coverage measures how blind we are; the clustered `complex_gap`
reports tell us *what* we're blind to and feed add-on B's dimension backlog.

Where it lives:
- Trainer bubble assembler `trainerBubbleHtml(m)` (`static/js/mistake-card.js`),
  used by both game-detail render paths in `static/js/game-render.js`. Funnel
  render + handlers `renderComplexGapFunnel` / `saveComplexGap` / `onComplexTag` /
  `onComplexReason` (`static/js/mistake-card.js`); actions registered in
  `static/js/actions.js`; styles `.complex-gap-*` in `static/style-game-detail.css`.
  Admin / trends build their own non-interactive bubbles via `generateExplanation`,
  so the funnel never leaks there.
- Backend: `complex_gap` in `db/reports.py` `REPORT_KINDS`; the report route
  (`routes/game.py`) writes the tags through `suggested_category` for this kind.
- Read path: `scripts/show_reports.py` (tag tally + `--kind complex_gap`) and the
  admin reports view (`static/js/admin.js`) both surface it.

---

## B. New value dimensions (each = 1 fragment + 1 comparator)

The whole point of CORE is that adding a dimension is a one-fragment change that
instantly works in all three shape templates (and later in trends) with **no new
category**. Each of these watches the complex bucket shrink as visible stats
explain more spots.

### Future dimensions and their groups

- `yaku_progress` (tanyao / chanta / honitsu) — yaku the discard moves toward.
  Lands in the **Yaku** group. One fragment; appears in all templates + trends.
- `open_ability` (**Yaku**) — keeping a yakuhai pair preserves the option to open
  for speed; the value isn't just points. One fragment.
- `shape_quality` (**Shape** group, 2-step ukeire / improvement tiles) — converts
  the cross-shanten "broke shanten for a wider shape" case out of **complex** into
  a real **trade-off**. (See CORE's shanten/ukeire gating rule: until this lands,
  those spots are honestly **complex**, never a faked trade-off.)

Example fragments (drop straight into the CORE registry):

```js
yaku_progress:{ win: "pushes toward honitsu",           group: "Yaku",  prio: 2 }
open_ability: { win: "keeps the option to open for speed", group: "Yaku", prio: 2 }
shape_quality:{ win: "leaves a much wider final shape",  group: "Shape", prio: 1 }
```

### Per-opponent Defense trade-off

`deal_in` is already a **per-opponent vector** in the CORE comparator (modeled
day-one, aggregate-only consumed). This add-on surfaces the within-Defense
trade-off it reserves: *"Mortal accepted a higher deal-in vs W to stay safe
against the bigger threat S."*

> **Dependency:** `defense_kd.js` evaluates **riichi threats only** (open-meld
> threat eval is the deferred `defense_open_meld_deferred` item). Day-one,
> per-opponent Defense trade-offs are computable **only between multiple riichi**.
> Riichi-vs-open is the eventual target once open-meld threat eval lands — the
> vector is already modeled, so ship the multi-riichi subset first and do **not**
> build riichi-vs-open now.

### Checklist

> Was Phase 4 in the original combined plan.

- [ ] **B.1** `yaku_progress` (tanyao / chanta / honitsu) → Yaku group. Reuse the
  existing shape-yaku detection in `static/js/prep/prep-board-yaku.js` /
  `categorize-yaku.js` rather than re-detecting.
- [ ] **B.2** `open_ability` (keeping a yakuhai pair preserves the open option) →
  Yaku group.
- [ ] **B.3** `shape_quality` (2-step ukeire / improvement tiles) → Shape group;
  converts cross-shanten "broke shanten for a wider shape" complex cards into real
  trade-offs.
- [ ] **B.4** Per-opponent Defense trade-off from the `deal_in` vector.
  **Multi-riichi subset first** (computable today); riichi-vs-open is gated on
  open-meld threat eval — see `defense_open_meld_deferred` and the dependency note
  above.
- [ ] **Exit gate (per dimension):** `category_bench` shows the complex bucket
  shrinking by the expected amount; each new fragment renders in all three
  templates; no new category introduced. Bump `CATEGORIZER_VERSION` per dimension.

---

## C. Trends + admin dashboard (the same win-vectors, aggregated)

Everything below is recomputed live client-side (per the categorization-vision
memory: no `category` column, no backfill), so trends just aggregates the
per-mistake win-vectors in the existing worker pool (`trends-analysis.js`).

1. **Skill-area frequency counter** (first revelation, ~today's behavior) —
   "these are the situations you struggle in." Attack leads because it's most
   frequent.
2. **Per-dimension behavioral profiling** — your wrong pick's win-set is what you
   *over-valued*; Mortal's is what you *under-valued*. Aggregated: "you chase
   honitsu past where it pays / you under-weight defense." Primary clustering =
   over-valued axis (more actionable).
3. **Top-3 best vs top-3 worst dimensions** (cherry on top) — strengths framing,
   not just failures.
4. **Complex-bucket coverage %** — **admin-only first**. It measures *our feature
   set's* blindness, not player skill: every new dimension (add-on B) is scored by
   how many complex spots it converts to obvious/trade-off. Poweruser "judgment
   spots" view possible once the dimension set matures. This is the admin
   complement to the user-facing complex report funnel (add-on A).

### Re-enable weakness analysis

CORE Phase −1 froze "Analyze my weak categories" for the whole migration. This is
where it comes back on — the model is now stable and the win-vectors are
aggregatable.

### Checklist

> Was Phase 5 in the original combined plan.

- [ ] **C.1** Flip `WEAKNESS_ANALYSIS_ENABLED` back to `true` (CORE Phase −1) and
  remove the paused notice in `renderWeaknessSection` (`trends-view.js`).
- [ ] **C.2** Skill-area frequency counter ("situations you struggle in") —
  aggregate the per-mistake win-vectors in the existing worker pool
  (`trends-analysis.js`). Attack leads by frequency.
- [ ] **C.3** Per-dimension behavioral profiling (over-valued = your win-set,
  under-valued = Mortal's), then top-3 best/worst dimensions.
- [ ] **C.4** Admin-only complex-coverage % metric.
- [ ] **Exit gate:** run a full weakness analysis end-to-end; snapshot saves with
  the current `CATEGORIZER_VERSION`; the skill-area counter matches a hand-count on
  a small sample.

---

## Pointers

- Core architecture this depends on: `MISTAKE-DIMENSIONS-CORE.md`.
- Trends page: `static/js/trends-view.js` (shell + freeze flag),
  `static/js/trends-charts.js` (SVG), `static/js/trends-analysis.js` (worker pool).
- Reports: `db/reports.py`, `scripts/show_reports.py`, `category-reports` skill.
- Shape-yaku detection (reuse for B): `static/js/prep/prep-board-yaku.js`,
  `static/js/categorize-yaku.js`.
- Defense eval: `static/js/prep/defense_kd.js` (riichi threats only).
