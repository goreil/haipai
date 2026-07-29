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
| `background.js` | Service worker: owns the token, POSTs to haipai, dedupes, retries, navigates the tab |
| `options.html` / `options.js` | Base URL + token settings, "Test connection" |

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `extension/` directory.
4. The extension appears as *mjai → haipai uploader*. Pin it if you like; it has
   no popup, so the only UI is the options page.

Reloading after an edit: hit the ↻ button on the extension's card. Content-script
edits also need a reload of any open mjai tab.

## First run — set your token

1. `chrome://extensions` → the extension's **Details** → **Extension options**
   (or right-click the toolbar icon → *Options*).
2. **haipai base URL** — defaults to `https://haipai.ylue.de`. No trailing slash.
3. **Upload token** — get it from haipai → Account → upload token. Paste it and
   press **Save**.
4. Press **Test connection**. Expected results:
   - `HTTP 400 … mortal_data is required` → **token is good.** The test sends an
     empty payload on purpose; getting past auth to the payload check is the pass
     condition.
   - `HTTP 401 … Invalid upload token` → wrong token.
   - `HTTP 401 … Missing Bearer token` → no token was sent.
   - "Could not reach …" → base URL wrong, or the host is not in
     `host_permissions` (see below).

The saved token is never displayed again — the page only shows a *token is set*
badge. Saving with the token field left empty keeps the existing token; use
**Clear stored token** to remove it.

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

If no token is configured, the report page instead shows a toast telling you to
set one, with an **Open options** button — and nothing is uploaded or even
fetched. Reload the page after saving the token.

If the upload fails, the toast stays with the error and a **Retry** button. On a
5xx or network error the worker already retried three times (1s, 4s, 10s) before
giving up. A token error is never retried. If you closed the tab, a desktop
notification tells you it failed.

## Security notes

- The token lives in `chrome.storage.local` and is read only by the service
  worker. It is never injected into the page, never put in a URL, never logged,
  and never included in toast, error, or notification text.
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
history, so treat that token as exposed. After the extension is working, rotate
it in haipai → Account (regenerate upload token), then paste the new token into
the extension options. That also invalidates the old bookmarklet, which is the
point.

## Not in v1

gzipped request bodies (`CompressionStream`), a persistent retry queue beyond the
three in-flight attempts, Firefox/Safari ports, store publishing.
