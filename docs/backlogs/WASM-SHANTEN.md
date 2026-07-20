# WASM shanten/ukeire kernel (riichi-tools-rs) — status & findings

Status as of 2026-07-20. **Wired into the browser app and enabled by default for
all users**, now including open (melded) hands (was opt-in, closed-hand-only;
flipped to default-on 2026-06-16, melds added 2026-07-20). JS remains the
fallback for the specific shapes below.

## TL;DR

- Ported riichi-tools-rs's `fast_shanten` ukeire kernel to WASM and benchmarked it
  against our pure-JS `shanten_calc.calculate` (which is ~95% of trends wall time —
  see `docs`/memory `prep-profile-shanten-dominates`).
- **Speed: 31.8× faster end-to-end on real prep hands** (17.7 → 0.56 ms/call),
  up from the earlier 11.1× once open hands stopped falling back to JS.
  Micro-bench (closed hands only) is 112×/call.
- **Correctness: validated against the Python `mahjong` library as ground truth.**
  The WASM adapter matches GT on **1552/1552 real closed hands** (17,507 discard
  rows, 0 errors) and, after the open-hand work below, **0 shanten/best-discard
  mismatches over 1328 real open hands** (small residual on deep-shanten ukeire
  lists only — see "Open-hand support").
- **Key finding: our JS kernel has a latent chiitoi bug.** Its deliberate chiitoi
  "kinds penalty" disagrees with ground truth on chiitoi-dense hands. This affects
  production categorization today, independent of the WASM work.
- **Key finding (2026-07-20): riichi-tools-rs's fast kernel has a latent honor-tile
  bug**, independent of anything we built — see "Open-hand support" below.

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
to JS **only** for concealed quads (where JS is GT-correct) and the open-hand
shapes documented below. No chiitoi fallback — riichi is right there.

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
  quad/honor-shape JS fallbacks below.

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
- `wasm_adapter_bench.mjs` — end-to-end adapter speed on real hands (31.8×)
- `gt_compare_gen.mjs` + `gt_compare.py` — 3-way GT comparison, random 13-tile hands
- `gt_realhands_gen.mjs` + `gt_realhands.py` — GT comparison, real closed 14-tile hands

Ground-truth runs need the `.cache/category-stats/` snapshot and `.venv/bin/python`
(the `mahjong` package).

## Browser wiring — DONE (2026-06-16, enabled by default for everyone)

Wired the WASM kernel into the browser app. Originally shipped opt-in; on
2026-06-16 the `wasm-bootstrap.js` default was flipped so the kernel loads for
every user unless they explicitly opt out (`?wasm_shanten=0`, persisted to
`localStorage.haipai_wasm_shanten`). The JS kernel remains the fallback for
concealed quads, the open-hand honor shapes documented below, and any WASM
init failure.

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

## Open-hand support — DONE (2026-07-20)

Melds were never a real limitation of riichi-tools-rs's fast kernel — `Hand`
already models open shapes (chi/pon/kan) and closed ankan natively
(`HandCalculator::init` walks `get_open_shapes()` + closed `Kantsu` shapes),
and `Hand::from_text` already had a bracket grammar for melds
(`(345p0)` chi, `(p5m1)` pon, `(k5m1)` open kan, `(k5m)` closed kan, `(s5m1)`
added kan). The WASM wrapper (`wasm/haipai-shanten/src/lib.rs`) just never
exposed a way to pass melds in from JS.

- **`full_discard_table`** now takes concealed-only candidate discards
  (`get_34_array(true)`) and builds each 13-tile sub-hand via
  `hand.clone()` + `remove_tile()` — this keeps the meld shapes attached
  (`remove_tile` already refuses to touch `is_open`/`is_kan` tiles), unlike the
  old approach of flattening the hand back down to a raw tile list. `Rust`
  sanity tests in the same file (`sanity_tests` module) cover: a pon completing
  a hand, a closed ankan completing a hand, and melded tiles never appearing as
  a discard candidate.
- **`static/js/prep/shanten_calc_wasm.js`** encodes Haipai's mjai fuuro objects
  (`{type, pai, consumed, target, ...}` — pon/chi/ankan/daiminkan/kakan) into
  riichi-tools-rs bracket text (`_meld_to_bracket`). Which opponent a meld was
  called from, and which physical tile within a chi/pon was the called one,
  don't affect shanten/ukeire, so those bracket fields use fixed placeholders.
  This is a faithful per-tile calculation, not the old JS kernel's
  virtual-complete-meld-count trick (see `lib/shanten.py`'s comment on the
  Python `mahjong` library's own `init_mentsu` approximation, which the GT
  scripts below still rely on for verification).

### Found bug: riichi-tools-rs's honor-tile classifier is unreliable on melds

`HandCalculator` tracks all 7 honor kinds' combined shanten contribution
through **one shared scalar state machine** (`ProgressiveHonorClassifier`).
Concealed honor **draws** compose on it correctly regardless of how many
distinct kinds are involved (this is exactly the path the 1552-closed-hand GT
run already validated). But its **pon()/shouminkan() transitions** — fired
whenever a pon, kakan, or daiminkan lands on an honor tile — carry no notion
of *which* honor value they're for, and silently corrupt that shared state
once a second distinct honor kind touches the hand alongside a honor meld.
Confirmed by hand-built repros checked against the Python `mahjong` library
as ground truth (not a JS-encoding bug on our side):

- closed `666m` + `pon(E)` + `pon(S)` — a verifiably-tenpai hand — reports
  shanten **2** instead of **0**. `kakan(honor) + ankan(different honor)`
  returns outright nonsense (shanten 8, or -1 for a hand that isn't a win).
- **one** honor meld (e.g. `pon(F)`) + **two** distinct concealed honor kinds
  (e.g. lone `P` and `C`): the shanten value stays correct, but ukeire quietly
  drops one of the two honors as an accepting tile.
- a **lone kakan** (added kan) on an honor tile is broken even by itself — a
  kakan is `pon()` then `shouminkan()` internally, i.e. two hits to the shared
  FSM from a single meld.
- one honor meld + **at most one** other distinct honor kind anywhere else in
  the hand (the common single-yakuhai-pon case) is fine — GT-verified.

This is upstream behavior in the vendored `riichi-tools-rs` fork, not
something introduced by our wrapper, and it's reported nowhere in the
project. Rather than patch the fork's opaque lookup-table FSM blind, we
scoped a fallback around exactly the broken shapes:
`_needs_js_fallback_for_melds` in `shanten_calc_wasm.js` routes to JS whenever
any meld is a kakan on an honor tile, or whenever more than one distinct
honor kind (across melds + concealed tiles combined) is present alongside at
least one honor meld.

Verified via `scripts/wasm_adapter_parity.mjs`-style replay against real
production hands (1328 open hands sampled): **0 shanten differences, 0
best-discard differences** after the fallback landed (down from 25 and 11
respectively before it). A small residual remains — 10 hands with a
`necessary_count` difference and 16 with only the ukeire tile *list* differing
— confined to deep-shanten (3-4 away) rows where shanten and best-discard both
still match; spot-checked and found benign (a tile listed by JS at wall-count
0 that WASM omits, or vice versa, never changing the resulting shanten). Same
tolerance the closed-hand path already documents for dense multi-pair shapes.

## Remaining work (not done)

1. **Fix the quad bug in the fork** (fast_hand_calculator lookup tables) to remove
   the concealed-quad correctness fallback. Deep but small.
2. **Fix the honor-classifier bug in the fork**, or report it upstream, to remove
   the open-hand honor-shape fallback above. Also deep — the FSM's lookup tables
   are opaque and untested for multi-honor-meld combinations upstream.
3. **Independently fix the JS chiitoi formula** to match GT — this is a production
   correctness bug regardless of whether we adopt WASM.

## Open risks / notes

- 4.4 MB wasm load in the browser (lazy-load / cache).
- The residual open-hand ukeire-list mismatch documented above (deep-shanten,
  non-consequential) is left to the caller's correctness tolerance, same as
  the pre-existing closed-hand dense-multi-pair note.
