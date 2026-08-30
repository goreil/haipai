#!/usr/bin/env python3
"""Tests for the public minigame arcade page (/play).

The trainers themselves are client-side, so what's worth pinning here is the
gate: a logged-out visitor gets the arcade shell, a logged-in one gets bounced
to the real app (where the SPA serves the same trainers with their leaderboard
identity), and the shell never carries the authenticated surface.
"""


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


class TestPlayPage:
    def test_served_without_an_account(self, client):
        res = client.get("/play")
        assert res.status_code == 200
        body = res.get_data(as_text=True)
        assert "waits-trainer.js" in body
        assert "defense-trainer.js" in body
        assert "efficiency-trainer.js" in body
        # The Efficiency Trainer asks the real solver for tenpai, so the
        # guest shell has to ship it too.
        assert "prep/shanten.js" in body

    def test_logged_in_visitor_goes_to_the_app(self, client):
        _login(client)
        res = client.get("/play")
        assert res.status_code == 302
        assert res.headers["Location"] == "/"

    def test_tab_strip_is_rendered_from_the_roster(self, client):
        """The arcade lists no games of its own — `MG_GAMES` (minigame-shell.js)
        is the roster, and play-view.js fills `#play-tabs` from it. Pinned so a
        future trainer isn't added to the router but missed in the markup."""
        body = client.get("/play").get_data(as_text=True)
        assert 'id="play-tabs"' in body
        assert "data-play-tab=" not in body     # no hardcoded per-game tabs

    def test_shell_carries_no_authenticated_surface(self, client):
        """The guest shell is a separate minimal page, not the SPA degraded —
        so there is no sidebar/mailbox/admin/upload markup on it to leak."""
        body = client.get("/play").get_data(as_text=True)
        # Markup/script identifiers, not bare words — the page's own comment
        # explains the omission by naming the things it omits.
        for leaked in ('id="game-list"', 'id="mailbox"', 'id="admin-btn"',
                       'id="add-modal"', 'id="share-modal"',
                       "/static/js/main.js", "/static/js/game-fetch.js"):
            assert leaked not in body

    def test_offers_a_way_to_sign_up(self, client):
        body = client.get("/play").get_data(as_text=True)
        assert 'href="/register"' in body
        assert 'href="/login"' in body


class TestLandingEntryPoints:
    def test_landing_links_to_the_arcade(self, client):
        body = client.get("/").get_data(as_text=True)
        assert '/play' in body

    def test_login_page_links_to_the_arcade(self, client):
        body = client.get("/login").get_data(as_text=True)
        assert '/play' in body
