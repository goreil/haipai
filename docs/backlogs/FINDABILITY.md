# Findability — concept dispersion

Draft: 2026-05-30. Follow-up to the completed cleanup refactor (REFACTOR.md
phases 1-4, shipped 2026-05-29 → 2026-05-30).

## The problem the refactor didn't solve

The refactor split oversized files into concept-named smaller ones, expecting
"a `grep` for the right noun will land on the first try." Reading the May 28
transcripts (sessions `5120002e`, `c540c2b0`, `af316411`, `5c3ae22d`) shows
the dominant friction wasn't file *size*, it was **concept dispersion** — a
single user-visible concept lives in 3-11 files whose names describe their
*container*, not the *concept*.

Concrete tells from those sessions:

- `c540c2b0` opened **11 different JS files** to rip out one column because
  "safety rating" was scattered everywhere.
- `af316411` did 6 grep-narrow rounds then 3 overlapping reads of `board.js`
  to find one yaku-pill region.
- `5c3ae22d` ran the *same* 7-yaku regex 3 times at narrower scopes because
  the concept lives in **two unrelated `board.js` files**
  (`static/js/board.js` and `static/js/prep/board.js`).
- `5120002e` re-read `static/style.css` **22 times** at different offsets,
  and shipped 600-word subagent prompts because the planner had no concept
  index.

Splitting `board.js` into `board-melds.js` / `board-yaku-panel.js` /
`board-discards.js` plus `prep-board-state.js` / `prep-board-yaku.js`
gives an agent *more* places to look, not fewer. The split is correct;
something else has to map concepts to file lists.

## Options (cheap → invasive)

### F1 — "Where things live" section in CLAUDE.md (RECOMMENDED FIRST)

Add a stable `## Where things live` section to `CLAUDE.md` listing each
user-visible feature → file list. Auto-loaded into every session, zero
greps to consult.

- **Cost**: ~1 hour to draft, ~30s per future feature PR to keep current.
- **Risk**: drifts if forgotten on feature work — same lifecycle as the
  existing backlog files.
- **Status**: ship first; everything below is gated on this one's payoff.

### F2 — `@concept:` header tags + `find-concept` skill

Every module gets a one-line header tag like
`// @concept: yaku-pill, dead-pill-toggle`. Agents look things up with
`rg '@concept: yaku-pill' static/`, one call. The recently-split files
already carry good module docstrings (see `board-yaku-panel.js:1-10`),
so this just standardizes the convention.

- **Cost**: ~2 hours to tag ~30 JS files + the Python modules.
- **Pro**: travels with the code, machine-checkable, harder to rot than F1.
- **Con**: another convention to remember; agents need to know to use it
  (wrap in a small skill).
- **Status**: ship after F1 lands and we've felt a quarter of drift.

### F3 — Vertical-slice reorg (`static/js/features/<concept>/`)

Replace `board-yaku-panel.js + prep-board-yaku.js + the yaku slice of
style-game-detail.css` with `static/js/features/yaku-panel/{render,
compute,style}.{js,css}`. One folder = one concept = one mental model.

- **Cost**: 1-2 days per concept, biggest blast radius (script tags in
  `static/index.html`, prep-pipeline imports via the `parseMod` pattern,
  bind mounts in `docker-compose.yml`, the CSS split).
- **Pro**: kills dispersion at the root rather than papering over it.
- **Con**: closest to what the Phase 3 splits already attempted; only worth
  it if F1+F2 still leave dispersion biting on real tasks.
- **Status**: defer until evidence shows F1+F2 aren't enough.

### F4 — Generated concept map (`docs/CONCEPT-MAP.md`)

Script under `scripts/` scans `// @concept:` tags + CSS class prefixes and
emits a manifest. Combines F1's reach with F2's freshness.

- **Cost**: ~3 hours including the script + a pre-commit hook.
- **Pro**: no manual drift.
- **Con**: only useful with F2's tags as input — needs F2 first.
- **Status**: gated on F2 landing.

## Execution order

1. **F1** — ship immediately. One PR, just CLAUDE.md.
2. **F2** — ship if drift on F1 becomes visible across two or three sessions.
3. **F4** — once F2 has been in place long enough to stabilize.
4. **F3** — only if dispersion still bites after F1+F2+F4 are in.

## Hard constraints (echoed from REFACTOR-GUIDELINES.md)

- **Schema is a wall.** Findability changes are doc/comment/move only.
- **No `data_json` regressions.** Concept tags don't justify re-introducing
  backend storage of derived fields.
- **Categorization stays 100% client-side.** Tags on `lib/parse.py` and
  friends don't change the no-`lib/categorize.py` rule.
