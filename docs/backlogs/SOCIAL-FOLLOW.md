# Social Follow (replace admin impersonate)

**Status**: PROPOSAL — for review, not started.

**Goal**: Replace admin "impersonate" with a social, opt-in **follow** model.
Users send a follow *request*; once accepted, the follower gets **read-only**
visibility into the followee's games, mistakes, and (optionally) trends. As
admin `ylue`, seed a default two-way relationship for new/returning users plus
a one-time pop-up, so newcomers immediately see what a populated, reviewed
account looks like.

**Why over impersonate**: impersonate is a full session takeover
(`routes/admin.py:96`) — admin-only, all-or-nothing, write-capable, invisible
to the target. Follow is per-user, consent-based, read-only, and visible to
both sides. Different mechanism, not a rename — so impersonate is *deprecated*,
not refactored into follow (see SF-08).

---

## Decisions to lock before building (REVIEW THESE)

These change the data model and the access refactor, so settle them first.

- **D1 — Approval model.** Request → accept (Instagram-style), or auto-accept
  (Twitter-style public)? Proposal: **request → accept**, since you framed it as
  a "request to follow" and it matches the read-into-private-data sensitivity.
- **D2 — What a follower sees.** Games + mistakes only, or also the Trends page
  / weakness snapshots? Annotations (the private `note` field on mistakes)?
  Proposal: **games + mistakes + trends, read-only; hide the followee's private
  notes** unless we later add a "share notes" toggle.
- **D3 — Symmetry of the default.** You said newcomers follow `ylue` *and*
  `ylue` follows them by default. Confirm both directions are seeded, and
  whether the user can later revoke the `ylue→them` side (privacy) — proposal:
  yes, revocable like any other follow.
- **D4 — Discovery.** Can users find/follow *anyone* (needs a user directory,
  raises privacy questions), or only via a shared link / only `ylue`? Proposal
  for v1: **no open directory** — follow `ylue` via the pop-up, plus a
  shareable profile link; defer a directory to SF-09.
- **D5 — Fate of impersonate.** Remove entirely, or keep as an admin
  break-glass tool behind the follow UI? Proposal: keep impersonate for admins
  short-term (SF-08 deprecates it once follow covers the support use case).

---

## Phases

### SF-01: Data model + migration (FOUNDATION)

New `follows` table: `(follower_id, followee_id, status TEXT
CHECK(status IN ('pending','accepted')), created_at)`, PK
`(follower_id, followee_id)`, FKs to `users(id) ON DELETE CASCADE`, plus an
index on `(followee_id, status)` for "who follows me" and `(follower_id,
status)` for "who I follow". Add the additive `CREATE TABLE` to `SCHEMA` and a
forward-only step in `migrate()`. Extend `delete_user_cascade` (`db/users.py:95`)
to drop rows on both sides. New `db/follows.py` with the query helpers
(request, accept, decline, unfollow, remove_follower, list_following,
list_followers, pending_for_user, relationship(a,b)).

**Files**: `db/schema.py`, `db/users.py`, new `db/follows.py`.

### SF-02: Read-access scoping refactor (HARDEST PART — do carefully)

Today every read in `routes/game.py` is hard-scoped to `current_user.id`
(`:25`, `:34`, `:52`, the mistake-owner checks at `:189`/`:211`/`:251`, and
`get_trends`). Introduce a single helper — `can_view(viewer_id, owner_id)` →
True if same user or an **accepted** follow exists — and a "viewing context"
so the game-list / game-detail / trends endpoints can resolve a target
`user_id` from a query param (e.g. `?as=<user_id>`) and authorize it through
`can_view`. **Writes stay self-only**: annotate, delete game, delete/report
mistake must keep checking `owner == current_user.id` (a follower can read but
never mutate). Add tests that a follower can GET but gets 403 on every write.

**Files**: `routes/game.py`, `db/games.py` (param-driven scoping), new shared
auth helper.

### SF-03: Follow API endpoints

`POST /api/follow/<user_id>` (create pending request),
`POST /api/follow/<user_id>/accept`, `POST /api/follow/<user_id>/decline`,
`DELETE /api/follow/<user_id>` (unfollow), `DELETE /api/follower/<user_id>`
(remove a follower), `GET /api/follows` (my following + followers + pending,
each with status). Guard self-follow, duplicate requests, and accept-of-
nonexistent-request. Likely a new `routes/social.py` blueprint.

**Files**: new `routes/social.py`, `app.py` (register blueprint).

### SF-04: Follow button + "viewing as" mode (frontend)

A follow / requested / following button component usable on a profile or user
chip. When viewing a followee, the game list + detail load with `?as=<id>` and
show a sticky "Viewing <name>'s games (read-only)" banner with an exit — mirror
the existing impersonate banner pattern in `admin.js` (`renderImpersonateBanner`,
`:304`) but read-only and non-admin. Hide/disable all write affordances
(annotate, delete, report) in viewing mode.

**Files**: `static/js/` (new `social.js` + wiring in `main.js`, `actions.js`,
`game-fetch.js`, `game-render.js`), `static/index.html`, `static/style-layout.css`.

### SF-05: Incoming-request + notification surface

Surface pending follow requests so the followee can accept/decline. Reuse the
existing mailbox/unread machinery (`db/messages.py`, per-user unread) rather
than a new system: either emit a `message` on request, or add a small
pending-requests panel that reuses the unread-badge pattern. Accept/decline
inline.

**Files**: `static/js/mailbox.js` or new requests panel, `routes/social.py`,
possibly `db/messages.py`.

### SF-06: Onboarding pop-up + default `ylue` relationship

One-time pop-up for new and returning users: "Follow ylue to see a fully
reviewed account?" with accept/dismiss. On accept (or by policy per D3), seed
the two-way accepted follow (`user→ylue` and `ylue→user`). Needs: a
"seen onboarding" flag (a `users` column or a `message_reads`-style marker so
it doesn't re-pop), and a seeding helper that's idempotent and safe to run for
existing users (a one-shot backfill for current users, gated on D3). There is
no existing onboarding/modal framework — this is net-new UI.

**Files**: `db/schema.py` (seen flag), `db/follows.py` (seed helper),
`routes/social.py`, `static/js/` (new onboarding modal), `static/index.html`.

### SF-07: Profile / shareable link (supports D4)

Minimal per-user profile route (read-only summary + follow button) reachable
by a stable link, so following works without an open directory. Respects
`can_view` — non-followers see only the public shell + a follow button.

**Files**: `routes/social.py` or `routes/pages.py`, `static/`.

### SF-08: Deprecate admin impersonate

Once follow + viewing-as covers the support workflow, remove the impersonate
endpoints (`routes/admin.py:96`/`:164`), the banner + buttons (`admin.js`,
`actions.js`, `main.js`, `index.html`, `style-layout.css`), and the
`IMPERSONATOR_SESSION_KEY` plumbing. Update `docs/backlogs/ADMIN.md` (A-01/A-02
reference impersonation). Note: deep-link "Open" from category-reports (A-01)
currently relies on impersonate — re-point it at viewing-as first. Grep the
whole repo for `impersonate` before deleting (also `style-layout.css`,
`index.html`, `tests/test_api_reports.py`).

**Files**: `routes/admin.py`, `static/js/admin.js`, `static/js/actions.js`,
`static/js/main.js`, `static/index.html`, `static/style-layout.css`,
`docs/backlogs/ADMIN.md`, tests.

### SF-09: Open user directory (GROWTH — defer)

A browsable/searchable user list to follow strangers. Privacy-sensitive
(needs opt-in visibility, maybe aliases — overlaps UX-40 leaderboard).
Deferred until there's enough user volume to matter.

---

## Cross-cutting: privacy, abuse, tests

- **Privacy**: read-only enforced server-side (SF-02), private `note` field
  excluded per D2, follows revocable from both sides (unfollow / remove
  follower), GDPR cascade covers the table (SF-01).
- **Abuse**: rate-limit follow requests; block/decline should prevent
  re-request spam (consider a `blocked` status later).
- **Tests**: follower reads OK; follower writes → 403; non-follower reads →
  403; accept/decline state machine; cascade on user delete; onboarding seed
  idempotent.

**Suggested order**: SF-01 → SF-02 → SF-03 → SF-04 → SF-05 → SF-06, then
SF-07/SF-08 once the core loop works. SF-09 is growth-gated.
