// Options page. Stores { haipaiBase } plus the credential obtained by signing
// in to haipai.
//
// The credential itself is owned by the service worker and is never read into
// this page — the page only ever asks whether one exists and who it belongs
// to. Sign-in is delegated to the worker too, since only it holds the identity
// API.

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
    ? (status.account ? `connected as ${status.account}` : "connected")
    : "not connected";
  $("signin").textContent = signedIn ? "Sign in again" : "Sign in to haipai";
  $("signout").hidden = !signedIn;
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

$("signin").addEventListener("click", async () => {
  setStatus("Waiting for sign-in…");
  const res = await send({ type: "signIn" });
  await load();
  if (res && res.ok) {
    setStatus(res.account ? `Connected as ${res.account}.` : "Connected.", "ok");
  } else {
    setStatus((res && res.error) || "Sign-in failed.", "err");
  }
});

$("signout").addEventListener("click", async () => {
  await send({ type: "signOut" });
  await load();
  setStatus("Disconnected. This browser can no longer upload.", "ok");
});

// Sends a deliberately empty payload. A working connection gets past auth and
// is then rejected by the endpoint's own validation (400) — that 400 is the
// success signal here, and it distinguishes a live connection from a 401.
$("test").addEventListener("click", async () => {
  const status = await send({ type: "status" });
  if (!status || !status.signedIn) {
    setStatus("Not connected — sign in first.", "err");
    return;
  }

  setStatus("Testing…");
  const res = await send({ type: "test" });
  if (!res || res.error) {
    setStatus((res && res.error) || "Test failed.", "err");
    return;
  }
  const detail = res.body ? ` — ${res.body}` : "";
  if (res.status === 401) {
    setStatus(`HTTP 401${detail}. The connection was rejected — sign in again.`, "err");
    await load();
  } else if (res.status === 400) {
    setStatus(`HTTP 400${detail}. Connection accepted — the empty test payload is ` +
              `supposed to be rejected. You're good to go.`, "ok");
  } else if (res.status >= 200 && res.status < 300) {
    setStatus(`HTTP ${res.status}. Connection accepted.`, "ok");
  } else {
    setStatus(`HTTP ${res.status}${detail}.`, "err");
  }
});

load();
