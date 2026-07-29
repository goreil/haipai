// Options page. The only thing it stores is { haipaiBase }.
//
// There is no credential to manage: the extension uploads under the haipai
// session cookie of whoever is logged in to haipai in this browser. The page
// asks the worker for the session state, since only the worker can reach
// haipai cross-origin.

"use strict";

const DEFAULT_BASE = "https://haipai.ylue.de";

const $ = (id) => document.getElementById(id);
const baseEl = $("base");
const stateEl = $("authState");
const statusEl = $("status");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || "";
}

function normalizeBase(v) {
  return String(v || "").trim().replace(/\/+$/, "");
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: "No response from the extension." });
    });
  });
}

async function load() {
  const s = await chrome.storage.local.get("haipaiBase");
  baseEl.value = normalizeBase(s.haipaiBase) || DEFAULT_BASE;

  const status = await send({ type: "status" });
  const signedIn = Boolean(status && status.signedIn);
  stateEl.textContent = signedIn
    ? (status.account ? `logged in as ${status.account}` : "logged in")
    : (status && status.unreachable ? "haipai unreachable" : "not logged in");
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

  await chrome.storage.local.set({ haipaiBase: base });
  await load();
  setStatus("Saved.", "ok");
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
