# Defense taxonomy reference (Riichi Book 1, Chapter 8)

**Source**: Daina Chiba, *Riichi Book 1* — Chapter 8 "Defense judgement".
Full PDF is `/opt/haipai/Daina_Chiba_-_Riichi_Book_1_en.pdf`; extracted
text at `docs/riichi_book_1_text.txt` (lines ~7974–8900 cover the whole
defense chapter).

**Purpose**: Record the full defense taxonomy so we can, in a future
iteration, write richer per-tile safety labels from first principles.
Phase A of the relicense (commit `fe39a11`) dropped the RT-derived fine
labels (`no-suji 4-6`, `yakuhai last honor`, …) in favor of KD's coarse
three-tier (`genbutsu` / `suji` / `no-suji`). This document is the spec
to aim at if/when we want the finer labels back — written from a
published mahjong textbook, not from an existing codebase.

---

## 1. Push vs. fold (§8.1)

**Only defend when someone has a ready hand.** Rough detection:

| Threat class | Signal |
|---|---|
| **A. Riichi** | Certain — opponent declared |
| **B. Open ready** | 3+ open sets, or flush-suit discards once they're committed to honitsu/chinitsu, or they start discarding every tile they draw (tsumogiri after tenpai) |
| **C. Dama** | Ignored — too hard to detect; modern strategy says dama is rare |

**Haipai today**: riichi → KD defense path, open ready → informational
`threatening_opponent` flag on `cat_data` (no per-tile safety), dama →
nothing.

**Decision rule** — once we think a threat is live, push if **two of
three** conditions are met, otherwise fold:

| Push condition | Fold condition |
|---|---|
| Our hand is ready | Our hand is 1-away or worse |
| High-scoring (≥ 7700 minimum) | Low-scoring |
| Good wait (≥ "stretched single / semi side wait", 2 kinds / 6 tiles) | Bad wait (dual pon, closed, edge, single) |

For 1-away hands, "good wait" means the *best wait achievable in the
worst case* when the hand becomes tenpai.

---

## 2. Absolutely safe tiles (§8.2.1)

Haipai uses killerducky defense calculator. If something shows up as 0%
it's "absolutely safe".

This does not defend against kokushi, but is actually very robust.

---

## 3. Suji (§8.2.2)

6 suji per suit × 3 suits = **18 suji total**.

| Suji | Protorun | Suji | Protorun |
|---|---|---|---|
| 1-4 | 2-3 | 4-7 | 5-6 |
| 2-5 | 3-4 | 5-8 | 6-7 |
| 3-6 | 4-5 | 6-9 | 7-8 |

**Asymmetry rule.** If 5 is genbutsu, then 2 and 8 are suji. But the
reverse does **not** hold: having 2 in genbutsu does *not* make 5
safer, because the 5-8 side wait is still possible. **5 is only safer
when both 2 and 8 are genbutsu.**

| Genbutsu discard | Becomes suji |
|---|---|
| 5 | 2, 8 |
| 6 | 3, 9 |
| 7 | 4, 1 |
| 2 and 8 | 5 |
| 3 and 9 | 6 |
| 4 and 1 | 7 |

### Suji traps

- **Immediate suji trap**: the threat's wait is the suji of their own
  riichi declaration tile. Common because of double-closed shapes
  (1-3-5, 2-4-6, 3-5-7…). The **tile discarded on riichi itself gives
  suji that's at least as dangerous as no suji at all.**
- **Early vs. late suji**: suji from early discards is reliable
  (opponent likely not shaping around those tiles); suji from late
  discards is dangerous (opponent may have been holding the
  double-closed shape). Late-discard suji approaches non-suji safety.

**Haipai today**: KD tracks suji but doesn't separately tag
immediate-suji-trap / early-suji / late-suji. KD's multipliers do some
of this implicitly (the `C_KANCHAN_RIICHI_SUJI_TRAP=2.6` constant; see
D-02 in POST-V2.md).

---

## 4. Kabe (tile blockade) (§8.2.3)

When **all four** of a number tile are visible (in discards, dora
indicator, our own hand), it forms a **blockade** — certain suji-wait
shapes are impossible.

| Blockade (all 4 visible) | Tiles made safe (no-chance) |
|---|---|
| 1 | none |
| 2 | 1 |
| 3 | 1, 2 |
| 4 | 2, 3 |
| 5 | 3, 7 |
| 6 | 7, 8 |
| 7 | 8, 9 |
| 8 | 9 |
| 9 | none |

**No-chance vs. one-chance vs. double one-chance.** Partial blockades:

| Visible count | Name | Notes |
|---|---|---|
| 4 of N visible | **No chance** | Full blockade; adjacent suji waits containing N are gone |
| 3 of N visible | **One chance** | Safer than non-suji, less safe than no-chance. Reliable in early turns; degrades by mid-late |
| 3 of N + 3 of N+1 both visible | **Double one chance** | Between no-chance and plain one-chance |

**One-chance reliability** is higher when *we* hold the missing copies
(concealed set / pair in hand) than when they're merely absent from the
discard pool — an opponent whose winning tile is a visible-in-public
one-chance is *more* likely to have chosen riichi precisely because the
tile looks safe to other players.

### Blockade × suji composition

Combine both: e.g., if 1m has a full blockade and 7m is genbutsu, then
4m is safe (no 2m-3m protorun possible → no 1-4 suji wait, and 7m
genbutsu kills the 4-7 suji wait).

---

## 5. Full safety ranking — Table 8.5

Daina's 14-tier ranking (top = safest). "Fourth" / "third" / "second" /
"first" refer to how many copies of the tile have already been
discarded.

| Rank | Tile category |
|---|---|
| 100% | Genbutsu |
| AAA | Fourth suji terminal; fourth honor |
| AA | Third suji terminal; third honor |
| AAA+ | Second suji terminal |
| A | Second valueless-wind honor; first suji terminal |
| BBB | Second honor (any) |
| BB+ | Suji 4/5/6; no-chance tile |
| BBB | Suji 2/8 |
| CC | Suji 3/7; one-chance (early turns) |
| C | First honor |
| DDD | Non-suji terminal |
| DD | One-chance (late turns) |
| D | Non-suji 2/8 |
| — | Non-suji 3/7 |
| — | Non-suji 4/5/6 (most dangerous — caught by *two* suji) |

(The extracted text lost a couple of bottom-tier rank labels; body text
confirms non-suji 4/5/6 is strictly worst because it's vulnerable to
both 1-4 and 4-7 suji waits. 3/7 is next worst — edge-waitable. 2/8
next — can't be edge-wait. Terminals least bad — neither closed nor
edge-waitable.)

---

## 6. Defense rules against riichi (§8.3)

Rank-based push thresholds:

- Hand not ready (hopeless turns): **don't discard Rank D** against
  riichi (unless you have both really good wait AND really high score —
  implying you'd push to tenpai).
- Pushing from 1-away: **Rank C or safer.** If you have a guaranteed
  mangan, Rank D becomes acceptable.
- Pushing from 2-away or worse: **Rank B or safer.** Below that, you
  must betaori (full fold).

### When stuck with no safe tile

- **Pairs / concealed sets**: if you have a pair of the same suit-tile,
  one copy is a safer-than-random draw (tile chunks principle).
- **Avoid yaku-amplifiers**: don't discard terminals into tanyao-likely
  hands; avoid dora and tiles adjacent to dora.
- **Outside early discards**: tiles outside the opponent's earliest 1-2
  discards are relatively safe — they weren't worth keeping as
  protoruns.

### Adjustments

| Factor | Adjustment |
|---|---|
| We're ahead on points | Lean more defensive (especially in South round) |
| We're behind on points | Lean more aggressive |
| Early turn (lots of draws left) | More aggressive OK |
| Late turn (3 or fewer draws) | More defensive; **live-suji count drops fast** — each discard kills at most 2 suji, so by the 15th turn the per-tile deal-in conditional climbs from ~1/16 to ~1/2 |
| Opponent profile: old-school | Suji is more reliable (they only riichi on good waits) |
| Opponent profile: modern | Suji is less reliable (they riichi on bad waits too) |

---

## 7. Defense against open hands (§8.4)

### Ready-hand signals

Assume opponent is ready if **any** of:

1. 3+ open sets (pon / chi / daiminkan).
2. They're clearly going flush (honitsu/chinitsu) and start discarding
   tiles in the suit they were collecting.
3. They keep discarding the tile they just drew (tsumogiri pattern =
   already tenpai).

### Value estimation

When reading open threats, estimate cost before deciding how hard to
defend:

- **Open dora set** → ≥4 han on dora alone, usually expensive.
- **Red fives** in an open meld → +1 han each, cumulative with seat/round
  wind yakuhai.
- **Flush (honitsu/chinitsu)** → typically 3900 min, haneman in chinitsu
  cases. Fold on unwanted suit-specific draws.
- **Yakuhai open set** (value tile pon) → ≥1 han guaranteed, often
  combined with another yaku.
- **Cheap-looking open hand** (tanyao-only, fanpai-only) → don't over-defend.

---

## 8. Gap analysis vs. Haipai today

| Feature | Today | Book taxonomy |
|---|---|---|
| Threat detection | Riichi only (KD); informational flag for 3+ open melds | Full (A/B/C — riichi, open ready, dama) |
| Push/fold principle | Not modeled explicitly; categorize pipeline flags D1/D2/D3 after the fact | 2-of-3 condition rule |
| Coarse labels | `genbutsu` / `suji` / `no-suji` | 14-tier (Table 8.5) |
| Fine labels | **Removed in Phase A** (was `suji 4-6`, `yakuhai last honor`, etc.) | The exact vocabulary to write fresh labels |
| Suji types | KD internally distinguishes `matagi_early` / `matagi_riichi` / `ura_suji` / `kanchan_riichi_suji_trap` as *multipliers* on the probability model | Immediate vs. early vs. late suji trap as a *categorical* distinction |
| Kabe / no-chance / one-chance | Not modeled | Table 8.3, double-one-chance, late-turn decay |
| Suji honor tiles | Flat "honor tile" | Rank by count remaining (first / second / third / fourth honor) — Haipai does this via `safety_ratings` numbers but not via labels |
| Open-hand defense | Removed in Phase A | §8.4 full rules |
| Turn / position adjustments | Not modeled | §8.3.2 — live-suji denominator, ahead/behind, turn-count |

---

## Possible follow-ups (not scheduled)

- **Restore fine labels** from first principles — straightforward table
  lookup using the taxonomy above. Would restore `safety_label_text` to
  a level of detail comparable to what RT used to produce, written
  fresh from this book.
- **Model one-chance / no-chance** in the KD safety pipeline. Currently
  kabe isn't tracked; tiles that are absolutely safe by §8.2.1.3/.4
  fall through to whatever suji score they'd get.
- **Turn-weighted suji reliability.** KD's tuning constants are fixed;
  the book argues suji reliability decays monotonically with turn
  number, and late-turn suji approaches non-suji danger.
- **Live-suji count as a UI signal.** Trivial to compute (18 minus
  denied), and the conditional-deal-in math is very teachable (§8.3.2).
