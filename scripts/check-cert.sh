#!/bin/sh
# Check TLS certificate expiry for Haipai
# Usage: Run via cron, e.g.:
#   0 8 * * * /opt/haipai/check-cert.sh >> /var/log/haipai-cert.log 2>&1
#
# Exits 0 if cert is valid for >WARN_DAYS, exits 1 otherwise.
# Set WEBHOOK_URL to receive alerts (Discord, Slack, ntfy, etc.)

set -eu

DOMAIN="${DOMAIN:-haipai.ylue.de}"
WARN_DAYS="${WARN_DAYS:-14}"
WEBHOOK_URL="${WEBHOOK_URL:-}"
TIMESTAMP="$(date +%Y-%m-%d\ %H:%M:%S)"

# Get cert expiry date
EXPIRY=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//')

if [ -z "$EXPIRY" ]; then
    MSG="[$TIMESTAMP] ERROR: Could not retrieve certificate for $DOMAIN"
    echo "$MSG" >&2
    if [ -n "$WEBHOOK_URL" ]; then
        curl -sf -d "$MSG" "$WEBHOOK_URL" > /dev/null 2>&1 || true
    fi
    exit 1
fi

# Calculate days until expiry
EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [ "$DAYS_LEFT" -le 0 ]; then
    MSG="[$TIMESTAMP] CRITICAL: Certificate for $DOMAIN has EXPIRED ($EXPIRY)"
    echo "$MSG" >&2
    if [ -n "$WEBHOOK_URL" ]; then
        curl -sf -d "$MSG" "$WEBHOOK_URL" > /dev/null 2>&1 || true
    fi
    exit 1
elif [ "$DAYS_LEFT" -le "$WARN_DAYS" ]; then
    MSG="[$TIMESTAMP] WARNING: Certificate for $DOMAIN expires in $DAYS_LEFT days ($EXPIRY)"
    echo "$MSG" >&2
    if [ -n "$WEBHOOK_URL" ]; then
        curl -sf -d "$MSG" "$WEBHOOK_URL" > /dev/null 2>&1 || true
    fi
    exit 1
else
    echo "[$TIMESTAMP] OK: Certificate for $DOMAIN valid for $DAYS_LEFT days (expires $EXPIRY)"
    exit 0
fi
