"""Award accounting, reconstruction, ownership, and repeat-safe operations."""
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest

import db
from db import coins
from tests.conftest import insert_game
from tests.test_api_game import _login


def setup_report(client):
    _login(client)
    uid = client.get('/api/me').get_json()['id']
    gid, mid = insert_game(uid)
    conn = db.get_db()
    rid = db.submit_category_report(conn, uid, mid, 'wrong_text', reason='Incorrect comparison')
    conn.execute('UPDATE mistakes SET ev_loss = 0.655 WHERE id = ?', (mid,))
    conn.commit()
    return conn, uid, gid, mid, rid


def test_report_admin_award_repeat_and_resubmit(client):
    conn, uid, gid, mid, rid = setup_report(client)
    url = f'/api/admin/category-reports/{rid}/award'
    assert client.post(url).status_code == 403
    assert coins.balance(conn, uid) == 0
    conn.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (uid,))
    conn.commit()
    first = client.post(url, json={'reason': 'Corrected visible yaku evidence'}).get_json()
    assert first['awarded'] and first['amount'] == 66
    assert 'Corrected visible yaku evidence' in coins.history(conn, uid)['entries'][0]['detail']
    assert client.post(url, json={'reason': ['invalid']}).status_code == 400
    assert client.post(url).get_json()['awarded'] is False
    assert client.get('/api/me').get_json()['community_coins'] == 66
    assert client.get('/api/admin/category-reports?scope=all').get_json()['reports'][0]['awarded_coins'] == 66
    db.delete_category_report(conn, rid)
    rid = db.submit_category_report(conn, uid, mid, 'wrong_text', reason='Updated')
    assert client.post(f'/api/admin/category-reports/{rid}/award').get_json()['awarded'] is False
    assert client.post('/api/admin/category-reports/999999/award').status_code == 404
    conn.close()


@pytest.mark.parametrize('value, expected', [(0, 0), (.005, 1), (.655, 66), (1.71, 171)])
def test_report_rounding(value, expected):
    assert coins.report_coins(value) == expected


@pytest.mark.parametrize('value', [None, -1, 'nan', 'inf', '-inf', 'invalid', 10**30])
def test_invalid_ev(value):
    with pytest.raises(ValueError):
        coins.report_coins(value)


def test_maka_edit_clear_repeat_atomic(client, monkeypatch):
    conn, uid, gid, _, _ = setup_report(client)
    url = f'/api/games/{gid}/maka-ratings'
    for payload in [{'overall': 'A', 'matches': ['B']}, {'overall': 'S', 'matches': ['B']},
                    {'overall': None, 'matches': [None]}, {'overall': 'A', 'matches': ['S']}]:
        assert client.post(url, json=payload).status_code == 200
    assert coins.balance(conn, uid) == 10
    gid2, _ = insert_game(uid, with_mistakes=False)
    def fail(*args, **kwargs):
        raise RuntimeError('Simulated ledger failure')
    monkeypatch.setattr(coins, 'award_maka', fail)
    with pytest.raises(RuntimeError):
        db.save_maka_ratings(conn, gid2, uid, {'overall': 'A', 'matches': ['B']})
    assert db.get_game(conn, gid2, uid)['maka_ratings'] is None
    assert coins.balance(conn, uid) == 10
    conn.close()


def test_backfill_deleted_reports_dedup_and_rollback(client):
    conn, uid, gid, mid, rid = setup_report(client)
    conn.execute('DELETE FROM category_reports WHERE id = ?', (rid,))
    conn.commit()
    for _ in range(2):
        db.create_message(conn, type='thanks', audience_user_id=uid, title=f'Fixed #{mid}',
                          body=f'<p>your report on mistake #{mid}; commit #abcdef and color #123456</p>')
    conn.execute('UPDATE games SET maka_ratings_json = ? WHERE id = ?',
                 (json.dumps({'overall': 'A', 'matches': ['B']}), gid))
    conn.commit()
    with conn:
        result = coins.backfill(conn, thanks=True, maka=True)
    assert result == {'awards': 3, 'coins': 76}
    with conn:
        assert coins.backfill(conn, thanks=True, maka=True) == {'awards': 0, 'coins': 0}
    # Re-creating the missing report cannot pay again.
    rid = db.submit_category_report(conn, uid, mid, 'wrong_text')
    with conn:
        assert not coins.award_report(conn, rid)['awarded']
    _, mid2 = insert_game(uid)
    rid2 = db.submit_category_report(conn, uid, mid2, 'wrong_text')
    with pytest.raises(LookupError), conn:
        coins.backfill(conn, report_ids=[rid2, 999999])
    assert coins.balance(conn, uid) == 76
    conn.close()


def test_missing_or_wrong_owner_thanks_aborts(client):
    conn, uid, _, mid, _ = setup_report(client)
    other = db.create_user(conn, 'other', 'unused')
    db.create_message(conn, type='thanks', audience_user_id=other, title=f'Fixed #{mid}', body='Fixed')
    with pytest.raises(ValueError), conn:
        coins.backfill(conn, thanks=True)
    assert coins.balance(conn, other) == 0
    conn.close()


def test_delete_game_id_reuse_and_account_delete(client):
    conn, uid, gid, mid, rid = setup_report(client)
    with conn:
        coins.award_report(conn, rid)
    db.save_maka_ratings(conn, gid, uid, {'overall': 'A', 'matches': ['B']})
    # Deleting contribution sources leaves the balance, and replacement rows
    # reusing SQLite IDs are genuinely different contributions.
    conn.execute('DELETE FROM games WHERE id = ?', (gid,))
    conn.commit()
    assert coins.balance(conn, uid) == 76
    new_gid, new_mid = insert_game(uid)
    assert new_gid == gid and new_mid == mid
    new_rid = db.submit_category_report(conn, uid, new_mid, 'wrong_text')
    with conn:
        assert coins.award_report(conn, new_rid)['awarded']
    db.save_maka_ratings(conn, new_gid, uid, {'overall': 'A', 'matches': ['B']})
    assert conn.execute('SELECT COUNT(*) FROM community_coins').fetchone()[0] == 6
    db.delete_user_cascade(conn, uid)
    assert conn.execute('SELECT COUNT(*) FROM community_coins').fetchone()[0] == 0
    conn.close()


def test_history_pagination_export_and_privacy(client):
    conn, uid, gid, mid, rid = setup_report(client)
    with conn:
        coins.award_report(conn, rid)
        coins.award_maka(conn, gid, uid, {'overall': 'A', 'matches': ['B'] * 40})
    first = client.get('/api/me/coins').get_json()
    assert first['balance'] == 271
    assert len(first['entries']) == 1 and first['next_before'] is None
    assert first['entries'][0]['mistake_id'] == mid
    assert first['entries'][0]['report_text'] == 'Incorrect comparison'
    assert first['entries'][0]['mistake_available']
    assert first['totals']['maka_grade'] == 205
    for value in ['0', '-1', 'NaN', '1.5', '9' * 5000]:
        assert client.get('/api/me/coins?before=' + value).status_code == 400
    export = client.get('/api/me/export').get_json()
    assert len(export['community_coins']) == 42
    # Passing another user ID is ignored; the session is the only authority.
    other = db.create_user(conn, 'other', 'unused')
    assert client.get(f'/api/me/coins?user_id={other}').get_json()['balance'] == 271
    with client.session_transaction() as session:
        session['_user_id'] = str(other)
    assert client.get('/api/me/coins').get_json()['balance'] == 0
    assert client.get('/api/me/coins').get_json()['entries'] == []
    client.get('/logout')
    assert client.get('/api/me/coins').status_code == 401
    conn.close()


def test_concurrent_report_awards(client):
    conn, uid, _, _, rid = setup_report(client)
    path = db.DB_FILE
    def award(_):
        with db.get_db(path) as c:
            return coins.award_report(c, rid)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(award, range(4)))
    assert sum(r['awarded'] for r in results) == 1
    assert coins.balance(conn, uid) == 66
    conn.close()


def test_cli_preview_apply_repeat_and_failure(client):
    conn, uid, _, _, rid = setup_report(client)
    args = [sys.executable, 'scripts/community_coins.py', '--db', str(db.DB_FILE), '--reason', 'Fixed the comparison', '--report-ids', str(rid)]
    preview = subprocess.run(args, capture_output=True, text=True, check=True)
    assert json.loads(preview.stdout)['coins'] == 66
    assert coins.balance(conn, uid) == 0
    applied = subprocess.run([*args, '--apply'], capture_output=True, text=True, check=True)
    assert json.loads(applied.stdout)['coins'] == 66
    repeat = subprocess.run([*args, '--apply'], capture_output=True, text=True, check=True)
    assert json.loads(repeat.stdout)['coins'] == 0
    failure = subprocess.run([*args[:-1], f'{rid},999999', '--apply'], capture_output=True, text=True)
    assert failure.returncode == 1 and not json.loads(failure.stderr)['applied']
    conn.close()


def test_upgrade_existing_schema_is_repeat_safe(client):
    conn, uid, _, _, _ = setup_report(client)
    conn.execute('DROP TABLE community_coins')
    conn.execute('ALTER TABLE games DROP COLUMN coin_key')
    conn.execute('ALTER TABLE mistakes DROP COLUMN coin_key')
    db.init_db(conn)
    db.init_db(conn)
    assert coins.balance(conn, uid) == 0
    assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
    conn.close()


def test_report_history_paginates_without_maka_lines(client):
    from tests.fixtures import make_game, make_round, make_mistake
    conn, uid, _, _, _ = setup_report(client)
    gid = db.add_game(conn, uid, make_game(rounds=[make_round(mistakes=[make_mistake() for _ in range(35)])]))
    mids = [r[0] for r in conn.execute('SELECT id FROM mistakes WHERE game_id = ?', (gid,))]
    for mid in mids:
        rid = db.submit_category_report(conn, uid, mid, 'wrong_text', reason=f'Report for {mid}')
        with conn:
            coins.award_report(conn, rid)
    with conn:
        coins.award_maka(conn, gid, uid, {'overall': 'A', 'matches': ['B']})
    first = coins.history(conn, uid)
    assert len(first['entries']) == 30
    assert first['totals']['maka_grade'] == 10
    second = coins.history(conn, uid, before=first['next_before'])
    assert len(second['entries']) == 5 and second['next_before'] is None
    assert second['totals'] == first['totals']
    assert len({r['id'] for r in first['entries'] + second['entries']}) == 35
    assert all(r['kind'] == 'report_fix' for r in first['entries'] + second['entries'])
    conn.close()


def test_history_quotes_only_the_matching_historical_mistake(client):
    conn, uid, gid, mid, rid = setup_report(client)
    _, other_mid = insert_game(uid)
    conn.execute('DELETE FROM category_reports WHERE id = ?', (rid,))
    conn.commit()
    db.create_message(conn, type='thanks', audience_user_id=uid, title=f'Fixed #{mid} / #{other_mid}',
                      body=f'<blockquote>More &lt;tiles&gt;<br>please<span class="quote-attr">'
                           f'— your report on mistake #{mid}, 2026-01-01</span></blockquote><p>Fixed.</p>')
    with conn:
        coins.backfill(conn, thanks=True)
    entries = {r['mistake_id']: r for r in coins.history(conn, uid)['entries']}
    assert entries[mid]['report_text'] == 'More <tiles>\nplease'
    assert entries[other_mid]['report_text'] is None
    assert all(r['fix_description'] is None for r in entries.values())
    conn.close()


def test_history_does_not_link_reused_mistake_id_or_other_users_report(client):
    conn, uid, gid, mid, rid = setup_report(client)
    with conn:
        coins.award_report(conn, rid)
    conn.execute('DELETE FROM games WHERE id = ?', (gid,))
    conn.commit()
    other = db.create_user(conn, 'other', 'unused')
    _, reused_mid = insert_game(other)
    assert reused_mid == mid
    db.submit_category_report(conn, other, reused_mid, 'wrong_text', reason='Private other-user report')
    entry = coins.history(conn, uid)['entries'][0]
    assert not entry['mistake_available']
    assert entry['report_text'] is None
    assert 'Private other-user report' not in json.dumps(entry)
    conn.close()


def test_historical_attribution_uses_metadata_not_the_reporters_text():
    from lib.report_quotes import quoted_report
    body = ('<blockquote>Another case — your report on mistake #123'
            '<span class="quote-attr">— your report on mistake #456, 2026-01-01</span></blockquote>')
    assert quoted_report(body, 123) is None
    assert quoted_report(body, 456) == 'Another case — your report on mistake #123'


@pytest.mark.parametrize('kind', ['wrong_text', 'complex_gap'])
def test_submission_reward_immediate_repeat_undo_and_fix(client, kind):
    conn, uid, _, mid, rid = setup_report(client)
    url = f'/api/mistakes/{mid}/report'
    first = client.post(url, json={'kind': kind, 'reason': 'My read'}).get_json()
    assert first['coins_earned'] == 7  # 10 × .655, half up
    assert first['balance'] == 7
    assert client.get('/api/me').get_json()['community_coins'] == 7
    assert client.post(url, json={'kind': kind}).get_json()['coins_earned'] == 0
    assert client.delete(url).status_code == 200
    assert client.post(url, json={'kind': kind}).get_json()['coins_earned'] == 0
    rid = client.post(url, json={'kind': kind}).get_json()['id']
    with conn:
        assert coins.award_report(conn, rid)['amount'] == 66
        db.fix_category_report(conn, rid)
    assert client.post(url, json={'kind': kind}).get_json()['coins_earned'] == 0
    assert coins.balance(conn, uid) == 73
    history = client.get('/api/me/coins').get_json()
    assert {e['kind'] for e in history['entries']} == {'report_submit', 'report_fix'}
    conn.close()


def test_submission_award_failure_rolls_back_report(client, monkeypatch):
    conn, uid, _, mid, rid = setup_report(client)
    conn.execute('DELETE FROM category_reports WHERE id = ?', (rid,))
    conn.commit()
    def fail(*args):
        raise ValueError('Invalid EV')
    monkeypatch.setattr(coins, 'award_submission', fail)
    assert client.post(f'/api/mistakes/{mid}/report', json={'kind': 'wrong_text'}).status_code == 400
    assert conn.execute('SELECT COUNT(*) FROM category_reports').fetchone()[0] == 0
    assert coins.balance(conn, uid) == 0
    conn.close()


def test_maka_immediate_reward_response(client):
    conn, uid, gid, _, _ = setup_report(client)
    url = f'/api/games/{gid}/maka-ratings'
    response = client.post(url, json={'overall': 'A', 'matches': ['B']})
    assert response.headers['X-Coins-Earned'] == '10'
    assert response.headers['X-Coins-Balance'] == '10'
    assert client.post(url, json={'overall': 'S', 'matches': ['A']}).headers['X-Coins-Earned'] == '0'
    conn.close()


def test_gain_candidates_private_sorted_unreported_and_unpaid(client):
    conn, uid, _, reported_mid, _ = setup_report(client)
    from tests.fixtures import make_game, make_round, make_mistake
    gid = db.add_game(conn, uid, make_game(rounds=[make_round(mistakes=[make_mistake() for _ in range(8)])]))
    mids = [r[0] for r in conn.execute('SELECT id FROM mistakes WHERE game_id = ?', (gid,))]
    for i, mid in enumerate(mids):
        conn.execute('UPDATE mistakes SET ev_loss = ? WHERE id = ?', (i + .655, mid))
    conn.commit()
    paid_mid = mids[-1]
    client.post(f'/api/mistakes/{paid_mid}/report', json={'kind': 'wrong_text'})
    client.delete(f'/api/mistakes/{paid_mid}/report')
    other = db.create_user(conn, 'other-gain', 'unused')
    _, other_mid = insert_game(other)
    result = client.get(f'/api/me/coins/gain?user_id={other}').get_json()['candidates']
    assert [r['id'] for r in result] == list(reversed(mids[:-1]))
    assert not {reported_mid, paid_mid, other_mid} & {r['id'] for r in result}
    assert result[0]['coins'] == 67
    client.get('/logout')
    assert client.get('/api/me/coins/gain').status_code == 401
    conn.close()


def test_ledger_migration_preserves_awards_and_sequence(client):
    conn, uid, _, _, rid = setup_report(client)
    with conn:
        coins.award_report(conn, rid)
    old_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='community_coins'").fetchone()[0]
    with conn:
        conn.execute('ALTER TABLE community_coins RENAME TO old_ledger')
        conn.execute(old_sql.replace("'report_fix', 'report_submit', 'maka_grade'", "'report_fix', 'maka_grade'"))
        conn.execute('INSERT INTO community_coins SELECT * FROM old_ledger')
        conn.execute('DROP TABLE old_ledger')
        conn.execute("UPDATE sqlite_sequence SET seq = 99 WHERE name = 'community_coins'")
    db.init_db(conn)
    db.init_db(conn)
    with conn:
        award = coins.award_submission(conn, rid)
    assert award['id'] == 100 and award['amount'] == 7
    assert coins.balance(conn, uid) == 73
    assert not conn.execute('PRAGMA foreign_key_check').fetchall()
    conn.close()


def test_gain_candidates_paginate_all_games_without_repeating_reported_hands(client):
    from tests.fixtures import make_game, make_round, make_mistake
    conn, uid, _, _, _ = setup_report(client)
    gids = []
    for _ in range(4):
        gid = db.add_game(conn, uid, make_game(rounds=[make_round(mistakes=[make_mistake() for _ in range(20)])]))
        gids.append(gid)
    conn.commit()
    first = client.get('/api/me/coins/gain').get_json()['candidates']
    assert len(first) == 30
    assert all('round_idx' in row and 'mistake_idx' in row for row in first)
    # Submitting a report between pages must not shift the remaining results.
    assert client.post(f"/api/mistakes/{first[0]['id']}/report", json={'kind': 'complex_gap'}).status_code == 200
    result = first[:]
    page = first
    while page:
        page = client.get(f"/api/me/coins/gain?before={page[-1]['id']}&before_ev={page[-1]['ev_loss']}").get_json()['candidates']
        result.extend(page)
    assert len(result) == 80
    assert len({row['id'] for row in result}) == 80
    assert {row['game_id'] for row in result} == set(gids)
    assert [row['id'] for row in result] == sorted((row['id'] for row in result), reverse=True)
    assert first[0]['id'] not in {row['id'] for row in client.get('/api/me/coins/gain').get_json()['candidates']}
    conn.close()


@pytest.mark.parametrize('cursor', ['0', '-1', 'bad', '1.2', '9223372036854775808'])
def test_gain_candidates_reject_invalid_cursor(client, cursor):
    _login(client)
    assert client.get(f'/api/me/coins/gain?before={cursor}').status_code == 400


def test_gain_paging_skips_zero_coin_hands_before_applying_page_limit(client):
    from tests.fixtures import make_game, make_round, make_mistake
    conn, uid, _, _, _ = setup_report(client)
    gid = db.add_game(conn, uid, make_game(rounds=[make_round(mistakes=[make_mistake() for _ in range(35)])]))
    mids = [row[0] for row in conn.execute('SELECT id FROM mistakes WHERE game_id = ? ORDER BY id', (gid,))]
    conn.execute('UPDATE mistakes SET ev_loss = 0.001 WHERE game_id = ?', (gid,))
    conn.execute('UPDATE mistakes SET ev_loss = 0.05 WHERE id = ?', (mids[0],))
    conn.commit()
    result = client.get('/api/me/coins/gain').get_json()['candidates']
    assert [row['id'] for row in result] == [mids[0]]
    assert result[0]['coins'] == 1
    conn.close()


def test_gain_prioritizes_high_ev_across_all_games_with_stable_tied_pagination(client):
    from tests.fixtures import make_game, make_round, make_mistake
    conn, uid, _, _, _ = setup_report(client)
    gids = [db.add_game(conn, uid, make_game(rounds=[make_round(mistakes=[make_mistake() for _ in range(40)])]))
            for _ in range(4)]
    conn.execute('UPDATE mistakes SET ev_loss = 0.05 WHERE game_id IN (?, ?, ?, ?)', gids)
    high_ids = [row[0] for row in conn.execute('SELECT id FROM mistakes WHERE game_id = ? ORDER BY id', (gids[0],))]
    for index, mid in enumerate(high_ids):
        conn.execute('UPDATE mistakes SET ev_loss = ? WHERE id = ?', (2.5 if index < 35 else 8.125, mid))
    conn.commit()
    result = []
    url = '/api/me/coins/gain'
    while True:
        page = client.get(url).get_json()['candidates']
        if not page:
            break
        result.extend(page)
        url = f"/api/me/coins/gain?before={page[-1]['id']}&before_ev={page[-1]['ev_loss']}"
    assert len(result) == 160
    assert len({row['id'] for row in result}) == 160
    assert [row['id'] for row in result[:40]] == list(reversed(high_ids))
    assert all(row['ev_loss'] >= 2.5 for row in result[:40])
    assert all(row['ev_loss'] == 0.05 for row in result[40:])
    conn.close()


@pytest.mark.parametrize('query', [
    'before=1', 'before_ev=1', 'before=1&before_ev=nan', 'before=1&before_ev=inf',
    'before=1&before_ev=bad', 'before=1&before_ev=-1', 'before=1&before_ev=0.001',
])
def test_gain_rejects_incomplete_or_invalid_ev_cursor(client, query):
    _login(client)
    assert client.get(f'/api/me/coins/gain?{query}').status_code == 400
