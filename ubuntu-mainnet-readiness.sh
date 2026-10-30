#!/usr/bin/env bash
# Preparation only: production asset, gas and 24-hour historical RPC checks.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "${1:-plan}" in
 plan) bash ubuntu-mainnet.sh plan; exit;;
 check) shift;;
 *) echo 'Usage: bash ubuntu-mainnet-readiness.sh plan|check --from PUBLIC_ADDRESS --rpc-file PRIVATE_FILE';exit 1;;
esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ];then export PATH="$runtime:$PATH";fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("NODE_22_12_OR_NEWER_REQUIRED")'
umask 077
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/mainnet-rpc-readiness.mjs "$@"
