---
name: tile-notation
description: Riichi mahjong tile notation conventions used in Haipai — Mortal/mjai format (1m-9m, 5mr, E/S/W/N, P/F/C) and SVG filename format (Man1.svg, Ton.svg, etc). Use when reading, writing, or converting between tile representations — especially in lib/parse.py, lib/shanten.py, lib/categorize.py, and the static/ SVG rendering code.
---

# Tile Notation

Haipai uses two parallel tile notation systems. Code that touches both (e.g. the frontend renderer) must convert between them.

## Mortal / mjai format (in parsed game data)

Used throughout `lib/` and in all JSON payloads.

- Numbers: `1m`–`9m` (man), `1p`–`9p` (pin), `1s`–`9s` (sou)
- Red fives: `5mr`, `5pr`, `5sr`
- Winds: `E`, `S`, `W`, `N`
- Dragons: `P` (white), `F` (green), `C` (red)

## SVG filenames (in `static/`)

Used by the frontend; tile graphics live in the `riichi-mahjong-tiles/` submodule.

- Numbers: `Man1.svg`–`Man9.svg`, `Pin1.svg`–`Pin9.svg`, `Sou1.svg`–`Sou9.svg`
- Red fives: `Man5-Dora.svg`, `Pin5-Dora.svg`, `Sou5-Dora.svg`
- Winds: `Ton.svg` (E), `Nan.svg` (S), `Shaa.svg` (W), `Pei.svg` (N)
- Dragons: `Haku.svg` (P), `Hatsu.svg` (F), `Chun.svg` (C)
