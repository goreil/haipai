# Community coins

Community coins recognize contributions to Haipai. The main page shows the
signed-in user's balance as a compact coin icon and number beside **Trends**.
Click it to open a private activity log. Maka awards appear as one all-time
total; individual report awards show the mistake ID, the original report text
when still available, the award date, and the coin amount. Fix descriptions
are omitted from the Activity page. Mistake IDs link to
the card when it still exists and belongs to the viewer. Historical report
quotes are recovered only from explicitly attributed thanks-message quotes.
Report awards are paginated separately from the Maka total. The log includes the small
disclaimer that coins have no use yet.

## Earning coins

- Submitting any category-report issue earns **10 × its stored EV loss**,
  rounded to whole coins with half-up rounding. The save confirmation shows
  the coins earned immediately and updates the balance. Each user earns this
  once per mistake; edits, Undo, and resubmissions do not pay again. Reporting
  and its award commit together. This applies to new submissions, without a
  historical backfill.
- A category report that contributes to a fix earns **100 × its stored EV
  loss** in addition, rounded to whole coins with half-up rounding. An admin awards it
  after the fix. All reporters, including admins, are eligible.
- Each filled Maka overall or per-hand grade earns **5 coins**, once per
  field. Saving a grade and awarding its coins happen in the same transaction.
  Editing, clearing, and re-entering a grade do not earn additional coins.
  The save confirmation shows the newly earned amount immediately.
- Awards preserve the amount and explanation at issuance. Later changes to
  rates, grades, or EV do not rewrite earned balances. A missing, negative,
  nonfinite, or implausibly large EV requires review; zero EV earns zero.

The **Gain coins** card shows up to five of the viewer's own unreported complex
hands, ordered by EV loss, with the reporting reward and a direct hand link.
Hands with prior reports or reporting awards are excluded. The browser prepares
and categorizes games with the same live pipeline as the game view, searching
all eligible hands rather than limiting results to a page of games. Analysis
stops once the five highest-EV complex hands are found; leaving the page stops
further game loads. Analysis failures show an error instead of a partial ranking.
Accounts with many games may take longer to analyze.

## Awarding a fix from Codex or a terminal

Use category report IDs (`R-12` means `12`), never mistake IDs. Preview first:

```bash
docker compose exec -T app python scripts/community_coins.py \
  --report-ids 12,34 --reason "Corrected the visible comparison"
```

Then run the same command with `--apply` to issue the awards. The optional
reason is retained in the award record for reference, but hidden from the
Activity page. Output is JSON containing new awards, amounts, recipients, and
resulting balances. The default preview
uses an in-memory database copy; it does not write to production. Missing
reports or invalid EV abort the complete batch. Repeating an applied batch
issues no additional coins.

For local use, run `.venv/bin/python scripts/community_coins.py --db PATH`
with the same options. Schema initialization is owned by app startup;
`--apply` expects the migration to have run. The admin UI's **Fixed · award
coins** button calls `POST /api/admin/category-reports/<report_id>/award`,
which accepts an optional JSON `reason`. Admin authentication and CSRF apply.

Keep fixed reports as resolution history. The log survives deletion of games,
reports, and historical messages, and is deleted with the recipient's account.
It is included in account data exports. Coin balances and history are not
part of public shared-game responses.

## Historical backfill

`--backfill-thanks` reconstructs awards from directed historical thanks
messages and verifies referenced mistake ownership. Some messages reference
multiple mistakes. Missing or ambiguous references abort the batch for manual
review. Message titles use mistake IDs, not report IDs. `--backfill-maka`
awards each currently filled grade, including those with no known save date.
Both options support preview and `--apply` and can be combined with report IDs.
The ledger timestamps when coins were issued, not an invented contribution date.

The launch batch includes seven historical thanks messages covering ten
mistakes (719 coins), the latest fix's eleven reports (829 coins), and 197
Maka grades (985 coins): **2,533 coins across six contributors**.

[Latest fix's 11 credited reports](https://haipai-trainer.com/#admin?report_ids=221,226,227,233,237,240,242,247,253,271,272).
Other historical fixes without a surviving thanks message are outside this
backfill's coverage. Historical messages remain readable; the old
`leave_message.py --type thanks` workflow directs operators to coin awards.

## Persistence and verification

`community_coins` is an append-only award ledger with a unique recipient,
contribution kind, and source key. Games and mistakes lazily receive random
`coin_key` identities, so integer row-ID reuse cannot suppress an unrelated
contribution. Report re-submission and historical thanks share a mistake's
identity and cannot create duplicate awards. Award writers use transactions
and the database uniqueness constraint to handle concurrent requests.

Regression coverage lives in `tests/test_community_coins.py`: authorization,
rounding, invalid EV, duplicate and concurrent awards, grade edits, historical
reconstruction, transactional failures, CLI preview/application, pagination,
account export/deletion, privacy, migration, and SQLite ID reuse. Desktop and
mobile browser checks cover balance display, activity pagination, and the
admin award action.
