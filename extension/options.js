// Options page. The only thing it stores is { haipaiBase }.
//
// There is no credential to manage: the extension uploads under the haipai
// session cookie of whoever is logged in to haipai in this browser. The page
// asks the background script for the session state, since only it can reach
// haipai cross-origin.
//
// It is also the only place host access can be granted: permissions.request()
// requires an extension page and a real user gesture, so a content script
// cannot do it (see promptPermission in content.js).

"use strict";

// Firefox exposes the promise-based `browser`; Chrome only `chrome`, whose MV3
// APIs are promise-based too. One namespace, one code path, no shims.
const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULT_BASE = "https://haipai.ylue.de";
const MJAI_ORIGIN = "https://mjai.ekyu.moe/*";

const $ = (id) => document.getElementById(id);
const baseEl = $("base");
const stateEl = $("authState");
const permEl = $("permState");
const statusEl = $("status");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || "";
}

function normalizeBase(v) {
  return String(v || "").trim().replace(/\/+$/, "");
}

// The origins the extension needs: the report page it reads, and the haipai
// host it POSTs to.
function neededOrigins() {
  const base = normalizeBase(baseEl.value) || DEFAULT_BASE;
  return [MJAI_ORIGIN, base + "/*"];
}

async function send(msg) {
  try {
    const res = await ext.runtime.sendMessage(msg);
    return res || { ok: false, error: "No response from the extension." };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function hasAllOrigins() {
  try {
    return await ext.permissions.contains({ origins: neededOrigins() });
  } catch {
    return true; // API unavailable — don't invent a blocker
  }
}

async function load() {
  const s = await ext.storage.local.get("haipaiBase");
  baseEl.value = normalizeBase(s.haipaiBase) || DEFAULT_BASE;

  const granted = await hasAllOrigins();
  permEl.textContent = granted ? "granted" : "not granted";
  $("grant").disabled = granted;

  const status = await send({ type: "status" });
  const signedIn = Boolean(status && status.signedIn);
  stateEl.textContent = signedIn
    ? (status.account ? `logged in as ${status.account}` : "logged in")
    : (status && status.needsPermission ? "needs host access"
      : status && status.unreachable ? "haipai unreachable" : "not logged in");
  $("login").textContent = signedIn ? "Open haipai" : "Open haipai login";
}

$("save").addEventListener("click", async () => {
  const base = normalizeBase(baseEl.value) || DEFAULT_BASE;
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    setStatus("That base URL is not a valid URL.", "err");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    setStatus("Use an https:// URL (or localhost for development).", "err");
    return;
  }

  await ext.storage.local.set({ haipaiBase: base });
  await load();
  setStatus("Saved.", "ok");
});

// Firefox requires permissions.request() to be called synchronously from a
// user-input handler — awaiting anything first discards the gesture and the
// call is rejected. So this handler does no awaiting before the request.
$("grant").addEventListener("click", () => {
  let req;
  try {
    req = ext.permissions.request({ origins: neededOrigins() });
  } catch (e) {
    setStatus("Could not request access: " + String((e && e.message) || e), "err");
    return;
  }
  Promise.resolve(req).then(async (granted) => {
    await load();
    if (granted) {
      setStatus("Host access granted.", "ok");
    } else {
      // Either the user declined, or the origin is not in the manifest at all.
      setStatus("Access was not granted. Note that an origin can only be " +
                "requested if it is listed in host_permissions in " +
                "manifest.json — a custom haipai host has to be added there " +
                "first.", "err");
    }
  }).catch((e) => {
    setStatus("Could not request access: " + String((e && e.message) || e), "err");
  });
});

$("login").addEventListener("click", async () => {
  const res = await send({ type: "openLogin" });
  if (res && res.ok) {
    setStatus("Log in in the tab that just opened, then re-check here.");
  } else {
    setStatus((res && res.error) || "Could not open haipai.", "err");
  }
});

$("recheck").addEventListener("click", async () => {
  await load();
  setStatus("");
});

// Sends a deliberately empty payload. A live session gets past auth and is
// then rejected by the endpoint's own validation (400) — that 400 is the
// success signal here, and it distinguishes a working session from a 401.
$("test").addEventListener("click", async () => {
  setStatus("Testing…");
  const res = await send({ type: "test" });
  if (!res || res.error) {
    setStatus((res && res.error) || "Test failed.", "err");
    return;
  }
  if (res.needsPermission) {
    setStatus(`No host access to ${res.base} — press "Grant access" first.`, "err");
    await load();
    return;
  }
  const detail = res.body ? ` — ${res.body}` : "";
  if (res.status === 401) {
    setStatus(`HTTP 401${detail}. Not logged in to haipai in this browser.`, "err");
    await load();
  } else if (res.status === 400) {
    setStatus(`HTTP 400${detail}. Session accepted — the empty test payload is ` +
              `supposed to be rejected. You're good to go.`, "ok");
  } else if (res.status >= 200 && res.status < 300) {
    setStatus(`HTTP ${res.status}. Session accepted.`, "ok");
  } else {
    setStatus(`HTTP ${res.status}${detail}.`, "err");
  }
});

load();
