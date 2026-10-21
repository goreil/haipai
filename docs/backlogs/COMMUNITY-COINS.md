# Community coins

Status: implemented on 2026-10-19 after the user approved proceeding with
5 coins per Maka grade. Includes a main-page balance, private activity log,
no-use-yet disclaimer, admin award action, and Codex-friendly batch CLI.
See [Community coins operations](../COMMUNITY-COINS.md) and the repository's
`AGENTS.md` for the implemented behavior and award commands.

The feature-request proposal below is backlog work, not implemented behavior.
The original coin proposal and payout review that follow it are retained as
planning history; their previously undecided rate and implementation items
have been resolved.

## Backlog: public feature requests supported with coins

Added 2026-10-21. Give community coins a meaningful use by letting contributors
submit feature requests and support existing ones. All requests are visible to
everyone. More committed coins place a request higher in the feature-request
list. Rejected requests refund their contributors.

### Proposed first version

- Require **100 coins to create a request** as an initial threshold. Allow
  smaller contributions to existing requests; choose that minimum before
  implementation. Encourage searching for an existing request before posting.
- Rank by the **total coins committed by all supporters**, including the
  creator. Show both coins and distinct supporter count, for example
  **500 coins · 12 supporters**.
- Offer **Most supported**, **Newest**, and **Recently updated** views so new
  requests can be discovered alongside established ones.
- Show a clear status: **Open**, **Planned**, **In progress**, **Shipped**,
  **Declined**, or **Cancelled**. Keep decisions and a short explanation public.
- Keep bug reporting free. Spending coins must never be required to have an
  incorrect explanation or another defect investigated or fixed.

### Proposed coin lifecycle

- Reserve coins when a user creates or supports a request; show available
  coins separately from reserved coins so they cannot be committed twice.
- Allow withdrawal while a request is Open or Planned. When work begins,
  lock contributions; explain this rule before the user contributes.
- Spend reserved coins only when the feature ships. Acceptance or planning
  alone does not spend them.
- Automatically refund **every contributor** if a request is declined or
  cancelled, including cancellation after work begins. Record refunds in the
  user's private coin history and notify affected supporters.
- Merge duplicate requests while preserving support and contribution history.
  Let users reclaim duplicate contributions created by a merge.

### Expectations and fairness

Coin support expresses demand; it does not purchase a delivery commitment.
Place this explanation beside the contribution action:

> Coins help show which features the community wants. Higher support does not
> guarantee development or a delivery date. Coins are refunded if the request
> is declined or cancelled.

Publish status updates and review requests regularly. An indefinitely pending
request can leave users feeling their coins are trapped. Coin balances reflect
past contributions and can be concentrated among a few people; supporter counts
help distinguish broad interest from a large contribution by one person.
Keep individual balances and private coin activity private when displaying
public request totals.

### Decisions and validation before implementation

- Check the current balance distribution and typical effort needed to earn
  100 coins before making the creation threshold permanent. Avoid excluding
  most newer contributors.
- Choose the minimum support amount, tie-breaking rule, and review cadence.
- Define what counts as shipped, especially if only part of a request is
  delivered; do not spend coins against materially changed scope without a
  clear policy communicated before contribution.
- Confirm withdrawal and locking rules, and decide how stale requests are
  reviewed or closed with refunds.
- Validate the create/support flow, insufficient-balance explanation,
  withdrawal, status updates, duplicate merging, and refund experience on
  desktop and mobile. Verify coin operations are transactional, cannot
  overspend a balance, and cannot issue duplicate refunds.

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
