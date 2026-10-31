#!/usr/bin/env bash
# Replace the known test generation once, preserving its full financial history.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-reset-fast-testnet.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm python3 systemctl flock curl; do command -v "$tool" >/dev/null; done
[ "$(df -Pk /var/lib/globaldroptrade /opt /root | awk 'NR>1 {if ($4<524288) bad=1} END {print bad+0}')" -eq 0 ] || { echo 'RESET_REQUIRES_512_MIB_FREE'; exit 1; }
python3 scripts/reset-fast-testnet-20261031.py --execute
