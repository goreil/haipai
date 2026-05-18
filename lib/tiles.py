#!/usr/bin/env python3
"""Canonical mjai tile-notation encoding.

Mjai strings ("1m"-"9m", "1p"-"9p", "1s"-"9s",
"E"/"S"/"W"/"N"/"P"/"F"/"C", "5mr"/"5pr"/"5sr") are the wire format
across the app. This module provides the canonical (mjai string ↔
0-36 integer) mapping plus red-five base collapse. Other index
schemes (tenhou, internal RT) lived here while the Python categorizer
relied on them; that work moved to static/js/prep/, so only the mjai
side survives.
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
