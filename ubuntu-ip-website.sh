#!/usr/bin/env bash
# Build the current frontend and install a separate temporary IPv4 virtual host.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root: sudo bash ubuntu-ip-website.sh 104.167.16.102'; exit 1; }
export GLOBAL_SITE_IP=${1:?Pass the server public IPv4 address}
export GLOBAL_SITE_PORT=${2:-80}
python3 - "$GLOBAL_SITE_IP" "$GLOBAL_SITE_PORT" <<'PY'
import ipaddress,sys
ipaddress.IPv4Address(sys.argv[1])
port=int(sys.argv[2]); assert 1<=port<=65535 and str(port)==sys.argv[2], 'Invalid port'
PY
for tool in nginx curl tar xz sha256sum systemctl; do command -v "$tool" >/dev/null || { echo "Missing dependency: $tool"; exit 1; }; done
nginx -t
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
version=v22.23.3
node_dir="$PWD/.runtime/node-$version-linux-$arch"
if [ ! -x "$node_dir/bin/node" ]; then
 mkdir -p .runtime
 archive="node-$version-linux-$arch.tar.xz"
 curl --fail --location --retry 2 --connect-timeout 20 --max-time 300 --proto '=https' "https://nodejs.org/dist/$version/$archive" -o ".runtime/$archive"
 curl --fail --location --retry 2 --connect-timeout 20 --max-time 60 --proto '=https' "https://nodejs.org/dist/$version/SHASUMS256.txt" -o .runtime/SHASUMS256.txt
 (cd .runtime && awk -v f="$archive" '$2==f {print}' SHASUMS256.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256 && tar -xJf "$archive")
fi
export PATH="$node_dir/bin:$PATH"
bash scripts/website-assets.sh
npm ci --prefix website --include=dev --ignore-scripts --no-audit --no-fund
npm run build --prefix website
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
install -d -m 755 "$stage/site"
cp -R website/dist/. "$stage/site/"
cp -R deployment-console "$stage/site/deploy"
cp scripts/install-website.sh "$stage/install.sh"
bash "$stage/install.sh"
echo 'Frontend installed over HTTP. No blockchain transaction was sent.'
