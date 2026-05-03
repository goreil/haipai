## Major refactoring target: Trim Backend, move everything frontend

**Idea:** Instead of computing categories server-side and persisting them to the DB, store only the raw game state (Mortal output + hand/board snapshot) and run categorization in the browser at view time.

**Benefits:**
1. **Less server storage** — no need to persist `cat_data.*` columns; categorization is derived on demand.
2. **No backfills** — changing categorization logic is a frontend deploy. No `scripts/backfill_*.py`, no local+Docker DB migrations (per the `backfill_on_change` memory, this is currently a tax on every rules change).
3. **User-customizable rules** — users could tweak thresholds (e.g., the 90% score gap, safety cutoffs) or swap in their own rule presets for practice mode.

**Open questions / risks:**
- `lib/categorize.py` depends on `lib/shanten.py` and `lib/ukeire.py` — both pure Python today. Porting to JS means either (a) rewriting them, (b) running them via Pyodide, or (c) keeping shanten/ukeire server-side and only moving the category decision tree. Option (c) is probably the pragmatic middle ground.
- Aggregates (per-category counts, trend charts, leaderboards) currently run SQL over `cat_data.*`. If categorization moves client-side, we'd either need to recompute on the backend for reports, or accept that reports become client-rendered too.
- Regression tests (C-02) assume a stable server-side classifier. A frontend port needs parallel test coverage.
- Interaction with the trainer-tip work in C-01 — tips would need to ship as JS data too.

**Not a near-term commit** — log for evaluation, don't schedule work until C-01/C-02 and the `categorization_vision` taxonomy settle.
