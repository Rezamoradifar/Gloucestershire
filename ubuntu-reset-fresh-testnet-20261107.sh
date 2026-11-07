#!/usr/bin/env bash
# Archive one explicit Fast Testnet generation and deploy a new empty generation.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ $# -ne 3 || $1 != --execute || $2 != --expected-target || ! $3 =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo 'Usage: bash ubuntu-reset-fresh-testnet-20261107.sh --execute --expected-target 0xADDRESS'
  exit 1
fi
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in git node npm python3 systemctl flock curl; do command -v "$tool" >/dev/null; done
[ "$(df -Pk /var/lib/globaldroptrade /opt /root | awk 'NR>1 {if ($4<524288) bad=1} END {print bad+0}')" -eq 0 ] || {
  echo 'RESET_REQUIRES_512_MIB_FREE'
  exit 1
}
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
exec python3 scripts/reset-fresh-fast-testnet-20261107.py --execute --expected-target "$3"
