# Overlap between the report backlog and the Complex bucket

Question: are reported miscategorizations disproportionately Complex-bucket
cases? Method: re-ran the live categorizer (current `categorize.js` +
`compare-dimensions.js`) over all 35 reported mistakes' games from the fresh
prod sync and read off each mistake's current `shape`.

## Headline numbers

Current shape of the 35 reported mistakes:

| shape | count | share | corpus base rate |
|---|---|---|---|
| complex | 26 | 74% | 24.2% |
| trade-off | 5 | 14% | 44.0% |
| obvious | 2 | 6% | 21.2% |
| n/a (riichi/action) | 2 | 6% | 10.6% |

**74% of reports vs a 24.2% base rate — 3× overrepresented.** But part of
that is by construction, so the honest split:

- The 20 `complex_gap` reports come from a funnel that only *exists* on
  complex cards. Their overlap is tautological (18/20 still classify complex
  today; 2 have since migrated — m18081 to obvious and m20932 to trade-off,
  i.e. dimensions shipped after the report already explained them).
- The **15 organically-filed reports** (`wrong_text` + legacy
  `wrong_category`, where the user could report any card): **8/15 = 53%
  complex** vs the 24.2% base rate — **2.2× overrepresented**, and that is
  the real signal. Users disproportionately hit "this is wrong" exactly
  where the win-vector had nothing to say.

Secondary observation: the reported complex cases are heavy ones. The 26
complex reports average ~0.85 ev_loss, versus 0.26 median in the random
complex sample (`COMPLEX-ANATOMY.md`) — users report the complex cases that
*hurt*, not the coin flips.

## Failure modes × anatomy buckets

The two analyses converge on the same ranking, from opposite directions
(reports = what users notice; sample = what's actually in the bucket):

| FAILURE-MODES cluster (reports) | COMPLEX-ANATOMY bucket (sample) | agreement |
|---|---|---|
| #1 safe-tile management (7 reports) | SAFETY 30% of cases / 30% of EV | strongest cluster in both |
| #3 5-block / shape (7 reports) | BLOCK 15% / 28% EV | second in both |
| #6 wait quality (3 reports) | WAITQ 4% / 6% EV | present in both, smaller than reports suggest |
| #2 yaku coverage (7 reports) | YAKU 7% / 9% EV | reports overweight it (text complaints inflate the count) |
| #4 furiten (4 reports) | FURITEN 1/120 | reports overweight it — furiten is rare but *memorable*; still cheap to fix |
| #5 live-count bug (3 reports) | (not an anatomy bucket — a data bug) | invisible in the sample because it corrupts *displayed* counts, not shape |
| #7 placement (2 reports) | inside SAFETY (fold cases) | consistent |

Divergences worth noting:

- **NOISE (27.5% of the sample) generates almost no reports.** Users don't
  bother reporting cards they can shrug at — the funnel underweights the
  strongest argument for a severity floor. Only the corpus view reveals it.
- **Furiten and yaku-text gaps are overrepresented in reports** relative to
  their true frequency: they're the failures an expert user can *name*, so
  they get filed. Frequency-in-backlog is a measure of nameability as much
  as prevalence.

## Takeaway

Yes — miscategorization reports concentrate in the Complex bucket (2.2× even
after excluding the tautological funnel kind), and both datasets point at the
same top two investments: a **pre-threat safe-tile/safety dimension** and the
**HP-02 block-partition work**, in that order by breadth, with the
`reconstruct_context` live-count bug (FAILURE-MODES #5) as the cheapest
immediate fix. The one thing only the sample shows: pair it with a severity
floor for near-tied picks, or a quarter of the bucket stays unexplainable
noise no dimension will ever name.
