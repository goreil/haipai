# mjai → haipai uploader (Chrome + Firefox, MV3)

Uploads the Mortal review JSON from a `mjai.ekyu.moe` report page to your haipai
instance and sends the tab to the game there. You still solve the Cloudflare
challenge and press mjai's own Submit button — the extension only takes over
once mjai has produced the report page.

Spec: [`../docs/backlogs/Browser-extension-spec.md`](../docs/backlogs/Browser-extension-spec.md).

Vanilla JS, no build step, no dependencies. Nothing here is part of the Flask
app: it is not served by `static/`, not copied into the Docker image, and has no
Python requirements.

**One source, two builds.** All the code lives here and is shared; only the
manifest differs per browser, because no single `manifest.json` can satisfy both
(Chrome MV3 *requires* `background.service_worker`, Firefox *rejects* it). Chrome
loads this directory directly. Firefox loads `../extension-firefox/`, which
`build-firefox.sh` generates from here. See
[How the two builds share one source](#how-the-two-builds-share-one-source).

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, **Chrome** (`background.service_worker`) |
| `manifest.firefox.json` | MV3 manifest, **Firefox** (`background.scripts` + `browser_specific_settings`) |
| `build-firefox.sh` | Generates `../extension-firefox/` from this directory |
| `content.js` | Runs on `https://mjai.ekyu.moe/killerducky/*`: validates `?data=`, fetches the report JSON same-origin, shows the toast |
| `background.js` | Chrome service worker / Firefox event page: POSTs to haipai under the session cookie, dedupes, retries, navigates the tab |
| `options.html` / `options.js` | Base URL, host access, session state, "Test connection" |
| `icons/icon-{16,32,48,128}.png` | Toolbar/add-on icon, also the desktop-notification icon |

`../extension-firefox/` is a **generated, git-ignored build artifact**. Never
edit it — `build-firefox.sh` wipes and rewrites it.

## Install

### Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `extension/` directory.
4. The extension appears as *mjai → haipai uploader*. Pin it if you like; it has
   no popup, so the only UI is the options page.

Reloading after an edit: hit the ↻ button on the extension's card. Content-script
edits also need a reload of any open mjai tab.

### Firefox — temporary (quickest, for trying it out)

1. Generate the Firefox build:

   ```bash
   ./extension/build-firefox.sh      # writes extension-firefox/
   ```

2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on…** → select **`extension-firefox/manifest.json`**
   (not `extension/manifest.json` — that one is Chrome's and Firefox refuses it
   with *"background.service_worker is currently disabled. Add
   background.scripts."*).
4. That's it — a temporary MV3 install gets its host permissions granted
   automatically (measured on 140 ESR; older write-ups say otherwise, which was
   true before Firefox 127). If the options page ever shows *Host access: not
   granted* — you revoked it, or you are on an older Firefox — press **Grant
   access** there.
5. Reloading after an edit: re-run `build-firefox.sh`, then hit **Reload** on the
   add-on's card in `about:debugging`.

A temporary add-on is removed when Firefox restarts.

### Firefox — permanent

Release Firefox only installs signed add-ons, so pick one:

- **Signed for yourself.** Zip the *generated* directory and submit it to
  [addons.mozilla.org](https://addons.mozilla.org/developers/) as an **unlisted**
  add-on (or `web-ext sign` with AMO API keys). You get a signed `.xpi` that
  installs permanently in release Firefox and is not published to anyone.
  `browser_specific_settings.gecko.id` is already set, which AMO requires.

  ```bash
  ./extension/build-firefox.sh
  cd extension-firefox && zip -r -FS ../haipai-uploader.zip . -x '*.DS_Store'
  ```

- **Unsigned.** Firefox Developer Edition, Nightly, or ESR only: set
  `xpinstall.signatures.required` to `false` in `about:config`, then
  `about:addons` → gear → **Install Add-on From File…** → the zip above. Release
  and Beta Firefox ignore that pref, so this will not work there.

Either way, a properly installed add-on *does* get its host permissions at
install time (Firefox 127+), so step 3 of the temporary flow does not apply —
though Firefox still lets you revoke them later from `about:addons`, and the
options page will tell you if that has happened.

## First run

There is no sign-in, no token, and nothing to paste. **The extension uploads as
whoever is logged in to haipai in that browser** — it borrows your existing
haipai session cookie. Log in to haipai as you always do and uploads work; log
out and they stop.

Open the options page (Chrome: extension **Details** → **Extension options**;
Firefox: `about:addons` → the add-on → **Preferences**), then:

1. **haipai base URL** — defaults to `https://haipai.ylue.de`. No trailing slash.
   Press **Save base URL**.
2. **Host access** — should say *granted*. If it says *not granted* (Firefox
   temporary install, or you revoked it), press **Grant access**.
3. **Account** shows *logged in as \<your username\>* if you have a live haipai
   session in this browser, otherwise *not logged in* — **Open haipai login**
   opens the login page, **Re-check** refreshes the badge afterwards.
4. Press **Test connection**. Expected results:
   - `HTTP 400 … mortal_data is required` → **session is good.** The test sends
     an empty payload on purpose; getting past auth to the payload check is the
     pass condition.
   - `HTTP 401` → you are not logged in to haipai in this browser.
   - *No host access …* → do step 2.
   - "Could not reach …" → base URL wrong, or the host is not in
     `host_permissions` (see below).

Why this works at all: the browser attaches a `SameSite=Lax` cookie to fetches
made from a background context that holds host permissions for the target, so
the POST arrives authenticated without the extension ever holding — or being
able to read — anything secret. Measured on Chromium; see
[Firefox cookie caveat](#firefox-cookie-caveat).

### Using a different haipai host

`manifest.json` grants `https://haipai.ylue.de/*` only. If you point the base URL
at another host, add that origin to `host_permissions` in `manifest.json` and
reload the extension, otherwise the upload (and the connection test) will fail to
reach it. **Grant access** can only request origins that the manifest already
lists.

## Normal flow

1. Submit a game on `https://mjai.ekyu.moe/` as usual — solve Turnstile, click
   Submit. The extension does not touch this step at all.
2. mjai shows its own processing page, then navigates to
   `https://mjai.ekyu.moe/killerducky/?data=/report/<hash>.json`.
3. A small toast appears bottom-right: *Fetching review from mjai…* →
   *Uploading review to haipai…*
4. The tab is redirected to `https://haipai.ylue.de/#g<game_id>`.

Reloading a report page you already uploaded jumps straight to the existing game
— no toast, no second upload. That memory lives in extension-local storage under
`uploaded`, keyed by the report hash, and entries older than 15 days are pruned
(mjai deletes reports after 15 days anyway).

If you are logged out of haipai, the report page shows a toast with a **Log in
to haipai** button — and nothing is uploaded or even fetched until you are. The
button opens haipai's login page in a new tab; the report tab then watches for
the session to appear (for up to 5 minutes) and continues the upload by itself,
so you never have to come back and reload — which matters, because report pages
expire after 15 days.

If host access is missing, the toast says so and offers **Open options** instead
— `permissions.request()` needs an extension page and a real user gesture, so a
content script cannot ask for it directly.

If the upload fails, the toast stays with the error and a **Retry** button. On a
5xx or network error the background script already retried three times (1s, 4s,
10s) before giving up. A 401 is never retried — the toast offers the login flow
instead. If you closed the tab, a desktop notification tells you it failed.

## How the two builds share one source

Only two things actually differ between the browsers. One of them forces a
second directory; the other does not.

1. **Background context — the reason for `build-firefox.sh`.** Chrome MV3
   requires a service worker; Firefox MV3 has none and uses a non-persistent
   event page. These are mutually exclusive in one file:

   - Chrome needs `"background": { "service_worker": "background.js" }` and
     rejects `background.scripts` as MV2-only.
   - Firefox rejects `background.service_worker` outright — *"background
     .service_worker is currently disabled. Add background.scripts."*

   Putting **both** keys in one manifest was tried and does not work: Firefox 140
   ESR tolerates it, but current Firefox refuses the install. Symlinking the
   shared files into a second directory was tried too and also does not work —
   Firefox will not read symlinked extension resources (measured: the add-on
   installs, then the options page never loads, while the identical directory
   with real files loads in ~0.4s). Hence real copies, generated.

   The consequence for `background.js`: it runs as a service worker on Chrome
   and an event page on Firefox, so it must never assume a
   `ServiceWorkerGlobalScope`. No `skipWaiting`, no `oninstall`, no `clients` —
   plain `fetch` and timers only.

2. **API namespace — no second copy needed.** Every file starts with

   ```js
   const ext = globalThis.browser ?? globalThis.chrome;
   ```

   Firefox's `browser.*` is promise-based, and Chrome's MV3 `chrome.*` is too, so
   preferring `browser` yields one awaitable code path in both browsers — no
   callback shims and no `webextension-polyfill` dependency. Use `ext.*`
   throughout; a bare `chrome.*` would break Firefox's promise contract.

`build-firefox.sh` copies the shared files verbatim and swaps in
`manifest.firefox.json`. Because the two manifests are separate files they could
drift, so the script diffs every key except `background` and
`browser_specific_settings` and **fails the build** if they disagree — bump the
version in one and it will tell you.

Firefox-only extras that Chrome ignores: `browser_specific_settings.gecko`
(add-on id + minimum version), and the host-access check/grant flow, which on
Chrome always reports *granted*.

### The cookie mechanism is measured on both

Both browsers were checked against production, since this is the load-bearing
assumption of the whole design:

- **Chromium 150** — `credentials:'include'` → 200, `credentials:'omit'` → 401.
- **Firefox 140 ESR** — temporary install, host access granted, logged in to
  haipai in a normal tab: the background page's `/api/me` returns the user
  (*logged in as …*) and **Test connection** returns `HTTP 400 mortal_data is
  required`, i.e. the POST authenticated. Logged out, the identical code path
  returns 401 — so the session cookie is demonstrably what authenticates it.

If a future browser change ever breaks this, the symptom is a 401 loop with
*Host access: granted* and a live haipai login, and the fallback is the Bearer
`upload_token` path, which `/api/games/upload` still accepts and which does not
depend on cookie behaviour at all.

## Security notes

- The extension stores no credential at all. It never sees your password, never
  holds a token, and has nothing that could leak from extension storage, a log
  line, a URL, or toast text. Its access is exactly your haipai session, and it
  ends when that session does.
- The cross-origin POST happens in the background context under
  `host_permissions`, so it is not subject to the page's CORS rules and does not
  depend on haipai's CORS headers staying permissive.
- Server side, `/api/games/upload` is CSRF-exempt (an extension background
  context cannot send the `Referer` that flask-wtf's `WTF_CSRF_SSL_STRICT`
  demands), so it carries its own cross-site guards instead: the session cookie
  is only accepted when the request's `Origin` is haipai itself or an extension
  origin (`chrome-extension://`, `moz-extension://`, `safari-web-extension://` —
  Firefox needed no server change), the session cookie is `SameSite=Lax`, and the
  endpoint's CORS headers deliberately omit `Access-Control-Allow-Credentials`.
  All three are pinned by `tests/test_api_extension.py`; see `api_upload`'s
  docstring before changing any of them.
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
three in-flight attempts, a Safari port, store publishing (the AMO route above is
unlisted self-distribution, not a listing).
