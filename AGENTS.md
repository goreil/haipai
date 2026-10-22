# Repository Guidelines

## Project Structure & Module Organization

`app.py` creates the Flask application. HTTP blueprints live in `routes/`, while SQLite access is grouped by domain in `db/` (`db/schema.py` owns schema and migrations). Shared parsing and mail helpers belong in `lib/`. Browser code and styles are under `static/`; Jinja pages are in `templates/`. Python tests live in `tests/`, with reusable JSON inputs in `tests/fixtures/`. Operational and analysis utilities belong in `scripts/`, and longer design notes belong in `docs/`.

The repository also contains independent components: the Elm client in `riichi-mahjong-trainer/`, the Rust/WASM shanten engine in `wasm/haipai-shanten/`, and browser extensions in `extension/` and `extension-firefox/`. Read nearby documentation before changing these areas.

## Maka grading calibration

For Maka grade analysis or grading-threshold calibration, read
[the maka-calibration skill](.claude/skills/maka-calibration/SKILL.md).
Complete its admin review checkpoint after a finished analysis, including
when thresholds remain unchanged; keep explicitly read-only investigations read-only.

## Report-driven fixes and regression tests

When investigating or fixing a category-report issue, read
[the category-reports skill](.claude/skills/category-reports/SKILL.md).
For a requested fix, the completion criteria are: find all related reports
across users and report kinds, fix and validate the bug, award coins to all
eligible reporters of the affected hands, and add regression tests derived
from those concrete hands, then mark completely resolved reports **fixed**.
A request to fix a reported issue includes coin awards and marking it fixed
under the rules below unless the user explicitly excludes them;
read-only investigation does not authorize awards or status changes.

Preserve the affected hand inputs before any report cleanup. Tests must target
the specific bug, demonstrate failure before the fix and success afterward,
and run without the production database. Deduplicate identical test inputs
while retaining the mapping to every matching report ID. Preserve reports as
fixed history instead of deleting them. Mark a report fixed automatically only
when all issues in that report are resolved, fixtures are saved, tests pass,
and coin awards are verified. Leave partially resolved reports open.
Report matching IDs, test coverage/results, actual award totals, and IDs marked
fixed; explicitly state any unavailable data or unfinished step.

## Admin Report ID Filter (Codex Handoff)

When asked for all report IDs for a problem/category, return a clickable admin link containing all matching **`category_reports.id`** values, deduplicated. Include the count and a brief description of the matching criteria. Do not truncate the list to the current admin page size. If there are no matches, say so instead of generating an empty link.

Link format (illustrative IDs):

```text
https://haipai-trainer.com/#admin?report_ids=12,34,56
```

Use the relevant deployment's origin when working outside production. Keep `?report_ids=` **after `#admin`**; this is a browser hash route. Opening the link automatically sets Report status to **Open and fixed**, Players to **All reports**, Report kind to **All kinds**, Reports per page to **Unlimited**, and the first page, then scrolls to the report controls. This shows every existing report in the list, even when there are more than 50 IDs or prior filters would hide them. Normal admin authentication is required; if signed out, sign in and reopen the link. Missing/deleted IDs cannot be shown. Empty or malformed ID lists display an error instead of showing unrelated reports.

If the user asks for the raw list, provide a single comma-separated line in a plain code block for the manual filter:

```text
12, 34, 56
```

Use the report ID shown as `R-12` on the report card, but output just `12`. Do not output mistake IDs (`mistake_id`, `#m…`, or the adjacent `#…` on the report card), game IDs, ranges, or JSON arrays. The filter accepts positive integer IDs separated by commas, whitespace, or semicolons, with optional `#` prefixes; prefer the plain comma-separated format above.

To view the result: **Admin → Category reports → Report status: Open and fixed → Players: All reports → Report kind: All kinds → Filter by report IDs → paste → Apply filter**. Select **Reports per page: Unlimited** to see every match together, or use Previous/Next. The ID filter intersects with the status, player and report-kind filters; the default Other player reports scope hides the admin's own reports. Clear removes the ID filter. Select **Fixed reports** for resolution history (original feedback, hand, fix date and description). Fixed reports disappear from the user's hand; a new submission creates a new open report without overwriting history.

For investigation, report persistence and joins are in `db/reports.py`, the admin API is `/api/admin/category-reports` in `routes/admin.py`, and filter parsing is `parseAdminReportIds` in `static/js/admin.js`. Match the requested problem using report reasons and relevant mistake context; a problem category is not necessarily the stored report `kind` (`wrong_text`, `complex_gap`, or historical `wrong_category`). Base the list on inspected data and state any limits on coverage.

## Community coins after report fixes

For a report-driven fix under the workflow above, or when a user asks to credit
a fix, use the coin award tool directly. Awards are authorized together with
the fix; do not ask for the same permission again. Awards use
**category_reports.id**, the `R-…` card ID, and
credit **100 × stored EV loss**, rounded to the nearest whole coin (half up).
An award is issued once per reporter and mistake, including across report
resubmissions and historical thanks backfills. Admin contributions are eligible.

From the production checkout, preview the exact batch and then apply it:

```bash
docker compose exec -T app python scripts/community_coins.py --report-ids 12,34,56
docker compose exec -T app python scripts/community_coins.py --report-ids 12,34,56 --apply
```

For a local database, use the checked-in virtual environment and an explicit
path: `.venv/bin/python scripts/community_coins.py --db /path/to/games.db
--report-ids 12,34,56`, adding `--apply` after inspecting the preview. The script
prints JSON with new award entries, recipients, and resulting balances. With
no `--apply`, it works on an in-memory copy and leaves the source untouched.
Add `--reason "Short description of the fix"` to retain context in the award
record. Fix descriptions are hidden from the Activity page. Missing reports
or invalid EV abort the entire batch. Repeating a successful batch issues no
additional coins. Award after validating the fix. Once regression coverage is
complete and every issue in each selected report is fixed, preview and apply
the completion batch with `--mark-fixed --reason "Short description of the fix"`
added to the commands above. This awards any unpaid coins and marks the reports
fixed in one transaction; repeats preserve the original resolution and pay
nothing extra. Output includes `fixed_report_ids`. For already awarded reports,
use the same command to mark them fixed. Do not include partially fixed reports
in this batch. Report the actual awarded count, amount, and fixed IDs to the user.

Use `--backfill-thanks` / `--backfill-maka` only for an explicitly intended
historical backfill. Maka grades automatically earn 5 coins on their first
save per overall/per-hand field; edits and clearing/re-entering do not pay
again. Historical thanks references identify mistakes and must be matched to
the message recipient. Do not create new manual `thanks` messages; award coins
instead. Historical messages remain readable. The admin UI offers the same
operation via **Fixed · award coins** on each report card, and users can open
the coin icon and balance beside **Trends** to view their ledger.

## Build, Test, and Development Commands

Use the checked-in virtual environment; system Python may lack project dependencies.

```bash
FLASK_ENV=development .venv/bin/python app.py  # local server on :5000
.venv/bin/pytest tests/ -v                    # complete Python suite
.venv/bin/ruff check .                        # Python lint checks
docker compose up -d --build                  # build and start production stack
docker compose logs -f app                    # follow application logs
```

For the Elm subproject, run `npm test`, `npm run format`, or `npm run review` from `riichi-mahjong-trainer/`. Rebuild web WASM with `scripts/wasm_build_web.sh` after Rust changes.

## Coding Style & Naming Conventions

Use four-space indentation and `snake_case` for Python functions/modules; use `PascalCase` for classes. Ruff enforces `E`, `F`, and `W` rules with a 120-character line target. Keep route handlers thin and put persistence logic in `db/`. Existing JavaScript uses lower camel case and scope-based `style-*.css` files. Preserve Elm formatting with `elm-format`; format Rust with `cargo fmt`.

Inspect UI changes visually and make sure they look aesthetically pleasing.

Haipai trainer text must only explain information already shown in the card's visuals
(tiles, badges, feature pills, tables, and board). Do not add new strategic claims,
hidden scoring patterns, or speculative reasons for Mortal's choice. Suppressed
dimensions must stay out of the text as well as the visuals. When the displayed
comparison cannot explain the recommendation, say so without guessing why.

## Testing Guidelines

Pytest discovers `test_*.py`, `Test*` classes, and `test_*` functions. Add regression tests beside the affected API or database area and reuse fixtures from `tests/fixtures.py` or `tests/fixtures/`. Run the full suite before submitting; use `--cov` when evaluating coverage. Component-specific changes should also run their Elm or Rust tests.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, feature-scoped subjects, such as `Account: leaderboard display name`. Follow that `Area: outcome` pattern when practical. Keep commits focused. Pull requests should explain user-visible behavior, identify migrations or configuration changes, link relevant issues, list tests run, and include screenshots for UI changes. Never commit secrets, `.env`, local databases, analysis output, or generated backups.
