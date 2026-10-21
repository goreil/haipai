"""Community contribution awards. Callers own the transaction; helpers never commit."""

import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from lib.report_quotes import quoted_report

MAKA_COINS = 5
GAIN_CANDIDATE_LIMIT = 30


def report_coins(ev_loss, *, rate=100):
    try:
        ev = Decimal(str(ev_loss))
        if not ev.is_finite() or ev < 0 or ev > 10**12:
            raise ValueError
        return int((ev * rate).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        raise ValueError('Report has no valid EV loss; review it before awarding coins') from None


def _source_key(conn, table, row_id):
    if table not in ('games', 'mistakes'):
        raise ValueError('Invalid contribution source')
    conn.execute(
        f'UPDATE {table} SET coin_key = lower(hex(randomblob(16))) WHERE id = ? AND coin_key IS NULL',
        (row_id,),
    )
    row = conn.execute(f'SELECT coin_key FROM {table} WHERE id = ?', (row_id,)).fetchone()
    if row is None:
        raise ValueError('Contribution source no longer exists')
    return row['coin_key']


def _award(conn, *, user_id, kind, source_key, amount, title, detail, game_id=None,
           mistake_id=None, report_id=None, message_id=None):
    cur = conn.execute(
        '''INSERT INTO community_coins
           (user_id, kind, source_key, amount, title, detail, game_id, mistake_id, report_id, message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, kind, source_key) DO NOTHING''',
        (user_id, kind, source_key, amount, title, detail, game_id, mistake_id, report_id, message_id),
    )
    row = conn.execute(
        'SELECT id, amount FROM community_coins WHERE user_id = ? AND kind = ? AND source_key = ?',
        (user_id, kind, source_key),
    ).fetchone()
    return {'id': row['id'], 'amount': row['amount'], 'awarded': cur.rowcount == 1}


def award_report(conn, report_id, *, reason=None):
    if reason is not None and (not isinstance(reason, str) or len(reason) > 500):
        raise ValueError('Fix description must be text of at most 500 characters')
    row = conn.execute(
        '''SELECT r.user_id, r.mistake_id, m.game_id, m.ev_loss FROM category_reports r
           JOIN mistakes m ON m.id = r.mistake_id WHERE r.id = ?''', (report_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f'Report R-{report_id} not found')
    return _award(
        conn, user_id=row['user_id'], kind='report_fix',
        source_key=_source_key(conn, 'mistakes', row['mistake_id']), amount=report_coins(row['ev_loss']),
        title=f'Report R-{report_id} helped fix Haipai',
        detail=(f"100 × {row['ev_loss']:g} EV · mistake #{row['mistake_id']}"
                + (f" · {reason.strip()}" if reason and reason.strip() else "")),
        game_id=row['game_id'], mistake_id=row['mistake_id'], report_id=report_id,
    )


def award_submission(conn, report_id):
    """Pay once per reporter and stable hand identity, independently of fix awards."""
    row = conn.execute(
        """SELECT r.user_id, r.mistake_id, m.game_id, m.ev_loss FROM category_reports r
           JOIN mistakes m ON m.id = r.mistake_id WHERE r.id = ?""", (report_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f'Report R-{report_id} not found')
    return _award(
        conn, user_id=row['user_id'], kind='report_submit',
        source_key=_source_key(conn, 'mistakes', row['mistake_id']),
        amount=report_coins(row['ev_loss'], rate=10),
        title=f'Report R-{report_id} submitted',
        detail=f"10 × {row['ev_loss']:g} EV · mistake #{row['mistake_id']}",
        game_id=row['game_id'], mistake_id=row['mistake_id'], report_id=report_id,
    )


def gain_candidates(conn, user_id, before=None, before_ev=None):
    """Page through eligible hands by highest EV loss, without a total search limit."""
    rows = conn.execute(
        """SELECT m.id, m.game_id, m.round_name, m.round_idx, m.mistake_idx, m.turn, m.ev_loss
           FROM mistakes m JOIN games g ON g.id = m.game_id
           WHERE g.user_id = ? AND m.ev_loss >= 0.05
             AND (? IS NULL OR m.ev_loss < ? OR (m.ev_loss = ? AND m.id < ?))
             AND NOT EXISTS (SELECT 1 FROM category_reports r
                             WHERE r.user_id = ? AND r.mistake_id = m.id)
             AND NOT EXISTS (SELECT 1 FROM community_coins c
                             WHERE c.user_id = ? AND c.kind = 'report_submit' AND c.source_key = m.coin_key)
           ORDER BY m.ev_loss DESC, m.id DESC LIMIT ?""",
        (user_id, before_ev, before_ev, before_ev, before, user_id, user_id, GAIN_CANDIDATE_LIMIT),
    ).fetchall()
    return [{**dict(row), 'coins': report_coins(row['ev_loss'], rate=10)} for row in rows
            if report_coins(row['ev_loss'], rate=10) > 0]


def award_maka(conn, game_id, user_id, ratings, *, historical=False):
    game = conn.execute('SELECT user_id FROM games WHERE id = ?', (game_id,)).fetchone()
    if game is None or game['user_id'] != user_id:
        raise ValueError('Game does not belong to contributor')
    grades = [('overall', 'Overall grade', ratings.get('overall'))]
    grades.extend((f'hand:{i}', f'Hand {i + 1}', grade) for i, grade in enumerate(ratings.get('matches', [])))
    grades = [g for g in grades if g[2]]
    if not grades:
        return []
    key = _source_key(conn, 'games', game_id)
    return [_award(
        conn, user_id=user_id, kind='maka_grade', source_key=f'{key}:{slot}', amount=MAKA_COINS,
        title=f'Maka grade · game #{game_id}',
        detail=f'{label}: {grade} · ' + ('Previously contributed' if historical else 'Helps improve Haipai rankings'),
        game_id=game_id,
    ) for slot, label, grade in grades]


def backfill(conn, *, report_ids=(), thanks=False, maka=False, reason=None):
    """Reconstruct known contributions, failing on ambiguous/missing history.

    A dry run uses an in-memory copy. The apply caller wraps this in one
    transaction, including schema initialization before calling this function.
    """
    results = []
    if thanks:
        for message in conn.execute("SELECT * FROM messages WHERE type = 'thanks'").fetchall():
            uid = message['audience_user_id']
            # Titles use #mistake IDs. In HTML only inspect explicit mistake
            # references, not arbitrary numbers, colors, or commit hashes.
            mids = {int(n) for n in re.findall(r'#(\d+)\b', message['title'])}
            mids.update(int(n) for n in re.findall(
                r'(?:your report on mistake #|#mistake=)(\d+)\b', message['body']))
            if uid is None or not mids:
                raise ValueError(f"Thanks message {message['id']} needs manual contribution mapping")
            for mid in sorted(mids):
                row = conn.execute(
                    '''SELECT m.ev_loss, m.game_id FROM mistakes m JOIN games g ON g.id = m.game_id
                       WHERE m.id = ? AND g.user_id = ?''', (mid, uid),
                ).fetchone()
                if row is None:
                    raise ValueError(f"Thanks message {message['id']}: missing or unowned mistake {mid}")
                results.append(_award(
                    conn, user_id=uid, kind='report_fix', source_key=_source_key(conn, 'mistakes', mid),
                    amount=report_coins(row['ev_loss']), title=f'Past report · mistake #{mid}',
                    detail=f"100 × {row['ev_loss']:g} EV · From your earlier thank-you: {message['title']}",
                    game_id=row['game_id'], mistake_id=mid, message_id=message['id'],
                ))
    for rid in sorted(set(report_ids)):
        results.append(award_report(conn, rid, reason=reason))
    if maka:
        for game in conn.execute('SELECT id, user_id, maka_ratings_json FROM games '
                                 'WHERE maka_ratings_json IS NOT NULL').fetchall():
            results.extend(award_maka(conn, game['id'], game['user_id'],
                                      json.loads(game['maka_ratings_json']), historical=True))
    return {'awards': sum(r['awarded'] for r in results),
            'coins': sum(r['amount'] for r in results if r['awarded'])}


def balance(conn, user_id):
    return conn.execute('SELECT COALESCE(SUM(amount), 0) FROM community_coins WHERE user_id = ?',
                        (user_id,)).fetchone()[0]


def history(conn, user_id, before=None):
    # Pagination applies only to reports; Maka remains one all-time total,
    # regardless of how many grades were saved or which page is requested.
    rows = conn.execute(
        """SELECT c.id, c.kind, c.amount, c.title, c.detail, c.created_at,
                  c.mistake_id, c.report_id, c.message_id,
                  m.id AS existing_mistake_id, g.user_id AS game_owner,
                  r.reason AS report_text, r.suggested_category,
                  msg.body AS thanks_body
           FROM community_coins c
           LEFT JOIN mistakes m ON m.id = c.mistake_id AND m.coin_key = c.source_key
           LEFT JOIN games g ON g.id = m.game_id
           LEFT JOIN category_reports r ON r.id = c.report_id
             AND r.mistake_id = m.id AND r.user_id = c.user_id
           LEFT JOIN messages msg ON msg.id = c.message_id
             AND msg.audience_user_id = c.user_id AND msg.type = 'thanks'
             AND msg.created_at <= c.created_at
           WHERE c.user_id = ? AND c.kind IN ('report_fix', 'report_submit') AND (? IS NULL OR c.id < ?)
           ORDER BY c.id DESC LIMIT 31""",
        (user_id, before, before),
    ).fetchall()
    entries = []
    for row in rows[:30]:
        entry = dict(row)
        body = entry.pop('thanks_body')
        message_id = entry.pop('message_id')
        if not entry['report_text'] and body:
            entry['report_text'] = quoted_report(body, entry['mistake_id'])
        existing_id = entry.pop('existing_mistake_id')
        game_owner = entry.pop('game_owner')
        entry['mistake_available'] = existing_id is not None and game_owner == user_id
        # Old awards embedded the formula, ID and optional fix in detail.
        # Present only an actual fix description, never the thank-you wrapper.
        detail = entry['detail']
        parts = detail.split(' · ', 2)
        entry['fix_description'] = None
        if not message_id and detail.startswith('100 × ') and len(parts) == 3:
            entry['fix_description'] = parts[2]
        entries.append(entry)
    totals = {r['kind']: r['amount'] for r in conn.execute(
        'SELECT kind, SUM(amount) AS amount FROM community_coins WHERE user_id = ? GROUP BY kind', (user_id,))}
    return {'balance': sum(totals.values()), 'totals': totals, 'maka_rate': MAKA_COINS,
            'entries': entries, 'next_before': rows[29]['id'] if len(rows) > 30 else None}
