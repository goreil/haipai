# Chrome Extension: mjai → haipai auto-upload

## Goal

After a user submits a game for review on `https://mjai.ekyu.moe/`, the resulting Mortal review JSON should be uploaded automatically to a self-hosted haipai instance, and the browser should end up on the haipai page for that game. The user's only interaction is passing the Cloudflare challenge and clicking the site's normal Submit button.

This replaces a bookmarklet the user currently runs by hand on the report page.

## Verified facts — treat these as given, do not re-derive

- `https://mjai.ekyu.moe/` submits via a plain server-rendered form: `<form class="form" method="post" action="https://mjai.ekyu.moe/review">`. There is no XHR/fetch submit path. The site itself renders the "processing" page and then navigates to the report.
- The report page URL shape is `https://mjai.ekyu.moe/killerducky/?data=/report/<16-hex-hash>.json`.
- The report JSON for a real game: HTTP 200, `content-type: application/json`, ~330 KB. Top-level keys include `engine`, `game_length`, `loading_time`, `review_time`, `show_rating`, `version`, `review`, `player_id`, `split_logs`, `mjai_log`, `lang`. It is same-origin relative to the report page.
- Upload endpoint: `POST https://haipai.ylue.de/api/games/upload`, `Content-Type: application/json`, `Authorization: Bearer <token>`, body `{"mortal_data": <report json>}`.
- Endpoint auth behaviour, confirmed live: no header → `401 {"error":"Missing Bearer token"}`; bad token → `401 {"error":"Invalid upload token"}`. Success is expected to be 2xx with `{"game_id": ...}`.
- The endpoint accepts **two** credentials: the account's single `upload_token` (bookmarklet) and per-install extension tokens (see "Authentication" below). They are independent — rotating one does not affect the other.
- The endpoint already sends permissive CORS headers and passes preflight for the `Authorization` header. Do not rely on this staying true — see architecture below.
- mjai report pages are retained for only 15 days.

## Hard constraints

- **Do not attempt to automate, solve, replay, or bypass the Cloudflare Turnstile challenge.** The token is single-use and short-lived. The extension must never construct its own `POST /review` request. The native form submit is the only submit path.
- **Do not implement a custom waiting/processing page.** mjai already provides one. The extension waits by observing navigation.
- The bearer token is a secret. Never hardcode it, never log it, never write it into the page DOM, never include it in a URL.

## Architecture

MV3, three parts:

1. **Content script** on `https://mjai.ekyu.moe/killerducky/*` — resolves the `data` param, fetches the report JSON same-origin, hands it to the service worker.
2. **Service worker** — owns the token and performs the cross-origin POST. Cross-origin fetch from a content script is still subject to CORS in MV3; doing it in the worker under `host_permissions` bypasses CORS entirely and makes the extension immune to haipai's CORS config changing. It also keeps the token out of page context.
3. **Options page** — lets the user set the haipai base URL and sign in / disconnect. Settings live in `chrome.storage.local`.

## Authentication (v1.1 — replaces the pasted token)

The user signs in instead of copying a token. `chrome.identity.launchWebAuthFlow`
opens `GET /extension/authorize?redirect_uri=<chrome.identity.getRedirectURL()>&state=<nonce>`;
the user logs in there the normal way (password, Discord, or Google) and approves
a consent screen; the server mints a row in `extension_tokens` and redirects to
`https://<extension-id>.chromiumapp.org/#token=…&username=…&state=…`.

Why not the session cookie, which would need no new credential at all — this was
measured, not assumed:

- Chrome **does** attach a `SameSite=Lax` cookie to a fetch from an extension
  service worker holding host permissions for the target. Verified on Chromium
  150 against production: `credentials:'include'` → 200, `credentials:'omit'` →
  401.
- But the POST is then rejected by CSRF, twice: no `X-CSRFToken`, and — even
  with one fetched from `/api/me` — `flask-wtf`'s `WTF_CSRF_SSL_STRICT` demands
  a `Referer` that an extension worker cannot send (`Referer` is a forbidden
  header in `fetch`; the `referrer:` init option falls back to the client origin
  when cross-origin).
- Making cookies work would therefore mean CSRF-exempting a *cookie*-authenticated
  endpoint, leaving SameSite as the only barrier. A Bearer token carries no
  ambient authority, so CSRF does not apply — the same reasoning that already
  exempts `api_upload` for the bookmarklet.

Hard constraints on the flow:

- The server accepts a `redirect_uri` **only** on `https://*.chromiumapp.org`,
  re-validated on the POST as well as the GET. Anything else is a 400 rendered
  in place, never a redirect — otherwise this is an open redirect that leaks
  credentials.
- The token goes in the URL **fragment**, never the query string, so it stays
  out of server logs.
- `state` is echoed back and checked by the worker before the token is stored.
- The credential is upload-only and per-install, listed and revocable at
  haipai → Account, and self-revocable via `POST /api/extension/revoke`.

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
  "permissions": ["storage", "tabs", "notifications", "identity"],
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

- Load `{ haipaiBase, authToken }` from `chrome.storage.local`. Default `haipaiBase` to `https://haipai.ylue.de`. If not signed in, return `needsSignIn` so the content script can offer the sign-in button, and abort. (`uploadToken` from v1.0 is still honoured as a fallback until the user signs in.)
- Check the dedupe store (`chrome.storage.local` key `uploaded`, a map of `key → { gameId, ts }`). If present, navigate straight to the existing game and return. Prune entries older than 15 days on each run.
- POST:
  ```js
  const res = await fetch(`${haipaiBase}/api/games/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${uploadToken}`
    },
    body: JSON.stringify({ mortal_data: report })
  });
  const body = await res.json().catch(() => ({}));
  ```
- On 2xx: record `key → body.game_id`, then `chrome.tabs.update(senderTabId, { url: haipaiBase + (body.game_id ? '#g' + body.game_id : '/') })`.
- On 401: clear the stored credential and surface a sign-in prompt. Do not retry; retrying a rejected credential is pointless.
- On 5xx or network error: retry up to 3 times with exponential backoff (1s, 4s, 10s), then report failure. Bear in mind the report JSON expires server-side after 15 days, so don't build a long-lived persistent retry queue.
- Return a result object to the content script so it can update its toast. Remember to `return true` from the listener for the async response.
- Never include the token in any error string, notification, or console output.

Optionally add `chrome.notifications.create` for terminal failure, so the user still finds out if the tab was closed.

## options.html / options.js

haipai base URL (default `https://haipai.ylue.de`) plus **Sign in to haipai** / **Disconnect** and a "Test connection" button that POSTs `{mortal_data:{}}` and reports the status code, so a live connection (400 `mortal_data is required`) is distinguishable from a revoked one (401). Persist the base URL to `chrome.storage.local`. The credential itself is never read into the options page — it asks the worker for a boolean and a username, and the worker runs both sign-in and the connection test.

## Acceptance criteria

1. With no connection configured, loading a report page produces a clear sign-in prompt (with a working in-page **Sign in to haipai** button) and no upload call to haipai.
2. With a valid token, submitting a game on mjai results in: user solves Turnstile → clicks the site's Submit → sees mjai's own processing page → lands on the report page → sees an "uploading" toast → is redirected to `https://haipai.ylue.de/#g<game_id>`.
3. Reloading a report page that was already uploaded navigates to the existing game without re-uploading.
4. Visiting a `killerducky` URL with no `?data=` param, or with a `data` value pointing at another origin, does nothing and logs nothing sensitive.
5. A 401 from haipai drops the stored credential, offers sign-in, and does not retry.
6. The token never appears in the page DOM, the console, notification text, or any URL query string.
8. `/extension/authorize` refuses any `redirect_uri` outside `https://*.chromiumapp.org`, on both GET and POST, and issues no token when denied.
9. Reaching `/extension/authorize` while logged out returns to the consent screen after login — including via Discord/Google, which round-trip through an external provider.
7. No code path in the extension issues a request to `https://mjai.ekyu.moe/review`.

## Notes for the implementer

- Test fixture: a real report is available at `https://mjai.ekyu.moe/report/759b76f0a535fad6.json` (may have expired — retention is 15 days; regenerate via the site if it 404s).
- If haipai supports gzipped request bodies, `CompressionStream('gzip')` is a reasonable optimisation for the ~330 KB payload, but treat it as a follow-up, not part of v1.
- The user has an existing bookmarklet with the token embedded in the bookmarklet URL. Mention in the README that this token should be rotated, since bookmarklet URLs leak into bookmark sync and browser history. Rotating it does not affect the extension.
- Tests: `tests/test_api_extension.py` covers the server side. The browser side was verified end-to-end by driving Chromium over CDP; `launchWebAuthFlow` cannot run headless, so the test observes the callback navigation (`Network.requestWillBeSent` → `urlFragment`) instead, which carries the same redirect the extension would receive.
