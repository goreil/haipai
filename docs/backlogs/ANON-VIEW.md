# Anonymous Game View (no account, no upload)

**Status**: PROPOSAL — for review, not started.

**Goal**: A second bookmarklet, usable with **no Haipai account**, that takes a
Mortal report on `mjai.ekyu.moe` straight to the mistake analysis. Nothing is
saved anywhere — no game row, no persisted link, no "your games" entry. One
tab in, one read-only analysis view out.

**Why over the existing flows**: today there are two ways to see an analysis,
and both assume an account:
- "Send to Haipai" bookmarklet (`static/js/ui.js` `buildUploadBookmarkletHref`)
  — per-user Bearer token, POSTs to `/api/games/upload`, **persists** the game
  to that user's library.
- `/shared/<token>` — public read-only, but the share link only exists because
  an account-holder already uploaded the game and clicked "Share".

This feature is for the person who just wants to see what Haipai says about
one replay, with zero signup friction — a trial/demo path distinct from the
existing `/demo` static example, and distinct from "share my real account
data."

---

## Decisions locked (from initial scoping)

- **No persistence.** The analysis is computed and handed back for that one
  view only — no DB row, no file written to `mortal_analysis/`, nothing to
  clean up or expire. Trade-off: the resulting view **cannot be reshared or
  revisited** later (no token, no ID) — reload loses it. If "share this
  specific anonymous view" turns out to matter, that's a different feature
  (closer to today's persisted share links) and out of scope here.
- **Abuse gate is CORS + caps, not a secret.** The existing bookmarklet's real
  gate is the per-user Bearer token; this one has no user to hang a token on.
  Keep CORS locked to `https://mjai.ekyu.moe` (matches `UPLOAD_ALLOWED_ORIGIN`
  in `routes/game.py`) and add a request-size cap + per-IP rate limit on the
  new endpoint. This does **not** stop a non-browser client (CORS is a browser
  policy, not server auth) — accepted trade-off for a no-account feature; the
  caps exist to bound damage, not to fully lock the door.

## Decisions to lock before building (REVIEW THESE)

- **D1 — Cross-origin delivery of the payload.** The existing bookmarklet gets
  away with a simple `location.href = origin + '#g' + game_id` because the
  server hands back a small `game_id` it can redirect to. There's no ID here —
  the full computed analysis has to reach a Haipai-origin (or in-place) page
  somehow, and it's too big for a URL fragment. Candidates:
  - **(a) Fetch + `document.write` in a new tab**: bookmarklet does
    `fetch(...)` to the new endpoint, opens `window.open('about:blank')`, and
    writes the returned HTML (view shell + inline JSON) into it directly —
    never actually navigates to the Haipai origin, so all asset URLs in that
    HTML must be absolute.
  - **(b) Real POST navigation**: bookmarklet builds a hidden `<form
    method=POST target=_blank>` pointing at a new Haipai *page* route (not a
    JSON API) and submits it — a real browser navigation, so relative assets
    "just work," but the route now needs to render HTML directly instead of
    JSON.
  - **(c) `window.open` + `postMessage` handshake**: open the Haipai page
    first, have it message back "ready," then post the analysis JSON into it.
    More moving parts, more failure modes (popup blockers, timing), but keeps
    the API endpoint returning plain JSON like everything else.
  Needs a small spike before committing (AV-02) — this is the part most likely
  to fight the browser.
- **D2 — Where the bookmarklet lives.** No per-user token means the bookmarklet
  markup is identical for everyone — it doesn't need per-user generation like
  `refreshUploadBookmarklet()` does today. Natural home is `static/landing.html`
  (already the logged-out entry point, already links `/demo`). Open question:
  also surface it for logged-in users (e.g. next to "Send to Haipai" in the
  add-modal) for their own quick one-off looks, or keep it strictly a
  logged-out/trial affordance? Proposal: **logged-out only for v1** — a
  logged-in user already has the better (persisted, shareable) path.
- **D3 — Failure UX.** The authenticated upload path can fail loud (`alert(...)`
  in the bookmarklet, per `buildUploadBookmarkletHref`) because the user still
  has their library to fall back to. Here there's no fallback destination —
  a parse failure, rate-limit 429, or size-cap rejection needs a friendly
  in-page error state (mirror `shared.html`'s not-found state) rather than a
  bare `alert()` and a dead about:blank tab.
- **D4 — Labeling.** Needs a name clearly distinct from "Send to Haipai" so
  users don't drag the wrong one to their bar and get confused when nothing
  shows up in their library. Proposal: **"Analyze without an account"** or
  similar, plus a one-line caption ("nothing is saved") near the drag target.

---

## Phases

### AV-01: Anonymous parse endpoint (backend)

New unauthenticated route (e.g. `POST /api/anon/analyze`), CORS-locked to
`UPLOAD_ALLOWED_ORIGIN` like `/api/games/upload`. Reuses `parse_game` +
`compute_summary` (`lib/parse.py`) — the same work `_ingest_mortal` does — but
skips both `db.add_game` and the `mortal_analysis/` file write entirely; the
response body carries the computed `game_dict` + summary + (slim) mortal data
directly. Add a request body size cap (Flask `MAX_CONTENT_LENGTH` or a
per-route check) and a per-IP rate limit — single gunicorn instance, so an
in-memory limiter is enough, no Redis needed. Bad/unparseable input returns a
4xx with an error payload the frontend can render inline (feeds D3).

**Files**: `routes/game.py` (or a new small blueprint if this grows), reuses
`lib/parse.py` as-is.

### AV-02: Cross-origin delivery spike (resolve D1)

Prototype whichever of (a)/(b)/(c) wins, against the real `mjai.ekyu.moe`
report page (cross-origin quirks — CSP, popup blockers, relative asset paths —
tend to only show up against the real site, not a local mock). This gates
AV-03/AV-04, since the view shell's entry point depends on the answer.

### AV-03: Anonymous view shell (frontend)

A minimal read-only render surface for the payload AV-01 returns. Reuses the
existing read-only machinery wholesale: `state.readOnly` already hides
notes/reports/delete/share/the complex-gap funnel (built for `shared-view.js`,
see the "Public game sharing" entry in the root `CLAUDE.md`) — same
`game-render.js`/`mistake-card.js`/prep/categorize pipeline, just fed from an
in-memory object instead of an `/api/shared/<token>` fetch. Depending on
AV-02's answer this is either a new static page (`static/anon-view.html` +
a small JS entry) or a variant entry point into the existing `shared.html`
shell.

**Files**: likely new `static/anon-view.html` + `static/js/anon-view.js`
(sibling to `shared.html`/`shared-view.js`), no changes needed to
`game-render.js`/`mistake-card.js` themselves.

### AV-04: The bookmarklet + landing page surface

Static (no per-user token, unlike `buildUploadBookmarkletHref`) `javascript:`
builder implementing D1's chosen delivery mechanism. Dragged from
`static/landing.html` (D2), labeled distinctly from "Send to Haipai" (D4).

**Files**: `static/landing.html`, a small builder function (new, or added
alongside `buildUploadBookmarkletHref` in `static/js/ui.js` if it ends up
shared).

### AV-05: "Save this to your account" upsell (OPTIONAL, defer if not wanted)

Once viewing anonymously, offer a "Log in / sign up to save this" CTA that
re-POSTs the same in-memory Mortal JSON through the existing authenticated
`/api/games/upload` path — turning a one-off look into a real persisted game
without re-running the bookmarklet. Nice bridge between the two flows but not
required for the core feature; cut if scope needs to shrink.

**Files**: the AV-03 view shell, existing `/api/games/upload`.

---

## Cross-cutting: abuse, privacy, tests

- **Abuse**: CORS lock + size cap + per-IP rate limit (AV-01). No per-user
  quota exists to fall back on here, so the cap is the only backstop — pick
  a size limit generously above a real Mortal analysis file but well below
  "someone's trying to fill disk/memory" (moot for disk since nothing is
  written, but still bounds memory/CPU per request).
- **Privacy**: strictly better than the persisted-share path — nothing is
  written at all, so there's no data-at-rest, no cleanup job, no GDPR surface
  to consider for this feature specifically.
- **Tests**: parse failure renders the friendly error (D3), not a raw 500;
  rate-limit 429 path; size-cap rejection; CORS preflight matches the existing
  `/api/games/upload` OPTIONS handling; confirm no `games` row and no
  `mortal_analysis/` file appear after hitting the endpoint.

**Suggested order**: AV-02 (de-risk the trickiest, least familiar part) →
AV-01 → AV-03 → AV-04. AV-05 is optional and can slot in anytime after AV-03.
