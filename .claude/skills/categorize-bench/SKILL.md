---
name: categorize-bench
description: Benchmark mistake-categorization changes with scripts/category_bench.mjs — fast category distribution + P4/D3 "complex decision" headline over a frozen ~2000-mistake sample, with baseline deltas. Use when changing static/js/categorize*.js or the prep pipeline (static/js/prep/, esp. defense*.js) and you need to measure how the category distribution shifts, or when the user asks to "benchmark categorization".
---

# Categorization benchmark

`scripts/category_bench.mjs` measures how a categorization or prep change shifts
the category distribution. The headline metric is **P4 + D3 "complex decisions"**
— the catch-all buckets we are trying to shrink by teaching the categorizer more
specific rules (e.g. open-meld defense).

## Workflow

```bash
node scripts/category_bench.mjs --baseline   # BEFORE the change: save baseline
# ...edit categorize.js / prep modules...
node scripts/category_bench.mjs              # AFTER: prints Δ per category +
                                             #   "vs baseline" headline delta
```

Runs the real browser pipeline (`prepGame` → `categorize`) headlessly over a
deterministic ~2000-mistake sample (51 games, strided across the snapshot).

## Speed model — why it's fast and when it isn't

Prepped mistakes are cached in `.cache/category-bench/` keyed by a hash of
`static/js/prep/**`:

- **categorize-only edits**: cache hit, ~0.5s per run
- **any prep edit** (defense, shanten, board state): one automatic ~35s
  re-prep, then back to ~0.5s

All prep dependencies live inside `static/js/prep/` — if that ever changes
(a prep module requiring a file outside the dir), the cache hash in
`category_bench.mjs` must be extended or it will serve stale results.

## Data source — never touch prod

The script reads only the frozen snapshot in `.cache/category-stats/`
(games.db + mortal_analysis/). It never talks to the prod container. If the
snapshot is missing or you want fresher data, sync once with:

```bash
node scripts/category_stats.mjs --prod
```

After a re-sync the sample changes, so re-save the baseline (`--baseline`);
the script warns and hides deltas if the baseline came from a different sample.

## Flags

- `--baseline` — save this run's distribution as the comparison baseline
- `--target N` — sample size (default 2000)
- `--reprep` — force prep-cache rebuild
- `--verbose` — show suppressed prep warnings
- `--db` / `--mortal-dir` — override the snapshot location

## Related scripts

- `scripts/category_stats.mjs` — same pipeline over **every** game (~4min on
  the full snapshot); use for final numbers, `--prod` to re-sync the snapshot.
- `scripts/snapshot_categorize_fixture.mjs` — re-snapshots the regression
  fixture `tests/fixtures/categorize_parity.json`; run after an intentional
  categorizer change so tests pass. Not a benchmark.
