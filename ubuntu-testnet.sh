#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
node_dir="$PWD/.runtime/node-v22.23.3-linux-$arch"
[ -x "$node_dir/bin/node" ] || { echo 'Run bash ubuntu-setup.sh first.'; exit 1; }
export PATH="$node_dir/bin:$PATH"
node scripts/server-testnet.mjs "${1:-deploy}"
