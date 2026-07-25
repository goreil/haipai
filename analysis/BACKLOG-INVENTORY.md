# Backlog inventory — category reports

Snapshot date: 2026-07-25. Source: production Docker DB
(`/app/data/games.db`, table `category_reports`), read via
`scripts/show_reports.py --json` + direct sqlite queries. The local dev
`games.db` contains no reports; everything below is prod.

## Headline

**35 reports total**, filed 2026-04-14 → 2026-07-21 (~3.5 months, ~10/month).

| kind | count | what it is |
|---|---|---|
| `complex_gap` | 20 | EXTRAS-A funnel on complex-shape cards ("what did Mortal read?") |
| `wrong_text` | 13 | "the explanation text is wrong/incomplete" report |
| `wrong_category` | 2 | legacy pre-funnel report kind |

Reporter concentration is extreme: `ylue` (the developer, user_id 1) filed
**28 of 35**. The other 7 come from 4 real users (`23樓Ken少` ×3, `TecHam` ×2,
`Icedug` ×1, `karl theo` ×1). So this is mostly a self-curated dev backlog with
a thin layer of genuine user feedback — fine as a defect corpus, weak as a
measure of what confuses users at large.

## Fields each report carries

`category_reports` columns: `id`, `user_id`, `mistake_id`, `agree`,
`suggested_category`, `reason`, `created_at`, `kind`.

- `agree` is **0 on all 35 rows** — the UI only files disagreements, the
  column is dead weight.
- `reason` (free text): present on **31/35**.
- `suggested_category`: present on **9/35** — for `complex_gap` it holds
  comma-joined quick-tags (`wait_quality`, `safe_tile_mgmt`, `shape`), for the
  legacy kinds a category code (`P2`, `D1`).
- Every report has at least one of the two — **0/35 are a bare "wrong" flag
  with no content**. The 4 reason-less rows all carry quick-tags.

## Reconstructability — the question that matters

Split: **35/35 reconstructable, 0/35 orphaned.**

Checked row by row:

- All 35 `mistake_id`s still join to a live `mistakes` row
  (`game_id`, `round_name`, `round_idx`, `mistake_idx`, `turn`, `ev_loss`).
- All 35 mistakes' `data_json` contain `hand`, `melds`, `shanten`, `draw`,
  `actual`, `expected`, `top_actions` — i.e. the exact decision point with
  Mortal's full ranked action list and q-values.
- All 35 parent `games` rows still exist, and `games.rounds_json` holds the
  full round-by-round log, so complete board state (discards, melds, dora,
  scores, threats) is rebuildable through the same client prep pipeline
  (`static/js/prep/`) the app and the bench scripts use.

One caveat vs. the docs: **none** of these 35 mistakes have `board_state` /
`labels` / `opponent_discards` snapshotted in `data_json` (CLAUDE.md says
"most rows" do — not these). That costs nothing: board state is derived, not
stored, and re-prep is the canonical path (`scripts/category_bench.mjs` does
exactly this).

## Verdict

The backlog **is a usable corpus**: every report pins an exact, replayable
decision (game + round + turn + hand + Mortal's ranking), and 31/35 come with
a human hypothesis about what the categorizer missed. What it is *not* is
large — 35 cases, 80% from one expert user — so it can seed failure-mode
clustering (see `FAILURE-MODES.md`) and regression fixtures, but it cannot by
itself measure category error *rates*. For rates, the 23,544-mistake prod
corpus has to be re-categorized offline (done for `COMPLEX-ANATOMY.md`).
