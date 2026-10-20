"""Small, cached match summaries for the Games sidebar."""

from functools import lru_cache
import json
from pathlib import Path

from lib.parse import flatten_mjai_log


ROOT = Path(__file__).resolve().parent.parent


def load_match_info(mortal_file):
    """Keep only match metadata and the events needed by computeFinalScores.

    Cache the compact result, not the full analysis. Existing games work
    without a backfill, and changed files invalidate their cached summaries.
    """
    if not mortal_file:
        return None
    path = (ROOT / mortal_file).resolve()
    if not path.is_relative_to(ROOT):
        return None
    try:
        stat = path.stat()
        return _load_match_info(path, stat.st_mtime_ns, stat.st_size)
    except (OSError, ValueError, TypeError):
        return None


@lru_cache(maxsize=4096)
def _load_match_info(path, modified, size):
    with path.open() as source:
        data = json.load(source)
    if not isinstance(data, dict):
        return None
    events = flatten_mjai_log(data.get("mjai_log") or [])
    starts = [i for i, event in enumerate(events) if event.get("type") == "start_kyoku"]
    score_events = []
    if starts:
        # The first dealer breaks score ties; only the final hand changes
        # the final scores. Drop hands, discards, and all review payloads.
        selected = ([events[starts[0]]] if starts[0] != starts[-1] else []) + events[starts[-1]:]
        fields = {
            "start_kyoku": ("oya", "scores", "kyotaku"),
            "reach": ("actor",),
            "reach_accepted": ("actor",),
            "hora": ("target", "deltas"),
            "ryukyoku": ("deltas",),
        }
        for event in selected:
            kind = event.get("type")
            if kind in fields:
                score_events.append({"type": kind, **{key: event[key] for key in fields[kind] if key in event}})
    return {
        "game_length": data.get("game_length"),
        "player_id": data.get("player_id"),
        "mjai_log": score_events,
    }
