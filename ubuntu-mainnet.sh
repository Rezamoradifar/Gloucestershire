#!/usr/bin/env bash
# Mainnet preparation only. No signer creation, testnet initialization or deployment.
set +x
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "${1:-plan}" in plan|prepare) ;; deploy) echo 'MAINNET_DEPLOYMENT_DISABLED_PREPARATION_ONLY';exit 1;; *) echo 'MAINNET_PREPARATION_ARGUMENTS_REQUIRED';exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'UNSUPPORTED_CPU';exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
local_runtime="$PWD/.runtime/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ];then export PATH="$runtime:$PATH";elif [ -x "$local_runtime/node" ];then export PATH="$local_runtime:$PATH";fi
command -v node >/dev/null || { echo 'NODE_22_12_OR_NEWER_REQUIRED';exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))throw Error("NODE_22_12_OR_NEWER_REQUIRED")'
umask 077
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/server-mainnet.mjs "$@"
