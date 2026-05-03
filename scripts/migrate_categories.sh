#!/bin/bash
# Run this on the server after git pull + docker compose up -d --build
# Migrates old category codes and recomputes stats.

set -e

echo "=== Migrating category codes ==="
docker compose exec app python3 -c "
import db
conn = db.get_db()
# Collapse old sub-categories into 1A
for old in ('1B','1C','1D','1E'):
    n = conn.execute('UPDATE mistakes SET category=? WHERE category=?', ('1A', old)).rowcount
    if n: print(f'{old} -> 1A: {n}')
# Renumber (highest first to avoid collisions)
for old, new in [('5B','6B'),('5A','6A'),('4B','5B'),('4A','5A'),('3C','4C'),('3B','4B'),('3A','4A'),('2C','3C'),('2B','3B'),('2A','3A'),('1V','2A')]:
    n = conn.execute('UPDATE mistakes SET category=? WHERE category=?', (new, old)).rowcount
    if n: print(f'{old} -> {new}: {n}')
conn.commit()
conn.close()
print('Categories migrated')
"

echo ""
echo "=== Recomputing stats ==="
docker compose exec app python3 -c "
import db
conn = db.get_db()
for g in conn.execute('SELECT id FROM games').fetchall():
    db.compute_summary_for_game(conn, g['id'])
conn.close()
print('Stats recomputed')
"

echo ""
echo "=== Done ==="
echo "Now re-run categorization with force to apply new 2A detection + labels:"
echo "  docker compose exec app python3 -c \"import db; from mj_categorize import categorize_game_db; conn = db.get_db(); [categorize_game_db(conn, r['id'], force=True) for r in conn.execute('SELECT id FROM games WHERE mortal_file IS NOT NULL').fetchall()]; conn.commit(); print('Done')\""
