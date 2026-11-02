#!/usr/bin/env bash
# Build and publish only the website; preserve API, contract and automation.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ $EUID = 0 ]] || { echo 'ROOT_REQUIRED'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
export PATH="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin:$PATH"
for tool in node npm nginx curl python3 flock; do command -v "$tool" >/dev/null; done
install -d -m 700 /var/lib/globaldroptrade/website-refinement
exec 9>/var/lib/globaldroptrade/website-refinement/run.lock
flock -n 9 || { echo 'WEBSITE_UPDATE_BUSY'; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
curl -fsS --max-time 20 http://127.0.0.1:3115/api/config -o "$stage/before.json"
node --input-type=module - "$stage/before.json" <<'JS'
import fs from 'node:fs';import {isAddress,ZeroAddress} from 'ethers';
const c=JSON.parse(fs.readFileSync(process.argv[2]));
if(c.version!==1||![56,97].includes(c.chainId)||!isAddress(c.vaultAddress)||c.vaultAddress===ZeroAddress)throw Error('ACTIVE_API_TARGET_REQUIRED');
JS
# Keep the frontend target runtime-configured by the existing API.
(cd website && npm ci --ignore-scripts --no-audit --no-fund && VITE_CHAIN_ID=97 VITE_VAULT_ADDRESS='' npm run build)
install -d -m 755 "$stage/site"
cp -R website/dist/. "$stage/site/"
cp -R deployment-console "$stage/site/deploy"
cp scripts/install-website.sh "$stage/install.sh"
backup="/var/backups/globaldroptrade/website-refinement-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -a /etc/nginx "$backup/nginx"
rollback(){
 trap - ERR
 cp -a "$backup/nginx/." /etc/nginx/
 nginx -t && systemctl reload nginx || true
 echo "WEBSITE_REFINEMENT_FAILED previousNginxRestored=true backup=$backup"
 exit 1
}
trap rollback ERR
bash "$stage/install.sh"
curl -fsS --max-time 20 --noproxy '*' --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/served.html"
cmp -s "$stage/site/index.html" "$stage/served.html"
curl -fsS --max-time 20 http://127.0.0.1:3115/api/config -o "$stage/after.json"
node --input-type=module - "$stage/before.json" "$stage/after.json" <<'JS'
import fs from 'node:fs';const [a,b]=process.argv.slice(2).map(f=>JSON.parse(fs.readFileSync(f)));
if(a.chainId!==b.chainId||a.vaultAddress.toLowerCase()!==b.vaultAddress.toLowerCase())throw Error('API_TARGET_CHANGED');
JS
trap - ERR
echo "WEBSITE_REFINEMENT_READY backup=$backup"
echo 'API, financial journals, contract and payment services were preserved.'
