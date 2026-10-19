#!/usr/bin/env python3
"""Preview or apply community coin awards. Report IDs are category_reports.id.

Examples (from the repository root):
  .venv/bin/python scripts/community_coins.py --db games.db --report-ids 12,34
  docker compose exec -T app python scripts/community_coins.py --report-ids 12,34 --apply
  docker compose exec -T app python scripts/community_coins.py --backfill-thanks --backfill-maka --apply

Default is a read-only preview against an in-memory copy of the database.
Output is JSON, including each new award and per-user balances. --apply is
transactional and idempotent; missing sources abort the entire award batch.
"""

import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402
from db.coins import backfill  # noqa: E402


def parse_ids(value):
    parts = re.split(r'[,;\s]+', value.strip())
    if not parts or any(len(p) > 19 or not re.fullmatch(r'[1-9][0-9]*', p) or int(p) >= 2**63 for p in parts):
        raise argparse.ArgumentTypeError('Use positive report IDs separated by commas, spaces, or semicolons')
    return sorted({int(p) for p in parts})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--db', default=os.environ.get('DB_PATH', str(db.DB_FILE)))
    parser.add_argument('--report-ids', type=parse_ids, default=[])
    parser.add_argument('--backfill-thanks', action='store_true')
    parser.add_argument('--backfill-maka', action='store_true')
    parser.add_argument('--reason', help='Optional short fix description retained in the award record (not shown in Activity)')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not (args.report_ids or args.backfill_thanks or args.backfill_maka):
        parser.error('Choose --report-ids, --backfill-thanks, and/or --backfill-maka')
    path = Path(args.db).resolve()
    if not path.is_file():
        parser.error(f'Database not found: {path}')
    source = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    if args.apply:
        source.close()
        conn = db.get_db(path)
        # The deployed app owns schema migrations. Do not change schema from
        # an award operation, especially if the batch cannot be completed.
    else:
        conn = sqlite3.connect(':memory:')
        source.backup(conn)
        source.close()
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        db.init_db(conn)
        conn.commit()
    try:
        # Serialize against incoming contributions so the previewed new rows
        # and returned totals belong to this complete award transaction.
        conn.execute('BEGIN IMMEDIATE')
        previous_id = conn.execute('SELECT COALESCE(MAX(id), 0) FROM community_coins').fetchone()[0]
        result = backfill(conn, report_ids=args.report_ids, thanks=args.backfill_thanks,
                          maka=args.backfill_maka, reason=args.reason)
        entries = [dict(r) for r in conn.execute(
            '''SELECT c.id, c.user_id, u.username, c.kind, c.amount, c.title, c.detail
               FROM community_coins c JOIN users u ON u.id = c.user_id WHERE c.id > ? ORDER BY c.id''',
            (previous_id,),
        )]
        balances = [dict(r) for r in conn.execute(
            '''SELECT u.id AS user_id, u.username, SUM(c.amount) AS balance
               FROM community_coins c JOIN users u ON u.id = c.user_id GROUP BY u.id ORDER BY balance DESC''')]
        if args.apply:
            conn.commit()
        else:
            conn.rollback()
        print(json.dumps({'applied': args.apply, **result, 'entries': entries, 'balances': balances}, ensure_ascii=False))
    except (ValueError, LookupError, sqlite3.Error) as exc:
        conn.rollback()
        print(json.dumps({'error': str(exc), 'applied': False}), file=sys.stderr)
        return 1
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
