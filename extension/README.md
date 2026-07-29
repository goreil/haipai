# mjai → haipai uploader (Chrome MV3)

Uploads the Mortal review JSON from a `mjai.ekyu.moe` report page to your haipai
instance and sends the tab to the game there. You still solve the Cloudflare
challenge and press mjai's own Submit button — the extension only takes over
once mjai has produced the report page.

Spec: [`../docs/backlogs/Browser-extension-spec.md`](../docs/backlogs/Browser-extension-spec.md).

Vanilla JS, no build step, no dependencies. Nothing here is part of the Flask
app: it is not served by `static/`, not copied into the Docker image, and has no
Python requirements.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest (permissions, content-script match, options page) |
| `content.js` | Runs on `https://mjai.ekyu.moe/killerducky/*`: validates `?data=`, fetches the report JSON same-origin, shows the toast |
| `background.js` | Service worker: POSTs to haipai under the session cookie, dedupes, retries, navigates the tab |
| `options.html` / `options.js` | Base URL, session state, "Test connection" |

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `extension/` directory.
4. The extension appears as *mjai → haipai uploader*. Pin it if you like; it has
   no popup, so the only UI is the options page.

Reloading after an edit: hit the ↻ button on the extension's card. Content-script
edits also need a reload of any open mjai tab.

## First run

There is no sign-in, no token, and nothing to paste. **The extension uploads as
whoever is logged in to haipai in that browser** — it borrows your existing
haipai session cookie. Log in to haipai as you always do and uploads work; log
out and they stop.

Setup is therefore just the base URL:

1. `chrome://extensions` → the extension's **Details** → **Extension options**
   (or right-click the toolbar icon → *Options*).
2. **haipai base URL** — defaults to `https://haipai.ylue.de`. No trailing slash.
   Press **Save base URL**.
3. The badge shows *logged in as \<your username\>* if you have a live haipai
   session in this browser, otherwise *not logged in* — **Open haipai login**
   opens the login page, **Re-check** refreshes the badge afterwards.
4. Press **Test connection**. Expected results:
   - `HTTP 400 … mortal_data is required` → **session is good.** The test sends
     an empty payload on purpose; getting past auth to the payload check is the
     pass condition.
   - `HTTP 401` → you are not logged in to haipai in this browser.
   - "Could not reach …" → base URL wrong, or the host is not in
     `host_permissions` (see below).

Why this works at all: Chrome attaches a `SameSite=Lax` cookie to fetches made
by a service worker that holds host permissions for the target, so the worker's
POST arrives authenticated without the extension ever holding — or being able to
read — anything secret.

### Using a different haipai host

`manifest.json` grants `https://haipai.ylue.de/*` only. If you point the base URL
at another host, add that origin to `host_permissions` in `manifest.json` and
reload the extension, otherwise the upload (and the connection test) will fail to
reach it.

## Normal flow

1. Submit a game on `https://mjai.ekyu.moe/` as usual — solve Turnstile, click
   Submit. The extension does not touch this step at all.
2. mjai shows its own processing page, then navigates to
   `https://mjai.ekyu.moe/killerducky/?data=/report/<hash>.json`.
3. A small toast appears bottom-right: *Fetching review from mjai…* →
   *Uploading review to haipai…*
4. The tab is redirected to `https://haipai.ylue.de/#g<game_id>`.

Reloading a report page you already uploaded jumps straight to the existing game
— no toast, no second upload. That memory lives in `chrome.storage.local` under
`uploaded`, keyed by the report hash, and entries older than 15 days are pruned
(mjai deletes reports after 15 days anyway).

If you are logged out of haipai, the report page shows a toast with a **Log in
to haipai** button — and nothing is uploaded or even fetched until you are. The
button opens haipai's login page in a new tab; the report tab then watches for
the session to appear (for up to 5 minutes) and continues the upload by itself,
so you never have to come back and reload — which matters, because report pages
expire after 15 days.

If the upload fails, the toast stays with the error and a **Retry** button. On a
5xx or network error the worker already retried three times (1s, 4s, 10s) before
giving up. A 401 is never retried — the toast offers the login flow instead. If
you closed the tab, a desktop notification tells you it failed.

## Security notes

- The extension stores no credential at all. It never sees your password, never
  holds a token, and has nothing that could leak from `chrome.storage.local`,
  a log line, a URL, or toast text. Its access is exactly your haipai session,
  and it ends when that session does.
- The cross-origin POST happens in the service worker under `host_permissions`,
  so it is not subject to the page's CORS rules and does not depend on haipai's
  CORS headers staying permissive.
- Server side, `/api/games/upload` is CSRF-exempt (an extension worker cannot
  send the `Referer` that flask-wtf's `WTF_CSRF_SSL_STRICT` demands), so it
  carries its own cross-site guards instead: the session cookie is only accepted
  when the request's `Origin` is haipai itself or an extension origin, the
  session cookie is `SameSite=Lax`, and the endpoint's CORS headers deliberately
  omit `Access-Control-Allow-Credentials`. All three are pinned by
  `tests/test_api_extension.py`; see `api_upload`'s docstring before changing
  any of them.
- `content.js` resolves `?data=` against the page URL and refuses anything whose
  origin isn't `https://mjai.ekyu.moe` — a crafted link must not be able to make
  the extension fetch some other origin and ship the response to haipai.
- The extension never constructs a `POST https://mjai.ekyu.moe/review`. mjai's
  own form is the only submit path; the Turnstile token is single-use and is not
  something to automate.

### Rotate your bookmarklet token

If you have been using the haipai upload bookmarklet, its token is embedded in
the bookmarklet URL — and bookmark URLs sync between devices and land in browser
history, so treat that token as exposed. Once the extension is working you no
longer need the bookmarklet: rotate the token in haipai → Account (regenerate
upload token) and drop the old bookmark. Rotating it does **not** affect the
extension, which uses no token at all.

Upgrading from v1.x: the per-install extension tokens are gone, server side and
all. Nothing to migrate and nothing to revoke — just reload the extension and
make sure you are logged in to haipai in that browser.

## Not implemented

gzipped request bodies (`CompressionStream`), a persistent retry queue beyond the
three in-flight attempts, Firefox/Safari ports, store publishing.
