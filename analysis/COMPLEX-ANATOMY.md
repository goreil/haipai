# Anatomy of the Complex bucket

**Backed by real sampled data.** 120 shape=complex mistakes were sampled from
a fresh sync of the production DB and classified one by one; no part of the
distribution below is inferred from reading code.

## Method

- Synced prod (`games.db` + all 609 mortal files) into
  `.cache/category-stats/` and ran the real pipeline headlessly
  (`prepGame` → `categorize` → `compareDimensions`), the same way
  `scripts/category_stats.mjs` does.
- Full-corpus baseline (all 562 games, 23,544 mistakes): **complex = 5,708
  mistakes = 24.2% of all, but only 16.3% of EV loss** (complex spots skew
  low-EV). 88% of complex mistakes carry the `attack` skill area — mostly
  because no threat is armed, not because the reason is offensive (see
  distribution).
- Sampler (scratchpad, read-only on the repo): every 3rd game (206 games,
  8,733 mistakes → 2,123 complex, 24.3% — matches the full corpus), then a
  seeded random 120-case sample. 91 distinct games, 12 distinct users
  (largest user 37/120), median ev_loss 0.26, p90 0.71.
- Each case was rendered with hand/melds/draw, both candidates'
  shanten/ukeire/wait-tiles, a naive block decomposition
  (sets/ryanmen/kanchan/penchan/pairs) of the 13 tiles after each cut,
  Mortal's top-4 q-values, all four discard rows + riichi flags, scores, and
  live-tile context — and classified by eye, aided by those features.
- Labels are one reviewer's judgment. "NOISE" was assigned when Mortal's
  q-gap between the two picks is ≲0.12 — i.e. Mortal itself considers the
  choice near-tied and there is nothing meaningful to explain.

## Distribution (n = 120)

| bucket | cases | % of cases | EV share | avg EV | what it is |
|---|---|---|---|---|---|
| SAFETY | 36 | 30.0% | 29.7% | 0.31 | defensive foresight with no armed threat: keeping the safer spare at equal speed, genbutsu sequencing (cut the temporarily-safe tile, hold the permanent one), honor-danger discard ordering, endgame/fold tile choice |
| NOISE | 33 | 27.5% | 5.9% | 0.07 | q-gap ≲0.12 — Mortal calls it a coin flip; nothing to teach |
| BLOCK | 18 | 15.0% | 27.6% | 0.58 | 5-block / hand-development: surplus floater vs block integrity, tatsu quality, pair economy (open-hand pair > weak tatsu), extension potential, 2-step shape incl. deliberate shanten-back |
| UNCLEAR | 15 | 12.5% | 13.8% | 0.35 | could not determine (incl. a repeated unexplained "keep Chun over Hatsu" motif, 4 cases) |
| YAKU | 8 | 6.7% | 9.4% | 0.44 | unmodeled yaku lines: pinfu, sanshoku, chiitoi/toitoi commitment, yakuless-tenpai avoidance, sanankou |
| WAITQ | 5 | 4.2% | 5.6% | 0.42 | wait quality beyond liveness: which wait gets *discarded to* you (edge waits get fed; 3m-wait ≫ 5m-wait at equal live count) |
| VALUE | 4 | 3.3% | 7.0% | 0.66 | dora subtleties the tile-level dims miss: dora held in the *kept* hand, dora-adjacent floaters, locking a guaranteed dora pair vs dora acceptance |
| FURITEN | 1 | 0.8% | 1.1% | 0.42 | kept wait is furiten |

Two reads of the same table:

- **By case count** the bucket is one-third safety-reasoning, one-quarter
  noise, one-sixth hand-development.
- **By EV** noise nearly vanishes (5.9%) and the bucket becomes a
  60/40-ish split between two real skills: defensive foresight (~30%) and
  hand-development + its value/wait/yaku cousins (~50% combined).

## How much would a correct 5-block / hand-development model explain?

**Directly: 18/120 = 15% of complex cases, but 27.6% of complex EV loss**
(BLOCK has the second-highest avg EV of any bucket). Stretching the
definition to include the shape-flavored UNCLEARs and the WAITQ cases that a
block-quality model with live-tile weighting would also catch, a realistic
upper bound is **~20% of cases / ~35% of EV**. Scaled to the full corpus
(5,708 complex mistakes, 1,586 EV), that's roughly 900–1,100 mistakes and
~440–550 EV becoming explainable.

So HP-02 (the hand-partition block-counting feature) is worth building — it
is the highest-EV-density explainable cluster — but it is **not** the
majority story the "Complex = we can't see shape" intuition suggests. The
single biggest explainable cluster is **safe-tile economy without an armed
threat** (30% by count *and* EV), which needs a safety dimension, not a
partition. And ~27% of the bucket by count is noise that arguably shouldn't
be shown as a "mistake" at all: 78/120 sampled cases have ev_loss ≤ 0.31,
and NOISE's avg EV is 0.07 — a severity floor would shrink the visible
complex pile more cheaply than any new dimension.

## Worked cases (full reasoning)

**#89 — BLOCK (surplus tile vs pair integrity). g317 m12721, S4 t9, ev 0.87.**
Hand `4m5mr6m 8m8m | 4p5pr5p | 1s1s 6s7s8s` + draw 3m. Player cut 8m (from
the 8m8m pair), Mortal cut the plain 5p. Both leave 1-shanten, ukeire 15 —
the win-vector sees a perfect tie and shrugs (only versatility fires, for
the *player*). The block story is unambiguous: `4p5pr5p` is a ryanmen plus a
**redundant third tile** — cutting plain 5p keeps the identical 4p+5pr
ryanmen (red intact) and preserves the 8m8m pair, while the player's cut
destroyed a needed pair to keep a tile that adds nothing. A partition that
knows "this block is already complete, the extra copy is dead weight"
explains it fully.

**#101 — BLOCK (floater beyond 5 blocks is dead). g220 m9115, E2 t4, ev 1.26**
(largest in the sample). Hand `3m 6m8m | 2p 6p7p8p | 2s3s3s4s 7s8s8s` + draw
4s. Player cut 3s, Mortal cut the lone 2p — and the raw numbers say the
player is *wider* (ukeire 54 vs 50), which is why the comparator finds
nothing for Mortal. Count blocks: 678p set, 234s set, 78s+8s, 33s pair, 68m
— five blocks before touching 2p. The 2p's entire acceptance is the seduction:
every tile it accepts builds a **sixth** block the hand can't use. Same
pattern in #109 (ev 0.89: lone 6p vs a supporting 2s, Mortal gives up 3
ukeire to cut the floater). This is exactly the case one-step ukeire can
never see and a 5-block model sees instantly.

**#4 — YAKU (yakuless tenpai). g191 m7868, S1 t9, ev 1.03.** Open hand
`chi 234m | 7m8m9m 3p4p5pr6p7p7p 4s6s` + draw 4m. Player cut 6p and stayed
**tenpai** — the comparator scores that as a shanten win for the player and
finds nothing for Mortal, who cut 9m back to 1-shanten. The tenpai is
yakuless (open, no tanyao because of 9m, no yakuhai): it cannot win. Mortal's
"slower" line drops 9m toward a tanyao hand that can. No dimension knows
whether a tenpai has a yaku, so every yakuless-tenpai spot lands in complex
with "trust the read" — arguably the worst possible advice there.

**#1 — SAFETY (genbutsu sequencing). g533 m21800, E3 t12, ev 0.08.** Riichi
from seat 0; hand `4m5mr5m 9m9m 2p3p4p 4p 7p7p8p8p9p` + drawn 4p. Both
candidate cuts (4p, 4m) are genbutsu — deal_in ties at 0 and is not emitted.
Mortal cuts 4m: the riichi player discarded 4m *this turn* (temporarily
verified safe) while 4p is an older discard (permanently safe) — so you
spend the transient safety now and bank the permanent genbutsu for the next
turn. Cases #6, #29, #70 repeat the identical motif. There is no dimension
for "keeps more safe tiles for later", so all of these read as ties.

**#87 — WAITQ (which wait gets fed). g389 m15471, E3-1 t4, ev 0.83.** Open
`pon CC | 2m4m6m 8p8p8p 2s2s 4s5sr6s` + draw 6m, tenpai either way: cut 2m →
kanchan 5m wait, cut 6m → kanchan 3m wait, both 4 tiles live. The q-gap is
0.83 — Mortal strongly wants the 3m wait. Live-count can't distinguish them;
win-*rate* can: opponents hold every 5m (a prime middle tile) and release 3m
freely. Nothing in the pipeline models the opponent-release probability of a
wait, so a large, teachable preference surfaces as "stats don't explain it".

**#52 — SAFETY (fold sacrificing value). g480 m19549, S1-1 t13, ev 0.47.**
Last place 4,200 vs leader 81,000, open threat live, 20 tiles left. Player
cut 4m keeping the red 5p (ukeire 31); Mortal cuts **5pr** itself (ukeire
22, s0 has passed 5p/6p — it's the safe shove). The comparator scores this
as the player winning ukeire *and* dora_kept — Mortal wins nothing, complex.
The actual reason is a placement-aware fold. (Reported by the same user as
complex_gap #200, independently reaching the same conclusion.)

**#66 — VALUE (held-dora blindness). g77 m3318, S1 t14, ev 1.12.** Riichi
live; dora is 5p and the hand holds `5p5p` + drew a third 5p. Player cut 7p
(genbutsu), Mortal cut 1m (also genbutsu, other one of two 1m copies). Equal
safety; Mortal's line keeps the all-pinzu, three-dora tanyao hand alive
instead of a yakuless 1m1m block. `dora_kept`/`dora_acceptance` only look at
the *discarded* tile and the *wait*, never at how many dora each resulting
hand holds — so a 3-dora-vs-0-dora difference is invisible.

## Recurring micro-patterns worth naming

- **"Keep the safer spare at equal speed"** is the single most repeated
  motif (≥12 of the 36 SAFETY cases): when two floaters are otherwise equal,
  Mortal keeps the one that is already discarded/deader (future safe tile)
  and cuts the more dangerous one *now*, pre-threat. A `safe_spare_kept`
  dimension gated on ≈equal shanten+ukeire would name most of these.
- **Honor discard ordering** (cut round wind before guest wind, cut the
  universally-dangerous honor early — #28, #30, #58, #91): same family,
  including the wind-ordering case users reported (#215 in the backlog).
- **Chun-over-Hatsu**: in 4 separate cases with symmetric stats Mortal
  discarded F keeping C (q-gaps up to 0.49). I could not find the reason;
  left in UNCLEAR. Worth a targeted look before inventing a dimension.
- **Noise floor**: 65% of sampled complex cases have ev_loss ≤ 0.31. The
  complex bucket's reputation as "the hard cases" is half true — half of it
  is just Mortal's indifference rendered as a mistake card.
