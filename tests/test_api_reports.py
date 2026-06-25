#!/usr/bin/env python3
"""Tests for /api/mistakes/<id>/report (category reports) and
/api/admin/users/<id> (GDPR wipe).

Shared `client` fixture and `insert_game` helper live in conftest.py;
auth tests are in test_api_auth.py.
"""

import db
from tests.conftest import insert_game


def _login(client, username="testuser", password="testpass1"):
    return client.post("/login", data={
        "username": username,
        "password": password,
    }, follow_redirects=True)


# --- POST/DELETE /api/mistakes/<id>/report ---

class TestCategoryReport:
    def test_report_legacy_agree_rejected(self, client):
        """The legacy 'agree' kind is no longer accepted."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "agree",
        })
        assert res.status_code == 400

    def test_report_wrong_category_retired(self, client):
        # CORE Phase 3 retired the wrong_category kind — it's now an invalid kind.
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_category",
            "suggested_category": "3A",
            "reason": "This is clearly a push/fold decision",
        })
        assert res.status_code == 400

    def test_report_valid_wrong_text(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text",
            "reason": "Explanation reads like it applies to a different hand",
        })
        assert res.status_code == 200
        assert res.get_json()["ok"] is True

    def test_report_complex_gap_stores_tags_and_reason(self, client):
        """EXTRAS-A funnel: a complex_gap report stores its quick-tags in
        suggested_category (comma-joined) and the free text in reason."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "complex_gap",
            "suggested_category": "wait_quality,shape",
            "reason": "Looks like a wait-quality read to me",
        })
        assert res.status_code == 200
        assert res.get_json()["ok"] is True

        conn = db.get_db()
        row = conn.execute(
            "SELECT kind, suggested_category, reason FROM category_reports "
            "WHERE mistake_id = ? AND user_id = ?",
            (mistake_id, me["id"]),
        ).fetchone()
        conn.close()
        assert row["kind"] == "complex_gap"
        assert row["suggested_category"] == "wait_quality,shape"
        assert row["reason"] == "Looks like a wait-quality read to me"

    def test_report_missing_kind(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={})
        assert res.status_code == 400
        assert "kind" in res.get_json()["error"]

    def test_report_invalid_kind(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "maybe",
        })
        assert res.status_code == 400

    def test_report_wrong_category_requires_suggestion(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_category",
        })
        assert res.status_code == 400

    def test_report_nonexistent_mistake(self, client):
        _login(client)
        res = client.post("/api/mistakes/99999/report", json={"kind": "wrong_text"})
        assert res.status_code == 404

    def test_report_other_users_mistake(self, client):
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "stranger", generate_password_hash("longpassword"))
        conn.close()
        _, mistake_id = insert_game(uid2, with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={"kind": "wrong_text"})
        assert res.status_code == 404

    def test_report_reason_too_long(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text",
            "reason": "x" * 501,
        })
        assert res.status_code == 400
        assert "too long" in res.get_json()["error"]

    def test_report_unauthenticated(self, client):
        res = client.post("/api/mistakes/1/report", json={"kind": "wrong_text"})
        assert res.status_code == 401

    def test_unreport_removes_report(self, client):
        """DELETE /api/mistakes/<id>/report clears the user's own report."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text", "reason": "misclick",
        })
        res = client.delete(f"/api/mistakes/{mistake_id}/report")
        assert res.status_code == 200
        body = res.get_json()
        assert body["ok"] is True and body["removed"] is True

        conn = db.get_db()
        n = conn.execute(
            "SELECT COUNT(*) FROM category_reports WHERE mistake_id = ? AND user_id = ?",
            (mistake_id, me["id"]),
        ).fetchone()[0]
        conn.close()
        assert n == 0

    def test_unreport_idempotent(self, client):
        """DELETE with no existing report returns ok=True, removed=False."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        res = client.delete(f"/api/mistakes/{mistake_id}/report")
        assert res.status_code == 200
        assert res.get_json() == {"ok": True, "removed": False}

    def test_unreport_other_users_mistake(self, client):
        """DELETE 404s when the mistake belongs to someone else, even if
        they have an existing report — ownership check runs first."""
        _login(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        uid2 = db.create_user(conn, "stranger2", generate_password_hash("longpassword"))
        conn.close()
        _, mistake_id = insert_game(uid2, with_mistakes=True)

        res = client.delete(f"/api/mistakes/{mistake_id}/report")
        assert res.status_code == 404

    def test_unreport_unauthenticated(self, client):
        res = client.delete("/api/mistakes/1/report")
        assert res.status_code == 401

    def test_report_upsert_replaces_prior(self, client):
        """Re-reporting the same mistake replaces the earlier report."""
        _login(client)
        me = client.get("/api/me").get_json()
        _, mistake_id = insert_game(me["id"], with_mistakes=True)

        client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text", "reason": "first take",
        })
        client.post(f"/api/mistakes/{mistake_id}/report", json={
            "kind": "wrong_text", "reason": "changed my mind",
        })

        conn = db.get_db()
        rows = conn.execute(
            "SELECT kind, reason FROM category_reports WHERE mistake_id = ? AND user_id = ?",
            (mistake_id, me["id"])
        ).fetchall()
        conn.close()
        assert len(rows) == 1
        assert rows[0]["kind"] == "wrong_text"
        assert rows[0]["reason"] == "changed my mind"


# --- DELETE /api/admin/users/<id> (GDPR wipe) ---

class TestAdminDeleteUser:
    @staticmethod
    def _promote(user_id):
        conn = db.get_db()
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()

    @staticmethod
    def _csrf(client):
        return client.get("/api/me").get_json()["csrf_token"]

    def test_delete_unauthenticated(self, client):
        res = client.delete("/api/admin/users/1")
        assert res.status_code == 401

    def test_delete_non_admin_forbidden(self, client):
        _login(client)  # testuser, not admin
        res = client.delete(
            "/api/admin/users/999",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 403

    def test_delete_self_rejected(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])
        res = client.delete(
            f"/api/admin/users/{me['id']}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 400
        assert "own account" in res.get_json()["error"]

    def test_delete_nonexistent(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])
        res = client.delete(
            "/api/admin/users/99999",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 404

    def test_delete_other_admin_allowed_when_not_last(self, client):
        """Deleting an admin is fine as long as another admin remains."""
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])

        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        other_admin = db.create_user(conn, "other_admin", generate_password_hash("longpassword"))
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (other_admin,))
        conn.commit()
        conn.close()

        res = client.delete(
            f"/api/admin/users/{other_admin}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 200

    def test_delete_wipes_all_user_data(self, client):
        """Happy path: admin deletes a user with games, mistakes, and a
        category report — all gone."""
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])

        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        victim = db.create_user(conn, "victim_user", generate_password_hash("longpassword"))
        conn.close()

        game_id, mistake_id = insert_game(victim, with_mistakes=True)

        conn = db.get_db()
        db.submit_category_report(conn, victim, mistake_id, kind="wrong_text",
                                  suggested_category=None, reason="example")
        conn.commit()
        conn.close()

        res = client.delete(
            f"/api/admin/users/{victim}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["ok"] is True
        assert data["username"] == "victim_user"
        d = data["deleted"]
        assert d["users"] == 1
        assert d["games"] == 1
        assert d["mistakes"] == 1
        assert d["category_reports"] == 1

        # Verify everything is actually gone.
        conn = db.get_db()
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (victim,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM games WHERE user_id = ?", (victim,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM mistakes WHERE id = ?", (mistake_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM category_reports WHERE user_id = ?", (victim,)).fetchone()[0] == 0
        # The admin (testuser) is untouched.
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (me["id"],)).fetchone()[0] == 1
        conn.close()

    def test_delete_blocked_while_impersonating(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])

        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        target = db.create_user(conn, "imp_target", generate_password_hash("longpassword"))
        victim = db.create_user(conn, "imp_victim", generate_password_hash("longpassword"))
        conn.close()

        # Begin impersonation.
        res = client.post(
            f"/api/admin/impersonate/{target}",
            headers={"X-CSRFToken": self._csrf(client)},
            json={},
        )
        assert res.status_code == 200

        # Now any delete attempt should be 409.
        res = client.delete(
            f"/api/admin/users/{victim}",
            headers={"X-CSRFToken": self._csrf(client)},
        )
        assert res.status_code == 409
        assert "impersonating" in res.get_json()["error"].lower()


# --- Global category-shape snapshot (admin dashboard) ---

class TestCategorySnapshot:
    @staticmethod
    def _promote(user_id):
        conn = db.get_db()
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()

    @staticmethod
    def _csrf(client):
        return client.get("/api/me").get_json()["csrf_token"]

    def _admin(self, client):
        _login(client)
        me = client.get("/api/me").get_json()
        self._promote(me["id"])
        return me

    def test_endpoints_require_admin(self, client):
        _login(client)  # plain user
        assert client.get("/api/admin/snapshot/game-ids").status_code == 403
        assert client.get("/api/admin/category-snapshots").status_code == 403

    def test_game_ids_lists_all_games(self, client):
        me = self._admin(client)
        g1, _ = insert_game(me["id"])
        g2, _ = insert_game(me["id"], with_mistakes=False)
        ids = client.get("/api/admin/snapshot/game-ids").get_json()["game_ids"]
        assert g1 in ids and g2 in ids

    def test_snapshot_game_payload_is_cross_user(self, client):
        """The per-game endpoint serves any game regardless of owner."""
        me = self._admin(client)
        conn = db.get_db()
        from werkzeug.security import generate_password_hash
        other = db.create_user(conn, "other", generate_password_hash("longpassword"))
        conn.close()
        gid, _ = insert_game(other)  # owned by someone else
        res = client.get(f"/api/admin/snapshot/game/{gid}")
        assert res.status_code == 200
        body = res.get_json()
        assert body["game"]["id"] == gid
        assert "rounds" in body["game"]

    def test_snapshot_game_404(self, client):
        self._admin(client)
        assert client.get("/api/admin/snapshot/game/999999").status_code == 404

    def test_save_and_list_roundtrip(self, client):
        self._admin(client)
        payload = {
            "categorizer_version": 9,
            "game_count": 5,
            "mistake_count": 120,
            "summary": {
                "by_shape": {"complex": {"count": 30, "ev": 88.0}},
                "total_mistakes": 120,
                "total_ev": 200.0,
            },
        }
        res = client.post(
            "/api/admin/category-snapshots",
            headers={"X-CSRFToken": self._csrf(client)},
            json=payload,
        )
        assert res.status_code == 200
        snaps = client.get("/api/admin/category-snapshots").get_json()["snapshots"]
        assert len(snaps) == 1
        assert snaps[0]["mistake_count"] == 120
        assert snaps[0]["summary"]["by_shape"]["complex"]["count"] == 30

    def test_save_rejects_missing_fields(self, client):
        self._admin(client)
        res = client.post(
            "/api/admin/category-snapshots",
            headers={"X-CSRFToken": self._csrf(client)},
            json={"game_count": 5},
        )
        assert res.status_code == 400
