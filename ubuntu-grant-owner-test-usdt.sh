#!/usr/bin/env bash
# Exactly one 10,000,000 TUSDT wallet grant; no deposit or vault changes.
set +x
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
command -v flock >/dev/null
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[ -x "$runtime/node" ] || { echo 'Existing Node runtime missing'; exit 1; }
export PATH="$runtime:$PATH"
test -s /etc/globaldroptrade/trades.env
umask 077
state=/var/lib/globaldroptrade/test-token-grants/owner-10m-20261019
oracle_state=/var/lib/globaldroptrade/oracle-maintenance-v1
for dir in "$state" "$oracle_state"; do
 if [ ! -e "$dir" ]; then mkdir -p -m 700 "$dir"; fi
 [ -d "$dir" ] && [ ! -L "$dir" ] && [ "$(stat -c '%u:%a' "$dir")" = '0:700' ] || { echo 'Root-only state directory required'; exit 1; }
done
exec 8>"$state/run.lock"
flock -n 8 || { echo 'This grant is already running'; exit 1; }
exec 9>"$oracle_state/run.lock"
flock -w 45 9 || { echo 'Oracle maintenance is busy; re-run this command shortly'; exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
echo 'Grant: 10,000,000 TEST USDT on BNB Testnet 97. Maximum fee: 0.001 test BNB.'
node --env-file=/etc/globaldroptrade/trades.env scripts/grant-owner-test-usdt.mjs
