"""Category registry and per-game summary aggregation.

CATEGORY_INFO is the source of truth for mistake-category codes (Attack
P1–P4, Defense D1–D3, Meld 4A–4C, Riichi 5A–5B, Kan 6A–6B, plus legacy
1A/2A/3A–C codes kept for rendering historical data).
"""

CATEGORY_INFO = {
    # --- Attack categories (no riichi threat, increasing difficulty) ---
    "P1": {"group": "Attack", "label": "Shanten Failure", "desc": "Your discard ends up at a worse shanten than Mortal's pick — your hand moved further from winning",                          "study": "Riichi Book Ch 3"},
    "P2": {"group": "Attack", "label": "Tile Efficiency", "desc": "Same shanten as Mortal's pick, but fewer tile acceptance (ukeire)",                                                          "study": "Riichi Book Ch 3-4"},
    "P3": {"group": "Attack", "label": "Hand Value",      "desc": "Similar tile acceptance, but Mortal's pick keeps a yakuhai or dora — preserves more value if you win",                      "study": "Riichi Book Ch 5-6"},
    "P4": {"group": "Attack", "label": "Complex Decision","desc": "Mortal prefers a different tile for reasons that aren't pure shanten, ukeire, or hand value — a strategic judgment call",   "study": "Riichi Book Ch 8.1"},
    # --- Defense categories (opponent in riichi; compared by deal-in rate) ---
    "D1": {"group": "Defense", "label": "Defend",              "desc": "Mortal's discard has a lower deal-in rate than yours — a defensive read.",                                                "study": "Riichi Book Ch 8.2-8.4"},
    "D2": {"group": "Defense", "label": "Push",                "desc": "Mortal chose a more dangerous tile, but basic strategy (shanten or tile acceptance) justifies the push.",                 "study": "Riichi Book Ch 8.1"},
    "D3": {"group": "Defense", "label": "Complex",             "desc": "Mortal chose a more dangerous tile and basic strategy can't explain it — a genuine risk/reward judgment call.",           "study": "Riichi Book Ch 8.1"},
    # --- Meld decisions ---
    "4A": {"group": "Meld",    "label": "Bad Call",            "desc": "Called chi/pon when shouldn't have",                                                        "study": "Riichi Book Ch 9"},
    "4B": {"group": "Meld",    "label": "Missed Call",         "desc": "Didn't call chi/pon when should have",                                                     "study": "Riichi Book Ch 9"},
    "4C": {"group": "Meld",    "label": "Wrong Choice",        "desc": "Called wrong combination",                                                                 "study": "Riichi Book Ch 9"},
    # --- Riichi decisions ---
    "5A": {"group": "Riichi",  "label": "Bad Riichi",          "desc": "Declared riichi when shouldn't have",                                                      "study": "Riichi Book Ch 7"},
    "5B": {"group": "Riichi",  "label": "Missed Riichi",       "desc": "Didn't declare riichi when should have",                                                   "study": "Riichi Book Ch 7"},
    # --- Kan decisions ---
    "6A": {"group": "Kan",     "label": "Bad Kan",             "desc": "Declared kan when shouldn't have",                                                         "study": "Riichi Book Ch 9.3"},
    "6B": {"group": "Kan",     "label": "Missed Kan",          "desc": "Didn't declare kan when should have",                                                      "study": "Riichi Book Ch 9.3"},
    # --- Legacy categories (kept for rendering old data) ---
    "1A": {"group": "Attack", "label": "Tile Efficiency",     "desc": "Chose a discard with lower tile acceptance or expected score",                              "study": "Riichi Book Ch 3-4",     "legacy": True},
    "2A": {"group": "Attack", "label": "Value Tile Ordering", "desc": "Chose wrong between a value tile and a number tile when efficiency was similar",            "study": "Riichi Book Ch 3.2",     "legacy": True},
    "3A": {"group": "Attack", "label": "Complex Decision",    "desc": "Strategic disagreement — neither pure defense nor efficiency",                              "study": "Riichi Book Ch 8.1",     "legacy": True},
    "3B": {"group": "Defense",        "label": "Defense",             "desc": "Mortal chose a safer tile against an opponent in riichi",                                   "study": "Riichi Book Ch 8.2-8.4", "legacy": True},
    "3C": {"group": "Attack", "label": "Hand Value",          "desc": "Sacrificed speed for hand value or vice versa",                                             "study": "Riichi Book Ch 5-6",     "legacy": True},
}

CATEGORIES = list(CATEGORY_INFO.keys())


def compute_summary(game):
    """Compute summary stats for a game. Mutates game dict.

    No `by_category` rollup: the JS categorizer is the source of truth and
    recomputes per-game / cross-game category aggregates on the frontend
    (see static/js/game-list.js::recomputeSummaryByCategory and the
    TRENDS-WEAKEST-CATEGORY cache).
    """
    from lib.parse import severity
    total = 0
    total_ev = 0.0
    total_decisions = 0
    by_severity = {"???": 0, "??": 0, "?": 0, "!": 0}
    decision_counts = {"attack": 0, "defense": 0, "riichi": 0, "meld": 0, "kan": 0}
    has_decision_counts = False

    for rnd in game["rounds"]:
        # Prefer decision_count (excludes post-riichi), fall back to turn_count
        dc = rnd.get("decision_count") or rnd.get("turn_count")
        if dc:
            total_decisions += dc
        per_cat = rnd.get("decision_counts")
        if per_cat:
            has_decision_counts = True
            for k, v in per_cat.items():
                decision_counts[k] = decision_counts.get(k, 0) + v
        for m in rnd["mistakes"]:
            total += 1
            total_ev += m["ev_loss"]
            sev = severity(m["ev_loss"])
            if sev in by_severity:
                by_severity[sev] += 1

    game["summary"] = {
        "total_mistakes": total,
        "total_ev_loss": round(total_ev, 2),
        "total_decisions": total_decisions if total_decisions > 0 else None,
        "ev_per_decision": round(total_ev / total_decisions, 4) if total_decisions > 0 else None,
        "by_severity": by_severity,
        "decision_counts": decision_counts if has_decision_counts else None,
    }
