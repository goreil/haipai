# Community coins

Status: implemented on 2026-10-19 after the user approved proceeding with
5 coins per Maka grade. Includes a main-page balance, private activity log,
no-use-yet disclaimer, admin award action, and Codex-friendly batch CLI.
See [Community coins operations](../COMMUNITY-COINS.md) and the repository's
`AGENTS.md` for the implemented behavior and award commands.

The proposal and payout review below are retained as planning history;
the previously undecided rate and implementation items have been resolved.

## Intent

Recognize community contributions with coins, superseding the existing manual
report-thanks message workflow. Spending options are undecided; the first
version can show an earned balance and contribution history without a shop.
Preserve historical thanks messages as records.

- Fixed category reports: award **100 × the reported mistake's EV loss** to
  the reporter when an admin confirms the report contributed to a fix.
  Submission alone does not earn coins.
- Maka ratings: reward the overall grade and each per-hand grade. The rate is
  **undecided** and must be chosen before backfilling or enabling these awards.
- Backfill past report thanks and existing Maka grades using the same rules
  as future contributions.

## Payout review

A read-only production review on 2026-10-19 found:

| Contribution | Coverage | Coins |
|---|---|---:|
| Historical report thanks | 7 messages referencing 10 distinct mistakes | 719 |
| Latest completed fix | 11 existing category reports | 829 |
| Report subtotal | Historical thanks plus latest fix | 1,548 |
| Existing Maka grades at a hypothetical 5 coins each | 197 filled grades across 21 games | 985 |
| Existing Maka grades at a hypothetical 10 coins each | Same grades | 1,970 |

The total would be **2,533 coins at 5 per Maka grade**, or **3,518 at 10**.
These are previews, not issued balances. They include admin contributions;
confirm whether admins remain eligible when resuming. Other past fixes without
a surviving thanks message are not covered by this backfill estimate.

The median EV loss across all 85 surviving reports was 0.65, equivalent to
65 coins if the report eventually contributes to a fix. This is not a median
of accepted reports. Rated games had a median of 10 filled Maka grades, making
5 coins per grade a proposed starting point: about 50 coins per typical rated
game. Actual time and usefulness have not been measured. One contributor
provided 195 of the 197 grades, so the selected rate materially affects the
balance distribution. Neither proposed rate has been approved.

## Latest fix to credit when implemented

[Open all 11 reports](https://haipai-trainer.com/#admin?report_ids=221,226,227,233,237,240,242,247,253,271,272)
— reports identified by the user as addressed by the newest fix, totaling
8.29 stored EV loss and therefore **829 coins**.

Use `category_reports.id` from this link, not mistake IDs. Include every
reporter, including the admin, in the preview. Do not lose this pending award
batch while the feature is postponed.

## Historical backfill requirements

The ten historical report rows have been deleted, but their mistakes still
exist. Each referenced mistake belongs to the targeted thanks recipient and
retains its EV loss, allowing reconstruction of all ten awards. Some messages
thank two reports, so do not award once per message.

- Inspect directed `messages` rows with `type = 'thanks'`. Historical `#…`
  references in these messages identify **mistakes**, not report IDs.
- Resolve references against the recipient and mistake ownership. Do not
  interpret arbitrary numbers in message HTML as contribution references.
- Deduplicate repeated references within and across messages and against
  report awards. Explicitly surface missing or ambiguous references instead
  of silently guessing or dropping them.
- Count each nonempty saved Maka overall/per-hand grade once, including
  grades with unknown save dates. Do not invent a historical award timestamp.
- Recompute a dry-run preview against current production data before applying
  the backfill; the figures above are a review snapshot.

## Implementation outline

- Add a persistent ledger with recipient, amount, contribution identity,
  reason, award time, and historical source references. Store the awarded
  amount so later rate or EV changes do not rewrite earned balances.
- Make awards and backfills idempotent and transactional. Editing, clearing,
  or re-entering a Maka grade must not earn another award. Re-submitting a
  report for the same mistake must not earn a second fix award.
- Keep earned coins when a report or game is deleted. Use stable contribution
  identities that remain safe if SQLite reuses deleted integer IDs.
- Replace manual thanks creation with an admin report-fix award action and
  an explicit batch tool accepting report IDs. Show awarded status to admins.
- Show users their balance and contribution history. Include the ledger in
  account exports and account deletion. Do not expose other users' balances
  through public game links.
- Decide whole-coin rounding and treatment of missing, nonfinite, negative,
  or zero EV before implementation. The reviewed values require no rounding.
- Test authorization, duplicate/concurrent awards, backfill reruns, deletion,
  grade edits, ownership, privacy, and historical reference reconstruction.
  Inspect the UI visually and run the repository's full test suite.

Relevant files: `db/schema.py`, `db/reports.py`, `db/games.py`,
`db/messages.py`, `routes/admin.py`, `routes/game.py`, `routes/auth.py`,
`static/js/admin.js`, `static/js/account.js`, `static/js/game-maka.js`, and
`scripts/leave_message.py`.
