// MV3 service worker.
//
// Performs the cross-origin POST to haipai. Doing it here (under
// host_permissions) rather than in the content script bypasses CORS entirely —
// the extension keeps working regardless of what haipai's CORS headers say.
//
// Auth is haipai's ordinary session cookie: Chrome attaches a SameSite=Lax
// cookie to fetches from a worker that holds host permissions for the target,
// so "signed in" here means nothing more than "logged in to haipai in this
// browser". The extension holds no credential of its own — nothing to store,
// nothing to leak, nothing to revoke. Logging out of haipai logs out the
// uploader with it.

"use strict";

const DEFAULT_BASE = "https://haipai.ylue.de";
const RETRY_DELAYS_MS = [1000, 4000, 10000]; // 3 retries after the first try
const DEDUPE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // mjai reports expire in 15 days

// 48x48 solid square; inlined so the extension keeps the spec's file layout.
const NOTIFY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAQ0lEQVR42u3PMQ0AAAgDMBRhdKLBAi9JjwpodTKflYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDA1QI751wt8YdmiQAAAABJRU5ErkJggg==";

// ------------------------------------------------------------------ storage

async function getBase() {
  const s = await chrome.storage.local.get("haipaiBase");
  return String(s.haipaiBase || DEFAULT_BASE).trim().replace(/\/+$/, "");
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

// ------------------------------------------------------------------- login

// Whether this browser has a live haipai session. /api/me is @login_required
// and answers 401 when logged out, so it doubles as the session probe and the
// source of the account name shown in the UI.
async function whoami() {
  const base = await getBase();
  try {
    const res = await fetch(`${base}/api/me`, { credentials: "include" });
    if (!res.ok) return { base, signedIn: false };
    const me = await res.json().catch(() => ({}));
    return { base, signedIn: true, account: (me && me.username) || "" };
  } catch (e) {
    return { base, signedIn: false, unreachable: true };
  }
}

// There is no extension-side sign-in: the user logs in to haipai itself, in a
// normal tab, exactly as they always do — password, Discord, or Google. All we
// do is open the page.
async function openLogin() {
  const base = await getBase();
  try {
    await chrome.tabs.create({ url: `${base}/login`, active: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Could not open the haipai login page." };
  }
}

// ------------------------------------------------------------------ upload

// Resolves to a result object safe to hand back to the page's content script:
// { ok, gameId } or { ok:false, error, retryable, needsSignIn }.
async function handleUpload(key, report, tabId) {
  const base = await getBase();

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
        // The entire authentication story: send haipai's session cookie.
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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
      // The haipai session expired, or the user logged out. Retrying is
      // pointless until they log back in.
      notify("haipai upload failed", "You're signed out of haipai — log in and retry.");
      return {
        ok: false,
        retryable: false,
        needsSignIn: true,
        error: "You're not signed in to haipai.",
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
      const [base, seen] = await Promise.all([getBase(), getUploaded()]);
      const hit = seen[msg.key];
      if (hit) {
        // Already uploaded: send the tab to the existing game, no refetch.
        await navigate(tabId, gameUrl(base, hit.gameId));
        sendResponse({ known: true, gameId: hit.gameId });
        return;
      }
      // Probe the session before fetching a ~330 KB report we couldn't send.
      const { signedIn } = await whoami();
      sendResponse({ known: false, signedIn });
    })();
    return true; // async response
  }

  if (msg.type === "openLogin") {
    (async () => sendResponse(await openLogin()))();
    return true; // async response
  }

  // Connection test for the options page.
  if (msg.type === "test") {
    (async () => {
      const base = await getBase();
      try {
        const res = await fetch(`${base}/api/games/upload`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mortal_data: {} }),
        });
        const payload = await res.json().catch(() => ({}));
        sendResponse({ status: res.status, body: (payload && payload.error) || "" });
      } catch (e) {
        sendResponse({ error: "Could not reach " + base + ": " + String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "status") {
    (async () => sendResponse(await whoami()))();
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
