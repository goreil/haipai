"""Compare Haipai ranks with manually reported Maka grades.

Read-only by default. --record-review checkpoints the analyzed grade snapshot
for the admin counter, even if thresholds stay unchanged. Output is aggregate only.
Run in the app container: python /app/scripts/analyze_maka_ranks.py --db /app/data/games.db
"""

import argparse
import json
import math
from pathlib import Path
import sqlite3
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.admin import admin_maka_rank_stats  # noqa: E402
from db.maka import grade_snapshot, latest_review, record_review  # noqa: E402

GRADES = [f"{letter}{suffix}" for letter in "EDCBAS" for suffix in ("-", "", "+")]
BASE_INTERCEPT = 21.124813514948926
BASE_SLOPE = 24.895305056375324


def grade_index(grade):
    try:
        return GRADES.index(grade)
    except ValueError:
        return None


def rank(score):
    return max(1, min(17, math.floor(score + 0.5)))


def base_score(ev_per_decision):
    return BASE_INTERCEPT - BASE_SLOPE * math.sqrt(ev_per_decision)


def load_samples(db_path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return load_samples_from_connection(conn)
    finally:
        conn.close()


def load_samples_from_connection(conn):
    samples = []
    users = Counter()
    for game_id, user_id, stats_json, rounds_json, ratings_json in conn.execute(
        "SELECT id, user_id, stats_json, rounds_json, maka_ratings_json "
        "FROM games WHERE maka_ratings_json IS NOT NULL"
    ):
        stats = json.loads(stats_json or "{}")
        rounds = json.loads(rounds_json or "[]")
        ratings = json.loads(ratings_json)
        losses = dict(conn.execute(
            "SELECT round_idx, SUM(COALESCE(ev_loss, 0)) FROM mistakes "
            "WHERE game_id = ? GROUP BY round_idx", (game_id,)
        ))

        def add(kind, slot, grade, decisions, loss):
            index = grade_index(grade)
            if (index is None or not isinstance(decisions, (int, float))
                    or not math.isfinite(decisions) or decisions <= 0):
                return
            if not isinstance(loss, (int, float)) or not math.isfinite(loss) or loss < 0:
                return
            samples.append({"game": game_id, "user": user_id, "slot": f"{game_id}:{slot}",
                            "kind": kind, "grade": index,
                            "ev": loss / decisions})
            users[user_id] += 1

        add("overall", 0, ratings.get("overall"), stats.get("total_decisions"),
            stats.get("total_ev_loss"))
        for i, (round_data, grade) in enumerate(zip(rounds, ratings.get("matches", []))):
            add("hand", i + 1, grade, round_data.get("decision_count"), losses.get(i, 0))
    return samples, users


def fit_curve(samples, transform):
    """Fit grade = intercept + slope * transformed EV/D by least squares."""
    xs = [transform(row["ev"]) for row in samples]
    ys = [row["grade"] for row in samples]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance == 0:
        return mean_y, 0
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / variance
    return mean_y - slope * mean_x, slope


def metrics(samples, predictions):
    errors = [predictions[row["game"], i] - row["grade"] for i, row in enumerate(samples)]
    n = len(errors)
    return (sum(abs(e) for e in errors) / n,
            sum(e == 0 for e in errors) / n,
            sum(abs(e) <= 1 for e in errors) / n,
            sum(errors) / n)


def evaluate(samples, transform=None, *, separate=False, overall_only=False, test_samples=None):
    """Leave out every grade from the same game when fitting a test prediction."""
    predictions = {}
    rows = samples if test_samples is None else test_samples
    if not rows:
        return None
    for i, row in enumerate(rows):
        if transform is None or (overall_only and row["kind"] == "hand"):
            score = base_score(row["ev"])
        else:
            training = [other for other in samples if other["game"] != row["game"]
                        and (not separate or other["kind"] == row["kind"])]
            if len(training) < 3:
                return None
            intercept, slope = fit_curve(training, transform)
            score = intercept + slope * transform(row["ev"])
        predictions[row["game"], i] = rank(score)
    return metrics(rows, predictions)


MODELS = {"current": None, "sqrt": math.sqrt, "linear": lambda x: x,
          "log": lambda x: math.log(x + 0.02)}


def metric_dict(result):
    if result is None:
        return None
    return dict(zip(("mae", "exact", "within_one", "bias"), result))


def analyze(conn):
    """Run the full comparison in one read transaction; never mutate the source."""
    conn.execute("BEGIN")
    captured_at = conn.execute("SELECT strftime('%Y-%m-%d %H:%M:%f', 'now')").fetchone()[0]
    samples, users = load_samples_from_connection(conn)
    snapshot = grade_snapshot(conn)
    review = latest_review(conn)
    pending_stats = admin_maka_rank_stats(conn)
    if review:
        pending = {key for key, value in snapshot.items() if review["snapshot"].get(key) != value}
    else:
        pending = {key for key, value in snapshot.items() if value[1] and value[1] >= pending_stats["since"]}
    report = {"captured_at": captured_at, "reported_grades": len(snapshot), "usable_grades": len(samples),
              "unusable_grades": len(snapshot) - len(samples), "users": len(users),
              "games": len({r["game"] for r in samples}),
              "contributor_counts": sorted(users.values(), reverse=True),
              "pending": pending_stats, "scopes": {}}
    by_kind = defaultdict(list)
    for row in samples:
        by_kind[row["kind"]].append(row)
    for kind in ("overall", "hand", "combined"):
        rows = samples if kind == "combined" else by_kind[kind]
        new = [r for r in rows if r["slot"] in pending]
        models = {name: metric_dict(evaluate(rows, transform)) for name, transform in MODELS.items()}
        recent = {name: metric_dict(evaluate(rows, transform, test_samples=new))
                  for name, transform in MODELS.items()}
        if kind == "combined":
            for name, transform in MODELS.items():
                if transform is None:
                    continue
                for prefix, overall_only in (("separate", False), ("overall_only", True)):
                    options = {"separate": True, "overall_only": overall_only}
                    models[f"{prefix}_{name}"] = metric_dict(evaluate(rows, transform, **options))
                    recent[f"{prefix}_{name}"] = metric_dict(evaluate(rows, transform, test_samples=new, **options))
        report["scopes"][kind] = {
            "grades": len(rows), "games": len({r["game"] for r in rows}),
            "contributor_counts": sorted(Counter(r["user"] for r in rows).values(), reverse=True),
            "pending_usable": len(new), "models": models, "pending_models": recent,
            "fitted_coefficients": {
                name: dict(zip(("intercept", "slope"), fit_curve(rows, transform)))
                for name, transform in MODELS.items() if transform is not None and len(rows) >= 3},
        }
    conn.rollback()
    return report, snapshot, review["id"] if review else None


def print_report(report):
    print(f"Reported grades: {report['reported_grades']}; usable: {report['usable_grades']}; "
          f"unusable: {report['unusable_grades']}")
    print(f"Coverage: {report['games']} games, {report['users']} contributors; "
          f"contributions: {report['contributor_counts']}")
    print(f"Awaiting review: {report['pending']['count']}; "
          f"undated existing grades: {report['pending']['undated']}")
    for kind, scope in report["scopes"].items():
        print(f"\n{kind}: {scope['grades']} grades across {scope['games']} games; "
              f"contributions: {scope['contributor_counts']}")
        for label, models in (("All usable grades", scope["models"]),
                              (f"Pending usable grades ({scope['pending_usable']})", scope["pending_models"])):
            print(label)
            print("Model                 MAE   exact   within 1   bias (grade steps)")
            for name, result in models.items():
                if result is not None:
                    print(f"{name:20} {result['mae']:5.3f}  {result['exact']:5.1%}    "
                          f"{result['within_one']:5.1%}     {result['bias']:+5.3f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="SQLite games database path")
    parser.add_argument("--json", action="store_true", help="Print aggregate metrics as JSON")
    parser.add_argument("--record-review", action="store_true", help="Finish review and update the admin checkpoint")
    parser.add_argument("--conclusion", help="Completed analysis conclusion, required with --record-review")
    args = parser.parse_args()
    if args.record_review and not (args.conclusion and args.conclusion.strip()):
        parser.error("--record-review requires --conclusion")
    if args.conclusion and not args.record_review:
        parser.error("--conclusion requires --record-review")
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        report, snapshot, previous_id = analyze(conn)
    finally:
        conn.close()
    if args.record_review:
        conn = sqlite3.connect(f"file:{args.db}?mode=rw", uri=True)
        try:
            report["review_id"] = record_review(
                conn, captured_at=report["captured_at"], snapshot=snapshot, analysis=report,
                conclusion=args.conclusion, previous_review_id=previous_id,
            )
            report["admin_after"] = admin_maka_rank_stats(conn)
        finally:
            conn.close()
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_report(report)
        if args.record_review:
            print(f"\nCompleted review #{report['review_id']}; "
                  f"admin grades awaiting review: {report['admin_after']['count']}")


if __name__ == "__main__":
    main()
