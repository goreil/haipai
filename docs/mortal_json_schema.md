# Mortal AI JSON Schema Reference

## Top-level keys

`engine` (str), `game_length` ("Hanchan"/"Tonpuusen"), `player_id` (int, 0-indexed), `review` (dict), `mjai_log` (list), `split_logs` (list)

## review.kyokus[i]

`kyoku` (int, 0-based: 0-3=E1-E4, 4-7=S1-S4), `honba` (int), `entries` (list), `end_status` (list), `relative_scores` (list)

## review.kyokus[i].entries[j] — one per player decision point

| Key | Type | Notes |
|-----|------|-------|
| `junme` | int | 0-based turn number |
| `tile` | str | Tile involved (mjai notation, e.g. "6m") |
| `expected` | dict | AI's recommended action (`type`, `pai`, etc.) |
| `actual` | dict | Player's actual action |
| `is_equal` | bool | `False` = mistake |
| `actual_index` | int | Index into `details` matching `actual` |
| `details` | list | All candidate actions with `action`, `q_value`, `prob` |
| `state` | dict | Has `tehai` (hand tiles) and `fuuros` (melds) |
| `shanten` | int | Shanten number |
| `at_furiten` | bool | |
| `at_self_chi_pon` | bool | Context flag — decision is whether to call chi/pon |
| `at_self_riichi` | bool | Context flag — decision is whether to declare riichi |
| `at_opponent_kakan` | bool | Context flag — opponent is doing a kakan |
| `tiles_left` | int | Remaining live wall tiles |

## EV loss computation

```
ev_loss = details[0]['q_value'] - details[actual_index]['q_value']
```

`details[0]` always matches `expected`. `details[actual_index]` always matches `actual`.

## Action dict structures

| Type | Fields | Notes |
|------|--------|-------|
| `dahai` | `type, actor, pai, tsumogiri` | tsumogiri=True means drew and immediately discarded |
| `chi` | `type, actor, target, pai, consumed` | consumed = 2 tiles from hand |
| `pon` | `type, actor, target, pai, consumed` | |
| `reach` | `type, actor` | Riichi declaration |
| `hora` | `type, actor, target` | Win claim |
| `ankan` | `type, actor, ...` | Structure not fully explored |
| `none` | `type` | Pass (value: `{"type": "none"}`) |

## Mjai tile notation

Suits: `1m`–`9m` manzu, `1p`–`9p` pinzu, `1s`–`9s` souzu. Red fives: `5mr`, `5pr`, `5sr`.
Honors: `E` (East), `S` (South), `W` (West), `N` (North), `P` (haku/white), `F` (hatsu/green), `C` (chun/red).

## mjai_log

~806 events for a full hanchan. Contains every game action for all 4 players — can reconstruct full game state at any point, not just reviewed decision points.

Filter for `type == "start_kyoku"` events for round metadata. These are 1:1 with `review.kyokus` (same order).
Fields: `bakaze` ("E"/"S"), `kyoku` (1-4), `honba` (int).

## split_logs

`split_logs[0].name` — list of 4 player name strings.
Contains raw Tenhou log data in numeric tile encoding (not mjai notation).
