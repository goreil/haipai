"""Resolved reports stay in admin history without blocking new user feedback."""

import json
import subprocess
import sys

import db
from db import coins
from scripts.show_reports import fetch
from tests.test_community_coins import setup_report
from tests.conftest import insert_game


def promote(conn, uid):
    conn.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (uid,))
    conn.commit()


def test_fix_hides_from_user_preserves_history_and_awards_once(client):
    conn, uid, gid, mid, rid = setup_report(client)
    url = f'/api/admin/category-reports/{rid}/fix'
    assert client.post(url, json={}).status_code == 403
    assert client.get('/api/admin/category-reports?status=fixed').status_code == 403
    promote(conn, uid)
    before = db.get_game(conn, gid, uid)['rounds'][0]['mistakes'][0]
    assert before['my_report']['reason'] == 'Incorrect comparison'
    first = client.post(url, json={'reason': 'Correct comparison; regression tests pass'}).get_json()
    assert first['fixed'] and first['awarded'] and first['amount'] == 66
    assert first['fixed_by'] == uid
    after = db.get_game(conn, gid, uid)['rounds'][0]['mistakes'][0]
    assert 'my_report' not in after
    assert after['hand'] == before['hand']
    assert client.get('/api/admin/category-reports?scope=all').get_json()['reports'] == []
    history = client.get('/api/admin/category-reports?scope=all&status=fixed').get_json()['reports']
    assert len(history) == 1
    assert history[0]['id'] == rid and history[0]['reason'] == 'Incorrect comparison'
    assert history[0]['fix_note'] == 'Correct comparison; regression tests pass'
    assert history[0]['fixed_by_username'] == 'testuser'
    assert history[0]['mistake']['hand'] == before['hand']
    assert client.get('/api/admin/category-reports?status=fixed').get_json()['reports'] == []
    repeat = client.post(url, json={'reason': 'Do not overwrite the original fix'}).get_json()
    assert not repeat['fixed'] and not repeat['awarded']
    assert repeat['fixed_at'] == first['fixed_at'] and repeat['fix_note'] == first['fix_note']
    assert coins.balance(conn, uid) == 66
    # Withdrawing/re-reporting after resolution cannot change archived feedback.
    assert client.delete(f'/api/mistakes/{mid}/report').get_json()['removed'] is False
    submitted = client.post(f'/api/mistakes/{mid}/report', json={'kind': 'wrong_text', 'reason': 'A new issue'})
    assert submitted.get_json()['coins_earned'] == 7
    new_id = db.list_category_reports(conn)[0]['id']
    assert new_id != rid
    client.post(f'/api/mistakes/{mid}/report', json={'kind': 'wrong_text', 'reason': 'Updated new issue'})
    assert db.list_category_reports(conn)[0]['id'] == new_id
    assert len(db.list_category_reports(conn, status='all')) == 2
    assert db.list_category_reports(conn, status='fixed')[0]['reason'] == 'Incorrect comparison'
    second = client.post(f'/api/admin/category-reports/{new_id}/fix', json={}).get_json()
    assert second['fixed'] and not second['awarded']
    assert coins.balance(conn, uid) == 73  # Existing fix award plus the first submission reward.
    conn.close()


def test_fix_validation_and_legacy_delete_preserve_report(client):
    conn, uid, _, mid, rid = setup_report(client)
    promote(conn, uid)
    url = f'/api/admin/category-reports/{rid}/fix'
    for payload in ([], False, {'reason': ['bad']}, {'reason': 'x' * 501}):
        assert client.post(url, json=payload).status_code == 400
    assert client.post('/api/admin/category-reports/999999/fix', json={}).status_code == 404
    assert client.get('/api/admin/category-reports?status=invalid').status_code == 400
    conn.execute('UPDATE mistakes SET ev_loss = NULL WHERE id = ?', (mid,))
    conn.commit()
    assert client.post(url, json={}).status_code == 400
    assert db.list_category_reports(conn)[0]['fixed_at'] is None
    assert coins.balance(conn, uid) == 0
    legacy = client.delete(f'/api/admin/category-reports/{rid}')
    assert legacy.status_code == 200
    assert db.list_category_reports(conn, status='fixed')[0]['fixed_by'] == uid
    assert client.delete(f'/api/admin/category-reports/{rid}').status_code == 200
    conn.close()


def test_cli_fix_preview_apply_repeat_rollback_and_history(client):
    conn, uid, _, mid, rid = setup_report(client)
    args = [sys.executable, 'scripts/community_coins.py', '--db', str(db.DB_FILE),
            '--mark-fixed', '--reason', 'Verified regression fix', '--report-ids', str(rid)]
    preview = subprocess.run(args, capture_output=True, text=True, check=True)
    assert json.loads(preview.stdout)['fixed_report_ids'] == [rid]
    assert db.list_category_reports(conn)[0]['fixed_at'] is None
    assert coins.balance(conn, uid) == 0
    applied = subprocess.run([*args, '--apply'], capture_output=True, text=True, check=True)
    assert json.loads(applied.stdout)['fixed_report_ids'] == [rid]
    assert coins.balance(conn, uid) == 66
    repeat = subprocess.run([*args, '--apply'], capture_output=True, text=True, check=True)
    assert json.loads(repeat.stdout)['fixed_report_ids'] == []
    assert json.loads(repeat.stdout)['coins'] == 0
    assert fetch(db.DB_FILE) == []
    assert fetch(db.DB_FILE, status='fixed')[0]['fix_note'] == 'Verified regression fix'
    _, new_mid = insert_game(uid)
    new_id = db.submit_category_report(conn, uid, new_mid, 'wrong_text', reason='New issue')
    failure = subprocess.run([*args[:-1], f'{new_id},999999', '--apply'], capture_output=True, text=True)
    assert failure.returncode == 1
    assert coins.balance(conn, uid) == 66
    assert db.list_category_reports(conn)[0]['id'] == new_id
    assert len(fetch(db.DB_FILE, status='all')) == 2
    conn.close()


def test_failed_resolution_rolls_back_award(client, monkeypatch):
    conn, uid, _, _, rid = setup_report(client)
    promote(conn, uid)

    def fail(*args, **kwargs):
        raise ValueError('Resolution failed')

    monkeypatch.setattr(db, 'fix_category_report', fail)
    assert client.post(f'/api/admin/category-reports/{rid}/fix', json={}).status_code == 400
    assert coins.balance(conn, uid) == 0
    assert db.list_category_reports(conn)[0]['fixed_at'] is None
    conn.close()


def test_upgrade_preserves_reports_and_allows_new_report_after_fix(client):
    conn, uid, _, mid, rid = setup_report(client)
    conn.execute('DROP INDEX idx_category_reports_open_user_mistake')
    for column in ('fixed_at', 'fixed_by', 'fix_note'):
        conn.execute(f'ALTER TABLE category_reports DROP COLUMN {column}')
    conn.execute('CREATE UNIQUE INDEX idx_category_reports_user_mistake ON category_reports(user_id, mistake_id)')
    conn.commit()
    db.init_db(conn)
    db.init_db(conn)
    assert db.list_category_reports(conn)[0]['id'] == rid
    with conn:
        db.fix_category_report(conn, rid, reason='Migrated report fixed')
    assert db.submit_category_report(conn, uid, mid, 'wrong_text') != rid
    db.init_db(conn)
    assert len(db.list_category_reports(conn, status='all')) == 2
    assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
    conn.close()
