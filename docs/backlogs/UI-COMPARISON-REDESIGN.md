# UI redesign: two-column AI-vs-You comparison

**Status:** partially done — core transpose shipped 2026-06-20
**Owner:** picked up by a future Claude Code session
**Created:** 2026-06-20

> **Shipped (2026-06-20):** the EV table in `static/js/ev-table.js`
> (`renderEvComparison`) is now **transposed** — You / AI are side-by-side
> **columns** (`.ev-table-cols`), attributes (tile acceptance, Mortal EV Δ,
> shanten, deal-in, type, deal-in waits) are **rows**. Column tint + markers,
> the ukeire diff/full toggle, hide-acceptance, multi-threat pills, and the
> wait breakdown all carry over. Still **not** done from the plan below:
> the dedicated +ukeire/+shanten/+safety/+value advantage callouts (§B
> `value_preserve`), the asymmetric EV banner, and the riichi/meld/kan
> category-specific panels. Those remain a reshaping job over existing data.

## Goal

Replace the current row-based mistake display with a **two-column comparison**:
the **AI choice** on one side, the **user choice** on the other. Between/under
them, surface *why* each choice is better along the axes we can already compute:

- **+Ukeire** (more tile acceptance)
- **+Shanten** (closer to / preserves tenpai)
- **+Safety** (lower deal-in risk)
- **+Value** (keeps dora / yakuhai / dora-acceptance)

The point: instead of making the user read a table, show "the AI's tile gives
+4 ukeire and keeps the red 5; your tile is genbutsu-safe" as a direct diff.

## Why this is a Claude Code task (not a pure design task)

Every axis above is **already extracted** by the prep pipeline + categorizer and
sits on each `mistake` object. There is no new data to compute — this is a
**rendering/reshaping** job over an existing payload. The hard part is wiring the
right fields into a new layout and handling the per-category quirks (riichi,
melds, kan), all of which already have data. A future session should be able to
build this end-to-end against real `mistake` objects in `games.db`.

---

## The data: what's on a `mistake` object

All of this is computed client-side in the prep worker (`static/js/prep/`) and the
categorizer (`static/js/categorize.js`); nothing is stored in the DB. See
`CLAUDE.md` "Where things live" + the memory note that categorization is 100%
client-side. To inspect a real payload, load a game in the dev UI and log a
`mistake` from `static/js/mistake-card.js`.

### A. Per-choice features — computable for ANY legal discard ⭐

**This is the core of the comparison.** `mistake.discard_stats[]` has one entry
per legal discard, so the AI tile, the user tile, and every alternative all have
these. Defense dicts are keyed by tile the same way.

| Axis | Field / accessor | Shape | Where |
|---|---|---|---|
| Shanten | `discard_stats[].shanten` | int (0 = tenpai) | prep |
| Ukeire count | `discard_stats[].necessary_count` | int | prep |
| Ukeire tiles | `discard_stats[].necessary_tiles` | `[{tile, count, aka_count}]` | prep |
| Speed marker | `mistake.best_discard` | mjai tile | prep (fastest-to-tenpai) |
| Is dora | `tileIsDora(tile, doraTiles)` | bool | exported from `categorize.js` |
| Is yakuhai | `tileIsYakuhai(tile, roundWind, seatWind)` | bool | exported from `categorize.js` |
| Dora acceptance | `doraUkeireForTile(tileMjai, discardStats, doraTiles)` | int | exported from `categorize.js` |
| Deal-in rate | `mistake.dealin_rates[tile]` | % 0–100 (null = no threat) | prep/defense_kd.js |
| Coarse safety | `coarseSafetyLabelForTile(mistake, tile)` | `genbutsu`/`suji`/`no-suji`/null | `defense-labels.js` |
| Fine safety | `fineLabelForTile(mistake, tile)` | string e.g. "suji 4-5-6", "honor (2 left)" | `defense-labels.js` |
| Wait breakdown | `mistake.wait_breakdowns[tile]` | `[{type, tiles, left, rate}]` | prep/defense_kd.js |
| Suji partners | `mistake.suji_partners[tile]` | `[tile]` | prep/defense.js |

`categorize.js` exports `tileIsDora`, `tileIsYakuhai`, `tileIsYakuhaiOrDora`,
`doraUkeireForTile` (see the module's return object ~line 426) — reuse them, do
not reimplement.

> ⚠️ **EV is the one axis that is NOT symmetric.** Mortal's `q_value` only exists
> for actions Mortal evaluated (`mistake.top_actions[]`), not as a function over
> arbitrary tiles. You can show "AI's EV" and "your EV loss" but you cannot
> synthesize an EV number for an arbitrary alternative the way you can for
> shanten/ukeire/safety/dora. Decide how to present EV in a symmetric layout
> (e.g. a single banner above both columns rather than a per-column row).

### B. Pre-built advantage summary (reuse this!)

The categorizer already computes "what does the AI choice preserve that yours
drops" into `mistake.categorize_data.value_preserve`:

```
{ dora: bool,            // AI keeps a dora the user discarded
  yakuhai: bool,         // AI keeps a value honor
  dora_acceptance: bool, // AI's wait accepts strictly more live dora
  dora_accept_tiles: []  // which dora tiles the AI wait keeps
}
```

This is essentially the "+Value" callout, already decided by the live category
engine. Prefer rendering this over recomputing, so the comparison stays
consistent with the category the user sees.

### C. The two choices themselves

- `mistake.actual` — user's move: `{type, pai, consumed, target}`
- `mistake.expected` — AI's move: same shape
- `type` ∈ `dahai / reach / chi / pon / ankan / kakan / daiminkan / hora / none`
- `mortalRaisedShanten(mistake)` (in `categorize.js`) — flags when the AI
  *deliberately* picks a worse shanten (value/safety over speed). **Honor this**
  so the layout doesn't render shanten as a "user advantage" when the AI traded
  it on purpose.

### D. Shared scene context (one header, both columns)

- Dora: `board_state.dora_indicators[]`, resolved `board_state.dora_tiles[]`
- Winds: `board_state.round_wind`, `board_state.seat_wind`
- Turn / wall: `mistake.turn` (junme), `board_state.tiles_left`
- Scores / standing: `board_state.scores[]`, `mistake.is_all_last`
- Discards: `board_state.all_discards[]` (per seat, with riichi marker + call target)
- Opponent melds: `board_state.opponent_melds[]`
- Opponent yaku panel: `board_state.yaku[seat]` (yakuhai/tanyao/toitoi/chanta/
  honitsu/sanshoku/ittsuu, each `locked/possible/dead`) — already rendered by
  `static/js/board-yaku-panel.js`
- Per-opponent threat: `mistake.per_threat[]` —
  `{kind: riichi|open, seat, riichi_tile, ippatsu_alive, genbutsu[], open_melds,
  meld_dora, yakuhai_han, guaranteed_han}`

### E. Mistake-level diagnosis (single value, not per-choice)

- `mistake.ev_loss` (points) → severity tier via `sevTier()` in `severity.js`
  (thresholds 0.2 / 0.5 / 1.0)
- `mistake.category` (P1–P4, D1–D3, OD1–OD3, 4A–C, 5A–B, 6A–B) → skill area via
  `trendSkillAreaFor()` in `skill-areas.js`
- `mistake.top_actions[]` — `[{action, q_value, prob}]`, Mortal's ranking

### F. Category-specific extras

**Riichi (5A bad-riichi / 5B missed-riichi):**
- `mistake.tenpai_waits` — `[{tile, count, aka_count}]`
- `mistake.is_furiten` / `mistake.furiten_tiles[]` / `mistake.bad_riichi_reason`
- `mistake.actual_riichi_tile`, `mistake.prior_own_discards[]`
- Per-wait score eval in `static/js/bad-riichi-bars.js`:
  `{tile, count, furiten, yaku, dora, aka, ronDama, ronRiichi, tsumoDama, tsumoRiichi}`
  — full han/fu/score for dama vs riichi under ron & tsumo

**Melds (4A–C) / kan (6A–B):** the choice is call-vs-pass or kan-vs-not, so the
two columns are actions rather than two tiles. `actual.type`/`expected.type`
carry the move; `categorize-explanations.js` already has the open/closed logic
(`melds.some(ml => ml.type !== "ankan")`).

---

## Files in play

**Render (where the new layout goes):**
- `static/js/mistake-card.js` — per-round mistake entry (primary target)
- `static/js/ev-table.js` — the current row/table renderer this redesign replaces
  or sits beside; read it first to see how `discard_stats` + `top_actions` are
  currently merged (`renderUkeireTiles`, q_value sorting)
- `static/js/board-discards.js`, `static/js/board-yaku-panel.js`,
  `static/js/board-melds.js` — board context blocks, reuse as-is
- `static/js/severity.js`, `static/js/skill-areas.js` — tier/skill coloring helpers

**Read-only (data sources, don't reimplement):**
- `static/js/categorize.js` — exports the tile helpers + `value_preserve`
- `static/js/defense-labels.js` — `coarseSafetyLabelForTile`, `fineLabelForTile`
- `static/js/prep/defense_kd.js`, `prep/defense.js` — deal-in / wait / suji data
- `static/js/tiles.js` — `tileBase()` + SVG render

**CSS:**
- `static/style-game-detail.css` — game header, round/mistake cards, EV table
- `static/style-board-display.css` — board context, discards, threat pills

See `tile-notation` skill for mjai ↔ SVG conversion before touching tile rendering.

---

## Suggested implementation order

1. **Build a `compareChoices(mistake)` helper** that, given a mistake, returns a
   normalized `{ ai: {...axes}, user: {...axes}, advantages: {...} }` object by
   looking up both `expected.pai` and `actual.pai` in `discard_stats` + the
   defense dicts + `value_preserve`. Keep it pure and testable. Handle the
   non-dahai categories (reach/meld/kan) by branching on `type`.
2. **Render the two columns** in `mistake-card.js` from that object; reuse
   `tiles.js` for the tile glyphs and `severity.js` for coloring.
3. **Render the advantage callouts** (+ukeire/+shanten/+safety/+value) from the
   diff, suppressing shanten-advantage when `mortalRaisedShanten()` is set.
4. **EV banner** above both columns (asymmetric — see warning in §A).
5. **Wire category-specific panels** (riichi waits via `bad-riichi-bars.js`,
   meld/kan action framing) behind the main comparison.
6. Keep the old `ev-table.js` reachable (toggle / "details") until the new view
   is at parity, then retire it.

## Gotchas

- **Red fives:** `5m/5p/5s` collapse to base in most lookups, but `5mr/5pr/5sr`
  and `aka_count` are tracked separately for the EV table split — preserve that.
- **Nothing is stored:** all fields recompute live from prep + categorize.js, so
  there is **no backfill** to run when you change rendering. (See memory:
  "Backfill on change".)
- **Bind mounts:** JS/CSS edits go live on refresh, no Docker restart needed.
  Real game IDs the user cites (e.g. #352) live in the **container** DB
  (`docker compose exec app … data/games.db`), not repo-root `games.db`.
- **Verify visually:** use the `verify` skill / puppeteer against the dev UI with
  the test user; categorization has a bench (`categorize-bench` skill) but this
  change is render-only and won't move the category distribution.
- Don't introduce fuzzy "close enough" thresholds in any advantage logic —
  strict inequalities only (existing project rule).
