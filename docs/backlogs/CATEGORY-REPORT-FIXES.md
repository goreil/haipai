# Category-report fixes

Status: proposed. Based on the 2026-10-19 review of all 85 production reports
(54 games, categorizer v16). Original proposal 1, yaku plausibility guards,
was implemented in `5e0fcf0` (categorizer v17). The remaining proposals retain
their original numbers below.

These four scopes contain **20 reports and 10.33 cumulative EV loss**, without
overlap. EV is the sum of the reported mistakes' stored Mortal Q-value gaps;
it measures the affected examples, not predicted recoverable EV. Reporters'
suggested explanations still need validation against the hands.

[Open all 20 remaining reports in Admin](https://haipai-trainer.com/#admin?report_ids=148,160,200,205,218,219,222,224,228,229,230,231,243,249,251,259,265,268,269,270).
These links use report IDs, automatically select all players and report kinds,
and remove pagination limits. Admin sign-in is required; deleted reports will
no longer appear. Counts and EV totals refer to the review snapshot.

| Priority | Fix | Reports | Cumulative EV | Estimated effort |
|---|---|---:|---:|---|
| 2 | Safe-tile retention and discard sequencing | 10 | 4.18 | Small–medium |
| 3 | Tenpai wait quality | 5 | 2.69 | Small–medium |
| 4 | Acceptance along an open tanyao route | 3 | 1.82 | Small–medium |
| 5 | Furiten exposure at one-shanten | 2 | 1.64 | Small–medium |

## Shared implementation requirements

- Follow the trainer-text rule in `AGENTS.md`: add any new evidence to the
  visuals first (feature pills, table values, wait annotations, or board).
  Haipai text may explain that visible evidence only. Hidden or suppressed
  dimensions must remain absent from the text; do not add speculative prose.
- Use the shared comparator in `static/js/compare-dimensions.js` so the
  classification, feature pills, and explanation agree. Derived inputs belong
  in `static/js/prep/`.
- Preserve raw shanten, acceptance, value, and immediate danger when introducing
  additional dimensions. A recommendation can involve a real trade-off.
- Reproduce the linked reports, add regression fixtures and counterexamples,
  inspect the visuals, and run the repository checks. Bump
  `CATEGORIZER_VERSION` and its changelog when decision logic changes.

## 2. Safe-tile retention and discard sequencing

[Review all 10 matching reports](https://haipai-trainer.com/#admin?report_ids=148,160,219,222,224,230,231,249,251,270)
— complaints about retaining a defensive spare or ordering the discards when
breaking a block; **4.18 EV**.

The `safe_spare_kept` rule currently requires exactly equal acceptance, turn
6 or later, and no active threat. It misses real speed/safety trades: R-230
has 14 versus 10 acceptance, R-224 has 16 versus 15, and early R-148 retains
North after all three other copies have already appeared in ponds.

- Allow a separate safety advantage at equal shanten while keeping the full
  acceptance cost visible.
- Identify a genuinely spare tile rather than treating a useful block member
  as disposable. Permit early activation for demonstrably safe tiles and
  narrowly defined block-breakup sequencing, such as R-231 and R-251.
- With active threats, distinguish the current discard's danger from the
  retained tile's future defensive usefulness; avoid duplicating deal-in evidence.

Acceptance: the linked hands show the supported safety evidence and any speed
cost together. Do not globally lower the turn threshold or label every honor
safe. Validate fresh-honor cases such as R-270 separately.

## 3. Tenpai wait quality

[Review all 5 matching reports](https://haipai-trainer.com/#admin?report_ids=218,228,229,243,259)
— terminal/outer waits, genbutsu waits, and suji context in ready hands;
**2.69 EV**.

The `versatility_kept` rule applies floater rankings even at shanten 0. R-218
rewards retaining a middle red five without representing the terminal
seven-pairs wait. In R-259, the actual comparison is a 2s versus 4s wait,
both with two live copies.

- Disable the floater-versatility heuristic for tenpai comparisons.
- Add a wait-quality dimension based on `necessary_tiles` and board discards:
  outer/honor tanki or kanchan, relevant genbutsu, and suji context.
- Show the relevant wait tiles and supporting evidence in the visuals. Keep
  live counts, hand value, and immediate discard danger as separate trade-offs.

Acceptance: the linked hands compare their actual waits. Ron-friendliness is
a heuristic, not a measured ron probability; do not change raw live counts.
For R-228, establish which waits have a legal yaku before awarding wait-quality
credit. General future-shape analysis, including R-214 and R-250, is outside
this bounded proposal.

## 4. Acceptance along an open tanyao route

[Review all 3 matching reports](https://haipai-trainer.com/#admin?report_ids=200,268,269)
— structural acceptance includes improvements that undermine the open hand's
tanyao route; **1.82 EV**.

`static/js/prep/shanten_calc.js` counts structural shanten improvements without
yaku constraints. Add a separate tanyao-constrained acceptance statistic for
open hands committed to that route, alongside the original structural count.

- Calculate the route with terminals/honors disallowed. Simply filtering
  terminal draw tiles is insufficient: R-268's disputed 3m completes a 123m
  block, which breaks tanyao.
- Account for other available yaku routes before treating the constrained
  statistic as an advantage. At shanten above 0, label it as acceptance along
  the tanyao route, not proof that another future route can never win.
- Show the constrained count and affected tiles in the comparison before
  explaining them in trainer text.

Acceptance: R-200's raw 15-versus-13 acceptance no longer implies an
unqualified speed advantage from the terminal-dependent route. Check R-268's
simple-tile completion explicitly. R-269's submitted reason says 9m, but the
replayed hand's relevant tile is **9p**.

## 5. Furiten exposure at one-shanten

[Review both matching reports](https://haipai-trainer.com/#admin?report_ids=205,265)
— one-shanten choices differ in their ability to reach non-furiten tenpai;
**1.64 EV**.

`furitenWaits` in the comparator currently only handles shanten 0. For each of
the two compared one-shanten discards, enumerate live improving draws and their
possible tenpai discards using the existing solver. Count how many draws permit
at least one non-furiten tenpai, and display this alongside raw acceptance.
Preserve tsumo possibilities and distinguish future exposure from current furiten.

The review's bounded diagnostic produced these regression targets. Both hands
are closed; completion checks were structural.

| Report | Raw acceptance: player / Mortal | Draws permitting non-furiten tenpai: player / Mortal |
|---|---:|---:|
| R-205 | 12 / 12 | 2 / 12 |
| R-265 | 9 / 8 | 5 / 8 |

Acceptance: reproduce these counts, show their basis in the visuals, and keep
the calculation bounded to the compared discards and one improving draw.
R-204 was tested and excluded: both choices permit 13 non-furiten tenpai
improvements. Its broader future-furiten concern needs a different approach.
