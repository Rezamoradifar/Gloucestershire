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
https_ready=0
for attempt in 1 2 3 4 5; do
 if curl -fsS --noproxy '*' --max-time 10 --resolve globaldroptrade.com:443:127.0.0.1 \
   -H 'Cache-Control: no-cache' "https://globaldroptrade.com/?verify_release=$$" -o "$stage/https.html" \
   && cmp -s website/dist/index.html "$stage/https.html"; then https_ready=1; break; fi
 sleep 1
done
[ "$https_ready" -eq 1 ] || { echo 'HTTPS release does not match the build; connection not confirmed'; exit 1; }
curl -fsS --max-time 10 http://127.0.0.1:3115/api/health
curl -fsS --max-time 10 http://127.0.0.1:3115/api/community/announcements
curl -fsS --max-time 10 http://127.0.0.1:3115/api/config -o "$stage/local-config.json"
curl -fsS --noproxy '*' --max-time 10 --resolve globaldroptrade.com:443:127.0.0.1 \
  -H 'Cache-Control: no-cache' "https://globaldroptrade.com/api/config?verify_release=$" -o "$stage/public-config.json"
node --input-type=module - "$stage/local-config.json" "$stage/public-config.json" "${GLOBAL_NEW_VAULT:-}" <<'NODE'
import fs from 'node:fs';
const [localFile,publicFile,expected]=process.argv.slice(2);
const local=JSON.parse(fs.readFileSync(localFile));
const published=JSON.parse(fs.readFileSync(publicFile));
const norm=v=>(v||'').toLowerCase();
if(local.chainId!==published.chainId||norm(local.contract)!==norm(published.contract))throw Error('Public API config does not match local API config');
if(expected&&(local.chainId!==97||norm(local.contract)!==norm(expected)))throw Error('API config does not match the newly deployed testnet vault');
NODE
printf '\nGLOBAL_SUPPORT_AND_HTTPS_READY\n'
