#!/usr/bin/env python3
"""Tests for /api/games/upload's two ways in.

The browser extension authenticates with nothing but the ordinary haipai
session cookie — its service worker gets the SameSite=Lax cookie attached
because it holds host permissions for haipai. The bookmarklet, which runs as a
page on mjai.ekyu.moe and so can never have that cookie, keeps using the
account's `upload_token` as a Bearer credential.

That makes this endpoint a CSRF-exempt route that accepts a cookie, so the
cross-site guards on the cookie path (`_cookie_origin_ok`, and the absence of
Access-Control-Allow-Credentials) are pinned here too.

Shared `client` fixture lives in conftest.py.
"""

import db


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={"username": username, "password": password},
                       follow_redirects=True)


def _upload(client, **kwargs):
    """POST a payload that is guaranteed to fail *validation*, so the status
    code reports only whether authentication succeeded: 400 = authenticated,
    401/403 = not."""
    return client.post("/api/games/upload", json={"mortal_data": {}}, **kwargs)


# --- Session-cookie auth (the extension) ---

class TestCookieUpload:
    def test_logged_in_session_authenticates(self, client):
        _login(client)
        res = _upload(client)
        # Past auth; rejected by the endpoint's own validation.
        assert res.status_code == 400
        assert "mortal_data" in res.get_json()["error"]

    def test_logged_out_is_rejected(self, client):
        res = _upload(client)
        assert res.status_code == 401

    def test_logout_stops_uploads(self, client):
        _login(client)
        assert _upload(client).status_code == 400
        client.get("/logout")
        assert _upload(client).status_code == 401

    def test_extension_origin_accepted(self, client):
        """What Chrome actually sends from the extension's service worker."""
        _login(client)
        res = _upload(client, headers={
            "Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop"})
        assert res.status_code == 400

    def test_firefox_extension_origin_accepted(self, client):
        _login(client)
        res = _upload(client, headers={"Origin": "moz-extension://abc-123"})
        assert res.status_code == 400

    def test_same_origin_accepted(self, client):
        _login(client)
        res = _upload(client, headers={"Origin": "http://localhost"})
        assert res.status_code == 400

    def test_foreign_origin_cannot_use_the_cookie(self, client):
        """The guard that makes the CSRF exemption survivable: a page on any
        other site is refused even though the session cookie is present."""
        _login(client)
        res = _upload(client, headers={"Origin": "https://evil.example.com"})
        assert res.status_code == 403

    def test_allowed_cors_origin_still_cannot_use_the_cookie(self, client):
        """mjai.ekyu.moe is allowed to *call* this endpoint (the bookmarklet
        lives there), but only with a Bearer token — never on the cookie."""
        _login(client)
        res = _upload(client, headers={"Origin": "https://mjai.ekyu.moe"})
        assert res.status_code == 403


# --- Bearer auth (the bookmarklet) ---

class TestBookmarkletUpload:
    def test_upload_token_authenticates(self, client):
        _login(client)
        conn = db.get_db()
        token = db.get_or_create_upload_token(conn, 1)
        conn.close()
        res = _upload(client, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 400

    def test_bogus_token_rejected(self, client):
        res = _upload(client, headers={"Authorization": "Bearer nope"})
        assert res.status_code == 401

    def test_bad_token_is_not_rescued_by_a_session(self, client):
        """An explicit Bearer header must be judged on its own. Falling back to
        the cookie would hide a revoked bookmarklet token from its owner."""
        _login(client)
        res = _upload(client, headers={"Authorization": "Bearer nope"})
        assert res.status_code == 401

    def test_token_works_from_the_bookmarklet_origin(self, client):
        """No session involved, so the cookie-path origin guard must not fire."""
        conn = db.get_db()
        token = db.get_or_create_upload_token(conn, 1)
        conn.close()
        res = _upload(client, headers={"Authorization": f"Bearer {token}",
                                       "Origin": "https://mjai.ekyu.moe"})
        assert res.status_code == 400


# --- CORS ---

class TestUploadCors:
    def test_preflight_allows_the_bookmarklet_origin(self, client):
        res = client.open("/api/games/upload", method="OPTIONS")
        assert res.status_code == 204
        assert res.headers["Access-Control-Allow-Origin"] == "https://mjai.ekyu.moe"

    def test_no_allow_credentials_header(self, client):
        """Adding this would let a page on the allowed origin make a
        cookie-authenticated upload, which the CSRF exemption relies on being
        impossible. Pinned on both the preflight and the real response."""
        pre = client.open("/api/games/upload", method="OPTIONS")
        assert "Access-Control-Allow-Credentials" not in pre.headers
        res = _upload(client, headers={"Authorization": "Bearer nope"})
        assert "Access-Control-Allow-Credentials" not in res.headers
