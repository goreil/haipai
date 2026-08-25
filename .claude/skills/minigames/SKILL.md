---
name: minigames
description: The Haipai arcade minigames — Waits Trainer (`#waits-trainer`), Defense Trainer (`#defense-trainer`), and the public guest arcade at `/play`. Use when touching static/js/waits-trainer.js, defense-trainer.js, minigame-audio.js, minigame-shell.js, play-view.js, static/data/defense-puzzles.json, routes/waits.py, routes/defense.py, db/waits.py, db/defense.py, or the leaderboards, guest-run stashing, and score validation behind them.
---

# Haipai minigames

Two self-contained, client-side arcade trainers plus the public `/play` shell
they share. The only server-side parts are the two leaderboards.

- Waits Trainer (`#waits-trainer`, the toolbar's "Waits" button next to Trends): a self-contained
  arcade minigame — pin-only tenpai hands fall down a stage, the player taps
  tiles from a 9-tile arsenal to shoot the target hand, and **every** wait must
  be hit before it dissolves (a two-sided wait needs both tiles). Wrong tile →
  combo reset + hitstun; a hand reaching the floor ends the run (**one life**,
  `WT_LIVES`) and the game-over panel shows that hand — `wt.killer`, snapshotted
  in `wtLoseLife` before the stage is wiped, rendered by `wtKillerHtml` with
  each wait marked hit (green) or still open (red). 4-tile hands score 1, 7-tile 2, 10-tile 4, the bigger sizes
  unlocking at combo 5 / 10. Hand tiles are drawn at the arsenal tile's width
  (`wtSyncTileSize` writes `--wt-tile-h`, capped so a 10-tile hand still fits
  a phone stage); spawning is on a timer except that an empty stage refills
  at once, so a fast player never waits. Every minigame tile carries an
  explicit `aspect-ratio: 3 / 4` — the `.tile` base rule is `width: auto`,
  which measures 0 until the SVG decodes, and `wtPositionHands` lays hands
  out from a measured width. All of it lives in
  `static/js/waits-trainer.js`
  (`wt*` globals + the `wt` state object) and `static/style-waits-trainer.css`
  — no API, no DB, best score in localStorage (`WT_BEST_KEY`/`DF_BEST_KEY` both
  carry a `.v2` suffix: the one-life rules invalidated every 3-life best, and the
  server leaderboards were truncated at the same time); the rAF loop self-terminates
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
  by `routes/waits.py` (`POST /api/waits/scores` `@login_required`, `GET
  /api/waits/leaderboard` public — see the arcade entry). Scores are self-reported
  by a client-side game, so `_validated_run` gates them on the game's own
  points arithmetic (1/2/4 per hand → `hands_cleared <= score <= 4 *
  hands_cleared`, combo ≤ hands) rather than pretending to verify them;
  the reasoning is in that module's docstring. Pinned by
  `tests/test_api_waits.py`. Playable **without an account** at `/play` —
  see the "Public minigame arcade" entry for how a guest run reaches the
  board. The mahjong logic (wait detection + random tenpai-hand
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
  a wrong tap ends the run (**one life**, `DF_LIVES`) after a review beat that
  reveals the answer marked green (found) / amber (missed) / red (the tap that
  ended it). The answer phase has **no clock** (`dfBeginAnswer`) — the bar
  becomes a found/total progress meter — and the reveal is deliberately
  unhurried (`dfFlashSeconds`); the memory is the test, not the typing. Client-side in `static/js/defense-trainer.js` (`df*` globals +
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
  /api/defense/scores` `@login_required`, `GET /api/defense/leaderboard`
  public — see the arcade entry),
  the exact shape of the Waits Trainer's, self-reported scores gated on the
  game's own arithmetic (`steps_cleared <= score <= 34 * steps_cleared`).
  Pinned by `tests/test_api_defense.py`. Playable **without an account** at
  `/play` — see the "Public minigame arcade" entry.
- Public minigame arcade (`/play`, the guest home of both trainers): the two
  trainers are pure client-side games, so an account buys exactly one thing —
  a row on the leaderboard. `GET /play` (`routes/pages.py`) serves
  `static/play.html` + `static/js/play-view.js` to logged-out visitors and
  **redirects everyone else to `/`** (browsers carry the fragment across a
  redirect that has none of its own, so `/play#defense-trainer` lands on
  `/#defense-trainer` and the SPA router picks the same trainer). Same call as
  the shared-game page: a deliberately separate minimal shell (no sidebar,
  toolbar, mailbox, admin, game list) reusing the trainers themselves rather
  than the SPA in a degraded mode — pinned by `tests/test_pages_play.py`.
  `play-view.js` supplies the handful of globals the trainers reach for
  (`state`, a no-op `renderGameList`, `csrfToken`) plus a two-tab
  `TAB_ROUTES`/`navTab`/`parseTabHash` router mirroring `main.js`'s contract,
  so the toolbar buttons reuse the existing `showWaitsTrainer`/
  `showDefenseTrainer` actions unchanged. What makes a run a *guest* run is
  `mgGuest` (`static/js/minigame-shell.js`, the shared non-audio minigame
  module): `play-view.js` sets it true, and `wtReportRun`/`dfReportRun` then
  stash the run in localStorage (`mgStashRun`, best-per-game only) instead of
  POSTing, with the game-over panel rendering `mgSignupCtaHtml`. On the next
  visit *with* a session each trainer's `*LoadLeaderboard` calls
  `mgFlushPendingRun` first, which submits the stashed run and reports it on
  the intro panel ("Saved your guest run: N points.") — so the offer survives
  the whole register -> verify-email -> log-in detour. Both
  `GET /api/{waits,defense}/leaderboard` are **public** (an anonymous caller
  gets `you: null`); only the score POSTs are `@login_required`. Styles
  `static/style-minigame.css` (banner, footer, `.mg-cta`, `.mg-guest-note`),
  loaded only by `play.html`. Entry points: the landing hero/bottom CTAs + the
  third feature card (`static/landing.html`) and `templates/login.html`.

**CSS** (each self-contained, loaded per the shells named):
- `static/style-waits-trainer.css` — the Waits Trainer minigame (stage, falling hands, arsenal); self-contained, loaded by `index.html` + `play.html`
- `static/style-defense-trainer.css` — the Defense Trainer minigame (face-down board, the reveal flash, 34-tile arsenal); self-contained, loaded by `index.html` + `play.html`
- `static/style-minigame.css` — the public arcade shell (`/play`): its banner/footer plus the guest sign-up CTA both trainers render on game over; only loaded by `play.html` (inside the SPA `mgGuest` is never true, so the CTA never renders there)
