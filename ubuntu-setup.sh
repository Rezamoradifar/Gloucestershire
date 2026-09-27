#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v curl >/dev/null || { echo 'Install curl, xz-utils and ca-certificates first.'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
version=v22.23.3
node_dir="$PWD/.runtime/node-$version-linux-$arch"
if [ ! -x "$node_dir/bin/node" ]; then
 mkdir -p .runtime
 archive="node-$version-linux-$arch.tar.xz"
 curl --fail --location --proto '=https' "https://nodejs.org/dist/$version/$archive" -o ".runtime/$archive"
 curl --fail --location --proto '=https' "https://nodejs.org/dist/$version/SHASUMS256.txt" -o .runtime/SHASUMS256.txt
 (cd .runtime && awk -v f="$archive" '$2==f {print}' SHASUMS256.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256 && tar -xJf "$archive")
fi
export PATH="$node_dir/bin:$PATH"
npm ci --ignore-scripts
npm test
node scripts/server-testnet.mjs init
