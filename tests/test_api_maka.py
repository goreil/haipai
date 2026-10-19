"""Manual Maka grades: persistence, validation, and ownership."""
import json

import pytest

import db
from tests.conftest import insert_game
from tests.test_api_game import _login


def setup_game(client):
    _login(client)
    return insert_game(client.get('/api/me').get_json()['id'], with_mistakes=False)[0]


def test_save_edit_clear(client):
    gid = setup_game(client)
    url = f'/api/games/{gid}'
    original = client.get(url).get_json()
    assert original['maka_ratings'] is None
    for payload, expected in [
        ({'overall': ' b+ ', 'matches': ['S']}, {'overall': 'B+', 'matches': ['S']}),
        ({'overall': None, 'matches': ['a+']}, {'overall': None, 'matches': ['A+']}),
        ({'overall': '', 'matches': ['']}, {'overall': None, 'matches': [None]}),
    ]:
        assert client.post(url + '/maka-ratings', json=payload).get_json() == expected
        saved = client.get(url).get_json()
        assert saved['maka_ratings'] == expected
        assert saved['rounds'] == original['rounds']
        assert saved['summary'] == original['summary']


@pytest.mark.parametrize('payload', [None, [], {}, {'overall': 'A', 'matches': []},
    {'overall': 1, 'matches': ['S']}, {'overall': '<x>', 'matches': ['S']},
    {'overall': 'A', 'matches': [False]}, {'overall': 'A', 'matches': 'S'}])
def test_invalid(client, payload):
    gid = setup_game(client)
    assert client.post(f'/api/games/{gid}/maka-ratings', json=payload).status_code == 400
    assert client.get(f'/api/games/{gid}').get_json()['maka_ratings'] is None


def test_access(client):
    gid = setup_game(client)
    payload = {'overall': 'A', 'matches': ['S']}
    conn = db.get_db()
    other = db.create_user(conn, 'other', 'unused')
    other_gid = insert_game(other)[0]
    assert client.post(f'/api/games/{other_gid}/maka-ratings', json=payload).status_code == 404
    assert client.post('/api/games/999999/maka-ratings', json=payload).status_code == 404
    client.post(f'/api/games/{gid}/maka-ratings', json=payload)
    token = db.get_or_create_share_token(conn, gid, client.get('/api/me').get_json()['id'])
    assert 'maka_ratings' not in db.get_game_by_share_token(conn, token)
    conn.close()
    client.get('/logout')
    assert client.post(f'/api/games/{gid}/maka-ratings', json=payload).status_code == 401


def test_repeated_hands_and_migration(client):
    from db.schema import migrate
    from tests.fixtures import make_game, make_round

    setup_game(client)
    uid = client.get('/api/me').get_json()['id']
    conn = db.get_db()
    gid = db.add_game(conn, uid, make_game(rounds=[
        make_round(mistakes=[]), make_round(mistakes=[]), make_round(mistakes=[]),
    ]))
    # Simulate an existing installation, then run the additive migration twice.
    conn.execute('ALTER TABLE games DROP COLUMN maka_ratings_json')
    conn.commit()
    migrate(conn)
    migrate(conn)
    conn.commit()
    payload = {'overall': 'B+', 'matches': ['A+', None, 'C']}
    assert client.post(f'/api/games/{gid}/maka-ratings', json=payload).status_code == 200
    assert db.get_game(conn, gid, uid)['maka_ratings'] == payload
    conn.close()


def test_admin_counts_new_grades_and_marks_undated(client):
    gid = setup_game(client)
    uid = client.get('/api/me').get_json()['id']
    conn = db.get_db()
    conn.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (uid,))
    conn.commit()
    # Legacy grades on games uploaded before the ranking update have no
    # trustworthy save time, even when the values are present today.
    old_gid = insert_game(uid, with_mistakes=False)[0]
    conn.execute(
        "UPDATE games SET created_at = '2026-09-01 00:00:00', maka_ratings_json = ? WHERE id = ?",
        (json.dumps({'overall': 'A', 'matches': ['B']}), old_gid),
    )
    conn.commit()

    url = f'/api/games/{gid}/maka-ratings'
    assert client.post(url, json={'overall': 'A', 'matches': ['B']}).status_code == 200
    stats = client.get('/api/admin/stats').get_json()['maka_ranks']
    assert stats['count'] == 2
    assert stats['undated'] == 2

    # Editing an existing grade does not count as another addition.
    client.post(url, json={'overall': 'S', 'matches': ['B']})
    assert client.get('/api/admin/stats').get_json()['maka_ranks']['count'] == 2
    client.post(url, json={'overall': None, 'matches': ['B']})
    assert client.get('/api/admin/stats').get_json()['maka_ranks']['count'] == 1
    client.post(url, json={'overall': 'S', 'matches': ['B']})
    assert client.get('/api/admin/stats').get_json()['maka_ranks']['count'] == 2
    conn.close()


def test_maka_date_migration_backfills_only_recent_games(client):
    from db.schema import migrate

    gid = setup_game(client)
    uid = client.get('/api/me').get_json()['id']
    old_gid = insert_game(uid, with_mistakes=False)[0]
    conn = db.get_db()
    for game_id, created in [(gid, '2026-09-23 00:00:00'), (old_gid, '2026-09-01 00:00:00')]:
        conn.execute(
            'UPDATE games SET created_at = ?, maka_ratings_json = ? WHERE id = ?',
            (created, json.dumps({'overall': 'A', 'matches': ['B']}), game_id),
        )
    conn.execute('ALTER TABLE games DROP COLUMN maka_ratings_added_at_json')
    migrate(conn)
    migrate(conn)
    assert db.admin_maka_rank_stats(conn)['count'] == 2
    assert db.admin_maka_rank_stats(conn)['undated'] == 2
    conn.close()
