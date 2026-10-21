#!/usr/bin/env bash
set -Eeuo pipefail
# Frontend-only deployment. Never touches wallets, contracts, secrets or databases.
REPO="https://github.com/Rezamoradifar/Gloucestershire.git"
BRANCH="feature/global-theme-brand-20261021"
EXPECTED_HOST="vps-cosmos-8569"
DOMAIN="globaldroptrade.com"
: "${SITE_ROOT:?Set SITE_ROOT to the verified absolute Nginx static root (not / or a parent directory)}"
case "$SITE_ROOT" in /*) ;; *) echo "SITE_ROOT must be absolute" >&2; exit 1;; esac
SITE_ROOT="${SITE_ROOT%/}"
case "$SITE_ROOT" in /|/etc|/var|/var/www|/home|/root|/opt|/usr|/srv) echo "Unsafe SITE_ROOT" >&2; exit 1;; esac
[ "$(hostname)" = "$EXPECTED_HOST" ] || { echo "Unexpected hostname. Stop." >&2; exit 1; }
[ -d "$SITE_ROOT" ] && [ -f "$SITE_ROOT/index.html" ] || { echo "Static root/index.html missing. Stop." >&2; exit 1; }
for cmd in git npm node nginx tar rsync mktemp; do command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 1; }; done
nginx -t
echo "Target: $SITE_ROOT ; domain: $DOMAIN"
echo "Check that SITE_ROOT matches the active Nginx server block before proceeding."
[ "${CONFIRM_SITE_ROOT:-}" = "$SITE_ROOT" ] || { echo "Set CONFIRM_SITE_ROOT equal to SITE_ROOT after verifying Nginx configuration." >&2; exit 1; }
work="$(mktemp -d /tmp/global-ui.XXXXXXXX)"
trap 'rm -rf "$work"' EXIT
git clone --depth 1 --branch "$BRANCH" "$REPO" "$work/repo"
cd "$work/repo/website"
npm ci --ignore-scripts
npm test -- --run
npm run build
[ -f dist/index.html ] || { echo "Missing build output" >&2; exit 1; }
backup="/var/backups/globaldroptrade/ui-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
mkdir -p "$(dirname "$backup")"
tar -czf "$backup" -C "$SITE_ROOT" .
echo "Backup: $backup"
# Only static frontend assets are changed; preserve server-side files, configs and uploads.
rsync -a dist/ "$SITE_ROOT/"
nginx -t
curl --fail --silent --show-error --location --max-time 20 "https://$DOMAIN/" >/dev/null || {
 echo "HTTP check failed; restore static root from $backup after investigating." >&2
 exit 1
}
echo "Frontend deployed; financial payouts NOT modified. Backup: $backup"
