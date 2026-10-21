---
name: category-reports
description: Investigate and fix user-submitted category reports (complex_gap / wrong_text / legacy wrong_category), including related-report discovery, reporter coin awards, regression tests from affected hands, and preserving completed reports as fixed history. Use when checking category reports, investigating categorization complaints, or fixing reported categorization or explanation bugs.
---

# Category reports

Production reports live only in the Docker DB at `/app/data/games.db`. The local `games.db` typically has none.

## Workflow for a reported fix

Read [AGENTS.md](../../../AGENTS.md) for the report-driven fix requirements,
admin report links, and coin award commands. Keep investigation requests
read-only; when the user requests a fix, complete the following workflow unless
the user explicitly narrows it.

1. **Find all related reports.** Start with the `show_reports.py --status all --json`
   dump and inspect the underlying hands. Match the actual bug using report
   reasons and mistake context across all users (including admins), report kinds,
   and dates. Include every report of the affected hands; deduplicate
   `category_reports.id`, not reporters or mistakes. A similar tag alone does
   not prove the same bug. Return the complete admin link and count as described
   in AGENTS.md, and state any coverage limits. Preserve the hand inputs now so
   the reproductions are available independently of the live database. Fixed
   reports provide history; distinguish them from open work and do not infer
   that a new report on a previously fixed hand is already resolved.
2. **Develop and apply the fix.** Reproduce the incorrect behavior from the
   reported inputs, fix its cause, and validate the affected hands. Follow the
   client-side categorization/version guidance below when applicable.
3. **Award coins.** After validating the fix, preview and apply the exact matching
   report-ID batch using `scripts/community_coins.py` and the commands in
   AGENTS.md. The report-driven fix request includes these awards unless excluded
   by the user. Let the tool enforce eligibility and duplicate-award rules;
   include all matching reports even when several reporters supplied the same
   hand. Verify and report the actual new award count and total coins.
4. **Complete regression coverage from the affected hands.** Save reusable inputs
   under `tests/fixtures/` and add tests in the affected component's existing
   suite. Cover each distinct affected hand, deduplicating identical inputs while
   retaining all source report IDs in fixture metadata or test comments. Preserve
   the tiles, melds, actions, board context, and derived inputs needed to reproduce
   the bug; exclude unrelated account details. Recompute derived values with the
   real preparation code or retain the concrete values used by the failing path.
   Tests must run without production DB access or live services and assert the
   specific corrected behavior, rather than merely checking that code runs or
   copying the new output into a snapshot. Verify failure against the pre-fix
   implementation and success with the fix. Add nearby valid cases when needed
   to catch an overbroad fix. Run the repository's required checks.
5. **Mark completed reports fixed automatically.** After the fix is validated,
   regression tests are saved and passing, and awards are verified, preview and
   apply `scripts/community_coins.py --report-ids ... --mark-fixed --reason "..."`
   using the deployment/local DB commands in AGENTS.md (`--apply` for the write).
   The command issues any unpaid awards and records fixed status atomically;
   already awarded reports receive no duplicate coins. Include only reports
   whose entire complaint is resolved; leave partially fixed reports open even
   if one issue earned an award. Retain a concise fix description and verify
   `fixed_report_ids` plus the fixed history. This completion step is part of
   the fix request and needs no repeated permission. Never delete reports as
   fix cleanup.

Tests may be written during reproduction and fix development; they are a
required deliverable before declaring the fix complete. For an existing example,
see `tests/fixtures/yaku_report_guards.json` and `tests/test_yaku_guards.js`.
If data or execution access is unavailable, identify the incomplete
step instead of claiming completion. Summarize matching report IDs, the fix,
regression coverage and results, verified coin totals, and reports marked fixed.

## Read the most recent reports

```bash
docker exec haipai-app-1 python3 /app/scripts/show_reports.py
```

The dump is sorted newest-first and includes the mistake's ev_loss and turn, plus the report's kind and the user's suggested category / reason. (Category is **not** stored on the mistake — it's recomputed client-side, so the dump can't show a "current category".)

## Useful filters

```bash
# Only complex_gap reports (the EXTRAS-A "what did Mortal read?" funnel on
# complex cards). The dump tallies the quick-tags and labels suggested_category
# as `tags:` for this kind.
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --kind complex_gap

# Since a date
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --since 2026-04-01

# Single mistake (when the user references one)
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --mistake 5747

# Machine-readable open reports
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --json

# Fixed history (original feedback plus fix date, actor and description)
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --status fixed --json

# Include both open reports and fixed history when finding related hands
docker exec haipai-app-1 python3 /app/scripts/show_reports.py --status all --json
```

`--status` defaults to `open`; `fixed` and `all` are also available in the admin
API as `?status=fixed` / `?status=all` and in the **Report status** selector.
The admin **Fixed · award coins** / **Mark fixed** action completes a validated
report and awards any unpaid coins. Fixed reports are hidden from the user's
hand, and a new submission preserves the original fixed report as history.

`--kind` is one of `complex_gap`, `wrong_text`, `wrong_category` (legacy).
For `complex_gap`, `suggested_category` holds the comma-joined quick-tags
(wait_quality / score_pressure / safe_tile_mgmt / shape), not a category code.

## Inspecting the underlying mistake

The `mistakes` row stores only `data_json` (TEXT) plus `ev_loss`, `turn`, `note`
— there is **no `category` column** (`r['category']` will KeyError). Category is
recomputed client-side from `data_json`; to see what category a mistake *gets*,
trace `data_json` through `static/js/categorize.js`. Live `data_json` keys:
`actual`, `expected`, `draw`, `shanten`, `hand`, `melds`, `top_actions`,
`labels` (all rows); `board_state` (most); `opponent_discards` +
`safety_ratings` (defense rows only). Discard stats are **not** stored — the
frontend recomputes them via backend shanten/ukeire endpoints.

```bash
docker exec haipai-app-1 python3 -c "
import sqlite3, json
conn = sqlite3.connect('/app/data/games.db')
conn.row_factory = sqlite3.Row
r = dict(conn.execute('SELECT * FROM mistakes WHERE id = 5747').fetchone())
dj = json.loads(r['data_json'] or '{}')
print('actual:', dj.get('actual'), 'expected:', dj.get('expected'))
print('labels:', dj.get('labels'), 'ev_loss:', r['ev_loss'])
"
```

## After a categorization fix — no backfill

Categorization is **100% client-side** (`static/js/categorize.js`) and recomputed
on every fetch; the category is never persisted. So a categorizer fix needs **no
DB backfill** — there is no `recategorize_all.sh` (it was removed). Just ship the
`categorize.js` change and bump `CATEGORIZER_VERSION` + its changelog. (Backfills
are only for changes that alter stored `data_json` fields — see the parse/defense
backfill functions, not categorization.)
