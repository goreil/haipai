// Options page. Stores { haipaiBase, uploadToken } in chrome.storage.local.
//
// The stored token is never written back into the DOM — the page only ever
// shows whether one is set. The token input is write-only from the page's
// point of view: what you type is what gets saved.

"use strict";

const DEFAULT_BASE = "https://haipai.ylue.de";

const $ = (id) => document.getElementById(id);
const baseEl = $("base");
const tokenEl = $("token");
const stateEl = $("tokenState");
const statusEl = $("status");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || "";
}

function normalizeBase(v) {
  return String(v || "").trim().replace(/\/+$/, "");
}

async function load() {
  const s = await chrome.storage.local.get(["haipaiBase", "uploadToken"]);
  baseEl.value = normalizeBase(s.haipaiBase) || DEFAULT_BASE;
  // Deliberately not `tokenEl.value = s.uploadToken` — indicator only.
  stateEl.textContent = s.uploadToken ? "token is set" : "no token saved";
}

$("toggle").addEventListener("click", () => {
  const showing = tokenEl.type === "text";
  tokenEl.type = showing ? "password" : "text";
  $("toggle").textContent = showing ? "Show" : "Hide";
});

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

  const update = { haipaiBase: base };
  const typed = tokenEl.value.trim();
  if (typed) update.uploadToken = typed;

  await chrome.storage.local.set(update);
  tokenEl.value = "";
  tokenEl.type = "password";
  $("toggle").textContent = "Show";
  await load();
  setStatus(typed ? "Saved. Token updated." : "Saved. Existing token kept.", "ok");
});

$("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("uploadToken");
  tokenEl.value = "";
  await load();
  setStatus("Stored token cleared.", "ok");
});

// Sends a deliberately empty payload. A valid token gets past auth and is then
// rejected by the endpoint's own validation (400) — that 400 is the success
// signal here, and it distinguishes a good token from 401 "Invalid upload token".
$("test").addEventListener("click", async () => {
  const base = normalizeBase(baseEl.value) || DEFAULT_BASE;
  const typed = tokenEl.value.trim();
  const stored = (await chrome.storage.local.get("uploadToken")).uploadToken || "";
  const token = typed || stored;
  if (!token) {
    setStatus("No token to test — paste one above (or save it first).", "err");
    return;
  }

  setStatus("Testing…");
  let res, payload;
  try {
    res = await fetch(`${base}/api/games/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ mortal_data: {} }),
    });
  } catch (e) {
    setStatus("Could not reach " + base + ": " + String((e && e.message) || e), "err");
    return;
  }
  payload = await res.json().catch(() => ({}));
  const detail = payload && payload.error ? ` — ${payload.error}` : "";

  if (res.status === 401) {
    setStatus(`HTTP 401${detail}. The token was rejected.`, "err");
  } else if (res.status === 400) {
    setStatus(`HTTP 400${detail}. Token accepted — the empty test payload is ` +
              `supposed to be rejected. You're good to go.`, "ok");
  } else if (res.ok) {
    setStatus(`HTTP ${res.status}. Token accepted.`, "ok");
  } else {
    setStatus(`HTTP ${res.status}${detail}.`, "err");
  }
});

load();
