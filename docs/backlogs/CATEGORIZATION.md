# Categorization & Trainer Tips

**Date**: 2026-04-14
**Scope**: Ground the auto-categorization rules and trainer tips in published strategy material rather than ad-hoc thresholds.

---

## C-01: Mine *Riichi Book 1* (Daina Chiba) for heuristics

The current rules in `lib/categorize.py` (1A / 2A / 3A-3C / 4A-4C / 5A-5B / 6A-6B) and their thresholds are largely intuition-driven. *Riichi Book 1* has chapter-level heuristics on efficiency, value tiles, push/fold, defense, riichi timing, and melds that map cleanly onto our categories and would give us:

- Defensible thresholds for the `RULES` dict (currently the 90% score gap and 3+ safety gap in `lib/categorize.py` are guesses).
- Textual justifications we can surface as trainer tips in the review UI.
- A more principled redesign of the Push / Fold / Half-fold tiers tracked in the `categorization_vision` memory.

**Tasks:**
- [ ] **BLOCKED — owner review required.** goreil must review `docs/riichi_book_1_rules.md` and approve/annotate before any code changes. Do NOT proceed with reconciliation, tips, or threshold changes until this review is done. Ask goreil for status.
- [ ] Map approved rules to categories: chapter -> rule -> which category (1A/2A/...) it informs -> concrete threshold or check.
- [ ] Reconcile with current `RULES` in `lib/categorize.py`; adjust thresholds where the book disagrees.
- [ ] Build a `lib/tips.py` (or extend `categorize.py`) that attaches a short tip + book reference to each categorized mistake, surfaced in the review view.
- [ ] Cross-check against the Push/Fold/Half-fold redesign in `categorization_vision` memory before committing to category IDs.

**Not in scope here:** actually shipping the redesigned category taxonomy -- that is the `categorization_vision` work. This ticket is specifically about sourcing the heuristics.

---

## C-02: Open Defense category (OD1 / OD2 / OD3)

**Date**: 2026-05-23
**Goal**: Add a third axis between Defense and Attack so the categorizer recognises silent-tenpai pressure from open hands, lowering the P4 (Attack/Complex) bucket. The current `threatening_opponent` scene flag exists but only annotates messaging — it doesn't gate categories.

**Precedence**: Defense (riichi) > Open Defense > Attack. A riichi opp always takes the D-axis; the OD-axis only fires when no riichi is active.

### Trigger (categorization gate only)

For each non-player opponent at the player's current turn `m.turn`, count open calls (chi / pon / daiminkan — same set as the existing `OPEN_MELD_TYPES`). The opp is an open-defense threat iff:

- `m.turn` in 0-6 AND open calls ≥ 3, OR
- `m.turn` in 7-12 AND open calls ≥ 2, OR
- `m.turn` ≥ 13 AND open calls ≥ 1.

Strict thresholds — no fuzzy gates (mirrors `categorization_no_fuzzy_thresholds` memory). Any opp passing the rule triggers OD; multiple open-defense opps aggregate via the existing KD multi-threat combinator.

### Deal-in calculation (per open-defense threat)

Minimal-assumption, mahjong-rules-safe genbutsu:

- `genbutsu_X` = every tile that flowed past `opp_X` after their last own dahai — i.e. `opp_X's own discards` ∪ `every tile discarded or called by anyone (including opp_X) after opp_X's last own dahai`. Symmetric with `genbutsu_post_reach_by_seat` in `walk_kyoku`. Slight over-count vs. strict temp-furiten (tiles opp_X called are added too), accepted for simplicity.
- Pass `discards_to_riichi = []` and `ippatsu_alive = false` to `calcCombos`. KD's riichi-specific knobs (matagi-suji, ura-suji, kanchan-riichi-suji-trap, aka-discard) all key off `discards_to_riichi` and drop out cleanly when it's empty. Base per-wait weights (ryanmen 3.5, kanchan 0.21, etc.) reused as-is.
- Mixed riichi + open-defense scenes: both threat kinds land in the same `per_threat` array; the existing `prob_not *= (1 - p)` loop in `compute_kd_defense_data` aggregates them. `dealin_rates` is the combined number. **D-tier classification consumes the combined number too** — this is an explicit choice; D1/D2/D3 splits will shift in mixed scenes and the eval script must report that movement (see Evaluation).

### Three new tiers (mirror D1/D2/D3 exactly)

- **OD1 — Defend**: Mortal's tile is strictly safer (lower deal-in rate).
- **OD2 — Push**: Mortal's tile is not safer AND `classifyPush` returns P1/P2/P3. `od_push_reason` carries which.
- **OD3 — Complex**: Mortal's tile is not safer AND `classifyPush` returns P4.

### Files

| File | Change |
|---|---|
| `static/js/prep/parse.js` `walk_kyoku` | Per-opp `last_own_dahai_pos` + per-call event idxs so threats can be built later. |
| `static/js/prep/defense.js` `_extract_threats` | Emit `kind: "open"` threats meeting the rule; build genbutsu per spec. |
| `static/js/prep/defense.js` `compute_kd_defense_data` | For `kind == "open"` threats: `discards_to_riichi=[]`, `ippatsu_alive=false`. |
| `static/js/categorize.js` | New gate driven by `m.per_threat[].kind` (single source of truth, set in prep): if any kind=="riichi" → D-tier classification; else if any kind=="open" → OD1/OD2/OD3; else attack. Drop `hasThreateningOpponent` and the `catData.threatening_opponent` scene flag — the gate replaces them. Replaces the current `dealinRates && Object.keys(dealinRates).length > 0` check (which becomes ambiguous once OD scenes also populate `dealin_rates`). Bump `CATEGORIZER_VERSION` to 5. |
| `static/js/prep/parse.js` `skill_area_for_entry` | OD-aware branch: a plain dahai with any OD-threat opp routes to the `defense` denominator (not `attack`), so trends bars match the OD axis. Needs the per-opp open-meld counts + `m.turn` plumbed through; simplest is to pass the same per_threat-derived flag categorize.js uses. |
| `lib/categories.py` | Add OD1/OD2/OD3 under a new `"Open Defense"` group. |
| `static/js/categorize-view.js` | Factor the D1/D2/D3 message bodies into a helper parameterised by trigger phrase ("an opponent declared riichi" vs "an opponent has N open calls by turn T"). OD1/OD2/OD3 call the same helper. |
| `static/js/defense-labels.js` | Tag each `per_threat` entry with `kind: "riichi"` / `"open"` so consumers can disambiguate. Drop the `// When open-defense detection lands…` TODO. |
| `static/js/board-discards.js:280-295` | Extend the `⚠ N melds` danger-tag to fire on the row-thresholded rule (2 melds @ T7+, 1 meld @ T13+), not only 3 melds. Switch the counter from `melds.filter(mm => mm.type !== "ankan")` to the same `OPEN_MELD_TYPES = {chi, pon, daiminkan}` set the categoriser uses — so a pon-then-kakan stays at 1 meld and chip/categoriser can't disagree. |
| `static/js/mistake-card.js` `REPORT_CATEGORIES` | Add OD1/OD2/OD3 rows. |
| `static/style.css` | New `--c-open-defense` colour + `.cat-od` styling (visually between Defense red and Attack blue). |
| `tests/fixtures/prep_parity.json` + comparator | JS-only path for now: exclude `last_own_dahai_pos`, per-call event idxs, and OD `per_threat` entries from the JS↔Python parity diff (lib/parse.py + lib/defense_kd.py stay riichi-only). Python lockstep deferred. |
| `tests/fixtures/categorize_parity.json` | Re-snap. |

### Evaluation

`scripts/eval_open_defense.mjs`:

- Load `tests/fixtures/categorize_parity.json` (2121 mistakes, 50 games).
- Categorize each under v4 and v5; report a full transition matrix (all categories, not just the new ones — mixed riichi+open scenes will move within D1/D2/D3 because dealin_rates aggregates both threat kinds).
- Per-bucket totals: **P4** (expect drop), **OD3** (new), **D1/D2/D3** (report movement; not expected to be zero — flag if a large fraction of D1 demotes to D2/D3 because the OD contribution inflated Mortal's combined dealin).
- Headline: `% Complex total = (P4 + D3 + OD3) / N` before vs after. Lower is better.
- Spot-print 5–10 P4 → OD1/OD2 mistake_ids for eyeballing, and 5–10 D-tier-shifted mistake_ids to confirm the shifts look reasonable.

### Order

1. `walk_kyoku` extension + carve the new fields out of the `prep_parity` comparator (don't re-snap with Python-absent fields).
2. `_extract_threats` open-threat emission (with the post-last-dahai genbutsu rule from the Deal-in section).
3. `categorize.js` gate + new OD codes.
4. Eval script — gate the rest of the work on the numbers looking sensible.
5. `categorize-view` text helper + OD1/OD2/OD3 view code.
6. Board `⚠` chip extension.
7. Re-snap `categorize_parity`; run `verify_categorize_js.mjs`.

### Not in scope

- DB backfill — categorization is JS-side at render time; the v5 bump just retags trends snapshots.
- Backend / `lib/parse.py` / storage changes.
- Per-threat-kind KD weight recalibration (matagi/ura-suji/etc.) — explicit choice, accepting the slight inaccuracy. See `defense_open_meld_deferred` memory.
- D1/D2/D3 threshold tuning. Their *behaviour* will shift in mixed riichi+open scenes (combined `dealin_rates` feeds D-classification) — that is expected and tracked in the eval script. Re-tuning the thresholds themselves is deferred.
- Categorising non-dahai mistakes (5A/5B/4\*/6\*) on the OD axis — they stay action-type-categorised, but open-defense threats still flow into their `per_threat` so the hand-tile colouring & defense-situation wording work uniformly.

**Status: SHIPPED.** The categorization logic landed on `open-defense-trigger`
(f32ba9a, CATEGORIZER_VERSION 6: prep open-threat trigger, `per_threat[].kind`
gate, OD1/OD2/OD3) and the UI layer followed on `open-defense-ui`: `"Open
Defense"` group + amber-gold `--c-open-defense` (`lib/categories.py`,
`GROUP_COLORS`, `--c-open-defense` token), Meld moved off orange to magenta
`#ee5fa7`, OD1/OD2/OD3 explanation prose (shared D-tier bodies), the
open-threat board chip (`board-discards.js`, Strong when meld dora is exposed,
Moderate otherwise — trigger is now 2+ open calls any turn, see V7 in
`defense.js`), an Open Defense trends axis with its own `skill_area_for_entry`
denominator, and OD `REPORT_CATEGORIES` rows. Benchmark via
`scripts/category_bench.mjs` (eval folded into it); `verify_categorize_js.mjs`
parity 100%.

**Still deferred (growth-gated, do not pick up without sign-off):**

- [ ] Python lockstep — `lib/parse.py` / `lib/defense_kd.py` stay riichi-only,
      so the server-side `decision_counts` has no `open_defense` bucket. The JS
      recompute path (`decision_counts_for_game`) supplies it for prepped games;
      old snapshots show "—" EV/D for the OD bar until a backfill.
- [ ] Per-threat-kind KD weight recalibration (matagi/ura-suji/etc.) — see
      `defense_open_meld_deferred` memory.
- [ ] D1/D2/D3 threshold re-tuning for mixed riichi+open scenes.

