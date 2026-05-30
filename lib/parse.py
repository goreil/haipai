#!/usr/bin/env python3
"""Parse Mortal AI JSON analysis into structured game data."""

from datetime import date
from typing import Any, NotRequired, TypedDict


class MistakeRecord(TypedDict):
    """A single mistake within a kyoku, as emitted by ``parse_game``.

    Categorize/DB layers later add fields (category, board_state, etc.) —
    those live in ``mistakes.data_json``.
    """
    turn: int
    ev_loss: float
    note: str | None
    hand: list[str]
    melds: list[Any]
    shanten: int | None
    draw: str | None
    actual: dict[str, Any]
    expected: dict[str, Any]
    top_actions: list[dict[str, Any]]


class RoundRecord(TypedDict):
    """One kyoku as emitted by ``parse_game``."""
    round: str              # e.g. "E1", "S3-1"
    honba: int
    turn_count: int
    decision_count: int
    decision_counts: dict[str, int] | None
    outcome: Any | None
    mistakes: list[MistakeRecord]


class GameRecord(TypedDict):
    """Return shape of ``parse_game``: structured game dict ready for
    ``db.add_game`` / ``compute_summary``.

    The DB layer later attaches ``mortal_file`` (set by the caller after
    saving the upload) and ``categorization_status``; the categorizer
    fills in per-mistake ``board_state`` / ``discard_stats`` / etc.
    """
    date: str
    log_url: str | None
    mortal_file: str | None
    rounds: list[RoundRecord]
    summary: dict[str, Any] | None
    # Optional fields layered on by callers / DB:
    game_id: NotRequired[int]
    categorization_status: NotRequired[str]


def severity(ev_loss):
    if ev_loss > 1.00:
        return "???"
    elif ev_loss >= 0.50:
        return "??"
    else:
        return "?"


def round_header(start):
    """Build round header string from a start_kyoku event."""
    header = f"{start['bakaze']}{start['kyoku']}"
    if start["honba"] > 0:
        header += f"-{start['honba']}"
    return header


def format_action(action):
    """Format an action dict for text display."""
    t = action.get("type", "?")
    if t == "dahai":
        return action["pai"]
    elif t in ("chi", "pon"):
        consumed = "".join(action.get("consumed", []))
        return f"{t} {consumed}+{action.get('pai', '?')}"
    elif t == "reach":
        return "riichi"
    elif t == "hora":
        return "win"
    elif t == "none":
        return "pass"
    elif t == "ankan":
        return f"ankan {action.get('consumed', ['?'])[0]}"
    return t


def flatten_mjai_log(mjai_log):
    """mjai_log entries can be lists of simultaneous events; flatten to a
    single sequential list of event dicts."""
    flat = []
    for item in mjai_log:
        if isinstance(item, dict):
            flat.append(item)
        elif isinstance(item, list):
            for sub in item:
                if isinstance(sub, dict):
                    flat.append(sub)
    return flat


def walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left=0):
    """Single canonical pass over a kyoku's mjai events.

    Feeds every defense / attack-side extractor: classic-suji walker
    (``lib/defense.py``), KillerDucky walker (``lib/defense_kd.py``), and
    parse's per-junme decision-state tracker (CS-02). Walking once per
    consumer call is fine — the win is *one implementation* of "what did
    each opponent do, and was anyone in riichi at each player tsumo".

    Walks ``events[start_pos+1 : end_pos]`` and stops as soon as
    ``tiles_left <= target_tiles_left`` (defense walkers cut at the
    mistake's own tsumo; ``parse_game`` walks the full kyoku with the
    default ``0``).

    Returns a dict::

        {
          "opponents": {seat: {
              "discards": [mjai, ...],   # raw, includes red-five marks
              "reach_event_idx": int|None,
                  # len(discards) AT the moment the `reach` event fired —
                  # i.e. the slot the riichi tile WILL land on at the next
                  # dahai. Adapters that want the historic off-by-one
                  # semantic subtract 1; KD-style adapters use it as is
                  # (and check `< len(discards)` to confirm the riichi
                  # tile actually got discarded).
              "reach_accepted": bool,    # `reach_accepted` event observed
              "open_melds": int,         # pon/chi/daiminkan count (kakan
                                         # doesn't bump — already counted
                                         # by the underlying pon)
          }},
          "player_tsumo_riichi_state": [bool, ...],
              # one entry per player tsumo, in order. True iff at least
              # one opponent had already been reach_accepted. Indexable
              # by junme.
          "genbutsu_post_reach_by_seat": {seat: [mjai, ...]},
              # for each opp seat that ever hit reach_accepted: every
              # dahai/kakan tile (any actor) seen after that moment.
              # Raw mjai (red-five marks preserved). KD adapter
              # normalises and unions with the seat's own discards.
          "first_dora_indicator": mjai|None,
          "tiles_left_at_end": int,
        }
    """
    opponents = {}
    player_tsumo_riichi_state = []
    reach_accepted_seats = set()
    genbutsu_post_reach_by_seat = {}
    tiles_left = 70
    first_dora_indicator = None

    if 0 <= start_pos < len(events):
        sk = events[start_pos]
        if sk.get("type") == "start_kyoku":
            dm = sk.get("dora_marker")
            if isinstance(dm, list) and dm:
                dm = dm[0]
            if isinstance(dm, str):
                first_dora_indicator = dm

    def _ensure(actor):
        return opponents.setdefault(actor, {
            "discards": [],
            "reach_event_idx": None,
            "reach_accepted": False,
            "open_melds": 0,
        })

    for pos in range(start_pos + 1, end_pos):
        e = events[pos]
        etype = e.get("type")
        actor = e.get("actor")

        if etype == "tsumo":
            tiles_left -= 1
            if actor == player_id:
                player_tsumo_riichi_state.append(bool(reach_accepted_seats))

        elif etype == "dahai" and actor is not None:
            pai = e.get("pai")
            if actor != player_id:
                _ensure(actor)["discards"].append(pai)
            if pai is not None:
                for seat in reach_accepted_seats:
                    genbutsu_post_reach_by_seat.setdefault(seat, []).append(pai)

        elif etype == "kakan" and actor is not None:
            pai = e.get("pai")
            # kakan upgrades an existing pon — register the seat (so the
            # opp dict isn't missing) but don't bump open_melds.
            if actor != player_id:
                _ensure(actor)
            if pai is not None:
                for seat in reach_accepted_seats:
                    genbutsu_post_reach_by_seat.setdefault(seat, []).append(pai)

        elif etype == "reach" and actor is not None and actor != player_id:
            opp = _ensure(actor)
            opp["reach_event_idx"] = len(opp["discards"])

        elif etype == "reach_accepted" and actor is not None and actor != player_id:
            opp = _ensure(actor)
            opp["reach_accepted"] = True
            reach_accepted_seats.add(actor)

        elif etype in ("pon", "chi", "daiminkan") and actor is not None and actor != player_id:
            _ensure(actor)["open_melds"] += 1

        if tiles_left <= target_tiles_left:
            break

    return {
        "opponents": opponents,
        "player_tsumo_riichi_state": player_tsumo_riichi_state,
        "genbutsu_post_reach_by_seat": genbutsu_post_reach_by_seat,
        "first_dora_indicator": first_dora_indicator,
        "tiles_left_at_end": tiles_left,
    }


_MELD_TYPES = frozenset({"chi", "pon"})
_KAN_TYPES = frozenset({"ankan", "kakan", "daiminkan"})


def skill_area_for_entry(actual_type, expected_type, detail_types=(),
                         in_riichi=False):
    """Classify a Mortal review entry into exactly one skill area.

    Returns ``"attack"``, ``"defense"``, ``"meld"``, ``"riichi"``, ``"kan"``,
    or ``None`` (entry isn't a trackable player decision).

    Used as the denominator bucket for the trends EV/D bars: each entry
    lands in exactly one area, the highest-priority non-dahai action type
    in either ``actual.type`` or ``expected.type``. Plain dahai falls
    through to attack/defense based on whether the player is in riichi.
    """
    types = {actual_type, expected_type}
    if types & _MELD_TYPES:
        return "meld"
    if "reach" in types:
        return "riichi"
    if types & _KAN_TYPES:
        return "kan"
    if "dahai" in types:
        return "defense" if in_riichi else "attack"
    d = set(detail_types)
    if d & _MELD_TYPES:
        return "meld"
    if "reach" in d:
        return "riichi"
    if d & _KAN_TYPES:
        return "kan"
    return None


def _decision_counts_for_kyoku(entries, start_pos, end_pos, events, player_id):
    """Per-skill-area decision counts for one kyoku — the denominators used
    by the trends EV/D bars.

    Each entry lands in exactly ONE bucket (sum of buckets = number of
    counted entries), via ``skill_area_for_entry``. That shares its
    priority rule with ``categorize_by_action_type`` / CATEGORY_INFO
    groups, so a mistake's skill area (via its code's group) and its
    denominator bucket always agree: a 5B (missed riichi) goes to the
    ``riichi`` denominator, a D2 push goes to ``defense``, etc.
    """
    counts = {"attack": 0, "defense": 0, "riichi": 0, "meld": 0, "kan": 0}
    state = walk_kyoku(events, start_pos, end_pos, player_id)
    junme_riichi_state = state["player_tsumo_riichi_state"]

    for entry in entries:
        junme = entry.get("junme")
        actual_type = (entry.get("actual") or {}).get("type")
        expected_type = (entry.get("expected") or {}).get("type")
        detail_types = [
            (d.get("action") or {}).get("type")
            for d in entry.get("details", [])
        ]
        in_riichi = (
            junme is not None
            and 0 <= junme < len(junme_riichi_state)
            and junme_riichi_state[junme]
        )
        area = skill_area_for_entry(
            actual_type, expected_type, detail_types, in_riichi=in_riichi
        )
        if area:
            counts[area] += 1
    return counts


def parse_game(data, game_date=None) -> GameRecord:
    """Parse Mortal JSON into a structured ``GameRecord``.

    Returns a ``GameRecord`` (TypedDict, runtime ``dict``) with keys
    ``date``, ``log_url``, ``mortal_file``, ``rounds``, ``summary``.
    The summary and annotations are layered on by the DB / categorizer
    downstream. See ``GameRecord`` / ``RoundRecord`` / ``MistakeRecord``
    declarations at the top of this module for the full shape.
    """
    game_date = game_date or date.today().isoformat()

    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object, got " + type(data).__name__)
    if "review" not in data or not isinstance(data.get("review"), dict):
        raise ValueError("Missing or invalid 'review' field")
    if "kyokus" not in data["review"] or not isinstance(data["review"]["kyokus"], list):
        raise ValueError("Missing or invalid 'review.kyokus' field")
    if "mjai_log" not in data or not isinstance(data.get("mjai_log"), list):
        raise ValueError("Missing or invalid 'mjai_log' field")

    kyokus = data["review"]["kyokus"]
    start_events = [
        e for e in data["mjai_log"]
        if isinstance(e, dict) and e.get("type") == "start_kyoku"
    ]

    if len(kyokus) != len(start_events):
        raise ValueError(
            f"{len(kyokus)} review kyokus but {len(start_events)} start_kyoku events"
        )

    flat_events = flatten_mjai_log(data["mjai_log"])
    start_positions = [
        i for i, e in enumerate(flat_events) if e.get("type") == "start_kyoku"
    ]
    player_id = data.get("player_id")

    rounds = []
    for kyoku_idx, (kyoku, start) in enumerate(zip(kyokus, start_events)):
        entries = kyoku["entries"]
        turn_count = (max(e["junme"] for e in entries) + 1) if entries else 0
        decision_count = len(entries)
        start_pos = start_positions[kyoku_idx] if kyoku_idx < len(start_positions) else None
        end_pos = (start_positions[kyoku_idx + 1]
                   if start_pos is not None and kyoku_idx + 1 < len(start_positions)
                   else len(flat_events))
        decision_counts = (
            _decision_counts_for_kyoku(entries, start_pos, end_pos, flat_events, player_id)
            if start_pos is not None and player_id is not None
            else None
        )

        mistakes = []
        for entry in entries:
            if not entry["is_equal"]:
                try:
                    expected_q = entry["details"][0]["q_value"]
                    actual_q = entry["details"][entry["actual_index"]]["q_value"]
                except (KeyError, IndexError, TypeError) as e:
                    raise ValueError(f"Malformed entry in kyoku: {e}") from e
                ev_loss = round(expected_q - actual_q, 2)

                # Store all Mortal-evaluated actions so the EV table can show
                # a Q-value for every highlighted tile (actual/expected/best_discard)
                # without the "-" dash that appeared whenever the third
                # highlight row wasn't in Mortal's top 3.
                top_actions = [
                    {
                        "action": d["action"],
                        "q_value": round(d["q_value"], 4),
                        "prob": round(d["prob"], 4),
                    }
                    for d in entry["details"]
                ]

                mistakes.append({
                    "turn": entry["junme"],
                    "ev_loss": ev_loss,
                    "note": None,
                    "hand": entry["state"]["tehai"],
                    "melds": entry["state"]["fuuros"],
                    "shanten": entry.get("shanten"),
                    "draw": entry.get("tile"),
                    "actual": entry["actual"],
                    "expected": entry["expected"],
                    "top_actions": top_actions,
                })

        rounds.append({
            "round": round_header(start),
            "honba": start["honba"],
            "turn_count": turn_count,
            "decision_count": decision_count,
            "decision_counts": decision_counts,
            "outcome": None,
            "mistakes": mistakes,
        })

    return {
        "date": game_date,
        "log_url": None,
        "mortal_file": None,
        "rounds": rounds,
        "summary": None,
    }


