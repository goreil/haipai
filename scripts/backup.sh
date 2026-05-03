#!/bin/sh
# Daily SQLite backup for Haipai
# Usage: Run via cron on the Docker host, e.g.:
#   0 3 * * * /opt/haipai/backup.sh >> /var/log/haipai-backup.log 2>&1
#
# Performs a safe online backup using SQLite's .backup command (handles WAL correctly).
# Keeps the last RETENTION_DAYS backups. Offsite sync is optional via OFFSITE_DIR.

set -eu

COMPOSE_DIR="${COMPOSE_DIR:-/opt/haipai}"
BACKUP_DIR="${BACKUP_DIR:-/opt/haipai/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
OFFSITE_DIR="${OFFSITE_DIR:-}"   # e.g. /mnt/backup/haipai or s3://bucket/haipai
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/games-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

echo "[$TIMESTAMP] Starting backup..."

# Use sqlite3 .backup for a consistent snapshot (safe with WAL mode + concurrent writes)
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T app \
    python3 -c "
import sqlite3, sys
src = sqlite3.connect('/app/data/games.db')
dst = sqlite3.connect('/dev/stdout')
src.backup(dst)
src.close()
" > "$BACKUP_FILE" 2>/dev/null

# Fallback: if the python approach fails, copy the file directly
if [ ! -s "$BACKUP_FILE" ]; then
    echo "Python backup failed, falling back to docker cp..."
    rm -f "$BACKUP_FILE"
    # Checkpoint WAL first, then copy
    docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T app \
        python3 -c "import sqlite3; sqlite3.connect('/app/data/games.db').execute('PRAGMA wal_checkpoint(TRUNCATE)')"
    CONTAINER=$(docker compose -f "$COMPOSE_DIR/docker-compose.yml" ps -q app)
    docker cp "$CONTAINER:/app/data/games.db" "$BACKUP_FILE"
fi

if [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$TIMESTAMP] Backup created: $BACKUP_FILE ($SIZE)"
else
    echo "[$TIMESTAMP] ERROR: Backup file is empty or missing!" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Verify the backup is a valid SQLite database
if ! sqlite3 "$BACKUP_FILE" "SELECT count(*) FROM games;" > /dev/null 2>&1; then
    echo "[$TIMESTAMP] ERROR: Backup integrity check failed!" >&2
    exit 1
fi
echo "[$TIMESTAMP] Integrity check passed"

# Prune old backups
DELETED=$(find "$BACKUP_DIR" -name "games-*.db" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo "[$TIMESTAMP] Pruned $DELETED backup(s) older than $RETENTION_DAYS days"
fi

# Optional offsite copy
if [ -n "$OFFSITE_DIR" ]; then
    if echo "$OFFSITE_DIR" | grep -q "^s3://"; then
        aws s3 cp "$BACKUP_FILE" "$OFFSITE_DIR/games-$TIMESTAMP.db"
    else
        mkdir -p "$OFFSITE_DIR"
        cp "$BACKUP_FILE" "$OFFSITE_DIR/games-$TIMESTAMP.db"
    fi
    echo "[$TIMESTAMP] Offsite copy completed: $OFFSITE_DIR"
fi

echo "[$TIMESTAMP] Backup complete"
