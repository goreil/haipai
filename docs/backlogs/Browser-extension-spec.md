# Chrome Extension: mjai → haipai auto-upload

## Goal

After a user submits a game for review on `https://mjai.ekyu.moe/`, the resulting Mortal review JSON should be uploaded automatically to a self-hosted haipai instance, and the browser should end up on the haipai page for that game. The user's only interaction is passing the Cloudflare challenge and clicking the site's normal Submit button.

This replaces a bookmarklet the user currently runs by hand on the report page.

## Verified facts — treat these as given, do not re-derive

- `https://mjai.ekyu.moe/` submits via a plain server-rendered form: `<form class="form" method="post" action="https://mjai.ekyu.moe/review">`. There is no XHR/fetch submit path. The site itself renders the "processing" page and then navigates to the report.
- The report page URL shape is `https://mjai.ekyu.moe/killerducky/?data=/report/<16-hex-hash>.json`.
- The report JSON for a real game: HTTP 200, `content-type: application/json`, ~330 KB. Top-level keys include `engine`, `game_length`, `loading_time`, `review_time`, `show_rating`, `version`, `review`, `player_id`, `split_logs`, `mjai_log`, `lang`. It is same-origin relative to the report page.
- Upload endpoint: `POST https://haipai.ylue.de/api/games/upload`, `Content-Type: application/json`, body `{"mortal_data": <report json>}`. Success is 2xx with `{"game_id": ...}`.
- The endpoint accepts **two** ways in, and they are independent: the haipai **session cookie** (the extension) and `Authorization: Bearer <upload_token>` (the bookmarklet, which runs as a page on mjai.ekyu.moe and so can never have the cookie). Unauthenticated → `401 {"error":"Not signed in"}`; bad Bearer token → `401 {"error":"Invalid upload token"}`; cookie presented from a foreign web origin → `403`.
- The endpoint already sends permissive CORS headers and passes preflight for the `Authorization` header. Do not rely on this staying true — see architecture below.
- mjai report pages are retained for only 15 days.

## Hard constraints

- **Do not attempt to automate, solve, replay, or bypass the Cloudflare Turnstile challenge.** The token is single-use and short-lived. The extension must never construct its own `POST /review` request. The native form submit is the only submit path.
- **Do not implement a custom waiting/processing page.** mjai already provides one. The extension waits by observing navigation.
- **Never expose the user's haipai session to page context.** The upload fetch belongs in the service worker; a content script must not be handed cookies, session data, or a way to POST to haipai on the user's behalf.

## Architecture

MV3, three parts:

1. **Content script** on `https://mjai.ekyu.moe/killerducky/*` — resolves the `data` param, fetches the report JSON same-origin, hands it to the service worker.
2. **Service worker** — performs the cross-origin POST, authenticated by the user's haipai session cookie. Cross-origin fetch from a content script is still subject to CORS in MV3; doing it in the worker under `host_permissions` bypasses CORS entirely, makes the extension immune to haipai's CORS config changing, and is what gets the Lax cookie attached in the first place.
3. **Options page** — lets the user set the haipai base URL and see whether this browser has a live haipai session. Settings live in `chrome.storage.local`.

## Authentication (v2.0 — the haipai session cookie)

The extension holds no credential of its own. Its service worker POSTs with
`credentials: 'include'`, and the upload endpoint accepts the resulting haipai
session cookie. "Signed in" means nothing more than "logged in to haipai in this
browser"; logging out of haipai stops uploads.

This works because of a measured fact — Chrome **does** attach a `SameSite=Lax`
cookie to a fetch from an extension service worker holding host permissions for
the target. Verified on Chromium 150 against production: `credentials:'include'`
→ 200, `credentials:'omit'` → 401.

The blocker was never the cookie, it was CSRF: flask-wtf checks `Referer` before
it checks the token when `WTF_CSRF_SSL_STRICT` is on (the default), and an
extension worker cannot send one — `Referer` is a forbidden header in `fetch`,
and the `referrer:` init option falls back to the client origin cross-origin. So
`/api/games/upload` is CSRF-exempt and carries its own cross-site guards
instead. **All three must hold together**; `api_upload`'s docstring in
`routes/game.py` is the authority, and `tests/test_api_extension.py` pins them:

1. `SESSION_COOKIE_SAMESITE = "Lax"` keeps the cookie off cross-site POSTs,
   including the preflight-free "simple request" shape.
2. `_cors_headers()` sends **no** `Access-Control-Allow-Credentials`, so a
   preflighted credentialed POST from a page is abandoned before it is sent.
3. `_cookie_origin_ok()` accepts the cookie only when `Origin` is absent
   (extension workers may omit it), an extension origin (`chrome-extension://`,
   `moz-extension://`, `safari-web-extension://`), or haipai itself. Note this
   refuses `https://mjai.ekyu.moe` on the cookie path even though CORS allows
   that origin to *call* the endpoint — the bookmarklet must use its Bearer
   token.

An explicit `Authorization: Bearer` header is judged on its own and never falls
back to the cookie, so a revoked bookmarklet token fails visibly for its owner
rather than being silently rescued by a logged-in session.

### What this replaced

v1.1 minted a per-install token through an `/extension/authorize` consent page
driven by `chrome.identity.launchWebAuthFlow`, stored in an `extension_tokens`
table with an Account-page management panel and a self-revoke endpoint. All of
it — table, CRUD, routes, consent template, panel, and the `identity`
permission — was deleted in v2.0. The cost of the swap, accepted deliberately:
the credential is no longer upload-only or per-install, and cookie auth depends
on Chrome continuing to attach cookies to extension-worker fetches, whereas a
Bearer token would not.

## File layout

```
manifest.json
background.js
content.js
options.html
options.js
```

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "mjai → haipai uploader",
  "version": "1.0.0",
  "permissions": ["storage", "tabs", "notifications"],
  "host_permissions": [
    "https://mjai.ekyu.moe/*",
    "https://haipai.ylue.de/*"
  ],
  "background": { "service_worker": "background.js" },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["https://mjai.ekyu.moe/killerducky/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

## content.js

- Read `data` from `location.search`.
- Resolve it safely and reject anything off-origin:
  ```js
  const raw = new URLSearchParams(location.search).get('data');
  if (!raw) return;                        // nothing to do, stay silent
  const url = new URL(raw, location.href); // handles missing leading slash
  if (url.origin !== location.origin) return;
  ```
  This is a deliberate guard: a crafted `?data=` must not be able to make the extension fetch an arbitrary path and ship it to haipai.
- Derive a dedupe key from the resolved pathname (e.g. the `<hash>` in `/report/<hash>.json`, falling back to the full pathname).
- Ask the worker whether this key was already uploaded; if so, show nothing and stop. A page reload must not cause a second upload.
- `fetch(url)` → `res.json()`. On non-2xx or parse failure, show an in-page toast with the status and stop.
- `chrome.runtime.sendMessage({ type: 'upload', key, report })`. The ~330 KB object clones fine; pass the parsed object, do not stringify it yourself.
- While in flight, show a small non-blocking in-page toast ("Uploading review to haipai…"). **Do not use `alert()`** — it blocks and the tab is about to navigate.
- On success the worker handles navigation; the content script just updates the toast. On failure, show the error text in the toast with a retry affordance.

## background.js

Message handler for `{type:'upload'}`:

- Load `{ haipaiBase }` from `chrome.storage.local`. Default it to `https://haipai.ylue.de`. There is no credential to load.
- Check the dedupe store (`chrome.storage.local` key `uploaded`, a map of `key → { gameId, ts }`). If present, navigate straight to the existing game and return. Prune entries older than 15 days on each run.
- POST:
  ```js
  const res = await fetch(`${haipaiBase}/api/games/upload`, {
    method: 'POST',
    credentials: 'include',            // the entire authentication story
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mortal_data: report })
  });
  const body = await res.json().catch(() => ({}));
  ```
- On 2xx: record `key → body.game_id`, then `chrome.tabs.update(senderTabId, { url: haipaiBase + (body.game_id ? '#g' + body.game_id : '/') })`.
- On 401: surface a log-in prompt. Do not retry; retrying without a session is pointless. Nothing to clear — there is no stored credential.
- On 5xx or network error: retry up to 3 times with exponential backoff (1s, 4s, 10s), then report failure. Bear in mind the report JSON expires server-side after 15 days, so don't build a long-lived persistent retry queue.
- Return a result object to the content script so it can update its toast. Remember to `return true` from the listener for the async response.

Optionally add `chrome.notifications.create` for terminal failure, so the user still finds out if the tab was closed.

## options.html / options.js

haipai base URL (default `https://haipai.ylue.de`), a session badge with **Open haipai login** / **Re-check**, and a "Test connection" button that POSTs `{mortal_data:{}}` and reports the status code, so a live session (400 `mortal_data is required`) is distinguishable from a logged-out one (401). Persist the base URL to `chrome.storage.local`. The page cannot reach haipai itself, so it asks the worker for both the session state (via `/api/me`) and the connection test.

## Acceptance criteria

1. Logged out of haipai, loading a report page produces a clear log-in prompt (with a working in-page **Log in to haipai** button) and no upload call to haipai.
2. Logged in to haipai, submitting a game on mjai results in: user solves Turnstile → clicks the site's Submit → sees mjai's own processing page → lands on the report page → sees an "uploading" toast → is redirected to `https://haipai.ylue.de/#g<game_id>`.
3. Reloading a report page that was already uploaded navigates to the existing game without re-uploading.
4. Visiting a `killerducky` URL with no `?data=` param, or with a `data` value pointing at another origin, does nothing and logs nothing sensitive.
5. A 401 from haipai offers the log-in flow and does not retry; logging in in the opened tab resumes the upload without a reload of the report page.
6. Logging out of haipai stops uploads from that browser.
7. The upload endpoint refuses the session cookie when `Origin` is a foreign web origin (403), including the CORS-allowed `https://mjai.ekyu.moe`, and sends no `Access-Control-Allow-Credentials`.
8. The bookmarklet's Bearer `upload_token` still authenticates, and a bad Bearer token is rejected even when a valid session cookie is present.
9. No code path in the extension issues a request to `https://mjai.ekyu.moe/review`.

## Notes for the implementer

- Test fixture: a real report is available at `https://mjai.ekyu.moe/report/759b76f0a535fad6.json` (may have expired — retention is 15 days; regenerate via the site if it 404s).
- If haipai supports gzipped request bodies, `CompressionStream('gzip')` is a reasonable optimisation for the ~330 KB payload, but treat it as a follow-up, not part of v1.
- The user has an existing bookmarklet with the token embedded in the bookmarklet URL. Mention in the README that this token should be rotated, since bookmarklet URLs leak into bookmark sync and browser history. Rotating it does not affect the extension.
- Tests: `tests/test_api_extension.py` covers the server side — both auth paths plus the three cross-site guards. The browser side was verified end-to-end by driving Chromium over CDP (`--headless=new --load-extension=…`): logging in to haipai in a normal tab, then a real upload of a live mjai report through the unmodified extension — report fetch, cookie-authenticated POST, redirect to `#g<id>`, and dedupe on reload.
- The cookie measurement is the load-bearing assumption of the whole design. If a Chrome change ever stops attaching cookies to extension-worker fetches, uploads break with a 401 loop and the fix is to reinstate a Bearer credential (git history has the v1.1 implementation).
