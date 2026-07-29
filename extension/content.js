// Content script for https://mjai.ekyu.moe/killerducky/*
//
// Resolves the ?data= report URL, fetches the report JSON same-origin, and
// hands the parsed object to the service worker, which performs the
// cross-origin POST to haipai under the user's haipai session cookie.
//
// It also never touches the mjai submit form: the only network request it
// makes is the same-origin GET of the report JSON validated below.

(() => {
  "use strict";

  // ---------------------------------------------------------------- toast

  // Non-blocking status bubble. alert() is forbidden here: the tab is about
  // to be navigated away by the worker, and a modal would stall that.
  let toastRoot = null;
  let toastBody = null;

  function ensureToast() {
    if (toastRoot && document.documentElement.contains(toastRoot)) return;
    toastRoot = document.createElement("div");
    toastRoot.id = "haipai-uploader-toast";
    // Shadow DOM so the host page's CSS cannot restyle or hide the toast.
    const shadow = toastRoot.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .box {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        max-width: 340px; padding: 12px 14px; border-radius: 8px;
        background: #1e2430; color: #e8edf5; border: 1px solid #38445a;
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 6px 20px rgba(0,0,0,.35);
      }
      .box.err { border-color: #a33; }
      .box.ok  { border-color: #3a8; }
      .title { font-weight: 600; margin-bottom: 2px; }
      .msg { white-space: pre-wrap; word-break: break-word; }
      .row { margin-top: 9px; display: flex; gap: 8px; }
      button {
        font: inherit; padding: 4px 10px; border-radius: 5px; cursor: pointer;
        background: #2f3a4d; color: #e8edf5; border: 1px solid #48566e;
      }
      button:hover { background: #3a4761; }
    `;
    toastBody = document.createElement("div");
    toastBody.className = "box";
    shadow.append(style, toastBody);
    document.documentElement.appendChild(toastRoot);
  }

  // `actions` is a list of { label, onClick } — used for the retry affordance.
  function toast(message, kind, actions) {
    ensureToast();
    toastBody.className = "box" + (kind ? " " + kind : "");
    toastBody.textContent = "";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "haipai";
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = message;
    toastBody.append(title, msg);
    if (actions && actions.length) {
      const row = document.createElement("div");
      row.className = "row";
      for (const a of actions) {
        const b = document.createElement("button");
        b.textContent = a.label;
        b.addEventListener("click", a.onClick);
        row.appendChild(b);
      }
      toastBody.appendChild(row);
    }
  }

  function hideToast() {
    if (toastRoot) toastRoot.remove();
    toastRoot = null;
    toastBody = null;
  }

  // ------------------------------------------------------------ ?data= guard

  const raw = new URLSearchParams(location.search).get("data");
  if (!raw) return; // nothing to do, stay silent

  let url;
  try {
    url = new URL(raw, location.href); // handles a missing leading slash
  } catch {
    return; // unparseable ?data= — silent, same as no param
  }
  // Security control, not a nicety: a crafted ?data= must not be able to make
  // the extension fetch an arbitrary origin and ship the response to haipai.
  if (url.origin !== location.origin) return;

  // Dedupe key from the *resolved* pathname, so it cannot be varied by query
  // string or by a relative-vs-absolute ?data= spelling.
  const m = url.pathname.match(/\/report\/([0-9a-f]+)\.json$/i);
  const key = m ? m[1].toLowerCase() : url.pathname;

  // ------------------------------------------------------------- messaging

  function send(msg) {
    return new Promise((resolve) => {
      let settled = false;
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          settled = true;
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: "No response from extension." });
        });
      } catch (e) {
        if (!settled) resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  async function run() {
    // Already uploaded? The worker answers from its dedupe store and, if the
    // key is known, navigates this tab to the existing game itself. No refetch,
    // no second upload, no toast.
    const known = await send({ type: "check", key });
    if (known && known.known) return;

    // Not signed in — say so here, before fetching a report we can't send.
    if (known && known.signedIn === false) {
      promptSignIn("Log in to haipai to upload this review.");
      return;
    }

    toast("Fetching review from mjai…");

    let report;
    try {
      const res = await fetch(url.href, { credentials: "same-origin" });
      if (!res.ok) {
        toast(`Could not fetch the review JSON (HTTP ${res.status}).`, "err",
              [{ label: "Retry", onClick: retry }]);
        return;
      }
      report = await res.json();
    } catch (e) {
      toast("Could not read the review JSON: " + String(e && e.message || e),
            "err", [{ label: "Retry", onClick: retry }]);
      return;
    }

    toast("Uploading review to haipai…");

    // Pass the parsed object; structured clone handles ~330 KB fine.
    const res = await send({ type: "upload", key, report });

    if (res && res.ok) {
      // The worker navigates the tab; this is just the last frame the user
      // may see before it does.
      toast("Uploaded. Opening in haipai…", "ok");
      return;
    }

    const err = (res && res.error) || "Upload failed.";
    if (res && res.needsSignIn) {
      promptSignIn(err);
      return;
    }
    const actions = [];
    if (!res || res.retryable !== false) {
      actions.push({ label: "Retry", onClick: retry });
    }
    actions.push({ label: "Dismiss", onClick: hideToast });
    toast(err, "err", actions);
  }

  // There is no extension-side sign-in: being logged in to haipai in this
  // browser *is* the credential. So we open haipai's own login page in a new
  // tab and then watch for the session to appear, and continue the upload
  // ourselves — the user never has to come back and reload this page, which
  // matters, because report pages expire.
  let waitingForLogin = false;

  function promptSignIn(message) {
    toast(message, "err", [
      {
        label: "Log in to haipai",
        onClick: async () => {
          await send({ type: "openLogin" });
          waitForLogin();
        },
      },
      { label: "Retry", onClick: retry },
      { label: "Dismiss", onClick: hideToast },
    ]);
  }

  function stopWaiting() {
    waitingForLogin = false;
    hideToast();
  }

  // Polls the worker, which owns the cross-origin fetch to haipai; this script
  // can't check the session itself.
  async function waitForLogin() {
    if (waitingForLogin) return;
    waitingForLogin = true;
    toast("Waiting for you to log in to haipai…", null,
          [{ label: "Cancel", onClick: stopWaiting }]);

    const deadline = Date.now() + 5 * 60 * 1000;
    while (waitingForLogin && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!waitingForLogin) return; // cancelled
      const st = await send({ type: "status" });
      if (st && st.signedIn) {
        waitingForLogin = false;
        toast(st.account ? `Signed in as ${st.account}.` : "Signed in.", "ok");
        run();
        return;
      }
    }
    if (waitingForLogin) {
      waitingForLogin = false;
      promptSignIn("Still not signed in to haipai.");
    }
  }

  function retry() {
    toast("Retrying…");
    run();
  }

  run();
})();
