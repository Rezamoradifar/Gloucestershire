#!/usr/bin/env bash
# Mobile-safe, one-shot, isolated TESTNET V3 frontend release launcher.
# Never deploys a contract, moves assets, or changes the legacy backend.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ $# -eq 1 && "$1" == --install ]] ||
 { echo "Usage: bash scripts/launch-v3-site-after-deployment.sh --install"; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo V3_SITE_ROOT_REQUIRED; exit 1; }
# Load the existing pinned Node installation BEFORE checking commands. New
# Android SSH sessions usually do not carry a previous shell's PATH.
arch="$(uname -m)"
if [[ "$arch" == x86_64 ]]; then arch=x64; elif [[ "$arch" == aarch64 ]]; then arch=arm64; else echo V3_SITE_UNSUPPORTED_ARCH; exit 1; fi
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for command in systemd-run systemctl git node; do
 command -v "$command" >/dev/null || { echo "V3_SITE_MISSING_$command"; exit 1; }
done
[[ -d .git ]] || { echo V3_SITE_GIT_CHECKOUT_REQUIRED; exit 1; }
# Finite, read-only proof and RPC preflight before even starting a service.
# If V3 has NOT been successfully deployed, no release starts.
node scripts/verify-v3-site-deployment.mjs --check
if systemctl list-units --all --no-legend --plain 'global-v3-site-*.service' |
    grep -E 'running|activating' >/dev/null; then
 echo V3_SITE_INSTALL_ALREADY_RUNNING; exit 1;
fi
sha="$(git rev-parse HEAD)"
unit="global-v3-site-$(printf %.10s "$sha")-$(date -u +%s)"
if [[ "${GLOBAL_V3_RELEASE_PROFILE:-}" == routed-testnet ]]; then
 state_dir=/var/lib/globaldroptrade/v3-routed-testnet
 install -d -m 700 "$state_dir"
 state_tmp=$(mktemp "$state_dir/.site-unit.XXXXXX")
 printf '%s.service\n' "$unit" > "$state_tmp"
 chmod 600 "$state_tmp"
 mv -f -- "$state_tmp" "$state_dir/site-install-unit"
fi
case "${GLOBAL_V3_RELEASE_PROFILE:-}" in
 '') systemd-run --unit="$unit" --collect --property=TimeoutStartSec=3600 \
       /bin/bash "$PWD/scripts/install-v3-site-when-verified.sh" --install ;;
 routed-testnet) systemd-run --unit="$unit" --collect --property=TimeoutStartSec=3600 \
       --setenv=GLOBAL_V3_RELEASE_PROFILE=routed-testnet \
       /bin/bash "$PWD/scripts/install-v3-site-when-verified.sh" --install ;;
 *) echo V3_SITE_RELEASE_PROFILE_INVALID; exit 1 ;;
esac
echo "V3_SITE_SERVICE_STARTED=$unit.service"
echo "V3_SITE_REVIEWED_RELEASE_SHA=$sha"
echo "V3_SITE_LOG_COMMAND=journalctl -u $unit.service -n 80 --no-pager -o cat"
echo "V3_SITE_INSTALL_ONLY_CONFIRMED_AFTER=V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED"
