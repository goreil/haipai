# Repository Guidelines

## Project Structure & Module Organization

`app.py` creates the Flask application. HTTP blueprints live in `routes/`, while SQLite access is grouped by domain in `db/` (`db/schema.py` owns schema and migrations). Shared parsing and mail helpers belong in `lib/`. Browser code and styles are under `static/`; Jinja pages are in `templates/`. Python tests live in `tests/`, with reusable JSON inputs in `tests/fixtures/`. Operational and analysis utilities belong in `scripts/`, and longer design notes belong in `docs/`.

The repository also contains independent components: the Elm client in `riichi-mahjong-trainer/`, the Rust/WASM shanten engine in `wasm/haipai-shanten/`, and browser extensions in `extension/` and `extension-firefox/`. Read nearby documentation before changing these areas.

## Build, Test, and Development Commands

Use the checked-in virtual environment; system Python may lack project dependencies.

```bash
FLASK_ENV=development .venv/bin/python app.py  # local server on :5000
.venv/bin/pytest tests/ -v                    # complete Python suite
.venv/bin/ruff check .                        # Python lint checks
docker compose up -d --build                  # build and start production stack
docker compose logs -f app                    # follow application logs
```

For the Elm subproject, run `npm test`, `npm run format`, or `npm run review` from `riichi-mahjong-trainer/`. Rebuild web WASM with `scripts/wasm_build_web.sh` after Rust changes.

## Coding Style & Naming Conventions

Use four-space indentation and `snake_case` for Python functions/modules; use `PascalCase` for classes. Ruff enforces `E`, `F`, and `W` rules with a 120-character line target. Keep route handlers thin and put persistence logic in `db/`. Existing JavaScript uses lower camel case and scope-based `style-*.css` files. Preserve Elm formatting with `elm-format`; format Rust with `cargo fmt`.

## Testing Guidelines

Pytest discovers `test_*.py`, `Test*` classes, and `test_*` functions. Add regression tests beside the affected API or database area and reuse fixtures from `tests/fixtures.py` or `tests/fixtures/`. Run the full suite before submitting; use `--cov` when evaluating coverage. Component-specific changes should also run their Elm or Rust tests.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, feature-scoped subjects, such as `Account: leaderboard display name`. Follow that `Area: outcome` pattern when practical. Keep commits focused. Pull requests should explain user-visible behavior, identify migrations or configuration changes, link relevant issues, list tests run, and include screenshots for UI changes. Never commit secrets, `.env`, local databases, analysis output, or generated backups.
