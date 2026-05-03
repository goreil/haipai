#!/usr/bin/env python3
"""Canonical tile-notation encoding + adapters to other index schemes used internally.

Mjai strings ("1m"-"9m", "1p"-"9p", "1s"-"9s", "E"/"S"/"W"/"N"/"P"/"F"/"C",
"5mr"/"5pr"/"5sr") are the wire format across the app. Three integer
schemes cohabit the codebase:

- **mjai IDs (0-36)** — this module's canonical encoding. 0-33 = the 34
  distinct tiles; 34-36 = red fives as separate IDs. `wall_remaining`
  arrays throughout `lib/` use 37 slots indexed by this scheme (base slot
  already counts the red).
- **Internal tile-index scheme (1-37)** — used by ``get_opponent_discards``
  and related helpers. Red fives collapse to the base index; indices
  0/10/20/30 are unused gaps that the index arithmetic relies on.
- **tenhou (11-53)** — KillerDucky/tenhou encoding used by ``lib.defense_kd``.
  Aka fives are 51/52/53 and must be ``norm_red_five``-d before suji math.

Shanten has its own 34-entry scheme (``lib.shanten.MJAI_TO_BASE``) — kept
local because it's legitimately red-blind.
"""

# --- Canonical mjai IDs (0-36) ---

MJAI_TO_ID = {
    "1m": 0, "2m": 1, "3m": 2, "4m": 3, "5m": 4, "6m": 5, "7m": 6, "8m": 7, "9m": 8,
    "1p": 9, "2p": 10, "3p": 11, "4p": 12, "5p": 13, "6p": 14, "7p": 15, "8p": 16, "9p": 17,
    "1s": 18, "2s": 19, "3s": 20, "4s": 21, "5s": 22, "6s": 23, "7s": 24, "8s": 25, "9s": 26,
    "E": 27, "S": 28, "W": 29, "N": 30, "P": 31, "F": 32, "C": 33,
    "5mr": 34, "5pr": 35, "5sr": 36,
}

ID_TO_MJAI = {v: k for k, v in MJAI_TO_ID.items()}

RED_TO_BASE = {34: 4, 35: 13, 36: 22}


def mjai_to_tile_id(tile):
    return MJAI_TO_ID[tile]


def tile_id_to_base(tid):
    """Map red five IDs to their base ID (34->4, 35->13, 36->22), others unchanged."""
    return RED_TO_BASE.get(tid, tid)


def is_honor_mjai(tile):
    return tile in ("E", "S", "W", "N", "P", "F", "C")


def is_red_five_mjai(tile):
    return tile in ("5mr", "5pr", "5sr")


# --- RT scheme (lib.defense suji math) ---
# 1-9 man, 11-19 pin, 21-29 sou, 31-37 honors. Gaps at 0/10/20/30 are load-bearing
# for the `% 10` suji arithmetic. Red fives share the base index.

MJAI_TO_RT = {
    "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "6m": 6, "7m": 7, "8m": 8, "9m": 9,
    "5mr": 5,
    "1p": 11, "2p": 12, "3p": 13, "4p": 14, "5p": 15, "6p": 16, "7p": 17, "8p": 18, "9p": 19,
    "5pr": 15,
    "1s": 21, "2s": 22, "3s": 23, "4s": 24, "5s": 25, "6s": 26, "7s": 27, "8s": 28, "9s": 29,
    "5sr": 25,
    "E": 31, "S": 32, "W": 33, "N": 34, "P": 35, "F": 36, "C": 37,
}


# --- Tenhou scheme (lib.defense_kd / KillerDucky port) ---
# 11-19 man, 21-29 pin, 31-39 sou, 41-47 honors. Red fives are 51/52/53
# (call ``norm_red_five`` in defense_kd before any suji arithmetic).

MJAI_TO_TENHOU = {
    "1m": 11, "2m": 12, "3m": 13, "4m": 14, "5m": 15,
    "6m": 16, "7m": 17, "8m": 18, "9m": 19, "5mr": 51,
    "1p": 21, "2p": 22, "3p": 23, "4p": 24, "5p": 25,
    "6p": 26, "7p": 27, "8p": 28, "9p": 29, "5pr": 52,
    "1s": 31, "2s": 32, "3s": 33, "4s": 34, "5s": 35,
    "6s": 36, "7s": 37, "8s": 38, "9s": 39, "5sr": 53,
    "E": 41, "S": 42, "W": 43, "N": 44, "P": 45, "F": 46, "C": 47,
}

TENHOU_TO_MJAI = {v: k for k, v in MJAI_TO_TENHOU.items()}


# --- Dora indicator → dora mapping (CS-05: single source of truth) ---
# Riichi rule: indicator N → dora is the "next" tile, wrapping 9→1 within
# each number suit, E→S→W→N→E, P→F→C→P. Red five indicators map to 6 of
# that suit (red-five normalised to 5 first, then +1). The JS used to
# mirror this table as ``NEXT_TILE`` in static/app.js — that mirror was
# retired during the CS-02 dora-set collapse; the frontend now reads the
# resolved ``dora_tiles`` list off ``BoardState`` directly.

NEXT_TILE_MJAI = {
    "1m": "2m", "2m": "3m", "3m": "4m", "4m": "5m", "5m": "6m",
    "6m": "7m", "7m": "8m", "8m": "9m", "9m": "1m", "5mr": "6m",
    "1p": "2p", "2p": "3p", "3p": "4p", "4p": "5p", "5p": "6p",
    "6p": "7p", "7p": "8p", "8p": "9p", "9p": "1p", "5pr": "6p",
    "1s": "2s", "2s": "3s", "3s": "4s", "4s": "5s", "5s": "6s",
    "6s": "7s", "7s": "8s", "8s": "9s", "9s": "1s", "5sr": "6s",
    "E": "S", "S": "W", "W": "N", "N": "E",
    "P": "F", "F": "C", "C": "P",
}


def dora_indicator_to_dora_mjai(indicator):
    """Dora indicator (mjai string) -> the corresponding dora tile (mjai string)."""
    return NEXT_TILE_MJAI[indicator]


def _norm_red_five_tenhou(t):
    """Collapse aka fives (51/52/53) to their base tenhou ids (15/25/35)."""
    if t < 51:
        return t
    return {51: 15, 52: 25, 53: 35}[t]


NEXT_TILE_TENHOU = {
    t: MJAI_TO_TENHOU[NEXT_TILE_MJAI[TENHOU_TO_MJAI[_norm_red_five_tenhou(t)]]]
    for t in list(TENHOU_TO_MJAI)
}


def dora_indicator_to_dora_tenhou(indicator):
    """Dora indicator (tenhou int) -> the corresponding dora tile (tenhou int).

    Accepts aka fives (51/52/53) transparently; they resolve to 16/26/36.
    """
    return NEXT_TILE_TENHOU[indicator]
