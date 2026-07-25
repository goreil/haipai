# Diagnostic journal — mistake categorization pass

Running log, newest entries appended at the bottom.

## 2026-07-25 — setup + backlog inventory

- Loaded the `category-reports` skill. Key fact confirmed: production reports
  live only in the Docker DB (`/app/data/games.db`); the local `games.db` in
  the dev checkout is a separate thing. All queries below run through
  `docker exec haipai-app-1`.
- Dumped `category_reports` via `scripts/show_reports.py --json`:
  **35 reports total** (20 `complex_gap`, 13 `wrong_text`, 2 legacy
  `wrong_category`), 2026-04-14 → 2026-07-21. 5 distinct users, but heavily
  skewed: `ylue` (the dev) filed 28 of 35.
- Reconstructability check: every one of the 35 reports still joins to a live
  `mistakes` row and a live `games` row. All 35 mistakes carry
  `hand/melds/shanten/draw/actual/expected/top_actions` in `data_json`.
  **Surprise:** none of the 35 carry `board_state`/`labels`/`opponent_discards`
  in prod `data_json` — the CLAUDE.md/skill docs say "most rows" have
  `board_state`, but at least these 35 don't. Board state is still fully
  reconstructable because `games.rounds_json` stores the whole round log and
  the client prep pipeline (`static/js/prep/`) rebuilds it — same path the
  bench scripts use. So the backlog IS a usable corpus, just via re-prep, not
  via stored snapshots.
- Prod DB scale: 562 games, 23,544 mistakes.

## 2026-07-25 — failure-mode clustering

- Read `compare-dimensions.js` end to end. Key architectural fact that frames
  everything: since CORE Phase 3, a dahai mistake's "category" IS the
  win-vector over exactly ten dimensions; `shape=complex` literally means
  "Mortal's pick wins zero unsuppressed dimensions". So most report clusters
  are *missing dimensions*, not wrong branches — clustering became easy once
  I saw that.
- Judgment call: primary-cluster assignment only (each report counted once)
  so the table sums to 35; several reports straddle (e.g. #187 is
  furiten + display, #154 is safe-tile + threat-model).
- **Best find of the pass so far:** report #170's "F: 0 left" complaint is a
  real, locatable bug. `prep-board-state.js::reconstruct_context` only breaks
  its event walk on a *tsumo* reaching the target tiles_left, so dahai/pon/chi
  events that happen AFTER the decision but before the next draw get counted
  into the visible wall. The reporting user reverse-engineered exactly this
  ("there is a pon happening afterwards… I can't know that before the pon
  happens"). Reports #207/#208 (g527) are the same walk. High-priority fix,
  and it silently skews dora_acceptance + ittsu hovers too.
- Confirmed furiten is computed in prep (`prep/furiten.js`) but consumed ONLY
  by the bad-riichi explanation — never a win-vector dimension. Explains all
  4 furiten reports at once.
- Wrote FAILURE-MODES.md: 8 modes, ranked. Flagged the reporter-skew caveat
  (28/35 reports are the dev's own).

Next: COMPLEX-ANATOMY — need >=100 real complex-shape cases. Plan: run the
offline categorizer (same one `scripts/category_stats.mjs` uses) over prod
games' rounds_json inside a Node context, keep shape=complex mistakes, sample.
Memory says JS shanten is slow (~95% of prep time) and the WASM CJS adapter
isn't wired into the bench — will check whether category_stats.mjs can already
do this before writing anything custom.

## 2026-07-25 — complex sampling setup

- Dead end: `category_stats.mjs --prod` fails from this checkout — its sync
  uses `docker compose cp` against a compose project that isn't running here
  (prod container is `haipai-app-1`, a different compose root). Worked around
  with a manual `docker cp` sync of games.db + the 204 missing mortal files
  into `.cache/category-stats/` (609 files now), then ran the script with
  explicit `--db/--mortal-dir`. Same data, sanctioned snapshot location.
- Wrote a scratchpad-only sampler (`sample_complex.mjs`, NOT in scripts/ —
  this pass is read-only on the repo): strides every 3rd game (~200 games,
  force-including the 26 games with category reports), runs the real
  prepGame→categorize→compareDimensions pipeline, and dumps every
  shape=complex mistake with rich features: both candidates' shanten/ukeire/
  wait tiles, a small block decomposition (sets/ryanmen/kanchan/penchan/pairs)
  of the 13 tiles after each cut, threats, own discards (furiten heuristics),
  Mortal's top_actions with q-values. Also captures the categorize output for
  all 35 reported mistakes → feeds OVERLAP.md directly.
- Found `docs/backlogs/HAND-PARTITION.md` (untracked, dated 2026-06-15): the
  project already plans exactly the 5-block partition primitive this
  diagnostic is meant to size (HP-02 = "move cases out of Complex via block
  counting"). COMPLEX-ANATOMY.md is effectively the sizing study for HP-02.

## 2026-07-25 — sampler rerun

- Caught a bug in my own sampler before trusting its output: I guessed the
  own-seat marker on `board_state.all_discards` (`is_self`) instead of using
  the real convention (absolute `actual.actor` seat index, per
  `board-discards.js::mistakeActorSeat`). Killed the first run at ~150/206
  games, fixed it, and also added opponent discard rows + riichi flags,
  scores, and tiles_left to each dumped case — needed for judging
  safety/placement explanations by eye. Rerunning (~8 min).

## 2026-07-25 — anatomy classification + overlap

- Full-corpus run finished: 23,544 mistakes → complex 24.2% of count but only
  16.3% of EV. That asymmetry became a theme.
- Classified all 120 sampled complex cases by hand (batches of 20, aided by
  the computed features). Distribution: SAFETY 30%, NOISE 27.5%, BLOCK 15%,
  UNCLEAR 12.5%, YAKU 6.7%, WAITQ 4.2%, VALUE 3.3%, FURITEN 0.8%. EV-weighted
  it's a different picture: NOISE collapses to 5.9% and SAFETY+BLOCK carry
  ~57% of complex EV.
- Biggest surprises of the pass:
  1. **The largest explainable cluster isn't shape, it's safety** — "keep
     the safer spare / bank the permanent genbutsu / cut the dangerous honor
     early" with no armed threat, over and over. I expected 5-block gaps to
     dominate; they're second.
  2. **A quarter of the bucket is Mortal's own indifference** (q-gap ≲0.12,
     avg ev 0.07). No dimension will ever explain these because there is
     nothing to explain — severity-floor material.
  3. A recurring, genuinely unexplained **Chun-over-Hatsu** discard
     preference (4 cases, q-gaps up to 0.49). Left as UNCLEAR rather than
     invent a story.
- Judgment calls: NOISE threshold set at q-gap ≲0.12 (Mortal's own
  indifference band); single-reviewer labels; primary-label-only (several
  cases straddle SAFETY/BLOCK). The 5-block estimate (15% of cases, ~28% of
  EV, upper bound ~20%/~35%) is deliberately given as a range.
- OVERLAP: 26/35 reports are complex-shape, but the honest number excludes
  the funnel kind (which only exists on complex cards): the 15 organic
  reports are 53% complex vs 24.2% base = 2.2×. Also noticed two complex_gap
  reports whose spots have since *migrated out* of complex (m18081 →
  obvious, m20932 → trade-off) — dimensions shipped after the report did
  their job, which is a nice validation of the dimension-by-dimension
  strategy.
- Wrote COMPLEX-ANATOMY.md and OVERLAP.md. Committing all five files.
