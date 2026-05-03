// Thin wrappers around fetch for our API. Always inject the CSRF token on
// state-changing requests; read the token from the global set by main.js
// after /api/me resolves.

function apiPost(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
    body: JSON.stringify(body),
  });
}

function apiDelete(url) {
  return fetch(url, { method: "DELETE", headers: { "X-CSRFToken": csrfToken } });
}
