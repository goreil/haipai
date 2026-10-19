# Maka rank calibration, 2026-09-28

The live database contains 20 reported overall Maka grades and 176 reported hand
grades. One hand has no usable decision count, leaving 195 comparisons across
20 games. Two users reported grades, but one supplied 194 of the 195 usable
comparisons. These numbers describe the available sample, not the user base.

Haipai's current rank uses total recorded Mortal EV loss divided by reviewed
decisions and maps that value to a grade with a square-root curve. Maka uses its
own reviewer, so equal Haipai EV per decision does not guarantee equal Maka
grades. For example, the reported hand grades span several steps at similar EV
per decision. A one-dimensional conversion therefore has limited precision.

The table compares the current formula with curves refitted to Maka grades.
Each refitted curve was tested by leaving out an entire game, fitting on the
other games, and predicting the held-out game's grades. Errors count grade
steps, such as A to A+ as one step. The current formula has no fitting step.

| Scope | Model | Mean absolute error | Exact | Within one grade |
| --- | --- | ---: | ---: | ---: |
| Overall, 20 grades | Current | **0.700** | **55.0%** | 80.0% |
| Overall | Refit square root | 0.800 | 40.0% | 85.0% |
| Overall | Refit linear | 0.750 | 40.0% | 85.0% |
| Overall | Refit logarithmic | 0.750 | 45.0% | 85.0% |
| Hand, 175 grades | Current | **1.514** | **22.3%** | **60.0%** |
| Hand | Refit square root | 1.589 | 18.9% | 50.9% |
| Hand | Refit linear | 1.606 | 16.6% | 52.0% |
| Hand | Refit logarithmic | 1.691 | 17.1% | 47.4% |

Models adding decision count or mistake density were also checked during this
analysis. They did not improve held-out-game error. The current formula remains
in use because no tested replacement improved this sample out of sample. The
measured improvement from this calibration is **zero**; changing the curve now
would make the evidence-based result worse.

To repeat the comparison after more independent users report ranks:

```bash
docker exec haipai-app-1 python /app/scripts/analyze_maka_ranks.py --db /app/data/games.db
```

The script opens the database read-only and prints aggregate results. Recheck
both user coverage and held-out-game error before updating the production
formula. Data from more independent users is needed to estimate how well a
calibration will generalize.
