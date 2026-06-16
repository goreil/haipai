// Browser bootstrap for the WASM shanten/ukeire kernel (on by default).
//
// The prep pipeline (static/js/prep/*) loads as classic UMD <script>s and runs
// on the main thread, but the riichi-tools-rs kernel ships as an ES module
// (static/wasm/haipai_shanten.js + a ~4.5 MB .wasm). This module is the async
// bridge: it lazily fetches + instantiates the kernel, exposes the named
// exports the adapter expects on `window.haipaiShantenWasm`, builds the adapter
// (static/js/prep/shanten_calc_wasm.js, which reads that global at load time),
// and finally flips `window.haipaiPrepUseWasm`. prep.js checks that flag at
// call time (see _resolveCalc there), so even while the async load is in flight
// the JS kernel serves every call, and any init failure leaves JS as the path.
//
// The kernel is enabled for everyone: by default we fetch + instantiate it.
// Opt OUT by either:
//   - visiting any page with ?wasm_shanten=0  (persisted to localStorage), or
//   - setting localStorage.haipai_wasm_shanten = "0" in devtools.
// Opt back in with ?wasm_shanten=1 or by clearing that key. While disabled
// nothing is fetched, so opted-out users never pay the 4.5 MB load cost.

(function () {
  const LS_KEY = "haipai_wasm_shanten";

  function readFlag() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("wasm_shanten")) {
        const on = params.get("wasm_shanten") === "1";
        try { window.localStorage.setItem(LS_KEY, on ? "1" : "0"); } catch (_) {}
        return on;
      }
      // On by default: only an explicit "0" opt-out disables the kernel.
      return window.localStorage.getItem(LS_KEY) !== "0";
    } catch (_) {
      // Storage unavailable (e.g. privacy mode) — still default to enabled.
      return true;
    }
  }

  function loadAdapter() {
    // Inject the UMD adapter only after window.haipaiShantenWasm is set; its
    // browser branch captures that global (and haipaiPrepShantenCalc) at load.
    return new Promise(function (resolve, reject) {
      if (window.haipaiPrepShantenCalcWasm) return resolve();
      const s = document.createElement("script");
      s.src = "/static/js/prep/shanten_calc_wasm.js";
      s.onload = function () {
        if (window.haipaiPrepShantenCalcWasm) resolve();
        else reject(new Error("adapter loaded but haipaiPrepShantenCalcWasm is unset"));
      };
      s.onerror = function () { reject(new Error("failed to load shanten_calc_wasm.js")); };
      document.head.appendChild(s);
    });
  }

  async function boot() {
    if (!readFlag()) return;
    try {
      const mod = await import("/static/wasm/haipai_shanten.js");
      await mod.default(); // derives the .wasm URL from this module's location
      window.haipaiShantenWasm = {
        shanten_from_text: mod.shanten_from_text,
        ukeire_from_text: mod.ukeire_from_text,
        full_discard_table: mod.full_discard_table,
      };
      await loadAdapter();
      window.haipaiPrepUseWasm = true;
      if (window.console && console.info) {
        console.info("[haipai] WASM shanten kernel active (?wasm_shanten=0 to disable)");
      }
    } catch (e) {
      // Never break prep: leave the JS kernel as the active path.
      window.haipaiPrepUseWasm = false;
      if (window.console && console.warn) {
        console.warn("[haipai] WASM shanten init failed; using JS kernel:", e);
      }
    }
  }

  boot();
})();
