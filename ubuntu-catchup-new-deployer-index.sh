#!/usr/bin/env bash
# Read and verify existing testnet history without opening a signing key.
set +x
set -Eeuo pipefail
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-catchup-new-deployer-index.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'UNSUPPORTED_CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm python3; do command -v "$command" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("NODE_22_12_REQUIRED")'
umask 077
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
for attempt in {1..12}; do
 node scripts/index-new-deployer-catchup.mjs --execute
 status=$(python3 - <<'PY'
import json
with open('/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/index-catchup-status.json') as f:
    report = json.load(f)
if (report.get('chainId') != 97
        or report.get('target') != '0x4C0F6141b18971db4b14e45c0bE8CddB09febc14'
        or report.get('status') not in ('indexed', 'indexing')
        or report.get('transactionsSent') != 0
        or report.get('signerOpened') is not False):
    raise SystemExit('INDEX_CATCHUP_REPORT_REVIEW_REQUIRED')
print(report['status'])
PY
 )
 if [ "$status" = indexed ]; then echo 'NEW_DEPLOYER_INDEX_CATCHUP_COMPLETE'; exit 0; fi
 echo "INDEX_CATCHUP_MORE_WORK attempt=$attempt"
done
echo 'INDEX_CATCHUP_BOUNDED_LIMIT_REACHED_RESUME_SAME_STATE'
exit 1
