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

## Review of the 41 tracked grades, 2026-10-22

Keep the current shared game/hand thresholds. The 41 grades in the admin
counter are grades dated since the last ranking change
(`2026-09-22 19:12:18`), not 41 additions since the September 28 analysis.
They comprise seven overall grades and 34 hand grades across seven games,
dated September 26 through October 21. Two contributors supplied 38 and three
grades respectively; all 34 hand grades belong to four games. There are also
158 undated grades, which cannot reliably be classified as recent.

The full database now has 199 filled grades: 23 overall and 176 hand grades.
One hand still lacks a usable decision count, leaving 198 comparisons across
23 games and three contributors. The largest contributor supplies 194 usable
grades. Compared with the previous analysis, usable coverage increased by
only three overall grades; the usable hand sample is unchanged.

Repeating the same leave-one-game-out comparison on all usable grades gives:

| Scope | Current MAE | Refit square root MAE | Refit linear MAE | Refit logarithmic MAE |
| --- | ---: | ---: | ---: | ---: |
| Overall, 23 grades | 0.783 | **0.739** | 0.826 | 0.783 |
| Hand, 175 grades | **1.514** | 1.589 | 1.606 | 1.691 |
| Shared curve, 198 grades | **1.429** | 1.480 | 1.515 | 1.596 |

Each scope fits its candidate curves on the other games in that scope. The
shared-curve row evaluates the single scale used for both games and hands.
Its current exact-match rate is 25.3%, versus 23.2% for the square-root refit;
within-one-grade accuracy is 62.1%, versus 55.1%.

Restricting evaluation to the 41 dated grades, while still training each
candidate on all other games in the full sample, gives:

| Scope | Current MAE | Refit square root MAE | Refit linear MAE | Refit logarithmic MAE |
| --- | ---: | ---: | ---: | ---: |
| Overall, seven grades | 1.286 | **0.857** | **0.857** | 1.000 |
| Hand, 34 grades | 1.235 | 1.235 | **1.206** | 1.353 |
| Shared curve, 41 grades | 1.244 | 1.171 | **1.146** | 1.366 |

The recent subset favors higher overall grades, but its improvements do not
carry through to the complete shared-scale validation. The overall-only
square-root improvement across all 23 games amounts to one grade step of
total absolute error, with exact matches falling from 47.8% to 39.1%.
This does not justify replacing the shared thresholds or introducing a
separate overall scale. Leave the ranking-change timestamp unchanged, and
revisit when more independent contributors and games are available.

This review used read-only database access. It changes no stored grades,
coins, or report statuses.
