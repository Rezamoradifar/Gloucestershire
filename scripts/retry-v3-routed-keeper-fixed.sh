#!/usr/bin/env bash
# Resume the existing V3 TESTNET keeper; never deploy or fund a vault.
set +x
set -Eeuo pipefail
umask 077
[[ $# -eq 0 && "$(id -u)" == 0 ]] || { echo V3_KEEPER_ROOT_OR_ARGUMENTS_INVALID; exit 1; }
BASE="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
cd "$BASE"
[[ "${GLOBAL_V3_KEEPER_FIX_SHA:-}" =~ ^[a-f0-9]{40}$ && -d .git &&
   "$(git rev-parse HEAD)" == "$GLOBAL_V3_KEEPER_FIX_SHA" ]] || { echo V3_KEEPER_FIX_SHA_INVALID; exit 1; }
git diff --quiet HEAD -- scripts/install-global-v3-keeper-timer.sh \
 scripts/global-v3-auto-compound-keeper.mjs scripts/v3-keeper-receipt-poll.mjs \
 scripts/retry-v3-routed-keeper-fixed.sh package.json package-lock.json ||
 { echo V3_KEEPER_FIX_SOURCE_MODIFIED; exit 1; }
case "$(uname -m)" in
 x86_64) arch=x64;;
 aarch64|arm64) arch=arm64;;
 *) echo V3_KEEPER_UNSUPPORTED_CPU; exit 1;;
esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ ! -x "$runtime/node" ]] || export PATH="$runtime:$PATH"
timer=global-v3-routed-compound-keeper-testnet.timer
service=global-v3-routed-compound-keeper-testnet.service
if systemctl is-active --quiet "$timer"; then
 echo V3_ROUTED_KEEPER_TIMER_ALREADY_ACTIVE
 exit 0
fi
if systemctl cat "$timer" >/dev/null 2>&1 || systemctl cat "$service" >/dev/null 2>&1 || \
 [[ -e "/etc/systemd/system/$timer" || -L "/etc/systemd/system/$timer" ||
    -e "/etc/systemd/system/$service" || -L "/etc/systemd/system/$service" ]]; then
 echo V3_ROUTED_KEEPER_EXISTING_UNITS_REQUIRE_REVIEW
 exit 2
fi
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
export GLOBAL_V3_RELEASE_PROFILE=routed-testnet
bash scripts/install-global-v3-keeper-timer.sh --check
bash scripts/install-global-v3-keeper-timer.sh --install
systemctl is-active --quiet "$timer" || { echo V3_ROUTED_KEEPER_TIMER_NOT_ACTIVE; exit 1; }
echo V3_ROUTED_KEEPER_TIMER_ACTIVE_FIRST_RUN_NOT_YET_CONFIRMED
