# Mobile Upload Path (MOB)

**Status**: BRAINSTORM — idea dump for triage, nothing started.

**Problem**: users on a phone effectively cannot get a game into Haipai. Both
ingest paths assume a desktop:
- **Bookmarklet** (`buildUploadBookmarkletHref`, `static/js/ui.js`) — needs a
  bookmark bar. Mobile browsers have no bookmark bar; iOS Safari can run
  bookmarklets from Favourites but installing one is ~6 fiddly steps (save any
  page, edit the bookmark, paste a `javascript:` string), and Chrome Android
  requires *typing the bookmark's name into the omnibox* to fire it.
- **JSON file upload** (`#add-file` → `/api/games/add`) — needs a
  download→file-picker round trip. iOS Safari renders `.json` inline instead of
  downloading it, so on iOS the file often never exists to pick.

---

## Frame: where the pipeline actually breaks

Four stages. Only 3 and 4 are ours.

| # | Stage | Owner | Mobile status |
|---|-------|-------|----------------|
| 1 | Play a game, get a replay reference | Tenhou / MJS / Riichi City | varies per client |
| 2 | Replay → Mortal report on `mjai.ekyu.moe` | third party | **varies — verify** |
| 3 | Report → Mortal analysis JSON in hand | third party + us | broken on mobile |
| 4 | JSON → Haipai library | **us** | broken on mobile |

**This matters more than any individual idea below.** Fixing stage 4 is wasted
if stage 2 is already impossible on that client. The three tutorial videos in
the Add Game modal (Tenhou / Mahjong Soul / Riichi City) imply three different
stage-2 procedures, and at least the MJS one is believed to need a desktop
browser extension to extract the log. **Before building anything: walk each of
the three clients end-to-end on an actual phone and record where it dies.**
Possible outcome: Tenhou is fixable today, MJS is not fixable without MOB-07.

### Two experiments that reprice everything

Several ideas below collapse into one small feature if either passes.

- **E1 — Is server-side fetch of the report JSON actually blocked?**
  `CLAUDE.md` says downloads from `mjai.ekyu.moe` "must be done manually due to
  cloudflare". A plain server-side `GET https://mjai.ekyu.moe/` from this box
  returns **200, no challenge** (checked 2026-07-26), so the note may be stale,
  may apply only to bulk/rate-limited access, or only to a specific path. Retest
  against a real `/report/<id>.json`. **If the server can fetch it → MOB-01 is
  the whole fix**: paste the report URL, done, on every device.
- **E2 — Does `mjai.ekyu.moe` send CORS headers on `/report/*.json`?** The root
  response carries no `access-control-allow-origin`, but the JSON is static and
  may differ. If it allows `*`, Haipai's *own page JS* — running in the user's
  already-CF-cleared mobile browser — can fetch the JSON directly from a pasted
  URL. Same one-paste UX as E1, no server egress, no CF exposure at all.

Both are ~15 minutes with one real report URL. Do them first.

---

## Tier 1 — cheap, ships regardless of E1/E2

- **MOB-01 — "Paste the report URL" box.** The headline flow: one input in the
  Add Game modal, paste `…/report/xxx.html?data=…`, Haipai resolves the JSON
  (server-side per E1, or client-side per E2) and ingests via the existing
  `_ingest_mortal`. Blocked on E1 or E2 passing. If both fail, degrade to
  MOB-02 rather than dropping the input.
- **MOB-02 — Paste-the-JSON textarea.** Fallback that needs no cooperation from
  anyone: user opens the JSON URL in a tab (iOS Safari renders it as text —
  the thing that breaks file upload *helps* here), select-all, copy, paste into
  a textarea. **Viability check: real Mortal analysis JSONs in `mortal_analysis/`
  are 59–133 KB** — small enough that mobile select-all/copy/paste is merely
  ugly, not impossible. Add a `navigator.clipboard.readText()` "Paste from
  clipboard" button so it's one tap, not a long-press drag. Reuses
  `/api/games/add` verbatim; frontend-only work.
- **MOB-03 — PWA + Web Share Target (Android).** There is no `manifest.json`
  today — greenfield. Ship a manifest with a `share_target` entry and Haipai
  appears in Android's system share sheet. From the Mortal report page in Chrome
  Android: Share → Haipai → the URL lands on an ingest route. This is the
  native replacement for "bookmarklet", it's the *discoverable* one, and it
  composes with MOB-01/MOB-07 (share sheet delivers a URL; something still has
  to turn that URL into JSON). Also gives us home-screen install for free.
- **MOB-04 — "Send to Haipai" iOS Shortcut.** The iOS answer to MOB-03.
  Publish an iCloud Shortcut link that takes a shared URL, derives the `?data=`
  JSON URL, fetches it, and POSTs to `/api/games/upload` with the user's Bearer
  token — the bookmarklet's exact logic, in the share sheet. Install is one tap
  + paste your token once. **Risk**: Shortcuts' fetch has no Safari cookies, so
  if CF challenges it the fetch dies (same question as E1). Distribution is a
  plain iCloud link — no App Store.
- **MOB-05 — Make the existing bookmarklet installable on mobile (stopgap).**
  Copy-to-clipboard button for the `javascript:` string (today it is only
  draggable, which is meaningless on touch) plus per-browser install
  instructions and a short video, mirroring the existing tutorial-tab pattern.
  Low ceiling, near-zero cost, unblocks motivated users this week.
- **MOB-06 — Fix the file path where it can be fixed.** `accept=".json"` hides
  the file on some Android pickers (MIME sniffing) — widen it; surface real
  parse errors instead of a generic failure; accept a pasted file via the
  clipboard API. Won't rescue iOS, will rescue Android.

## Tier 2 — structural

- **MOB-07 — Host our own Mortal review worker.** The real fix: user pastes a
  *replay* URL (Tenhou log link, MJS paipu link), Haipai fetches the log, runs
  Mortal, ingests. Deletes stages 2 and 3 entirely — identical UX on phone and
  desktop, no third-party CF, no bookmarklet, no file. Costs: compute per game
  + a queue + latency (minutes, so the UI needs a pending state, which the
  schema does not model today — `categorization_status` is set to `"done"`
  inline in `_ingest_mortal`), plus **licensing review of the Mortal engine and
  its trained weights before hosting them**. Scope note: Tenhou logs are
  plainly server-fetchable, MJS needs an authenticated client — so a
  **Tenhou-only v1** is a much smaller bite and may cover most of the affected
  users. This is the only idea that makes the app genuinely phone-native.
- **MOB-08 — Cross-device handoff.** Phone shows a QR / 6-digit code; a desktop
  browser claims it and pushes the game to that account. **Explicitly does not
  help mobile-*only* users** (the ones who filed this feedback) — it helps
  "reviews on phone, has a laptop somewhere". Cheap, but do not let it stand in
  for a real fix.
- **MOB-09 — Email-in ingestion.** `upload+<token>@…`, user shares the JSON
  from the phone's share sheet to Mail. Cheaper than it sounds: we already have
  a mailbox.org account wired up (`lib/mail.py`), currently send-only via
  `smtplib` — receiving is an IMAP poll of that same account plus an attachment
  parser. Ugly UX (many taps), but it is a universal fallback that works on
  every phone and every client.
- **MOB-10 — Safari iOS / Firefox Android extension.** Inject a real "Send to
  Haipai" button into the report page — the best possible UX on mobile,
  identical to desktop. Cost: Safari Web Extensions ship inside an app (Apple
  Developer Program, review cycle, ongoing maintenance) for a user base we
  haven't sized. Park it unless MOB-03/04 measurably fail.

---

## Recommended sequence

1. **Phone reality check on all three clients** (stage-2 audit) + **E1/E2**.
   Everything below is priced off these.
2. **MOB-02 + MOB-05 + MOB-06** — a few days, no external dependencies, gives
   mobile users *a* path immediately.
3. **MOB-01** if E1 or E2 passed — this is the "paste and go" flow that makes
   the problem disappear for anyone who can reach stage 2 on a phone.
4. **MOB-03 (Android share target)**, then **MOB-04 (iOS Shortcut)** — turns a
   pasted URL into a share-sheet tap.
5. **MOB-07 Tenhou-only** if the stage-2 audit shows the Mortal step itself is
   what's blocking phones. Biggest payoff, biggest cost, and the only fix for
   MJS-on-mobile.

## Decisions to lock

- **D1 — Who is the target user?** "Mobile-only" (no laptop at all — MOB-08 is
  useless to them, MOB-07 may be mandatory) vs "mobile-preferred". This is the
  single biggest lever on the sequence above and should come from the actual
  feedback, not assumption.
- **D2 — Which platform first?** MOB-03 (Android, cheap, standards-based) and
  MOB-04 (iOS, cheap but CF-dependent) are separate builds; the user split
  decides the order.
- **D3 — Are we willing to run Mortal ourselves?** Ongoing compute + licensing
  commitment. A no here permanently caps how good the mobile flow can get.
- **D4 — Token handling on mobile.** MOB-04 and MOB-09 hand the upload token to
  a place the user can screenshot/paste. Today rotation is all-or-nothing
  (`/api/upload-token/regenerate` invalidates every installed bookmarklet). If
  tokens spread across more surfaces, consider per-device tokens with
  individual revocation.
- **D5 — Async ingest.** MOB-07 and MOB-09 both complete *after* the request
  returns. Adding a real pending/failed state to games is shared groundwork for
  both — worth deciding before either is built.

## Out of scope here

General mobile responsiveness of the review UI (board, EV table, trends
charts). The reported bottleneck is upload; a separate pass should check that
the analysis is actually *readable* on a phone once uploading works — landing
a mobile upload flow that dead-ends in an unusable review screen would be a
poor trade.
