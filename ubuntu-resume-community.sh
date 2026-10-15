#!/usr/bin/env bash
# Resume after the frontend build without rebuilding or touching blockchain state.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
test -s website/dist/index.html || { echo 'The previously built frontend is missing'; exit 1; }
grep -Rl -- 'Create ticket' website/dist/assets/ >/dev/null || { echo 'The support frontend is not present in this build'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
node_root="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch"
test -x "$node_root/bin/node" || { echo 'The system-readable Node runtime is missing'; exit 1; }
export PATH="$node_root/bin:$PATH"
bash ubuntu-api.sh
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
install -d -m 755 "$stage/site"
cp -R website/dist/. "$stage/site/"
cp -R deployment-console "$stage/site/deploy"
cp scripts/install-website.sh "$stage/install.sh"
env -u GLOBAL_SITE_IP -u GLOBAL_SITE_PORT bash "$stage/install.sh"
curl -fsS --max-time 20 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/https.html"
cmp -s website/dist/index.html "$stage/https.html"
curl -fsS --max-time 10 http://127.0.0.1:3115/api/health
curl -fsS --max-time 10 http://127.0.0.1:3115/api/community/announcements
printf '\nGLOBAL_SUPPORT_AND_HTTPS_READY\n'
