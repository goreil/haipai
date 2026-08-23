# CLAUDE.md

Guidance for Claude Code working in the Haipai repo.

## What this is

Riichi mahjong game analysis web app. Analyzes Tenhou/MJS replays via Mortal AI, auto-categorizes mistakes using a local pure-Python shanten/ukeire library, and serves a web UI for review, annotation, and trend tracking. 

## Commands

The project uses a venv at `.venv/`. Invoke its binaries directly (`.venv/bin/python`, `.venv/bin/pytest`) — system `python3` does not have `mahjong` or the Flask deps installed.


```bash
# Web UI (dev server)
FLASK_ENV=development .venv/bin/python app.py       # http://localhost:5000

# Tests
.venv/bin/pytest tests/ -v

# Docker (production)
# Source dirs (static/, templates/, app.py, db/, lib/, routes/, scripts/) are
# bind-mounted and gunicorn runs --reload, so code/static/template edits go live
# on the next request — no restart needed. Rebuild only when deps/image change.
docker-compose up -d --build      # after requirements/Dockerfile/compose changes
docker-compose restart app        # rarely needed; only to force a clean reload
docker-compose logs -f app
```

## Important notes

- Downloads from `mjai.ekyu.moe` must be done manually due to cloudflare
- `SECRET_KEY` must be set via `.env` or environment variable. No insecure default is provided.
- `DEMO_GAME_ID` (optional): game id shown at `/demo` for logged-out visitors (linked from the login/landing pages). Unset disables `/demo` (404). Swapping the demo game is a one-line env change — see the "Public game sharing" entry below.
- Debug mode requires `FLASK_ENV=development` (off by default).
- Frontend should handle most categorization logic, backend handles shanten/ukeire calc but that's subject to change.


## Data storage

SQLite database at `games.db`. — read it there rather than duplicating here.

## Where things live

User-visible concepts that span more than one file. Start here before
grepping. If you change a concept that isn't listed, add it.

**Frontend — features**
- Concept-level EV breakdown (top of a game): a **ledger** ("Losing points here" = concepts the AI won / under-used) stacked above a **column of trade-off boxes** (which replaced the old "Overvaluing these" ledger). Aggregator `static/js/game-concept-breakdown.js`. The ledger side: `aggregate()` re-buckets the `compare-dimensions.js` win-vector per side×**group**, deduped per mistake so deal_in's per-seat vector and dora_kept+dora_acceptance each count once; attributes full `ev_loss` to every group a mistake touches → columns don't sum to total EV, hence the `.concept-note` disclaimer. The **trade-off boxes**: `tradeoffBoxes()` buckets every *over-favoring* mistake (≥1 you-side win or bad-action pill) into exactly ONE axis by priority — **Push vs. Fold** (any Defense/deal_in pole), else **Speed vs. Value** (Speed on one side, Yaku/Dora on the other), else **Other** (catch-all: yaku-vs-dora, single-pole, bad riichi/call/kan). Each box lists per-mistake rows: your play's winning pills (left) vs the better play's (right), tier-coloured EV, and a `→` jump button (reuses the `#m<id>` deep-link router). Both are rendered by `renderConceptBreakdown` (ledger) + `renderTradeoffBoxes` (boxes) + `renderTopGroupStat` (summary-bar "Top leak") in `static/js/game-render.js`. **Row pills are the SAME concrete chips as the EV-table summary** ("+5 ukeire", "+dora 🀋", "-2.6% deal-in") via the shared `renderWinFeatPill(w, oya)` extracted to `static/js/ev-table.js` (top-level; consumed by both `renderEvComparison` and `renderTradeoffBoxes`). Deal-in pills carry **push/fold context** as a muted `.feat-pill-ctx` clause ("· dealer riichi", "· open 3han (W)"): `compare-dimensions.js` attaches `w.threat = {kind, seat, han}` (via `threatMeta`) to each deal_in win — `han` is `guaranteed_han`, open threats only (riichi han is unknown pre-reveal → null); `renderWinFeatPill` derives dealer-ness from `threat.seat` vs `oya` (E seat → "dealer" prefix replaces the bare wind tag; non-dealers keep " (wind)"). Shared, so it shows in both the EV table and the boxes. Group taxonomy/colour (Efficiency=blue, Yaku=cyan, Value=gold, Defense=red — hues align with the skill-area card palette) is the single shared source `haipaiCompareDimensions.GROUP_META` (`compare-dimensions.js`), consumed by the feat-pills (`.feat-pill-grp` via `--feat-grp`) AND the ledger's group pills (`.concept-pill` via `--grp`). On top of the win-vector groups the ledger adds **category/shape pills** off the categorized mistake (`ACTION_CELL`/`PILL_META` in `game-concept-breakdown.js`, deduped via `cellsFor`): Riichi (purple) / Meld (pink) / Kan (green) split Missed→ledger vs Bad→boxes off `m.category` (5A/5B, 4A-4C, 6A/6B); Complex (grey) is missed-side ledger only off `m.shape`. `game-render.js` resolves palettes via `conceptMetaMap()`. Styles `.concept-breakdown` / `.tradeoff-box` / `.feat-pill-grp` in `static/style-game-detail.css`
- Dora highlighting (the orange tile border): single source of truth in `static/js/tiles.js` — `renderTile()` auto-adds `.dora-highlight` from an ambient active-dora set (`setActiveDora()`). Card/board renderers arm the set (`renderMistakeCard`, `renderBoardContext`, the `game-render.js` card loop, `renderEvComparison`, `generateExplanation`); every tile then highlights automatically, including future features. Red fives always highlight. Opt out via `no-dora` / `dora-indicator` / `wind-tile` classes (reference glyphs + the opponent yaku panel). Style: `.tile.dora-highlight` in `static/style-board-display.css`.
- Yaku panel (opponent open-hand pill strip): `static/js/board-yaku-panel.js` (render), `static/js/prep/prep-board-yaku.js` (compute), `static/style-game-detail.css` (style)
- Discard rows (you / danger / riichi) + safe-tile hover: `static/js/board-discards.js`, `static/style-board-display.css`
- Meld rendering: `static/js/board-melds.js`
- Categorization (the live, client-side engine — there is no `lib/categorize.py`): `static/js/categorize.js` (entry), `static/js/categorize-metadata.js` (category labels/groups/colors), `static/js/categorize-yaku.js` (closed-hand yaku detection), `static/js/categorize-explanations.js` (per-category explanation blocks). Before/after changing any of these, benchmark with `scripts/category_bench.mjs` → `.claude/skills/categorize-bench/SKILL.md`
- Mistake card (per-round entry on game detail): `static/js/mistake-card.js`
- Complex-gap feedback funnel (EXTRAS-A): on **complex**-shape cards, embedded
  INSIDE the trainer's speech bubble (under the "stats don't explain it — trust
  the read" line), a "We can't pin down what Mortal read — can you?" CTA with
  multi-select quick-tags + free text. Complex cards get NO `wrong_text` report
  row (the funnel replaces it). The bubble is built by `trainerBubbleHtml(m)`
  (`static/js/mistake-card.js`) — used by both game-detail render paths in
  `static/js/game-render.js` (rounds + summary); admin/trends build their own
  non-interactive bubbles via `generateExplanation` directly, so the funnel never
  leaks there. Funnel render/handlers `renderComplexGapFunnel`/`saveComplexGap`/
  `onComplexTag`/`onComplexReason` (`static/js/mistake-card.js`), actions in
  `static/js/actions.js`, styles `.complex-gap-*` (`static/style-game-detail.css`).
  Stored in `category_reports` under kind `complex_gap` (tags comma-joined in
  `suggested_category`, free text in `reason`; no schema change): `db/reports.py`
  `REPORT_KINDS` + the report route in `routes/game.py`. Read path:
  `scripts/show_reports.py` (`--kind complex_gap`, tag tally) + admin reports
  (`static/js/admin.js`).
- EV / severity tier coloring: `static/js/severity.js` (shared helpers), `static/js/ev-table.js`; importers: `static/js/trends-charts.js`, `static/js/game-render.js`, `static/js/categorize-explanations.js`
- Skill-area metadata (push/defense/riichi labels): `static/js/skill-areas.js`; importers: `static/js/trends-*.js`, `static/js/game-render.js`
- Trends page: `static/js/trends-view.js` (page shell + fetch), `static/js/trends-charts.js` (SVG charts), `static/js/trends-analysis.js` (worker pool + aggregations)
- Game list + game detail: `static/js/game-fetch.js` (load + annotation save), `static/js/game-render.js` (sidebar + detail render), `static/js/game-prep.js` (prep progress + recategorize)
- Defense (riichi safety): `static/js/prep/defense.js` (classic suji), `static/js/prep/defense_kd.js` (KillerDucky port — riichi threats only, see [[defense_open_meld_deferred]]), `static/js/defense-labels.js` (UI label map)
- Soft-safe open defense (`Safe*` — tsumogiri-extended genbutsu): open-threat tiles that passed while the opp's wait was frozen (since their last tedashi) mark safe but never seed suji. `parse.js` (`flow_pos_at_last_tedashi`), `defense.js` (`soft_safe` set, deal-in→0), `defense-labels.js` (`softSafeForTile`), rendered as `Safe*` in `board-discards.js` + `ev-table.js`, board hover anchor on the last tedashi in `ui.js`. Rationale (esp. why no suji): `docs/backlogs/SOFT-SAFE-OPEN-DEFENSE.md`
- Bad-riichi visualization: `static/js/bad-riichi-bars.js`
- Tile rendering vs. mjai-base helpers: `static/js/tiles.js` (SVG render + `tileBase()`), `static/js/prep/tiles.js` (mjai pid/suit helpers used by the prep pipeline)
- Prep pipeline (shanten/ukeire/board reconstruction; runs client-side as a worker): `static/js/prep/prep.js` (orchestrator), `static/js/prep/prep-board-state.js` (context reconstruction), `static/js/prep/prep-board-yaku.js` (shape yaku), `static/js/prep/shanten.js` + `shanten_calc.js`, `static/js/prep/furiten.js`, `static/js/prep/parse.js`
- WASM shanten/ukeire kernel (on by default for everyone; JS is the fallback): adapter `static/js/prep/shanten_calc_wasm.js`, async bootstrap `static/js/prep/wasm-bootstrap.js`, served assets `static/wasm/` (rebuild via `scripts/wasm_build_web.sh`), Rust in `wasm/haipai-shanten/`. Opt out in-browser with `?wasm_shanten=0`. Full status + remaining work: `docs/backlogs/WASM-SHANTEN.md`
- Auth / account / admin UI: `static/js/account.js`, `static/js/admin.js`, `templates/login.html`
- Extension auth (how the browser extension authenticates — **the haipai session cookie, no credential of its own**; the bookmarklet's `users.upload_token` is untouched and still works): the extension's service worker POSTs to `/api/games/upload` with `credentials:'include'`, and `api_upload` (`routes/game.py`) accepts either the session cookie or a Bearer `upload_token`. Chrome attaches the `SameSite=Lax` cookie to fetches from a worker holding host permissions (measured), so "signed in" just means "logged in to haipai in this browser". The endpoint is CSRF-exempt (`app.py`) because flask-wtf's `WTF_CSRF_SSL_STRICT` checks `Referer` before the token and an extension worker cannot send one — so **exempting a cookie-accepting route is load-bearing** and three guards replace CSRF, all pinned by `tests/test_api_extension.py` and documented in `api_upload`'s docstring: `SESSION_COOKIE_SAMESITE="Lax"`, no `Access-Control-Allow-Credentials` in `_cors_headers()`, and `_cookie_origin_ok()` (cookie accepted only from an absent/extension/same origin — `https://mjai.ekyu.moe` is refused on the cookie path even though CORS allows it to call the endpoint). Don't relax any of the three. An explicit Bearer header never falls back to the cookie. Rationale + the measurements: `docs/backlogs/Browser-extension-spec.md` "Authentication". (Superseded v1.1: per-install `extension_tokens` + `/extension/authorize` consent page + `launchWebAuthFlow` + Account-page panel — all deleted; git history has it if the cookie assumption ever breaks.)
- Email verification (password-based registration only — Discord/Google logins have no `email` on file and skip this entirely): `users.email`/`email_verified`/`email_verify_token`/`email_verify_expires` (`db/schema.py`; existing pre-feature accounts were backfilled `email_verified=1` in the same migration, so the gate only ever applies going forward). CRUD in `db/users.py` (`create_user` now takes optional `email`/`verify_token`/`verify_expires`; `get_user_by_email`, `get_user_by_verify_token`, `mark_email_verified`, `set_verify_token`). Registration (`routes/auth.py` `register()`) requires an email, creates the account unverified, and does NOT log the user in — it sends a 24h-expiry link via `lib/mail.send_verification_email` (plain `smtplib` over mailbox.org SMTP, `MAILBOX_USERNAME`/`MAILBOX_PASSWORD`/optional `MAIL_FROM` env vars — must be listed in `docker-compose.yml`'s `environment:` block, not just `.env`, or the container never sees them). `login()` hard-blocks password accounts with an unverified `email` and renders a "Resend verification email" button (`unverified_username` in `templates/login.html`) posting to `/resend-verification`; `GET /verify-email/<token>` marks verified and logs the user in. To test SMTP by hand there's `scripts/send_mail.py` — stdlib-only and deliberately free of haipai imports so it can be copied to any host with python3.
- Category snapshot (admin dashboard panel tracking the global mistake **shape** distribution — obvious / trade-off / complex / n/a — with `complex` as the headline bucket to drive down): the categorizer is client-side only and the container has no Node, so the admin browser runs the same prep + categorize the games view uses (`prepGameAsync` + `recategorizeGameInPlace`) over every game and tallies by shape. Panel + compute loop `snapshotPanelHtml`/`computeCategorySnapshot`/`saveCategorySnapshot` (`static/js/admin.js`), actions in `static/js/actions.js`, styles `.snapshot-*` (`static/style-layout.css`). Cross-user data endpoints `/api/admin/snapshot/game-ids` + `/api/admin/snapshot/game/<id>` and save/list `/api/admin/category-snapshots` (`routes/admin.py`); persisted in the global (no user_id) `category_snapshots` table (`db/schema.py`) via `insert_category_snapshot`/`list_category_snapshots` (`db/snapshots.py`). Mirrors the offline `scripts/category_stats.mjs` headline (same `categorize.js`). NB: distinct from the per-user `weakness_snapshots` (`insert_snapshot`).
- Waits Trainer (`#waits-trainer`, the toolbar's "Waits" button next to Trends): a self-contained
  arcade minigame — pin-only tenpai hands fall down a stage, the player taps
  tiles from a 9-tile arsenal to shoot the target hand, and **every** wait must
  be hit before it dissolves (a two-sided wait needs both tiles). Wrong tile →
  combo reset + hitstun; a hand reaching the floor → one of 3 lives and the
  stage is wiped. 4-tile hands score 1, 7-tile 2, 10-tile 4, the bigger sizes
  unlocking at combo 5 / 10. Hand tiles are drawn at the arsenal tile's width
  (`wtSyncTileSize` writes `--wt-tile-h`, capped so a 10-tile hand still fits
  a phone stage); spawning is on a timer except that an empty stage refills
  at once, so a fast player never waits. Every minigame tile carries an
  explicit `aspect-ratio: 3 / 4` — the `.tile` base rule is `width: auto`,
  which measures 0 until the SVG decodes, and `wtPositionHands` lays hands
  out from a measured width. All of it lives in
  `static/js/waits-trainer.js`
  (`wt*` globals + the `wt` state object) and `static/style-waits-trainer.css`
  — no API, no DB, best score in localStorage; the rAF loop self-terminates
  when its stage element leaves the DOM, so routing away needs no teardown.
  Wired in via `TAB_ROUTES`/`parseTabHash` (`main.js`), the `wtShoot`/
  `wtTarget`/`wtStart` (+ shared `mgToggleMute`) entries in `actions.js`, and the toolbar
  button in `static/index.html`. **Sound** is synthesized in-page with WebAudio
  — the engine, the mute preference and the speaker button live in the shared
  `static/js/minigame-audio.js` (`mgTone`/`mgNoise`/`mgToggleMute`/
  `mgRenderMuteButtons`, key `MG_MUTE_KEY`, falling back once to the pre-split
  `haipai.waitsTrainer.muted`), and only this trainer's own cues (`wtSfx*`)
  stay in `waits-trainer.js`. No audio assets to ship or 404, and the context
  is built lazily on the first cue, which always comes from a click/keypress,
  so autoplay policy needs no separate opt-in. The HUD's speaker button (the
  `m` key too) suspends the context; **mute is one preference across all the
  minigames**, and any button carrying `data-mg-mute` re-renders on a toggle.
  The **leaderboard** (each player's best run, shown on
  both the intro and game-over panels) is the one part with a backend:
  `waits_scores` (`db/schema.py`, one row per finished run) via
  `db/waits.py` (`submit_waits_score`/`get_waits_leaderboard`/
  `get_user_waits_best`, the board relying on SQLite's bare-column-with-MAX()
  behaviour so a row describes the run that produced the best score), served
  by `routes/waits.py` (`POST /api/waits/scores`, `GET
  /api/waits/leaderboard`, both `@login_required`). Scores are self-reported
  by a client-side game, so `_validated_run` gates them on the game's own
  points arithmetic (1/2/4 per hand → `hands_cleared <= score <= 4 *
  hands_cleared`, combo ≤ hands) rather than pretending to verify them;
  the reasoning is in that module's docstring. Pinned by
  `tests/test_api_waits.py`. The mahjong logic (wait detection + random tenpai-hand
  generation, incl. the curated 5-sided shapes) is a JS port of the
  `riichi-mahjong-trainer/` submodule (djuretic, MIT, Elm) — **reference-only,
  never imported**, same arrangement as `killer_mortal_gui`; the porting map
  from `src/Group.elm` is in the file's header comment.
- Defense Trainer (`#defense-trainer`, the toolbar's "Defense" button next to
  Waits): a Simon-says memory game for **genbutsu**. One board is a real kyoku
  cut at the moment an opponent declared riichi; its layout never changes and
  every tile on it sits face down. The SAFE tiles turn up one at a time and
  flip back, and the player then taps all of them out of a 34-tile arsenal
  (order doesn't matter — it's a set, not a sequence). The sequence is ONE
  growing list: the declarer's own pond left to right (genbutsu against them
  whenever discarded), then every tile discarded since the declaration in
  table order. Step k reveals the first k entries, so a board opens on a
  single safe tile and grows by one per round — that ramp is the whole
  difficulty curve. A tile that never turns up was never shown and is never
  asked about (the other seats' pre-riichi discards stay down for the whole
  board; their slots still show, because a pond's *length* is public at a real
  table and its contents are not). Clearing a step scores its safe-tile count;
  a wrong tap or a timeout costs one of 3 lives, reveals the answer marked
  green (found) / amber (missed) / red (the tap that ended it), and moves to a
  fresh board. Client-side in `static/js/defense-trainer.js` (`df*` globals +
  the `df` state object) and `static/style-defense-trainer.css`; sound via the
  shared `minigame-audio.js` (each tile has its own pentatonic note, so a
  board always sounds the same). Wired in via `TAB_ROUTES`/`parseTabHash`
  (`main.js`), the `dfPick`/`dfStart` entries in `actions.js`, and the toolbar
  button in `static/index.html`. **Boards are a static pack**, not an API:
  `scripts/mine_defense_puzzles.py` mines `mortal_analysis/` (run it in the
  container — that's where the files live) into the committed, anonymized
  `static/data/defense-puzzles.json` (~300 boards; seat winds, ponds, dora and
  discard order only — no names, no game id, no user id). Selection is riichi
  by the declarer's 5th discard, ≥10 discards after, and never the replay's
  own riichi; seats are rotated so index 0 is the replay's player. Two
  truncations keep "safe" honest and are pinned by `tests/test_defense_puzzles.py`
  (which also asserts the shipped pack's invariants): a **ron** drops the
  winning tile (it did not pass), and a **second riichi** ends the flow there.
  The one server-side part is the leaderboard — `defense_scores`
  (`db/schema.py`) via `db/defense.py`, served by `routes/defense.py` (`POST
  /api/defense/scores`, `GET /api/defense/leaderboard`, both `@login_required`),
  the exact shape of the Waits Trainer's, self-reported scores gated on the
  game's own arithmetic (`steps_cleared <= score <= 34 * steps_cleared`).
  Pinned by `tests/test_api_defense.py`.
- Mailbox messages: `static/js/mailbox.js`
- API client + shell: `static/js/api.js`, `static/js/main.js`, `static/js/ui.js`, `static/index.html`
- Public game sharing (per-game share links + the `/demo` link on login/landing for logged-out visitors): one mechanism serves both — a nullable, unique `games.share_token` (`db/schema.py`), helpers in `db/games.py` (`get_or_create_share_token`/`regenerate_share_token`/`revoke_share_token`/`get_game_by_share_token`, the last stripping the owner's private per-mistake `note` before returning). Owner-facing CRUD (`GET`/`POST .../regenerate`/`DELETE` on `/api/games/<id>/share-token`, all `@login_required`) lives in `routes/game.py` next to the analogous `upload_token` routes; the public read is the unauthenticated `GET /api/shared/<token>` (same combined payload shape `fetchGame()` builds from two calls, in one). `GET /shared/<token>` (`routes/pages.py`) always serves the dedicated read-only page `static/shared.html` + `static/js/shared-view.js` — a deliberately separate, minimal shell (no sidebar/toolbar/mailbox/admin) reusing the same render pipeline (`game-render.js`/`mistake-card.js`/prep/categorize) rather than the full SPA in a degraded mode, so there's no write-control surface to accidentally leak. `state.readOnly` (set only by `shared-view.js`) is what `game-render.js`/`mistake-card.js` check to hide notes/reports/delete/share/the complex-gap funnel — see `main.js`'s `state` init for the flag's contract. `GET /demo` (`routes/pages.py`) redirects to the share link for `DEMO_GAME_ID` (env var, documented above), generating it on first hit — swapping the demo game is a one-line env change, not a template edit. Owner-side "Share" button + modal: `static/js/game-render.js` header, `static/js/ui.js` (`showShareModal` et al.), markup in `static/index.html`.

**Frontend — CSS (split by visual scope, not by JS module)**
- `static/style-theme.css` — vars, typography, dark theme
- `static/style-layout.css` — sidebar, toolbar, tabs, modals, forms
- `static/style-game-detail.css` — game header, round/mistake cards, EV table, yaku panels
- `static/style-board-display.css` — board context, discards, threat pills, hand safety, melds
- `static/style-waits-trainer.css` — the Waits Trainer minigame (stage, falling hands, arsenal); self-contained, only loaded by `index.html`
- `static/style-defense-trainer.css` — the Defense Trainer minigame (face-down board, the reveal flash, 34-tile arsenal); self-contained, only loaded by `index.html`

**Backend**
- Routes (Flask blueprints): `routes/auth.py`, `routes/game.py`, `routes/pages.py`, `routes/admin.py`, `routes/mailbox.py`, `routes/waits.py`, `routes/defense.py`
- DB layer (one file per table-group): `db/users.py`, `db/games.py`, `db/mistakes.py`, `db/reports.py`, `db/snapshots.py`, `db/messages.py`, `db/admin.py`, `db/waits.py`, `db/defense.py`, `db/schema.py`
- MJAI log parsing (round walking, action formatting, severity): `lib/parse.py`
- Backend category metadata reference (NOT the categorizer): `lib/categories.py`
- App entry: `app.py`

**Browser extension (outside the Flask app)**
- MV3 auto-uploader, **Chrome + Firefox** (mjai report page → `POST /api/games/upload` → `#g<id>`): `extension/` is the single source of truth (`manifest.json` = Chrome, `manifest.firefox.json` = Firefox, `build-firefox.sh`, `background.js` = the background context doing the cookie-authenticated cross-origin POST + dedupe/retry/navigate, `content.js` = report-page `?data=` guard + fetch + toast + log-in prompt with session polling, `options.html`/`options.js`, `icons/`, `README.md`). Chrome loads `extension/` directly; Firefox loads `extension-firefox/`, which `build-firefox.sh` **generates** (git-ignored — never edit it, never commit it). Vanilla JS, no bundler; not served by `static/`, not in the Docker image. Contract + hard constraints (never POST to mjai's `/review`, never expose the session to page context): `docs/backlogs/Browser-extension-spec.md`. Server side of the flow is `api_upload` in `routes/game.py`; the older bookmarklet it coexists with is built in `static/js/ui.js`. Auth is the session cookie (see "Extension auth" above), NOT a pasted upload token.
- Extension cross-browser rules. **Two dead ends — don't re-attempt either** (both measured): a single manifest carrying *both* `background.service_worker` and `background.scripts` (FF140 ESR accepts it, current Firefox refuses the install: *"background.service_worker is currently disabled"*), and a Firefox dir of **symlinks** into `extension/` (installs, but Firefox won't read symlinked resources — the options page never loads; real files load in ~0.4s). Hence the generate step. `background.js` runs as a Chrome service worker *and* a Firefox event page, so it must never assume a `ServiceWorkerGlobalScope` (no `skipWaiting`/`oninstall`/`clients`); `build-firefox.sh` fails the build if the two manifests drift on any key besides `background`/`browser_specific_settings`. Every extension file opens with `const ext = globalThis.browser ?? globalThis.chrome;` — both namespaces are promise-based, so preferring `browser` gives one awaitable path with no polyfill; **a bare `chrome.*` breaks Firefox**, so `rg '\bchrome\.' extension/` should only ever match prose. Firefox-only: host permissions are revocable from `about:addons` (though FF140 grants them even on a temporary install — measured), handled by `hasHostAccess()` (`background.js`) → `promptPermission()` (`content.js`) → the **Grant access** button (`options.js`, which must call `permissions.request()` synchronously in the click handler — awaiting first kills the gesture, and content scripts can't request at all); notification icons must be packaged files, not `data:` URLs. Server side needed nothing: `EXTENSION_ORIGIN_SCHEMES` (`routes/game.py`) already allowed `moz-extension://`. The load-bearing cookie behaviour is **measured on both** Chromium 150 and Firefox 140 ESR (PASS; method + control table in the spec) — if it ever breaks, the symptom is a 401 loop with host access granted and the fallback is the Bearer `upload_token` path. Details: `docs/backlogs/Browser-extension-spec.md` "Cross-browser (v2.1)".

## Further context

- Tile notation (mjai format vs. SVG filenames) → `.claude/skills/tile-notation/SKILL.md`
- Why this section exists + alternatives considered → `docs/backlogs/FINDABILITY.md`
