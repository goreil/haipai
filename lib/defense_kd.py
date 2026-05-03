#!/usr/bin/env python3
"""KillerDucky defense evaluation.

Ported from ``killer_mortal_gui/index.js`` (functions: ``calcDanger``,
``calcCombos``, ``generateWaits``). The algorithm enumerates ryanmen / kanchan /
penchan / tanki / shanpon waits the opponent could be holding, weights each by
the remaining tiles it needs, applies per-wait multipliers (ryanmen greed,
kanchan suji trap, matagi / ura suji, dora greed, red-five discard penalty),
and derives a per-tile deal-in probability. Probabilities are converted to the
0-15 safety scale used elsewhere in the codebase (higher = safer) so the result
is drop-in compatible with ``lib.defense.get_tile_safety_for_mistake``.

Only riichi threats are supported (mirrors the upstream script which filters
on ``reach_accepted``). For open-meld threats fall back to the suji-based
evaluator in ``lib.defense``.

----------------------------------------------------------------------
Upstream copyright (preserved per MIT license terms):

MIT License

Copyright (c) 2025 Andy Olsen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
"""

# --- Tile encoding (tenhou style, matching the JS source) ---
# 11-19: man, 21-29: pin, 31-39: sou, 41-47: honors (E S W N P F C)
# 51/52/53: red 5m/5p/5s (always normalised to 15/25/35 before use).
# Table + dora mapping live in lib/tiles.py; re-exported for backward compat.
from lib.parse import walk_kyoku
from lib.tiles import (  # noqa: F401
    MJAI_TO_ID,
    MJAI_TO_TENHOU,
    dora_indicator_to_dora_tenhou,
)


def norm_red_five(t):
    if t < 51:
        return t
    return {51: 15, 52: 25, 53: 35}[t]


# --- Tuning (copied verbatim from GlobalState in index.js) ---
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

# Matches GS.C_db_dealinMax — dealin rate at which safety hits 0.
DEALIN_MAX_PCT = 15.0

WAIT_RYANMEN = 0
WAIT_KANCHAN = 1
WAIT_PENCHAN = 2
WAIT_TANKI = 3
WAIT_SHANPON = 4


def generate_waits():
    """All possible 2-tile wait shapes keyed by tenhou tile ints."""
    waits = []
    for a, b in [(2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8)]:
        for suit in (1, 2, 3):
            waits.append({"type": WAIT_RYANMEN,
                          "tiles": [suit * 10 + a, suit * 10 + b],
                          "waits_on": [suit * 10 + a - 1, suit * 10 + b + 1]})
    for a, b in [(1, 3), (2, 4), (3, 5), (4, 6), (5, 7), (6, 8), (7, 9)]:
        for suit in (1, 2, 3):
            waits.append({"type": WAIT_KANCHAN,
                          "tiles": [suit * 10 + a, suit * 10 + b],
                          "waits_on": [suit * 10 + a + 1]})
    for a, b, c in [(1, 2, 3), (8, 9, 7)]:
        for suit in (1, 2, 3):
            waits.append({"type": WAIT_PENCHAN,
                          "tiles": [suit * 10 + a, suit * 10 + b],
                          "waits_on": [suit * 10 + c]})
    for n in range(1, 10):
        for wtype in (WAIT_TANKI, WAIT_SHANPON):
            for suit in (1, 2, 3, 4):
                if suit == 4 and n > 7:
                    continue
                tile = suit * 10 + n
                tiles = [tile] if wtype == WAIT_TANKI else [tile, tile]
                waits.append({"type": wtype, "tiles": tiles, "waits_on": [tile]})
    return waits


def calc_combos(waits, genbutsu, discards_to_riichi, unseen_tiles, dora):
    """Compute weighted deal-in combos per waited-on tile.

    Args:
        waits: output of generate_waits (not mutated except for the flag fields
            we attach per wait — safe to reuse across threats only if the caller
            regenerates).
        genbutsu: iterable of tenhou ints the opponent has passed on.
        discards_to_riichi: list of tenhou ints (ordered) the opponent discarded
            up to and including the riichi tile (last element is the riichi
            tile). Red fives are preserved here — the suji logic normalises
            internally, the aka-discard penalty needs the raw value.
        unseen_tiles: dict tenhou int (normalised, 11-47) -> count remaining
            unseen to the hero.
        dora: tenhou int of the dora tile (not the indicator), or None.

    Returns:
        dict with key ``'all'`` (total weighted combos across all live waits)
        and one entry per waited-on tile:
            combos[tile] = {'all': float, 'types': [wait, ...]}
    """
    genbutsu = {norm_red_five(t) for t in genbutsu}
    dtr_normed = [norm_red_five(t) for t in discards_to_riichi]
    riichi_tile = dtr_normed[-1] if dtr_normed else None
    combos = {"all": 0.0}

    for wait in waits:
        if any(t in genbutsu for t in wait["waits_on"]):
            continue

        w = 1.0
        num_unseen = []
        for i, t in enumerate(wait["tiles"]):
            count = unseen_tiles.get(t, 0)
            if i > 0 and wait["type"] == WAIT_SHANPON:
                n = max(0, count - 1)
            else:
                n = count
            w *= n
            num_unseen.append(n)
        wait["num_unseen"] = num_unseen
        if wait["type"] == WAIT_SHANPON:
            w /= len(wait["tiles"])  # symmetric pair

        if wait["type"] == WAIT_RYANMEN:
            ura = any(
                d not in wait["tiles"] and 4 <= d % 10 <= 6
                and any(abs(d - wt) == 2 for wt in wait["tiles"])
                for d in dtr_normed
            )
            matagi_early = False
            matagi_riichi = False
            for d in dtr_normed:
                if d in wait["tiles"]:
                    if d == riichi_tile:
                        matagi_riichi = True
                    else:
                        matagi_early = True
            w *= C_RYANMEN
            if ura:
                w *= C_URA_SUJI
            if matagi_early:
                w *= C_MATAGI_SUJI_EARLY
            if matagi_riichi:
                w *= C_MATAGI_SUJI_RIICHI
        elif wait["type"] in (WAIT_TANKI, WAIT_SHANPON):
            if wait["tiles"][0] > 40:
                w *= C_HONOR_TANKI_SHANPON
            else:
                w *= C_NONHONOR_TANKI_SHANPON
        elif wait["type"] == WAIT_KANCHAN:
            if (riichi_tile is not None
                    and 4 <= riichi_tile % 10 <= 6
                    and abs(wait["waits_on"][0] - riichi_tile) == 3):
                w *= C_KANCHAN_RIICHI_SUJI_TRAP
            else:
                w *= C_KANCHAN
        # WAIT_PENCHAN anchors at 1.0

        involved = set(wait["tiles"]) | set(wait["waits_on"])
        if dora is not None and dora in involved:
            w *= C_DORA_GREED

        for d in discards_to_riichi:
            if d > 50 and norm_red_five(d) in involved:
                w *= C_AKA_DISCARD
                break

        combos["all"] += w
        if wait["type"] == WAIT_SHANPON:
            w *= 2  # after denominator

        # Store the final weight on the wait so downstream code (wait breakdown
        # panel) can recover per-wait contribution. Mirrors the JS convention
        # of mutating wait.combos in place.
        wait["combos"] = w

        for t in wait["waits_on"]:
            bucket = combos.setdefault(t, {"all": 0.0, "types": []})
            bucket["all"] += w
            bucket["types"].append(wait)

    return combos


def dealin_probability(tile, combos):
    """Probability (0-1) opponent deals in on ``tile`` given ``calc_combos``."""
    t = norm_red_five(tile)
    if combos["all"] <= 0 or t not in combos:
        return 0.0
    return combos[t]["all"] / combos["all"]


def dealin_to_safety(prob):
    """Convert deal-in probability (0-1) to the shared 0-15 safety scale."""
    pct = prob * 100
    return max(0.0, DEALIN_MAX_PCT - pct)


# --- Wall / event adapters so this drops into the existing categorize flow ---

def _unseen_from_wall(wall_remaining):
    """Build tenhou-int -> unseen count dict from categorize.py's wall layout.

    wall_remaining has 34 base slots + 3 red-five slots. The base slot already
    totals red + non-red, which matches KD's normalised encoding exactly.
    """
    unseen = {}
    for mjai_tile, tid in MJAI_TO_ID.items():
        if mjai_tile.endswith("r"):
            continue
        tenhou = MJAI_TO_TENHOU.get(mjai_tile)
        if tenhou is None or tid >= len(wall_remaining):
            continue
        unseen[tenhou] = max(0, wall_remaining[tid])
    return unseen


def _extract_threats(mjai_events, start_pos, end_pos, player_id, target_tiles_left):
    """Build KD per-opponent threat records up to ``target_tiles_left``.

    Thin projection over ``lib.parse.walk_kyoku`` (the canonical kyoku
    walker shared with ``lib/defense.py`` and parse's decision-counts).
    For each opponent that has declared riichi (``reach`` event seen),
    returns: seat, discards_to_riichi (raw tenhou ints including aka),
    genbutsu (normalised set), dora_indicator (first dora only).

    The KD-style ``riichi_idx`` is the slot the riichi tile actually
    lands on. The canonical walker reports the slot it *will* land on
    at the next dahai — so we cap it at the current ``len(discards)``
    in case the round ended between ``reach`` and the riichi dahai.
    """
    state = walk_kyoku(mjai_events, start_pos, end_pos, player_id, target_tiles_left)
    first_dora_indicator = None
    if state["first_dora_indicator"] is not None:
        first_dora_indicator = MJAI_TO_TENHOU.get(state["first_dora_indicator"])

    threats = []
    for seat, opp in state["opponents"].items():
        if opp["reach_event_idx"] is None:
            continue  # not in riichi
        discards_tenhou = [
            t for t in (MJAI_TO_TENHOU.get(p) for p in opp["discards"])
            if t is not None
        ]
        # KD's riichi_idx points to the riichi tile *if* it was actually
        # discarded; if reach fired but no dahai followed, fall through
        # to "all discards are pre-riichi".
        riichi_idx = opp["reach_event_idx"]
        if riichi_idx >= len(opp["discards"]):
            cutoff = len(discards_tenhou)
        else:
            cutoff = riichi_idx + 1
        discards_to_riichi = discards_tenhou[:cutoff]

        # Genbutsu = (post-reach_accepted discards from anyone) ∪
        # (this seat's full discard pool). Matches upstream KD exactly.
        genbutsu = {norm_red_five(t) for t in discards_tenhou}
        for pai in state["genbutsu_post_reach_by_seat"].get(seat, []):
            tile = MJAI_TO_TENHOU.get(pai)
            if tile is not None:
                genbutsu.add(norm_red_five(tile))

        threats.append({
            "seat": seat,
            "discards_to_riichi": discards_to_riichi,
            "genbutsu": genbutsu,
            "dora_indicator": first_dora_indicator,
        })
    return threats


TENHOU_TO_MJAI = {v: k for k, v in MJAI_TO_TENHOU.items() if not k.endswith("r")}

WAIT_NAMES = {
    WAIT_RYANMEN: "ryanmen",
    WAIT_KANCHAN: "kanchan",
    WAIT_PENCHAN: "penchan",
    WAIT_TANKI: "tanki",
    WAIT_SHANPON: "shanpon",
}

def _derive_label(tenhou_tile, genbutsu):
    """Standard suji classification for one tile vs one threat's genbutsu set.

    Returns 'genbutsu' | 'suji' | 'no-suji'. Honors are always 'no-suji' unless
    genbutsu (no suji concept). Terminals and 2/3/7/8 suji on a single flank;
    middle tiles (4/5/6) only suji when both flanks are genbutsu.
    """
    t = norm_red_five(tenhou_tile)
    if t in genbutsu:
        return "genbutsu"
    if t > 40:
        return "no-suji"
    digit = t % 10
    if digit in (1, 2, 3):
        return "suji" if (t + 3) in genbutsu else "no-suji"
    if digit in (7, 8, 9):
        return "suji" if (t - 3) in genbutsu else "no-suji"
    return "suji" if (t - 3) in genbutsu and (t + 3) in genbutsu else "no-suji"


def _suji_partners(tenhou_tile, genbutsu):
    """Tenhou-int suji partner tiles that appear in ``genbutsu``.

    Edge tiles (1-3, 7-9 in a suit) have one possible partner (±3); middle
    tiles (4/5/6) have two. Honor tiles have none. Returned list preserves
    the lower-partner-first order so callers can render consistently.

    Used alongside ``_derive_label`` to drive the frontend "Suji 6p" /
    "Half-suji" badge without re-scanning discards client-side (CS-01).
    """
    t = norm_red_five(tenhou_tile)
    if t > 40:
        return []
    digit = t % 10
    partners = []
    if digit in (1, 2, 3):
        if (t + 3) in genbutsu:
            partners.append(t + 3)
    elif digit in (7, 8, 9):
        if (t - 3) in genbutsu:
            partners.append(t - 3)
    else:  # 4, 5, 6
        if (t - 3) in genbutsu:
            partners.append(t - 3)
        if (t + 3) in genbutsu:
            partners.append(t + 3)
    return partners


def _build_wait_breakdown(tenhou_tile, combos):
    """List of wait-type contributions for a tile (sorted by % descending).

    Each entry: ``{'type': str, 'tiles': [mjai], 'waits_on': [mjai], 'rate': pct}``.
    Red fives aren't in TENHOU_TO_MJAI so lookups that somehow see one fall
    back to the base tile name.
    """
    t = norm_red_five(tenhou_tile)
    if t not in combos or combos["all"] <= 0:
        return []
    total = combos["all"]
    out = []
    for wait in combos[t]["types"]:
        rate_pct = wait["combos"] / total * 100
        out.append({
            "type": WAIT_NAMES[wait["type"]],
            "tiles": [TENHOU_TO_MJAI[norm_red_five(x)] for x in wait["tiles"]],
            "waits_on": [TENHOU_TO_MJAI[norm_red_five(x)] for x in wait["waits_on"]],
            "rate": round(rate_pct, 2),
            "left": list(wait.get("num_unseen", [])),
        })
    out.sort(key=lambda r: -r["rate"])
    return out


def compute_kd_defense_data(hand_mjai, mjai_events, start_pos, end_pos,
                            player_id, tiles_left, wall_remaining):
    """Full KD-style defense data for display & storage.

    Returns ``None`` if no opponent is in riichi. Otherwise a dict:

    - ``safety_ratings``: mjai tile -> 0-15 safety scale (aggregated across
      threats by combining deal-in probabilities via ``1 - Π(1 - p_i)``).
    - ``dealin_rates``: mjai tile -> aggregated deal-in pct (0-100).
    - ``wait_breakdowns``: mjai tile -> list of live waits contributing to the
      most-dangerous threat's deal-in rate for that tile (UI panel).
    - ``per_threat``: list per riichi opponent of
      ``{seat, riichi_tile, genbutsu: [mjai], dealin_rates: {mjai: pct}}``
      so the UI can show per-opponent panels when multiple riichi are active.
    """
    threats = _extract_threats(mjai_events, start_pos, end_pos, player_id, tiles_left)
    if not threats:
        return None

    unseen = _unseen_from_wall(wall_remaining)

    hand_norm = {}
    for t in hand_mjai:
        tenhou = MJAI_TO_TENHOU.get(t)
        if tenhou is not None:
            hand_norm[t] = norm_red_five(tenhou)

    threat_data = []
    for threat in threats:
        dora = (dora_indicator_to_dora_tenhou(threat["dora_indicator"])
                if threat["dora_indicator"] is not None else None)
        combos = calc_combos(generate_waits(), threat["genbutsu"],
                             threat["discards_to_riichi"], unseen, dora)
        threat_data.append({"threat": threat, "combos": combos})

    dealin_rates = {}
    safety_ratings = {}
    wait_breakdowns = {}
    suji_partners = {}

    for mjai_tile, th in hand_norm.items():
        prob_not = 1.0
        most_dangerous = None
        most_dangerous_p = -1.0
        for td in threat_data:
            p = dealin_probability(th, td["combos"])
            prob_not *= (1.0 - p)
            if p > most_dangerous_p:
                most_dangerous_p = p
                most_dangerous = td
        combined = 1.0 - prob_not
        dealin_rates[mjai_tile] = round(combined * 100, 2)
        safety_ratings[mjai_tile] = round(dealin_to_safety(combined), 1)
        wait_breakdowns[mjai_tile] = _build_wait_breakdown(th, most_dangerous["combos"])
        # Partners come from the same threat that drives the wait breakdown,
        # so the "Suji" / "Half-suji" badge agrees visually with the waits
        # panel beside it.
        partners = _suji_partners(th, most_dangerous["threat"]["genbutsu"])
        if partners:
            suji_partners[mjai_tile] = [
                TENHOU_TO_MJAI[p] for p in partners if p in TENHOU_TO_MJAI
            ]

    per_threat = []
    for td in threat_data:
        seat = td["threat"]["seat"]
        dtr = td["threat"]["discards_to_riichi"]
        riichi_tile = None
        if dtr:
            riichi_tile = TENHOU_TO_MJAI.get(norm_red_five(dtr[-1]))
        genbutsu_mjai = sorted({
            TENHOU_TO_MJAI[t] for t in td["threat"]["genbutsu"]
            if t in TENHOU_TO_MJAI
        })
        rates = {}
        breakdowns = {}
        partners_by_tile = {}
        for mjai_tile, th in hand_norm.items():
            rates[mjai_tile] = round(dealin_probability(th, td["combos"]) * 100, 2)
            breakdowns[mjai_tile] = _build_wait_breakdown(th, td["combos"])
            partners = _suji_partners(th, td["threat"]["genbutsu"])
            if partners:
                partners_by_tile[mjai_tile] = [
                    TENHOU_TO_MJAI[p] for p in partners if p in TENHOU_TO_MJAI
                ]
        per_threat.append({
            "seat": seat,
            "riichi_tile": riichi_tile,
            "genbutsu": genbutsu_mjai,
            "dealin_rates": rates,
            "wait_breakdowns": breakdowns,
            "suji_partners": partners_by_tile,
        })

    return {
        "safety_ratings": safety_ratings,
        "dealin_rates": dealin_rates,
        "wait_breakdowns": wait_breakdowns,
        "suji_partners": suji_partners,
        "per_threat": per_threat,
    }


def get_tile_safety_for_mistake(hand_mjai, mjai_events, start_pos, end_pos,
                                player_id, tiles_left, wall_remaining):
    """Drop-in replacement for ``lib.defense.get_tile_safety_for_mistake``.

    Delegates to ``compute_kd_defense_data`` and returns just the 0-15 safety
    ratings so the env-var dispatch in ``lib/defense.py`` can swap evaluators
    without touching downstream code.
    """
    data = compute_kd_defense_data(hand_mjai, mjai_events, start_pos, end_pos,
                                   player_id, tiles_left, wall_remaining)
    if data is None:
        return None
    return data["safety_ratings"]
