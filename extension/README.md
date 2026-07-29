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
| `background.js` | Service worker: owns the credential, runs sign-in, POSTs to haipai, dedupes, retries, navigates the tab |
| `options.html` / `options.js` | Base URL, sign in / disconnect, "Test connection" |

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `extension/` directory.
4. The extension appears as *mjai → haipai uploader*. Pin it if you like; it has
   no popup, so the only UI is the options page.

Reloading after an edit: hit the ↻ button on the extension's card. Content-script
edits also need a reload of any open mjai tab.

## First run — sign in

1. `chrome://extensions` → the extension's **Details** → **Extension options**
   (or right-click the toolbar icon → *Options*).
2. **haipai base URL** — defaults to `https://haipai.ylue.de`. No trailing slash.
3. Press **Sign in to haipai**. A haipai window opens; log in however you
   normally do — password, Discord, or Google — then press **Connect** on the
   consent screen. If you are already logged in to haipai in this browser, it is
   just the one **Connect** click.
4. The badge changes to *connected as \<your username\>*.
5. Press **Test connection**. Expected results:
   - `HTTP 400 … mortal_data is required` → **connection is good.** The test
     sends an empty payload on purpose; getting past auth to the payload check
     is the pass condition.
   - `HTTP 401` → the connection was revoked; sign in again.
   - "Could not reach …" → base URL wrong, or the host is not in
     `host_permissions` (see below).

There is no token to copy and paste. The extension never sees your password: it
receives an upload-only credential scoped to this browser, which the service
worker holds and the options page can never read back. **Disconnect** revokes it
on the server and forgets it locally; you can also revoke it from haipai →
Account → Connected browser extensions.

You can sign in from the report page too — if you land on a review while not
connected, the toast offers a **Sign in to haipai** button and continues the
upload straight afterwards, without a reload.

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

If you are not connected, the report page shows a toast with a **Sign in to
haipai** button — and nothing is uploaded or even fetched until you do. After
signing in the upload continues immediately; no reload needed.

If the upload fails, the toast stays with the error and a **Retry** button. On a
5xx or network error the worker already retried three times (1s, 4s, 10s) before
giving up. An auth error is never retried — instead the stored credential is
dropped and the toast offers sign-in again. If you closed the tab, a desktop
notification tells you it failed.

## Security notes

- Sign-in goes through `chrome.identity.launchWebAuthFlow`, which only ever
  hands control back to `https://<extension-id>.chromiumapp.org/` — a URL no
  server can host and only this extension can receive. The server refuses any
  other redirect target, which is what stops a crafted authorize link from
  walking off with a credential. The token arrives in the URL *fragment*, so it
  never reaches a server log.
- The credential lives in `chrome.storage.local` and is read only by the service
  worker. It is never injected into the page, never put in a URL, never logged,
  and never included in toast, error, or notification text. The options page
  cannot read it either — it asks the worker for a yes/no.
- It is a separate secret from the bookmarklet's upload token: revoking one
  leaves the other working, and it grants upload only — it cannot read your
  games, notes, or account.
- The cross-origin POST happens in the service worker under `host_permissions`,
  so it is not subject to the page's CORS rules and does not depend on haipai's
  CORS headers staying permissive.
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
extension, which holds its own credential.

Upgrading from v1.0 of this extension: a previously pasted token keeps working
until you sign in, at which point it is discarded in favour of the per-install
credential.

## Not in v1

gzipped request bodies (`CompressionStream`), a persistent retry queue beyond the
three in-flight attempts, Firefox/Safari ports, store publishing.
