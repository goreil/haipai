// Background script. One file, two browsers.
//
// Chrome MV3 runs this as a service worker (manifest `background.service_worker`);
// Firefox MV3 has no service workers and runs it as a non-persistent event page
// (`background.scripts`). Both keys are in the manifest and each browser ignores
// the other's, so nothing here may assume a ServiceWorkerGlobalScope — no
// `self.skipWaiting`, no `oninstall`, no `clients`. Plain fetch + timers only,
// which is all this needs.
//
// Performs the cross-origin POST to haipai. Doing it here (under
// host_permissions) rather than in the content script bypasses CORS entirely —
// the extension keeps working regardless of what haipai's CORS headers say.
//
// Auth is haipai's ordinary session cookie: the browser attaches a SameSite=Lax
// cookie to fetches from a background context that holds host permissions for
// the target, so "signed in" here means nothing more than "logged in to haipai
// in this browser". The extension holds no credential of its own — nothing to
// store, nothing to leak, nothing to revoke. Logging out of haipai logs out the
// uploader with it.

"use strict";

// Firefox exposes the promise-based `browser`; Chrome only `chrome`, whose MV3
// APIs are promise-based too. Preferring `browser` means every call below is
// awaitable in both browsers, so there is one code path and no callback shims.
const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULT_BASE = "https://haipai-trainer.com";
// The old domain is being phased out. Its /api/* still answers, so an install
// that never got updated keeps uploading — but anything still carrying the old
// default in storage is moved to the canonical domain once, here. A base the
// user typed for a self-hosted instance is left alone.
const LEGACY_BASE = "https://haipai.ylue.de";
const RETRY_DELAYS_MS = [1000, 4000, 10000]; // 3 retries after the first try
const DEDUPE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // mjai reports expire in 15 days

// A packaged file, not a data: URL — Firefox refuses data: notification icons.
const NOTIFY_ICON = "icons/icon-48.png";

// ------------------------------------------------------------------ storage

async function getBase() {
  const s = await ext.storage.local.get("haipaiBase");
  const base = String(s.haipaiBase || DEFAULT_BASE).trim().replace(/\/+$/, "");
  if (base !== LEGACY_BASE) return base;
  await ext.storage.local.set({ haipaiBase: DEFAULT_BASE });
  return DEFAULT_BASE;
}

// Returns the dedupe map with expired entries dropped (and persists the prune).
async function getUploaded() {
  const { uploaded } = await ext.storage.local.get("uploaded");
  const map = (uploaded && typeof uploaded === "object") ? uploaded : {};
  const cutoff = Date.now() - DEDUPE_TTL_MS;
  let pruned = false;
  for (const [k, v] of Object.entries(map)) {
    if (!v || typeof v.ts !== "number" || v.ts < cutoff) {
      delete map[k];
      pruned = true;
    }
  }
  if (pruned) await ext.storage.local.set({ uploaded: map });
  return map;
}

async function rememberUpload(key, gameId) {
  const map = await getUploaded();
  map[key] = { gameId: gameId ?? null, ts: Date.now() };
  await ext.storage.local.set({ uploaded: map });
}

// -------------------------------------------------------------- permissions

// Firefox MV3 treats host permissions as revocable, and a *temporarily* loaded
// extension (about:debugging) starts with none granted at all — so the upload
// fetch would fail as an opaque network error. Checking first lets the UI say
// "grant access" instead of "could not reach haipai". Chrome grants
// host_permissions at install and this is always true there.
async function hasHostAccess(base) {
  try {
    return await ext.permissions.contains({ origins: [base + "/*"] });
  } catch {
    return true; // API unavailable — don't invent a blocker
  }
}

// -------------------------------------------------------------- navigation

function gameUrl(base, gameId) {
  return base + (gameId ? "#g" + gameId : "/");
}

async function navigate(tabId, url) {
  if (typeof tabId !== "number") return;
  try {
    await ext.tabs.update(tabId, { url });
  } catch {
    // Tab closed while we were uploading — nothing to steer.
  }
}

function notify(title, message) {
  try {
    const p = ext.notifications.create({
      type: "basic",
      iconUrl: ext.runtime.getURL(NOTIFY_ICON),
      title,
      message, // callers pass fixed strings / HTTP status text only
    });
    // Firefox returns a promise; an unhandled rejection here must not surface.
    if (p && typeof p.catch === "function") p.catch(() => {});
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
  if (!(await hasHostAccess(base))) {
    return { base, signedIn: false, needsPermission: true };
  }
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
    await ext.tabs.create({ url: `${base}/login`, active: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Could not open the haipai login page." };
  }
}

// ------------------------------------------------------------------ upload

// Resolves to a result object safe to hand back to the page's content script:
// { ok, gameId } or { ok:false, error, retryable, needsSignIn, needsPermission }.
async function handleUpload(key, report, tabId) {
  const base = await getBase();

  const seen = await getUploaded();
  if (seen[key]) {
    await navigate(tabId, gameUrl(base, seen[key].gameId));
    return { ok: true, gameId: seen[key].gameId, deduped: true };
  }

  if (!(await hasHostAccess(base))) {
    return {
      ok: false,
      retryable: false,
      needsPermission: true,
      error: `The extension has no access to ${base} yet.`,
    };
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

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
      const { signedIn, needsPermission } = await whoami();
      sendResponse({ known: false, signedIn, needsPermission });
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
      if (!(await hasHostAccess(base))) {
        sendResponse({ needsPermission: true, base });
        return;
      }
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
    ext.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
