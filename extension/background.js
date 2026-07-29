// MV3 service worker.
//
// Owns the upload token and performs the cross-origin POST to haipai. Doing
// the POST here (under host_permissions) rather than in the content script
// bypasses CORS entirely — the extension stays working regardless of what
// haipai's CORS headers say — and keeps the token out of page context.
//
// The token is never logged, never returned to the content script, never put
// in a notification, and never placed in a URL.

"use strict";

const DEFAULT_BASE = "https://haipai.ylue.de";
const RETRY_DELAYS_MS = [1000, 4000, 10000]; // 3 retries after the first try
const DEDUPE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // mjai reports expire in 15 days

// 48x48 solid square; inlined so the extension keeps the spec's file layout.
const NOTIFY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAQ0lEQVR42u3PMQ0AAAgDMBRhdKLBAi9JjwpodTKflYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDA1QI751wt8YdmiQAAAABJRU5ErkJggg==";

// ------------------------------------------------------------------ storage

async function getSettings() {
  const s = await chrome.storage.local.get(["haipaiBase", "uploadToken"]);
  const base = String(s.haipaiBase || DEFAULT_BASE).trim().replace(/\/+$/, "");
  return { base, token: s.uploadToken || "" };
}

// Returns the dedupe map with expired entries dropped (and persists the prune).
async function getUploaded() {
  const { uploaded } = await chrome.storage.local.get("uploaded");
  const map = (uploaded && typeof uploaded === "object") ? uploaded : {};
  const cutoff = Date.now() - DEDUPE_TTL_MS;
  let pruned = false;
  for (const [k, v] of Object.entries(map)) {
    if (!v || typeof v.ts !== "number" || v.ts < cutoff) {
      delete map[k];
      pruned = true;
    }
  }
  if (pruned) await chrome.storage.local.set({ uploaded: map });
  return map;
}

async function rememberUpload(key, gameId) {
  const map = await getUploaded();
  map[key] = { gameId: gameId ?? null, ts: Date.now() };
  await chrome.storage.local.set({ uploaded: map });
}

// -------------------------------------------------------------- navigation

function gameUrl(base, gameId) {
  return base + (gameId ? "#g" + gameId : "/");
}

async function navigate(tabId, url) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.tabs.update(tabId, { url });
  } catch {
    // Tab closed while we were uploading — nothing to steer.
  }
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: NOTIFY_ICON,
      title,
      message, // callers pass fixed strings / HTTP status text only
    }, () => void chrome.runtime.lastError);
  } catch {
    // Notifications are best-effort; never fail an upload over them.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ upload

// Resolves to a result object safe to hand back to the page's content script:
// { ok, gameId } or { ok:false, error, retryable, needsOptions }.
async function handleUpload(key, report, tabId) {
  const { base, token } = await getSettings();

  if (!token) {
    notify("haipai upload", "No upload token configured. Open the extension options to set one.");
    return {
      ok: false,
      retryable: false,
      needsOptions: true,
      error: "No upload token configured — open the extension options and paste your haipai upload token.",
    };
  }

  const seen = await getUploaded();
  if (seen[key]) {
    await navigate(tabId, gameUrl(base, seen[key].gameId));
    return { ok: true, gameId: seen[key].gameId, deduped: true };
  }

  const body = JSON.stringify({ mortal_data: report });
  let lastError = "Upload failed.";

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let res, payload;
    try {
      res = await fetch(`${base}/api/games/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body,
      });
    } catch (e) {
      // Network-level failure — retryable.
      lastError = "Could not reach haipai: " + String((e && e.message) || e);
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      break;
    }

    payload = await res.json().catch(() => ({}));

    if (res.ok) {
      const gameId = payload && payload.game_id;
      await rememberUpload(key, gameId);
      await navigate(tabId, gameUrl(base, gameId));
      return { ok: true, gameId: gameId ?? null };
    }

    if (res.status === 401) {
      // Retrying a rejected token is pointless.
      notify("haipai upload failed", "Invalid or missing upload token — check the extension options.");
      return {
        ok: false,
        retryable: false,
        needsOptions: true,
        error: "Invalid or missing upload token — check extension options.",
      };
    }

    if (res.status >= 500) {
      lastError = `haipai returned HTTP ${res.status}` +
        (payload && payload.error ? `: ${payload.error}` : ".");
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      break;
    }

    // Other 4xx (e.g. 400 unparseable Mortal data) — a retry changes nothing.
    return {
      ok: false,
      retryable: false,
      error: `haipai rejected the upload (HTTP ${res.status})` +
        (payload && payload.error ? `: ${payload.error}` : "."),
    };
  }

  notify("haipai upload failed", lastError);
  return { ok: false, retryable: true, error: lastError };
}

// ----------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender && sender.tab && sender.tab.id;

  if (!msg || typeof msg !== "object") return;

  if (msg.type === "check") {
    (async () => {
      const [{ base, token }, seen] = await Promise.all([getSettings(), getUploaded()]);
      const hit = seen[msg.key];
      if (hit) {
        // Already uploaded: send the tab to the existing game, no refetch.
        await navigate(tabId, gameUrl(base, hit.gameId));
        sendResponse({ known: true, gameId: hit.gameId });
      } else {
        // `hasToken` is a boolean, never the token — it lets the content script
        // prompt for setup without first fetching a ~330 KB report it can't use.
        sendResponse({ known: false, hasToken: Boolean(token) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "upload") {
    (async () => {
      try {
        sendResponse(await handleUpload(msg.key, msg.report, tabId));
      } catch (e) {
        sendResponse({ ok: false, retryable: true, error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
