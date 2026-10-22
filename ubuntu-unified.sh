#!/usr/bin/env bash
# Install the verified prebuilt frontend and API while preserving the active contract and all data.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm nginx systemctl curl python3 tar; do command -v "$command" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)'
nginx -t
envfile=/etc/globaldroptrade/trades.env
unit=/etc/systemd/system/globaldroptrade-api.service
test -s "$envfile" && test -f "$unit"
previous=$(readlink -f /opt/globaldroptrade-api/current)
test -d "$previous"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --env-file="$envfile" scripts/preflight-unified.mjs "$stage"
bash scripts/unpack-website.sh "$stage"
tar -xzf "$stage/website-release.tar.gz" -C "$stage"
backup="/var/backups/globaldroptrade/unified-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -a /etc/nginx "$backup/nginx"
cp -p "$unit" "$backup/api.service"
printf '%s\n' "$previous" > "$backup/api-release"
rollback(){
 trap - ERR
 cp -a "$backup/nginx/." /etc/nginx/
 cp -p "$backup/api.service" "$unit"
 ln -sfn "$previous" /opt/globaldroptrade-api/current
 systemctl daemon-reload
 systemctl restart globaldroptrade-api || true
 nginx -t && systemctl reload nginx || true
 echo "Upgrade failed; previous frontend/API restored. Backup: $backup"
 exit 1
}
trap rollback ERR
bash ubuntu-api.sh
bash "$stage/globaldroptrade-package/install.sh"
matched=0
for attempt in {1..15}; do
 if curl -fsS --noproxy '*' --max-time 5 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/served.html" && cmp -s "$stage/globaldroptrade-package/site/index.html" "$stage/served.html"; then matched=1; break; fi
 sleep 1
done
[ "$matched" -eq 1 ]
curl -fsS --noproxy '*' --max-time 10 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/config -o "$stage/served-config.json"
node --input-type=module - "$stage/connection-public.json" "$stage/served-config.json" <<'JS'
import fs from 'node:fs';
const [expected,active]=process.argv.slice(2).map(p=>JSON.parse(fs.readFileSync(p)));
if(active.version!==1||active.chainId!==expected.chainId||active.vaultAddress.toLowerCase()!==expected.vaultAddress.toLowerCase())throw Error('ACTIVE_TARGET_CHANGED');
JS
trap - ERR
echo "UNIFIED_FRONTEND_API_READY backup=$backup"
if node --input-type=module - "$stage/connection-public.json" <<'JS'
import fs from 'node:fs';const c=JSON.parse(fs.readFileSync(process.argv[2]));process.exit(c.approvalRequired&&c.chainId===97?0:1);
JS
then
 if [ -f /etc/globaldroptrade/automation.key ]; then
  bash ubuntu-automation.sh || { echo 'AUTOMATION_NOT_ACTIVE: check operator role and service output'; exit 1; }
 else echo 'AUTOMATION_NOT_ACTIVE: an authorized reporter signing key is required in /etc/globaldroptrade/automation.key'; fi
else
 echo 'AUTOMATION_NOT_ACTIVE: the existing immutable contract requires a new approval-enabled deployment; all existing accounts and funds were preserved.'
fi
