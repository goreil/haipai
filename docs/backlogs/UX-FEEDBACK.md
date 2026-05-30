# UX Feedback

**Source**: Direct user feedback + visual audit (2026-04-08)

Open items only. If an item is done, remove it. 

---

## UX-15: Mobile responsiveness (LOW)

The layout doesn't adapt well to narrow screens. The sidebar + content split doesn't work on mobile. The tile images are tiny. Consider a responsive layout with collapsible sidebar.

**Files**: `static/style.css`, `static/app.js`

---



## UX-40: Leaderboard + percentile rank in trends (GROWTH — when we have more players)

Once there are enough users to make comparisons meaningful, add:

1. **Leaderboard view** — a page listing users by EV/decision, best severity tier distribution, etc. Probably opt-in (privacy-friendly alias). Scoped per skill area (push / defense / riichi) so different strengths surface.
2. **Percentile marker on trends** — in the user's trends page, show "you're in the top X% for Defense" next to the per-category EV/decision so the student has a social signal, not just a self-vs-self chart. Computed from aggregate decision_counts + category EV (U-04 already stores the denominators).

Both wait for user volume; leaving as a growth-phase note.

**Files**: new `routes/leaderboard.py`, `db.py` (aggregate queries), `static/app.js` (trends page)

---

## UX-41: Extend KD evaluator to cover open-meld threats (GROWTH — when we have more games)

Currently `lib/defense_kd.py::_extract_threats` skips any opponent without `reach_seen`, so 3+ open-meld threats fall through to the classic suji evaluator in `lib/defense.py`. On the 2026-04-21 production snapshot, only 53 of 476 defense-relevant mistakes (~11%) are open-meld-only — not enough to justify building a second KD branch yet. The UI for those 53 is thinner (no `dealin_rates`, no `suji_partners`, no wait-breakdown panel), but classic-suji `safety_ratings` still fire. Defer until the open-meld slice is big enough that the thinner UI is a visible student complaint or the dataset supports ablation against ground-truth deal-ins.

**Why it's eventually doable:** furiten provides a reliable genbutsu basis even without a declared riichi:
- Permanent furiten: everything in the opponent's own discard pool is safe against ron.
- Temporary furiten: the last go-around of discards (≈ last 3 tiles across all players) is safe until their next draw. Modelling the threat as "as if they riichi'd last turn" captures both.

**What would change vs the riichi path when we do build it:**
1. Relax the `reach_seen` gate; extract genbutsu from the opponent's own pool + last-go-around tiles.
2. Anchor the riichi-pattern multipliers (`C_KANCHAN_RIICHI_SUJI_TRAP`, `C_URA_SUJI`, `C_MATAGI_SUJI_*`) to 1.0 for silent threats — no declared riichi tile to position them against.
3. Scale the combined deal-in probability by `P(tenpai | N open melds)` — a riichi opponent is definitionally tenpai, an open-meld one isn't. Without this scaling the model will systematically overstate danger.
4. Revisit `C_RYANMEN` (3.5×) and the tanki/shanpon balance — open hands skew toward shanpon-on-yakuhai and tanki-on-pair rather than the ryanmen-heavy riichi distribution.

**Threat extraction.** `lib/parse.py::walk_kyoku` is the canonical single-pass walker; `lib/defense.py::_walk_opponents` and `lib/defense_kd.py::_extract_threats` are projections over its raw state. Materialize the open-meld branch as a fourth adapter emitting a shared `ThreatInfo` shape (with `kind: riichi | open-melds`) rather than a fourth walker.

**Files**: `lib/defense_kd.py` (`_extract_threats`, new furiten-based genbutsu), `lib/parse.py` (shared ThreatInfo), `lib/categorize.py` (wire-through)

---

## UX-42: Category reporting improvements (MEDIUM)

Round of improvements to the per-mistake report flow (`category_reports` table, dumped via `scripts/show_reports.py`):

**A) Addressed-report cleanup.** Once a report has been acted on (category rule fixed, explanation text updated, etc.) the row should be **deleted** from `category_reports` so the user is free to file a fresh report on the same mistake — the current unique (user_id, mistake_id) constraint otherwise blocks them. Needs a `scripts/mark_addressed.py` (or similar admin action) that, in one transaction, copies the row's text + game/mistake refs into the pending-notification store used by (D), then deletes it.

**B) "Other bug" report kind.** Current kinds are `agree` / `wrong_category` / `wrong_text`. Add a fourth kind (e.g. `other_bug`) alongside those two wrong-* buttons for anything that doesn't fit either bucket — rendering glitches, wrong tile images, score mismatches, etc. Needs a schema/enum bump plus the UI button.

**C) Auto-growing comment field.** The free-text box on the report UI is fixed-height and awkward for longer writeups. Make it grow vertically with content (CSS `field-sizing: content` or a small JS auto-resize).

**D) "Your feedback was addressed" notification.** When an admin marks a report addressed (see A), the next time that user logs in show a one-shot banner/toast: *"Your feedback «{text}» for game {game} mistake {mistake} has been addressed — thanks!"* Dismissed on view so it doesn't repeat. Because (A) deletes the source row, the notification needs its own persistence — a small `pending_notifications` table (user_id, text, game_id, mistake_id, created_at, seen_at) populated atomically by the mark-addressed action. Depends on (A) landing first.

**Files**: `db/` (schema migration + queries), `routes/` (report submit + notification endpoints), `scripts/show_reports.py`, `scripts/mark_addressed.py` (new), `static/app.js` + `static/style.css` (new report kind button, auto-grow textarea, notification banner)
