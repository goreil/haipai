# Post-V2 Backlog

**Date**: 2026-04-20
**Context**: Items raised during the defense-v2 overhaul session (commits `09017d1` → `65984e8`). Open items only — completed items live in git history. Grouped by theme, leanest-first inside each group.

---

## Category refinement

### R-02: Yaku-from-full-hand detection for Bad Riichi + Bad Meld

Common 5A / 4A / 4B cause: the player riichied or melded into a hand that has **no yaku at tenpai**. Riichi itself provides yaku for the closed case, but an open hand needs something else (yakuhai, tanyao, etc.) to win on.

We need "given a 13-tile hand, for each wait tile, what yaku does winning on it satisfy?"

**What we have** (verified 2026-04-21 inside `haipai-app-1`):
- PyPI `mahjong==1.2.1` already in `requirements.txt` (we pull `Shanten` from it in `lib/shanten.py`). Also exposes `mahjong.hand_calculating.hand.HandCalculator.estimate_hand_value(tiles, win_tile, melds=None, dora_indicators=None, config=HandConfig(...))`.
- `tiles` is a **winning 14-tile hand** in 136-tile format (use `TilesConverter.string_to_136_array(man=..., pin=..., sou=..., honors=...)`); `win_tile` is the same format. Meld objects come from `mahjong.meld.Meld`.
- Returns a `HandResponse` with fields `han`, `fu`, `fu_details`, `cost` (dict with `main`/`additional`/`total`), `yaku` (list of yaku objects — `str(y)` gives human names like `"Menzen Tsumo"`, `"Riichi"`, `"Pinfu"`, `"Iipeiko"`), `is_open_hand`, and `error` (`None` on success, otherwise e.g. `'hand_not_winning'`, `'no_yaku'`).
- `HandConfig` carries `is_tsumo`, `is_riichi`, `is_ippatsu`, `is_haitei`, `player_wind`, `round_wind`, plus rule overrides. Defaults produce standard Japanese riichi scoring.
- Confirmed sample call: closed 14-tile hand with riichi + tsumo + pinfu + iipeiko returns `han=4, fu=20, cost.total=5200, yaku=['Menzen Tsumo','Riichi','Pinfu','Iipeiko'], error=None`.

**What we'd add:**
- `lib/yaku.py` exposing `hand_yaku(hand_13_mjai, melds_mjai, round_wind, seat_wind, is_riichi=False) -> {win_tile_mjai: [yaku_name_strs]}`. Internally: compute the tenpai waits via `lib/shanten.py` (we already do this for ukeire), then for each wait tile build the 14-tile 136-format array, call `estimate_hand_value`, and collect yaku names (or the `error` when the wait is yakuless). Needs an `mjai → 136-tile` helper.
- In `categorize_mistake`: when classifying 5A, check whether **every** wait returns `error='no_yaku'` (or empty yaku list with riichi stripped from config for the check). If so, flag `bad_riichi_reason: "no_yaku"`. Same for 4A/4B.
- Store yaku list on the mistake so the UI can say "Mortal avoided opening because no yakuhai was locked in; the melded hand can only win on N, S, W — none yield a yaku."
- Cost: up to 13 `estimate_hand_value` calls per flagged mistake. Keep off the hot categorize path — gate on 5A/4A/4B in the background worker.

### R-03: P4 further split

P4 is still ~30% of all mistakes after the Hand Value split. Possible sub-buckets inside P4:
- **User-backed-calc** (~55% of P4) — pure Mortal-vs-calc disagreement, student can at least think "I aligned with tile efficiency, Mortal saw something else".
- **Tied-ukeire non-value** (~20%) — hand shape / wait quality decisions.
- **User-better-ukeire non-value** (~10%) — Mortal traded ukeire for something without a clear value signal.

Not splitting unless P4 still feels like a dead bucket after R-02 + R-06 land.

### R-04: Yakuless winning-shape labelled as P4 "passed on win"

When `lib/shanten.calculate` sees a 14-tile hand that decomposes into 4 sets + 1 pair, it raises `"hand is already in winning form"` and `categorize_mistake` labels the mistake P4. That text reads as "passed on a win" — but on an **open hand with no yaku**, the player literally cannot declare tsumo. Mortal knows this and recommends reshaping; the categorize pipeline doesn't distinguish because the shanten lib is yaku-blind.

Observed on 3 rows in prod as of 2026-04-21 backfill (mistakes 356, 374, 4441). Needs R-02's `hand_yaku` first. Once it exists, split the P4 branch: if ≥1 yaku is available, keep "passed on win"; if zero yaku, label it "yakuless tenpai / reshape required".

**Not fixing now** — 3 rows is below the threshold.

### R-05: Player-in-riichi flag on mistake records (kan-after-riichi context)

6A / 6B (kan decisions) don't know whether the player is currently in riichi. `lib/parse.py` tracks opponent riichi state per junme but never computes the player's own riichi state. Today the trainer text for a kan-after-riichi decision is generic — it doesn't mention that the hand is locked, that only a wait-preserving ankan is legal, or that revealing a new dora indicator mid-riichi is a genuine risk/reward call.

**What's needed:**
- Extend `lib/parse.py` to track `player_in_riichi` per junme (from the player's own `reach_accepted` event) and propagate it onto each mistake record.
- In `static/app.js`: when the flag is set, render a "RIICHI — your hand is locked" pill on the mistake card.
- Rewrite the 6A / 6B trainer text to branch on the flag.

**Not fixing now** — low volume.

### R-06: Yaku-intent detection to promote P4 Complex → P3 Hand Value

**Motivation (2026-04-21, goreil):** R-02 only catches the binary "every wait is yakuless" case for 5A/4A/4B. The bigger P4→P3 lever is detecting **yaku in progress** — situations where Mortal's discard is preserving a plausible yaku-building plan (tanyao, chanta, junchan, honitsu, chinitsu, toitoi, iipeiko shape…) and the player's discard breaks it. Today the P3 gate in `_classify_push` only fires when the *tile itself* is a yakuhai or dora; any other value-tile reasoning falls through to P4.

**Proposal:** add a `detect_yaku_intent(hand_13, melds, discard_candidate)` helper that returns a list of yaku tags the discard either **preserves** or **breaks**, based on cheap shape heuristics (no full score call needed):

- **Tanyao**: does the hand (minus the candidate) still contain only 2-8 tiles?
- **Honitsu/Chinitsu**: fraction of tiles in the dominant suit. Discarding an off-suit tile when 10+ tiles are already one suit = preserving honitsu.
- **Chanta/Junchan**: every group contains a terminal/honor.
- **Toitoi**: all triplets. High pair-count + no runs in the remainder.
- **Yakuhai pair hold**: extend the existing `labels` path by checking for a *pair* of yakuhai (lone yakuhai is usually a drop, pair is a keep).

Then in `_classify_push` after the current yakuhai/dora check:
```python
intent = detect_yaku_intent(hand, melds, expected_tile)
if intent and not detect_yaku_intent(hand, melds, actual_tile):
    return "P3"   # Mortal's pick preserves a yaku plan the player's pick breaks
```

**Why this is separate from R-02:** R-02 uses `estimate_hand_value` at tenpai to answer "is this hand ever a legal win?". R-06 runs earlier in the hand on **non-tenpai shapes** where `estimate_hand_value` doesn't apply — we need structural heuristics, not a score call. The two are complementary: R-02 catches "you riichied a no-yaku hand", R-06 catches "Mortal was building honitsu and you didn't notice".

**Trainer text wins:** instead of "P4 complex decision", the mistake card can say *"Mortal is shaping a honitsu (11 of 13 tiles are sou) — your 4p kept the shape but 9s breaks it"*.

**Prerequisite:** write a standalone `lib/yaku_intent.py`. Unit-test per yaku against synthetic hands. Tanyao and honitsu alone probably cover >60% of the P4 "Mortal saw something" population — ship those first, add chanta/toitoi/junchan iteratively.

---

## Defense evaluator

### D-02: Audit + surface the per-wait KD weight multipliers

`lib/defense_kd.py` carries 10 tuning constants copied verbatim from the upstream KillerDucky script:

```
C_RYANMEN = 3.5
C_HONOR_TANKI_SHANPON = 1.7
C_NONHONOR_TANKI_SHANPON = 1.0
C_KANCHAN = 0.21
C_KANCHAN_RIICHI_SUJI_TRAP = 2.6
C_URA_SUJI = 1.3
C_MATAGI_SUJI_EARLY = 0.6
C_MATAGI_SUJI_RIICHI = 1.2
C_DORA_GREED = 1.2
C_AKA_DISCARD = 0.14
```

These are opaque magic numbers with no test coverage pinning them to observed behaviour. Two-step plan:

1. **Audit whether they help.** For each mistake in the DB where the kyoku eventually resolves with a visible deal-in or tsumo (we can walk forward in the mjai log), compare two predictions against ground truth: KD with all multipliers applied vs KD with every `C_*` stripped to 1.0. Pick a metric (log-loss or Brier score on per-tile deal-in). Also run per-multiplier ablations — `C_URA_SUJI=1.0`, then `C_MATAGI_*=1.0`, etc. — so we can tell which ones actually contribute.
2. **Branch on the result.**
   - **If a multiplier doesn't improve predictions:** strip it. Less code, fewer unexplained magic numbers, cleaner lineage.
   - **If it does improve predictions:** keep it AND make it visible. Extend each `wait_breakdowns` entry so the UI hover can show which multipliers fired (e.g. "matagi-suji ×1.2 — opp discarded 3m early before reaching"). The panel already renders per-wait contribution; adding the multiplier chain beside each entry turns a black-box number into a teachable read.

Output of (1) should be a short write-up in this backlog before touching code, so we can argue about the metric before committing to a direction.

---

## UI / UX

### U-01: Trends page — swap worst-mistakes for category breakdown

Current trends view lists the user's worst individual mistakes. User wants a **per-category breakdown** instead (how often each P/D code fires, over time). The EV-by-skill-area chart already exists; this would replace the list with something closer to a "where are my weaknesses" view.

### U-02: Trends page — trainer commentary

Add a Haipai-trainer text block on the trends page that:
- Summarises the improvement/regression trend (e.g. "your P2 rate dropped 30% over the last 10 games").
- Lists per-category percentages as a quick table.
- Recommends a focus area based on the biggest weakness.

No model call required; static rules over the trend data are fine. Key recommendations off **EV loss per decision** (U-04 denominators, already shipped), not raw mistake count.

### U-03: Per-sub-category decision-count denominators

**Current state:** per-sub-category EV/D on the trends page (shipped with U-01 / U-02) divides each sub-category's EV loss by the *skill-area* decision count — e.g. EV(P3) ÷ attack-decisions, EV(D3) ÷ defense-decisions. Cheap because it reuses the U-04 denominators, but imprecise: a P3 (hand-value) mistake is only possible when a yakuhai/dora choice exists, and D3 only when an opponent is in riichi *and* basic strategy is ambiguous. Dividing by all attack/defense decisions dilutes both numerator and denominator with irrelevant turns.

**Target:** count decisions where each sub-category was *applicable* and store them alongside the per-category EV. Then EV/D per sub-category becomes an actual rate over the relevant opportunity pool instead of a diluted skill-area rate.

**Scope:**
1. Extend `lib/parse.py::_decision_counts_for_kyoku` (or a new helper) to emit per-sub-category "applicable-decision" counts per round. Definition of "applicable" lives in `lib/categorize/*` — for most cats this is the condition that would have let the rule classify a mistake into that bucket if one had been made.
2. Persist the per-sub-category counts in `rounds_json` and aggregate to `stats_json.decision_counts_per_category` in `lib/categories.py::compute_summary`.
3. Backfill local + Docker DBs (per `backfill_on_change` memory).
4. Expose the new field via `db.practice.get_trends()` and switch `static/js/trends.js` ranking from skill-area denominators to per-category ones.

**Not a near-term commit** — ship after U-01 / U-02 land and we see whether the diluted denominators actually mislead the recommendation. If the shipped strength/weakness call-outs mostly line up with user intuition, the precision gain from this ticket may not be worth the parse-layer surgery and backfill.

---

## Infrastructure

### I-03: Dead-code cleanup in `lib/categorize.py`

Orphaned after the nanikiru cleanup:
- `classify_efficiency` (only referenced from tests)
- `_classify_strategic` (only referenced from tests)

Low priority, but worth sweeping when touching `lib/categorize.py` next.

---

### I-04: Drop backend severity classification — derive in frontend from `ev_loss`

**Code smell:** severity lives in two places. Backend `lib/parse.py::severity()`
produces 3-tier `???/??/?` (thresholds 1.0 and 0.5), stored in
`mistakes.severity` and `stats_json.by_severity`. Frontend
`static/js/categorize-view.js` defines the canonical 4-tier
`severe/mistake/light/unsure` (thresholds 1.0 / 0.5 / 0.2) and maps the 3-tier
keys to display labels in `static/js/trends.js:211` and per-game tier counts
in `static/js/game-list.js:177–180`. Adding the 4th "unsure" tier required
splitting `?` on the frontend by re-reading `ev_loss` — the backend string
is now redundant.

**Target:** remove severity derivation from Python entirely. Backend exposes
only `ev_loss` (already present); frontend derives the tier at render time.
This is the first wedge of the broader "wean logic off the Python backend"
direction (cf. C-03 for the categorization pipeline).

**Scope:**
1. Delete `severity()` in `lib/parse.py`; drop the `severity` column write in
   `RoundRecord` / mistake persistence (`db/mistakes.py`, `db/schema.py`).
2. Drop `by_severity` from `stats_json` (`lib/categories.py::compute_summary`,
   `db/games.py::compute_summary_for_game`). Trends page must instead
   receive `ev_loss` per mistake (or a per-game list of EV losses) and
   compute tier counts in JS.
3. Replace the `"???"/"??"` filter values in `static/js/practice.js:118–119`
   with the 4-tier names; update the practice-mode API filter on the
   backend (`routes/practice.py`) to accept tier names + the EV thresholds,
   or switch to an `min_ev_loss` parameter and let the frontend translate.
4. Backfill: existing rows keep the stale `severity` column until a cleanup
   migration drops it. Per `backfill_on_change` memory, run the DB column
   drop on local + Docker DBs.
5. Update `REFACTOR-TARGET.md` to remove the severity-note footnote once
   backend actually matches the 4-tier (or rather, no longer emits any
   severity at all).

**Blocker for:** U-01 depends on per-game mistake/EV data anyway, so I-04
can be bundled with the trends-page refactor if scope stays tight.

---

## M-02: Reduce P4 "Complex Decision" share (tracking target)

**Goal**: drive down the fraction of mistakes that land in P4 ("Complex decision — no clear signal"). P4 is a fallback bucket — when categorisation fires there, we failed to give the student a specific lesson.

**Current mix** (snapshot 2026-04-21, all users, production DB):

- Query used:
  ```sql
  SELECT category, COUNT(*) FROM mistakes WHERE category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC;
  ```
- Baseline distribution: TODO — run after shipping R-02 or R-06 to record the first data point.

**Tickets that should each nibble P4:**

- **R-06 Yaku-intent detection (tanyao / chanta / honitsu / toitoi)** — the main P4→P3 lever. Structural heuristics on non-tenpai shapes so Mortal's "preserve the honitsu plan" reasoning becomes a recognised P3 signal. Expected to move the largest slice.
- **R-02 Yaku-from-full-hand detection** — moves "closed hand with no yaku at tenpai" out of P4 into 5A `no_yaku` reason / 4A-4B yaku-gate. Catches the tenpai endpoint.
- **R-03 P4 further split** — if P4 is still stubborn after R-02 + R-06.

**How to record progress**: after each merge, append a row here:

| Date | Commit | P1 | P2 | P3 | P4 | D1 | D2 | D3 | Total |
|------|--------|----|----|----|----|----|----|----|-------|
| (seed after R-06) | | | | | | | | | |

Numbers fluctuate as new games arrive, but the P4 *percentage* should trend down if the work is landing.
