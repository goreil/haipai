// Thin wrappers around fetch for our API. Always inject the CSRF token on
// state-changing requests; read the token from the global set by main.js
// after /api/me resolves.

// Runs one request via `buildInit` (a thunk so it re-reads the current
// `csrfToken` global on retry) and, if it comes back as an expired-CSRF 400,
// silently refreshes the token (see main.js) and retries once. Idle tabs
// then just work instead of surfacing "CSRF token has expired" to the user.
async function csrfFetch(url, buildInit) {
  let res = await fetch(url, buildInit());
  if (res.status === 400) {
    const body = await res.clone().json().catch(() => ({}));
    if (/csrf/i.test(body.error || "") && typeof refreshCsrfToken === "function") {
      await refreshCsrfToken();
      res = await fetch(url, buildInit());
    }
  }
  return res;
}

function apiPost(url, body) {
  return csrfFetch(url, () => ({
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
    body: JSON.stringify(body),
  }));
}

function apiDelete(url) {
  return csrfFetch(url, () => ({
    method: "DELETE",
    headers: { "X-CSRFToken": csrfToken },
  }));
}
