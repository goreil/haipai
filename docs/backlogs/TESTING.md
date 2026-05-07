# Test Coverage Gaps

**Date**: 2026-04-21
**Current**: 342 tests (ex-`test_defense` pre-existing WIP), 4 modules of deep unit tests + `tests/test_snapshots.py` golden-replay harness.
**CI**: none — the `test.yml` workflow was removed in 8e2a601. Tests only run when someone invokes `.venv/bin/pytest` locally.

---

## Open 
- Frontend (`static/app.js`) is untested. 

### T-10: Test configuration polish
Extract duplicate `client` fixtures from `test_core.py` and `test_api.py` into shared `conftest` fixtures. Add coverage reporting to CI workflow.

### T-11: Integration / E2E
`tests/test_core.py::TestAddGamePipeline` now covers upload → parse → categorize → retrieve → delete. Remaining gaps: no Docker build verification (no CI at all — see top), no API contract tests (request/response shapes).

### T-12: Failure-mode fixtures
Current fixtures are all valid data. Missing: malformed JSON, network-error simulation (nanikiru down), edge-case game states (zero mistakes, 100+ mistakes, all severities).
