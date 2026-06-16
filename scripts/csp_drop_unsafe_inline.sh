#!/usr/bin/env bash
#
# CSP hardening step 3+4 (docs/backlogs/CSP-HARDENING.md): tighten the live
# nginx CSP by removing  'unsafe-inline'  from the  script-src  directive.
# Run as root on the prod host. Operates on every ENABLED nginx vhost whose
# CSP currently carries  script-src 'self' 'unsafe-inline'  (today: haipai.conf
# and trainer-haipai.conf). style-src 'unsafe-inline' is deliberately left
# alone — that is the separate, lower-priority secondary item.
#
# Two modes:
#   (no args)   CANARY  — add a Content-Security-Policy-Report-Only header with
#                         the strict script-src alongside the unchanged enforced
#                         one. Report-Only NEVER blocks; the browser only logs a
#                         console violation if some inline JS still tries to run.
#                         Zero risk. Watch real traffic for violations first.
#   --enforce   ENFORCE — drop 'unsafe-inline' from the real (enforced)
#                         script-src and remove the Report-Only canary line.
#
# Safe by construction: every edited file is backed up first; if `nginx -t`
# fails after editing, the originals are restored and nginx is NOT reloaded.
# Both modes are idempotent — re-running is a no-op once applied.

set -euo pipefail

MODE="${1:-canary}"
case "$MODE" in
  canary|--canary) MODE=canary ;;
  --enforce|enforce) MODE=enforce ;;
  *) echo "usage: $0 [--enforce]   (no arg = Report-Only canary)"; exit 2 ;;
esac

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (try: sudo $0 ${1:-})" >&2
  exit 1
fi

LOOSE="script-src 'self' 'unsafe-inline'"
ENABLED_DIR=/etc/nginx/sites-enabled
STAMP=$(date +%Y%m%d-%H%M%S)

# Resolve enabled vhosts (follow the symlinks to the real files) that still
# reference the loose script-src OR an existing Report-Only canary we manage.
declare -A TARGETS=()
while IFS= read -r link; do
  real=$(readlink -f "$link")
  [[ -f "$real" ]] && TARGETS["$real"]=1
done < <(grep -RlsF -e "$LOOSE" -e "Content-Security-Policy-Report-Only" "$ENABLED_DIR" 2>/dev/null || true)

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "Nothing to do: no enabled vhost carries \"$LOOSE\"."
  echo "(script-src may already be strict.)"
  exit 0
fi

echo "Mode: $MODE"
echo "Target vhost files:"; printf '  %s\n' "${!TARGETS[@]}"

declare -a BACKUPS=()
restore() {
  echo "!! Restoring originals (no reload performed)." >&2
  for b in "${BACKUPS[@]}"; do cp -p "$b" "${b%.bak-$STAMP}"; done
}

for f in "${!TARGETS[@]}"; do
  bak="${f}.bak-${STAMP}"
  cp -p "$f" "$bak"
  BACKUPS+=("$bak")

  if [[ "$MODE" == canary ]]; then
    # Insert a Report-Only twin of the enforced CSP line, with a strict
    # script-src, unless one is already present. Literal (index-based) replace
    # so the embedded single quotes need no escaping.
    if grep -qF "Content-Security-Policy-Report-Only" "$f"; then
      echo "  = $f already has a Report-Only canary; skipping."
      continue
    fi
    awk -v loose="$LOOSE" -v strict="script-src 'self'" '
      function lreplace(s, a, b,   p) {
        p = index(s, a); if (p == 0) return s
        return substr(s, 1, p-1) b substr(s, p+length(a))
      }
      { print }
      (!ins && index($0, "add_header Content-Security-Policy \"") > 0) {
        ro = lreplace($0, "Content-Security-Policy", "Content-Security-Policy-Report-Only")
        ro = lreplace(ro, loose, strict)
        print ro
        ins = 1
      }
    ' "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
    echo "  + $f: Report-Only canary added."
  else
    # ENFORCE: strict the real script-src, then drop the canary line.
    # The literal pattern only matches script-src (not style-src).
    sed -i "s|${LOOSE}|script-src 'self'|g" "$f"
    sed -i "/add_header Content-Security-Policy-Report-Only/d" "$f"
    echo "  + $f: enforced script-src is now strict; canary removed."
  fi
done

echo "Validating nginx config..."
if ! nginx -t; then
  restore
  echo "ABORTED: nginx -t failed; originals restored." >&2
  exit 1
fi

echo "Reloading nginx..."
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  nginx -s reload
fi

echo
echo "Done ($MODE). Backups: ${BACKUPS[*]}"
if [[ "$MODE" == canary ]]; then
  echo "Next: open the app, exercise every view, and confirm the browser"
  echo "console shows NO 'Content-Security-Policy-Report-Only' violations."
  echo "When clean, run:  sudo $0 --enforce"
else
  echo "Enforced. Verify the site still works and check the response header:"
  echo "  curl -skI https://<your-domain>/ | grep -i content-security-policy"
fi
