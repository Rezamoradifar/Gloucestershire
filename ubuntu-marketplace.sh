#!/usr/bin/env bash
# Upgrade visuals and official catalog connectors; preserve the active chain and TLS.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm nginx systemctl curl python3; do command -v "$command" >/dev/null; done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))throw Error("Node 22.12+ required")'
case "$(command -v node)" in /root/*) echo 'A system-readable Node runtime is required'; exit 1;; esac
nginx -t
envfile=/etc/globaldroptrade/trades.env
test -s "$envfile" || { echo 'Existing production API configuration is required. Nothing changed.'; exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Only these two public values leave the env-file parsing process.
connection=$(node --env-file="$envfile" --input-type=module -e 'import {readConfig} from "./server/trades-api.mjs";const c=readConfig();if(!c.address)throw Error("Existing vault missing");console.log(c.chainId+" "+c.address)')
read -r VITE_CHAIN_ID VITE_VAULT_ADDRESS <<< "$connection"
export VITE_CHAIN_ID VITE_VAULT_ADDRESS
bash scripts/website-assets.sh
npm ci --prefix website --include=dev --ignore-scripts --no-audit --no-fund
npm run build --prefix website
backup="/var/backups/globaldroptrade/marketplace-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -a /etc/nginx "$backup/nginx"
cp -p "$envfile" "$backup/trades.env"
unit=/etc/systemd/system/globaldroptrade-api.service
test -f "$unit" || { echo 'Existing API service required. Nothing changed.'; exit 1; }
cp -p "$unit" "$backup/api.service"
previous=$(readlink -f /opt/globaldroptrade-api/current)
test -d "$previous"
printf '%s\n' "$previous" > "$backup/api-release"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
rollback(){
 trap - ERR
 cp -a "$backup/nginx/." /etc/nginx/
 cp -p "$backup/api.service" "$unit"
 ln -sfn "$previous" /opt/globaldroptrade-api/current
 systemctl daemon-reload
 systemctl restart globaldroptrade-api || true
 nginx -t && systemctl reload nginx || true
 echo "Upgrade failed. Previous API and Nginx configuration restored. Backup: $backup"
 exit 1
}
trap rollback ERR
bash ubuntu-api.sh
install -d -m 755 "$stage/site"
cp -R website/dist/. "$stage/site/"
cp -R deployment-console "$stage/site/deploy"
cp scripts/install-website.sh "$stage/install.sh"
env -u GLOBAL_SITE_IP -u GLOBAL_SITE_PORT bash "$stage/install.sh"
curl -fsS --max-time 20 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/https.html"
cmp -s website/dist/index.html "$stage/https.html"
curl -fsS --max-time 12 'http://127.0.0.1:3115/api/marketplace?q=headphones' -o "$stage/catalog.json"
node --input-type=module -e 'import fs from "node:fs";const data=JSON.parse(fs.readFileSync(process.argv[1]));if(!Array.isArray(data.providers)||data.providers.length!==2)throw Error("Invalid catalog response");for(const p of data.providers)console.log(p.provider+": "+p.status)' "$stage/catalog.json"
trap - ERR
echo "GLOBAL_3D_AND_CATALOG_INSTALLED — backup: $backup"
echo 'Provider status above determines whether listings are live. No purchases or blockchain transactions were sent.'
