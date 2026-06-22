# Soft-safe tiles for open defense (tsumogiri-extended genbutsu)

**SHIPPED 2026-06-22.** Against an **open (non-riichi)** threat, tiles that
passed the opponent while their wait was *frozen* now mark safe (`Safe*`) and
flow into defense scoring. This file keeps the design rationale (esp. why soft
tiles never seed suji); the mechanics live in the code below.

Example game that motivated it: `https://haipai.ylue.de/#m20389` (2s reads safe
vs North after North's last hand-changing dahai).

## What "soft-safe" is

Hard genbutsu against an open threat = own discards ∪ every tile that hit the
table since the opponent's *last own dahai* (the temp-furiten window — tiles
they physically cannot ron right now).

Soft-safe widens that back to the opponent's **last non-tsumogiri (tedashi)
discard**. From that tedashi onward every discard was tsumogiri (drew-and-threw),
so their 13-tile hand — and therefore their wait — is **frozen**. Any tile that
passed them in that frozen window, if it were a winning tile, a competent
opponent would have ronned. Safe under "the opponent does not miss a ron."

| Tier            | Source                                  | Guarantee                          | Confidence |
| --------------- | --------------------------------------- | ---------------------------------- | ---------- |
| Hard genbutsu   | own discards ∪ temp-furiten passed      | rules — they *cannot* ron          | absolute   |
| **Soft safe**   | passed since last *tedashi*             | behavioural — they *would have* ron | high, conditional |

The one real hole: on a multi-sided wait the opponent can be in *temporary*
furiten at the instant our candidate passed (waits 2s/5s; 2s passes → temp
furiten; 5s passes before their next draw → they couldn't ron 5s even playing
perfectly). Rare, but it means soft tiles are not strictly deal-in-0 — hence the
`Safe*` asterisk.

## Why soft tiles mark safe but NEVER seed suji (the core call)

The reason is timing, not "passed tiles create no furiten" (they do).

- Passing a winning-*shape* tile triggers temporary furiten **regardless of
  yaku** (even if a win can't be declared for lack of yaku). But temp furiten
  lasts only until the player's **next draw**.
- The **hard** genbutsu window (since last *dahai*) ends before the opponent's
  next draw — they have not drawn since — so any winning-shape tile in it leaves
  them temp-furiten *right now*, which blocks the suji partner too. Hard-genbutsu
  suji is therefore sound this turn, and is left exactly as-is.
- The **soft** window (since last *tedashi*) spans the opponent's intervening
  draws (each tsumogiri *is* a draw), each of which **clears** the temp furiten.
  A soft tile's suji partner is no longer protected: if they hold the live
  ryanmen, they can ron it now.
- Worked example: open hand frozen on a 78 shape (wants 6 with yaku; 9 is
  yaku-less). 9 passed several turns ago, opponent has since drawn → temp furiten
  cleared. 9 is still soft-safe (yaku-less → can never ron it), but 6 is the live
  wait — emitting "6 suji off 9" would actively mislead.

So soft tiles are **purely additive** and kept out of the suji path entirely.

## How it's implemented

- `parse.js` — `walk_kyoku` tracks `flow_pos_at_last_tedashi` per opponent
  (advanced only on `!e.tsumogiri` dahai), alongside the unchanged
  `flow_pos_at_last_dahai`.
- `defense.js` — for each open threat, `soft_safe` = tiles in the flow between
  `flow_pos_at_last_tedashi` and `flow_pos_at_last_dahai`, minus hard genbutsu.
  It is **never** passed to `calcCombos` and **never** reaches `_suji_partners`.
  Instead, post-engine, the per-threat deal-in for a soft tile is forced to 0
  (so a tile soft vs one threat but live vs another still nets a nonzero combined
  rate). Emitted on `per_threat[].soft_safe` (open threats only).
- `defense-labels.js` — `softSafeForTile(mistake, tile)` reports soft reliance.
- `board-discards.js` / `ev-table.js` — render `Safe*` (vs hard `Safe`) for soft
  tiles; the hand row gets a dashed-teal underline.
- Board affordance — the opponent's **last tedashi** on an open-threat row gets a
  teal dashed outline (`.soft-anchor-tile`, sibling of the red riichi anchor).
  Hovering it highlights the soft-safe set (`ui.js` → `.safe-from-soft`). The
  anchor index is derived in-renderer from the `tsumogiri` flags already on each
  discard, so nothing extra is plumbed through `parse.js`.
- Scoring (`categorize.js`) is unchanged — soft tiles flow in automatically via
  the zeroed `dealin_rates` / `per_threat[].dealin_rates` the categorizer already
  reads. Suji-derived safety stays hard-genbutsu only.

Benchmark (`scripts/category_bench.mjs`, P4+D3 baseline): the wider safe set moves
defense categories by a few spots (D1 −4 → D2/D3, OD1 −1), well under what a suji
change would have shifted. Residual soft-tile risk (a genuinely missed yaku-ron,
or atozuke that later gained a yaku) is accepted under the `Safe*` asterisk
rather than tracked per-tile.
