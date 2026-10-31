#!/usr/bin/env bash
# Switch the fresh testnet worker to independent position-hour anniversaries.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
policy_args=(--execute)
if [[ $# = 3 && $1 = --execute && $2 = --expected-target && $3 =~ ^0x[0-9a-fA-F]{40}$ ]]; then policy_args+=(--expected-target "$3");
elif [[ $# != 1 || $1 != --execute ]]; then echo 'Usage: bash ubuntu-position-hourly.sh --execute [--expected-target 0xADDRESS]'; exit 1; fi
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[ -x "$runtime/node" ] || { echo 'MANAGED_NODE_REQUIRED'; exit 1; }
export PATH="$runtime:$PATH"
umask 077
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# A timer stop never interrupts an in-flight financial transaction.
systemctl stop globaldroptrade-zero-daily.timer
state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
flock -w 60 -E 75 "$state/run.lock" node --env-file=/etc/globaldroptrade/trades.env scripts/install-position-policy.mjs "${policy_args[@]}"
# The reviewed installer copies a complete release and installs matching status code.
bash ubuntu-enable-zero-daily.sh --fast-testnet --hourly-test --oracle-recovery
echo 'POSITION_HOURLY_WORKER_INSTALLED: inspect scheduling and actual receipts; no contract redeployment or account reset.'
