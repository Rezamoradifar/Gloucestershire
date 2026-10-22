#!/usr/bin/env bash
# Enable only the funded, council-authorized daily plan on the connected state copy.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --env-file=/etc/globaldroptrade/trades.env scripts/prepare-deferred-automation.mjs
bash ubuntu-automation.sh
