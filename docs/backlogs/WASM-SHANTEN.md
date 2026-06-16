# WASM shanten/ukeire kernel (riichi-tools-rs) — status & findings

Status as of 2026-06-16. **Wired into the browser app and enabled by default for
all users** (was opt-in; flipped to default-on, JS remains the fallback).

## TL;DR

- Ported riichi-tools-rs's `fast_shanten` ukeire kernel to WASM and benchmarked it
  against our pure-JS `shanten_calc.calculate` (which is ~95% of trends wall time —
  see `docs`/memory `prep-profile-shanten-dominates`).
- **Speed: 11.1× faster end-to-end on real prep hands** (17.1 → 1.55 ms/call).
  Micro-bench (closed hands only) is 112×/call; the gap is the ~17% of calls that
  are open/melded hands and still fall back to JS.
- **Correctness: validated against the Python `mahjong` library as ground truth.**
  The WASM adapter matches GT on **1552/1552 real closed hands** (17,507 discard
  rows, 0 errors). It is *more* correct than today's production JS kernel.
- **Key finding: our JS kernel has a latent chiitoi bug.** Its deliberate chiitoi
  "kinds penalty" disagrees with ground truth on chiitoi-dense hands. This affects
  production categorization today, independent of the WASM work.

## Ground-truth verification (the important part)

Compared three kernels against Python `mahjong` (`.venv`, tested on millions of
games) over 8000 random 13-tile hands and 1552 real closed hands:

| kernel              | shanten errors vs GT | ukeire errors vs GT |
| ------------------- | -------------------- | ------------------- |
| our JS              | 2 / 8000 (chiitoi)   | 2 / 8000            |
| riichi **fast**     | **1 / 8000 (quad)**  | **1 / 8000 (quad)** |
| riichi slow         | 0 / 8000             | **425 / 8000**      |

- riichi **fast** = ground truth everywhere except a **concealed 4-of-a-kind**
  (it misreads a quad as not triplet+tanki). This is the only real bug.
- riichi **slow** has perfect shanten but a broken ukeire implementation — unusable.
- our **JS** over-penalizes chiitoi-dense hands (e.g. `1144888p22s5566z`: JS=1,
  GT=0). The `shanten.js` comment claiming this matches "upstream" is the wrong call.

Adapter strategy that follows from this: use riichi fast for everything, fall back
to JS **only** for concealed quads (where JS is GT-correct) and open hands (no WASM
meld support yet). No chiitoi fallback — riichi is right there.

## What was built

- **Submodule** `riichi-tools-rs/` → re-pointed to our fork
  `git@github.com:goreil/riichi-tools-rs.git` (vanilla, same commit `cc3eb9f`; no
  kernel edits — all our code is in the wrapper + adapter, so the fork is for
  supply-chain control only).
- **Wrapper crate** `wasm/haipai-shanten/` — cdylib, pins modern `wasm-bindgen`
  (the submodule's own lockfile pins a broken 0.2.70). Exposes `shanten_from_text`,
  `ukeire_from_text`, and `full_discard_table` (all-discards table in one native
  call — needed because downstream looks up arbitrary discards, not just best ones).
- **Adapter** `static/js/prep/shanten_calc_wasm.js` — drop-in for
  `shanten_calc.calculate` (same input/output contract), WASM fast path + the
  quad/open JS fallback above.

### Build

```bash
cd wasm/haipai-shanten
wasm-pack build --release --target nodejs                      # pkg/      (node tests/benches)
wasm-pack build --release --target web --out-dir pkg-web       # pkg-web/  (browser ESM)
# pkg-slow/ (default kernel, for GT testing) was built by temporarily dropping
# `features = ["fast_shanten"]` from Cargo.toml.
```

Requires `rustup` + `wasm-pack` (NOT in the base env; installed during this work).
The `.wasm` is ~4.4 MB (lookup tables) — a real load cost for the browser.

### Verification / benchmark scripts (all under `scripts/`)

- `wasm_shanten_verify.mjs` — shanten_test.txt gate (WASM vs JS vs expected)
- `wasm_shanten_bench.mjs` — micro-benchmark, closed hands (112×)
- `wasm_ukeire_parity.mjs` — WASM vs JS over real snapshot hands
- `wasm_adapter_parity.mjs` — adapter vs JS (note: JS-parity is NOT the right
  metric — JS itself is wrong on chiitoi; use the GT scripts instead)
- `wasm_adapter_bench.mjs` — end-to-end adapter speed on real hands (11.1×)
- `gt_compare_gen.mjs` + `gt_compare.py` — 3-way GT comparison, random 13-tile hands
- `gt_realhands_gen.mjs` + `gt_realhands.py` — GT comparison, real closed 14-tile hands

Ground-truth runs need the `.cache/category-stats/` snapshot and `.venv/bin/python`
(the `mahjong` package).

## Browser wiring — DONE (2026-06-16, enabled by default for everyone)

Wired the WASM kernel into the browser app. Originally shipped opt-in; on
2026-06-16 the `wasm-bootstrap.js` default was flipped so the kernel loads for
every user unless they explicitly opt out (`?wasm_shanten=0`, persisted to
`localStorage.haipai_wasm_shanten`). The JS kernel remains the fallback for
concealed quads, open hands, and any WASM init failure.

- **Served assets:** `static/wasm/haipai_shanten.js` (ESM glue) +
  `haipai_shanten_bg.wasm` (~4.5 MB). `static/` is the only Docker bind-mounted
  source dir, so the served copy must live there — the build tree
  `wasm/haipai-shanten/pkg-web/` is not a served path. Regenerate both with
  `scripts/wasm_build_web.sh` (rebuilds `--target web` and copies into
  `static/wasm/`). NOTE: `pkg-web` had been stale (built before
  `full_discard_table` was added); the script rebuilds it.
- **Bootstrap:** `static/js/prep/wasm-bootstrap.js` (loaded as
  `<script type="module">` right after `prep.js`). Enabled by default; reads the
  opt-out flag (`?wasm_shanten=0`, persisted to `localStorage.haipai_wasm_shanten`;
  `=1` to opt back in). While disabled it fetches nothing — opted-out users never
  pay the 4.5 MB load cost. When enabled it dynamic-imports the glue, awaits
  `init()`, sets `window.haipaiShantenWasm`, injects the UMD adapter
  (`shanten_calc_wasm.js`), then flips `window.haipaiPrepUseWasm`. Any failure
  falls back to JS without breaking prep.
- **prep.js** resolves the kernel at *call time* (`_resolveCalc`): WASM adapter
  when `haipaiPrepUseWasm` + adapter are present, else JS. So early calls (before
  the async bootstrap finishes) and the default all stay on JS.
- **Verified in-browser (puppeteer):** opt-in → WASM active, shanten matches JS
  across closed hands incl. the "winning form" throw; default/opt-out → no WASM
  global, no `.wasm` fetched, JS kernel intact. Node `wasm_adapter_parity.mjs`
  still 1868/1870 vs JS (the 2 residual = chiitoi cases where WASM is GT-correct).

## Remaining work (not done)

1. **Open-hand WASM support.** Mapping mjai melds → riichi meld notation would cut
   the fallback from ~17% to ~1% and push speed toward the full ~100×. Needs its
   own GT parity pass.
2. **Fix the quad bug in the fork** (fast_hand_calculator lookup tables) to remove
   the last correctness fallback. Deep but small.
3. **Independently fix the JS chiitoi formula** to match GT — this is a production
   correctness bug regardless of whether we adopt WASM.

## Open risks / notes

- 4.4 MB wasm load in the browser (lazy-load / cache).
- Open-hand JS fallback path is unverified vs GT (but it's what production uses
  today, so no regression; chiitoi can't be open, so the JS chiitoi bug can't hit
  the open-hand path).
