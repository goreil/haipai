# CSP hardening — drop `script-src 'unsafe-inline'`

Draft: 2026-06-16. Spun out of the WASM-shanten deploy
([[WASM-SHANTEN.md]]), where we added `'wasm-unsafe-eval'` to the prod CSP and
noticed `script-src` still carries `'unsafe-inline'` — the bigger weakness.

## Where the CSP lives

`nginx.conf.template` (HTTPS server block), shipped to prod by copying it to a
server-local `nginx.conf` with the domain filled in and the block uncommented.
The template change does NOT auto-reach prod — the live file is hand-edited +
`nginx -s reload`'d (see WASM-SHANTEN.md "Prod nginx steps").

Current `script-src`:

```
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'
```

`'unsafe-inline'` lets *any* inline JS run — so a single reflected/stored
injection that lands inside the HTML executes. Removing it is the main XSS
mitigation CSP buys; `'wasm-unsafe-eval'` is unrelated and stays.

## Why this is NOT just "add a nonce"

The instinct is "nonce the inline scripts." But the actual situation:

- **Zero inline `<script>` blocks.** All 38 `<script>` tags in
  `templates/` + `static/*.html` use `src=`. So there is nothing to nonce —
  `<script src>` from `'self'` is already allowed without `'unsafe-inline'`.
- **The blocker is inline event-handler attributes.** `onclick=`, `onchange=`,
  `onsubmit=`, … These are what actually require `'unsafe-inline'`, and
  **nonces/hashes do NOT cover them** — per spec, a nonce only whitelists a
  `<script>` element, never an `on*=` attribute. The only way to keep them
  under a strict CSP is to remove them.

So the task is **eliminate inline event handlers**, not "add nonces."

## Inventory (2026-06-16)

- `static/index.html` — **22** inline `on*=` handlers (static markup).
- Handlers injected at runtime via `innerHTML`/template strings, by file
  (`rg -c 'onclick=' static/js/`):
  - `game-render.js` (5), `account.js` (4), `admin.js` (4),
    `game-fetch.js` (4), `ev-table.js` (4), `mistake-card.js` (3),
    `trends-view.js` (3), `trends-analysis.js` (2).

The runtime ones are the harder half — they're string-built HTML, so each
needs the handler moved to a delegated `addEventListener` (often easiest as one
delegated listener per container keyed on `data-*` + `closest()`), not a
one-to-one `el.onclick =` rewrite.

## Plan (cheap → invasive)

1. **Convert `index.html`'s 22 static handlers** to `addEventListener` in the
   owning JS module (`main.js`/`ui.js` for shell controls). Low risk, no
   behaviour change. Do this first and measure — it may be the bulk.
2. **Convert the `innerHTML`-injected handlers** per feature file. Prefer
   event delegation on a stable parent with `data-action` attributes over
   re-binding after every render. Touch one file at a time; the
   categorize-bench isn't relevant here, but click-through each view.
3. **Report-Only canary.** Ship
   `Content-Security-Policy-Report-Only` with the strict `script-src` (no
   `'unsafe-inline'`) alongside the live permissive one, watch the console /
   a report endpoint for violations in real use, then flip the enforced header
   once it's clean. This catches anything the grep missed (third-party widgets,
   bookmarklets, dynamically set `javascript:` URLs).
4. **Drop `'unsafe-inline'` from the enforced `script-src`** in
   `nginx.conf.template` AND prod's live `nginx.conf`, reload nginx, verify.

## Secondary (separate, lower priority)

`style-src 'unsafe-inline'` is also present and is needed by inline `style=`
attributes (`templates/login.html`, `static/index.html`, and JS-built markup).
Inline styles can't be nonced either, so tightening style-src is its own
inventory + refactor. Lower payoff than script-src — leave for later.

## Effort / risk

Mechanical but broad: ~10 files, every interactive control must be
click-tested. The Report-Only canary (step 3) is what makes it safe to ship
without a full manual QA pass. No backend changes; nginx header edit is one
line in two places.
