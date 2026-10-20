# UX: Help overwhelmed users understand Haipai and return

Status: partially implemented. Added and investigated 2026-10-19.

2026-10-20: Implemented the compact layout above the rounds (UI-01 and the
controls needed for it): date/share/overflow header; Game overview/Rounds/Summary
navigation, opening on Game overview with scores, statistics, trainer tip, and concept
breakdowns; expandable severity/topic filters with visible scope and a full
reset. All round headers retain the same styling, including rounds whose
items are filtered out. Round topic filters show EV totals, use the overview's
concept colors, and run from highest to lowest EV across topics and trade-offs.
Maka contributions now follow the active view. Filter disclosure state survives rerenders of the
loaded game. The rounds count includes individually revealed items; Summary
states its full-game scope. Decision-card layouts and explanations are
unchanged; the remaining proposals below are still open.

Rechecked the same fixture in Chromium at 1280 × 900 and 390 × 844 with local
API fixtures and external resources blocked. The first card starts at about
284 px on desktop and 366 px on mobile in Rounds, with 9 of 23 items shown.
Game overview is the default first tab; mistake deep links open Rounds directly.
These are layout checks, not evidence of improved comprehension or retention.

User feedback identifies two groups: users who understand Haipai and keep
using it, and users who feel that it is too complicated, do not understand
most of it, and never return.

Improve the UX to retain the second group: help them understand what they
are seeing, what to do next, and how to get value from a training session.
Keep the experience useful for existing regular users.

**Focus:** the UI presents too much at once and
it is unclear what everything means. Prioritize information hierarchy,
simultaneous information density, and understandable labels. Onboarding is
supporting work; a longer tutorial would leave the everyday screen unchanged.

Trainer explanations must remain grounded in the information shown in the
card's visuals; do not introduce hidden or speculative strategic reasoning.

## Investigation and limits

Reviewed the worktree at `1278dae`, including the game overview, rounds and
summary rendering, mistake cards, comparison tables, Help, terminology
settings, import onboarding, and the shared/demo entry point. Source links
below use function names so findings remain locatable as line numbers change.

Also rendered the current UI in Chromium with the checked-in
`game_multi_mistake.json` and its expected parsed output, running the normal
client prep and categorization. API responses were local fixtures; no real
accounts or production data were used. Inspected onboarding and game screens
at 1280 × 900 and the game screen at 390 × 844. External fonts and third-party
widgets were blocked, so precise dimensions can differ from production.

In this fixture, the default view displayed **9 of 23 mistakes**. The first
mistake card began approximately **1,016 px** below the top on desktop and
**1,391 px** on mobile: neither initial viewport reached a decision card.
The mobile page fit its viewport horizontally; vertical competition for
attention was the observed problem. These measurements describe one fixture,
not an average across users or games.

The UI facts below are verified in source and, where noted, in that render.
Their effects on comprehension and retention are hypotheses. No user
interviews, abandonment measurements, production cohort analysis, or physical
phone testing were conducted. Do not assume that people confused by Haipai
are beginners at mahjong, or that every non-returning user left because of UI.

## Problems and potential fixes

### UI-01: The overview competes with the decision the user came to review

**Observed:** Before the rounds, `renderGame` shows the game header and final
scores, a collapsed Maka contribution panel, severity controls, ranking and
statistics, a trainer tip, concept ledgers, trade-off ledgers, filter status,
and view tabs. Several blocks have strong colored accents and similar panel
treatment. The fixture screenshots confirm that these occupy more than the
first screen. Maka is already collapsed, but its invitation still precedes
the learning task.

**Likely difficulty:** The user must decide which section matters before
seeing a concrete example. A page about reviewing decisions initially looks
like a dashboard requiring interpretation.

**Potential fix:** Give game review a clear primary starting point: a compact
game heading followed by a decision to review. Put aggregate analysis behind
an explicitly labeled overview/details control or the existing Summary view.
Move contribution requests and secondary game actions away from the main
reading path. Retain a visible route to the full overview for regular users.
Use fewer accent colors for peripheral information and reserve strongest
emphasis for the active comparison and next action.

Source: [game-render.js](../../static/js/game-render.js), `renderGame`,
`renderConceptBreakdown`, `renderTrainerTip`;
[game-maka.js](../../static/js/game-maka.js), `renderMakaRatings`.

### UI-02: A card presents several questions without a clear reading order

**Observed:** The card header can contain turn, internal ID, severity, EV,
skill/shape badge, shanten, situational badges, and an action comparison.
The hand, board context, comparison table, feature pills, trainer text,
notes, and reporting controls follow. The table can combine acceptance,
scoring information, deal-in percentages, and wait breakdowns. Some details
already collapse, including shared acceptance tiles and some discard views.

**Likely difficulty:** The user has to infer the reading order and reconcile
several representations of the same decision. Small badges look similarly
important despite answering different questions.

**Potential fix:** Establish a stable order: **your choice → Mortal's choice
→ the visible difference → optional detail**. Keep the hand and the evidence
needed for that particular comparison next to the explanation. Give detailed
wait calculations, additional candidates, internal IDs, notes, and reports
less prominence. Keep a clearly labeled way to expand the full board/table.
Do not hide defense context that is necessary to interpret a safety claim.

Source: [game-render.js](../../static/js/game-render.js), rounds card markup;
[mistake-card.js](../../static/js/mistake-card.js), `renderMistakeCard`,
`trainerBubbleHtml`; [ev-table.js](../../static/js/ev-table.js),
`renderEvComparison`; [board-discards.js](../../static/js/board-discards.js),
`renderBoardContext`.

### UI-03: Meaning depends on jargon, color, and hover text

**Observed:** Labels include EV, EV/Decision, shanten, acceptance, `N shared`,
`+N`, and shape/skill badges. Many definitions are native `title` attributes.
For example, the explanation of shared versus additional acceptance is in
the table row's hover title. Japanese terminology is the default; an English
option exists under Settings and replaces terms such as ukeire with
acceptance. This substitution does not itself explain the metric.

**Likely difficulty:** Users can see the numbers without understanding what
they measure, whether larger or smaller is preferable, or which tiles a
number describes. Hover is not a reliable way to discover essential meaning
on touch devices. Renaming a term alone may leave the concept unfamiliar.

**Potential fix:** Put short, concrete labels beside the data, including the
unit and direction where appropriate. Explain shared/extra counts next to
their tiles. Add explicitly tappable, keyboard-accessible explanations for
secondary definitions; essential interpretation should be visible without
opening Help. Surface the existing terminology preference near review help.
Retain textual You/Mortal labels and do not rely solely on red/green or other
colors to identify choices or encode meaning. Verify metric semantics before
rewriting labels, especially EV versus actual game points.

Source: [ev-table.js](../../static/js/ev-table.js), `renderEvComparison`;
[mistake-card.js](../../static/js/mistake-card.js), `EV_LOSS_TOOLTIP`;
[terminology.js](../../static/js/terminology.js);
[account.js](../../static/js/account.js), `showAccount`.

### UI-04: Filters and totals require their own mental model

**Observed:** The severity slider is cumulative. Concept pills add OR filters,
which combine with severity filtering; a hand's Show all can reveal excluded
mistakes. Concept ledgers follow severity, while game/hand rankings use all
evaluated mistakes. Multiple concept groups can count the same mistake's EV;
a note explains why group totals do not add up. The concept banner's Show all
calls `clearConceptFilters`, leaving the severity threshold in place.

**Likely difficulty:** The same screen mixes different scopes, and Show all
can mean different things. A user may mistake a partial view for all mistakes
or expect a rank/total to change when it does not.

**Potential fix:** State the active scope in one place, such as “Showing 9 of
23 review items,” with clearly named severity and topic controls. Rename the
concept reset to “Clear topic filter”; reserve “Show all review items” for an
action that really clears all relevant restrictions. Label full-game grades
as such. Keep overlapping concept accounting in the detailed overview and
explain it there. Test how per-hand overrides interact with the proposed
scope display rather than concealing that exception.

Source: [game-render.js](../../static/js/game-render.js), `mistakeVisible`,
`toggleConceptFilter`, `clearConceptFilters`, `renderFiltersPanel`,
`renderGame`, `gameRating`; [game-concept-breakdown.js](../../static/js/game-concept-breakdown.js).

### UI-05: The default view is not a bounded amount to study

**Observed:** `autoSetSeverityFilters` expands through severity tiers until
at least five cards are included, or all tiers are enabled. It does not cap
the count: a whole tier is added at once. The fixture therefore showed nine
cards, and a game with many severe mistakes can show more. Rounds are then
rendered in sequence, without a review-session completion step.

**Likely difficulty:** The page feels like a large backlog of failures. The
user has no clear answer to “How much should I do now?” Highest EV loss also
does not guarantee an understandable first comparison.

**Potential fix:** Prototype a small, explicit review selection (for example,
three decisions) with progress, next/back, skip, and a clear stopping point.
Treat three as an experiment, not an established ideal. Prefer a first example
whose visible comparison supports a concrete explanation; never imply that
the selected examples cover all mistakes or hide the full review. If no
suitable example exists, say so and offer another example or the full game.

Source: [game-prep.js](../../static/js/game-prep.js), `autoSetSeverityFilters`;
[game-render.js](../../static/js/game-render.js), `renderGame`.

### UI-06: Help does not consistently explain the UI users actually see

**Observed:** Help sits under the overflow menu and mainly describes the
classification system. Its Game Ratings section describes personal-history
star ratings, while the current renderer uses fixed letter grades. Its EV
Comparison section describes Mortal Q, while `renderEvComparison` explicitly
omits the per-pick EV row. Its defense scale describes 1–15 safety ratings,
while the current comparison can show deal-in percentages.

**Likely difficulty:** Looking for clarification can introduce a second set
of concepts and labels, leaving the user unsure which explanation applies.

**Potential fix:** Update Help against the rendered UI and remove obsolete
descriptions. Lead with one annotated current card and explain its reading
order. Link contextual help directly to the relevant part of that example.
Keep classification internals and detailed calculation explanations secondary.

Source: [account.js](../../static/js/account.js), `showHelp`;
[game-render.js](../../static/js/game-render.js), `gameRating`;
[ev-table.js](../../static/js/ev-table.js), `renderEvComparison`;
[index.html](../../static/index.html), toolbar overflow menu.

### UI-07: Some labels can make uncertainty feel like the user's failure

**Observed:** A shape is labeled “Obvious.” Complex-card text correctly admits
when visible statistics do not explain Mortal's choice, but its feedback
prompt then asks the user to identify the missing reason, with options such
as wait quality and score pressure. The complex badge description still
suggests a read on shape, wait, or score. Raised-shanten tooltip text also
speculates about strategic reasons. “Unsure” is assigned from a small EV gap,
with a tooltip calling it AI confidence; that code does not measure confidence.

**Likely difficulty:** “Obvious” may sound judgmental to someone who cannot
understand the card. A user may think every recommendation must be derivable
from the displayed table, or that they must diagnose the model to use Haipai.
Different meanings of uncertainty compound the confusion.

**Potential fix:** Test neutral labels such as “Clear comparison” and “Small
evaluation difference.” Clearly distinguish an unexplained recommendation
from an unfamiliar term. Keep the admission that the displayed evidence is
insufficient, remove speculative reasons from badges/tooltips, and make expert
feedback secondary. Offer “I don't understand this” separately from
“Explanation wrong”; do not store confusion as a factual-error report without
defining how it will be reviewed.

Source: [categorize-metadata.js](../../static/js/categorize-metadata.js),
`SHAPE_INFO`; [categorize-explanations.js](../../static/js/categorize-explanations.js),
`explainDiscardShape`; [mistake-card.js](../../static/js/mistake-card.js),
`renderComplexGapFunnel`, raised-shanten tooltip;
[game-render.js](../../static/js/game-render.js), rounds tooltip;
[severity.js](../../static/js/severity.js), `sevTier`, `TIER_TOOLTIP`.

### UI-08: Existing entry points introduce the tool without teaching its display

**Observed:** Signed-in empty-state onboarding explains importing a game and
offers platform-specific videos. The landing page has a live example, but
the demo uses the full read-only game renderer, without a guided reading
order. Existing top-leak tips already link to theory/practice; the missing
piece is help interpreting the current screen, not a total absence of advice.

**Potential fix:** After simplifying the main UI, reuse one annotated decision
in the empty state and public demo. Make it optional and replayable. Put import
instructions alongside Add Game and keep technical setup out of the review
explanation. Track import difficulties separately through the existing
[Mobile Upload backlog](MOBILE-UPLOAD.md); they cannot establish why someone
who has reached a decision card finds it confusing.

Source: [game-fetch.js](../../static/js/game-fetch.js), `showOnboarding`;
[landing.html](../../static/landing.html);
[shared-view.js](../../static/js/shared-view.js), `fetchSharedGame`;
[game-render.js](../../static/js/game-render.js), `TRAINER_TIPS`.

## Proposed first implementation slice

Priorities below are hypotheses to validate, not effort estimates or a promise
that any individual change will improve retention.

1. **P1 — Simplify one real review screen (UI-01–03).** Prototype the compact
   overview and a card with a clear reading order. Show just the evidence
   needed to understand the comparison, with discoverable detail controls.
   Include both a straightforward comparison and a defense/trade-off case so
   the prototype does not succeed only by selecting easy content.
2. **P1 — Make meanings consistent (UI-04, UI-06, UI-07).** Correct Help, filter
   scope/reset labels, and uncertainty wording. Add visible definitions for
   the essential numbers. Check the rounds, summary, and shared card variants.
3. **P2 — Test a small review session (UI-05).** Build on the simplified card;
   compare it with freely scrolling the same content before committing to a
   new default. Preserve direct links and quick access to detailed review.
4. **P2 — Reuse the clearer UI for introductions (UI-08).** Add contextual
   walkthroughs once the underlying screen is understandable.

Any disclosure change must keep text and evidence aligned: if a dimension is
suppressed, remove it from the explanation too. A collapsed detail panel is
not permission to make an unsupported strategic claim. Preserve grade and
analysis semantics while changing presentation, and keep the expanded view
efficient for regular users. Do not make users select an expertise level
before they can begin.

## Validation plan

Recruit an initial small group of people who describe Haipai as overwhelming
(including experienced mahjong players), plus a few regular users for
comparison. Invitations and interviews are future work. Ask participants to
use the current screen and the proposed version with comparable decisions;
vary the order to reduce learning effects. Include desktop and actual phones.

Without first teaching the interface, ask them to:

- Find a decision to review and identify their choice and Mortal's choice.
- Explain the displayed difference and point to its supporting evidence.
- Explain a key number, the active filter, and what is hidden.
- Find more detail, then return to the simple comparison without losing place.
- Recognize a case where the displayed evidence cannot explain the choice.
- Finish a short review and identify how to continue or return later.

Record task success, time to the first correctly understood comparison,
requests for help, misunderstood labels, and perceived effort. Ask “What does
this mean?” and “What would you look at next?” rather than telling participants
that the screen is cluttered. Successful explanation matters more than fast
clicking or saying the layout looks cleaner. Check that regular users still
reach detailed evidence and direct-linked mistakes efficiently.

For a later rollout, establish a baseline and define a meaningful review
session before measuring retention. Suggested funnel: review opened → first
comparison understood (sampled usability check) → review completed → another
review on a later day. UI events can measure opens and explicit completion;
they cannot prove understanding. Report later-day return within 7 and 28 days
for cohorts with complete observation windows, and distinguish import failure,
no further games, and UI confusion. Use a staged or randomized comparison if
traffic permits; do not claim causation from a simple before/after increase.
Set numeric targets after seeing the baseline, rather than inventing them now.

## Design rationale

The application-specific inference is that the UI asks users to identify
relevant information and remember meanings before they can learn from a
decision. Local labels, adjacent evidence, and contextual help are consistent
with Nielsen Norman Group's guidance on
[recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/):
make needed information accessible at the point of use instead of expecting
people to memorize a general tutorial. This supports the proposed design
direction; it does not establish Haipai's cause of churn or predict a retention
uplift.
