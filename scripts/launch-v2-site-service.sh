#!/usr/bin/env bash
# Start the guarded V2 testnet frontend release under systemd, not a mobile SSH
# session. Does not skip any required tests or modify API, wallet or contract.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ "$#" -eq 1 && "$1" == --install ]] || { echo "Usage: bash scripts/launch-v2-site-service.sh --install"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo V2_SITE_SERVICE_ROOT_REQUIRED; exit 1; }
for name in systemd-run systemctl git; do command -v "$name" >/dev/null || { echo "V2_SITE_SERVICE_MISSING_$name"; exit 1; }; done
[ -d .git ] && [ -f ubuntu-global-v2-site.sh ] || { echo V2_SITE_SERVICE_CHECKOUT_REQUIRED; exit 1; }
# Do not start multiple high-resource installs of this website.
if systemctl list-units --all --no-legend --plain 'global-v2-release-*.service' \
    | grep -E 'running|activating' >/dev/null; then
 echo V2_SITE_SERVICE_ALREADY_RUNNING; exit 1;
fi
sha=$(git rev-parse HEAD)
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo V2_SITE_SERVICE_SHA_INVALID; exit 1; }
short=$(printf "%.10s" "$sha")
unit="global-v2-release-$short-$(date -u +%s)"
root=$PWD
systemd-run --unit="$unit" --collect --property=TimeoutStartSec=3600 \
 --property=KillMode=control-group \
 /bin/bash "$root/scripts/run-guarded-v2-site.sh" --install
echo "V2_SITE_SERVICE_STARTED=$unit"
echo "V2_SITE_RELEASE_SHA=$sha"
echo "V2_SITE_STATUS_COMMAND=systemctl status $unit.service --no-pager"
echo "V2_SITE_LOG_COMMAND=journalctl -u $unit.service -n 50 --no-pager -o cat"
