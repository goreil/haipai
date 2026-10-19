"""Compare Haipai ranks with manually reported Maka grades.

Reads the database without modifying it. Output contains aggregate metrics only.
Run in the app container: python /app/scripts/analyze_maka_ranks.py --db /app/data/games.db
"""

import argparse
import json
import math
import sqlite3
from collections import Counter, defaultdict


GRADES = [f"{letter}{suffix}" for letter in "EDCBAS" for suffix in ("-", "", "+")]
BASE_INTERCEPT = 21.124813514948926
BASE_SLOPE = 24.895305056375324


def grade_index(grade):
    try:
        return GRADES.index(grade)
    except ValueError:
        return None


def rank(score):
    return max(1, min(17, round(score)))


def base_score(ev_per_decision):
    return BASE_INTERCEPT - BASE_SLOPE * math.sqrt(ev_per_decision)


def load_samples(db_path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
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

        def add(kind, grade, decisions, loss):
            index = grade_index(grade)
            if index is None or not isinstance(decisions, (int, float)) or decisions <= 0:
                return
            if not isinstance(loss, (int, float)) or not math.isfinite(loss) or loss < 0:
                return
            samples.append({"game": game_id, "kind": kind, "grade": index,
                            "ev": loss / decisions})
            users[user_id] += 1

        add("overall", ratings.get("overall"), stats.get("total_decisions"),
            stats.get("total_ev_loss"))
        for i, (round_data, grade) in enumerate(zip(rounds, ratings.get("matches", []))):
            add("hand", grade, round_data.get("decision_count"), losses.get(i, 0))
    conn.close()
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


def evaluate(samples, transform=None):
    """Leave out every grade from the same game when fitting a test prediction."""
    predictions = {}
    for i, row in enumerate(samples):
        if transform is None:
            score = base_score(row["ev"])
        else:
            training = [other for other in samples if other["game"] != row["game"]]
            if len(training) < 3:
                return None
            intercept, slope = fit_curve(training, transform)
            score = intercept + slope * transform(row["ev"])
        predictions[row["game"], i] = rank(score)
    return metrics(samples, predictions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="SQLite games database path")
    args = parser.parse_args()
    samples, users = load_samples(args.db)
    print(f"Usable grades: {len(samples)} from {len(users)} users; "
          f"largest contributor: {max(users.values(), default=0)}")
    by_kind = defaultdict(list)
    for row in samples:
        by_kind[row["kind"]].append(row)
    models = {
        "Current": None,
        "Refit sqrt": math.sqrt,
        "Refit linear": lambda x: x,
        "Refit log": lambda x: math.log(x + 0.02),
    }
    for kind in ("overall", "hand"):
        rows = by_kind[kind]
        if not rows:
            continue
        print(f"\n{kind}: {len(rows)} grades across {len({r['game'] for r in rows})} games")
        print("Model          MAE   exact   within 1   bias (grade steps)")
        for name, transform in models.items():
            result = evaluate(rows, transform)
            if result is not None:
                mae, exact, near, bias = result
                print(f"{name:13} {mae:5.3f}  {exact:5.1%}    {near:5.1%}     {bias:+5.3f}")


if __name__ == "__main__":
    main()
