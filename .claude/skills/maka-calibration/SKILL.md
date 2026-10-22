---
name: maka-calibration
description: Analyze Haipai grading thresholds against reported Maka grades, compare shared and separate hand/game scales, validate justified changes, and checkpoint completed reviews so the admin pending-grade count stays accurate.
---

# Maka calibration

Use the repository's `scripts/analyze_maka_ranks.py`. Read
`docs/MAKA-RANK-CALIBRATION.md` for previous decisions and `AGENTS.md` for
repository checks. Production grades are in Docker's `/app/data/games.db`,
not necessarily the local database. Run from the repository root.

## Analyze before changing thresholds

```bash
docker compose exec -T app python scripts/analyze_maka_ranks.py --db /app/data/games.db
```

Add `--json` for aggregate machine-readable metrics and fitted coefficients.
For a local database, use `.venv/bin/python` and its explicit `--db` path.
Default execution is read-only. Do not commit raw analysis output or databases.

The script reads one consistent snapshot and reports:

- Filled versus usable grades, overall/hand counts, games, contributor
  concentration, undated grades, and usable grades pending review.
- Current fixed curve and refitted square-root, linear, and logarithmic curves.
- Separate overall/hand curves and hybrids that refit overall only, retaining
  current hand thresholds. These appear in the combined-scope comparison.
- Mean absolute error in grade steps, exact matches, within-one-grade accuracy,
  and signed bias, both for all usable grades and the pending subset.

Fit on other games and hold out **every grade from the tested game**. Never
randomly split hands from the same game between training and evaluation.
Pending-subset predictions also train on other games in the full sample;
do not mistake them for an independent prospective test. When comparing
separate scales, fit each scale only on its own kind. Grades are ordinal
steps (`A` to `A+` is one); clamping and rounding must match the browser.

Count an overall slot and each hand slot separately, but do not describe
them as independent observations. Inspect contributors and game counts per
scope; hundreds of hand grades from one contributor do not demonstrate
generalization across users. Unknown save dates are not evidence of recency.
The admin counter refers to the latest **completed review**, not necessarily
the latest threshold change or documentation date. Before the first checkpoint
it falls back to dated grades since `HAIPAI_RANK_UPDATED_AT`.

Prefer lower held-out MAE without sacrificing other accuracy measures for a
negligible gain. Explain tradeoffs and absolute magnitude: a one-step reduction
across 23 overall grades is weak evidence. Compare all usable data as well as
pending data; fitting selected new grades better alone is insufficient.
Check contributor-held-out performance when enough contributors exist; say
when coverage makes it uninformative. Avoid selecting many extra model forms
on this small validation sample and presenting the winner as independently
validated. No threshold change is a valid completed review.

## Implement only justified changes

When the user requests implementation and evidence supports it, update the
browser formula, inverse boundaries, tooltips, and every caller affected by
any hand/overall split (`static/js/game-render.js` and trends callers). Keep
the analysis baseline synchronized with the shipped formula. Change
`HAIPAI_RANK_UPDATED_AT` in `db/schema.py` only when grading actually changes;
never move it merely to clear a counter. Explain if different scales make a
hand grade incomparable with the full-game grade.

Add meaningful boundary, normalization, and scope-selection tests for formula
changes. Run the full Python suite, affected Node tests (including
`tests/test_game_ranking.js`), and lint changed Python. Inspect UI changes
visually. Summarize the rationale in the calibration design note without
committing private samples or raw dumps. Commit when requested.

## Complete the review and update admin

After reaching a conclusion and validating any implementation, record the
review **even when the current thresholds win**. A request to complete this
calibration workflow includes its admin checkpoint; do not request that same
permission again. Explicitly read-only or preliminary investigations must
leave the checkpoint untouched and report that limitation.

```bash
docker compose exec -T app python scripts/analyze_maka_ranks.py \
  --db /app/data/games.db --record-review \
  --conclusion "Keep current thresholds: refits worsen full-sample held-out accuracy."
```

Use a conclusion that describes the actual result. This command reruns the
analysis and stores its aggregate metrics and exact grade snapshot atomically
with the checkpoint. If data changed since your initial analysis, inspect the
new metrics before claiming they support the same conclusion. For a proposed
formula change, validate the candidate before shipping, preserve the before/
after evidence, then checkpoint against the synchronized shipped baseline.
The additive `maka_rank_reviews` table must be deployed through normal app
initialization first; do not run unrelated migrations just to force a write.

Verify `admin_after.count` in JSON output (or the final text line), then
`db.admin.admin_maka_rank_stats` / `/api/admin/stats` and the rendered admin
card. It should show zero pending grades unless submissions/edits arrived
after the analyzed snapshot. Those must stay pending. Checkpointing must
never resnapshot newer grades at write time or advance to the current wall
clock instead. A concurrent completed review aborts recording; rerun rather
than overwriting it. Grades with missing decision counts remain explicitly
unusable in the stored analysis, even though their submission was reviewed.

Report the decision, sample limits, key held-out metrics, tests, checkpoint
ID and actual pending count, and commit if requested. Do not award report
coins, mark category reports fixed, or backfill Maka coins for a calibration
review; those are separate workflows.
