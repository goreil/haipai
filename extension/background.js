// MV3 service worker.
//
// Owns the account credential and performs the cross-origin POST to haipai.
// Doing the POST here (under host_permissions) rather than in the content
// script bypasses CORS entirely — the extension stays working regardless of
// what haipai's CORS headers say — and keeps the credential out of page
// context.
//
// Auth is a per-install token obtained by signing in to haipai (see signIn()),
// not a token the user copies by hand. It is never logged, never returned to
// the content script, never put in a notification, and never placed in a URL.

"use strict";

const DEFAULT_BASE = "https://haipai.ylue.de";
const RETRY_DELAYS_MS = [1000, 4000, 10000]; // 3 retries after the first try
const DEDUPE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // mjai reports expire in 15 days

// 48x48 solid square; inlined so the extension keeps the spec's file layout.
const NOTIFY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAQ0lEQVR42u3PMQ0AAAgDMBRhdKLBAi9JjwpodTKflYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDA1QI751wt8YdmiQAAAABJRU5ErkJggg==";

// ------------------------------------------------------------------ storage

async function getSettings() {
  const s = await chrome.storage.local.get(["haipaiBase", "authToken", "account", "uploadToken"]);
  const base = String(s.haipaiBase || DEFAULT_BASE).trim().replace(/\/+$/, "");
  // `uploadToken` is the pre-1.1 hand-pasted bookmarklet token. The upload
  // endpoint still accepts it, so an existing install keeps working until the
  // user signs in; new installs only ever have `authToken`.
  return { base, token: s.authToken || s.uploadToken || "", account: s.account || "" };
}

async function clearAuth() {
  await chrome.storage.local.remove(["authToken", "account", "uploadToken"]);
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

// Signs in by opening haipai's own authorize page in a browser window. The
// user logs in there exactly as they normally would — password, Discord, or
// Google — which is why the extension asks for no credentials of its own:
// most haipai accounts are OAuth and have no password to type.
//
// launchWebAuthFlow only ever resolves to https://<extension-id>.chromiumapp.org/,
// a URL nothing but this extension can receive, and the token arrives in the
// fragment, so it never reaches a server log.
async function signIn() {
  const { base } = await getSettings();
  const redirectUri = chrome.identity.getRedirectURL();
  // Binds this response to this request — a stale or injected callback with
  // the wrong state is discarded rather than stored.
  const state = crypto.randomUUID();
  const authUrl =
    `${base}/extension/authorize` +
    `?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  let resultUrl;
  try {
    resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch (e) {
    // Includes the user simply closing the window.
    return { ok: false, error: "Sign-in was cancelled." };
  }
  if (!resultUrl) return { ok: false, error: "Sign-in was cancelled." };

  let params;
  try {
    params = new URLSearchParams(new URL(resultUrl).hash.slice(1));
  } catch {
    return { ok: false, error: "Could not read the sign-in response." };
  }

  if (params.get("state") !== state) {
    return { ok: false, error: "Sign-in response did not match the request. Try again." };
  }
  if (params.get("error")) {
    return { ok: false, error: "Sign-in was declined." };
  }
  const token = params.get("token");
  if (!token) return { ok: false, error: "Sign-in did not return a credential." };

  const account = params.get("username") || "";
  // Drop any legacy hand-pasted token so there is exactly one credential.
  await chrome.storage.local.remove("uploadToken");
  await chrome.storage.local.set({ authToken: token, account });
  return { ok: true, account };
}

// Best-effort server-side revoke, then forget the credential locally. The
// local clear happens regardless — a user who clicks Disconnect offline must
// still end up disconnected.
async function signOut() {
  const { base, token } = await getSettings();
  if (token) {
    try {
      await fetch(`${base}/api/extension/revoke`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
    } catch {
      // Offline or unreachable — the local clear below still applies.
    }
  }
  await clearAuth();
  return { ok: true };
}

// ------------------------------------------------------------------ upload

// Resolves to a result object safe to hand back to the page's content script:
// { ok, gameId } or { ok:false, error, retryable, needsOptions }.
async function handleUpload(key, report, tabId) {
  const { base, token } = await getSettings();

  if (!token) {
    notify("haipai upload", "Not signed in to haipai. Sign in to upload this review.");
    return {
      ok: false,
      retryable: false,
      needsSignIn: true,
      error: "Not signed in to haipai.",
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
      // The credential was revoked (from Account, or by signing out in another
      // browser). Drop it so the UI offers a fresh sign-in rather than
      // retrying something the server has already rejected.
      await clearAuth();
      notify("haipai upload failed", "Your haipai connection expired — sign in again.");
      return {
        ok: false,
        retryable: false,
        needsSignIn: true,
        error: "Your haipai connection is no longer valid — sign in again.",
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
        // `signedIn` is a boolean, never the token — it lets the content script
        // prompt for sign-in without first fetching a ~330 KB report it can't use.
        sendResponse({ known: false, signedIn: Boolean(token) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "signIn") {
    (async () => {
      try {
        sendResponse(await signIn());
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "signOut") {
    (async () => sendResponse(await signOut()))();
    return true; // async response
  }

  // Connection test for the options page. Runs here rather than there so the
  // credential stays inside the worker; the page only sees status + body.
  if (msg.type === "test") {
    (async () => {
      const { base, token } = await getSettings();
      if (!token) {
        sendResponse({ error: "Not connected — sign in first." });
        return;
      }
      try {
        const res = await fetch(`${base}/api/games/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ mortal_data: {} }),
        });
        const payload = await res.json().catch(() => ({}));
        if (res.status === 401) await clearAuth();
        sendResponse({ status: res.status, body: (payload && payload.error) || "" });
      } catch (e) {
        sendResponse({ error: "Could not reach " + base + ": " + String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "status") {
    (async () => {
      const { base, token, account } = await getSettings();
      sendResponse({ base, signedIn: Boolean(token), account });
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
