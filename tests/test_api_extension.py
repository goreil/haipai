#!/usr/bin/env python3
"""Tests for the browser-extension authorization flow.

The extension authenticates with a per-install token minted by the
/extension/authorize consent page, rather than the hand-pasted bookmarklet
token. Both credentials are accepted by /api/games/upload; these tests pin
that they stay independent of each other.

Shared `client` fixture lives in conftest.py.
"""

import db

REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={"username": username, "password": password},
                       follow_redirects=True)


def _authorize(client, redirect_uri=REDIRECT, state="st1", decision="approve"):
    return client.post("/extension/authorize", data={
        "redirect_uri": redirect_uri, "state": state, "decision": decision,
    })


def _token_from(location):
    """Pull the token out of the callback fragment."""
    from urllib.parse import urlsplit, parse_qs
    frag = urlsplit(location).fragment
    return parse_qs(frag).get("token", [None])[0]


# --- /extension/authorize ---

class TestExtensionAuthorize:
    def test_logged_out_redirects_to_login(self, client):
        res = client.get(f"/extension/authorize?redirect_uri={REDIRECT}&state=st1")
        assert res.status_code == 302
        assert "/login" in res.headers["Location"]

    def test_login_returns_to_consent_page(self, client):
        # Bounce off the authorize page first so the return path gets stashed.
        client.get(f"/extension/authorize?redirect_uri={REDIRECT}&state=st1")
        res = client.post("/login", data={"username": "testuser", "password": "testpass1"})
        assert res.status_code == 302
        assert "/extension/authorize" in res.headers["Location"]

    def test_plain_login_still_goes_to_root(self, client):
        """No pending authorize → login must not be diverted anywhere."""
        res = client.post("/login", data={"username": "testuser", "password": "testpass1"})
        assert res.status_code == 302
        assert res.headers["Location"] == "/"

    def test_consent_page_renders(self, client):
        _login(client)
        res = client.get(f"/extension/authorize?redirect_uri={REDIRECT}&state=st1")
        assert res.status_code == 200
        assert b"Connect the browser extension?" in res.data
        assert b"testuser" in res.data

    def test_offsite_redirect_uri_rejected(self, client):
        _login(client)
        res = client.get("/extension/authorize?redirect_uri=https://evil.example.com/&state=st1")
        assert res.status_code == 400
        assert b"Invalid redirect target" in res.data

    def test_offsite_redirect_uri_rejected_on_post(self, client):
        """The POST re-validates — a valid GET must not be replayable elsewhere."""
        _login(client)
        res = _authorize(client, redirect_uri="https://evil.example.com/")
        assert res.status_code == 400
        conn = db.get_db()
        assert db.list_extension_tokens(conn, 1) == []
        conn.close()

    def test_lookalike_host_rejected(self, client):
        _login(client)
        res = _authorize(client, redirect_uri="https://evil-chromiumapp.org.attacker.com/")
        assert res.status_code == 400

    def test_http_redirect_uri_rejected(self, client):
        _login(client)
        res = _authorize(client, redirect_uri="http://abc.chromiumapp.org/")
        assert res.status_code == 400

    def test_approve_issues_token_in_fragment(self, client):
        _login(client)
        res = _authorize(client)
        assert res.status_code == 302
        loc = res.headers["Location"]
        assert loc.startswith(REDIRECT + "#")
        assert "state=st1" in loc
        assert "username=testuser" in loc
        token = _token_from(loc)
        assert token
        # The secret must never sit in the query string, only the fragment.
        assert "token=" not in loc.split("#", 1)[0]

    def test_deny_returns_error_and_no_token(self, client):
        _login(client)
        res = _authorize(client, decision="deny")
        assert res.status_code == 302
        assert "error=access_denied" in res.headers["Location"]
        assert _token_from(res.headers["Location"]) is None
        conn = db.get_db()
        assert db.list_extension_tokens(conn, 1) == []
        conn.close()

    def test_each_approval_is_a_separate_credential(self, client):
        _login(client)
        t1 = _token_from(_authorize(client).headers["Location"])
        t2 = _token_from(_authorize(client).headers["Location"])
        assert t1 != t2
        conn = db.get_db()
        assert len(db.list_extension_tokens(conn, 1)) == 2
        conn.close()


# --- Using the token ---

class TestExtensionUpload:
    def test_token_authenticates_upload(self, client):
        _login(client)
        token = _token_from(_authorize(client).headers["Location"])
        res = client.post("/api/games/upload", json={"mortal_data": {}},
                          headers={"Authorization": f"Bearer {token}"})
        # Past auth; rejected by the endpoint's own validation.
        assert res.status_code == 400
        assert "mortal_data" in res.get_json()["error"]

    def test_bogus_token_rejected(self, client):
        res = client.post("/api/games/upload", json={"mortal_data": {}},
                          headers={"Authorization": "Bearer nope"})
        assert res.status_code == 401

    def test_upload_stamps_last_used(self, client):
        _login(client)
        token = _token_from(_authorize(client).headers["Location"])
        conn = db.get_db()
        assert db.list_extension_tokens(conn, 1)[0]["last_used_at"] is None
        conn.close()

        client.post("/api/games/upload", json={"mortal_data": {}},
                    headers={"Authorization": f"Bearer {token}"})
        conn = db.get_db()
        assert db.list_extension_tokens(conn, 1)[0]["last_used_at"] is not None
        conn.close()

    def test_bookmarklet_token_still_works(self, client):
        """The two credentials must not interfere with each other."""
        _login(client)
        conn = db.get_db()
        bookmarklet = db.get_or_create_upload_token(conn, 1)
        conn.close()
        res = client.post("/api/games/upload", json={"mortal_data": {}},
                          headers={"Authorization": f"Bearer {bookmarklet}"})
        assert res.status_code == 400

    def test_regenerating_bookmarklet_token_leaves_extension_alone(self, client):
        _login(client)
        token = _token_from(_authorize(client).headers["Location"])
        client.post("/api/upload-token/regenerate", json={})
        res = client.post("/api/games/upload", json={"mortal_data": {}},
                          headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 400  # still authenticates


# --- Revocation ---

class TestExtensionRevoke:
    def test_self_revoke_invalidates(self, client):
        _login(client)
        token = _token_from(_authorize(client).headers["Location"])
        res = client.post("/api/extension/revoke",
                          headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        res = client.post("/api/games/upload", json={"mortal_data": {}},
                          headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 401

    def test_listing_never_exposes_the_secret(self, client):
        _login(client)
        token = _token_from(_authorize(client).headers["Location"])
        res = client.get("/api/me/extension-tokens")
        assert res.status_code == 200
        body = res.get_data(as_text=True)
        assert token not in body
        assert len(res.get_json()["tokens"]) == 1

    def test_owner_can_revoke_from_account(self, client):
        _login(client)
        token = _token_from(_authorize(client).headers["Location"])
        tid = client.get("/api/me/extension-tokens").get_json()["tokens"][0]["id"]
        assert client.delete(f"/api/me/extension-tokens/{tid}").status_code == 200
        res = client.post("/api/games/upload", json={"mortal_data": {}},
                          headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 401

    def test_cannot_revoke_another_users_token(self, client):
        from werkzeug.security import generate_password_hash
        conn = db.get_db()
        other_id = db.create_user(conn, "other", generate_password_hash("otherpass1"))
        db.create_extension_token(conn, other_id, client="theirs")
        victim = db.list_extension_tokens(conn, other_id)[0]["id"]
        conn.close()

        _login(client)
        assert client.delete(f"/api/me/extension-tokens/{victim}").status_code == 404
        conn = db.get_db()
        assert len(db.list_extension_tokens(conn, other_id)) == 1
        conn.close()

    def test_listing_requires_login(self, client):
        assert client.get("/api/me/extension-tokens").status_code == 401

    def test_deleting_user_removes_their_tokens(self, client):
        _login(client)
        _authorize(client)
        conn = db.get_db()
        assert len(db.list_extension_tokens(conn, 1)) == 1
        db.delete_user_cascade(conn, 1)
        assert db.list_extension_tokens(conn, 1) == []
        conn.close()
