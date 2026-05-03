#!/bin/sh
# Fix ownership of mounted volumes only if not already owned by appuser
for dir in /app/data /app/mortal_analysis; do
    if [ -d "$dir" ] && [ "$(stat -c '%u' "$dir" 2>/dev/null)" != "1000" ]; then
        chown -R appuser:appuser "$dir"
    fi
done

# Drop to non-root user
exec gosu appuser "$@"
